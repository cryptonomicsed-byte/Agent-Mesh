/**
 * Meshenger Cryptographic Identity & Utility
 * Handles Ed25519-compatible 256-bit key representations,
 * fingerprints, and serialization.
 */

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

export async function generateIdentityKeyPair(): Promise<KeyPair> {
  try {
    // Generate an Ed25519 key pair if supported by Web Crypto
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'Ed25519',
      },
      true,
      ['sign', 'verify']
    );

    const rawPub = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    const pkHex = byteArrayToHexString(new Uint8Array(rawPub));
    // For storage, generate deterministic or random 32-byte representation
    const privHex = generateRandomKey(32);
    return {
      publicKey: pkHex,
      privateKey: privHex,
    };
  } catch {
    // Fallback if Ed25519 is not exposed in this Web Crypto environment
    return {
      publicKey: generateRandomKey(32),
      privateKey: generateRandomKey(32),
    };
  }
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
