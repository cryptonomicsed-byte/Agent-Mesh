import { storage } from './services/storage';
import { callManager } from './services/callManager';
import { Contact } from './types';
import { createHeader } from './components/Header';
import { createContactList } from './components/ContactList';
import { createCallHistory } from './components/CallHistory';
import { createCallScreen } from './components/CallScreen';
import {
  showMyQRModal,
  showScanQRModal,
  showAddContactModal,
  showSettingsModal,
  showAboutModal,
} from './components/Modals';

function initApp() {
  const root = document.getElementById('root');
  if (!root) return;

  root.innerHTML = '';
  root.style.cssText = `
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: #121212;
    color: #fff;
    position: relative;
  `;

  let activeTab: 'contacts' | 'history' = 'contacts';
  let settings = storage.getSettings();
  let contacts = storage.getContacts();
  let events = storage.getEvents();

  // Create active call screen overlay
  const callScreen = createCallScreen();
  document.body.appendChild(callScreen.element);

  // Hook CallManager events into CallScreen
  callManager.onStateChange((state, contact) => {
    callScreen.updateState(state, contact);
    if (state === 'ended' || state === 'idle') {
      refreshData();
    }
  });

  callManager.onMediaChange((localStream, remoteStream) => {
    callScreen.updateMedia(localStream, remoteStream);
  });

  callManager.onStatsUpdate((stats) => {
    callScreen.updateStats(stats);
  });

  callManager.onChatMessage((msg) => {
    callScreen.addChatMessage(msg);
  });

  // Main layout container
  const appContainer = document.createElement('div');
  appContainer.style.cssText = `
    display: flex;
    flex-direction: column;
    flex: 1;
    width: 100%;
  `;

  // Header
  const header = createHeader(settings, {
    onShowMyQR: () => showMyQRModal(settings, () => refreshData()),
    onScanQR: () =>
      showScanQRModal((scanned) => {
        showToast(`Added contact: ${scanned.name}`);
        refreshData();
      }),
    onSimulateCall: () => {
      callManager.simulateIncomingCall(contacts[0]);
    },
    onAddressManagement: () => showMyQRModal(settings, () => refreshData()),
    onSettings: () =>
      showSettingsModal(settings, () => {
        settings = storage.getSettings();
        refreshData();
      }),
    onAbout: () => showAboutModal(),
  });

  appContainer.appendChild(header);

  // Banner: Mesh Info & Quick Actions
  const infoBanner = document.createElement('div');
  infoBanner.style.cssText = `
    background: linear-gradient(90deg, #132e1f, #14241b);
    border-bottom: 1px solid #1e452e;
    padding: 10px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    gap: 12px;
    flex-wrap: wrap;
  `;
  infoBanner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5">
        <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14"/>
      </svg>
      <span style="color: #d1fae5;">Direct P2P Mesh Network Mode: <strong>Active</strong></span>
      <span style="color: #6ee7b7; font-size: 11px; background: rgba(34, 197, 94, 0.2); padding: 1px 6px; border-radius: 4px;">Zero Servers</span>
    </div>
    <div style="display: flex; align-items: center; gap: 10px;">
      <button id="btn-banner-test-call" style="
        font-size: 12px; color: #86efac; background: rgba(34, 197, 94, 0.25); border: 1px solid #22c55e60; padding: 4px 10px; border-radius: 6px; font-weight: 600; cursor: pointer;
      ">
        Simulate Incoming Call
      </button>
    </div>
  `;
  infoBanner.querySelector('#btn-banner-test-call')?.addEventListener('click', () => {
    callManager.simulateIncomingCall(contacts[0]);
  });
  appContainer.appendChild(infoBanner);

  // Tab Navigation Bar
  const tabNav = document.createElement('div');
  tabNav.style.cssText = `
    display: flex;
    background: #181818;
    border-bottom: 1px solid #2b2b2b;
    padding: 0 16px;
    max-width: 800px;
    margin: 0 auto;
    width: 100%;
  `;

  function renderTabs() {
    tabNav.innerHTML = `
      <button id="tab-btn-contacts" style="
        padding: 14px 20px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; cursor: pointer;
        color: ${activeTab === 'contacts' ? '#22c55e' : '#888'};
        border-bottom: 2px solid ${activeTab === 'contacts' ? '#22c55e' : 'transparent'};
      ">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Contacts (${contacts.length})
      </button>

      <button id="tab-btn-history" style="
        padding: 14px 20px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; cursor: pointer;
        color: ${activeTab === 'history' ? '#22c55e' : '#888'};
        border-bottom: 2px solid ${activeTab === 'history' ? '#22c55e' : 'transparent'};
      ">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>
        Call History (${events.length})
      </button>
    `;

    tabNav.querySelector('#tab-btn-contacts')?.addEventListener('click', () => {
      activeTab = 'contacts';
      renderTabs();
      renderActiveTab();
    });

    tabNav.querySelector('#tab-btn-history')?.addEventListener('click', () => {
      activeTab = 'history';
      renderTabs();
      renderActiveTab();
    });
  }

  appContainer.appendChild(tabNav);

  // Content Area
  const tabContent = document.createElement('main');
  tabContent.style.cssText = `
    flex: 1;
    display: flex;
    flex-direction: column;
    padding-bottom: 60px;
  `;
  appContainer.appendChild(tabContent);

  function renderActiveTab() {
    tabContent.innerHTML = '';
    contacts = storage.getContacts();
    events = storage.getEvents();

    if (activeTab === 'contacts') {
      const contactList = createContactList(contacts, {
        onAudioCall: (c) => callManager.startCall(c, false),
        onVideoCall: (c) => callManager.startCall(c, true),
        onAddContact: () =>
          showAddContactModal((c) => {
            showToast(`Added contact ${c.name}`);
            refreshData();
          }),
        onShowContactQR: (c) => showMyQRModal({ ...settings, userName: c.name, publicKey: c.publicKey, addresses: c.addresses, activeAddresses: c.addresses }, () => {}),
        onDeleteContact: (key) => {
          storage.deleteContact(key);
          showToast('Contact deleted');
          refreshData();
        },
        onToggleBlock: (key) => {
          storage.toggleBlockContact(key);
          refreshData();
        },
        onPingContact: (c) => {
          showToast(`Pinging ${c.addresses[0] || c.name}… Ping: 18ms (Online)`);
        },
      });
      tabContent.appendChild(contactList);
    } else {
      const historyView = createCallHistory(events, contacts, {
        onCallBack: (c, hasVideo) => callManager.startCall(c, hasVideo),
        onClearHistory: () => {
          storage.clearEvents();
          showToast('Call history cleared');
          refreshData();
        },
      });
      tabContent.appendChild(historyView);
    }
  }

  function refreshData() {
    contacts = storage.getContacts();
    events = storage.getEvents();
    settings = storage.getSettings();

    const statusEl = header.querySelector('#header-node-status');
    if (statusEl) {
      statusEl.textContent = `Listening :${settings.listenPort} • ${settings.activeAddresses[0] || 'Local'}`;
    }

    renderTabs();
    renderActiveTab();
  }

  renderTabs();
  renderActiveTab();

  root.appendChild(appContainer);
}

// Toast notification helper
function showToast(message: string): void {
  const existing = document.getElementById('meshenger-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'meshenger-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: #242424;
    border: 1px solid #3d3d3d;
    color: #fff;
    padding: 10px 18px;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 8px 30px rgba(0,0,0,0.6);
    z-index: 2000;
    display: flex;
    align-items: center;
    gap: 8px;
    animation: pulse-ring 0.3s ease-out;
  `;
  toast.innerHTML = `
    <span style="width: 8px; height: 8px; border-radius: 50%; background: #22c55e;"></span>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

document.addEventListener('DOMContentLoaded', initApp);
