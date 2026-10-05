// Builds the soft "painted" gradient texture that the orb shader warps.
// On elevenlabs.io these are hand-made PNGs; here they're generated from a
// palette + seed so any colour combination works.
(() => {
  const Orb = (window.Orb = window.Orb || {});

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function luminance([r, g, b]) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
  const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

  const supportsFilter = (() => {
    const ctx = document.createElement('canvas').getContext('2d');
    return ctx && typeof ctx.filter === 'string';
  })();

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Soft elliptical dab of colour. `core` is how much of the radius stays
  // near full opacity before falling off.
  function blob(ctx, rgb, { x, y, r, aspect = 1, rot = 0, alpha = 1, core = 0.4 }) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(aspect, 1 / aspect);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, rgba(rgb, alpha));
    g.addColorStop(core, rgba(rgb, alpha * 0.9));
    g.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }

  // A curved stroke built from overlapping dabs along a bending path.
  function brush(ctx, rng, size, rgb) {
    // Start on a ring around the centre and head roughly tangentially, so
    // strokes wrap around the sphere instead of crossing its (magnified) middle.
    const a = rng() * Math.PI * 2;
    const rad = (0.22 + rng() * 0.26) * size;
    let x = size / 2 + Math.cos(a) * rad;
    let y = size / 2 + Math.sin(a) * rad;
    let dir = a + Math.PI / 2 * (rng() < 0.5 ? 1 : -1) + (rng() * 2 - 1) * 0.5;
    const bend = (rng() * 2 - 1) * 0.12;
    const steps = 10 + Math.floor(rng() * 10);
    const stepLen = size * (0.018 + rng() * 0.012);
    const width = size * (0.03 + rng() * 0.045);
    for (let k = 0; k < steps; k++) {
      const taper = Math.sin((k / (steps - 1)) * Math.PI);
      blob(ctx, rgb, { x, y, r: width * (0.4 + 0.6 * taper), aspect: 1.6, rot: dir, alpha: 0.34 * taper, core: 0.25 });
      dir += bend;
      x += Math.cos(dir) * stepLen;
      y += Math.sin(dir) * stepLen;
    }
  }

  /**
   * Paint a gradient texture into `canvas`.
   * @param {HTMLCanvasElement} canvas
   * @param {string[]} colors hex colours, 1+
   * @param {number} seed
   * @param {number} size square texture size in px
   */
  Orb.paintTexture = function paintTexture(canvas, colors, seed, size = 512) {
    if (canvas.width !== size) canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const rng = mulberry32(seed * 9301 + 49297);
    const rgbs = colors.map(hexToRgb);
    const byLum = [...rgbs].sort((a, b) => luminance(a) - luminance(b));
    // Deeper shadow and brighter highlight tones derived from the palette
    // give the warped result the contrast of the site's painted textures.
    const shadow = mixRgb(byLum[0], [0, 0, 0], 0.3);
    const highlight = mixRgb(byLum[byLum.length - 1], [255, 255, 255], 0.45);

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';

    // Colours are laid out along a random "light" axis — darkest tones on
    // one side, lightest on the other — which gives the warped result the
    // depth and contrast of the hand-painted textures on elevenlabs.io.
    const n = byLum.length;
    const theta = rng() * Math.PI * 2;
    const ax = Math.cos(theta);
    const ay = Math.sin(theta);
    const c = size / 2;
    const jitter = () => (rng() * 2 - 1);

    // Base: mid tone, then a broad shadow and a broad light on opposite
    // sides. Radial only — straight gradients show up as hard bands once
    // the sphere mapping magnifies the middle of the texture.
    ctx.fillStyle = rgba(byLum[Math.floor((n - 1) / 2)], 1);
    ctx.fillRect(0, 0, size, size);
    blob(ctx, byLum[0], { x: c - ax * size * 0.42, y: c - ay * size * 0.42, r: size * 0.75, alpha: 0.85, core: 0.25 });
    blob(ctx, byLum[n - 1], { x: c + ax * size * 0.42, y: c + ay * size * 0.42, r: size * 0.7, alpha: 0.8, core: 0.2 });

    // Colour fields loosely positioned by luminance so the centre of the orb
    // still gets both dark and light patches. Mid tones get more fields than
    // the extremes, matching the balance of the site's textures.
    const fields = [];
    byLum.forEach((rgb, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const count = n <= 2 ? 3 : i === 0 || i === n - 1 ? 2 : 4;
      for (let k = 0; k < count; k++) fields.push({ rgb, t });
    });
    for (const { rgb, t } of shuffle(fields, rng)) {
      const along = (t - 0.5) * 0.55 + jitter() * 0.3;
      const across = jitter() * 0.42;
      blob(ctx, rgb, {
        x: c + (ax * along - ay * across) * size,
        y: c + (ay * along + ax * across) * size,
        r: (0.13 + rng() * 0.17) * size,
        aspect: 0.65 + rng() * 0.9,
        rot: rng() * Math.PI,
        alpha: 0.95,
        core: 0.35 + rng() * 0.25,
      });
    }

    // Broad light and shadow over the fields, like a lit sphere.
    blob(ctx, shadow, { x: c - ax * size * 0.5, y: c - ay * size * 0.5, r: size * 0.6, alpha: 0.45, core: 0.2 });
    blob(ctx, highlight, { x: c + ax * size * 0.45, y: c + ay * size * 0.45, r: size * 0.5, alpha: 0.28, core: 0.15 });

    // One or two soft bands across the middle, so the centre of the orb has
    // structure too (the swirl warp is weakest there).
    const bands = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < bands; i++) {
      const tone = i === 0 ? byLum[Math.max(0, Math.floor(n / 2) - 1)] : byLum[n - 1];
      blob(ctx, tone, {
        x: c + jitter() * size * 0.18,
        y: c + jitter() * size * 0.18,
        r: (0.3 + rng() * 0.12) * size,
        aspect: 2.6 + rng() * 1.2,
        rot: theta + Math.PI / 2 + jitter() * 0.6,
        alpha: 0.4,
        core: 0.2,
      });
    }

    // Pockets of shadow on the dark side.
    for (let i = 0; i < 2; i++) {
      const along = -0.15 - rng() * 0.25;
      const across = jitter() * 0.35;
      blob(ctx, shadow, {
        x: c + (ax * along - ay * across) * size,
        y: c + (ay * along + ax * across) * size,
        r: (0.08 + rng() * 0.1) * size,
        aspect: 1 + rng(),
        rot: rng() * Math.PI,
        alpha: 0.65,
        core: 0.3,
      });
    }

    // Curved brush strokes give the swirl something to grab onto, like the
    // painted streaks in the site's textures.
    const strokeTones = [...byLum, highlight, highlight, shadow];
    const strokes = 5 + Math.floor(rng() * 4);
    for (let i = 0; i < strokes; i++) {
      const rgb = strokeTones[Math.floor(rng() * strokeTones.length)];
      brush(ctx, rng, size, rgb);
    }

    // A bright accent on the lit side.
    {
      const along = 0.15 + rng() * 0.25;
      const across = jitter() * 0.3;
      blob(ctx, highlight, {
        x: c + (ax * along - ay * across) * size,
        y: c + (ay * along + ax * across) * size,
        r: (0.07 + rng() * 0.08) * size,
        aspect: 1.2 + rng(),
        rot: rng() * Math.PI,
        alpha: 0.6,
        core: 0.25,
      });
    }

    ctx.restore();

    // Soften everything so the shader warps smooth fields, not edges.
    if (supportsFilter) {
      const tmp = Orb._blurScratch || (Orb._blurScratch = document.createElement('canvas'));
      tmp.width = tmp.height = size;
      const tctx = tmp.getContext('2d');
      tctx.clearRect(0, 0, size, size);
      tctx.drawImage(canvas, 0, 0);
      ctx.save();
      ctx.filter = `blur(${Math.round(size * 0.014)}px)`;
      // Draw slightly oversized so the blur doesn't pull in transparent edges.
      const pad = size * 0.08;
      ctx.drawImage(tmp, -pad, -pad, size + pad * 2, size + pad * 2);
      ctx.restore();
    }
    return canvas;
  };

  Orb.mulberry32 = mulberry32;
  Orb.hexToRgb = hexToRgb;

  // Harmonious random palette: a base hue with analogous neighbours and an
  // occasional complementary accent, spread across lightness.
  Orb.randomPalette = function randomPalette(rng = Math.random) {
    const hue = rng() * 360;
    const spread = 20 + rng() * 50;
    const accent = rng() < 0.45;
    const count = 4 + Math.floor(rng() * 2);
    const sat = 45 + rng() * 45;
    const out = [];
    for (let i = 0; i < count; i++) {
      let h = hue + (i - count / 2) * (spread / count) * 2;
      if (accent && i === count - 1) h = hue + 150 + rng() * 60;
      const l = 22 + (i / (count - 1)) * 62 + (rng() * 10 - 5);
      const s = Math.max(20, Math.min(100, sat + (rng() * 30 - 15)));
      out.push(hslToHex(((h % 360) + 360) % 360, s, Math.max(8, Math.min(94, l))));
    }
    return shuffle(out, rng);
  };

  function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${to(f(0))}${to(f(8))}${to(f(4))}`.toUpperCase();
  }
})();
