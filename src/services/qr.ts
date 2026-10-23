import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { nip19 } from 'nostr-tools';
import { Contact } from '../types';
import {
  isValidPublicKey,
  isValidName,
  sanitizeAddresses,
  sanitizeRelays,
  MAX_CONTACT_ADDRESSES,
} from './crypto';

export interface ScannedContactResult {
  valid: boolean;
  contact?: Contact;
  error?: string;
  rawText?: string;
}

export async function generateContactQRDataUrl(contact: Partial<Contact>): Promise<string> {
  const payload = {
    name: contact.name || 'Anonymous Node',
    public_key: contact.publicKey || '',
    addresses: contact.addresses || [],
  };

  const jsonString = JSON.stringify(payload);
  return QRCode.toDataURL(jsonString, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 8,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}

export async function renderQRToCanvas(canvas: HTMLCanvasElement, contact: Partial<Contact>): Promise<void> {
  const payload = {
    name: contact.name || 'Anonymous Node',
    public_key: contact.publicKey || '',
    addresses: contact.addresses || [],
  };
  const jsonString = JSON.stringify(payload);
  await QRCode.toCanvas(canvas, jsonString, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 6,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}

export function parseContactPayload(rawText: string): ScannedContactResult {
  try {
    if (typeof rawText !== 'string') {
      return { valid: false, error: 'QR payload is empty', rawText: '' };
    }
    const trimmed = rawText.trim();

    // Cap total payload size before even attempting JSON.parse — a hostile
    // QR/paste/invite-link source could otherwise hand us megabytes of text.
    if (trimmed.length > 8192) {
      return { valid: false, error: 'QR payload is too large to be a valid contact', rawText };
    }

    // Support the NIP-19 invite-link complement to QR scanning: a bare
    // npub1… or nprofile1… string (optionally prefixed "nostr:"), or a
    // agentmesh://add#<npub|nprofile> deep link.
    const inviteResult = tryParseInviteLink(trimmed);
    if (inviteResult) return inviteResult;

    const data = JSON.parse(trimmed);

    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'QR payload is not a valid JSON object', rawText };
    }

    if (!isValidName(data.name)) {
      return { valid: false, error: 'Invalid contact name in QR data', rawText };
    }

    if (!isValidPublicKey(data.public_key)) {
      return { valid: false, error: 'Invalid 256-bit public key in QR data', rawText };
    }

    // Harden against a scanned/pasted payload trying to stuff an arbitrary
    // number of garbage "addresses" (or oversized strings) into a contact:
    // bound the array length and validate each entry looks like a real
    // host[:port] before accepting it.
    if (data.addresses !== undefined && !Array.isArray(data.addresses)) {
      return { valid: false, error: 'Contact addresses must be a list', rawText };
    }
    if (Array.isArray(data.addresses) && data.addresses.length > MAX_CONTACT_ADDRESSES) {
      return {
        valid: false,
        error: `QR payload lists too many addresses (max ${MAX_CONTACT_ADDRESSES})`,
        rawText,
      };
    }
    const addresses: string[] = sanitizeAddresses(data.addresses);

    const relays: string[] | undefined = data.relays !== undefined
      ? sanitizeRelays(data.relays)
      : undefined;

    const contact: Contact = {
      name: data.name,
      publicKey: data.public_key.toLowerCase(),
      addresses,
      ...(relays && relays.length ? { relays } : {}),
      state: 'online',
      addedAt: Date.now(),
    };

    return { valid: true, contact, rawText };
  } catch (err: any) {
    return { valid: false, error: 'Could not parse QR data as JSON text', rawText };
  }
}

/**
 * Lower-effort complement to camera-based QR scanning (v0.2 scope item 4):
 * accept a NIP-19 npub/nprofile string, optionally wrapped in a
 * "nostr:" URI prefix or an "agentmesh://add#" deep-link fragment, so two
 * nodes can exchange identity through any side channel (chat, email, etc.)
 * without needing a camera. nprofile additionally carries relay hints.
 */
function tryParseInviteLink(text: string): ScannedContactResult | null {
  let code = text;

  const deepLinkMatch = code.match(/^agentmesh:\/\/add[?#/]?(.*)$/i);
  if (deepLinkMatch) {
    code = deepLinkMatch[1].replace(/^[?#]/, '');
    // Allow agentmesh://add?npub=... or agentmesh://add#npub1...
    const paramMatch = code.match(/(?:^|[?&])(?:npub|key|pubkey)=([^&]+)/i);
    if (paramMatch) code = paramMatch[1];
  }

  if (code.startsWith('nostr:')) code = code.slice('nostr:'.length);
  code = code.trim();

  if (!/^(npub1|nprofile1)[a-z0-9]+$/.test(code)) return null;

  try {
    const decoded = nip19.decode(code);
    if (decoded.type === 'npub') {
      const pubkey = decoded.data as string;
      if (!isValidPublicKey(pubkey)) {
        return { valid: false, error: 'Invite link contains an invalid public key', rawText: text };
      }
      const contact: Contact = {
        name: `Node ${pubkey.slice(0, 8)}`,
        publicKey: pubkey.toLowerCase(),
        addresses: [],
        state: 'pending',
        addedAt: Date.now(),
      };
      return { valid: true, contact, rawText: text };
    }
    if (decoded.type === 'nprofile') {
      const { pubkey, relays } = decoded.data as { pubkey: string; relays?: string[] };
      if (!isValidPublicKey(pubkey)) {
        return { valid: false, error: 'Invite link contains an invalid public key', rawText: text };
      }
      const cleanRelays = sanitizeRelays(relays);
      const contact: Contact = {
        name: `Node ${pubkey.slice(0, 8)}`,
        publicKey: pubkey.toLowerCase(),
        addresses: [],
        ...(cleanRelays.length ? { relays: cleanRelays } : {}),
        state: 'pending',
        addedAt: Date.now(),
      };
      return { valid: true, contact, rawText: text };
    }
  } catch {
    return { valid: false, error: 'Could not decode invite link', rawText: text };
  }
  return null;
}

/** Build a shareable "agentmesh://add#npub1…" (or nprofile1… when relays are known) invite link. */
export function buildInviteLink(publicKeyHex: string, relays?: string[]): string {
  const cleanRelays = sanitizeRelays(relays);
  const code = cleanRelays.length
    ? nip19.nprofileEncode({ pubkey: publicKeyHex, relays: cleanRelays })
    : nip19.npubEncode(publicKeyHex);
  return `agentmesh://add#${code}`;
}

export function scanCanvasForQR(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): ScannedContactResult | null {
  if (video.readyState !== video.HAVE_ENOUGH_DATA) return null;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });

  if (code && code.data) {
    return parseContactPayload(code.data);
  }
  return null;
}

export function scanImageFileForQR(file: File): Promise<ScannedContactResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve({ valid: false, error: 'Canvas context unavailable' });
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (code && code.data) {
          resolve(parseContactPayload(code.data));
        } else {
          resolve({ valid: false, error: 'No QR code detected in the uploaded image' });
        }
      };
      img.onerror = () => resolve({ valid: false, error: 'Failed to load image file' });
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve({ valid: false, error: 'Failed to read file' });
    reader.readAsDataURL(file);
  });
}
