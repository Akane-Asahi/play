// The mansion in 3D, built from the same grid as the 2D game (../clue/board.js): 16 x 16 squares,
// nine 4 x 4 rooms, corridors between. One board square = 1 world unit. Grid x -> world x, grid y -> world z.
// Rooms are cut-away boxes: tall back wall, low side walls, a lip at the front, so the camera sees inside.
import * as THREE from 'three';
import * as B from '../../clue/board.js';
import { PALETTE, toon } from './look.js';

export const ROOM_NAMES = ['Kitchen', 'Ballroom', 'Conservatory', 'Dining Room', 'Billiard Room', 'Library', 'Lounge', 'Hall', 'Study'];
const FLOOR_Y = 0.22;          // rooms stand a little above the corridors
const TILE_H = 0.12;

// World position of the centre of square (x, y), on top of the floor.
export const sq = (x, y, top = TILE_H) => new THREE.Vector3(x - B.W / 2 + 0.5, top, y - B.H / 2 + 0.5);
// Where a pawn stands for a board position (corridor square or room), by seat so pawns in a room don't overlap.
export function standAt(v, seat = 0) {
  const k = B.roomOf(v);
  if (k < 0) { const [x, y] = B.xy(v); return sq(x, y); }
  const r = B.roomRect(k);
  return sq(r.x + 0.9 + (seat % 3) * 1.1, r.y + (seat < 3 ? 1.9 : 3.0), FLOOR_Y);
}
export const roomCenter = (k) => { const r = B.roomRect(k); return sq(r.x + 1.5, r.y + 1.5, FLOOR_Y); };

function label(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = '700 64px system-ui, -apple-system, Segoe UI, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 14; g.strokeStyle = 'rgba(23,19,15,.85)'; g.strokeText(text, 256, 66);
  g.fillStyle = '#fff6e4'; g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2.6;
  m.renderOrder = 10;
  return m;
}

// Very simple stand-in furniture so each room reads at a glance until its real model arrives.
function placeholderProps(k) {
  const g = new THREE.Group(), add = (w, h, d, color, x, z, y = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
    m.position.set(x, FLOOR_Y + y + h / 2, z); m.castShadow = m.receiveShadow = true; g.add(m); return m;
  };
  const r = B.roomRect(k), o = sq(r.x, r.y, 0); // corner square centre
  const X = (dx) => o.x + dx, Z = (dz) => o.z + dz;
  const round = (rad, h, color, x, z, y = 0) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.05, h, 20), toon(color));
    m.position.set(x, FLOOR_Y + y + h / 2, z); m.castShadow = m.receiveShadow = true; g.add(m); return m;
  };
  switch (k) {
    case 0: add(2.6, 0.8, 0.6, '#e9e2d2', X(0.9), Z(-0.15)); add(0.6, 0.9, 0.6, '#55565c', X(-0.15), Z(1)); round(0.18, 0.25, '#d0533b', X(0.6), Z(-0.15), 0.8); break; // Kitchen: counter, stove, pot
    case 1: round(0.75, 0.05, '#f6efe0', X(1.5), Z(1.6)); add(0.9, 0.9, 0.5, '#2a2a30', X(-0.05), Z(-0.1)); break;          // Ballroom: dance floor, piano
    case 2: for (const [a, b] of [[0, 0], [1, -0.1], [2, 0], [-0.1, 1.1], [0, 2.2]]) { round(0.2, 0.35, '#b46a3c', X(a), Z(b)); round(0.32, 0.4, '#4fae5d', X(a), Z(b), 0.35); } break; // Conservatory: plants
    case 3: add(2.4, 0.55, 0.9, '#9a6a3d', X(1.6), Z(0.4)); for (let i = 0; i < 3; i++) add(0.35, 0.8, 0.35, '#6e4a2a', X(0.9 + i * 0.75), Z(-0.25)); break; // Dining: table, chairs
    case 4: add(1.9, 0.55, 1.1, '#2f8a57', X(0.8), Z(0.6)); round(0.08, 0.08, '#f3ead4', X(0.5), Z(0.5), 0.55); round(0.08, 0.08, '#c62828', X(1.0), Z(0.7), 0.55); break; // Billiard table
    case 5: add(3.6, 1.6, 0.4, '#7a5233', X(1.4), Z(-0.3)); add(0.4, 1.6, 2.4, '#7a5233', X(-0.3), Z(1.2)); add(0.9, 0.5, 0.6, '#c9a36b', X(1.6), Z(1.4)); break; // Library: shelves, reading table
    case 6: add(0.8, 0.5, 2, '#b0673a', X(-0.05), Z(1.3)); add(1.3, 1.1, 0.35, '#e9e2d2', X(1.4), Z(-0.25)); break;        // Lounge: sofa, fireplace
    case 7: add(0.9, 0.04, 3.3, '#b13b3b', X(1.6), Z(1.3)); add(0.4, 1.9, 0.35, '#7a5233', X(-0.1), Z(-0.2)); break;        // Hall: rug, clock
    case 8: add(1.4, 0.6, 0.7, '#4a3a2e', X(1.2), Z(0.4)); add(0.4, 1.4, 2.4, '#7a5233', X(-0.3), Z(1.2)); round(0.12, 0.25, '#7fe08a', X(0.8), Z(0.3), 0.6); break; // Study: desk, shelf, lamp
  }
  return g;
}

export function buildBoard(scene) {
  const root = new THREE.Group(); scene.add(root);
  // the table slab under everything
  const slab = new THREE.Mesh(new THREE.BoxGeometry(B.W + 1.2, 0.6, B.H + 1.2), [toon(PALETTE.slabSide), toon(PALETTE.slabSide), toon(PALETTE.slab), toon(PALETTE.slab), toon(PALETTE.slabSide), toon(PALETTE.slabSide)]);
  slab.position.y = -0.3; slab.receiveShadow = true; root.add(slab);

  // corridor tiles: instanced, so 112 squares cost a few draw calls
  const doorAt = new Set(B.DOORS.map((d) => B.idx(d.x, d.y))), starts = new Set(B.STARTS);
  const kinds = { a: [], b: [], door: [], start: [] };
  for (let y = 0; y < B.H; y++) for (let x = 0; x < B.W; x++) {
    if (B.roomAt(x, y) >= 0) continue;
    const i = B.idx(x, y);
    kinds[doorAt.has(i) ? 'door' : starts.has(i) ? 'start' : (x + y) % 2 ? 'a' : 'b'].push(i);
  }
  const tileGeo = new THREE.BoxGeometry(0.94, TILE_H, 0.94);
  const colors = { a: PALETTE.corridorA, b: PALETTE.corridorB, door: PALETTE.door, start: PALETTE.start };
  const pickables = [], m4 = new THREE.Matrix4();
  for (const kind of Object.keys(kinds)) {
    const list = kinds[kind];
    const mesh = new THREE.InstancedMesh(tileGeo, toon(colors[kind]), list.length);
    list.forEach((i, n) => { const [x, y] = B.xy(i); const p = sq(x, y, TILE_H / 2); m4.makeTranslation(p.x, p.y, p.z); mesh.setMatrixAt(n, m4); });
    mesh.receiveShadow = true;
    mesh.userData.squares = list;
    root.add(mesh); pickables.push(mesh);
  }

  // rooms
  const rooms = [];
  const wallMat = toon(PALETTE.wall), trimMat = toon(PALETTE.wallTop);
  for (let k = 0; k < B.ROOMS; k++) {
    const g = new THREE.Group(), r = B.roomRect(k);
    const c = sq(r.x + 1.5, r.y + 1.5, 0);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(4, FLOOR_Y, 4), toon(PALETTE.floors[k]));
    floor.position.set(c.x, FLOOR_Y / 2, c.z); floor.receiveShadow = true; floor.userData.room = k;
    g.add(floor); pickables.push(floor);
    // walls: one segment per square edge, with a gap where a door is
    const doors = B.DOORS.filter((d) => d.k === k);
    const gap = (side, t) => doors.some((d) => d.side === side && (side === 'n' || side === 's' ? d.x - r.x : d.y - r.y) === t);
    const seg = (side, t, h) => {
      if (gap(side, t)) return;
      const horiz = side === 'n' || side === 's';
      const m = new THREE.Mesh(new THREE.BoxGeometry(horiz ? 1 : 0.16, h, horiz ? 0.16 : 1), wallMat);
      const x = horiz ? r.x + t : side === 'w' ? r.x - 0.5 : r.x + 3.5, y = horiz ? (side === 'n' ? r.y - 0.5 : r.y + 3.5) : r.y + t;
      const p = sq(x + (horiz ? 0 : side === 'w' ? 0.08 : -0.08), y + (horiz ? (side === 'n' ? 0.08 : -0.08) : 0), FLOOR_Y + h / 2);
      m.position.copy(p); m.castShadow = m.receiveShadow = true; g.add(m);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(horiz ? 1 : 0.2, 0.06, horiz ? 0.2 : 1), trimMat);
      cap.position.set(p.x, FLOOR_Y + h + 0.03, p.z); g.add(cap);
    };
    for (let t = 0; t < 4; t++) { seg('n', t, 1.5); seg('w', t, 0.7); seg('e', t, 0.7); seg('s', t, 0.2); }
    // secret passage hatch in the corner rooms
    if (B.PASSAGE[k] != null) {
      const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 24), toon('#17120d'));
      const corner = sq(r.x + 3, r.y, FLOOR_Y + 0.02); // back right corner, like the 2D board
      hatch.position.copy(corner); g.add(hatch);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.04, 8, 24), toon(PALETTE.gold));
      ring.rotation.x = Math.PI / 2; ring.position.copy(corner); ring.position.y += 0.02; g.add(ring);
      g.userData.hatch = corner;
    }
    const props = placeholderProps(k); g.add(props);
    const name = label(ROOM_NAMES[k]); name.position.set(c.x, FLOOR_Y + 0.45, c.z + 2.25); g.add(name);
    // the "you can go here" glow: a soft column of light standing on the floor
    const beam = new THREE.Mesh(new THREE.BoxGeometry(3.9, 2.4, 3.9), new THREE.MeshBasicMaterial({ color: PALETTE.beam, transparent: true, opacity: 0.3, depthWrite: false }));
    beam.position.set(c.x, FLOOR_Y + 1.2, c.z); beam.visible = false; beam.userData.room = k; g.add(beam);
    root.add(g);
    rooms.push({ k, group: g, floor, props, beam, label: name });
  }

  // reachable-square markers (instanced, count changes per roll)
  const markGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.06, 20);
  const marks = new THREE.InstancedMesh(markGeo, new THREE.MeshBasicMaterial({ color: '#ffb52e' }), 140);
  marks.count = 0; root.add(marks);

  function showReach(go) {
    let n = 0;
    if (go) go.cells.forEach((_, i) => { const [x, y] = B.xy(i); const p = sq(x, y, TILE_H + 0.03); m4.makeTranslation(p.x, p.y, p.z); marks.setMatrixAt(n++, m4); });
    marks.count = n; marks.instanceMatrix.needsUpdate = true;
    rooms.forEach((r) => { r.beam.visible = !!go && go.rooms[r.k] != null; });
  }

  // Swap a room's stand-in furniture for a real model (already stylized), fitted into the 4 x 4 floor.
  function setRoomModel(k, model) {
    const r = rooms[k]; r.group.remove(r.props);
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
    const s = 3.9 / Math.max(size.x, size.z);
    model.scale.multiplyScalar(s);
    const b2 = new THREE.Box3().setFromObject(model), mid = b2.getCenter(new THREE.Vector3()), c = roomCenter(k);
    model.position.add(new THREE.Vector3(c.x - mid.x, FLOOR_Y - b2.min.y, c.z - mid.z));
    r.group.add(model); r.props = model;
  }

  // What is under the pointer: { square } or { room } or null.
  const ray = new THREE.Raycaster();
  function pick(ndc, camera) {
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...pickables, ...rooms.map((r) => r.beam).filter((b) => b.visible)], false);
    for (const h of hits) {
      if (h.object.userData.room != null) return { room: h.object.userData.room };
      if (h.object.userData.squares && h.instanceId != null) return { square: h.object.userData.squares[h.instanceId] };
    }
    return null;
  }

  return { root, rooms, showReach, setRoomModel, pick };
}
