import { Contact, CallEvent, AppSettings } from '../types';
import { generateIdentityKeyPairSync, derivePublicKey } from './crypto';
import { DEFAULT_RELAY } from './nostr';

const CONTACTS_STORAGE_KEY = 'meshenger_contacts_v1';
const EVENTS_STORAGE_KEY = 'meshenger_events_v1';
const SETTINGS_STORAGE_KEY = 'meshenger_settings_v1';

function makeDefaultSettings(): AppSettings {
  const { publicKey, privateKey } = generateIdentityKeyPairSync();
  return {
    userName: 'My Node',
    publicKey,
    privateKey,
    nostrRelays: [DEFAULT_RELAY],
    turnCredsUrl: 'https://omokoda.duckdns.org/turn-creds',
    listenPort: 10008,
    addresses: [],
    activeAddresses: [],
    enableVideoDefault: true,
    theme: 'dark',
    ringtoneVolume: 0.8,
    vibrate: true,
  };
}

const SEED_CONTACTS: Contact[] = [
  {
    name: 'Agent Voice (AI)',
    publicKey: 'c148f3b60583ebc9c3eb8e42f44a4c78f8f5f59bbf6d47e553d3d030e9f1ab65',
    addresses: ['omokoda.duckdns.org:10008'],
    relays: ['wss://omokoda.duckdns.org:3443'],
    state: 'online',
    addedAt: Date.now() - 3600000,
  },
  {
    name: 'Freifunk Mesh Gateway (Node #18)',
    publicKey: 'a1f893d9b048123ef6177bc954e7d14872c05e19741b689a7702ec9432bfd12e',
    addresses: ['192.168.1.1:10008', 'fe80::1:10008', 'gw.freifunk.mesh'],
    state: 'online',
    addedAt: Date.now() - 3600000 * 24 * 5,
  },
  {
    name: 'Alice (Community Lab)',
    publicKey: 'e7c10b428d9047bf8145a329de4100fc33829ad451996720b8f44d189ac3e041',
    addresses: ['192.168.1.42:10008', 'fe80::a2b:3c4d:5e6f:7a8b'],
    state: 'online',
    addedAt: Date.now() - 3600000 * 24 * 3,
  },
  {
    name: 'Bob (Mobile Walkie)',
    publicKey: '7f9942a1bc34821d84e55198dc0045e76a38217bb4c90184e93d254aa18ef930',
    addresses: ['192.168.1.77:10008'],
    state: 'offline',
    addedAt: Date.now() - 3600000 * 24,
  },
];

const SEED_EVENTS: CallEvent[] = [
  {
    id: 'evt-1',
    contactPublicKey: 'e7c10b428d9047bf8145a329de4100fc33829ad451996720b8f44d189ac3e041',
    contactName: 'Alice (Community Lab)',
    type: 'incoming_accepted',
    timestamp: Date.now() - 3600000 * 2,
    duration: 142,
    addressUsed: '192.168.1.42:10008',
    hasVideo: true,
  },
  {
    id: 'evt-2',
    contactPublicKey: '7f9942a1bc34821d84e55198dc0045e76a38217bb4c90184e93d254aa18ef930',
    contactName: 'Bob (Mobile Walkie)',
    type: 'outgoing_missed',
    timestamp: Date.now() - 3600000 * 18,
    duration: 0,
    addressUsed: '192.168.1.77:10008',
    hasVideo: false,
  },
];

class StorageService {
  getSettings(): AppSettings {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      const defaults = makeDefaultSettings();
      this.saveSettings(defaults);
      return defaults;
    }
    try {
      const stored = JSON.parse(raw) as AppSettings;
      // Ensure secp256k1 public key is consistent with stored private key
      if (stored.privateKey?.length === 64) {
        try { stored.publicKey = derivePublicKey(stored.privateKey); } catch {}
      }
      // Backfill fields missing from old data
      if (!stored.nostrRelays?.length) stored.nostrRelays = [DEFAULT_RELAY];
      if (stored.turnCredsUrl === undefined) stored.turnCredsUrl = '';
      return stored;
    } catch {
      const defaults = makeDefaultSettings();
      this.saveSettings(defaults);
      return defaults;
    }
  }

  saveSettings(settings: AppSettings): void {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }

  getContacts(): Contact[] {
    const raw = localStorage.getItem(CONTACTS_STORAGE_KEY);
    if (!raw) {
      this.saveContacts(SEED_CONTACTS);
      return [...SEED_CONTACTS];
    }
    try {
      return JSON.parse(raw);
    } catch {
      return [...SEED_CONTACTS];
    }
  }

  saveContacts(contacts: Contact[]): void {
    localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
  }

  addContact(contact: Contact): boolean {
    const contacts = this.getContacts();
    const existingIndex = contacts.findIndex(
      (c) => c.publicKey.toLowerCase() === contact.publicKey.toLowerCase()
    );
    if (existingIndex >= 0) {
      contacts[existingIndex] = { ...contacts[existingIndex], ...contact };
    } else {
      contacts.unshift(contact);
    }
    this.saveContacts(contacts);
    return true;
  }

  deleteContact(publicKey: string): void {
    const contacts = this.getContacts().filter(
      (c) => c.publicKey.toLowerCase() !== publicKey.toLowerCase()
    );
    this.saveContacts(contacts);
  }

  toggleBlockContact(publicKey: string): void {
    const contacts = this.getContacts();
    const c = contacts.find((item) => item.publicKey.toLowerCase() === publicKey.toLowerCase());
    if (c) {
      c.blocked = !c.blocked;
      c.state = c.blocked ? 'blocked' : 'offline';
      this.saveContacts(contacts);
    }
  }

  getEvents(): CallEvent[] {
    const raw = localStorage.getItem(EVENTS_STORAGE_KEY);
    if (!raw) {
      this.saveEvents(SEED_EVENTS);
      return [...SEED_EVENTS];
    }
    try {
      return JSON.parse(raw);
    } catch {
      return [...SEED_EVENTS];
    }
  }

  saveEvents(events: CallEvent[]): void {
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
  }

  addEvent(event: CallEvent): void {
    const events = this.getEvents();
    events.unshift(event);
    if (events.length > 100) events.length = 100;
    this.saveEvents(events);
  }

  clearEvents(): void {
    localStorage.removeItem(EVENTS_STORAGE_KEY);
  }

  exportBackup(): string {
    return JSON.stringify({
      version: 1,
      appName: 'Agent-Mesh',
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      contacts: this.getContacts(),
      events: this.getEvents(),
    }, null, 2);
  }

  importBackup(jsonString: string): { success: boolean; message: string } {
    try {
      const data = JSON.parse(jsonString);
      if (data.settings) this.saveSettings(data.settings);
      if (Array.isArray(data.contacts)) this.saveContacts(data.contacts);
      if (Array.isArray(data.events)) this.saveEvents(data.events);
      return { success: true, message: 'Backup restored successfully' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Invalid backup JSON' };
    }
  }
}

export const storage = new StorageService();
