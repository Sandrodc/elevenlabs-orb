# ElevenLabs Orb Generator

A web tool for making the animated gradient orbs used on elevenlabs.io, with any colours you like.

Open `index.html` in a browser. There's no build step, and it also works from `file://`. You need a browser with WebGL2.

## How the orbs on elevenlabs.io work

The orbs on the site aren't videos or CSS gradients. Each one is a **WebGL2 fragment shader** drawn over a static PNG:

1. **Texture.** Every orb has a hand-painted 512×512 gradient image (`creative-1.png`, `agents-2.png`, …) made of soft colour fields and brush-like streaks. The idle state shows this PNG as an `<img>`. The shader canvas fades in on top of it once it's ready.
2. **Sphere mapping.** The shader squeezes the texture's UVs towards the rim, like a lens, so the flat image reads as a ball.
3. **FBM domain warp (the swirl).** Several layers of value-noise FBM push the UVs around. The push grows with distance from the centre, so the edges swirl most.
4. **Simplex drift.** A slow 3D simplex noise field adds gentle wobble across the whole orb.
5. **Grade.** Saturation, contrast and exposure (+0.15), then a circular alpha mask with analytic anti-aliasing.

The shader also has audio inputs: the user's mic level and the agent's playback level. They shrink or swell the orb (`uCircleSize`), speed up the swirl, and fade in a white highlight arc that sweeps around a noisy ring. All of them are zero when the orb is idle. This generator uses them for the Listening and Speaking states (see below). It leaves out the mouse fluid-sim input. On the site, `uTime` advances about 1.4 units per second. Here, a speed of `1.00×` matches that rate.

Values the site uses (read from the live uniforms). The generator uses the same values; they live in `DEFAULT_PARAMS` in `js/presets.js` and aren't exposed in the UI:

| Uniform | Value |
| --- | --- |
| `uFbmAmplitude` / `uFbmScale` | 0.65 / 3.25 |
| `uFbmSpeed` / `uFbmPower` | 4.5 / 2.75 |
| `uNoiseAmplitude` / `uNoiseScale` / `uNoiseSpeed` | 0.15 / 0.65 / 0.25 |
| `uSphereScale` / `uSpherePower` | 0.9 / 1.1 |
| `uExposure` / `uContrast` / `uSaturation` | 0.15 / 0 / 1 |

## Agent states

The switch under the orb (or keys `1` `2` `3`) sets what the orb is "doing". The animator lives in `js/animator.js`. Each state sets targets for the shader values, plus how strongly each value follows a synthetic voice level. A voice level is a speech-like loudness curve: syllables at about 4 Hz, grouped into phrases with short pauses.

| State | Voice | Effect |
| --- | --- | --- |
| **Idle** | — | The site's resting values. |
| **Listening** | user | Shrinks to about 80%, clearly smaller than the other states, and calms down: lower contrast and saturation, less swirl, slower, a little brighter. The highlight ring follows the user's voice, and the orb draws in slightly further while they talk. |
| **Speaking** | agent | Stronger and faster swirl, slightly brighter and more saturated. Each syllable makes the orb swell towards full size, makes the swirl surge, and flares the ring. |

- **Blending:** switching states blends every value over about 0.35 s with a critically damped ease, so nothing jumps.
- **Swirl speed:** the speed changes are added up over time rather than multiplying `uTime`. That way the swirl changes pace smoothly instead of skipping ahead.
- **Seamless loops:** in loop mode, the voice frequencies snap to whole cycles of the loop length. That makes Listening and Speaking loops seamless too.

To tune a state, edit `Orb.STATES` in `js/animator.js`. `base` holds the target values and `react` holds how much each value moves with the voice level.

## What this generator does differently

- **Generated textures.** The site uses fixed PNGs. Here, `js/texture.js` paints a texture from your palette and a seed:
  - colour fields placed loosely along a random light axis
  - a broad light and a broad shadow
  - soft bands across the middle
  - curved brush strokes around the rim

  The seed changes the layout and also offsets the noise field.
- **Light.** The site's PNGs have lighting painted in. A small key light plus rim term (`sheen`) stands in for it.
- **Grain.** Film grain is added in the shader, scaled to the orb's size so exports match the preview.
- **Seamless loop.** When this is on, the first half of each cycle cross-fades from `t + Λ` into `t`. Here `Λ` is the shader time gained over one loop in the current state. Frame `L` then lands exactly on frame 0, so exported videos loop with no jump.
- **Hairline edge.** The edge line is drawn in the shader, so it stays on the rim when the orb changes size.

## Files

```
index.html        markup
styles.css        UI styles (Inter / Geist Mono, ElevenLabs-style pills and tabs)
js/presets.js     palettes + shader defaults
js/texture.js     seeded gradient texture painter
js/renderer.js    WebGL2 renderer + shader
js/animator.js    agent states, synthetic voices, time + seamless-loop bookkeeping
js/exporter.js    PNG / video export, preset thumbnails
js/app.js         UI wiring, state, URL hash
```

## Exports

- **PNG:** 512 to 4096 px. Background can be transparent or solid, with optional padding and hairline edge.
- **Video:** MP4 (where `MediaRecorder` supports it) or WebM, at 720 or 1080 px, 30 or 60 fps.
  - **Real time:** the video records in real time while a copy of the animator steps at a fixed timestep. Keep the tab visible while it records. A hidden tab gets throttled timers, which would stretch the video, so the recording stops with a message instead.
  - **State:** the video captures the selected agent state.
  - **Background:** always solid, because browser encoders don't reliably keep alpha.

The current palette, seed and agent state are saved in the URL hash, so you can bookmark or share a look.

## Shortcuts

`Space` play/pause · `1` `2` `3` Idle / Listening / Speaking · `R` new seed · `←` / `→` previous / next preset
