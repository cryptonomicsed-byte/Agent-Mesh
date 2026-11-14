/**
 * Encrypted-at-rest storage for the identity secret key.
 *
 * The secp256k1 key has to be usable by JavaScript to sign, so it cannot be a
 * non-extractable WebCrypto key itself. Instead it is encrypted with an
 * AES-GCM key that IS non-extractable and lives in IndexedDB. The plaintext
 * key is never written to localStorage, so it does not end up in storage
 * dumps, synced profiles or anything that reads localStorage as text.
 *
 * This does not protect against script running in this origin (XSS): such a
 * script can ask the vault to decrypt. A hardware or remote signer is the
 * answer to that, not storage.
 */

const DB_NAME = 'agent-mesh-vault';
const STORE = 'keys';
const WRAP_ID = 'wrap';
const IDENTITY_ID = 'identity';

export function vaultAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
    && typeof crypto !== 'undefined' && !!crypto.subtle;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, id: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, id: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function wrapKey(db: IDBDatabase): Promise<CryptoKey> {
  let key = await idbGet<CryptoKey>(db, WRAP_ID);
  if (!key) {
    key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, false /* non-extractable */, ['encrypt', 'decrypt']);
    await idbPut(db, WRAP_ID, key);
  }
  return key;
}

/** Encrypt and store the identity secret key (64 hex chars). */
export async function savePrivateKey(hex: string): Promise<void> {
  const db = await openDb();
  try {
    const key = await wrapKey(db);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(hex));
    await idbPut(db, IDENTITY_ID, { iv, ct });
  } finally {
    db.close();
  }
}

/** Return the stored identity secret key, or null if none is stored. */
export async function loadPrivateKey(): Promise<string | null> {
  const db = await openDb();
  try {
    const rec = await idbGet<{ iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer }>(db, IDENTITY_ID);
    if (!rec) return null;
    const key = await wrapKey(db);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.ct);
    return new TextDecoder().decode(pt);
  } finally {
    db.close();
  }
}
