// PNG and video export. Uses its own renderer + canvas so exports can be any
// size without disturbing the live preview.
(() => {
  const Orb = (window.Orb = window.Orb || {});

  // Separate renderers for stills/thumbnails and video, so a PNG export can't
  // resize or retexture a recording in progress.
  const renderers = {};
  function getRenderer(kind = 'still') {
    if (!renderers[kind]) {
      renderers[kind] = new Orb.OrbRenderer(document.createElement('canvas'), { preserveDrawingBuffer: true });
    }
    return renderers[kind];
  }

  /**
   * Draw the orb (already rendered into `source`) onto a 2D canvas with
   * background and padding. The hairline edge is drawn by the shader.
   */
  function compose(ctx, size, source, opts) {
    const { background, padding } = opts;
    ctx.clearRect(0, 0, size, size);
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, size, size);
    }
    const orbSize = size * (1 - padding * 2);
    const off = (size - orbSize) / 2;
    ctx.drawImage(source, off, off, orbSize, orbSize);
  }

  function prepare(state, size, kind) {
    const r = getRenderer(kind);
    const orbSize = Math.round(size * (1 - state.padding * 2));
    r.resize(orbSize);
    r.setTexture(Orb.paintTexture(Orb._exportTex || (Orb._exportTex = document.createElement('canvas')), state.colors, state.seed, 1024));
    r.setSeed(state.seed);
    return r;
  }

  // Render one animator frame ({ time, params, loop }).
  function renderFrame(r, frame, edge) {
    r.setParams({ ...frame.params, edge: edge ? 1 : 0 });
    r.render(frame.time, frame.loop);
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function baseName(state) {
    return `elevenlabs-orb-${state.presetId || 'custom'}-${state.seed}-${state.agentState}`;
  }

  Orb.exportPNG = async function exportPNG(state, size, frame) {
    const r = prepare(state, size);
    renderFrame(r, frame, state.edge);
    const out = document.createElement('canvas');
    out.width = out.height = size;
    compose(out.getContext('2d'), size, r.canvas, {
      background: state.backgroundColor,
      padding: state.padding,
    });
    const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
    download(blob, `${baseName(state)}-${size}.png`);
  };

  Orb.videoFormats = function videoFormats() {
    if (typeof MediaRecorder === 'undefined') return [];
    const candidates = [
      { id: 'mp4', label: 'MP4', mime: 'video/mp4;codecs=avc1.640028', ext: 'mp4' },
      { id: 'mp4', label: 'MP4', mime: 'video/mp4', ext: 'mp4' },
      { id: 'webm', label: 'WebM', mime: 'video/webm;codecs=vp9', ext: 'webm' },
      { id: 'webm', label: 'WebM', mime: 'video/webm', ext: 'webm' },
    ];
    const seen = new Set();
    return candidates.filter((c) => {
      if (seen.has(c.id) || !MediaRecorder.isTypeSupported(c.mime)) return false;
      seen.add(c.id);
      return true;
    });
  };

  /**
   * Record a video in real time. `animator` (an OrbAnimator copy) is stepped
   * at a fixed 1/fps, so the content is deterministic even if the browser
   * drops a frame.
   */
  Orb.exportVideo = async function exportVideo(state, opts, onProgress) {
    const { size, seconds, fps, format, animator } = opts;
    const r = prepare(state, size, 'video');

    const out = document.createElement('canvas');
    out.width = out.height = size;
    const ctx = out.getContext('2d');
    const composeOpts = {
      // Video codecs here don't reliably carry alpha, so always fill.
      background: state.backgroundColor || '#FDFCFC',
      padding: state.padding,
    };

    const frames = Math.round(seconds * fps);
    const draw = () => {
      renderFrame(r, animator.frame(), state.edge);
      compose(ctx, size, r.canvas, composeOpts);
    };
    draw();

    const stream = out.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const recorder = new MediaRecorder(stream, {
      mimeType: format.mime,
      videoBitsPerSecond: Math.round(size * size * fps * 0.12),
    });
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => (recorder.onstop = res));
    // Only start pushing frames once the encoder is live; otherwise the file
    // gets a lead-in gap and loops stutter at the seam.
    await new Promise((res) => {
      recorder.onstart = res;
      recorder.start();
    });

    const t0 = performance.now();
    let interrupted = false;
    for (let i = 0; i < frames; i++) {
      // Hidden tabs get throttled timers, which would stretch the video.
      if (document.hidden) {
        interrupted = true;
        break;
      }
      if (i > 0) {
        animator.step(1 / fps);
        draw();
      }
      if (track.requestFrame) track.requestFrame();
      onProgress && onProgress((i + 1) / frames);
      const due = t0 + ((i + 1) * 1000) / fps;
      await new Promise((res) => setTimeout(res, Math.max(0, due - performance.now())));
    }
    recorder.stop();
    await done;
    track.stop();
    if (interrupted) {
      const err = new Error('Recording interrupted: the tab was hidden');
      err.code = 'hidden';
      throw err;
    }
    const blob = new Blob(chunks, { type: format.mime.split(';')[0] });
    download(blob, `${baseName(state)}-${size}-${seconds}s.${format.ext}`);
  };

  // Small static previews for the preset grid.
  Orb.renderThumbnail = function renderThumbnail(colors, seed, params, size, time) {
    const r = getRenderer();
    r.resize(size);
    r.setTexture(Orb.paintTexture(Orb._thumbTex || (Orb._thumbTex = document.createElement('canvas')), colors, seed, 256));
    r.setParams({ edge: 0, ...params });
    r.setSeed(seed);
    r.render(time);
    return r.canvas.toDataURL('image/png');
  };
})();
