import { CallEvent, Contact } from '../types';

export function createCallHistory(
  events: CallEvent[],
  contacts: Contact[],
  handlers: {
    onCallBack: (contact: Contact, video: boolean) => void;
    onClearHistory: () => void;
  }
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'call-history-container';
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    max-width: 800px;
    margin: 0 auto;
    width: 100%;
  `;

  // Toolbar
  const headerBar = document.createElement('div');
  headerBar.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1px solid #282828;
  `;
  headerBar.innerHTML = `
    <div>
      <h2 style="font-size: 16px; font-weight: 700; color: #fff; margin: 0;">Call History & Events</h2>
      <p style="font-size: 12px; color: #888; margin-top: 2px;">Peer-to-peer call records stored locally on your device</p>
    </div>
    ${
      events.length > 0
        ? `<button id="btn-clear-history" style="font-size: 12px; color: #f87171; background: #ef444415; border: 1px solid #ef444430; padding: 6px 12px; border-radius: 8px; font-weight: 600; cursor: pointer;">
            Clear History
          </button>`
        : ''
    }
  `;

  headerBar.querySelector('#btn-clear-history')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all call events?')) {
      handlers.onClearHistory();
    }
  });

  const listElement = document.createElement('div');
  listElement.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 10px;
  `;

  if (events.length === 0) {
    listElement.innerHTML = `
      <div style="text-align: center; padding: 48px 20px; background: #1a1a1a; border-radius: 16px; border: 1px dashed #333;">
        <div style="width: 52px; height: 52px; margin: 0 auto 16px; border-radius: 50%; background: #262626; display: flex; align-items: center; justify-content: center; color: #888;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        </div>
        <h3 style="font-size: 16px; font-weight: 600; color: #eee; margin-bottom: 6px;">No call events yet</h3>
        <p style="font-size: 13px; color: #888; max-width: 340px; margin: 0 auto;">
          Calls made or received with contacts over the mesh network will show up here.
        </p>
      </div>
    `;
  } else {
    events.forEach((event) => {
      const card = document.createElement('div');
      card.style.cssText = `
        background: #1c1c1c;
        border: 1px solid #2b2b2b;
        border-radius: 14px;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      `;

      const isIncoming = event.type.startsWith('incoming');
      const isMissed = event.type.includes('missed') || event.type.includes('declined');
      const isError = event.type.includes('error');

      let iconColor = '#22c55e';
      let iconSvg = '';
      let typeLabel = '';

      if (event.type === 'incoming_accepted') {
        iconColor = '#22c55e';
        typeLabel = 'Incoming call';
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5"><line x1="7" y1="7" x2="17" y2="17"></line><polyline points="17 7 17 17 7 17"></polyline></svg>`;
      } else if (event.type === 'incoming_missed') {
        iconColor = '#ef4444';
        typeLabel = 'Missed call';
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5"><line x1="7" y1="7" x2="17" y2="17"></line><polyline points="17 7 17 17 7 17"></polyline></svg>`;
      } else if (event.type === 'outgoing_accepted') {
        iconColor = '#3b82f6';
        typeLabel = 'Outgoing call';
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5"><line x1="17" y1="17" x2="7" y2="7"></line><polyline points="7 17 7 7 17 7"></polyline></svg>`;
      } else if (event.type === 'outgoing_missed') {
        iconColor = '#f59e0b';
        typeLabel = 'Cancelled / No answer';
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5"><line x1="17" y1="17" x2="7" y2="7"></line><polyline points="7 17 7 7 17 7"></polyline></svg>`;
      } else {
        iconColor = '#ef4444';
        typeLabel = 'Call error';
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
      }

      // Duration formatting
      const formatDuration = (sec: number) => {
        if (!sec || sec <= 0) return '0s';
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
      };

      // Date formatting
      const dateStr = new Date(event.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const dayStr = new Date(event.timestamp).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
      });

      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
          <div style="
            width: 38px; height: 38px; border-radius: 10px; background: ${iconColor}15; border: 1px solid ${iconColor}30;
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          ">
            ${iconSvg}
          </div>
          <div style="min-width: 0; flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span style="font-weight: 600; font-size: 14px; color: ${isMissed ? '#fca5a5' : '#fff'};">
                ${event.contactName}
              </span>
              <span style="font-size: 11px; color: ${iconColor};">
                ${typeLabel}
              </span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #777; margin-top: 3px; flex-wrap: wrap;">
              <span>${dayStr} at ${dateStr}</span>
              ${event.duration > 0 ? `<span>• Duration: ${formatDuration(event.duration)}</span>` : ''}
              ${event.addressUsed ? `<span class="font-mono" style="color: #6ee7b7; font-size: 11px;">${event.addressUsed}</span>` : ''}
            </div>
          </div>
        </div>

        <button class="btn-call-back" style="
          padding: 7px 12px; background: #22c55e15; border: 1px solid #22c55e35; color: #4ade80; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; flex-shrink: 0;
        ">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          Call
        </button>
      `;

      card.querySelector('.btn-call-back')?.addEventListener('click', () => {
        const contact = contacts.find(
          (c) => c.publicKey.toLowerCase() === event.contactPublicKey.toLowerCase()
        ) || {
          name: event.contactName,
          publicKey: event.contactPublicKey,
          addresses: event.addressUsed ? [event.addressUsed] : ['192.168.1.1:10008'],
          state: 'online',
        };
        handlers.onCallBack(contact, event.hasVideo ?? true);
      });

      listElement.appendChild(card);
    });
  }

  container.appendChild(headerBar);
  container.appendChild(listElement);

  return container;
}
