/**
 * Passphrase-derived at-rest encryption for the Nostr secp256k1 private key.
 *
 * WebCrypto's SubtleCrypto does NOT support secp256k1 signing operations, so
 * there is no way to keep the scalar inside a non-extractable hardware-backed
 * CryptoKey the way you could with P-256/RSA/Ed25519 WebAuthn flows — the raw
 * 32-byte scalar must exist in JS memory whenever nostr-tools signs an event
 * or derives a shared secret. What we CAN do, and what this module does, is
 * make sure the key never touches disk (localStorage) in plaintext: it is
 * wrapped with AES-256-GCM using a key derived from the user's passphrase via
 * PBKDF2-SHA256, and only the ciphertext + salt + iv are persisted. The
 * plaintext key only ever exists in memory for the current unlocked session.
 *
 * Threat model notes (see SECURITY.md for the full writeup):
 *  - Defends against: disk theft, localStorage/devtools snooping while
 *    locked, casual browser-profile exfiltration, stolen backup files.
 *  - Does NOT defend against: an attacker who can run arbitrary JS in the
 *    page's origin (XSS) *while the vault is unlocked*, or who can capture
 *    the passphrase as it's typed. Those remain structurally unsolved by any
 *    browser-local scheme that must sign secp256k1 events in JS.
 */

const PBKDF2_ITERATIONS = 310_000; // OWASP 2023 minimum guidance for PBKDF2-SHA256
const SALT_BYTES = 16;
const IV_BYTES = 12; // AES-GCM standard nonce size
const KEY_LENGTH_BITS = 256;

export interface EncryptedPrivateKey {
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // base64
  iv: string;   // base64
  ciphertext: string; // base64, AES-256-GCM (includes auth tag)
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('Incorrect passphrase or corrupted vault data');
    this.name = 'WrongPassphraseError';
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations, hash: "SHA-256" },
    baseKey,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptPrivateKey(
  plainHex: string,
  passphrase: string,
): Promise<EncryptedPrivateKey> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aesKey = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
    aesKey,
    new TextEncoder().encode(plainHex),
  );
  return {
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
  };
}

export async function decryptPrivateKey(
  encrypted: EncryptedPrivateKey,
  passphrase: string,
): Promise<string> {
  const salt = base64ToBytes(encrypted.salt);
  const iv = base64ToBytes(encrypted.iv);
  const ciphertext = base64ToBytes(encrypted.ciphertext);
  const aesKey = await deriveAesKey(passphrase, salt, encrypted.iterations);
  try {
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
      aesKey,
      ciphertext as unknown as ArrayBuffer,
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    throw new WrongPassphraseError();
  }
}
