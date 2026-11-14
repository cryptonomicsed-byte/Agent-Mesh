import { describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, verifyEvent } from 'nostr-tools';
import {
  NostrRelay, authRelayUrl, buildAuthEvent, buildSignalEvent, decryptSignalEvent,
} from '../src/services/nostr';

const OFFER = JSON.stringify({ type: 'offer', call_id: 'c1', sdp: 'v=0' });
const now = () => Math.floor(Date.now() / 1000);
const enc = (text: string, sk: Uint8Array, pk: string) =>
  nip44.v2.encrypt(text, nip44.v2.utils.getConversationKey(sk, pk));

/** Build a 3-layer NIP-17 wrap; `rumorAuthor` lets a test forge the rumor. */
function giftWrap(senderSk: Uint8Array, recipientPk: string, text: string, rumorAuthor?: string) {
  const rumor = { kind: 14, content: text, tags: [['p', recipientPk]], created_at: now(),
    pubkey: rumorAuthor ?? getPublicKey(senderSk) };
  const seal = finalizeEvent({ kind: 13, content: enc(JSON.stringify(rumor), senderSk, recipientPk),
    tags: [], created_at: now() }, senderSk);
  const throwaway = generateSecretKey();
  return finalizeEvent({ kind: 1059, content: enc(JSON.stringify(seal), throwaway, recipientPk),
    tags: [['p', recipientPk]], created_at: now() }, throwaway);
}

describe('decryptSignalEvent', () => {
  const us = generateSecretKey(); const usPk = getPublicKey(us);
  const peer = generateSecretKey(); const peerPk = getPublicKey(peer);

  it('1-layer: sender is the outer signer', () => {
    const ev = buildSignalEvent(peer, usPk, OFFER) as Record<string, unknown>;
    expect(decryptSignalEvent(ev, us)).toEqual({ plaintext: OFFER, senderPk: peerPk });
  });

  it('3-layer: sender is the seal signer, not the throwaway outer key', () => {
    const ev = giftWrap(peer, usPk, OFFER) as unknown as Record<string, unknown>;
    expect(ev.pubkey).not.toBe(peerPk);
    expect(decryptSignalEvent(ev, us)).toEqual({ plaintext: OFFER, senderPk: peerPk });
  });

  it('rejects a bad signature', () => {
    const ev = { ...(buildSignalEvent(peer, usPk, OFFER) as Record<string, unknown>), sig: '00'.repeat(64) };
    expect(() => decryptSignalEvent(ev, us)).toThrow(/signature/);
  });

  it('rejects a signature moved onto other content', () => {
    const a = buildSignalEvent(peer, usPk, OFFER) as Record<string, unknown>;
    const b = buildSignalEvent(peer, usPk, JSON.stringify({ type: 'hangup', call_id: 'c1' })) as Record<string, unknown>;
    expect(() => decryptSignalEvent({ ...a, content: b.content }, us)).toThrow(/signature/);
  });

  it('rejects an event addressed to someone else', () => {
    const other = getPublicKey(generateSecretKey());
    const ev = buildSignalEvent(peer, other, OFFER) as Record<string, unknown>;
    expect(() => decryptSignalEvent(ev, us)).toThrow(/not addressed/);
  });

  it('rejects a seal whose rumor claims another author', () => {
    const victim = getPublicKey(generateSecretKey());
    const ev = giftWrap(peer, usPk, OFFER, victim) as unknown as Record<string, unknown>;
    expect(() => decryptSignalEvent(ev, us)).toThrow(/rumor author/);
  });
});

describe('NIP-42', () => {
  it('auth URL drops the proxy path', () => {
    expect(authRelayUrl('wss://omokoda.duckdns.org:3443/relay')).toBe('wss://omokoda.duckdns.org:3443');
  });
  it('auth event is a valid signed kind 22242', () => {
    const sk = generateSecretKey();
    const ev = buildAuthEvent(sk, 'wss://r.example/relay', 'abc');
    expect(ev.kind).toBe(22242);
    expect(ev.tags).toEqual([['relay', 'wss://r.example'], ['challenge', 'abc']]);
    expect(verifyEvent(ev)).toBe(true);
  });
});

/** Minimal stand-in for the browser WebSocket, driven by the test as the relay. */
class FakeSocket {
  static last: FakeSocket;
  static OPEN = 1;
  readyState = 1;
  sent: unknown[][] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.last = this; queueMicrotask(() => this.onopen?.()); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.onclose?.(); }
  relaySays(msg: unknown[]) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

describe('NostrRelay', () => {
  const setup = async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const sk = generateSecretKey();
    const relay = new NostrRelay('wss://r.example/relay', sk);
    const statuses: string[] = [];
    relay.onStatusDetail(s => statuses.push(s));
    relay.connect();
    await Promise.resolve();
    return { relay, sk, pk: getPublicKey(sk), ws: FakeSocket.last, statuses };
  };

  it('answers an AUTH challenge and subscribes again once accepted', async () => {
    const { relay, ws, statuses } = await setup();
    const subId = ws.sent[0][1];
    ws.relaySays(['AUTH', 'challenge-1']);
    const auth = ws.sent[1];
    expect(auth[0]).toBe('AUTH');
    expect((auth[1] as { kind: number }).kind).toBe(22242);
    ws.relaySays(['CLOSED', subId, 'auth-required: sign in']);
    expect(relay.isConnected).toBe(false);
    ws.relaySays(['OK', (auth[1] as { id: string }).id, true, '']);
    expect(ws.sent[2][0]).toBe('REQ');
    ws.relaySays(['EOSE', subId]);
    expect(relay.isConnected).toBe(true);
    expect(statuses.at(-1)).toBe('connected');
    relay.disconnect();
  });

  it('stops and reports when the relay rejects our credentials', async () => {
    const { relay, ws, statuses } = await setup();
    ws.relaySays(['AUTH', 'challenge-1']);
    ws.relaySays(['OK', (ws.sent[1][1] as { id: string }).id, false, 'restricted: not allowed']);
    expect(statuses).toContain('auth-rejected');
    expect(relay.isConnected).toBe(false);
  });

  it('delivers an authenticated signal once and drops forgeries and replays', async () => {
    const { relay, pk, ws } = await setup();
    const subId = ws.sent[0][1];
    const got: string[] = [];
    relay.onSignal(s => got.push(`${s.signal.type}:${s.senderPk}`));
    const peer = generateSecretKey();
    const ev = giftWrap(peer, pk, OFFER);
    ws.relaySays(['EVENT', subId, { ...ev, sig: '00'.repeat(64) }]);
    ws.relaySays(['EVENT', subId, ev]);
    ws.relaySays(['EVENT', subId, ev]);
    ws.relaySays(['EVENT', subId, giftWrap(peer, pk, 'hello, just chatting')]);
    expect(got).toEqual([`offer:${getPublicKey(peer)}`]);
    relay.disconnect();
  });
});
