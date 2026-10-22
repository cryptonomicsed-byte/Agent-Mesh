import { Contact, CallEvent, AppSettings } from '../types';
import { generateRandomKey } from './crypto';

const CONTACTS_STORAGE_KEY = 'meshenger_contacts_v1';
const EVENTS_STORAGE_KEY = 'meshenger_events_v1';
const SETTINGS_STORAGE_KEY = 'meshenger_settings_v1';

const DEFAULT_SETTINGS: AppSettings = {
  userName: 'My Meshenger Node',
  publicKey: generateRandomKey(32),
  privateKey: generateRandomKey(32),
  listenPort: 10008,
  addresses: ['192.168.1.105', 'fe80::4a2c:90ff:fed1:3321', 'mesh.local'],
  activeAddresses: ['192.168.1.105', 'fe80::4a2c:90ff:fed1:3321'],
  enableVideoDefault: true,
  theme: 'dark',
  ringtoneVolume: 0.8,
  vibrate: true,
};

const SEED_CONTACTS: Contact[] = [
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
      this.saveSettings(DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SETTINGS };
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
    const data = {
      version: 1,
      appName: 'Meshenger',
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      contacts: this.getContacts(),
      events: this.getEvents(),
    };
    return JSON.stringify(data, null, 2);
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
