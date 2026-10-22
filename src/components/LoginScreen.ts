import { AppSettings } from '../types';
import { formatFingerprint } from '../services/crypto';

export function showLoginScreen(
  settings: AppSettings,
  onConnect: () => void,
  onOpenSettings: () => void,
): HTMLElement {
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

    <!-- Identity card -->
    <div style="width: 100%; max-width: 360px; background: #161616;
      border: 1px solid #262626; border-radius: 16px; padding: 18px 20px; margin-bottom: 28px;">
      <div style="font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase;
        letter-spacing: 0.1em; margin-bottom: 10px;">Your Node Identity</div>

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
          <div style="font-size: 11px; color: #555; font-family: monospace; margin-top: 2px; word-break: break-all;">
            ${formatFingerprint(settings.publicKey)}
          </div>
        </div>
      </div>

      <div style="border-top: 1px solid #222; padding-top: 12px;">
        <div style="font-size: 11px; color: #555; margin-bottom: 4px;">Relay</div>
        <div style="font-size: 12px; color: #4ade80; font-family: monospace; word-break: break-all;">
          ${escapeHtml((settings.nostrRelays ?? [])[0] ?? 'wss://omokoda.duckdns.org:3443')}
        </div>
      </div>
    </div>

    <!-- Connect button -->
    <button id="btn-connect" style="
      width: 100%; max-width: 360px; padding: 16px; font-size: 16px; font-weight: 700;
      background: #22c55e; color: #000; border-radius: 14px; cursor: pointer;
      box-shadow: 0 4px 24px rgba(34,197,94,0.35); margin-bottom: 12px;
      display: flex; align-items: center; justify-content: center; gap: 10px;
    ">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
        <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
        <line x1="12" y1="20" x2="12.01" y2="20"/>
      </svg>
      Go Online
    </button>

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

  const btn = screen.querySelector('#btn-connect') as HTMLButtonElement;
  btn.addEventListener('click', () => {
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
