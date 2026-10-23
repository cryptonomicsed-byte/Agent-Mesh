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
 */

import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  nip44,
} from 'nostr-tools';

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

// Decrypt a kind:1059 event — handles both 1-layer and 3-layer NIP-17
export function decryptSignalEvent(
  event: { pubkey: string; content: string },
  ourSk: SecKey,
): { plaintext: string; senderPk: PubKeyHex } {
  // Outer layer: ECDH(our_seckey, event.pubkey)
  const outerConvKey = nip44.v2.utils.getConversationKey(ourSk, event.pubkey);
  const outer = nip44.v2.decrypt(event.content, outerConvKey);

  // Probe for 3-layer NIP-17: outer decrypts to a kind:13 seal JSON
  try {
    const inner = JSON.parse(outer) as Record<string, unknown>;
    if (inner?.kind === 13 && typeof inner.pubkey === 'string' && typeof inner.content === 'string') {
      const sealConvKey = nip44.v2.utils.getConversationKey(ourSk, inner.pubkey as string);
      const rumorStr = nip44.v2.decrypt(inner.content as string, sealConvKey);
      const rumor = JSON.parse(rumorStr) as Record<string, unknown>;
      const content = rumor?.kind === 14 && typeof rumor.content === 'string'
        ? rumor.content as string
        : rumorStr;
      return { plaintext: content, senderPk: inner.pubkey as string };
    }
  } catch {}

  // 1-layer: outer IS the signal JSON (event.pubkey = real sender)
  return { plaintext: outer, senderPk: event.pubkey };
}

export const DEFAULT_RELAY = 'wss://omokoda.duckdns.org:3443';
export const FALLBACK_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];

// Max time (ms) a queued outbound signal is kept waiting for the relay to come back.
// ICE candidates/answers older than this are almost certainly stale (call already ended/timed out).
const OUTBOX_MAX_AGE_MS = 120_000;
// Cap on queued outbound signals so a long outage can't grow this unbounded.
const OUTBOX_MAX_SIZE = 200;
// Cap on dedup cache of recently-seen inbound event ids (bounded FIFO).
const SEEN_EVENTS_MAX = 500;

interface QueuedSignal {
  recipientPk: PubKeyHex;
  signal: SignalPayload;
  queuedAt: number;
}

export class NostrRelay {
  readonly ourPk: PubKeyHex;
  private ws: WebSocket | null = null;
  private subId: string;
  private closed = false;
  private reconnectMs = 2000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private signalHandlers: Array<(s: IncomingSignal) => void> = [];
  private statusHandlers: Array<(connected: boolean) => void> = [];
  // Outbound signals (notably ICE candidates generated while the relay socket
  // was down) that failed to send and are waiting to be flushed on reconnect.
  private pendingOutbox: QueuedSignal[] = [];
  // When we last went offline — used to widen the replay window on reconnect
  // so signals published by the peer during our downtime aren't missed.
  private lastDisconnectedAt: number | null = null;
  // Dedup cache: avoids re-processing the same signal twice when a widened
  // replay window re-delivers events we already handled before the drop.
  private seenEventIds: Set<string> = new Set();

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

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
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

      ws.onopen = () => {
        this.reconnectMs = 2000;
        // Widen the replay window to cover however long we were actually
        // disconnected (not just a fixed 300s) so signals — in particular
        // ICE candidates the peer sent to the relay while we were down —
        // get replayed to us instead of being silently lost on reconnect.
        // Floored at 300s (first-connect default) and capped at 1h so a
        // long outage can't trigger an unbounded relay query.
        const outageSec = this.lastDisconnectedAt
          ? Math.ceil((Date.now() - this.lastDisconnectedAt) / 1000)
          : 0;
        const windowSec = Math.min(Math.max(300, outageSec + 60), 3600);
        const since = Math.floor(Date.now() / 1000) - windowSec;
        this.lastDisconnectedAt = null;
        ws.send(JSON.stringify([
          'REQ', this.subId,
          { kinds: [1059], '#p': [this.ourPk], since },
        ]));
        this.statusHandlers.forEach(h => h(true));
        // Flush anything we queued while disconnected (e.g. ICE candidates
        // generated mid-call that failed to send because the socket was down).
        this._flushOutbox();
      };

      ws.onmessage = (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data as string) as unknown[];
          if (msg[0] === 'EVENT' && msg[1] === this.subId) {
            this._handleEvent(msg[2] as Record<string, unknown>);
          }
        } catch {}
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        this.lastDisconnectedAt = Date.now();
        this.statusHandlers.forEach(h => h(false));
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
    if (event.kind !== 1059) return;
    // Dedup: a widened replay window on reconnect (see onopen above) can
    // re-deliver an event we already processed before the relay dropped us.
    const id = typeof event.id === 'string' ? event.id : undefined;
    if (id) {
      if (this.seenEventIds.has(id)) return;
      this.seenEventIds.add(id);
      if (this.seenEventIds.size > SEEN_EVENTS_MAX) {
        const oldest = this.seenEventIds.values().next().value;
        if (oldest !== undefined) this.seenEventIds.delete(oldest);
      }
    }
    try {
      const { plaintext, senderPk } = decryptSignalEvent(
        event as { pubkey: string; content: string },
        this.ourSk,
      );
      const signal = JSON.parse(plaintext) as SignalPayload;
      if (!signal?.type || !signal?.call_id) return;
      this.signalHandlers.forEach(h => h({ signal, senderPk }));
    } catch {}
  }

  /**
   * Send a signal immediately if connected. If the socket is down (or the
   * send throws), the signal is queued and automatically retried the next
   * time the relay reconnects — this is what prevents ICE candidates (and
   * other mid-call signals) generated during a relay drop from being
   * silently lost instead of just delayed.
   */
  sendSignal(recipientPk: PubKeyHex, signal: SignalPayload): boolean {
    if (this.isConnected) {
      try {
        const event = buildSignalEvent(this.ourSk, recipientPk, JSON.stringify(signal));
        this.ws!.send(JSON.stringify(['EVENT', event]));
        return true;
      } catch (err) {
        console.warn('[NostrRelay] send failed, queueing for retry:', err);
      }
    }
    this._enqueueOutbox(recipientPk, signal);
    return false;
  }

  private _enqueueOutbox(recipientPk: PubKeyHex, signal: SignalPayload): void {
    this.pendingOutbox.push({ recipientPk, signal, queuedAt: Date.now() });
    if (this.pendingOutbox.length > OUTBOX_MAX_SIZE) {
      this.pendingOutbox.splice(0, this.pendingOutbox.length - OUTBOX_MAX_SIZE);
    }
  }

  private _flushOutbox(): void {
    if (!this.pendingOutbox.length) return;
    const now = Date.now();
    const toSend = this.pendingOutbox.filter(item => now - item.queuedAt < OUTBOX_MAX_AGE_MS);
    this.pendingOutbox = [];
    for (const item of toSend) {
      // Re-run through sendSignal: if we're truly connected this sends now;
      // if the socket flapped again immediately it re-queues rather than drops.
      this.sendSignal(item.recipientPk, item.signal);
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

