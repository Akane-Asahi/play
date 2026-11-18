// Chibi pawns: big head, small body, in the seat's colour. These are stand-ins built from primitives;
// when a suspect's GLB is in models/, setPawnModel() swaps it in at the same size.
import * as THREE from 'three';
import { PALETTE, toon } from './look.js';
import { tween } from './anim.js';

export const SUSPECTS = ['Scarlett', 'Mustard', 'White', 'Green', 'Peacock', 'Plum'];
const PAWN_H = 1.05; // world units, head included

// color: optional override (the 2D board's seat colours, so both views agree)
export function makePawn(seat, colorOverride) {
  const color = colorOverride || PALETTE.seats[seat % PALETTE.seats.length];
  const pawn = new THREE.Group(), figure = new THREE.Group();
  pawn.add(figure);
  const add = (geo, mat, y, x = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; figure.add(m); return m; };
  add(new THREE.CylinderGeometry(0.3, 0.34, 0.08, 24), toon(PALETTE.ink), 0.04);              // base
  add(new THREE.CapsuleGeometry(0.2, 0.22, 6, 16), toon(color), 0.36);                           // body
  add(new THREE.SphereGeometry(0.29, 24, 18), toon(PALETTE.skin), 0.78);                         // big head
  const hair = add(new THREE.SphereGeometry(0.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.1), toon(color), 0.8); // hair cap
  hair.rotation.x = -0.25;
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.035, 8, 8), toon(PALETTE.ink), 0.77, s * 0.1, 0.26); // eyes
  pawn.userData = { seat, figure };
  return pawn;
}

// A small white arrow over a pawn: "this one is you".
export function addMeMarker(pawn) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.17, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  m.rotation.x = Math.PI; m.position.y = 1.2; pawn.add(m);
  return pawn;
}

export function setPawnModel(pawn, model) {
  const fig = pawn.userData.figure;
  fig.clear();
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
  model.scale.multiplyScalar(PAWN_H / size.y);
  const b2 = new THREE.Box3().setFromObject(model), mid = b2.getCenter(new THREE.Vector3());
  model.position.add(new THREE.Vector3(-mid.x, -b2.min.y, -mid.z));
  fig.add(model);
}

// A gold ring + bobbing arrow over whoever's turn it is.
export function makeTurnMarker() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 8, 32), new THREE.MeshBasicMaterial({ color: PALETTE.gold }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; g.add(ring);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.26, 4), new THREE.MeshBasicMaterial({ color: PALETTE.gold }));
  arrow.rotation.x = Math.PI; arrow.position.y = 1.5; g.add(arrow);
  g.userData.arrow = arrow;
  return g;
}
export function bobMarker(marker, t) {
  marker.userData.arrow.position.y = 1.45 + Math.sin(t / 260) * 0.08;
  marker.userData.arrow.rotation.y = t / 700;
}

// A little "surprised" jump, used when a pawn is called into a room by someone's suggestion.
export function gasp(pawn) {
  const f = pawn.userData.figure;
  return tween(380, (k) => { f.position.y = Math.sin(Math.PI * k) * 0.45; f.rotation.y = k * Math.PI * 2; });
}
