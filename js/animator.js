// Drives the orb over time: the agent state (Idle / Listening / Speaking),
// synthetic voice levels, state morphing and seamless-loop bookkeeping.
// Plain state + math (no DOM, no WebGL) so the exporter can clone it and step
// it at a fixed frame rate.
(() => {
  const Orb = (window.Orb = window.Orb || {});
  const TAU = Math.PI * 2;

  // Each state sets targets for the shader params (`base`, falling back to
  // DEFAULT_PARAMS) plus how strongly they follow that state's voice level
  // (`react`, added × level 0..1). `activity` makes the swirl run faster (+)
  // or slower (-) than the base rate. On elevenlabs.io the same shader inputs
  // are driven by real mic (user) and playback (agent) audio levels.
  Orb.STATES = {
    idle: { label: 'Idle', voice: null, base: {}, react: {} },
    listening: {
      label: 'Listening',
      voice: 'user',
      // Shrinks well below the other states, softens (lower contrast and
      // saturation) and calms down; flickers with the user's voice.
      base: { circleSize: 0.8, fbmAmplitude: 0.5, noiseAmplitude: 0.11, exposure: 0.2, saturation: 0.75, contrast: -0.14, ring: 0.3, activity: -0.35 },
      react: { circleSize: -0.03, fbmAmplitude: 0.15, exposure: 0.04, ring: 0.7, ringShift: -2.5, activity: 0.6 },
    },
    speaking: {
      label: 'Speaking',
      voice: 'agent',
      // More energy: a stronger, faster swirl that surges and swells with each syllable.
      base: { circleSize: 0.965, fbmAmplitude: 0.8, noiseAmplitude: 0.18, exposure: 0.18, saturation: 1.08, sheen: 0.28, ring: 0.2, activity: 0.35 },
      react: { circleSize: 0.035, fbmAmplitude: 0.3, noiseAmplitude: 0.1, exposure: 0.05, saturation: 0.08, ring: 0.8, ringShift: 1.5, activity: 0.9 },
    },
  };
  const STATE_IDS = Object.keys(Orb.STATES);

  // Synthetic voices: syllables (~4 Hz) grouped into phrases with pauses.
  const VOICES = {
    agent: { syllable: 4.3, phrase: 0.21, phase: 0.7, gain: 1 },
    user: { syllable: 3.4, phrase: 0.16, phase: 2.3, gain: 0.85 },
  };

  const MORPH_TIME = 0.35; // seconds for a state change to settle (roughly)

  function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /**
   * Loudness 0..1 of a synthetic voice at time t. With `period`, every
   * component is snapped to a whole number of cycles so the level repeats
   * exactly — needed for seamless loops.
   */
  function voiceLevel(id, t, period) {
    const v = VOICES[id];
    const w = (hz) => TAU * (period ? Math.max(1, Math.round(hz * period)) / period : hz) * t;
    const syl = 0.5 + 0.5 * Math.sin(w(v.syllable) + 0.9 * Math.sin(w(v.syllable * 0.31) + v.phase));
    const syl2 = 0.5 + 0.5 * Math.sin(w(v.syllable * 1.47) + v.phase * 2.1);
    const phrase = Math.sin(w(v.phrase) + v.phase) + 0.45 * Math.sin(w(v.phrase * 2.3) + v.phase * 3.7);
    const gate = smoothstep(-0.8, -0.25, phrase); // short pauses between phrases
    return v.gain * gate * (0.25 + 0.75 * (0.6 * syl ** 1.5 + 0.4 * syl2 ** 2));
  }

  // Critically damped smoothing (Unity's SmoothDamp): eases in and out
  // without overshoot, and stays stable for large frame times.
  function smoothDamp(current, target, velocity, smoothTime, dt) {
    const omega = 2 / smoothTime;
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = current - target;
    const temp = (velocity + omega * change) * dt;
    return [target + (change + temp) * decay, (velocity - omega * temp) * decay];
  }

  class OrbAnimator {
    constructor(baseParams) {
      this.baseParams = baseParams;
      this.state = 'idle';
      this.weights = Object.fromEntries(STATE_IDS.map((id) => [id, id === 'idle' ? 1 : 0]));
      this.velocity = Object.fromEntries(STATE_IDS.map((id) => [id, 0]));
      this.playing = true;
      this.speed = 1;
      this.loop = false;
      this.loopSeconds = 8;
      this.loopSamples = 240; // integration steps for one loop's time advance
      this.time = 0; // shader time (uTime)
      this.clock = 0; // seconds of voice playback when not looping
      this.phase = 0; // seconds into the current loop
    }

    clone() {
      const c = Object.assign(new OrbAnimator(this.baseParams), this);
      c.weights = { ...this.weights };
      c.velocity = { ...this.velocity };
      return c;
    }

    setState(id) {
      if (Orb.STATES[id]) this.state = id;
    }

    /** Jump straight to the current state, skipping the morph. */
    settle() {
      for (const id of STATE_IDS) {
        this.weights[id] = id === this.state ? 1 : 0;
        this.velocity[id] = 0;
      }
    }

    get morphing() {
      return STATE_IDS.some(
        (id) => Math.abs(this.weights[id] - (id === this.state ? 1 : 0)) > 1e-4 || Math.abs(this.velocity[id]) > 1e-4
      );
    }

    levels(t = this.loop ? this.phase : this.clock) {
      const period = this.loop ? this.loopSeconds : 0;
      return { user: voiceLevel('user', t, period), agent: voiceLevel('agent', t, period) };
    }

    // One channel blended across states.
    channel(key, levels, fallback = 0) {
      let v = 0;
      for (const id of STATE_IDS) {
        const w = this.weights[id];
        if (!w) continue;
        const st = Orb.STATES[id];
        const level = st.voice ? levels[st.voice] : 0;
        v += w * ((st.base[key] ?? fallback) + (st.react[key] ?? 0) * level);
      }
      return v;
    }

    // Shader-time units per second at voice time t.
    speedAt(t) {
      const activity = this.channel('activity', this.levels(t));
      return Orb.BASE_RATE * this.speed * Math.max(0.05, 1 + activity);
    }

    /** Shader time gained over one loop at the current blend. */
    loopOffset() {
      return this.timeAtPhase(this.loopSeconds, this.loopSamples);
    }

    /** Shader time at loop phase p, counting from 0 at phase 0. */
    timeAtPhase(p, steps = Math.ceil((p / this.loopSeconds) * this.loopSamples)) {
      const n = Math.max(1, steps);
      const dt = p / n;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += this.speedAt(i * dt) * dt;
      return sum;
    }

    step(dt) {
      for (const id of STATE_IDS) {
        const target = id === this.state ? 1 : 0;
        [this.weights[id], this.velocity[id]] = smoothDamp(this.weights[id], target, this.velocity[id], MORPH_TIME, dt);
      }
      if (!this.playing) return;
      this.time += this.speedAt(this.loop ? this.phase : this.clock) * dt;
      if (this.loop) {
        this.phase += dt;
        // Wrapping subtracts exactly what frame() adds for the cross-fade, so
        // the picture is continuous across the seam.
        while (this.phase >= this.loopSeconds) {
          this.phase -= this.loopSeconds;
          this.time -= this.loopOffset();
        }
      } else {
        this.clock += dt;
      }
    }

    /**
     * Everything needed to draw the current frame. In loop mode the first
     * half of each cycle cross-fades from `time + offset` into `time`, so the
     * last frame of a cycle flows straight into the first.
     */
    frame() {
      const levels = this.levels();
      const params = {};
      for (const key of Object.keys(this.baseParams)) params[key] = this.channel(key, levels, this.baseParams[key]);
      let loop = null;
      if (this.loop) {
        const half = this.loopSeconds / 2;
        loop = { offset: this.loopOffset(), weight: this.phase >= half ? 1 : smoothstep(0, 1, this.phase / half) };
      }
      return { time: this.time, params, loop };
    }

    setLoop(on) {
      if (on === this.loop) return;
      if (on) {
        this.loop = true;
        this.phase = 0;
        // Phase 0 shows time + offset, so shift back to keep the same picture.
        this.time -= this.loopOffset();
      } else {
        const { loop } = this.frame();
        if (loop.weight < 0.5) this.time += loop.offset; // keep the dominant sample
        this.loop = false;
      }
    }

    setLoopSeconds(seconds) {
      this.loopSeconds = seconds;
      this.phase %= seconds;
    }

    seekLoop(p) {
      this.phase = Math.min(Math.max(0, p), this.loopSeconds - 1e-6);
      this.time = this.timeAtPhase(this.phase);
    }

    /** A copy that records exactly one seamless loop, matching the preview. */
    forLoopExport(fps) {
      const c = this.clone();
      c.time = this.time - this.timeAtPhase(this.phase);
      c.phase = 0;
      c.playing = true;
      c.loopSamples = Math.round(c.loopSeconds * fps);
      c.settle();
      return c;
    }
  }

  Orb.OrbAnimator = OrbAnimator;
})();
