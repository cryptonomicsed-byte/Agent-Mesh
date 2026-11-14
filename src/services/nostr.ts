/**
 * Nostr signaling transport for Agent-Mesh.
 *
 * Wire format matches agent-voice/caller/index.html and agent-phone:
 *   - All signals are kind:1059 events
 *   - Content = NIP-44 v2 encrypt(signal_json, conv_key)
 *   - conv_key = ECDH(our_seckey, sender_pubkey)
 *   - Inbound: event.pubkey IS the sender (1-layer wrap from agent-voice)
 *   - Inbound 3-layer NIP-17: inner is kind:13 seal → decrypt with seal.pubkey
 *   - Signal payload: {type, call_id, sdp?, candidate?, reason?}
 *
 * Nothing is treated as coming from a sender until it is authenticated: the
 * outer event's id and signature are verified, and for a 3-layer wrap the
 * seal's too, with the rumor's author required to match the seal signer.
 */

import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  verifyEvent,
  nip44,
} from 'nostr-tools';
import type { Event as NostrEvent } from 'nostr-tools';

export type SecKey = Uint8Array;
export type PubKeyHex = string; // 64 lowercase hex chars

export interface SignalPayload {
  type: 'offer' | 'answer' | 'ice' | 'hangup';
  call_id: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  reason?: string;
}

export interface IncomingSignal {
  signal: SignalPayload;
  senderPk: PubKeyHex;
}

export function generateNostrKeypair(): { secretKey: SecKey; publicKey: PubKeyHex } {
  const sk = generateSecretKey();
  return { secretKey: sk, publicKey: getPublicKey(sk) };
}

export function pubkeyFromSeckey(sk: SecKey): PubKeyHex {
  return getPublicKey(sk);
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (clean.length !== 64) throw new Error(`expected 64 hex chars, got ${clean.length}`);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

// Build a 1-layer kind:1059 gift wrap (content = NIP-44 encrypt, signed by sender)
export function buildSignalEvent(senderSk: SecKey, recipientPk: PubKeyHex, payload: string): object {
  const convKey = nip44.v2.utils.getConversationKey(senderSk, recipientPk);
  return finalizeEvent({
    kind: 1059,
    content: nip44.v2.encrypt(payload, convKey),
    tags: [['p', recipientPk]],
    created_at: Math.floor(Date.now() / 1000),
  }, senderSk);
}

/**
 * Verify an event's id and signature from its wire fields only. nostr-tools
 * caches a "verified" marker on event objects; copying the plain fields means
 * a marker carried over from another object can never stand in for a check.
 */
function verifyFresh(ev: Record<string, unknown>): boolean {
  const { id, pubkey, created_at, kind, tags, content, sig } = ev;
  return verifyEvent({ id, pubkey, created_at, kind, tags, content, sig } as unknown as NostrEvent);
}

/**
 * Authenticate and decrypt a kind:1059 event. Handles 1-layer wraps and
 * 3-layer NIP-17. Throws if any layer fails verification.
 */
export function decryptSignalEvent(
  event: Record<string, unknown>,
  ourSk: SecKey,
): { plaintext: string; senderPk: PubKeyHex } {
  const ourPk = getPublicKey(ourSk);
  const tags = Array.isArray(event.tags) ? event.tags as unknown[][] : [];
  if (!tags.some(t => Array.isArray(t) && t[0] === 'p' && t[1] === ourPk)) {
    throw new Error('event is not addressed to us');
  }
  if (!verifyFresh(event)) {
    throw new Error('event signature does not verify');
  }
  const outerPk = event.pubkey as string;
  const outer = nip44.v2.decrypt(
    event.content as string, nip44.v2.utils.getConversationKey(ourSk, outerPk));

  let inner: Record<string, unknown> | null = null;
  try { inner = JSON.parse(outer) as Record<string, unknown>; } catch { inner = null; }

  if (inner && inner.kind === 13) {
    // 3-layer NIP-17: the outer key is a throwaway; the seal signer is the sender.
    if (!verifyFresh(inner)) {
      throw new Error('seal signature does not verify');
    }
    const sealPk = inner.pubkey as string;
    const rumor = JSON.parse(nip44.v2.decrypt(
      inner.content as string, nip44.v2.utils.getConversationKey(ourSk, sealPk),
    )) as Record<string, unknown>;
    if (rumor?.kind !== 14 || typeof rumor.content !== 'string') {
      throw new Error('seal does not contain a kind:14 rumor');
    }
    if (rumor.pubkey !== sealPk) {
      throw new Error('rumor author does not match the seal signer');
    }
    return { plaintext: rumor.content, senderPk: sealPk };
  }

  // 1-layer: outer IS the signal JSON (event.pubkey = real sender)
  return { plaintext: outer, senderPk: outerPk };
}

/** NIP-42: the relay URL in an AUTH event is scheme + host, without the proxy path. */
export function authRelayUrl(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

/** NIP-42: build the signed kind:22242 reply to a relay's AUTH challenge. */
export function buildAuthEvent(sk: SecKey, relayUrl: string, challenge: string): NostrEvent {
  return finalizeEvent({
    kind: 22242,
    content: '',
    tags: [['relay', authRelayUrl(relayUrl)], ['challenge', challenge]],
    created_at: Math.floor(Date.now() / 1000),
  }, sk);
}

export type RelayStatus = 'connecting' | 'connected' | 'auth-rejected' | 'disconnected';

export const DEFAULT_RELAY = 'wss://omokoda.duckdns.org:3443';
export const FALLBACK_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];

export class NostrRelay {
  readonly ourPk: PubKeyHex;
  private ws: WebSocket | null = null;
  private subId: string;
  private closed = false;
  private reconnectMs = 2000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private signalHandlers: Array<(s: IncomingSignal) => void> = [];
  private statusHandlers: Array<(connected: boolean) => void> = [];
  private detailHandlers: Array<(status: RelayStatus, reason?: string) => void> = [];
  private pendingAuthId: string | null = null;
  private subscribed = false;
  private seenIds = new Set<string>();

  constructor(
    private readonly url: string,
    private readonly ourSk: SecKey,
  ) {
    this.ourPk = getPublicKey(ourSk);
    this.subId = 'am-' + Math.random().toString(36).slice(2, 10);
  }

  static fromHexSeckey(hexSk: string, relayUrl?: string): NostrRelay {
    const sk = hexToBytes(hexSk);
    return new NostrRelay(relayUrl ?? DEFAULT_RELAY, sk);
  }

  /** True once the socket is open AND our subscription is live (after AUTH, if the relay demands it). */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.subscribed;
  }

  /** Detailed status, including a relay that refused our NIP-42 credentials. */
  onStatusDetail(cb: (status: RelayStatus, reason?: string) => void): () => void {
    this.detailHandlers.push(cb);
    return () => { this.detailHandlers = this.detailHandlers.filter(h => h !== cb); };
  }

  private _setStatus(status: RelayStatus, reason?: string): void {
    this.detailHandlers.forEach(h => h(status, reason));
    this.statusHandlers.forEach(h => h(status === 'connected'));
  }

  private _subscribe(ws: WebSocket): void {
    const since = Math.floor(Date.now() / 1000) - 300;
    ws.send(JSON.stringify([
      'REQ', this.subId,
      { kinds: [1059], '#p': [this.ourPk], since },
    ]));
  }

  onSignal(cb: (s: IncomingSignal) => void): () => void {
    this.signalHandlers.push(cb);
    return () => { this.signalHandlers = this.signalHandlers.filter(h => h !== cb); };
  }

  onStatusChange(cb: (connected: boolean) => void): () => void {
    this.statusHandlers.push(cb);
    return () => { this.statusHandlers = this.statusHandlers.filter(h => h !== cb); };
  }

  connect(): void {
    this.closed = false;
    this._doConnect();
  }

  disconnect(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private _doConnect(): void {
    if (this.closed) return;
    try {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      this.subscribed = false;
      this.pendingAuthId = null;
      this._setStatus('connecting');

      ws.onopen = () => {
        this.reconnectMs = 2000;
        this._subscribe(ws);
      };

      ws.onmessage = (e: MessageEvent) => {
        let msg: unknown[];
        try { msg = JSON.parse(e.data as string) as unknown[]; } catch { return; }
        if (!Array.isArray(msg)) return;
        if (msg[0] === 'AUTH' && typeof msg[1] === 'string') {
          // NIP-42: prove who we are, then (re)subscribe once the relay accepts.
          const auth = buildAuthEvent(this.ourSk, this.url, msg[1]);
          this.pendingAuthId = auth.id;
          this.subscribed = false;
          ws.send(JSON.stringify(['AUTH', auth]));
        } else if (msg[0] === 'OK' && msg[1] === this.pendingAuthId) {
          this.pendingAuthId = null;
          if (msg[2] === true) {
            this._subscribe(ws);
          } else {
            // Retrying with the same key cannot succeed; stop and say why.
            this.closed = true;
            this._setStatus('auth-rejected', String(msg[3] ?? ''));
            ws.close();
          }
        } else if (msg[0] === 'EOSE' && msg[1] === this.subId) {
          if (!this.subscribed) { this.subscribed = true; this._setStatus('connected'); }
        } else if (msg[0] === 'CLOSED' && msg[1] === this.subId) {
          this.subscribed = false;
          // "auth-required" before our AUTH was accepted is expected; the
          // subscription is re-issued on OK. Anything else: reconnect.
          if (!this.pendingAuthId && !String(msg[2] ?? '').startsWith('auth-required')) ws.close();
        } else if (msg[0] === 'EVENT' && msg[1] === this.subId) {
          if (!this.subscribed) { this.subscribed = true; this._setStatus('connected'); }
          this._handleEvent(msg[2] as Record<string, unknown>);
        }
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        this.subscribed = false;
        if (!this.closed) this._setStatus('disconnected');
        if (!this.closed) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectMs = Math.min(this.reconnectMs * 1.5, 30000);
            this._doConnect();
          }, this.reconnectMs);
        }
      };
    } catch {}
  }

  private _handleEvent(event: Record<string, unknown>): void {
    if (event.kind !== 1059 || typeof event.id !== 'string') return;
    if (this.seenIds.has(event.id)) return;          // replayed on reconnect / second relay
    let parsed: { plaintext: string; senderPk: PubKeyHex };
    try {
      parsed = decryptSignalEvent(event, this.ourSk);
    } catch (err) {
      console.warn('[NostrRelay] dropped unauthenticated event:', (err as Error).message);
      return;
    }
    this.seenIds.add(event.id);
    if (this.seenIds.size > 2000) this.seenIds.delete(this.seenIds.values().next().value as string);
    let signal: SignalPayload;
    try { signal = JSON.parse(parsed.plaintext) as SignalPayload; } catch { return; }
    if (!signal || typeof signal.call_id !== 'string'
        || !['offer', 'answer', 'ice', 'hangup'].includes(signal.type)) return;
    this.signalHandlers.forEach(h => h({ signal, senderPk: parsed.senderPk }));
  }

  sendSignal(recipientPk: PubKeyHex, signal: SignalPayload): boolean {
    if (!this.isConnected) return false;
    try {
      const event = buildSignalEvent(this.ourSk, recipientPk, JSON.stringify(signal));
      this.ws!.send(JSON.stringify(['EVENT', event]));
      return true;
    } catch (err) {
      console.warn('[NostrRelay] send failed:', err);
      return false;
    }
  }
}

/** Fire-and-forget: publish a signal event to a list of extra relay URLs (used for contacts on different relays). */
export function sendToRelays(urls: string[], senderSk: SecKey, recipientPk: PubKeyHex, signal: SignalPayload): void {
  if (!urls.length) return;
  const event = buildSignalEvent(senderSk, recipientPk, JSON.stringify(signal));
  for (const url of urls) {
    try {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        ws.send(JSON.stringify(['EVENT', event]));
        setTimeout(() => ws.close(), 4000);
      };
      ws.onerror = () => ws.close();
    } catch {}
  }
}

