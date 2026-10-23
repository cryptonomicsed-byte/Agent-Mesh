import { Contact, ActiveCallState, CallStats, InCallChatMessage } from '../types';
import { callManager } from '../services/callManager';

export function createCallScreen(): {
  element: HTMLElement;
  updateState: (state: ActiveCallState, contact: Contact | null) => void;
  updateMedia: (localStream: MediaStream | null, remoteStream: MediaStream | null) => void;
  updateStats: (stats: CallStats) => void;
  addChatMessage: (msg: InCallChatMessage) => void;
} {
  const overlay = document.createElement('div');
  overlay.id = 'call-screen-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: #0d0d0d;
    z-index: 1000;
    display: none;
    flex-direction: column;
    overflow: hidden;
  `;

  let timerInterval: number | null = null;
  let showStats = false;
  let showChat = false;
  let isSwapped = false;

  overlay.innerHTML = `
    <!-- Top Header Bar -->
    <div id="call-header" style="
      position: absolute; top: 0; left: 0; right: 0; padding: 18px 20px; z-index: 20;
      background: linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%);
      display: flex; align-items: center; justify-content: space-between;
    ">
      <div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <h2 id="call-contact-name" style="font-size: 20px; font-weight: 700; color: #fff; margin: 0;">Contact Name</h2>
          <span id="call-encryption-badge" style="font-size: 11px; background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4); padding: 2px 7px; border-radius: 9999px; display: flex; align-items: center; gap: 4px;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 5a3 3 0 0 1 6 0v3H9V7z"/></svg>
            End-to-End Encrypted
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 13px;">
          <svg id="call-status-spinner" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round" class="call-state-ring-connecting" style="display: none;"><path d="M12 2a10 10 0 0 1 10 10" /></svg>
          <span id="call-status-text" style="color: #4ade80; font-weight: 600;">Connecting…</span>
          <span id="call-duration-timer" style="color: #aaa; font-family: monospace; display: none;">00:00</span>
          <span id="call-address-text" class="font-mono" style="color: #888; font-size: 12px;"></span>
        </div>
      </div>

      <!-- Quick toggles on top right -->
      <div style="display: flex; align-items: center; gap: 8px;">
        <button id="btn-toggle-stats" title="Toggle Live Call Statistics HUD" style="
          padding: 8px 12px; background: rgba(30,30,30,0.7); border: 1px solid #444; border-radius: 8px; color: #eee; font-size: 12px; display: flex; align-items: center; gap: 6px; cursor: pointer; backdrop-filter: blur(8px);
        ">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
          Stats
        </button>
        <button id="btn-toggle-chat" title="In-Call P2P Chat" style="
          padding: 8px 12px; background: rgba(30,30,30,0.7); border: 1px solid #444; border-radius: 8px; color: #eee; font-size: 12px; display: flex; align-items: center; gap: 6px; cursor: pointer; backdrop-filter: blur(8px);
        ">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>
          Chat
        </button>
      </div>
    </div>

    <!-- Live Call Statistics HUD -->
    <div id="call-stats-hud" style="
      position: absolute; top: 80px; left: 20px; z-index: 25; background: rgba(15, 15, 15, 0.85); border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 10px 14px; font-size: 12px; color: #ddd; font-family: monospace; line-height: 1.6; backdrop-filter: blur(10px); display: none; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    ">
      <div style="font-weight: 700; color: #4ade80; margin-bottom: 4px; border-bottom: 1px solid #333; padding-bottom: 2px;">WEBRTC PEER STATS</div>
      <div>Resolution: <span id="stat-res">1280x720</span></div>
      <div>Video Bitrate: <span id="stat-vbit">1.4 Mbps</span></div>
      <div>Audio Bitrate: <span id="stat-abit">64 kbps (Opus)</span></div>
      <div>Round Trip Time: <span id="stat-rtt">24 ms</span></div>
      <div>Packets Lost: <span id="stat-lost">0</span></div>
      <div>Security: <span style="color: #4ade80;">DTLS-SRTP / Ed25519</span></div>
    </div>

    <!-- Video Stage -->
    <div id="video-stage" style="position: relative; width: 100%; height: 100%; flex: 1; display: flex; align-items: center; justify-content: center; background: #000;">
      <!-- Remote Video (Fullscreen Feed) -->
      <video id="remote-video" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>

      <!-- Center Avatar placeholder when video is off -->
      <div id="audio-avatar-card" style="
        position: absolute; display: none; flex-direction: column; align-items: center; gap: 16px;
      ">
        <div id="avatar-pulse-circle" class="animate-pulse-ring" style="
          width: 120px; height: 120px; border-radius: 50%; background: #166534; display: flex; align-items: center; justify-content: center; font-size: 48px; font-weight: 700; color: #fff; box-shadow: 0 0 35px rgba(34, 197, 94, 0.4);
        ">
          A
        </div>
        <div style="text-align: center;">
          <h3 id="audio-contact-name" style="font-size: 22px; font-weight: 700; color: #fff;">Contact</h3>
          <p id="audio-sub-status" style="font-size: 14px; color: #888; margin-top: 4px;">Direct Voice Channel</p>
        </div>
      </div>

      <!-- Local Video PiP (Corner thumbnail) -->
      <div id="local-pip-container" style="
        position: absolute; bottom: 110px; right: 20px; width: 150px; height: 210px; border-radius: 14px; overflow: hidden; border: 2px solid #444; background: #181818; box-shadow: 0 8px 24px rgba(0,0,0,0.6); z-index: 30; cursor: pointer; transition: all 0.2s ease;
      " title="Click to swap feeds">
        <video id="local-video" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover;"></video>
        <div style="position: absolute; bottom: 6px; left: 8px; font-size: 10px; background: rgba(0,0,0,0.6); color: #ccc; padding: 2px 6px; border-radius: 4px;">
          You
        </div>
      </div>
    </div>

    <!-- In-Call P2P Chat Drawer (Slide-out panel) -->
    <div id="call-chat-drawer" style="
      position: absolute; top: 0; right: 0; bottom: 0; width: 340px; background: rgba(20, 20, 20, 0.95); border-left: 1px solid #333; z-index: 35; display: none; flex-direction: column; backdrop-filter: blur(12px); box-shadow: -10px 0 30px rgba(0,0,0,0.5);
    ">
      <div style="padding: 16px; border-bottom: 1px solid #333; display: flex; align-items: center; justify-content: space-between;">
        <div style="font-weight: 700; font-size: 15px; color: #fff;">In-Call P2P Chat</div>
        <button id="btn-close-chat" style="padding: 4px; color: #aaa; cursor: pointer;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div id="chat-messages-container" style="flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px;">
        <!-- Chat bubbles appear here -->
      </div>
      <form id="call-chat-form" style="padding: 12px; border-top: 1px solid #333; display: flex; gap: 8px;">
        <input id="call-chat-input" type="text" placeholder="Encrypted message…" style="flex: 1; padding: 8px 12px; background: #262626; border: 1px solid #444; border-radius: 8px; color: #fff; font-size: 13px;" />
        <button type="submit" style="padding: 8px 14px; background: #22c55e; color: #000; font-weight: 600; border-radius: 8px; cursor: pointer;">Send</button>
      </form>
    </div>

    <!-- Incoming Call Ringing Action Card (When receiving a call) -->
    <div id="incoming-ring-card" style="
      position: absolute; bottom: 40px; left: 50%; transform: translateX(-50%); width: 90%; max-width: 440px; background: #1f1f1f; border: 1px solid #383838; border-radius: 20px; padding: 24px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); z-index: 45; display: none; flex-direction: column; align-items: center; text-align: center; gap: 18px;
    ">
      <div style="font-size: 15px; color: #4ade80; font-weight: 600;">Incoming Call via Mesh…</div>
      <div id="incoming-contact-name" style="font-size: 22px; font-weight: 700; color: #fff;">Caller</div>
      <div id="incoming-address" class="font-mono" style="font-size: 12px; color: #888;"></div>
      <div style="display: flex; align-items: center; justify-content: center; gap: 40px; width: 100%; margin-top: 10px;">
        <!-- Decline button -->
        <button id="btn-incoming-decline" style="
          display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: pointer;
        ">
          <div style="width: 64px; height: 64px; border-radius: 50%; background: #ef4444; display: flex; align-items: center; justify-content: center; color: #fff; box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="22" y1="2" x2="2" y2="22"/></svg>
          </div>
          <span style="font-size: 13px; color: #aaa; font-weight: 500;">Decline</span>
        </button>

        <!-- Accept button -->
        <button id="btn-incoming-accept" style="
          display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: pointer;
        ">
          <div style="width: 64px; height: 64px; border-radius: 50%; background: #22c55e; display: flex; align-items: center; justify-content: center; color: #000; box-shadow: 0 4px 15px rgba(34, 197, 94, 0.4);">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          </div>
          <span style="font-size: 13px; color: #4ade80; font-weight: 600;">Answer</span>
        </button>
      </div>
    </div>

    <!-- Active Call Controls Footer Toolbar -->
    <div id="call-controls-bar" style="
      position: absolute; bottom: 0; left: 0; right: 0; padding: 20px 24px 30px; z-index: 20;
      background: linear-gradient(0deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 100%);
      display: flex; align-items: center; justify-content: center; gap: 18px; flex-wrap: wrap;
    ">
      <!-- Mute Mic Button -->
      <button id="btn-toggle-mic" title="Mute Microphone" style="
        width: 52px; height: 52px; border-radius: 50%; background: #262626; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease;
      ">
        <svg id="icon-mic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
      </button>

      <!-- Toggle Camera Button -->
      <button id="btn-toggle-cam" title="Toggle Camera" style="
        width: 52px; height: 52px; border-radius: 50%; background: #262626; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease;
      ">
        <svg id="icon-cam" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/></svg>
      </button>

      <!-- Toggle Speaker Button -->
      <button id="btn-toggle-speaker" title="Speakerphone" style="
        width: 52px; height: 52px; border-radius: 50%; background: #262626; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease;
      ">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
      </button>

      <!-- End Call Hangup Button -->
      <button id="btn-hangup" title="End Call" style="
        width: 64px; height: 64px; border-radius: 50%; background: #ef4444; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 18px rgba(239, 68, 68, 0.45); transition: transform 0.15s ease;
      ">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="22" y1="2" x2="2" y2="22"/></svg>
      </button>
    </div>
  `;

  // Elements
  const contactNameEl = overlay.querySelector('#call-contact-name') as HTMLElement;
  const statusTextEl = overlay.querySelector('#call-status-text') as HTMLElement;
  const statusSpinnerEl = overlay.querySelector('#call-status-spinner') as HTMLElement;
  const durationTimerEl = overlay.querySelector('#call-duration-timer') as HTMLElement;
  const addressTextEl = overlay.querySelector('#call-address-text') as HTMLElement;
  const remoteVideo = overlay.querySelector('#remote-video') as HTMLVideoElement;
  const localVideo = overlay.querySelector('#local-video') as HTMLVideoElement;
  const audioAvatarCard = overlay.querySelector('#audio-avatar-card') as HTMLElement;
  const audioContactName = overlay.querySelector('#audio-contact-name') as HTMLElement;
  const incomingRingCard = overlay.querySelector('#incoming-ring-card') as HTMLElement;
  const incomingContactName = overlay.querySelector('#incoming-contact-name') as HTMLElement;
  const incomingAddress = overlay.querySelector('#incoming-address') as HTMLElement;
  const callControlsBar = overlay.querySelector('#call-controls-bar') as HTMLElement;
  const callStatsHud = overlay.querySelector('#call-stats-hud') as HTMLElement;
  const chatDrawer = overlay.querySelector('#call-chat-drawer') as HTMLElement;
  const chatMessagesContainer = overlay.querySelector('#chat-messages-container') as HTMLElement;
  const chatForm = overlay.querySelector('#call-chat-form') as HTMLFormElement;
  const chatInput = overlay.querySelector('#call-chat-input') as HTMLInputElement;

  // Toggle Mute
  const btnToggleMic = overlay.querySelector('#btn-toggle-mic') as HTMLButtonElement;
  btnToggleMic.addEventListener('click', () => {
    const isMuted = callManager.toggleMute();
    btnToggleMic.style.background = isMuted ? '#ef4444' : '#262626';
    btnToggleMic.innerHTML = isMuted
      ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`
      : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`;
  });

  // Toggle Camera
  const btnToggleCam = overlay.querySelector('#btn-toggle-cam') as HTMLButtonElement;
  btnToggleCam.addEventListener('click', () => {
    const isCamOff = callManager.toggleCamera();
    btnToggleCam.style.background = isCamOff ? '#ef4444' : '#262626';
    localVideo.style.display = isCamOff ? 'none' : 'block';
  });

  // Hangup
  overlay.querySelector('#btn-hangup')?.addEventListener('click', () => {
    callManager.endCall();
  });

  // Incoming accept / decline
  overlay.querySelector('#btn-incoming-accept')?.addEventListener('click', () => {
    callManager.acceptCall();
  });
  overlay.querySelector('#btn-incoming-decline')?.addEventListener('click', () => {
    callManager.endCall('incoming_missed');
  });

  // Toggle Stats
  overlay.querySelector('#btn-toggle-stats')?.addEventListener('click', () => {
    showStats = !showStats;
    callStatsHud.style.display = showStats ? 'block' : 'none';
  });

  // Toggle Chat
  overlay.querySelector('#btn-toggle-chat')?.addEventListener('click', () => {
    showChat = !showChat;
    chatDrawer.style.display = showChat ? 'flex' : 'none';
  });
  overlay.querySelector('#btn-close-chat')?.addEventListener('click', () => {
    showChat = false;
    chatDrawer.style.display = 'none';
  });

  // Swap video feeds
  overlay.querySelector('#local-pip-container')?.addEventListener('click', () => {
    isSwapped = !isSwapped;
    if (isSwapped) {
      remoteVideo.srcObject = callManager.getLocalStream();
      localVideo.srcObject = callManager.getRemoteStream();
    } else {
      remoteVideo.srcObject = callManager.getRemoteStream();
      localVideo.srcObject = callManager.getLocalStream();
    }
  });

  // Chat submit
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (text) {
      callManager.sendChatMessage(text);
      chatInput.value = '';
    }
  });

  function startDurationTimer() {
    if (timerInterval) clearInterval(timerInterval);
    durationTimerEl.style.display = 'inline-block';
    timerInterval = window.setInterval(() => {
      const sec = callManager.getCallDuration();
      const m = Math.floor(sec / 60).toString().padStart(2, '0');
      const s = (sec % 60).toString().padStart(2, '0');
      durationTimerEl.textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopDurationTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    durationTimerEl.style.display = 'none';
  }

  return {
    element: overlay,
    updateState: (state: ActiveCallState, contact: Contact | null) => {
      if (state === 'idle') {
        overlay.style.display = 'none';
        stopDurationTimer();
        return;
      }

      overlay.style.display = 'flex';
      const name = contact ? contact.name : 'Peer Node';
      const addr = contact?.addresses[0] || '192.168.1.105:10008';

      contactNameEl.textContent = name;
      audioContactName.textContent = name;
      addressTextEl.textContent = addr;
      incomingContactName.textContent = name;
      incomingAddress.textContent = addr;

      // Spinner shows during any transitional state (calling/ringing) and hides once
      // the call lands on a terminal-ish state (connected/ended), giving a clear
      // "working on it" -> "done" visual beat instead of text-only state changes.
      if (state === 'ringing' || state === 'calling') {
        statusSpinnerEl.style.display = 'inline-block';
      } else {
        statusSpinnerEl.style.display = 'none';
      }

      if (state === 'ringing') {
        if (callManager.getIsIncoming()) {
          incomingRingCard.style.display = 'flex';
          callControlsBar.style.display = 'none';
          statusTextEl.textContent = 'Incoming Call…';
          statusTextEl.style.color = '#4ade80';
        } else {
          incomingRingCard.style.display = 'none';
          callControlsBar.style.display = 'flex';
          statusTextEl.textContent = 'Ringing…';
          statusTextEl.style.color = '#4ade80';
        }
      } else if (state === 'calling') {
        incomingRingCard.style.display = 'none';
        callControlsBar.style.display = 'flex';
        statusTextEl.textContent = 'Calling…';
        statusTextEl.style.color = '#4ade80';
      } else if (state === 'connected') {
        incomingRingCard.style.display = 'none';
        callControlsBar.style.display = 'flex';
        statusTextEl.textContent = 'Connected';
        statusTextEl.style.color = '#4ade80';
        startDurationTimer();

        if (!callManager.getHasVideo()) {
          audioAvatarCard.style.display = 'flex';
          remoteVideo.style.display = 'none';
        } else {
          audioAvatarCard.style.display = 'none';
          remoteVideo.style.display = 'block';
        }
      } else if (state === 'ended') {
        statusTextEl.textContent = 'Call Ended';
        statusTextEl.style.color = '#ef4444';
        stopDurationTimer();
      }
    },
    updateMedia: (localStream: MediaStream | null, remoteStream: MediaStream | null) => {
      if (localStream) {
        localVideo.srcObject = localStream;
      }
      if (remoteStream) {
        remoteVideo.srcObject = remoteStream;
      }
    },
    updateStats: (stats: CallStats) => {
      const resEl = overlay.querySelector('#stat-res');
      const vbitEl = overlay.querySelector('#stat-vbit');
      const abitEl = overlay.querySelector('#stat-abit');
      const rttEl = overlay.querySelector('#stat-rtt');
      const lostEl = overlay.querySelector('#stat-lost');

      if (resEl && stats.resolution) resEl.textContent = stats.resolution;
      if (vbitEl && stats.videoBitrate) vbitEl.textContent = stats.videoBitrate;
      if (abitEl && stats.audioBitrate) abitEl.textContent = stats.audioBitrate;
      if (rttEl && stats.rtt !== undefined) rttEl.textContent = `${stats.rtt} ms`;
      if (lostEl && stats.packetsLost !== undefined) lostEl.textContent = `${stats.packetsLost}`;
    },
    addChatMessage: (msg: InCallChatMessage) => {
      const bubble = document.createElement('div');
      const isSelf = msg.sender === 'self';
      bubble.style.cssText = `
        align-self: ${isSelf ? 'flex-end' : 'flex-start'};
        background: ${isSelf ? '#22c55e' : '#2b2b2b'};
        color: ${isSelf ? '#000' : '#fff'};
        font-weight: ${isSelf ? '500' : '400'};
        padding: 8px 12px;
        border-radius: 12px;
        max-width: 85%;
        font-size: 13px;
        word-break: break-word;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      `;
      bubble.textContent = msg.text;
      chatMessagesContainer.appendChild(bubble);
      chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    },
  };
}
