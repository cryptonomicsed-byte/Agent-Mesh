/**
 * Nearby-node discovery for Agent-Mesh v0.2.
 *
 * Design note (see MKD-20):
 * A web app cannot join real mDNS/Bonjour multicast groups (no raw UDP
 * socket access in the browser), so instead of a native mDNS stack we reuse
 * the Nostr signalling channel the app already depends on
 * (`src/services/nostr.ts`) as a lightweight "nearby announce" topic:
 *
 *   - kind 20121 (ephemeral, NIP-01 range 20000-29999 — relays MAY drop
 *     these events after delivery and SHOULD NOT store them) is used for
 *     a plaintext, unaddressed "announce" broadcast:
 *       { "pubkey": <our pubkey>, "name": <our name>,
 *         "addresses": [...], "relays": [...] }
 *     wrapped as the event content (JSON string). The event is NOT
 *     NIP-44 encrypted and carries no "p" tag — it is a public broadcast
 *     by design, analogous to an mDNS announce packet on a LAN segment.
 *     Anyone subscribed to kind:20121 on the same relay sees it; on a
 *     private/local relay (e.g. a Yggdrasil or Freifunk community relay)
 *     this is effectively "announce on the local mesh segment" without
 *     needing raw multicast.
 *   - Each discoverable node both publishes its own announce (every
 *     ANNOUNCE_INTERVAL_MS while discovery is on) and subscribes to
 *     other nodes' kind:20121 announces, surfacing them as `NearbyPeer`
 *     entries the user can review and add as a real contact (never
 *     auto-added — discovery only *finds*, the user still decides to
 *     trust).
 *   - This is strictly opt-in (`settings.discoverable`, default false):
 *     when off, this node neither publishes nor subscribes, so it leaks
 *     no presence information and is invisible to the announce topic.
 *
 * Trust model: announce payloads go through the exact same
 * `parseContactPayload`-style validation/bounds as QR/paste before they
 * are ever surfaced or addable, since they are just as "untrusted input"
 * as a scanned QR code.
 */

import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { NearbyPeer } from '../types';
import { hexToBytes, SecKey, PubKeyHex } from './nostr';
import { isValidName, isValidPublicKey, sanitizeAddresses, sanitizeRelays } from './crypto';

export const NEARBY_ANNOUNCE_KIND = 20121;
export const ANNOUNCE_INTERVAL_MS = 30_000;
/** Peers not re-announced within this window are considered stale and pruned from the nearby list. */
export const PEER_EXPIRY_MS = 120_000;

interface AnnouncePayload {
  v: 1;
  name: string;
  addresses: string[];
  relays?: string[];
}

function parseAnnouncePayload(pubkey: string, raw: string): NearbyPeer | null {
  if (!isValidPublicKey(pubkey)) return null;
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<AnnouncePayload>;
  if (!isValidName(d.name as string)) return null;

  const addresses = sanitizeAddresses(d.addresses);
  const relays = sanitizeRelays(d.relays);

  return {
    publicKey: pubkey.toLowerCase(),
    name: (d.name as string).trim(),
    addresses,
    relays,
    lastSeen: Date.now(),
  };
}

export type NearbyPeerListener = (peers: NearbyPeer[]) => void;

/**
 * Manages opt-in "nearby" discovery: publishes periodic announce events for
 * our own node and listens for announces from other nodes on the same
 * relay(s), while discovery is enabled. Safe to construct unconditionally;
 * it is a no-op until `start()` is called and stops cleanly via `stop()`.
 */
export class NearbyDiscoveryService {
  private ws: WebSocket | null = null;
  private subId = 'nearby-' + Math.random().toString(36).slice(2, 10);
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private expiryTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private peers = new Map<string, NearbyPeer>();
  private listeners: Set<NearbyPeerListener> = new Set();

  constructor(
    private relayUrl: string,
    private ourSk: SecKey,
    private getAnnouncePayload: () => { name: string; addresses: string[]; relays?: string[] },
  ) {}

  get ourPk(): PubKeyHex {
    return getPublicKey(this.ourSk);
  }

  onPeersChanged(cb: NearbyPeerListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getPeers(): NearbyPeer[] {
    return Array.from(this.peers.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.peers.clear();
    this._connect();
    this.announceTimer = setInterval(() => this._publishAnnounce(), ANNOUNCE_INTERVAL_MS);
    this.expiryTimer = setInterval(() => this._pruneStale(), 15_000);
  }

  stop(): void {
    this.running = false;
    if (this.announceTimer) clearInterval(this.announceTimer);
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    this.announceTimer = null;
    this.expiryTimer = null;
    this.ws?.close();
    this.ws = null;
    this.peers.clear();
    this._notify();
  }

  private _connect(): void {
    try {
      const ws = new WebSocket(this.relayUrl);
      this.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify(['REQ', this.subId, { kinds: [NEARBY_ANNOUNCE_KIND], since: Math.floor(Date.now() / 1000) - 60 }]));
        this._publishAnnounce();
      };
      ws.onmessage = (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data as string) as unknown[];
          if (msg[0] === 'EVENT' && msg[1] === this.subId) {
            this._handleAnnounceEvent(msg[2] as Record<string, unknown>);
          }
        } catch {}
      };
      ws.onclose = () => {
        if (this.running) setTimeout(() => this._connect(), 4000);
      };
      ws.onerror = () => {};
    } catch {}
  }

  private _handleAnnounceEvent(event: Record<string, unknown>): void {
    if (event.kind !== NEARBY_ANNOUNCE_KIND) return;
    const pubkey = event.pubkey as string;
    if (pubkey === this.ourPk) return; // ignore our own echoed announce
    const peer = parseAnnouncePayload(pubkey, event.content as string);
    if (!peer) return;
    const existing = this.peers.get(peer.publicKey);
    if (existing) {
      existing.name = peer.name;
      existing.addresses = peer.addresses;
      existing.relays = peer.relays;
      existing.lastSeen = Date.now();
    } else {
      this.peers.set(peer.publicKey, peer);
    }
    this._notify();
  }

  private _publishAnnounce(): void {
    if (!this.running || this.ws?.readyState !== WebSocket.OPEN) return;
    const { name, addresses, relays } = this.getAnnouncePayload();
    const payload: AnnouncePayload = { v: 1, name, addresses: sanitizeAddresses(addresses), relays: sanitizeRelays(relays) };
    try {
      const event = finalizeEvent(
        { kind: NEARBY_ANNOUNCE_KIND, content: JSON.stringify(payload), tags: [], created_at: Math.floor(Date.now() / 1000) },
        this.ourSk,
      );
      this.ws.send(JSON.stringify(['EVENT', event]));
    } catch {}
  }

  private _pruneStale(): void {
    const now = Date.now();
    let changed = false;
    for (const [key, peer] of this.peers) {
      if (now - peer.lastSeen > PEER_EXPIRY_MS) {
        this.peers.delete(key);
        changed = true;
      }
    }
    if (changed) this._notify();
  }

  private _notify(): void {
    const list = this.getPeers();
    this.listeners.forEach((cb) => cb(list));
  }
}

export function createDiscoveryService(
  relayUrl: string,
  privateKeyHex: string,
  getAnnouncePayload: () => { name: string; addresses: string[]; relays?: string[] },
): NearbyDiscoveryService {
  return new NearbyDiscoveryService(relayUrl, hexToBytes(privateKeyHex), getAnnouncePayload);
}
