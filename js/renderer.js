// WebGL2 orb renderer. The fragment shader is a port of the one running on
// elevenlabs.io: a gradient texture is mapped onto a sphere, then domain-warped
// by FBM (swirl) and simplex noise (drift). The site's audio-reactive inputs
// (orb size and the rotating highlight ring) are driven by the animator for the
// Listening / Speaking states; the mouse fluid-sim input is dropped.
(() => {
  const Orb = (window.Orb = window.Orb || {});

  const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uAlpha;
uniform vec2 uSeedOffset;
uniform float uResolution;

uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uGrain;
uniform float uSheen;
uniform float uEdge;

uniform float uCircleSize; // orb diameter as a fraction of the canvas
uniform float uRing;       // highlight ring intensity, 0..1
uniform float uRingShift;  // offsets the ring's noise shape

uniform float uNoiseSpeed;
uniform float uNoiseAmplitude;
uniform float uNoiseScale;

uniform float uSphereScale;
uniform float uSpherePower;

uniform float uFbmScale;
uniform float uFbmPower;
uniform float uFbmAmplitude;
uniform float uFbmSpeed;

// --- Simplex noise (Ashima / Stefan Gustavson) ---
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// --- Value-noise FBM (as on the site) ---
float random(in vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float noise(in vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = random(i);
  float b = random(i + vec2(1.0, 0.0));
  float c = random(i + vec2(0.0, 1.0));
  float d = random(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

#define NUM_OCTAVES 4
float fbm(in vec2 st) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < NUM_OCTAVES; ++i) {
    v += a * noise(st);
    st = rot * st * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

// --- Colour correction ---
vec3 contrast(vec3 color, float value) {
  return clamp(0.5 + (1.0 + value) * (color - 0.5), vec3(0.0), vec3(1.0));
}
vec3 exposure(vec3 color, float value) { return (1.0 + value) * color; }
vec3 saturation(vec3 rgb, float adjustment) {
  const vec3 W = vec3(0.2125, 0.7154, 0.0721);
  return mix(vec3(dot(rgb, W)), rgb, adjustment);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Orb-space UV: the orb can shrink inside the canvas (uCircleSize < 1).
  vec2 oUv = (vUv - 0.5) / uCircleSize + 0.5;

  // Sphere UV: compress the texture towards the rim like a lens.
  vec2 uvDot = (oUv - 0.5) * 2.0;
  float d = sqrt(1.0 - clamp(dot(uvDot, uvDot), 0.0, 1.0));
  d = pow(d, uSpherePower);
  vec3 normals = vec3(uvDot, d);
  uvDot /= (vec2(d) + 1.0) * (1.0 / uSphereScale);
  vec2 uv = (uvDot + 1.0) * 0.5;

  // FBM domain warp.
  float fbmTime = uTime * (uFbmSpeed * 0.5);
  vec2 fbmUv = uv * uFbmScale + uSeedOffset;
  vec2 q = vec2(fbm(fbmUv), fbm(fbmUv + vec2(1.0)));
  vec2 r = vec2(
    fbm(fbmUv + q + vec2(91.3, 0.55) + 0.15 * fbmTime),
    fbm(fbmUv + q - vec2(45.33, 1.2) + 0.126 * fbmTime)
  );
  float f = fbm(fbmUv + r);
  float ffbm = mix(0.8, 0.66, clamp((f * f) * uFbmPower, 0.0, 1.0));
  ffbm = mix(ffbm, 0.0, clamp(length(q), 0.0, 1.0));
  ffbm = mix(ffbm, 1.0, clamp(length(r.x), 0.0, 1.0));

  // Simplex drift.
  vec2 nUv = oUv * uNoiseScale + uSeedOffset * 0.37;
  float noiseX = snoise(vec3(nUv, uTime * uNoiseSpeed * 0.5));
  float noiseY = snoise(vec3(nUv + vec2(54.0), uTime * uNoiseSpeed));

  uv += normals.xy * (ffbm - 0.5) * uFbmAmplitude;
  uv += vec2(noiseX, noiseY) * uNoiseAmplitude;

  vec3 color = texture(uTexture, uv).rgb;

  // Soft key light from the top-left plus a faint rim, standing in for the
  // lighting that the site bakes into its texture images.
  vec3 n = normalize(vec3(normals.xy, max(sqrt(1.0 - clamp(dot(normals.xy, normals.xy), 0.0, 1.0)), 1e-3)));
  vec3 L = normalize(vec3(-0.45, 0.6, 0.65));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(diff, 18.0);
  float rim = pow(1.0 - n.z, 2.5);
  vec3 lit = color * (0.78 + 0.34 * diff) + vec3(0.16) * spec + vec3(0.1) * rim * diff;
  color = mix(color, lit, uSheen);

  // Highlight ring (ported from the site): a soft white arc that sweeps
  // around a noisy band, shown while someone is talking.
  if (uRing > 0.001) {
    const float innerRadius = 0.25;
    vec2 ringUv = (oUv - 0.5) * 2.0 * 0.75;
    float ang = atan(ringUv.y, ringUv.x);
    float len = length(ringUv);
    float ringTime = -uTime * 0.5;
    ringUv.x += 1.0 + uRingShift;
    float n0 = snoise(vec3(ringUv * (0.65 + uRing * 0.4), ringTime * 0.5)) * 0.5 + 0.5;
    float cl = cos(ang + ringTime * 2.0) * 0.5 + 0.5;
    float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
    float v3 = pow(smoothstep(innerRadius, mix(innerRadius, 1.0, n0 * 0.75), len), 2.0);
    cl = clamp(pow(cl * v2 * v3, 3.0), 0.0, 1.0) * uRing;
    color += vec3(cl) * 0.22;
  }

  color = saturation(color, uSaturation);
  color = contrast(color, uContrast);
  color = exposure(color, uExposure);

  // Film grain, sized relative to the orb so exports match the preview.
  float cell = max(1.0, uResolution / 900.0);
  color += (hash12(floor(gl_FragCoord.xy / cell)) - 0.5) * uGrain;
  color = clamp(color, 0.0, 1.0);

  // Circular mask with analytic anti-aliasing.
  float dist = length(oUv - 0.5) * 2.0;
  float aa = max(fwidth(dist), 1e-4);
  float s = 1.0 - smoothstep(1.0 - aa, 1.0, dist);

  // Hairline edge: ~1px of 10% black just inside the rim, like the site's
  // ring-black/10. Drawn here so it follows the orb when it changes size.
  color *= 1.0 - 0.1 * uEdge * smoothstep(1.0 - 2.5 * aa, 1.0 - 1.5 * aa, dist);

  float a = s * uAlpha;
  outColor = vec4(color * a, a);
}`;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader compile failed: ' + log);
    }
    return sh;
  }

  const UNIFORMS = {
    fbmAmplitude: 'uFbmAmplitude',
    fbmScale: 'uFbmScale',
    fbmPower: 'uFbmPower',
    fbmSpeed: 'uFbmSpeed',
    noiseAmplitude: 'uNoiseAmplitude',
    noiseScale: 'uNoiseScale',
    noiseSpeed: 'uNoiseSpeed',
    sphereScale: 'uSphereScale',
    spherePower: 'uSpherePower',
    exposure: 'uExposure',
    contrast: 'uContrast',
    saturation: 'uSaturation',
    grain: 'uGrain',
    sheen: 'uSheen',
    circleSize: 'uCircleSize',
    ring: 'uRing',
    ringShift: 'uRingShift',
    edge: 'uEdge',
  };

  class OrbRenderer {
    constructor(canvas, { preserveDrawingBuffer = false } = {}) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        preserveDrawingBuffer,
      });
      if (!gl) throw new Error('WebGL2 is not available in this browser.');
      this.gl = gl;

      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('Program link failed: ' + gl.getProgramInfoLog(prog));
      }
      this.prog = prog;
      gl.useProgram(prog);

      this.loc = {};
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const { name } = gl.getActiveUniform(prog, i);
        this.loc[name] = gl.getUniformLocation(prog, name);
      }

      this.vao = gl.createVertexArray();
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
      gl.uniform1i(this.loc.uTexture, 0);
      gl.uniform1f(this.loc.uCircleSize, 1);
    }

    setTexture(source) {
      const { gl } = this;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }

    setParams(params) {
      const { gl } = this;
      gl.useProgram(this.prog);
      for (const [key, name] of Object.entries(UNIFORMS)) {
        if (key in params && this.loc[name]) gl.uniform1f(this.loc[name], params[key]);
      }
    }

    setSeed(seed) {
      const rng = Orb.mulberry32(seed);
      this.gl.useProgram(this.prog);
      this.gl.uniform2f(this.loc.uSeedOffset, rng() * 40, rng() * 40);
    }

    resize(size) {
      size = Math.max(1, Math.round(size));
      if (this.canvas.width !== size || this.canvas.height !== size) {
        this.canvas.width = this.canvas.height = size;
      }
    }

    _draw(time, alpha) {
      const { gl } = this;
      gl.uniform1f(this.loc.uTime, time);
      gl.uniform1f(this.loc.uAlpha, alpha);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /**
     * Render one frame.
     * @param {number} time shader time
     * @param {{offset: number, weight: number}|null} loop seamless-loop
     *   cross-fade: draws `time` with `weight` and `time + offset` with
     *   `1 - weight`. See OrbAnimator.frame().
     */
    render(time, loop = null) {
      const { gl } = this;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.prog);
      gl.bindVertexArray(this.vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1f(this.loc.uResolution, this.canvas.width);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (!loop || loop.weight >= 1) {
        gl.disable(gl.BLEND);
        this._draw(time, 1);
        return;
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this._draw(time, loop.weight);
      this._draw(time + loop.offset, 1 - loop.weight);
      gl.disable(gl.BLEND);
    }
  }

  Orb.OrbRenderer = OrbRenderer;
})();
