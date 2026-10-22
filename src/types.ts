export type ContactState = 
  | 'online' 
  | 'offline' 
  | 'pending' 
  | 'blocked' 
  | 'unreachable';

export interface Contact {
  name: string;
  publicKey: string; // 64-char hex string
  addresses: string[]; // IP addresses or domains
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
  publicKey: string;
  privateKey: string;
  listenPort: number;
  addresses: string[]; // My detected & custom addresses
  activeAddresses: string[]; // Addresses included in my QR code
  enableVideoDefault: boolean;
  theme: 'dark' | 'light';
  ringtoneVolume: number;
  vibrate: boolean;
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
