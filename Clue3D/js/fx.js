// Effects for the movement cards: the Sprint dash (a pawn streaking along its path with a flashing light on its
// back) and the smoke puff it lands in, which fades out slowly over three seconds.
import * as THREE from 'three';
import { tween, ease } from './anim.js';

export const SMOKE_MS = 3000;

export function makeFx(scene) {
  const puffGeo = new THREE.SphereGeometry(0.3, 12, 9);
  const glowGeo = new THREE.SphereGeometry(0.11, 8, 6);
  const streakGeo = new THREE.ConeGeometry(0.2, 1.3, 12);
  streakGeo.rotateX(-Math.PI / 2);                 // apex points backwards (-Z), the wide end sits on the pawn
  streakGeo.translate(0, 0, -0.65);
  const coreGeo = new THREE.ConeGeometry(0.09, 1.0, 10);
  coreGeo.rotateX(-Math.PI / 2); coreGeo.translate(0, 0, -0.5);
  const glow = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

  // Smoke at `at`: a cloud of soft puffs that swell, drift up and fade away over `ms`. Resolves when it is gone.
  function smoke(at, ms = SMOKE_MS) {
    const puffs = [];
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: i % 3 ? '#efe9de' : '#d6cfc2', transparent: true, opacity: 0, depthWrite: false, depthTest: false });
      const mesh = new THREE.Mesh(puffGeo, mat);
      const a = Math.random() * Math.PI * 2, r = Math.random() * 0.5;
      mesh.position.set(at.x + Math.cos(a) * r, at.y + 0.3, at.z + Math.sin(a) * r);
      mesh.scale.setScalar(0.25);
      mesh.renderOrder = 5;
      scene.add(mesh);
      puffs.push({ mesh, mat, x0: mesh.position.x, y0: mesh.position.y, z0: mesh.position.z, dx: Math.cos(a) * (0.3 + Math.random() * 0.7), dz: Math.sin(a) * (0.3 + Math.random() * 0.7),
        rise: 0.6 + Math.random() * 0.8, grow: 1.2 + Math.random() * 1.0, peak: 0.7 + Math.random() * 0.2, delay: Math.random() * 0.12 });
    }
    return tween(ms, (k) => {
      for (const p of puffs) {
        const t = Math.max(0, (k - p.delay) / (1 - p.delay)), e = ease.outCubic(t);
        p.mesh.position.set(p.x0 + p.dx * e * 0.8, p.y0 + p.rise * e, p.z0 + p.dz * e * 0.8);
        p.mesh.scale.setScalar(0.25 + p.grow * e);
        p.mat.opacity = p.peak * Math.min(1, t / 0.1) * Math.pow(1 - t, 1.3);   // up fast, then a slow fade to nothing at the end
      }
    }).then(() => { for (const p of puffs) { scene.remove(p.mesh); p.mat.dispose(); } });
  }

  // Dash `obj` (a pawn) along `pts` (world positions, starting where it stands). A light streak flashes on its back
  // and leaves fading sparks behind. `ms` is the whole run.
  async function dash(obj, pts, ms) {
    const seg = [], total = pts.reduce((s, p, i) => { if (!i) return 0; const d = p.distanceTo(pts[i - 1]); seg.push(d); return s + d; }, 0);
    if (!total) return;
    const fig = obj.userData.figure;
    const streak = new THREE.Mesh(streakGeo, glow('#ffe9a0', 0.9)), core = new THREE.Mesh(coreGeo, glow('#ffffff', 0.95));
    streak.position.set(0, 0.55, -0.2); core.position.set(0, 0.55, -0.2);
    obj.add(streak); obj.add(core);
    const sparks = [];
    let lastSpark = -1, flash = 0;
    const at = (d) => { let i = 0; while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; } const t = seg[i] ? Math.min(1, d / seg[i]) : 1; return [pts[i], pts[i + 1], t]; };
    await tween(ms, (k) => {
      const d = total * k, [a, b, t] = at(d);
      obj.position.lerpVectors(a, b, t);
      if (b.x !== a.x || b.z !== a.z) obj.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      obj.position.y += Math.abs(Math.sin(d * 3.2)) * 0.07;
      fig.rotation.x = 0.42 * Math.min(1, k * 8, (1 - k) * 8);                  // lean into it
      obj.scale.set(0.92, 1, 1.12);
      flash = (flash + 1) % 6;                                                    // flashing: bright, dim, bright…
      streak.material.opacity = flash < 3 ? 0.95 : 0.3; core.material.opacity = flash < 3 ? 1 : 0.5;
      const i = Math.floor(d / 0.45);
      if (i !== lastSpark) {                                                      // a spark of light left behind
        lastSpark = i;
        const m = new THREE.Mesh(glowGeo, glow('#ffd24a', 0.9)); m.position.copy(obj.position); m.position.y += 0.5; m.renderOrder = 4;
        scene.add(m); sparks.push({ m, born: k });
      }
      for (const s of sparks) { const age = (k - s.born) / Math.max(0.0001, 0.3); s.m.material.opacity = Math.max(0, 0.9 * (1 - age)); s.m.scale.setScalar(Math.max(0.01, 1 - age * 0.6)); }
    });
    obj.remove(streak); obj.remove(core); streak.material.dispose(); core.material.dispose();
    fig.rotation.x = 0; obj.scale.set(1, 1, 1);
    await tween(260, (k) => { for (const s of sparks) s.m.material.opacity = Math.max(0, s.m.material.opacity * (1 - k)); });
    for (const s of sparks) { scene.remove(s.m); s.m.material.dispose(); }
  }

  return { dash, smoke };
}
