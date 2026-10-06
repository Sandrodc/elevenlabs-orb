// Live microphone loudness for the Listening state. Audio is only measured
// (RMS level) in the browser — nothing is recorded, stored or sent anywhere.
(() => {
  const Orb = (window.Orb = window.Orb || {});
  const AudioCtx = window.AudioContext || window.webkitAudioContext;

  // Level mapping: -60 dBFS (room noise after noise suppression) → 0,
  // -24 dBFS (normal speech with auto gain) → 1.
  const FLOOR_DB = -60;
  const RANGE_DB = 36;

  class MicInput {
    static get supported() {
      return !!(AudioCtx && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    get active() {
      return !!this.analyser;
    }

    async start() {
      if (this.active || this.starting) return this.starting;
      // Create the AudioContext inside the click / key press, before awaiting
      // the permission prompt, so autoplay rules let it run.
      const ctx = new AudioCtx();
      this.starting = (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          // Don't await: if the browser holds the context until the next
          // gesture, the level just reads 0 until then instead of hanging here.
          if (ctx.state === 'suspended') ctx.resume();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          ctx.createMediaStreamSource(stream).connect(analyser);
          this.ctx = ctx;
          this.stream = stream;
          this.analyser = analyser;
          this.buffer = new Float32Array(analyser.fftSize);
          stream.getAudioTracks()[0]?.addEventListener('ended', () => {
            this.stop();
            if (this.onended) this.onended();
          });
        } catch (err) {
          ctx.close();
          throw err;
        } finally {
          this.starting = null;
        }
      })();
      return this.starting;
    }

    stop() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx) this.ctx.close();
      this.stream = this.ctx = this.analyser = this.buffer = null;
    }

    /** Current loudness 0..1 (unsmoothed). */
    level() {
      if (!this.analyser) return 0;
      this.analyser.getFloatTimeDomainData(this.buffer);
      let sum = 0;
      for (let i = 0; i < this.buffer.length; i++) sum += this.buffer[i] * this.buffer[i];
      const db = 10 * Math.log10(sum / this.buffer.length + 1e-12);
      return Math.min(1, Math.max(0, (db - FLOOR_DB) / RANGE_DB));
    }
  }

  Orb.MicInput = MicInput;
})();
