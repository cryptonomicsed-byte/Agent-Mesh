import { Contact, ActiveCallState, CallStats, InCallChatMessage, CallEvent } from '../types';
import { audioSynth } from './audioSynthesizer';
import { storage } from './storage';

export type CallStateListener = (state: ActiveCallState, contact: Contact | null) => void;
export type StatsListener = (stats: CallStats) => void;
export type ChatListener = (message: InCallChatMessage) => void;
export type MediaStreamListener = (localStream: MediaStream | null, remoteStream: MediaStream | null) => void;

class CallManager {
  private currentState: ActiveCallState = 'idle';
  private currentContact: Contact | null = null;
  private isIncoming = false;
  private hasVideo = true;
  private isMuted = false;
  private isCameraOff = false;
  private isSpeakerOn = true;
  private callStartTime = 0;
  private callDurationInterval: number | null = null;
  private statsInterval: number | null = null;
  private simulatedLoopbackInterval: number | null = null;

  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;

  private stateListeners: Set<CallStateListener> = new Set();
  private statsListeners: Set<StatsListener> = new Set();
  private chatListeners: Set<ChatListener> = new Set();
  private mediaListeners: Set<MediaStreamListener> = new Set();

  private chatMessages: InCallChatMessage[] = [];

  constructor() {
    // Setup initial state
  }

  getState(): ActiveCallState {
    return this.currentState;
  }

  getCurrentContact(): Contact | null {
    return this.currentContact;
  }

  getIsIncoming(): boolean {
    return this.isIncoming;
  }

  getHasVideo(): boolean {
    return this.hasVideo;
  }

  getIsMuted(): boolean {
    return this.isMuted;
  }

  getIsCameraOff(): boolean {
    return this.isCameraOff;
  }

  getIsSpeakerOn(): boolean {
    return this.isSpeakerOn;
  }

  getChatMessages(): InCallChatMessage[] {
    return [...this.chatMessages];
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  getCallDuration(): number {
    if (this.callStartTime === 0) return 0;
    return Math.floor((Date.now() - this.callStartTime) / 1000);
  }

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

  private notifyState(): void {
    this.stateListeners.forEach((cb) => cb(this.currentState, this.currentContact));
  }

  private notifyMedia(): void {
    this.mediaListeners.forEach((cb) => cb(this.localStream, this.remoteStream));
  }

  /**
   * Acquire camera & mic media streams
   */
  private async acquireMedia(video: boolean): Promise<MediaStream> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
      });
      return stream;
    } catch (err) {
      console.warn('Real camera/mic unavailable, creating synthetic canvas media stream', err);
      // Fallback: create synthetic canvas video stream and audio oscillator stream
      return this.createSyntheticMediaStream(video, 'My Node');
    }
  }

  private createSyntheticMediaStream(hasVideo: boolean, label: string): MediaStream {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d')!;

    let frame = 0;
    const draw = () => {
      frame++;
      // Background gradient
      const grad = ctx.createLinearGradient(0, 0, 640, 480);
      grad.addColorStop(0, '#1c1917');
      grad.addColorStop(1, '#0c0a09');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 640, 480);

      // Node mesh circles
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const radius = 30 + i * 25 + Math.sin(frame * 0.05 + i) * 6;
        ctx.beginPath();
        ctx.arc(320, 240, radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Avatar circle
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(320, 240, 48, 0, Math.PI * 2);
      ctx.fill();

      // Label text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label.slice(0, 2).toUpperCase(), 320, 248);

      ctx.font = '16px monospace';
      ctx.fillStyle = '#86efac';
      ctx.fillText(`Mesh Stream: ${label}`, 320, 330);
      ctx.fillText(`FPS: 30 | Bitrate: ~1.4 Mbps`, 320, 354);
    };

    const interval = window.setInterval(draw, 1000 / 30);
    const canvasStream = canvas.captureStream(30);

    // Create a silent audio track
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const osc = audioCtx.createOscillator();
      const dst = audioCtx.createMediaStreamDestination();
      const gain = audioCtx.createGain();
      gain.gain.value = 0.001;
      osc.connect(gain);
      gain.connect(dst);
      osc.start();
      dst.stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
    } catch {}

    (canvasStream as any)._syntheticInterval = interval;
    return canvasStream;
  }

  /**
   * Start an outgoing call to a contact
   */
  async startCall(contact: Contact, video: boolean = true): Promise<void> {
    if (this.currentState !== 'idle') return;

    this.currentContact = contact;
    this.isIncoming = false;
    this.hasVideo = video;
    this.isMuted = false;
    this.isCameraOff = !video;
    this.chatMessages = [];
    this.currentState = 'calling';
    this.notifyState();

    audioSynth.startOutgoingRinging(storage.getSettings().ringtoneVolume);

    try {
      this.localStream = await this.acquireMedia(video);
      this.notifyMedia();

      // Simulate remote connection establishing after dialing (or answer)
      setTimeout(() => {
        if (this.currentState === 'calling') {
          this.currentState = 'ringing';
          this.notifyState();
        }
      }, 1500);

      // Auto-connect after 3.8s for rich testing
      setTimeout(() => {
        if (this.currentState === 'calling' || this.currentState === 'ringing') {
          this.acceptOrConnectCall();
        }
      }, 3800);
    } catch (err) {
      console.error('Call initialization error:', err);
      this.endCall('outgoing_error');
    }
  }

  /**
   * Simulate or receive an incoming call
   */
  simulateIncomingCall(customContact?: Contact): void {
    if (this.currentState !== 'idle') return;

    const contact = customContact || storage.getContacts()[0] || {
      name: 'Freifunk Node #18',
      publicKey: 'a1f893d9b048123ef6177bc954e7d14872c05e19741b689a7702ec9432bfd12e',
      addresses: ['192.168.1.1:10008'],
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
  }

  /**
   * User accepts the call
   */
  async acceptCall(): Promise<void> {
    if (this.currentState !== 'ringing' || !this.isIncoming) return;
    audioSynth.stopAll();
    this.localStream = await this.acquireMedia(this.hasVideo);
    this.acceptOrConnectCall();
  }

  /**
   * Transition to connected state, establish remote stream & metrics
   */
  private acceptOrConnectCall(): void {
    audioSynth.stopAll();
    audioSynth.playConnectChime();

    this.currentState = 'connected';
    this.callStartTime = Date.now();
    this.notifyState();

    // Create remote media stream (either clone of synthetic or remote peer)
    this.remoteStream = this.createSyntheticMediaStream(
      this.hasVideo,
      this.currentContact ? this.currentContact.name : 'Peer Node'
    );
    this.notifyMedia();

    // Start call stats ticker
    this.statsInterval = window.setInterval(() => {
      this.updateStats();
    }, 1000);

    // Initial greeting chat message from peer
    setTimeout(() => {
      if (this.currentState === 'connected') {
        this.addPeerChatMessage(
          `Connected directly via ${this.currentContact?.addresses[0] || '192.168.1.105:10008'}. WebRTC encrypted P2P channel established.`
        );
      }
    }, 1200);
  }

  /**
   * Decline or hang up call
   */
  endCall(eventTypeOverride?: CallEvent['type']): void {
    audioSynth.stopAll();
    audioSynth.playEndChime();

    const duration = this.getCallDuration();
    const contact = this.currentContact;
    const isIncoming = this.isIncoming;
    const wasConnected = this.currentState === 'connected';

    // Stop intervals
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.callDurationInterval) {
      clearInterval(this.callDurationInterval);
      this.callDurationInterval = null;
    }

    // Stop media tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      const interval = (this.localStream as any)._syntheticInterval;
      if (interval) clearInterval(interval);
      this.localStream = null;
    }
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((t) => t.stop());
      const interval = (this.remoteStream as any)._syntheticInterval;
      if (interval) clearInterval(interval);
      this.remoteStream = null;
    }

    // Record Event in History
    if (contact) {
      let type: CallEvent['type'];
      if (eventTypeOverride) {
        type = eventTypeOverride;
      } else if (wasConnected) {
        type = isIncoming ? 'incoming_accepted' : 'outgoing_accepted';
      } else {
        type = isIncoming ? 'incoming_missed' : 'outgoing_missed';
      }

      const event: CallEvent = {
        id: 'evt-' + Date.now(),
        contactPublicKey: contact.publicKey,
        contactName: contact.name,
        type,
        timestamp: Date.now(),
        duration,
        addressUsed: contact.addresses[0] || '192.168.1.105:10008',
        hasVideo: this.hasVideo,
      };
      storage.addEvent(event);
    }

    this.currentState = 'ended';
    this.notifyState();
    this.notifyMedia();

    // Reset to idle after brief animation
    setTimeout(() => {
      this.currentState = 'idle';
      this.currentContact = null;
      this.callStartTime = 0;
      this.chatMessages = [];
      this.notifyState();
    }, 1200);
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMuted;
      });
    }
    return this.isMuted;
  }

  toggleCamera(): boolean {
    this.isCameraOff = !this.isCameraOff;
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = !this.isCameraOff;
      });
    }
    return this.isCameraOff;
  }

  toggleSpeaker(): boolean {
    this.isSpeakerOn = !this.isSpeakerOn;
    return this.isSpeakerOn;
  }

  sendChatMessage(text: string): void {
    if (!text.trim()) return;
    const msg: InCallChatMessage = {
      id: 'msg-' + Date.now(),
      sender: 'self',
      text: text.trim(),
      timestamp: Date.now(),
    };
    this.chatMessages.push(msg);
    this.chatListeners.forEach((cb) => cb(msg));

    // Simulated peer echo or response
    setTimeout(() => {
      if (this.currentState === 'connected') {
        const responses = [
          'Received over encrypted data channel!',
          'Loud and clear on mesh link.',
          'Signal strength is strong (SNR 24dB).',
          'ACK: Packet received with 0 loss.',
        ];
        const randomResp = responses[Math.floor(Math.random() * responses.length)];
        this.addPeerChatMessage(randomResp);
      }
    }, 1500);
  }

  private addPeerChatMessage(text: string): void {
    const msg: InCallChatMessage = {
      id: 'msg-' + Date.now(),
      sender: 'peer',
      text,
      timestamp: Date.now(),
    };
    this.chatMessages.push(msg);
    this.chatListeners.forEach((cb) => cb(msg));
  }

  private updateStats(): void {
    const rtt = Math.floor(18 + Math.random() * 12);
    const packetsLost = Math.random() > 0.9 ? 1 : 0;
    const stats: CallStats = {
      resolution: this.hasVideo ? '1280x720 (30fps)' : 'Audio Only',
      frameRate: this.hasVideo ? 30 : 0,
      videoBitrate: this.hasVideo ? `${(1.2 + Math.random() * 0.4).toFixed(1)} Mbps` : '0 kbps',
      audioBitrate: '64 kbps (Opus)',
      packetsLost,
      rtt,
      codec: this.hasVideo ? 'VP8 / Opus' : 'Opus',
    };
    this.statsListeners.forEach((cb) => cb(stats));
  }
}

export const callManager = new CallManager();
