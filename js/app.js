(() => {
  const { PRESETS, DEFAULT_PARAMS, BASE_RATE } = Orb;
  const $ = (sel) => document.querySelector(sel);

  const BACKGROUNDS = { light: '#F3F2F0', white: '#FFFFFF', dark: '#0C0A09' };
  const MIN_COLORS = 2;
  const MAX_COLORS = 6;
  const SCRUB_WINDOW = 60; // seconds shown on the time slider when not looping
  const STATE_IDS = Object.keys(Orb.STATES);

  const state = {
    presetId: PRESETS[0].id,
    colors: [...PRESETS[0].colors],
    seed: 3150,
    background: 'light',
    customBg: '#F3F2F0',
    padding: 0,
    edge: true,
    pngSize: 2048,
    videoSeconds: 5,
    videoSize: 1080,
    videoFps: 30,
    videoFormat: null,
    recording: false,
    voiceInput: 'mic', // what drives Listening: 'mic' or 'sim' (synthetic voice)
  };

  // Time, playback, loop and the Idle / Listening / Speaking state.
  const anim = new Orb.OrbAnimator(DEFAULT_PARAMS);

  // ---------- URL hash (shareable state) ----------

  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const colors = (h.get('c') || '').split('-').filter((c) => /^[0-9a-f]{6}$/i.test(c));
    if (colors.length >= MIN_COLORS) {
      state.colors = colors.slice(0, MAX_COLORS).map((c) => '#' + c.toUpperCase());
      state.presetId = null;
    }
    const preset = PRESETS.find((p) => p.id === h.get('p'));
    if (preset) {
      state.presetId = preset.id;
      if (colors.length < MIN_COLORS) state.colors = [...preset.colors];
    }
    const seed = parseInt(h.get('s'), 10);
    if (Number.isFinite(seed)) state.seed = clampSeed(seed);
    if (Orb.STATES[h.get('st')]) {
      anim.setState(h.get('st'));
      anim.settle();
    }
  }

  let hashTimer = 0;
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const h = new URLSearchParams();
      if (state.presetId && samePalette(state.colors, presetById(state.presetId).colors)) {
        h.set('p', state.presetId);
      } else {
        h.set('c', state.colors.map((c) => c.slice(1)).join('-'));
      }
      h.set('s', state.seed);
      if (anim.state !== 'idle') h.set('st', anim.state);
      history.replaceState(null, '', '#' + h.toString());
    }, 250);
  }

  const presetById = (id) => PRESETS.find((p) => p.id === id);
  const samePalette = (a, b) => a.length === b.length && a.every((c, i) => c.toUpperCase() === b[i].toUpperCase());
  const clampSeed = (n) => Math.max(0, Math.min(99999, Math.round(n) || 0));

  // ---------- Renderer ----------

  const canvas = $('#orb');
  let renderer;
  try {
    renderer = new Orb.OrbRenderer(canvas);
  } catch (err) {
    console.error(err);
    $('#webglError').hidden = false;
    $('#orbWrap').hidden = true;
    return;
  }

  const texCanvas = document.createElement('canvas');
  let textureDirty = true;
  let needsRender = true;

  function sizeCanvas() {
    // offsetWidth ignores the padding preview's CSS scale.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.resize($('#orbWrap').offsetWidth * dpr);
    needsRender = true;
  }
  new ResizeObserver(sizeCanvas).observe($('#orbWrap'));

  let last = performance.now();
  let uiTick = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // While recording, leave the GPU to the exporter: frames that arrive late
    // get stretched timestamps in the video.
    if (state.recording) {
      requestAnimationFrame(frame);
      return;
    }
    if (anim.playing || anim.morphing) needsRender = true;
    anim.step(dt);
    if (textureDirty) {
      Orb.paintTexture(texCanvas, state.colors, state.seed, 512);
      renderer.setTexture(texCanvas);
      renderer.setSeed(state.seed);
      textureDirty = false;
      needsRender = true;
    }
    if (needsRender) {
      const f = anim.frame();
      renderer.setParams({ ...f.params, edge: state.edge ? 1 : 0 });
      renderer.render(f.time, f.loop);
      needsRender = false;
    }
    if (anim.mic && anim.playing) showMicLevel(anim.micLevel);
    if (anim.playing && now - uiTick > 100) {
      uiTick = now;
      syncTime();
    }
    requestAnimationFrame(frame);
  }

  // ---------- Helpers ----------

  function setRangeFill(input) {
    const min = +input.min;
    const max = +input.max;
    input.style.setProperty('--p', ((+input.value - min) / (max - min)) * 100 + '%');
  }

  function bindSegmented(el, onPick) {
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-v]');
      if (!btn || btn.disabled) return;
      setSegmented(el, btn.dataset.v);
      onPick(btn.dataset.v);
    });
  }

  function setSegmented(el, value) {
    el.querySelectorAll('button[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === String(value)));
    moveIndicator(el);
  }

  // One sliding "on" pill per segmented control (see .seg-indicator).
  const observedSegmented = new WeakSet();
  function initSegmented(el) {
    if (!el.querySelector(':scope > .seg-indicator')) {
      const ind = document.createElement('span');
      ind.className = 'seg-indicator';
      ind.setAttribute('aria-hidden', 'true');
      el.prepend(ind);
    }
    if (!observedSegmented.has(el)) {
      // Re-measure without animating when fonts load or the layout changes.
      // Buttons are observed too: a web font can resize them without changing
      // the control's own box.
      const ro = new ResizeObserver(() => moveIndicator(el, true));
      ro.observe(el);
      el.querySelectorAll('button').forEach((b) => ro.observe(b));
      observedSegmented.add(el);
    }
    moveIndicator(el, true);
  }

  function moveIndicator(el, instantly = false) {
    const ind = el.querySelector(':scope > .seg-indicator');
    if (!ind) return;
    const on = el.querySelector('button.on');
    if (!on) {
      ind.style.opacity = '0';
      return;
    }
    // Rects rather than offsetLeft/offsetWidth: flex segments have sub-pixel widths.
    const box = el.getBoundingClientRect();
    const r = on.getBoundingClientRect();
    if (instantly) ind.classList.add('no-anim');
    ind.style.opacity = '1';
    ind.style.width = r.width + 'px';
    ind.style.transform = `translateX(${r.left - box.left}px)`;
    if (instantly) {
      void ind.offsetWidth; // commit the jump before re-enabling transitions
      ind.classList.remove('no-anim');
    }
  }

  // Apply a change without motion: keyboard shortcuts are repeated often and
  // shouldn't animate.
  function instant(fn) {
    const root = document.documentElement;
    root.classList.add('instant');
    fn();
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('instant')));
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function markTexture() {
    textureDirty = true;
    syncCaption();
    writeHash();
  }

  // ---------- Presets ----------

  const presetsEl = $('#presets');
  function buildPresets() {
    presetsEl.innerHTML = '';
    for (const p of PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset';
      btn.setAttribute('role', 'option');
      btn.dataset.id = p.id;
      btn.title = p.name;
      btn.innerHTML = `<span class="preset-orb"><img alt=""></span><span>${p.name}</span>`;
      btn.addEventListener('click', () => applyPreset(p.id));
      presetsEl.appendChild(btn);
    }
    syncPresets();
    // Render thumbnails one per frame to keep the UI responsive.
    let i = 0;
    const next = () => {
      if (i >= PRESETS.length) return;
      const p = PRESETS[i];
      const img = presetsEl.children[i].querySelector('img');
      try {
        img.src = Orb.renderThumbnail(p.colors, 3150, DEFAULT_PARAMS, 128, 6);
        img.onload = () => img.classList.add('ready');
      } catch (err) {
        console.warn('Thumbnail failed', err);
      }
      i++;
      requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }

  function syncPresets() {
    for (const btn of presetsEl.children) {
      btn.setAttribute('aria-selected', btn.dataset.id === state.presetId ? 'true' : 'false');
    }
  }

  function applyPreset(id) {
    const p = presetById(id);
    if (!p) return;
    state.presetId = id;
    state.colors = [...p.colors];
    renderColors();
    syncPresets();
    markTexture();
  }

  function stepPreset(dir) {
    const idx = PRESETS.findIndex((p) => p.id === state.presetId);
    const next = (idx + dir + PRESETS.length) % PRESETS.length;
    applyPreset(PRESETS[idx === -1 ? 0 : next].id);
  }

  // ---------- Colors ----------

  const colorsEl = $('#colors');
  let morphTimer = 0;

  // Same number of colours: update the rows in place so the swatches blend
  // to their new colours. Otherwise rebuild.
  function renderColors() {
    if (colorsEl.children.length !== state.colors.length) {
      buildColors();
      return;
    }
    colorsEl.classList.add('morph');
    clearTimeout(morphTimer);
    morphTimer = setTimeout(() => colorsEl.classList.remove('morph'), 260);
    [...colorsEl.children].forEach((row, i) => {
      const hex = state.colors[i];
      const hexInput = row.querySelector('.hex');
      row.querySelector('.swatch').style.setProperty('--c', hex);
      row.querySelector('input[type=color]').value = hex.toLowerCase();
      hexInput.value = hex;
      hexInput.classList.remove('invalid');
    });
  }

  function buildColors() {
    colorsEl.innerHTML = '';
    state.colors.forEach((hex, i) => {
      const row = document.createElement('div');
      row.className = 'color-row';
      row.innerHTML = `
        <label class="swatch" style="--c:${hex}" title="Pick color">
          <input type="color" value="${hex.toLowerCase()}" aria-label="Color ${i + 1}">
        </label>
        <input class="hex" value="${hex}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex value ${i + 1}">
        <button class="icon-btn" type="button" title="Remove color" aria-label="Remove color ${i + 1}" ${state.colors.length <= MIN_COLORS ? 'disabled' : ''}>
          <svg><use href="#i-x"/></svg>
        </button>`;
      const picker = row.querySelector('input[type=color]');
      const hexInput = row.querySelector('.hex');
      const swatch = row.querySelector('.swatch');

      const setColor = (value, fromText) => {
        const v = value.toUpperCase();
        state.colors[i] = v;
        swatch.style.setProperty('--c', v);
        if (!fromText) hexInput.value = v;
        picker.value = v.toLowerCase();
        detachPreset();
        markTexture();
      };

      picker.addEventListener('input', () => setColor(picker.value, false));
      hexInput.addEventListener('input', () => {
        let v = hexInput.value.trim();
        if (!v.startsWith('#')) v = '#' + v;
        const ok = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
        hexInput.classList.toggle('invalid', !ok);
        if (ok) setColor(v.length === 4 ? '#' + v.slice(1).replace(/./g, '$&$&') : v, true);
      });
      hexInput.addEventListener('blur', () => {
        hexInput.value = state.colors[i];
        hexInput.classList.remove('invalid');
      });
      hexInput.addEventListener('keydown', (e) => e.key === 'Enter' && hexInput.blur());
      row.querySelector('.icon-btn').addEventListener('click', () => {
        if (state.colors.length <= MIN_COLORS) return;
        state.colors.splice(i, 1);
        detachPreset();
        buildColors();
        markTexture();
      });
      colorsEl.appendChild(row);
    });
    $('#addColor').disabled = state.colors.length >= MAX_COLORS;
  }

  function detachPreset() {
    if (state.presetId && !samePalette(state.colors, presetById(state.presetId).colors)) {
      state.presetId = null;
      syncPresets();
    }
  }

  $('#addColor').addEventListener('click', () => {
    if (state.colors.length >= MAX_COLORS) return;
    // Add a colour between the last two, so the palette stays coherent.
    const [a, b] = [state.colors[state.colors.length - 1], state.colors[0]].map(Orb.hexToRgb);
    const mix = a.map((v, k) => Math.round((v + b[k]) / 2 + (Math.random() * 40 - 20)));
    const hex = '#' + mix.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('').toUpperCase();
    state.colors.push(hex);
    detachPreset();
    buildColors();
    colorsEl.lastElementChild.classList.add('is-new');
    markTexture();
  });

  $('#randomPalette').addEventListener('click', () => {
    state.colors = Orb.randomPalette();
    state.presetId = null;
    syncPresets();
    renderColors();
    markTexture();
  });

  // ---------- Seed ----------

  const seedInput = $('#seed');
  function setSeed(n) {
    state.seed = clampSeed(n);
    seedInput.value = state.seed;
    markTexture();
  }
  seedInput.addEventListener('change', () => setSeed(+seedInput.value));
  seedInput.addEventListener('keydown', (e) => e.key === 'Enter' && seedInput.blur());
  let diceTurns = 0;
  $('#randomSeed').addEventListener('click', () => {
    diceTurns += 1;
    $('#randomSeed .dice').style.setProperty('--spin', diceTurns * 90 + 'deg');
    setSeed(Math.floor(Math.random() * 100000));
  });

  // ---------- Animation ----------

  const playBtn = $('#playToggle');
  function setPlaying(on) {
    anim.playing = on;
    playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    playBtn.setAttribute('aria-label', on ? 'Pause animation' : 'Play animation');
    $('#canvasCard').classList.toggle('is-paused', !on);
    syncTime();
  }
  playBtn.addEventListener('click', () => setPlaying(!anim.playing));

  const speedInput = $('#speed');
  speedInput.addEventListener('input', () => {
    anim.speed = +speedInput.value;
    $('#speedOut').textContent = anim.speed.toFixed(2) + '×';
    setRangeFill(speedInput);
    needsRender = true;
  });

  // Time slider: loop phase in seconds when looping, otherwise orb time
  // (shader time at 1× speed) within a rolling window.
  const timeInput = $('#time');
  function timeWindow() {
    return anim.loop ? anim.loopSeconds : SCRUB_WINDOW;
  }
  function syncTime() {
    const orbSeconds = Math.max(0, anim.time / BASE_RATE);
    const secs = anim.loop ? anim.phase : orbSeconds % SCRUB_WINDOW;
    timeInput.value = Math.round((secs / timeWindow()) * 1000);
    setRangeFill(timeInput);
    $('#timeOut').textContent = anim.loop ? `${secs.toFixed(1)} / ${anim.loopSeconds}s` : `${orbSeconds.toFixed(1)}s`;
  }
  timeInput.addEventListener('input', () => {
    const secs = (+timeInput.value / 1000) * timeWindow();
    if (anim.loop) {
      anim.seekLoop(secs);
    } else {
      const base = Math.floor(Math.max(0, anim.time) / BASE_RATE / SCRUB_WINDOW) * SCRUB_WINDOW;
      anim.time = (base + secs) * BASE_RATE;
    }
    needsRender = true;
    syncTime();
  });

  const loopInput = $('#loop');
  const loopLengthEl = $('#loopLength');
  function syncLoop() {
    loopLengthEl.classList.toggle('disabled', !anim.loop);
    const dur = $('#videoDuration');
    dur.classList.toggle('disabled', anim.loop);
    $('#videoNote').textContent = anim.loop
      ? `Loop is on — the video will be exactly one ${anim.loopSeconds}s seamless loop.` +
        (state.voiceInput === 'mic' ? ' Listening uses the simulated voice so it can repeat.' : '')
      : 'Turn on Seamless loop for videos that repeat without a jump.';
    syncTime();
  }
  loopInput.addEventListener('change', () => {
    anim.setLoop(loopInput.checked);
    needsRender = true;
    syncLoop();
  });
  bindSegmented(loopLengthEl, (v) => {
    anim.setLoopSeconds(+v);
    needsRender = true;
    syncLoop();
  });

  // ---------- Canvas ----------

  const card = $('#canvasCard');
  const bgEl = $('#background');
  const customBg = $('#customBg');
  const customLabel = customBg.closest('.seg-color');

  function backgroundColor() {
    if (state.background === 'transparent') return null;
    if (state.background === 'custom') return state.customBg;
    return BACKGROUNDS[state.background];
  }

  function isDark(hex) {
    const [r, g, b] = Orb.hexToRgb(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
  }

  function syncBackground() {
    const bg = backgroundColor();
    card.classList.toggle('is-transparent', !bg);
    card.classList.toggle('is-dark', !!bg && isDark(bg));
    card.style.setProperty('--stage-bg', bg || '#FFFFFF');
    setSegmented(bgEl, state.background);
    customLabel.classList.toggle('on', state.background === 'custom');
    customLabel.classList.toggle('has-color', state.background === 'custom');
    customLabel.style.setProperty('--c', state.customBg);
  }
  bindSegmented(bgEl, (v) => {
    state.background = v;
    syncBackground();
  });
  customBg.addEventListener('input', () => {
    state.background = 'custom';
    state.customBg = customBg.value.toUpperCase();
    syncBackground();
  });
  customBg.addEventListener('click', () => {
    state.background = 'custom';
    syncBackground();
  });

  const paddingInput = $('#padding');
  function syncPadding() {
    $('#paddingOut').textContent = Math.round(state.padding * 100) + '%';
    setRangeFill(paddingInput);
    $('#orbWrap').style.transform = `scale(${1 - state.padding * 2})`;
  }
  paddingInput.addEventListener('input', () => {
    state.padding = +paddingInput.value;
    syncPadding();
  });

  $('#edge').addEventListener('change', (e) => {
    state.edge = e.target.checked;
    needsRender = true;
  });

  // ---------- Agent state ----------

  const stateEl = $('#orbState');
  // `fromUser`: picked with a click or key press, which browsers require
  // before they'll start the microphone.
  function setAgentState(id, fromUser = false) {
    if (!Orb.STATES[id]) return;
    anim.setState(id);
    setSegmented(stateEl, id);
    card.dataset.state = id;
    writeHash();
    syncMic(fromUser);
  }
  bindSegmented(stateEl, (v) => setAgentState(v, true));

  // ---------- Microphone (Listening input) ----------

  const mic = new Orb.MicInput();
  // off | waiting (needs a click) | pending (permission prompt) | live | blocked | unsupported
  let micStatus = 'off';
  const micIcon = stateEl.querySelector('.i-mic');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const MIC_NOTES = {
    sim: 'A simulated voice drives the Listening state.',
    off: 'Your mic turns on while the orb is Listening.',
    waiting: 'Select Listening to turn on your mic.',
    pending: 'Waiting for microphone permission…',
    live: 'Mic live — the orb follows your voice.',
    blocked: 'Mic blocked or unavailable — using a simulated voice.',
    unsupported: 'Mic needs a secure page (https or localhost) — using a simulated voice.',
  };

  function micWanted() {
    return anim.state === 'listening' && state.voiceInput === 'mic';
  }

  function syncMicUI() {
    $('#micNote').textContent = MIC_NOTES[state.voiceInput === 'sim' ? 'sim' : micStatus];
    $('#micMeter').hidden = micStatus !== 'live';
    card.dataset.mic = micStatus === 'live' ? 'live' : '';
    if (micStatus !== 'live') showMicLevel(0);
  }

  function showMicLevel(level) {
    $('#micMeterBar').style.transform = `scaleX(${level.toFixed(3)})`;
    micIcon.style.transform = level && !reduceMotion.matches ? `scale(${(1 + level * 0.35).toFixed(3)})` : '';
  }

  function releaseMic() {
    mic.stop();
    anim.mic = null;
    anim.micLevel = 0;
  }

  async function syncMic(fromUser) {
    if (!micWanted()) {
      releaseMic();
      micStatus = 'off';
    } else if (mic.active || micStatus === 'pending') {
      // already running or asking
    } else if (!Orb.MicInput.supported) {
      micStatus = 'unsupported';
    } else if (!fromUser) {
      micStatus = 'waiting';
    } else {
      micStatus = 'pending';
      syncMicUI();
      try {
        await mic.start();
        // The state may have changed while the permission prompt was open.
        if (micWanted()) {
          anim.mic = mic;
          micStatus = 'live';
        } else {
          releaseMic();
          micStatus = 'off';
        }
      } catch (err) {
        console.warn('Microphone unavailable:', err);
        micStatus = 'blocked';
        toast('Microphone unavailable — using a simulated voice');
      }
    }
    syncMicUI();
  }

  mic.onended = () => {
    releaseMic();
    micStatus = 'blocked';
    syncMicUI();
    toast('Microphone disconnected — using a simulated voice');
  };

  bindSegmented($('#voiceInput'), (v) => {
    state.voiceInput = v;
    syncMic(true);
    syncLoop();
  });

  // ---------- Caption ----------

  function syncCaption() {
    const p = state.presetId && presetById(state.presetId);
    $('#captionName').textContent = p ? p.name : 'Custom';
    $('#captionSeed').textContent = '#' + state.seed;
  }

  // ---------- Export ----------

  function exportState() {
    return {
      colors: [...state.colors],
      seed: state.seed,
      presetId: state.presetId,
      agentState: anim.state,
      backgroundColor: backgroundColor(),
      padding: state.padding,
      edge: state.edge,
    };
  }

  bindSegmented($('#pngSize'), (v) => (state.pngSize = +v));
  $('#exportPng').addEventListener('click', async () => {
    const btn = $('#exportPng');
    btn.disabled = true;
    try {
      await Orb.exportPNG(exportState(), state.pngSize, anim.frame());
      toast(`Saved ${state.pngSize}×${state.pngSize} PNG`);
    } catch (err) {
      console.error(err);
      toast('PNG export failed — try a smaller size');
    } finally {
      btn.disabled = state.recording;
    }
  });

  const formats = Orb.videoFormats();
  const formatEl = $('#videoFormat');
  if (!formats.length) {
    formatEl.innerHTML = '<button type="button" disabled>Unsupported</button>';
    $('#exportVideo').disabled = true;
  } else {
    formatEl.innerHTML = formats.map((f, i) => `<button type="button" data-v="${f.id}" class="${i === 0 ? 'on' : ''}">${f.label}</button>`).join('');
    state.videoFormat = formats[0];
    bindSegmented(formatEl, (v) => (state.videoFormat = formats.find((f) => f.id === v)));
  }
  bindSegmented($('#videoDuration'), (v) => (state.videoSeconds = +v));
  bindSegmented($('#videoSize'), (v) => (state.videoSize = +v));
  bindSegmented($('#videoFps'), (v) => (state.videoFps = +v));

  $('#exportVideo').addEventListener('click', async () => {
    if (state.recording || !state.videoFormat) return;
    const btn = $('#exportVideo');
    const label = $('#exportVideoLabel');
    const bar = $('#videoProgress');
    state.recording = true;
    btn.disabled = true;
    $('#exportPng').disabled = true;
    btn.classList.add('is-recording');
    const seconds = anim.loop ? anim.loopSeconds : state.videoSeconds;
    // A loop records from phase 0 in its settled state, so the file starts
    // and ends on the seam; otherwise continue from the current frame.
    const animator = anim.loop ? anim.forLoopExport(state.videoFps) : Object.assign(anim.clone(), { playing: true });
    try {
      await Orb.exportVideo(
        exportState(),
        {
          size: state.videoSize,
          seconds,
          fps: state.videoFps,
          format: state.videoFormat,
          animator,
        },
        (p) => {
          bar.style.transform = `scaleX(${p})`;
          label.textContent = `Recording… ${Math.round(p * 100)}%`;
        }
      );
      toast(`Saved ${seconds}s ${state.videoFormat.label}`);
    } catch (err) {
      console.error(err);
      toast(err.code === 'hidden' ? 'Recording stopped — keep this tab visible while recording' : 'Video export failed');
    } finally {
      state.recording = false;
      btn.disabled = false;
      $('#exportPng').disabled = false;
      btn.classList.remove('is-recording');
      bar.style.transform = '';
      label.textContent = 'Record video';
    }
  });

  // ---------- Keyboard ----------

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' && !['range', 'checkbox'].includes(e.target.type)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      instant(() => setPlaying(!anim.playing));
    } else if (/^[1-9]$/.test(e.key) && STATE_IDS[+e.key - 1]) {
      instant(() => setAgentState(STATE_IDS[+e.key - 1], true));
    } else if (e.key === 'r' || e.key === 'R') {
      instant(() => setSeed(Math.floor(Math.random() * 100000)));
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target.type !== 'range') {
      instant(() => stepPreset(e.key === 'ArrowRight' ? 1 : -1));
    }
  });

  // ---------- Init ----------

  readHash();
  document.querySelectorAll('.segmented, .state-switch').forEach(initSegmented);
  seedInput.value = state.seed;
  speedInput.value = anim.speed;
  setRangeFill(speedInput);
  setRangeFill(timeInput);
  buildPresets();
  buildColors();
  syncBackground();
  syncPadding();
  syncLoop();
  syncCaption();
  setAgentState(anim.state);
  requestAnimationFrame(frame);
  // index.html starts with .instant so the first paint doesn't animate.
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('instant')));
})();
