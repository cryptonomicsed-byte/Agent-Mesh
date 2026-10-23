import { Contact, AppSettings, NearbyPeer } from '../types';
import { renderQRToCanvas, scanCanvasForQR, scanImageFileForQR, parseContactPayload, buildInviteLink } from '../services/qr';
import { formatFingerprint, generateIdentityKeyPairSync, derivePublicKey, generateRandomKey } from '../services/crypto';
import { nip19 } from 'nostr-tools';
import { storage } from '../services/storage';
import { audioSynth } from '../services/audioSynthesizer';

function createModalWrapper(title: string, onClose: () => void): { backdrop: HTMLElement; content: HTMLElement } {
  const backdrop = document.createElement('div');
  backdrop.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.75); z-index: 100; display: flex; align-items: center; justify-content: center;
    padding: 16px; backdrop-filter: blur(4px);
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    background: #1e1e1e; border: 1px solid #333; border-radius: 18px; width: 100%; max-width: 520px;
    max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,0.7);
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    padding: 16px 20px; border-bottom: 1px solid #2d2d2d; display: flex; align-items: center; justify-content: space-between;
  `;
  header.innerHTML = `
    <h3 style="font-size: 17px; font-weight: 700; color: #fff; margin: 0;">${title}</h3>
    <button id="btn-modal-close" style="padding: 6px; border-radius: 8px; color: #888; cursor: pointer;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
  `;
  header.querySelector('#btn-modal-close')?.addEventListener('click', onClose);

  const content = document.createElement('div');
  content.style.cssText = `padding: 20px; display: flex; flex-direction: column; gap: 16px;`;

  card.appendChild(header);
  card.appendChild(content);
  backdrop.appendChild(card);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) onClose();
  });

  return { backdrop, content };
}

/**
 * 1. My Contact QR Code Modal
 */
export function showMyQRModal(settings: AppSettings, onSaveAddresses: () => void): void {
  const { backdrop, content } = createModalWrapper('My Contact QR Code', () => backdrop.remove());

  const canvas = document.createElement('canvas');
  canvas.style.cssText = `
    width: 240px; height: 240px; border-radius: 12px; margin: 0 auto; background: #fff; padding: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  `;

  const myContact: Partial<Contact> = {
    name: settings.userName,
    publicKey: settings.publicKey,
    addresses: settings.activeAddresses,
    relays: settings.nostrRelays,
  };

  renderQRToCanvas(canvas, myContact);

  const jsonString = JSON.stringify(myContact, null, 2);

  content.innerHTML = `
    <div style="text-align: center;">
      <p style="font-size: 13px; color: #aaa; margin-bottom: 14px;">
        Scan this QR code with another Meshenger device to exchange contact info and IP addresses.
      </p>
    </div>
  `;
  content.appendChild(canvas);

  const details = document.createElement('div');
  details.style.cssText = `margin-top: 10px; display: flex; flex-direction: column; gap: 10px;`;
  details.innerHTML = `
    <div style="background: #141414; padding: 12px; border-radius: 10px; border: 1px solid #282828;">
      <div style="font-size: 12px; color: #888; margin-bottom: 2px;">Identity Name</div>
      <div style="font-size: 14px; font-weight: 600; color: #fff;">${settings.userName}</div>
      <div style="font-size: 12px; color: #888; margin-top: 8px; margin-bottom: 2px;">Public Key (Fingerprint)</div>
      <div class="font-mono" style="font-size: 11px; color: #4ade80; word-break: break-all;">${formatFingerprint(settings.publicKey)}</div>
    </div>

    <div>
      <div style="font-size: 12px; font-weight: 600; color: #ccc; margin-bottom: 6px;">Included IP Addresses in QR:</div>
      <div id="qr-address-checkboxes" style="display: flex; flex-direction: column; gap: 6px;">
        ${settings.addresses
          .map(
            (addr) => `
          <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #ddd; cursor: pointer;">
            <input type="checkbox" value="${addr}" ${settings.activeAddresses.includes(addr) ? 'checked' : ''} style="cursor: pointer;" />
            <span class="font-mono">${addr}</span>
          </label>
        `
          )
          .join('')}
      </div>
    </div>

    <div style="display: flex; gap: 10px; margin-top: 8px;">
      <button id="btn-copy-json" style="
        flex: 1; padding: 10px; background: #262626; color: #fff; border: 1px solid #444; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
      ">
        Copy Contact JSON
      </button>
      <button id="btn-download-qr" style="
        flex: 1; padding: 10px; background: #22c55e; color: #000; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
      ">
        Save Image
      </button>
    </div>

    <div style="margin-top: 4px;">
      <div style="font-size: 12px; font-weight: 600; color: #ccc; margin-bottom: 6px;">
        Invite Link <span style="color: #777; font-weight: 400;">(no camera needed — paste into chat, email, etc.)</span>
      </div>
      <div style="display: flex; gap: 8px;">
        <input id="invite-link-text" readonly class="font-mono" style="flex: 1; font-size: 11px; color: #a7f3d0; background: #141414; border: 1px solid #282828;" />
        <button id="btn-copy-invite" style="padding: 8px 14px; background: #262626; color: #fff; border: 1px solid #444; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;">
          Copy
        </button>
      </div>
    </div>
  `;

  content.appendChild(details);

  // Invite link (NIP-19 npub/nprofile deep link — lower-effort complement to QR scanning)
  const inviteLinkInput = details.querySelector('#invite-link-text') as HTMLInputElement;
  inviteLinkInput.value = buildInviteLink(settings.publicKey, settings.nostrRelays);
  details.querySelector('#btn-copy-invite')?.addEventListener('click', () => {
    navigator.clipboard.writeText(inviteLinkInput.value);
    const btn = details.querySelector('#btn-copy-invite') as HTMLButtonElement;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy'), 2000);
  });

  // Address checkbox changes
  details.querySelectorAll('#qr-address-checkboxes input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      const checked: string[] = [];
      details.querySelectorAll('#qr-address-checkboxes input[type="checkbox"]:checked').forEach((el) => {
        checked.push((el as HTMLInputElement).value);
      });
      settings.activeAddresses = checked;
      storage.saveSettings(settings);
      myContact.addresses = checked;
      renderQRToCanvas(canvas, myContact);
      onSaveAddresses();
    });
  });

  // Copy JSON
  details.querySelector('#btn-copy-json')?.addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(myContact, null, 2));
    const btn = details.querySelector('#btn-copy-json') as HTMLButtonElement;
    btn.textContent = 'Copied to Clipboard!';
    setTimeout(() => (btn.textContent = 'Copy Contact JSON'), 2000);
  });

  // Download PNG
  details.querySelector('#btn-download-qr')?.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `meshenger-contact-${settings.userName.replace(/\s+/g, '_')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  document.body.appendChild(backdrop);
}

/**
 * 2. Scan QR Code Modal (Camera Live Scanner, File Upload, Text Paste)
 */
export function showScanQRModal(onContactScanned: (contact: Contact) => void): void {
  const { backdrop, content } = createModalWrapper('Scan Contact QR Code', () => {
    stopCamera();
    backdrop.remove();
  });

  let videoStream: MediaStream | null = null;
  let animFrameId: number | null = null;

  content.innerHTML = `
    <!-- Mode Tabs -->
    <div style="display: flex; gap: 8px; background: #141414; padding: 4px; border-radius: 10px; border: 1px solid #282828;">
      <button id="tab-camera" style="flex: 1; padding: 8px; border-radius: 6px; font-size: 13px; font-weight: 600; background: #262626; color: #fff;">Camera</button>
      <button id="tab-upload" style="flex: 1; padding: 8px; border-radius: 6px; font-size: 13px; font-weight: 600; background: transparent; color: #888;">Upload Image</button>
      <button id="tab-paste" style="flex: 1; padding: 8px; border-radius: 6px; font-size: 13px; font-weight: 600; background: transparent; color: #888;">Paste JSON</button>
    </div>

    <!-- Camera View Container -->
    <div id="view-camera" style="position: relative; width: 100%; height: 260px; background: #000; border-radius: 14px; overflow: hidden; display: flex; align-items: center; justify-content: center;">
      <video id="scan-video" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover;"></video>
      <canvas id="scan-canvas" style="display: none;"></canvas>
      <div class="scan-beam"></div>
      <div style="position: absolute; width: 180px; height: 180px; border: 2px dashed #22c55e; border-radius: 14px; pointer-events: none;"></div>
      <div id="scan-camera-status" style="position: absolute; bottom: 12px; font-size: 12px; color: #aaa; background: rgba(0,0,0,0.6); padding: 4px 10px; border-radius: 6px;">
        Point camera at contact QR code
      </div>
    </div>

    <!-- Upload View Container -->
    <div id="view-upload" style="display: none; flex-direction: column; gap: 12px;">
      <div id="dropzone" style="border: 2px dashed #444; border-radius: 12px; padding: 36px 20px; text-align: center; cursor: pointer; background: #181818;">
        <svg style="margin: 0 auto 10px; color: #777;" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <p style="font-size: 14px; font-weight: 600; color: #eee;">Click or drag QR image file here</p>
        <p style="font-size: 12px; color: #777; margin-top: 4px;">PNG, JPEG, WebP</p>
        <input id="qr-file-input" type="file" accept="image/*" style="display: none;" />
      </div>
    </div>

    <!-- Paste View Container -->
    <div id="view-paste" style="display: none; flex-direction: column; gap: 10px;">
      <textarea id="paste-json-input" placeholder='Paste contact JSON text here, e.g.:
{
  "name": "Node Alice",
  "public_key": "4a7b98...",
  "addresses": ["192.168.1.50:10008"]
}' rows="6" style="width: 100%; font-family: monospace; font-size: 12px; line-height: 1.4;"></textarea>
      <button id="btn-parse-paste" style="padding: 10px; background: #22c55e; color: #000; font-weight: 600; border-radius: 8px; font-size: 13px; cursor: pointer;">
        Parse Contact Data
      </button>
    </div>

    <!-- Detected Contact Preview Card -->
    <div id="scanned-preview-card" style="display: none; background: #163622; border: 1px solid #22c55e; border-radius: 12px; padding: 14px; flex-direction: column; gap: 8px;">
      <div style="font-size: 12px; color: #4ade80; font-weight: 600;">✓ Valid Contact QR Detected!</div>
      <div style="font-size: 16px; font-weight: 700; color: #fff;" id="scanned-name">Name</div>
      <div class="font-mono" style="font-size: 11px; color: #a7f3d0;" id="scanned-key">Key</div>
      <div class="font-mono" style="font-size: 12px; color: #fff;" id="scanned-addr">Addresses</div>
      <button id="btn-confirm-add" style="margin-top: 6px; padding: 10px; background: #22c55e; color: #000; font-weight: 700; border-radius: 8px; font-size: 13px; cursor: pointer;">
        Add to Contacts
      </button>
    </div>
  `;

  const video = content.querySelector('#scan-video') as HTMLVideoElement;
  const canvas = content.querySelector('#scan-canvas') as HTMLCanvasElement;
  const statusEl = content.querySelector('#scan-camera-status') as HTMLElement;
  const previewCard = content.querySelector('#scanned-preview-card') as HTMLElement;
  const scannedName = content.querySelector('#scanned-name') as HTMLElement;
  const scannedKey = content.querySelector('#scanned-key') as HTMLElement;
  const scannedAddr = content.querySelector('#scanned-addr') as HTMLElement;
  const btnConfirm = content.querySelector('#btn-confirm-add') as HTMLButtonElement;

  let currentScannedContact: Contact | null = null;

  function onFoundContact(contact: Contact) {
    currentScannedContact = contact;
    previewCard.style.display = 'flex';
    scannedName.textContent = contact.name;
    scannedKey.textContent = `Fingerprint: ${formatFingerprint(contact.publicKey)}`;
    scannedAddr.textContent = `Address: ${contact.addresses.join(', ') || 'No address'}`;
    statusEl.textContent = 'Contact detected!';
  }

  btnConfirm.addEventListener('click', () => {
    if (currentScannedContact) {
      storage.addContact(currentScannedContact);
      onContactScanned(currentScannedContact);
      stopCamera();
      backdrop.remove();
    }
  });

  // Start Camera
  async function startCamera() {
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      video.srcObject = videoStream;
      video.play();
      scanLoop();
    } catch {
      statusEl.textContent = 'Camera not available. Try Upload or Paste.';
    }
  }

  function stopCamera() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (videoStream) {
      videoStream.getTracks().forEach((t) => t.stop());
      videoStream = null;
    }
  }

  function scanLoop() {
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const result = scanCanvasForQR(video, canvas);
      if (result && result.valid && result.contact) {
        onFoundContact(result.contact);
        return; // stop scanning once found
      }
    }
    animFrameId = requestAnimationFrame(scanLoop);
  }

  startCamera();

  // Tab switching
  const tabCamera = content.querySelector('#tab-camera') as HTMLElement;
  const tabUpload = content.querySelector('#tab-upload') as HTMLElement;
  const tabPaste = content.querySelector('#tab-paste') as HTMLElement;
  const viewCamera = content.querySelector('#view-camera') as HTMLElement;
  const viewUpload = content.querySelector('#view-upload') as HTMLElement;
  const viewPaste = content.querySelector('#view-paste') as HTMLElement;

  const setTab = (active: 'camera' | 'upload' | 'paste') => {
    tabCamera.style.background = active === 'camera' ? '#262626' : 'transparent';
    tabCamera.style.color = active === 'camera' ? '#fff' : '#888';
    tabUpload.style.background = active === 'upload' ? '#262626' : 'transparent';
    tabUpload.style.color = active === 'upload' ? '#fff' : '#888';
    tabPaste.style.background = active === 'paste' ? '#262626' : 'transparent';
    tabPaste.style.color = active === 'paste' ? '#fff' : '#888';

    viewCamera.style.display = active === 'camera' ? 'flex' : 'none';
    viewUpload.style.display = active === 'upload' ? 'flex' : 'none';
    viewPaste.style.display = active === 'paste' ? 'flex' : 'none';

    if (active === 'camera') startCamera();
    else stopCamera();
  };

  tabCamera.addEventListener('click', () => setTab('camera'));
  tabUpload.addEventListener('click', () => setTab('upload'));
  tabPaste.addEventListener('click', () => setTab('paste'));

  // File Upload
  const dropzone = content.querySelector('#dropzone') as HTMLElement;
  const fileInput = content.querySelector('#qr-file-input') as HTMLInputElement;

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      const res = await scanImageFileForQR(file);
      if (res.valid && res.contact) {
        onFoundContact(res.contact);
      } else {
        alert(res.error || 'No valid Meshenger QR code found');
      }
    }
  });

  // Paste JSON
  content.querySelector('#btn-parse-paste')?.addEventListener('click', () => {
    const text = (content.querySelector('#paste-json-input') as HTMLTextAreaElement).value;
    const res = parseContactPayload(text);
    if (res.valid && res.contact) {
      onFoundContact(res.contact);
    } else {
      alert(res.error || 'Invalid contact JSON format');
    }
  });

  document.body.appendChild(backdrop);
}

/**
 * 3. Add Contact Modal (Manual Form)
 */
export function showAddContactModal(onAdded: (contact: Contact) => void): void {
  const { backdrop, content } = createModalWrapper('Add Contact Manually', () => backdrop.remove());

  content.innerHTML = `
    <div>
      <label style="display: block; font-size: 13px; font-weight: 600; color: #ccc; margin-bottom: 6px;">Contact Name</label>
      <input id="add-name" type="text" placeholder="e.g. Charlie (Roof Node)" style="width: 100%;" />
    </div>

    <div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <label style="font-size: 13px; font-weight: 600; color: #ccc;">Public Key (256-bit Hex)</label>
        <button id="btn-gen-key" style="font-size: 11px; color: #4ade80; cursor: pointer;">Generate Key</button>
      </div>
      <input id="add-key" type="text" placeholder="64-character hex public key…" class="font-mono" style="width: 100%; font-size: 12px;" />
    </div>

    <div>
      <label style="display: block; font-size: 13px; font-weight: 600; color: #ccc; margin-bottom: 6px;">IP Address / Domain</label>
      <input id="add-addr" type="text" placeholder="e.g. 192.168.1.150:10008 or mesh.node" class="font-mono" style="width: 100%;" />
      <span style="font-size: 11px; color: #777; margin-top: 4px; display: block;">Supports IPv4, IPv6 link-local (fe80::), or local mesh domain</span>
    </div>

    <button id="btn-save-contact" style="
      margin-top: 10px; padding: 12px; background: #22c55e; color: #000; font-weight: 700; border-radius: 10px; font-size: 14px; cursor: pointer;
    ">
      Save Contact
    </button>
  `;

  content.querySelector('#btn-gen-key')?.addEventListener('click', () => {
    (content.querySelector('#add-key') as HTMLInputElement).value = generateRandomKey(32);
  });

  content.querySelector('#btn-save-contact')?.addEventListener('click', () => {
    const name = (content.querySelector('#add-name') as HTMLInputElement).value.trim();
    const key = (content.querySelector('#add-key') as HTMLInputElement).value.trim().toLowerCase();
    const addr = (content.querySelector('#add-addr') as HTMLInputElement).value.trim();

    if (!name) return alert('Please enter a contact name');
    if (key.length !== 64) return alert('Public key must be exactly 64 hex characters');

    const contact: Contact = {
      name,
      publicKey: key,
      addresses: addr ? [addr] : ['192.168.1.100:10008'],
      state: 'online',
      addedAt: Date.now(),
    };

    storage.addContact(contact);
    onAdded(contact);
    backdrop.remove();
  });

  document.body.appendChild(backdrop);
}

/**
 * 4. Settings Modal
 */
export function showSettingsModal(settings: AppSettings, onUpdated: () => void): void {
  const { backdrop, content } = createModalWrapper('Settings', () => backdrop.remove());

  content.innerHTML = `
    <div>
      <label style="display: block; font-size: 13px; font-weight: 600; color: #ccc; margin-bottom: 6px;">Your Display Name</label>
      <input id="settings-name" type="text" value="${settings.userName}" style="width: 100%;" />
    </div>

    <div style="background: #151515; border: 1px solid #292929; border-radius: 10px; padding: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 12px; font-weight: 600; color: #bbb;">Your Mesh Address</span>
        <div style="display: flex; gap: 8px;">
          <button id="btn-copy-npub" style="font-size: 11px; color: #4ade80; cursor: pointer;">Copy</button>
          <button id="btn-regen-keys" style="font-size: 11px; color: #f87171; cursor: pointer;">New Identity</button>
        </div>
      </div>
      <div style="font-size: 11px; color: #888; margin-bottom: 4px;">npub (share this so people can call you)</div>
      <div id="npub-display" class="font-mono" style="font-size: 11px; color: #4ade80; word-break: break-all; background: #0d0d0d; padding: 8px; border-radius: 6px;">
        ${nip19.npubEncode(settings.publicKey)}
      </div>
      <div style="font-size: 11px; color: #555; margin-top: 6px; font-family: monospace; word-break: break-all;">
        ${formatFingerprint(settings.publicKey)}
      </div>
    </div>

    <div style="background: #151515; border: 1px solid #292929; border-radius: 10px; padding: 12px;">
      <div style="font-size: 12px; font-weight: 600; color: #bbb; margin-bottom: 8px;">Import Identity (Restore from Another Device)</div>
      <textarea id="import-privkey" rows="2" placeholder="Paste your 64-char hex private key or nsec1… here" style="
        width: 100%; font-family: monospace; font-size: 11px; background: #0d0d0d;
        border: 1px solid #333; border-radius: 6px; color: #fff; padding: 8px; resize: none;
      "></textarea>
      <button id="btn-import-identity" style="
        margin-top: 6px; width: 100%; padding: 8px; background: #1e2d3d; color: #60a5fa;
        border: 1px solid #1d4ed840; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
      ">Import &amp; Replace Identity</button>
      <div id="import-identity-error" style="font-size: 11px; color: #f87171; margin-top: 4px; display: none;"></div>
    </div>

    <div>
      <label style="display: block; font-size: 13px; font-weight: 600; color: #ccc; margin-bottom: 6px;">Nostr Signalling Relays</label>
      <textarea id="settings-relays" rows="2" style="width: 100%; font-family: monospace; font-size: 12px;">${(settings.nostrRelays || []).join('\n')}</textarea>
      <div style="font-size: 11px; color: #666; margin-top: 3px;">One relay URL per line (wss://…)</div>
    </div>

    <div>
      <label style="display: block; font-size: 13px; font-weight: 600; color: #ccc; margin-bottom: 6px;">TURN Credentials URL</label>
      <input id="settings-turn-url" type="text" value="${settings.turnCredsUrl || ''}" placeholder="https://…/turn-creds" style="width: 100%; font-family: monospace; font-size: 12px;" />
      <div style="font-size: 11px; color: #666; margin-top: 3px;">Leave blank to skip TURN (LAN-only mode)</div>
    </div>

    <div>
      <label style="display: block; font-size: 13px; font-weight: 600; color: #ccc; margin-bottom: 6px;">Signalling Listen Port</label>
      <input id="settings-port" type="number" value="${settings.listenPort}" style="width: 100%;" />
    </div>

    <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0;">
      <div>
        <div style="font-size: 13px; font-weight: 600; color: #fff;">Enable Camera by Default</div>
        <div style="font-size: 12px; color: #777;">Start outgoing calls with video enabled</div>
      </div>
      <input id="settings-video" type="checkbox" ${settings.enableVideoDefault ? 'checked' : ''} style="cursor: pointer; width: 18px; height: 18px;" />
    </div>

    <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-top: 1px solid #262626; margin-top: 4px;">
      <div style="max-width: 360px;">
        <div style="font-size: 13px; font-weight: 600; color: #fff;">Discoverable on Nearby Mesh</div>
        <div style="font-size: 12px; color: #777; margin-top: 2px;">
          When on, broadcasts your name/pubkey/address on the local relay so other Agent-Mesh nodes nearby can find you without scanning a QR code. Off by default for privacy.
        </div>
      </div>
      <input id="settings-discoverable" type="checkbox" ${settings.discoverable ? 'checked' : ''} style="cursor: pointer; width: 18px; height: 18px; flex-shrink: 0; margin-left: 12px;" />
    </div>

    <div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <label style="font-size: 13px; font-weight: 600; color: #ccc;">Ringtone Volume</label>
        <button id="btn-test-sound" style="font-size: 11px; color: #22c55e; cursor: pointer;">Test Ringtone</button>
      </div>
      <input id="settings-volume" type="range" min="0" max="1" step="0.05" value="${settings.ringtoneVolume}" style="width: 100%;" />
    </div>

    <div style="height: 1px; background: #333; margin: 6px 0;"></div>

    <div style="display: flex; gap: 10px;">
      <button id="btn-backup-export" style="flex: 1; padding: 10px; background: #262626; color: #fff; border: 1px solid #444; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">
        Export Backup
      </button>
      <button id="btn-backup-import" style="flex: 1; padding: 10px; background: #262626; color: #fff; border: 1px solid #444; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;">
        Import Backup
      </button>
      <input id="file-import-backup" type="file" accept=".json" style="display: none;" />
    </div>

    <button id="btn-save-settings" style="
      margin-top: 10px; padding: 12px; background: #22c55e; color: #000; font-weight: 700; border-radius: 10px; font-size: 14px; cursor: pointer;
    ">
      Save Settings
    </button>
  `;

  // Test sound
  let isTesting = false;
  content.querySelector('#btn-test-sound')?.addEventListener('click', () => {
    if (!isTesting) {
      isTesting = true;
      audioSynth.startIncomingRinging(parseFloat((content.querySelector('#settings-volume') as HTMLInputElement).value));
      (content.querySelector('#btn-test-sound') as HTMLElement).textContent = 'Stop Ringtone';
    } else {
      isTesting = false;
      audioSynth.stopAll();
      (content.querySelector('#btn-test-sound') as HTMLElement).textContent = 'Test Ringtone';
    }
  });

  // Copy npub
  content.querySelector('#btn-copy-npub')?.addEventListener('click', () => {
    const npub = nip19.npubEncode(settings.publicKey);
    navigator.clipboard?.writeText(npub).then(() => {
      const btn = content.querySelector('#btn-copy-npub') as HTMLElement;
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1500); }
    });
  });

  // Regenerate identity (proper secp256k1 keypair)
  content.querySelector('#btn-regen-keys')?.addEventListener('click', () => {
    if (confirm('Generate a brand-new identity? You will be unreachable on your old address — contacts will need to re-scan your QR code.')) {
      const { publicKey, privateKey } = generateIdentityKeyPairSync();
      settings.publicKey = publicKey;
      settings.privateKey = privateKey;
      storage.saveSettings(settings);
      onUpdated();
      backdrop.remove();
      showSettingsModal(settings, onUpdated);
    }
  });

  // Import identity
  content.querySelector('#btn-import-identity')?.addEventListener('click', () => {
    const raw = (content.querySelector('#import-privkey') as HTMLTextAreaElement).value.trim();
    const errEl = content.querySelector('#import-identity-error') as HTMLElement;
    errEl.style.display = 'none';
    try {
      let hexKey = raw;
      if (raw.startsWith('nsec1')) {
        const decoded = nip19.decode(raw);
        if (decoded.type !== 'nsec') throw new Error('Not an nsec key');
        hexKey = Array.from(decoded.data as Uint8Array).map(b => b.toString(16).padStart(2,'0')).join('');
      }
      if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) throw new Error('Must be 64 hex chars or nsec1…');
      const pubKey = derivePublicKey(hexKey);
      settings.privateKey = hexKey.toLowerCase();
      settings.publicKey = pubKey;
      storage.saveSettings(settings);
      onUpdated();
      backdrop.remove();
      alert('Identity imported! Your new address: ' + nip19.npubEncode(pubKey).slice(0, 20) + '…');
      showSettingsModal(settings, onUpdated);
    } catch (e: any) {
      errEl.textContent = e?.message ?? 'Invalid key';
      errEl.style.display = 'block';
    }
  });

  // Export Backup
  content.querySelector('#btn-backup-export')?.addEventListener('click', () => {
    const json = storage.exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meshenger-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });

  // Import Backup
  const fileImport = content.querySelector('#file-import-backup') as HTMLInputElement;
  content.querySelector('#btn-backup-import')?.addEventListener('click', () => fileImport.click());
  fileImport.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (re) => {
        const text = re.target?.result as string;
        const res = storage.importBackup(text);
        if (res.success) {
          alert('Backup restored successfully!');
          onUpdated();
          backdrop.remove();
        } else {
          alert(res.message);
        }
      };
      reader.readAsText(file);
    }
  });

  // Save Settings
  content.querySelector('#btn-save-settings')?.addEventListener('click', () => {
    if (isTesting) audioSynth.stopAll();
    settings.userName = (content.querySelector('#settings-name') as HTMLInputElement).value.trim() || 'My Node';
    settings.nostrRelays = (content.querySelector('#settings-relays') as HTMLTextAreaElement).value
      .split('\n').map(s => s.trim()).filter(s => s.startsWith('ws'));
    settings.turnCredsUrl = (content.querySelector('#settings-turn-url') as HTMLInputElement).value.trim();
    settings.listenPort = parseInt((content.querySelector('#settings-port') as HTMLInputElement).value, 10) || 10008;
    settings.enableVideoDefault = (content.querySelector('#settings-video') as HTMLInputElement).checked;
    settings.discoverable = (content.querySelector('#settings-discoverable') as HTMLInputElement).checked;
    settings.ringtoneVolume = parseFloat((content.querySelector('#settings-volume') as HTMLInputElement).value);
    storage.saveSettings(settings);
    onUpdated();
    backdrop.remove();
  });

  document.body.appendChild(backdrop);
}

/**
 * 5. About Meshenger Modal
 */
export function showAboutModal(): void {
  const { backdrop, content } = createModalWrapper('About Meshenger', () => backdrop.remove());

  content.innerHTML = `
    <div style="text-align: center; padding: 10px 0;">
      <div style="width: 58px; height: 58px; border-radius: 16px; background: linear-gradient(135deg, #15803d, #22c55e); margin: 0 auto 12px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 18px rgba(34, 197, 94, 0.35);">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2">
          <path d="M12 2L3 6v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V6l-9-4z"></path>
          <path d="m9 12 2 2 4-4"></path>
        </svg>
      </div>
      <h2 style="font-size: 20px; font-weight: 700; color: #fff; margin: 0;">Meshenger</h2>
      <div style="font-size: 12px; color: #888; margin-top: 2px;">Version 4.4.5 (Web P2P Edition)</div>
    </div>

    <div style="background: #141414; padding: 14px; border-radius: 12px; border: 1px solid #282828; font-size: 13px; color: #ccc; line-height: 1.6;">
      <p style="margin-bottom: 8px;">
        Direct voice- and video phone calls. No need for accounts or access to the Internet. Just scan each other's QR-Code containing IP addresses.
      </p>
      <p style="color: #999; font-size: 12px;">
        Works at home, company intranets, and off-the-grid community mesh networks (such as Freifunk and Yggdrasil).
      </p>
    </div>

    <div style="font-size: 13px; color: #bbb; display: flex; flex-direction: column; gap: 6px;">
      <div><strong>License:</strong> GPL-3.0-or-later</div>
      <div><strong>Cryptography:</strong> 256-bit Ed25519 authentication & DTLS-SRTP</div>
      <div><strong>Signalling:</strong> Decentralized P2P contact QR code exchange</div>
      <div><strong>Official Project:</strong> <a href="https://github.com/meshenger-app/meshenger-android" target="_blank" rel="noopener noreferrer" style="color: #4ade80;">meshenger-app/meshenger-android</a></div>
    </div>

    <button id="btn-close-about" style="
      margin-top: 6px; padding: 10px; background: #262626; color: #fff; font-weight: 600; border-radius: 8px; font-size: 13px; cursor: pointer;
    ">
      Close
    </button>
  `;

  content.querySelector('#btn-close-about')?.addEventListener('click', () => backdrop.remove());
  document.body.appendChild(backdrop);
}

/**
 * 6. Nearby Devices Modal (opt-in local-mesh discovery, MKD-20)
 *
 * Surfaces peers announcing themselves on the "nearby announce" relay topic
 * (see src/services/discovery.ts) while discovery is enabled in Settings.
 * Discovery only *finds* — nothing is auto-added; the user must explicitly
 * tap "Add Contact" per peer, same trust gate as a scanned QR code.
 */
export function showNearbyDevicesModal(
  settings: AppSettings,
  discovery: { getPeers: () => NearbyPeer[]; onPeersChanged: (cb: (peers: NearbyPeer[]) => void) => () => void },
  onAddContact: (contact: Contact) => void
): void {
  const { backdrop, content } = createModalWrapper('Nearby Devices', () => {
    unsubscribe();
    backdrop.remove();
  });

  const list = document.createElement('div');
  list.style.cssText = `display: flex; flex-direction: column; gap: 10px;`;

  function render(peers: NearbyPeer[]) {
    if (!settings.discoverable) {
      list.innerHTML = `
        <div style="text-align: center; padding: 28px 16px; background: #1a1a1a; border-radius: 12px; border: 1px dashed #333;">
          <p style="font-size: 13px; color: #aaa;">Nearby discovery is off. Turn on "Discoverable on Nearby Mesh" in Settings to broadcast and listen for other nodes on your relay.</p>
        </div>
      `;
      return;
    }
    if (peers.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; padding: 28px 16px; background: #1a1a1a; border-radius: 12px; border: 1px dashed #333;">
          <p style="font-size: 13px; color: #aaa;">No other nodes seen yet. Keep this open while another discoverable node starts up nearby.</p>
        </div>
      `;
      return;
    }
    list.innerHTML = '';
    peers.forEach((peer) => {
      const row = document.createElement('div');
      row.style.cssText = `
        background: #1c1c1c; border: 1px solid #2b2b2b; border-radius: 12px; padding: 12px 14px;
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
      `;
      row.innerHTML = `
        <div style="min-width: 0;">
          <div style="font-weight: 600; font-size: 14px; color: #fff;">${peer.name}</div>
          <div class="font-mono" style="font-size: 11px; color: #6ee7b7;">${formatFingerprint(peer.publicKey)}</div>
          <div style="font-size: 11px; color: #888; margin-top: 2px;">${peer.addresses.join(', ') || 'No address announced'}</div>
        </div>
        <button class="btn-add-peer" style="padding: 8px 14px; background: #22c55e; color: #000; font-weight: 700; border-radius: 8px; font-size: 12px; cursor: pointer; white-space: nowrap;">
          Add Contact
        </button>
      `;
      row.querySelector('.btn-add-peer')?.addEventListener('click', () => {
        const contact: Contact = {
          name: peer.name,
          publicKey: peer.publicKey,
          addresses: peer.addresses,
          ...(peer.relays?.length ? { relays: peer.relays } : {}),
          state: 'online',
          addedAt: Date.now(),
        };
        storage.addContact(contact);
        onAddContact(contact);
        (row.querySelector('.btn-add-peer') as HTMLButtonElement).textContent = 'Added ✓';
        (row.querySelector('.btn-add-peer') as HTMLButtonElement).disabled = true;
      });
      list.appendChild(row);
    });
  }

  content.innerHTML = `
    <p style="font-size: 13px; color: #aaa; margin: 0;">
      Nodes that have opted in to "Discoverable on Nearby Mesh" and are on the same relay as you show up here automatically — no QR scan needed.
    </p>
  `;
  content.appendChild(list);

  render(discovery.getPeers());
  const unsubscribe = discovery.onPeersChanged(render);

  document.body.appendChild(backdrop);
}
