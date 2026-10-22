import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { Contact } from '../types';
import { isValidPublicKey, isValidName } from './crypto';

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
    const trimmed = rawText.trim();
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

    const addresses: string[] = Array.isArray(data.addresses)
      ? data.addresses.map((a: any) => String(a).trim()).filter(Boolean)
      : [];

    const contact: Contact = {
      name: data.name,
      publicKey: data.public_key.toLowerCase(),
      addresses,
      state: 'online',
      addedAt: Date.now(),
    };

    return { valid: true, contact, rawText };
  } catch (err: any) {
    return { valid: false, error: 'Could not parse QR data as JSON text', rawText };
  }
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
