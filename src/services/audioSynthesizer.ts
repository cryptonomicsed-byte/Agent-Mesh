/**
 * Web Audio Synthesizer for Meshenger Phone Sounds
 * Generates telephone tones, dialing signals, and ringtones
 */

class AudioSynthesizer {
  private ctx: AudioContext | null = null;
  private ringOsc1: OscillatorNode | null = null;
  private ringOsc2: OscillatorNode | null = null;
  private ringGain: GainNode | null = null;
  private ringInterval: number | null = null;

  private getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Starts playing outgoing dialing tone (dual-frequency 440Hz + 480Hz standard US/EU tone)
   */
  startOutgoingRinging(volume = 0.5): void {
    this.stopAll();
    const ctx = this.getContext();
    const now = ctx.currentTime;

    const playTone = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(440, t);
      osc2.frequency.setValueAtTime(480, t);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume * 0.4, t + 0.05);
      gain.gain.setValueAtTime(volume * 0.4, t + 1.2);
      gain.gain.linearRampToValueAtTime(0, t + 1.3);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 1.35);
      osc2.stop(t + 1.35);
    };

    playTone();
    this.ringInterval = window.setInterval(playTone, 3500);
  }

  /**
   * Starts playing melodic incoming phone ringtone
   */
  startIncomingRinging(volume = 0.7): void {
    this.stopAll();
    const ctx = this.getContext();

    const ringPattern = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      // Dual chirp ring: note 1 (784Hz - G5), note 2 (880Hz - A5), note 3 (1046Hz - C6)
      const notes = [
        { freq: 784, start: 0, dur: 0.18 },
        { freq: 880, start: 0.22, dur: 0.18 },
        { freq: 1046, start: 0.44, dur: 0.35 },
        { freq: 880, start: 0.85, dur: 0.18 },
        { freq: 1046, start: 1.08, dur: 0.45 },
      ];

      notes.forEach(({ freq, start, dur }) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t + start);

        gain.gain.setValueAtTime(0, t + start);
        gain.gain.linearRampToValueAtTime(volume * 0.5, t + start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);

        osc.connect(gain);
        gain.connect(this.ctx!.destination);

        osc.start(t + start);
        osc.stop(t + start + dur + 0.05);
      });
    };

    ringPattern();
    this.ringInterval = window.setInterval(ringPattern, 3000);
  }

  /**
   * Plays a pleasant chime upon call connect
   */
  playConnectChime(): void {
    this.stopAll();
    const ctx = this.getContext();
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.09);

      gain.gain.setValueAtTime(0, t + idx * 0.09);
      gain.gain.linearRampToValueAtTime(0.3, t + idx * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.09 + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + idx * 0.09);
      osc.stop(t + idx * 0.09 + 0.35);
    });
  }

  /**
   * Plays call end / disconnect tone (3 fast low beeps)
   */
  playEndChime(): void {
    this.stopAll();
    const ctx = this.getContext();
    const t = ctx.currentTime;
    [0, 0.22, 0.44].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, t + offset);

      gain.gain.setValueAtTime(0, t + offset);
      gain.gain.linearRampToValueAtTime(0.3, t + offset + 0.02);
      gain.gain.setValueAtTime(0.3, t + offset + 0.12);
      gain.gain.linearRampToValueAtTime(0, t + offset + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + offset);
      osc.stop(t + offset + 0.16);
    });
  }

  stopAll(): void {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
    if (this.ringOsc1) {
      try { this.ringOsc1.stop(); } catch {}
      this.ringOsc1 = null;
    }
    if (this.ringOsc2) {
      try { this.ringOsc2.stop(); } catch {}
      this.ringOsc2 = null;
    }
  }
}

export const audioSynth = new AudioSynthesizer();
