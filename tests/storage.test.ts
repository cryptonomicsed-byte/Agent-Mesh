import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'meshenger_settings_v1';

function memoryLocalStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

async function freshStorage() {
  vi.resetModules();
  return (await import('../src/services/storage')).storage;
}

describe('identity key storage', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', memoryLocalStorage()); });

  it('never writes the secret key to localStorage, and keeps the identity across reloads', async () => {
    const first = await freshStorage();
    await first.unlock();
    const a = first.getSettings();
    expect(a.privateKey).toMatch(/^[0-9a-f]{64}$/);
    await new Promise(r => setTimeout(r, 50));            // vault write settles
    expect(localStorage.getItem(KEY)).not.toContain(a.privateKey);
    expect(JSON.parse(localStorage.getItem(KEY)!).privateKey).toBeUndefined();

    const second = await freshStorage();                  // "page reload"
    await second.unlock();
    const b = second.getSettings();
    expect(b.privateKey).toBe(a.privateKey);
    expect(b.publicKey).toBe(a.publicKey);
  });

  it('moves a key left in localStorage by an older version into the vault', async () => {
    const legacy = 'ab'.repeat(32);
    indexedDB.deleteDatabase('agent-mesh-vault');
    localStorage.setItem(KEY, JSON.stringify({ userName: 'Old', privateKey: legacy, nostrRelays: [] }));
    const s = await freshStorage();
    await s.unlock();
    expect(localStorage.getItem(KEY)).not.toContain(legacy);
    expect(s.getSettings().privateKey).toBe(legacy);
    expect(s.getSettings().userName).toBe('Old');
  });
});
