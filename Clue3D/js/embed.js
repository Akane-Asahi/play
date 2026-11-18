// The 3D board as a part you can drop into the 2D game's page (clue/app.js, 3D game mode).
// It only draws: the game state comes in through update(), and a tap on a glowing square or room goes out
// through onMove(dest). All rules stay in clue/engine.js, so a 3D room plays exactly like a full game.
//
//   const view = createBoardView({ doc, win, onMove });   // throws when WebGL is not available
//   host.appendChild(view.el);
//   view.update({ pos, order, me, turn, out, roomNames, go, mv, phase });   // mv: { p, c }: who moved last, with which card
//   view.reset();                                          // a new game started
import * as THREE from 'three';
import * as B from '../../clue/board.js';
import { SEAT_COLORS } from '../../clue/boardview.js';
import { createStage } from './scene.js';
import { buildBoard, standAt, ROOM_NAMES } from './board3d.js';
import { makePawn, addMeMarker, makeTurnMarker, bobMarker, gasp, setPawnModel, SUSPECTS } from './pawns.js';
import { makeFx } from './fx.js';
import { step, hop, tween, ease } from './anim.js';
import { walkPath } from './path.js';
import { loadManifest, loadModels } from './assets.js';

const MODELS = new URL('../models/', import.meta.url).href;

export function createBoardView({ doc, win, onMove }) {
  // WebGL check on a throwaway canvas, so a phone without it falls back to the flat map instead of a blank board.
  const probe = doc.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WebGL is not available');

  const el = doc.createElement('div');
  el.className = 'b3d-canvas';
  const canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-label', 'The mansion in 3D');
  el.appendChild(canvas);

  const stage = createStage(canvas);
  const { scene, camera, controls, renderer } = stage;
  const board = buildBoard(scene);
  const fx = makeFx(scene);
  const marker = makeTurnMarker();
  scene.add(marker);

  const pawns = new Map();            // pid -> { obj, seat, target, shown, chain }
  const models = { suspects: {} };    // loaded suspect models by seat, for pawns created later
  let cur = null, namesKey = '';

  // ---- models (optional): same manifest as the sandbox; empty slots keep the stand-ins ----
  loadManifest(MODELS).then((m) => loadModels(m, (kind, name, obj) => {
    if (kind === 'rooms') { const k = ROOM_NAMES.indexOf(name); if (k >= 0) board.setRoomModel(k, obj); }
    if (kind === 'suspects') {
      const seat = SUSPECTS.indexOf(name); if (seat < 0) return;
      models.suspects[seat] = obj;
      for (const p of pawns.values()) if (p.seat === seat) setPawnModel(p.obj, obj);
    }
  }, MODELS)).catch(() => {});

  // ---- pawns ----
  const shownMap = () => { const o = {}; pawns.forEach((p, pid) => { o[pid] = p.shown; }); return o; };
  function ensurePawn(pid, seat, st) {
    let p = pawns.get(pid);
    if (p && p.seat === seat) return p;
    if (p) scene.remove(p.obj);
    const obj = makePawn(seat, SEAT_COLORS[seat % SEAT_COLORS.length]);
    if (pid === st.me) addMeMarker(obj);
    if (models.suspects[seat]) setPawnModel(obj, models.suspects[seat]);
    obj.rotation.y = Math.PI;
    scene.add(obj);
    p = { obj, seat, target: undefined, shown: undefined, chain: Promise.resolve(), out: false };
    pawns.set(pid, p);
    return p;
  }
  const queue = (p, fn) => { p.chain = p.chain.then(fn).catch(() => {}); };

  async function pop(p, to) {                      // called into a room, or any move that is not a walk
    await tween(170, (k) => { p.obj.scale.setScalar(Math.max(0.001, 1 - k)); });
    p.obj.position.copy(standAt(to, p.seat));
    await tween(260, (k) => { p.obj.scale.setScalar(Math.max(0.001, k)); }, ease.outBack);
    p.obj.scale.setScalar(1);
    await gasp(p.obj);
  }
  // How a pawn gets there depends on the card played: a Sprint dashes (flashing light, then smoke), a Jog hops quickly,
  // a Walk hops steadily, Tired drags its feet, a secret passage goes down one hatch and up the other, and anything
  // else (called into a room by a suggestion) pops in.
  const HOP = { j: [130, 0.38], w: [210, 0.5], f: [300, 0.3] };
  async function travel(pid, p, from, to, st) {
    const kind = st.mv && st.mv.p === pid ? st.mv.c : null;
    const walk = kind && kind !== 'p' ? walkPath({ ...shownMap(), [pid]: from }, pid, to) : [];
    if (walk.length && kind === 's') {
      const pts = [p.obj.position.clone(), ...walk.map((v) => standAt(v, p.seat))];
      await fx.dash(p.obj, pts, Math.max(420, Math.min(950, 260 + walk.length * 60)));
      p.shown = to;
      fx.smoke(standAt(to, p.seat));                                  // not awaited: it fades while play carries on
      return;
    }
    if (walk.length) {
      const [t, h] = HOP[kind] || HOP.w;
      let at = p.obj.position.clone();
      for (const v of walk) {
        const next = standAt(v, p.seat), room = B.roomOf(v) >= 0;
        await hop(p.obj, at, next, room ? t * 1.5 : t, room ? h * 1.8 : h);
        at = next;
      }
    } else if (kind === 'p') {
      await tween(260, (k) => { p.obj.scale.setScalar(Math.max(0.001, 1 - k)); });   // down one hatch, up the other
      p.obj.position.copy(standAt(to, p.seat));
      await tween(300, (k) => { p.obj.scale.setScalar(Math.max(0.001, k)); }, ease.outBack);
      p.obj.scale.setScalar(1);
    } else await pop(p, to);
    p.shown = to;
  }

  function update(st) {
    cur = st;
    st.order.forEach((pid, seat) => ensurePawn(pid, seat, st));
    for (const pid of [...pawns.keys()]) if (!st.order.includes(pid)) { scene.remove(pawns.get(pid).obj); pawns.delete(pid); }
    st.roomNames.forEach((n, k) => board.setRoomName(k, n || ROOM_NAMES[k]));
    board.showReach(st.go);
    for (const pid of st.order) {
      const p = pawns.get(pid), to = st.pos[pid];
      if (to == null) continue;
      if (p.target === undefined) { p.target = p.shown = to; p.obj.position.copy(standAt(to, p.seat)); }
      else if (to !== p.target) { const from = p.target; p.target = to; queue(p, () => travel(pid, p, from, to, st)); }
      const out = !!(st.out && st.out[pid]);               // out of the game: lies down
      if (out !== p.out) { p.out = out; p.obj.userData.figure.rotation.z = out ? 1.35 : 0; p.obj.userData.figure.position.y = out ? 0.22 : 0; }
    }
  }

  function reset() {
    pawns.forEach((p) => scene.remove(p.obj));
    pawns.clear();
    board.showReach(null);
  }

  // ---- tapping a glowing square or room (a tap, not a drag of the camera) ----
  const ndc = new THREE.Vector2();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return;
    if (!cur || !cur.go) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const hit = board.pick(ndc, camera);
    if (!hit) return;
    if (hit.room != null && cur.go.rooms[hit.room] != null) onMove(B.inRoom(hit.room));
    else if (hit.square != null && cur.go.cells.has(hit.square)) onMove(hit.square);
  });

  // ---- loop: only draws while it is on the page and the tab is visible ----
  const ro = new win.ResizeObserver(() => stage.resize());
  ro.observe(el);
  const loop = (t) => {
    win.requestAnimationFrame(loop);
    if (!el.isConnected || doc.hidden) return;
    step(t);
    controls.update();
    const tp = cur && pawns.get(cur.turn);
    marker.visible = !!tp && !tp.out;
    if (tp) { marker.position.copy(tp.obj.position); bobMarker(marker, t); }
    renderer.render(scene, camera);
  };
  win.requestAnimationFrame(loop);

  return { el, update, reset, internals: { stage, board, pawns } };   // internals: for tests and debugging only
}
