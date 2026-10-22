import { Contact } from '../types';
import { formatFingerprint } from '../services/crypto';

export function createContactList(
  contacts: Contact[],
  handlers: {
    onAudioCall: (contact: Contact) => void;
    onVideoCall: (contact: Contact) => void;
    onAddContact: () => void;
    onShowContactQR: (contact: Contact) => void;
    onDeleteContact: (publicKey: string) => void;
    onToggleBlock: (publicKey: string) => void;
    onPingContact: (contact: Contact) => void;
  }
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'contact-list-container';
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    max-width: 800px;
    margin: 0 auto;
    width: 100%;
  `;

  // Search & Toolbar bar
  const toolbar = document.createElement('div');
  toolbar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 12px;
    justify-content: space-between;
    flex-wrap: wrap;
  `;

  toolbar.innerHTML = `
    <div style="position: relative; flex: 1; min-width: 240px;">
      <svg style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #777;" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
      </svg>
      <input id="contact-search-input" type="text" placeholder="Search contacts by name, IP, or key…" style="
        width: 100%;
        padding: 9px 12px 9px 38px;
        background: #1e1e1e;
        border: 1px solid #333;
        border-radius: 10px;
        color: #fff;
        font-size: 14px;
      " />
    </div>
    <div style="display: flex; align-items: center; gap: 8px;">
      <button id="btn-add-contact-manual" style="
        display: flex; align-items: center; gap: 6px; padding: 9px 16px; background: #22c55e; color: #000; border-radius: 10px; font-weight: 600; font-size: 13px; box-shadow: 0 2px 10px rgba(34, 197, 94, 0.25);
      ">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
        Add Contact
      </button>
    </div>
  `;

  const listElement = document.createElement('div');
  listElement.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 10px;
  `;

  function renderList(filtered: Contact[]) {
    listElement.innerHTML = '';

    if (filtered.length === 0) {
      listElement.innerHTML = `
        <div style="text-align: center; padding: 48px 20px; background: #1a1a1a; border-radius: 16px; border: 1px dashed #333;">
          <div style="width: 52px; height: 52px; margin: 0 auto 16px; border-radius: 50%; background: #262626; display: flex; align-items: center; justify-content: center; color: #888;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <h3 style="font-size: 16px; font-weight: 600; color: #eee; margin-bottom: 6px;">No contacts found</h3>
          <p style="font-size: 13px; color: #888; max-width: 380px; margin: 0 auto 20px;">
            Meshenger has no centralized directory. Exchange contact QR codes in person or add an IP address directly.
          </p>
          <button id="btn-empty-add" style="padding: 8px 18px; background: #22c55e; color: #000; font-weight: 600; border-radius: 8px; font-size: 13px;">Add New Contact</button>
        </div>
      `;
      listElement.querySelector('#btn-empty-add')?.addEventListener('click', handlers.onAddContact);
      return;
    }

    filtered.forEach((contact) => {
      const card = document.createElement('div');
      card.style.cssText = `
        background: #1c1c1c;
        border: 1px solid #2b2b2b;
        border-radius: 14px;
        padding: 14px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        transition: transform 0.15s ease, border-color 0.15s ease;
      `;
      card.addEventListener('mouseenter', () => (card.style.borderColor = '#3d3d3d'));
      card.addEventListener('mouseleave', () => (card.style.borderColor = '#2b2b2b'));

      const isBlocked = contact.blocked;
      const stateColor = isBlocked ? '#ef4444' : contact.state === 'online' ? '#22c55e' : '#737373';
      const stateText = isBlocked ? 'Blocked' : contact.state === 'online' ? 'Online' : 'Offline';

      // Hash color for avatar
      const colors = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#db2777', '#0891b2'];
      const avatarColor = colors[Math.abs(contact.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) % colors.length];

      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1;">
          <!-- Avatar -->
          <div style="position: relative; flex-shrink: 0;">
            <div style="
              width: 44px; height: 44px; border-radius: 50%; background: ${avatarColor};
              display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 17px; color: #fff;
              box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            ">
              ${contact.name.slice(0, 1).toUpperCase()}
            </div>
            <span style="
              position: absolute; bottom: 0; right: 0; width: 12px; height: 12px; border-radius: 50%;
              background: ${stateColor}; border: 2px solid #1c1c1c;
            " title="${stateText}"></span>
          </div>

          <!-- Info -->
          <div style="min-width: 0; flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span style="font-weight: 600; font-size: 15px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${contact.name}
              </span>
              <span style="font-size: 11px; padding: 1px 6px; border-radius: 4px; background: ${stateColor}20; color: ${stateColor}; border: 1px solid ${stateColor}40;">
                ${stateText}
              </span>
            </div>

            <!-- Addresses & Fingerprint -->
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 12px; color: #888; flex-wrap: wrap;">
              <span class="font-mono" style="color: #6ee7b7; background: #064e3b30; padding: 1px 6px; border-radius: 4px; border: 1px solid #064e3b60;">
                ${contact.addresses[0] || 'No IP configured'}
              </span>
              ${contact.addresses.length > 1 ? `<span style="font-size: 11px; color: #888;">+${contact.addresses.length - 1} more</span>` : ''}
              <span class="font-mono" style="font-size: 11px; color: #666;" title="Identity Fingerprint: ${formatFingerprint(contact.publicKey)}">
                FP: ${contact.publicKey.slice(0, 8)}…
              </span>
            </div>
          </div>
        </div>

        <!-- Action buttons -->
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          <!-- Audio Call Button -->
          <button class="btn-audio-call" title="Voice Call" style="
            width: 38px; height: 38px; border-radius: 10px; background: #16653420; color: #4ade80; border: 1px solid #22c55e40;
            display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease;
          ">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
          </button>

          <!-- Video Call Button -->
          <button class="btn-video-call" title="Video Call" style="
            width: 38px; height: 38px; border-radius: 10px; background: #22c55e; color: #000;
            display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; box-shadow: 0 2px 8px rgba(34, 197, 94, 0.25);
          ">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
              <path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>
            </svg>
          </button>

          <!-- Contact More Menu Trigger -->
          <button class="btn-contact-more" title="More Options" style="
            width: 34px; height: 34px; border-radius: 8px; background: transparent; color: #888;
            display: flex; align-items: center; justify-content: center; cursor: pointer;
          ">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>
            </svg>
          </button>
        </div>
      `;

      // Event binding
      card.querySelector('.btn-audio-call')?.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.onAudioCall(contact);
      });

      card.querySelector('.btn-video-call')?.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.onVideoCall(contact);
      });

      card.querySelector('.btn-contact-more')?.addEventListener('click', (e) => {
        e.stopPropagation();
        showContactContextMenu(e as MouseEvent, contact, handlers);
      });

      listElement.appendChild(card);
    });
  }

  // Hook up search filter
  toolbar.querySelector('#contact-search-input')?.addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase().trim();
    const filtered = contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.publicKey.toLowerCase().includes(q) ||
        c.addresses.some((a) => a.toLowerCase().includes(q))
    );
    renderList(filtered);
  });

  toolbar.querySelector('#btn-add-contact-manual')?.addEventListener('click', handlers.onAddContact);

  container.appendChild(toolbar);
  container.appendChild(listElement);

  renderList(contacts);

  return container;
}

function showContactContextMenu(
  event: MouseEvent,
  contact: Contact,
  handlers: {
    onShowContactQR: (contact: Contact) => void;
    onDeleteContact: (publicKey: string) => void;
    onToggleBlock: (publicKey: string) => void;
    onPingContact: (contact: Contact) => void;
  }
) {
  // Remove existing menu if any
  document.querySelectorAll('.contact-context-menu').forEach((el) => el.remove());

  const menu = document.createElement('div');
  menu.className = 'contact-context-menu';
  menu.style.cssText = `
    position: fixed;
    top: ${Math.min(event.clientY, window.innerHeight - 240)}px;
    left: ${Math.min(event.clientX, window.innerWidth - 220)}px;
    background: #242424;
    border: 1px solid #383838;
    border-radius: 12px;
    padding: 6px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    z-index: 100;
    min-width: 190px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  `;

  menu.innerHTML = `
    <button id="menu-qr" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; color: #eee; font-size: 13px; text-align: left; width: 100%; border-radius: 6px;">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="6" height="6" x="3" y="3" rx="1"/><rect width="6" height="6" x="15" y="3" rx="1"/><rect width="6" height="6" x="3" y="15" rx="1"/></svg>
      Show Contact QR
    </button>
    <button id="menu-ping" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; color: #eee; font-size: 13px; text-align: left; width: 100%; border-radius: 6px;">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12h5l3 7 4-14 3 7h5"/></svg>
      Ping Address
    </button>
    <button id="menu-block" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; color: ${contact.blocked ? '#4ade80' : '#f87171'}; font-size: 13px; text-align: left; width: 100%; border-radius: 6px;">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>
      ${contact.blocked ? 'Unblock Contact' : 'Block Contact'}
    </button>
    <div style="height: 1px; background: #333; margin: 4px 0;"></div>
    <button id="menu-delete" style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; color: #ef4444; font-size: 13px; text-align: left; width: 100%; border-radius: 6px;">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      Delete Contact
    </button>
  `;

  menu.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('mouseenter', () => (btn.style.background = '#333'));
    btn.addEventListener('mouseleave', () => (btn.style.background = 'transparent'));
  });

  menu.querySelector('#menu-qr')?.addEventListener('click', () => {
    menu.remove();
    handlers.onShowContactQR(contact);
  });

  menu.querySelector('#menu-ping')?.addEventListener('click', () => {
    menu.remove();
    handlers.onPingContact(contact);
  });

  menu.querySelector('#menu-block')?.addEventListener('click', () => {
    menu.remove();
    handlers.onToggleBlock(contact.publicKey);
  });

  menu.querySelector('#menu-delete')?.addEventListener('click', () => {
    menu.remove();
    if (confirm(`Delete ${contact.name} from your contacts?`)) {
      handlers.onDeleteContact(contact.publicKey);
    }
  });

  document.body.appendChild(menu);

  // Close when clicked outside
  const closeMenu = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      window.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => window.addEventListener('click', closeMenu), 10);
}
