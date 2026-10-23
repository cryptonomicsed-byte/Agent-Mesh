import { EncryptedPrivateKey } from "./services/secureStorage";
export type ContactState = 
  | 'online' 
  | 'offline' 
  | 'pending' 
  | 'blocked' 
  | 'unreachable';

export interface Contact {
  name: string;
  publicKey: string; // 64-char hex secp256k1 x-coordinate (Nostr pubkey)
  addresses: string[]; // IP addresses or domains for direct mesh
  relays?: string[]; // Nostr relay URLs this contact listens on
  blocked?: boolean;
  state?: ContactState;
  lastWorkingAddress?: string;
  addedAt?: number;
}

export type CallEventType = 
  | 'incoming_accepted'
  | 'incoming_missed'
  | 'incoming_declined'
  | 'outgoing_accepted'
  | 'outgoing_missed'
  | 'outgoing_declined'
  | 'incoming_error'
  | 'outgoing_error';

export interface CallEvent {
  id: string;
  contactPublicKey: string;
  contactName: string;
  type: CallEventType;
  timestamp: number;
  duration: number; // in seconds
  addressUsed?: string;
  hasVideo?: boolean;
}

export interface AppSettings {
  userName: string;
  publicKey: string; // 64-char hex secp256k1 x-coordinate (Nostr pubkey)
  privateKey: string; // 64-char hex secp256k1 secret key — will be absent once vault is locked
  encryptedPrivateKey?: EncryptedPrivateKey; // present when key is encrypted at rest
  nostrRelays: string[]; // Nostr relay URLs to use for signaling
  turnCredsUrl: string; // Public HTTPS URL for TURN credentials (e.g. https://vantage-host/api/turn-creds)
  listenPort: number;
  addresses: string[]; // My detected & custom addresses
  activeAddresses: string[]; // Addresses included in my QR code
  enableVideoDefault: boolean;
  theme: 'dark' | 'light';
  ringtoneVolume: number;
  vibrate: boolean;
  discoverable: boolean; // opt-in: broadcast presence on the "nearby announce" Nostr topic for local-network discovery
}

/** A peer discovered via the local-network "nearby announce" topic, not yet added as a contact. */
export interface NearbyPeer {
  publicKey: string;
  name: string;
  addresses: string[];
  relays: string[];
  lastSeen: number;
}

export type ActiveCallState = 
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'connected'
  | 'ended'
  | 'error';

export interface CallStats {
  resolution?: string;
  frameRate?: number;
  videoBitrate?: string;
  audioBitrate?: string;
  packetsLost?: number;
  rtt?: number; // round-trip time in ms
  codec?: string;
}

export interface InCallChatMessage {
  id: string;
  sender: 'self' | 'peer';
  text: string;
  timestamp: number;
}
