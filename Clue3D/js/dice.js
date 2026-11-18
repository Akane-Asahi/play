// Two chunky dice that tumble and bounce onto the table, then land showing the rolled values.
// The values come from the game (engine.roll), the animation only shows them.
import * as THREE from 'three';
import { tween, ease } from './anim.js';

const PIPS = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]], 5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] };
// BoxGeometry face order: +x, -x, +y, -y, +z, -z
const FACE_VALUE = [3, 4, 1, 6, 2, 5];
// Rotation that brings each value to the top
const UP = { 1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [-Math.PI / 2, 0, 0], 5: [Math.PI / 2, 0, 0], 3: [0, 0, Math.PI / 2], 4: [0, 0, -Math.PI / 2] };

function faceTexture(v) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff8ea'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = v === 1 ? '#d23b32' : '#2a1f14';
  for (const [x, y] of PIPS[v]) { g.beginPath(); g.arc(30 + x * 34, 30 + y * 34, v === 1 ? 17 : 12, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeDice(scene) {
  const mats = FACE_VALUE.map((v) => new THREE.MeshToonMaterial({ map: faceTexture(v) }));
  const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const dice = [0, 1].map(() => { const d = new THREE.Mesh(geo, mats); d.rotation.order = 'YXZ'; d.castShadow = true; d.visible = false; scene.add(d); return d; });
  // They land on a glass shelf floating over the middle of the board, then fade away when the move starts.
  const rest = [new THREE.Vector3(-0.6, 2.4, 0.4), new THREE.Vector3(0.6, 2.4, 0.7)];

  async function throwDice(values) {
    await Promise.all(dice.map((d, i) => {
      d.visible = true;
      const from = new THREE.Vector3(-6 + i * 1.2, 5, 13), to = rest[i];
      const spin = [(2 + i) * Math.PI * 2, (1 + i) * Math.PI * 2, (3 - i) * Math.PI * 2];
      const end = UP[values[i]], turn = (i ? -0.4 : 0.3);
      return tween(900 + i * 120, (k) => {
        d.position.x = from.x + (to.x - from.x) * k;
        d.position.z = from.z + (to.z - from.z) * k;
        d.position.y = to.y + (from.y - to.y) * (1 - ease.outBounce(k));
        const r = 1 - ease.outCubic(k); // spin slows down as it lands
        d.rotation.set(end[0] + spin[0] * r, turn + spin[1] * r, end[2] + spin[2] * r);
      });
    }));
  }
  const hide = () => dice.forEach((d) => { d.visible = false; });
  return { throwDice, hide, dice };
}
