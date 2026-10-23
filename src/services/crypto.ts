/**
 * Cryptographic identity utilities for Agent-Mesh.
 * Keys are secp256k1 (Nostr-native): private key = 32-byte scalar,
 * public key = 32-byte x-coordinate, both stored as 64-char lowercase hex.
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools';

export function byteArrayToHexString(byteArray: Uint8Array): string {
  return Array.from(byteArray, (byte) =>
    ('0' + (byte & 0xff).toString(16)).slice(-2)
  ).join('');
}

export function hexStringToByteArray(hexString: string): Uint8Array | null {
  const clean = hexString.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) return null;
  const result = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.substring(i, i + 2), 16);
    if (isNaN(byte)) return null;
    result[i / 2] = byte;
  }
  return result;
}

export function generateRandomKey(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return byteArrayToHexString(bytes);
}

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

/** Generate a secp256k1 keypair (Nostr-compatible). Synchronous via noble/curves. */
export function generateIdentityKeyPairSync(): KeyPair {
  const sk = generateSecretKey();
  return {
    privateKey: byteArrayToHexString(sk),
    publicKey: getPublicKey(sk),
  };
}

/** Async wrapper kept for backwards compat. */
export async function generateIdentityKeyPair(): Promise<KeyPair> {
  return generateIdentityKeyPairSync();
}

/** Derive the secp256k1 public key from a hex private key. */
export function derivePublicKey(privateKeyHex: string): string {
  const skBytes = hexStringToByteArray(privateKeyHex);
  if (!skBytes) throw new Error('invalid private key hex');
  return getPublicKey(skBytes);
}

export function formatFingerprint(publicKeyHex: string): string {
  const clean = publicKeyHex.toUpperCase().replace(/[^0-9A-F]/g, '');
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    chunks.push(clean.substring(i, i + 4));
  }
  return chunks.slice(0, 8).join(' : ');
}

export function isValidPublicKey(hex: string): boolean {
  if (!hex) return false;
  const clean = hex.trim().replace(/[^0-9a-fA-F]/g, '');
  return clean.length === 64;
}

export function isValidName(name: string): boolean {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 64;
}

/**
 * Bounds applied to untrusted contact data arriving via QR scan, pasted JSON,
 * nearby-discovery announcements, or invite links. Keeps a malicious/garbled
 * payload from injecting dozens of bogus "addresses" or relay URLs into a
 * contact record.
 */
export const MAX_CONTACT_ADDRESSES = 12;
export const MAX_ADDRESS_LENGTH = 128;
export const MAX_CONTACT_RELAYS = 8;
export const MAX_RELAY_LENGTH = 200;

// host[:port] where host is an IPv4 literal, a bracketed/bare IPv6 literal
// (optionally with a %zone suffix for link-local addresses), or a DNS-style
// hostname/mesh domain. Port, when present, must be 1-5 digits.
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^\[?[0-9a-fA-F:]+(%[a-zA-Z0-9]+)?\]?$/;
const HOSTNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
function splitHostPort(addr: string): { host: string; port?: string } {
  // Bracketed IPv6 with optional port: [::1]:10008
  const bracketMatch = addr.match(/^(\[[0-9a-fA-F:%a-zA-Z]+\])(:(\d{1,5}))?$/);
  if (bracketMatch) return { host: bracketMatch[1], port: bracketMatch[3] };

  // Bare IPv6 (contains 2+ colons) is never followed by :port — too ambiguous.
  if ((addr.match(/:/g) || []).length >= 2) return { host: addr };

  const idx = addr.lastIndexOf(':');
  if (idx === -1) return { host: addr };
  return { host: addr.slice(0, idx), port: addr.slice(idx + 1) };
}

/** Validate a single mesh address string ("IP[:port]" or "hostname[:port]"). */
export function isValidAddress(addr: string): boolean {
  if (typeof addr !== 'string') return false;
  const trimmed = addr.trim();
  if (!trimmed || trimmed.length > MAX_ADDRESS_LENGTH) return false;
  if (/\s/.test(trimmed)) return false;

  const { host, port } = splitHostPort(trimmed);
  if (port !== undefined) {
    if (!/^\d{1,5}$/.test(port)) return false;
    const portNum = parseInt(port, 10);
    if (portNum < 1 || portNum > 65535) return false;
  }

  const bareHost = host.replace(/^\[/, '').replace(/\]$/, '');
  return IPV4_RE.test(bareHost) || IPV6_RE.test(bareHost) || HOSTNAME_RE.test(bareHost);
}

/** Validate and bound-check an array of untrusted address strings, returning a clean deduped list. */
export function sanitizeAddresses(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= MAX_CONTACT_ADDRESSES) break;
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!isValidAddress(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Validate a single relay URL (ws:// or wss://, bounded length). */
export function isValidRelayUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > MAX_RELAY_LENGTH) return false;
  if (!/^wss?:\/\/[^\s]+$/i.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'ws:' || u.protocol === 'wss:';
  } catch {
    return false;
  }
}

/** Validate and bound-check an array of untrusted relay URL strings, returning a clean deduped list. */
export function sanitizeRelays(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= MAX_CONTACT_RELAYS) break;
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!isValidRelayUrl(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
