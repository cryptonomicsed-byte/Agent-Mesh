import { AppSettings } from '../types';

export function createHeader(
  settings: AppSettings,
  handlers: {
    onShowMyQR: () => void;
    onScanQR: () => void;
    onSimulateCall: () => void;
    onAddressManagement: () => void;
    onSettings: () => void;
    onAbout: () => void;
  }
): HTMLElement {
  const header = document.createElement('header');
  header.className = 'w-full bg-[#181818] border-b border-[#2d2d2d] px-4 py-3 sticky top-0 z-30 shadow-md flex items-center justify-between gap-3';
  header.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 18px;
    background: #181818;
    border-bottom: 1px solid #2e2e2e;
    position: sticky;
    top: 0;
    z-index: 40;
    gap: 12px;
  `;

  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
      <div style="width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #15803d, #22c55e); display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 10px rgba(34, 197, 94, 0.3); flex-shrink: 0;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L3 6v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V6l-9-4z"></path>
          <path d="m9 12 2 2 4-4"></path>
        </svg>
      </div>
      <div style="min-width: 0;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <h1 style="font-size: 19px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em; margin: 0;">Meshenger</h1>
          <span style="font-size: 11px; font-weight: 600; background: #22c55e25; color: #4ade80; border: 1px solid #22c55e40; padding: 1px 7px; border-radius: 9999px;">P2P Mesh</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px #22c55e;"></span>
          <span id="header-node-status">Listening :${settings.listenPort} • ${settings.activeAddresses[0] || 'Local'}</span>
        </div>
      </div>
    </div>

    <!-- Quick action buttons -->
    <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
      <button id="btn-simulate-call" title="Simulate incoming call to test ringtone and WebRTC video" style="
        display: flex; align-items: center; gap: 6px; padding: 7px 12px; background: #1e3a2b; color: #86efac; border: 1px solid #22c55e50; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
      ">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
        <span class="btn-text">Test Call</span>
      </button>

      <button id="btn-show-my-qr" title="Show My Contact QR Code" style="
        display: flex; align-items: center; gap: 6px; padding: 7px 12px; background: #242424; color: #fff; border: 1px solid #3a3a3a; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer;
      ">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect width="6" height="6" x="3" y="3" rx="1"/><rect width="6" height="6" x="15" y="3" rx="1"/><rect width="6" height="6" x="3" y="15" rx="1"/><path d="M15 15h2v2h-2z"/><path d="M19 15v4h-4"/>
        </svg>
        <span class="btn-text">My QR</span>
      </button>

      <button id="btn-scan-qr" title="Scan Contact QR Code with Camera or File" style="
        display: flex; align-items: center; gap: 6px; padding: 7px 12px; background: #22c55e; color: #000; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 8px rgba(34, 197, 94, 0.3);
      ">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
        </svg>
        <span class="btn-text">Scan</span>
      </button>

      <button id="btn-settings" title="Settings" style="
        padding: 8px; background: #242424; color: #ccc; border: 1px solid #3a3a3a; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer;
      ">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>

      <button id="btn-about" title="About Meshenger" style="
        padding: 8px; background: #242424; color: #ccc; border: 1px solid #3a3a3a; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer;
      ">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
        </svg>
      </button>
    </div>
  `;

  // Bind event listeners
  header.querySelector('#btn-simulate-call')?.addEventListener('click', handlers.onSimulateCall);
  header.querySelector('#btn-show-my-qr')?.addEventListener('click', handlers.onShowMyQR);
  header.querySelector('#btn-scan-qr')?.addEventListener('click', handlers.onScanQR);
  header.querySelector('#btn-settings')?.addEventListener('click', handlers.onSettings);
  header.querySelector('#btn-about')?.addEventListener('click', handlers.onAbout);

  return header;
}
