// Palettes sampled from the orbs on elevenlabs.io (dominant colours of each
// source texture), plus a few extra moods in the same spirit.
(() => {
  const Orb = (window.Orb = window.Orb || {});

  Orb.PRESETS = [
    { id: 'ember',    name: 'Ember',    colors: ['#B83A14', '#E5561F', '#F47443', '#FC9A67', '#FFC994'] },
    { id: 'iris',     name: 'Iris',     colors: ['#6E63F0', '#9683E0', '#F28AE6', '#7FB0FF', '#E7C6F5'] },
    { id: 'cocoa',    name: 'Cocoa',    colors: ['#180D0D', '#451E1B', '#80392F', '#CB6C5E', '#D8BBDD'] },
    { id: 'moss',     name: 'Moss',     colors: ['#3E4F31', '#966637', '#C79F57', '#FFC37B', '#9DB58A'] },
    { id: 'mint',     name: 'Mint',     colors: ['#76BF8F', '#A5E7D6', '#F9D898', '#F6A96B', '#A9B9FF'] },
    { id: 'pine',     name: 'Pine',     colors: ['#193530', '#396357', '#55816F', '#79A28E', '#C3D6CB'] },
    { id: 'sky',      name: 'Sky',      colors: ['#2E9CC2', '#8ECFEC', '#B0E3F7', '#7CB5B3', '#EDE59A'] },
    { id: 'pearl',    name: 'Pearl',    colors: ['#C6CAC5', '#E4E6E1', '#F6F6F4', '#B5C6B8', '#DCE7DE'] },
    { id: 'opal',     name: 'Opal',     colors: ['#F7E5BF', '#DCEFD6', '#F6CFC2', '#CFE2F2', '#FFF8EA'] },
    { id: 'graphite', name: 'Graphite', colors: ['#1E1E1E', '#4A4A4A', '#8C8C8C', '#C9C9C9', '#F2F2F2'] },
    { id: 'terra',    name: 'Terra',    colors: ['#1D3B6B', '#2F6F3E', '#3D7FD6', '#8FC46B', '#E48A3C'] },
    { id: 'dusk',     name: 'Dusk',     colors: ['#2A1B4D', '#6B3FA0', '#E0607E', '#F6A96B', '#FFD6A5'] },
  ];

  // Shader defaults read straight from the live site's WebGL uniforms.
  Orb.DEFAULT_PARAMS = {
    fbmAmplitude: 0.65,   // uFbmAmplitude — swirl strength
    fbmScale: 3.25,       // uFbmScale     — size of the swirls
    fbmPower: 2.75,       // uFbmPower
    fbmSpeed: 4.5,        // uFbmSpeed
    noiseAmplitude: 0.15, // uNoiseAmplitude — slow simplex drift
    noiseScale: 0.65,     // uNoiseScale
    noiseSpeed: 0.25,     // uNoiseSpeed
    sphereScale: 0.9,     // uSphereScale
    spherePower: 1.1,     // uSpherePower
    exposure: 0.15,       // uExposure
    contrast: 0,          // uContrast
    saturation: 1,        // uSaturation
    grain: 0.06,          // baked into the site's textures; done in-shader here
    sheen: 0.2,           // the site bakes lighting into its textures; this replaces it
    circleSize: 1,        // uCircleSize — orb diameter within the canvas
    ring: 0,              // highlight ring intensity (site: driven by audio level)
    ringShift: 0,         // ring noise offset (site: output minus input audio)
  };

  // uTime on the site advances ~1.4 units per second.
  Orb.BASE_RATE = 1.4;
})();
