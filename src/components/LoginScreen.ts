import { AppSettings } from '../types';
import { formatFingerprint } from '../services/crypto';
import { storage } from '../services/storage';
import { nip19 } from 'nostr-tools';

export function showLoginScreen(
  settings: AppSettings,
  onConnect: () => void,
  onOpenSettings: () => void,
): HTMLElement {
  const isFirstRun = settings.userName === 'My Node';
  const screen = document.createElement('div');
  screen.style.cssText = `
    position: fixed; inset: 0; background: #0d0d0d;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; z-index: 9000; padding: 24px;
  `;

  screen.innerHTML = `
    <!-- Logo -->
    <div style="width: 72px; height: 72px; border-radius: 20px;
      background: linear-gradient(135deg, #15803d, #22c55e);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 40px rgba(34,197,94,0.35); margin-bottom: 20px;">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2L3 6v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V6l-9-4z"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
    </div>

    <h1 style="font-size: 28px; font-weight: 800; color: #fff; margin: 0 0 6px; letter-spacing: -0.03em;">
      Agent-Mesh
    </h1>
    <p style="font-size: 14px; color: #666; margin: 0 0 32px; text-align: center;">
      Sovereign P2P voice &amp; video — no servers required
    </p>

    <!-- First-run name setup -->
    ${isFirstRun ? `
    <div style="width: 100%; max-width: 360px; background: #161616;
      border: 1px solid #22c55e40; border-radius: 16px; padding: 18px 20px; margin-bottom: 20px;">
      <div style="font-size: 12px; font-weight: 700; color: #4ade80; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L3 6v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V6l-9-4z"/></svg>
        First time? Choose your name
      </div>
      <input id="first-run-name" type="text" placeholder="Your name (e.g. Alice)" maxlength="40" style="
        width: 100%; padding: 10px 12px; background: #0d0d0d; border: 1px solid #333;
        border-radius: 8px; color: #fff; font-size: 15px; font-weight: 600; margin-bottom: 6px;
      " />
      <div id="first-run-name-hint" style="font-size: 11px; color: #555;">This is how you appear to contacts. Required before you can go online — change it any time in Settings.</div>
    </div>
    ` : ''}

    <!-- Identity card -->
    <div style="width: 100%; max-width: 360px; background: #161616;
      border: 1px solid #262626; border-radius: 16px; padding: 18px 20px; margin-bottom: 16px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
        <div style="font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase;
          letter-spacing: 0.1em;">Your Mesh Address</div>
        <button id="btn-address-help" type="button" title="What's a Mesh Address?" style="
          width: 18px; height: 18px; border-radius: 50%; background: #222; border: 1px solid #3a3a3a;
          color: #888; font-size: 11px; font-weight: 700; cursor: pointer; display: flex;
          align-items: center; justify-content: center; padding: 0; line-height: 1;
        ">?</button>
      </div>

      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
        <div style="width: 44px; height: 44px; border-radius: 12px; background: #1e3a2b;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <div style="min-width: 0;">
          <div id="login-node-name" style="font-size: 16px; font-weight: 700; color: #fff;">
            ${escapeHtml(settings.userName)}
          </div>
          <div style="font-size: 10px; color: #4ade80; font-family: monospace; margin-top: 3px; word-break: break-all;">
            ${nip19.npubEncode(settings.publicKey).slice(0, 28)}…
          </div>
        </div>
      </div>

      <!-- Inline, dismissible explainer: what is a mesh address / relay -->
      <div id="address-help-panel" style="
        display: none; background: #0f1a13; border: 1px solid #22c55e30; border-radius: 10px;
        padding: 10px 12px; margin-bottom: 10px; font-size: 11.5px; color: #a7d8b8; line-height: 1.55;
      ">
        <strong style="color: #4ade80;">Mesh Address</strong> is your unique ID on the network — like a phone number
        other people enter to reach you. Nobody can fake it or take it over because it's generated from your private key,
        which never leaves this device.<br/><br/>
        <strong style="color: #4ade80;">Relay</strong> is just a message courier: it passes along small
        "someone wants to call you" notes between devices so you don't need a fixed IP address. The relay
        never sees your call audio/video or your contacts — it only helps you find each other. You can
        point to a different relay (or run your own) in Settings.
      </div>

      <div style="background: #0d0d0d; border-radius: 8px; padding: 8px 10px; font-size: 10px; color: #555; font-family: monospace; word-break: break-all; margin-bottom: 10px;">
        ${formatFingerprint(settings.publicKey)}
      </div>

      <div style="border-top: 1px solid #222; padding-top: 10px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-size: 11px; color: #555; margin-bottom: 2px;">Relay (message courier)</div>
          <div style="font-size: 11px; color: #4ade80; font-family: monospace;">
            ${escapeHtml((settings.nostrRelays ?? [])[0]?.replace('wss://', '') ?? 'not set')}
          </div>
        </div>
        <div style="font-size: 11px; color: #555; text-align: right;">
          <div>Your address is unique</div>
          <div>to this device/browser</div>
        </div>
      </div>
    </div>

    <!-- Persistent helper text explaining what Go Online does -->
    <div id="go-online-explainer" style="
      width: 100%; max-width: 360px; font-size: 12px; color: #777; margin-bottom: 12px;
      display: flex; align-items: flex-start; gap: 8px; padding: 0 2px;
    ">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" style="flex-shrink: 0; margin-top: 2px;"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
      <span><strong style="color: #999;">Going online</strong> connects you to your relay so contacts can reach you and your calls can connect. You can go offline again any time from the menu.</span>
    </div>

    <!-- Connect button -->
    <button id="btn-connect" style="
      width: 100%; max-width: 360px; padding: 16px; font-size: 16px; font-weight: 700;
      background: #22c55e; color: #000; border-radius: 14px; cursor: pointer;
      box-shadow: 0 4px 24px rgba(34,197,94,0.35); margin-bottom: 8px;
      display: flex; align-items: center; justify-content: center; gap: 10px;
      transition: opacity 0.15s ease;
    ">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
        <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
        <line x1="12" y1="20" x2="12.01" y2="20"/>
      </svg>
      Go Online
    </button>

    <!-- Reason the button is disabled, shown only on first run until a name is entered -->
    ${isFirstRun ? `
    <div id="btn-connect-disabled-reason" style="
      width: 100%; max-width: 360px; font-size: 11.5px; color: #f59e0b; margin-bottom: 12px;
      text-align: center; min-height: 14px;
    ">Enter your name above to enable Go Online</div>
    ` : ''}

    <button id="btn-login-settings" style="
      width: 100%; max-width: 360px; padding: 12px; font-size: 14px; font-weight: 600;
      background: transparent; color: #666; border: 1px solid #2a2a2a; border-radius: 14px; cursor: pointer;
    ">
      Change Identity / Settings
    </button>

    <p style="margin-top: 24px; font-size: 11px; color: #3a3a3a; text-align: center; max-width: 300px;">
      Your keys never leave this device. All calls are end-to-end encrypted via NIP-44.
    </p>
  `;

  // Help toggle for "what's a mesh address / relay"
  const helpBtn = screen.querySelector('#btn-address-help') as HTMLButtonElement | null;
  const helpPanel = screen.querySelector('#address-help-panel') as HTMLElement | null;
  if (helpBtn && helpPanel) {
    helpBtn.addEventListener('click', () => {
      const isOpen = helpPanel.style.display === 'block';
      helpPanel.style.display = isOpen ? 'none' : 'block';
      helpBtn.style.background = isOpen ? '#222' : '#1e3a2b';
      helpBtn.style.color = isOpen ? '#888' : '#4ade80';
      helpBtn.style.borderColor = isOpen ? '#3a3a3a' : '#22c55e60';
    });
  }

  const btn = screen.querySelector('#btn-connect') as HTMLButtonElement;
  const disabledReasonEl = screen.querySelector('#btn-connect-disabled-reason') as HTMLElement | null;

  // Live-validate the name field on first run so the disabled reason clears as soon
  // as it's satisfied, instead of only reacting to a failed click.
  if (isFirstRun) {
    const nameInput = screen.querySelector('#first-run-name') as HTMLInputElement | null;
    nameInput?.addEventListener('input', () => {
      if (nameInput.value.trim()) {
        nameInput.style.borderColor = '#333';
        if (disabledReasonEl) {
          disabledReasonEl.style.color = '#4ade80';
          disabledReasonEl.textContent = 'Ready to go online';
        }
      } else if (disabledReasonEl) {
        disabledReasonEl.style.color = '#f59e0b';
        disabledReasonEl.textContent = 'Enter your name above to enable Go Online';
      }
    });
  }

  btn.addEventListener('click', () => {
    // Save name on first run
    if (isFirstRun) {
      const nameInput = screen.querySelector('#first-run-name') as HTMLInputElement | null;
      const name = nameInput?.value.trim();
      if (!name) {
        if (nameInput) { nameInput.style.borderColor = '#ef4444'; nameInput.focus(); }
        if (disabledReasonEl) {
          disabledReasonEl.style.color = '#ef4444';
          disabledReasonEl.textContent = "You need a name before you can go online — contacts see it when you call.";
        }
        return;
      }
      const s = storage.getSettings();
      s.userName = name;
      storage.saveSettings(s);
    }

    btn.disabled = true;
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
        style="animation: spin 1s linear infinite;">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      Connecting…
    `;
    btn.style.opacity = '0.8';
    onConnect();
  });

  screen.querySelector('#btn-login-settings')?.addEventListener('click', onOpenSettings);

  return screen;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
