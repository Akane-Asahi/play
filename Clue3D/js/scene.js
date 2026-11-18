// Renderer, camera, lights and controls. The camera is fixed at a high angle looking down on the board
// (a narrow field of view so it reads almost isometric), like a toy diorama on a table.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PALETTE } from './look.js';

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // phones: cap at 2 for speed
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.night);
  scene.fog = new THREE.Fog(PALETTE.night, 38, 70);

  // ~30° field of view from far away: close to isometric, but with a little depth.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  const home = { pos: new THREE.Vector3(0, 27, 24), target: new THREE.Vector3(0, 0, 0.6) };
  camera.position.copy(home.pos);

  // Warm key light with soft shadows + cool sky fill: the toy-on-a-table look.
  const sun = new THREE.DirectionalLight('#fff1d6', 2.6);
  sun.position.set(-10, 22, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 60 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
  scene.add(sun, new THREE.HemisphereLight('#cfe3ff', '#5a4632', 1.25));

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(home.target);
  controls.enableDamping = true;
  controls.enableRotate = true;
  // Keep the diorama angle: only a little turning, no looking from below, zoom within limits.
  controls.minPolarAngle = 0.3; controls.maxPolarAngle = 0.95;
  controls.minAzimuthAngle = -0.5; controls.maxAzimuthAngle = 0.5;
  controls.minDistance = 12; controls.maxDistance = 48;
  controls.screenSpacePanning = false;
  controls.update();

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Pull back until the whole board (about 18 units wide) fits across. Portrait phones also look
    // more steeply down, so the board uses the tall screen, and aim a bit lower to clear the dock.
    const portrait = w < h;
    const dir = portrait ? new THREE.Vector3(0, 30, 15).normalize() : home.pos.clone().sub(home.target).normalize();
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const dist = Math.max(home.pos.distanceTo(home.target), 9.8 / Math.tan(hfov / 2));
    controls.maxDistance = Math.max(48, dist * 1.25);
    controls.target.copy(home.target).add(new THREE.Vector3(0, 0, portrait ? 1.6 : 0.9));
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    scene.fog.near = dist * 1.05; scene.fog.far = dist * 2.2; // fog only past the board's far edge
    camera.far = dist * 3;
    camera.updateProjectionMatrix();
    controls.update();
  }
  window.addEventListener('resize', resize);
  resize();

  // Smoothly move the camera to look at a point (e.g. the room where a suggestion happens).
  function focus(point, dist = null) {
    const off = camera.position.clone().sub(controls.target);
    if (dist) off.setLength(dist);
    return { from: { t: controls.target.clone(), p: camera.position.clone() }, to: { t: point.clone(), p: point.clone().add(off) } };
  }

  return { renderer, scene, camera, controls, sun, resize, focus, home };
}
