// Loads the generated 3D models listed in models/manifest.json. A slot set to null keeps its stand-in
// (primitive pawn or placeholder furniture), so the game always runs, with or without models.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { stylize } from './look.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export async function loadManifest(base = 'models/') {
  try {
    const res = await fetch(base + 'manifest.json', { cache: 'no-cache' });
    return res.ok ? await res.json() : {};
  } catch { return {}; }
}

// Loads every non-null slot. onEach(kind, name, sceneObject, gltf) is called as each one arrives.
// A model that fails to load is skipped with a console warning (the stand-in stays).
export async function loadModels(manifest, onEach, base = 'models/') {
  const jobs = [];
  for (const kind of ['rooms', 'suspects', 'weapons']) {
    for (const [name, file] of Object.entries(manifest[kind] || {})) {
      if (!file) continue;
      jobs.push(loader.loadAsync(base + file)
        .then((gltf) => onEach(kind, name, stylize(gltf.scene), gltf))
        .catch((e) => console.warn('Model not loaded:', kind, name, file, e.message)));
    }
  }
  await Promise.all(jobs);
}
