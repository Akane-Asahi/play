// The "toy diorama" look: one small palette, toon shading with a soft 3-step ramp, and helpers that
// every mesh in the game goes through, so the whole scene stays consistent.
import * as THREE from 'three';

// One palette for everything. Generated models should be recoloured to these (see models/README.md).
export const PALETTE = {
  night: '#17130f', slab: '#2c2a26', slabSide: '#1e1b16',
  corridorA: '#d9c7a3', corridorB: '#cdb994', door: '#e8b85c', start: '#f2e3c2',
  wall: '#f3e6cf', wallTop: '#b98d5a', trim: '#7a5233',
  gold: '#ffd27a', beam: '#ffd87a', shadow: '#3b2a1e',
  // Room floors, by room card order: Kitchen, Ballroom, Conservatory, Dining Room, Billiard Room, Library, Lounge, Hall, Study
  floors: ['#9fc3a8', '#c9a8d8', '#a8d89a', '#e3a989', '#7fc6b7', '#c99b72', '#e7a1b4', '#e5cf8f', '#9fb1dc'],
  // Seat colours (seat 0 = Scarlett ...), same order as the 2D board
  seats: ['#e2453c', '#f2c230', '#f4f1ea', '#3fa45a', '#2f7fd8', '#9a4fc4'],
  skin: '#ffd9b8', ink: '#2a1f14',
};

// A 3-step toon ramp. NearestFilter keeps the steps crisp.
let ramp = null;
export function toonRamp() {
  if (ramp) return ramp;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

const cache = new Map();
// Toon material in a palette colour. Shared by colour so the GPU has fewer materials to switch.
export function toon(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: toonRamp(), ...opts });
  cache.set(key, m);
  return m;
}

// Give a loaded GLB the game's look: toon materials (keeping each part's base colour and texture),
// shadows on, and no stray transparency from the model generator.
export function stylize(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    const color = src && src.color ? '#' + src.color.getHexString() : '#cccccc';
    o.material = new THREE.MeshToonMaterial({ color, map: src && src.map ? src.map : null, gradientMap: toonRamp() });
    o.castShadow = true; o.receiveShadow = true;
  });
  return root;
}
