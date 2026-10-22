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
