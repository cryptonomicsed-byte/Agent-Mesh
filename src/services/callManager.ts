import { Contact, ActiveCallState, CallStats, InCallChatMessage, CallEvent } from '../types';
import { audioSynth } from './audioSynthesizer';
import { storage } from './storage';
import { NostrRelay, hexToBytes, SignalPayload, DEFAULT_RELAY, sendToRelays } from './nostr';

export type CallStateListener = (state: ActiveCallState, contact: Contact | null) => void;
export type StatsListener = (stats: CallStats) => void;
export type ChatListener = (message: InCallChatMessage) => void;
export type MediaStreamListener = (localStream: MediaStream | null, remoteStream: MediaStream | null) => void;
export type RelayStatusListener = (connected: boolean, url: string) => void;

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

function randomHex(n = 16): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

class CallManager {
  // ── state ──────────────────────────────────────────────────────────────
  private currentState: ActiveCallState = 'idle';
  private currentContact: Contact | null = null;
  private isIncoming = false;
  private hasVideo = true;
  private isMuted = false;
  private isCameraOff = false;
  private isSpeakerOn = true;
  private callStartTime = 0;
  private statsInterval: ReturnType<typeof setInterval> | null = null;

  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;

  // ── real WebRTC ────────────────────────────────────────────────────────
  private pc: RTCPeerConnection | null = null;
  private relay: NostrRelay | null = null;
  private activeCallId: string | null = null;
  private pendingCallerPk: string | null = null;
  private pendingOfferSdp: string | null = null;
  private isSimulated = false;

  // ── ICE restart recovery ───────────────────────────────────────────────
  private iceRestartInProgress = false;
  private iceRestartAttempts = 0;
  private readonly ICE_RESTART_MAX_ATTEMPTS = 3;
  private iceDisconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── listeners ──────────────────────────────────────────────────────────
  private stateListeners: Set<CallStateListener> = new Set();
  private statsListeners: Set<StatsListener> = new Set();
  private chatListeners: Set<ChatListener> = new Set();
  private mediaListeners: Set<MediaStreamListener> = new Set();
  private relayStatusListeners: Set<RelayStatusListener> = new Set();
  private chatMessages: InCallChatMessage[] = [];
  private currentRelayUrl = DEFAULT_RELAY;

  // ── init ───────────────────────────────────────────────────────────────

  /** Connect to the Nostr relay. Safe to call multiple times (reconnects). */
  init(): void {
    if (this.relay) {
      this.relay.disconnect();
      this.relay = null;
    }
    const settings = storage.getSettings();
    this.currentRelayUrl = (settings.nostrRelays ?? [])[0] ?? DEFAULT_RELAY;
    try {
      this.relay = NostrRelay.fromHexSeckey(settings.privateKey, this.currentRelayUrl);
      this.relay.onSignal(({ signal, senderPk }) => this._onIncomingSignal(signal, senderPk));
      this.relay.onStatusChange((connected) => {
        this.relayStatusListeners.forEach(cb => cb(connected, this.currentRelayUrl));
      });
      this.relay.connect();
      console.info('[CallManager] relay connecting →', this.currentRelayUrl);
    } catch (err) {
      console.warn('[CallManager] relay init failed:', err);
    }
  }

  /** Disconnect relay and stop receiving calls (go offline). */
  logout(): void {
    if (this.currentState !== 'idle') this.endCall();
    this.relay?.disconnect();
    this.relay = null;
    this.relayStatusListeners.forEach(cb => cb(false, this.currentRelayUrl));
  }

  // ── accessors ──────────────────────────────────────────────────────────

  getState(): ActiveCallState { return this.currentState; }
  getCurrentContact(): Contact | null { return this.currentContact; }
  getIsIncoming(): boolean { return this.isIncoming; }
  getHasVideo(): boolean { return this.hasVideo; }
  getIsMuted(): boolean { return this.isMuted; }
  getIsCameraOff(): boolean { return this.isCameraOff; }
  getIsSpeakerOn(): boolean { return this.isSpeakerOn; }
  getChatMessages(): InCallChatMessage[] { return [...this.chatMessages]; }
  getLocalStream(): MediaStream | null { return this.localStream; }
  getRemoteStream(): MediaStream | null { return this.remoteStream; }
  getCallDuration(): number {
    return this.callStartTime ? Math.floor((Date.now() - this.callStartTime) / 1000) : 0;
  }

  // ── listener registration ──────────────────────────────────────────────

  onStateChange(cb: CallStateListener): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }
  onStatsUpdate(cb: StatsListener): () => void {
    this.statsListeners.add(cb);
    return () => this.statsListeners.delete(cb);
  }
  onChatMessage(cb: ChatListener): () => void {
    this.chatListeners.add(cb);
    return () => this.chatListeners.delete(cb);
  }
  onMediaChange(cb: MediaStreamListener): () => void {
    this.mediaListeners.add(cb);
    return () => this.mediaListeners.delete(cb);
  }
  onRelayStatus(cb: RelayStatusListener): () => void {
    this.relayStatusListeners.add(cb);
    return () => this.relayStatusListeners.delete(cb);
  }
  getRelayUrl(): string { return this.currentRelayUrl; }
  isRelayConnected(): boolean { return this.relay?.isConnected ?? false; }

  private notifyState(): void {
    this.stateListeners.forEach(cb => cb(this.currentState, this.currentContact));
  }
  private notifyMedia(): void {
    this.mediaListeners.forEach(cb => cb(this.localStream, this.remoteStream));
  }
  private _showCallError(message: string): void {
    const existing = document.getElementById('call-error-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'call-error-toast';
    toast.style.cssText = `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #3d1515; border: 1px solid #7f1d1d; color: #fca5a5;
      padding: 12px 20px; border-radius: 12px; font-size: 13px; font-weight: 500;
      box-shadow: 0 8px 30px rgba(0,0,0,0.6); z-index: 2000;
      display: flex; align-items: center; gap: 10px; max-width: 90vw;
    `;
    toast.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      <span>${message}</span>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  // ── media ──────────────────────────────────────────────────────────────

  private async acquireMedia(video: boolean): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
      });
    } catch (err) {
      console.warn('[CallManager] real media unavailable, using synthetic stream', err);
      return this._syntheticStream(video, 'Me');
    }
  }

  private _syntheticStream(hasVideo: boolean, label: string): MediaStream {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    let frame = 0;
    const draw = () => {
      frame++;
      const g = ctx.createLinearGradient(0, 0, 640, 480);
      g.addColorStop(0, '#1c1917'); g.addColorStop(1, '#0c0a09');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 480);
      ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const r = 30 + i * 25 + Math.sin(frame * 0.05 + i) * 6;
        ctx.beginPath(); ctx.arc(320, 240, r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(320, 240, 48, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(label.slice(0, 2).toUpperCase(), 320, 248);
    };
    const interval = window.setInterval(draw, 1000 / 30);
    const stream = canvas.captureStream(30);
    try {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const dst = ac.createMediaStreamDestination();
      const gain = ac.createGain(); gain.gain.value = 0.001;
      osc.connect(gain); gain.connect(dst); osc.start();
      dst.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    } catch {}
    (stream as any)._interval = interval;
    return stream;
  }

  private _stopStream(stream: MediaStream | null): void {
    if (!stream) return;
    stream.getTracks().forEach(t => t.stop());
    const interval = (stream as any)._interval;
    if (interval) clearInterval(interval);
  }

  // ── WebRTC peer connection ─────────────────────────────────────────────

  private async _fetchTurnCreds(): Promise<RTCIceServer | null> {
    const settings = storage.getSettings();
    // Try in order: configured public URL → local agent-voice sidecar
    const candidates = [
      ...(settings.turnCredsUrl ? [settings.turnCredsUrl] : []),
      'http://127.0.0.1:8788/turn-creds',
    ];
    for (const url of candidates) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
        if (r.ok) return await r.json() as RTCIceServer;
      } catch {}
    }
    return null;
  }

  private async _buildPeerConnection(): Promise<RTCPeerConnection> {
    const iceServers: RTCIceServer[] = [...STUN_SERVERS];

    const turn = await this._fetchTurnCreds();
    if (turn) {
      iceServers.push(turn);
      console.info('[CallManager] TURN server added:', (turn as any).urls?.[0]);
    }

    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;

    pc.onicecandidate = (e) => {
      if (!e.candidate || !this.activeCallId) return;
      const peerPk = this.isIncoming ? this.pendingCallerPk : this.currentContact?.publicKey;
      if (peerPk && this.relay) {
        this.relay.sendSignal(peerPk, {
          type: 'ice',
          call_id: this.activeCallId,
          candidate: e.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (stream && stream !== this.remoteStream) {
        this.remoteStream = stream;
        this.notifyMedia();
        if (this.currentState !== 'connected') {
          this.currentState = 'connected';
          this.callStartTime = Date.now();
          this.notifyState();
          audioSynth.playConnectChime();
          this._startStatsInterval();
        }
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      // 'failed' is handled via oniceconnectionstatechange below, which
      // attempts an ICE restart before giving up. Only react to 'closed'
      // here (explicit teardown) to avoid racing/duplicating that recovery.
      if (s === 'closed') {
        this.endCall(this.currentState === 'connected' ? undefined : 'outgoing_error');
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      console.info('[CallManager] iceConnectionState →', s);
      if (s === 'disconnected') {
        // 'disconnected' is often transient (brief network blip, Wi-Fi/
        // cellular handoff) and can self-heal without intervention. Give it
        // a short grace window before forcing an ICE restart.
        if (this.iceDisconnectTimer) clearTimeout(this.iceDisconnectTimer);
        this.iceDisconnectTimer = setTimeout(() => {
          if (this.pc === pc && pc.iceConnectionState === 'disconnected') {
            void this._attemptIceRestart();
          }
        }, 3000);
      } else if (s === 'failed') {
        if (this.iceDisconnectTimer) { clearTimeout(this.iceDisconnectTimer); this.iceDisconnectTimer = null; }
        void this._attemptIceRestart();
      } else if (s === 'connected' || s === 'completed') {
        if (this.iceDisconnectTimer) { clearTimeout(this.iceDisconnectTimer); this.iceDisconnectTimer = null; }
        this.iceRestartAttempts = 0; // reset backoff once the path is healthy again
      }
    };

    return pc;
  }

  /**
   * Recover from a failed/disconnected ICE path without tearing down the
   * call: create a new offer with iceRestart:true, apply it locally, and
   * re-signal it to the peer over Nostr using the same call_id. The peer's
   * _onIncomingSignal recognizes the matching call_id as a renegotiation
   * (not a new incoming call) and answers it, completing the restart.
   */
  private async _attemptIceRestart(): Promise<void> {
    if (!this.pc || this.isSimulated || !this.activeCallId) return;
    if (this.iceRestartInProgress) return; // one restart cycle in flight at a time
    if (this.currentState !== 'connected') return; // only recover established calls

    if (this.iceRestartAttempts >= this.ICE_RESTART_MAX_ATTEMPTS) {
      console.warn('[CallManager] ICE restart attempts exhausted, ending call');
      this.endCall(this.isIncoming ? 'incoming_error' : 'outgoing_error');
      return;
    }

    this.iceRestartInProgress = true;
    this.iceRestartAttempts++;
    console.info(`[CallManager] attempting ICE restart (#${this.iceRestartAttempts})`);

    try {
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);

      const peerPk = this.isIncoming ? this.pendingCallerPk : this.currentContact?.publicKey;
      if (peerPk && this.relay) {
        const sent = this.relay.sendSignal(peerPk, {
          type: 'offer',
          call_id: this.activeCallId,
          sdp: offer.sdp!,
        });
        if (!sent) {
          // Relay socket was down when we tried to re-signal. NostrRelay
          // queues the signal internally and flushes it automatically once
          // the relay reconnects, so the restart offer isn't lost — it's
          // just delayed until the transport comes back.
          console.warn('[CallManager] ICE restart offer queued (relay disconnected); will send on reconnect');
        }
      } else {
        console.warn('[CallManager] ICE restart: no peer pubkey/relay available to re-signal');
      }
    } catch (err) {
      console.warn('[CallManager] ICE restart offer failed:', err);
    } finally {
      this.iceRestartInProgress = false;
    }
  }

  /**
   * Handle a mid-call renegotiation offer from the peer (their side of an
   * ICE restart, triggered by _attemptIceRestart on their end). Applies the
   * new SDP, answers it, and sends the answer back — the call_id matches
   * our already-active call, so this never creates a new ringing state.
   */
  private async _handleRenegotiationOffer(signal: SignalPayload, senderPk: string): Promise<void> {
    if (!this.pc || !signal.sdp || !this.activeCallId) return;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      if (this.relay) {
        const sent = this.relay.sendSignal(senderPk, {
          type: 'answer',
          call_id: this.activeCallId,
          sdp: answer.sdp!,
        });
        if (!sent) {
          console.warn('[CallManager] ICE restart answer queued (relay disconnected); will send on reconnect');
        }
      }
    } catch (err) {
      console.warn('[CallManager] ICE restart renegotiation (offer→answer) failed:', err);
    }
  }

  private _closePeerConnection(): void {
    if (this.iceDisconnectTimer) { clearTimeout(this.iceDisconnectTimer); this.iceDisconnectTimer = null; }
    this.iceRestartInProgress = false;
    this.iceRestartAttempts = 0;
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
  }

  // ── incoming Nostr signals ─────────────────────────────────────────────

  private _onIncomingSignal(signal: SignalPayload, senderPk: string): void {
    if (signal.type === 'offer') {
      // Mid-call renegotiation: the peer is performing an ICE restart on an
      // already-active call (same call_id). Must NOT be treated as a new
      // incoming call / routed into the 'ringing' flow — answer it in place.
      if (
        signal.call_id === this.activeCallId &&
        this.currentState === 'connected' &&
        !this.isSimulated &&
        this.pc
      ) {
        const expectedPeerPk = this.isIncoming ? this.pendingCallerPk : this.currentContact?.publicKey;
        if (expectedPeerPk && senderPk.toLowerCase() === expectedPeerPk.toLowerCase()) {
          void this._handleRenegotiationOffer(signal, senderPk);
        }
        return;
      }

      if (this.currentState !== 'idle') return; // already in a (different) call
      this.pendingCallerPk = senderPk;
      this.activeCallId = signal.call_id;
      this.pendingOfferSdp = signal.sdp ?? null;
      this.isSimulated = false;

      const contacts = storage.getContacts();
      const contact: Contact = contacts.find(c =>
        c.publicKey.toLowerCase() === senderPk.toLowerCase()
      ) ?? {
        name: senderPk.slice(0, 8) + '…',
        publicKey: senderPk,
        addresses: [],
        state: 'online',
      };

      this.currentContact = contact;
      this.isIncoming = true;
      this.hasVideo = true;
      this.isMuted = false;
      this.isCameraOff = false;
      this.chatMessages = [];
      this.currentState = 'ringing';
      this.notifyState();
      audioSynth.startIncomingRinging(storage.getSettings().ringtoneVolume);
      return;
    }

    // Subsequent signals must match the active call
    if (signal.call_id !== this.activeCallId || this.isSimulated) return;

    if (signal.type === 'answer' && this.pc && signal.sdp) {
      this.pc.setRemoteDescription(
        new RTCSessionDescription({ type: 'answer', sdp: signal.sdp })
      ).catch(err => console.warn('[CallManager] setRemoteDescription(answer):', err));
      return;
    }

    if (signal.type === 'ice' && this.pc && signal.candidate) {
      this.pc.addIceCandidate(
        new RTCIceCandidate(signal.candidate)
      ).catch(err => console.warn('[CallManager] addIceCandidate:', err));
      return;
    }

    if (signal.type === 'hangup') {
      this._hangupReceived();
    }
  }

  private _hangupReceived(): void {
    audioSynth.stopAll();
    audioSynth.playEndChime();
    this._finishCall(this.currentState === 'connected'
      ? (this.isIncoming ? 'incoming_accepted' : 'outgoing_accepted')
      : (this.isIncoming ? 'incoming_missed' : 'outgoing_missed'));
  }

  // ── public call actions ────────────────────────────────────────────────

  /** Start an outgoing call to a contact via Nostr + WebRTC. */
  async startCall(contact: Contact, video = true): Promise<void> {
    if (this.currentState !== 'idle') return;

    if (!this.relay?.isConnected) {
      this._showCallError(`Not connected to relay — go offline then back online`);
      return;
    }

    this.currentContact = contact;
    this.isIncoming = false;
    this.hasVideo = video;
    this.isMuted = false;
    this.isCameraOff = !video;
    this.chatMessages = [];
    this.isSimulated = false;
    this.activeCallId = randomHex(16);
    this.currentState = 'calling';
    this.notifyState();
    audioSynth.startOutgoingRinging(storage.getSettings().ringtoneVolume);

    try {
      this.localStream = await this.acquireMedia(video);
      this.notifyMedia();

      const pc = await this._buildPeerConnection();
      this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream!));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const offerSignal: SignalPayload = {
        type: 'offer',
        call_id: this.activeCallId!,
        sdp: offer.sdp!,
      };
      const sent = this.relay.sendSignal(contact.publicKey, offerSignal);
      // Also deliver to any relays the contact specified (they may not share ours)
      const contactRelays = (contact.relays ?? []).filter(r => r !== this.currentRelayUrl);
      if (contactRelays.length) {
        const sk = hexToBytes(storage.getSettings().privateKey);
        sendToRelays(contactRelays, sk, contact.publicKey, offerSignal);
      }
      if (!sent && !contactRelays.length) {
        this._showCallError('Could not reach relay. Check your connection.');
        this.endCall('outgoing_error');
        return;
      }

      this.currentState = 'ringing';
      this.notifyState();

      // Auto-hangup if no answer within 60 s
      setTimeout(() => {
        if (this.currentState === 'calling' || this.currentState === 'ringing') {
          this.endCall('outgoing_missed');
        }
      }, 60_000);
    } catch (err) {
      console.error('[CallManager] startCall error:', err);
      this.endCall('outgoing_error');
    }
  }

  /** Accept an incoming real call (or simulated one). */
  async acceptCall(): Promise<void> {
    if (this.currentState !== 'ringing' || !this.isIncoming) return;
    audioSynth.stopAll();

    if (this.isSimulated) {
      // Simulation path: stay on synthetic streams, mark connected
      this.localStream = await this.acquireMedia(this.hasVideo);
      this._acceptOrConnectSimulated();
      return;
    }

    // Real WebRTC path
    try {
      this.localStream = await this.acquireMedia(this.hasVideo);
      this.notifyMedia();

      const pc = await this._buildPeerConnection();

      if (this.pendingOfferSdp) {
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: 'offer', sdp: this.pendingOfferSdp })
        );
      }
      this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream!));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (this.relay && this.pendingCallerPk && this.activeCallId) {
        this.relay.sendSignal(this.pendingCallerPk, {
          type: 'answer',
          call_id: this.activeCallId,
          sdp: answer.sdp!,
        });
      }

      // Connected state fires from pc.ontrack when remote tracks arrive
    } catch (err) {
      console.error('[CallManager] acceptCall error:', err);
      this.endCall('incoming_error');
    }
  }

  /** Hang up or decline. */
  endCall(eventTypeOverride?: CallEvent['type']): void {
    audioSynth.stopAll();
    audioSynth.playEndChime();

    // Send hangup signal if we have an active real call
    if (!this.isSimulated && this.activeCallId) {
      const peerPk = this.isIncoming ? this.pendingCallerPk : this.currentContact?.publicKey;
      if (peerPk && this.relay) {
        this.relay.sendSignal(peerPk, { type: 'hangup', call_id: this.activeCallId, reason: 'bye' });
      }
    }

    this._finishCall(eventTypeOverride);
  }

  private _finishCall(eventTypeOverride?: CallEvent['type']): void {
    const duration = this.getCallDuration();
    const contact = this.currentContact;
    const incoming = this.isIncoming;
    const wasConnected = this.currentState === 'connected';

    if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null; }
    this._closePeerConnection();
    this._stopStream(this.localStream); this.localStream = null;
    this._stopStream(this.remoteStream); this.remoteStream = null;

    if (contact) {
      let type: CallEvent['type'];
      if (eventTypeOverride) {
        type = eventTypeOverride;
      } else if (wasConnected) {
        type = incoming ? 'incoming_accepted' : 'outgoing_accepted';
      } else {
        type = incoming ? 'incoming_missed' : 'outgoing_missed';
      }
      storage.addEvent({
        id: 'evt-' + Date.now(),
        contactPublicKey: contact.publicKey,
        contactName: contact.name,
        type,
        timestamp: Date.now(),
        duration,
        addressUsed: contact.addresses[0] ?? 'nostr',
        hasVideo: this.hasVideo,
      });
    }

    this.activeCallId = null;
    this.pendingCallerPk = null;
    this.pendingOfferSdp = null;
    this.isSimulated = false;
    this.currentState = 'ended';
    this.notifyState();
    this.notifyMedia();

    setTimeout(() => {
      this.currentState = 'idle';
      this.currentContact = null;
      this.callStartTime = 0;
      this.chatMessages = [];
      this.notifyState();
    }, 1200);
  }

  // ── media controls ─────────────────────────────────────────────────────

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = !this.isMuted; });
    return this.isMuted;
  }

  toggleCamera(): boolean {
    this.isCameraOff = !this.isCameraOff;
    this.localStream?.getVideoTracks().forEach(t => { t.enabled = !this.isCameraOff; });
    return this.isCameraOff;
  }

  toggleSpeaker(): boolean {
    this.isSpeakerOn = !this.isSpeakerOn;
    return this.isSpeakerOn;
  }

  // ── in-call chat ───────────────────────────────────────────────────────

  sendChatMessage(text: string): void {
    if (!text.trim()) return;
    const msg: InCallChatMessage = {
      id: 'msg-' + Date.now(), sender: 'self', text: text.trim(), timestamp: Date.now(),
    };
    this.chatMessages.push(msg);
    this.chatListeners.forEach(cb => cb(msg));

    if (this.isSimulated) {
      setTimeout(() => {
        if (this.currentState === 'connected') this._addPeerChat('Mesh ACK: ' + text.trim().slice(0, 40));
      }, 1200);
    }
  }

  private _addPeerChat(text: string): void {
    const msg: InCallChatMessage = {
      id: 'msg-' + Date.now(), sender: 'peer', text, timestamp: Date.now(),
    };
    this.chatMessages.push(msg);
    this.chatListeners.forEach(cb => cb(msg));
  }

  // ── stats ──────────────────────────────────────────────────────────────

  private _startStatsInterval(): void {
    if (this.statsInterval) clearInterval(this.statsInterval);
    this.statsInterval = setInterval(() => this._tick(), 1000);
  }

  private async _tick(): Promise<void> {
    if (this.pc && !this.isSimulated) {
      try {
        const stats = await this.pc.getStats();
        let rtt = 0, packetsLost = 0, frameRate = 0;
        stats.forEach((r: RTCStats) => {
          const report = r as any;
          if (report.type === 'remote-inbound-rtp' && report.roundTripTime)
            rtt = Math.round(report.roundTripTime * 1000);
          if (report.type === 'remote-inbound-rtp' && report.packetsLost)
            packetsLost = report.packetsLost;
          if (report.type === 'inbound-rtp' && report.kind === 'video' && report.framesPerSecond)
            frameRate = Math.round(report.framesPerSecond);
        });
        this.statsListeners.forEach(cb => cb({
          resolution: this.hasVideo ? '1280×720' : 'Audio Only',
          frameRate,
          videoBitrate: this.hasVideo ? 'live' : '0 kbps',
          audioBitrate: 'Opus',
          packetsLost,
          rtt,
          codec: this.hasVideo ? 'VP8 / Opus' : 'Opus',
        }));
        return;
      } catch {}
    }
    // Simulated stats fallback
    this.statsListeners.forEach(cb => cb({
      resolution: this.hasVideo ? '1280×720 (sim)' : 'Audio Only (sim)',
      frameRate: this.hasVideo ? 30 : 0,
      videoBitrate: this.hasVideo ? '1.4 Mbps' : '0 kbps',
      audioBitrate: '64 kbps (Opus)',
      packetsLost: Math.random() > 0.9 ? 1 : 0,
      rtt: Math.floor(18 + Math.random() * 12),
      codec: this.hasVideo ? 'VP8 / Opus' : 'Opus',
    }));
  }

  // ── simulation (kept for testing / UI demos) ───────────────────────────

  /** Simulate an incoming call without Nostr — useful for UI testing. */
  simulateIncomingCall(customContact?: Contact): void {
    if (this.currentState !== 'idle') return;

    const contact = customContact ?? storage.getContacts()[0] ?? {
      name: 'Freifunk Node #18',
      publicKey: 'a1f893d9b048123ef6177bc954e7d14872c05e19741b689a7702ec9432bfd12e',
      addresses: ['192.168.1.1:10008'],
      state: 'online' as const,
    };

    this.currentContact = contact;
    this.isIncoming = true;
    this.hasVideo = true;
    this.isMuted = false;
    this.isCameraOff = false;
    this.chatMessages = [];
    this.isSimulated = true;
    this.activeCallId = randomHex(16);
    this.pendingCallerPk = null;
    this.pendingOfferSdp = null;
    this.currentState = 'ringing';
    this.notifyState();
    audioSynth.startIncomingRinging(storage.getSettings().ringtoneVolume);
  }

  private _acceptOrConnectSimulated(): void {
    audioSynth.playConnectChime();
    this.currentState = 'connected';
    this.callStartTime = Date.now();
    this.notifyState();

    this.remoteStream = this._syntheticStream(this.hasVideo, this.currentContact?.name ?? 'Peer');
    this.notifyMedia();
    this._startStatsInterval();

    setTimeout(() => {
      if (this.currentState === 'connected') {
        this._addPeerChat(
          `Simulated P2P — real calls use Nostr signaling + WebRTC.\nAddress: ${this.currentContact?.addresses[0] ?? 'N/A'}`
        );
      }
    }, 1200);
  }
}

export const callManager = new CallManager();
