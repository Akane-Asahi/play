// Clue3D sandbox: the 3D board running the real full-game rules (../clue/engine.js) on one device,
// you (Scarlett) against two simple bots. Suggestions, cards and the network come in later tasks
// (see tasks.html); this proves the look, the board, moving with Sprint / Jog / Walk cards, the Sprint dash and the camera.
import * as THREE from 'three';
import * as B from '../../clue/board.js';
import * as E from '../../clue/engine.js';
import { createStage } from './scene.js';
import { buildBoard, standAt, roomCenter, ROOM_NAMES } from './board3d.js';
import { makePawn, makeTurnMarker, bobMarker, setPawnModel, SUSPECTS } from './pawns.js';
import { makeFx } from './fx.js';
import { step, hop, tween, ease, wait } from './anim.js';
import { walkPath } from './path.js';
import { loadManifest, loadModels } from './assets.js';

const $ = (id) => document.getElementById(id);
const stage = createStage($('scene'));
const { scene, camera, controls, renderer } = stage;
const board = buildBoard(scene);
const fx = makeFx(scene);

// ---- the local game ----
const ME = 'p0';
const order = ['p0', 'p1', 'p2'];
const names = { p0: 'You', p1: 'Mustard (bot)', p2: 'White (bot)' };
const seat = { p0: 0, p1: 1, p2: 2 };
let game = E.newGame(order, { mode: 'full', rc0: 12 });
let go = null;          // where the picked card lets me move
let pick = null;        // the card I have picked (it is only spent when I choose where to go)
let animating = false;

const pawns = {};
for (const p of order) {
  const pawn = makePawn(seat[p]);
  pawn.position.copy(standAt(game.pos[p], seat[p]));
  pawn.rotation.y = Math.PI; // face into the board
  scene.add(pawn); pawns[p] = pawn;
}
const marker = makeTurnMarker(); scene.add(marker);

// ---- models from models/manifest.json (stand-ins stay where a slot is empty) ----
loadManifest().then((m) => loadModels(m, (kind, name, obj) => {
  if (kind === 'rooms') { const k = ROOM_NAMES.indexOf(name); if (k >= 0) board.setRoomModel(k, obj); }
  if (kind === 'suspects') { const s = SUSPECTS.indexOf(name); const p = order.find((q) => seat[q] === s); if (p) setPawnModel(pawns[p], obj); }
  // weapons: placed in rooms once weapon tokens exist (task W-3)
}));

// ---- HUD ----
function hud() {
  const mine = game.turn === ME, here = B.roomOf(game.pos[ME]);
  $('turn').textContent = mine ? 'Your turn' : names[game.turn] + ' is playing…';
  $('where').textContent = here >= 0 ? 'In the ' + ROOM_NAMES[here] : 'In the corridor';
  const myTurn = mine && game.phase === 'move', c = E.cardsOf(game, ME), tir = E.tired(game, ME);
  for (const k of ['s', 'j', 'w', 'f']) {
    const b = $('c-' + k), n = k === 'f' ? 2 : c[k];
    b.hidden = !myTurn || (k === 'f' ? !tir : tir);
    b.textContent = E.CARD_NAMES[k] + ' (' + n + ')';
    b.disabled = animating || (k !== 'f' && !n);
    b.classList.toggle('on', pick === k);
  }
  const can = E.canDeduce(game, ME);
  $('deduce').hidden = !myTurn;
  $('deduce').textContent = (can ? '🔓 Deduce' : '🔒 Deduce');
  $('deduce').disabled = animating;
  $('passage').hidden = !(myTurn && here >= 0 && B.PASSAGE[here] != null);
  if (!$('passage').hidden) $('passage').textContent = 'Secret passage → ' + ROOM_NAMES[B.PASSAGE[here]];
  $('end').hidden = !(mine && (game.phase === 'end' || game.phase === 'suggest'));
  $('hint').textContent = myTurn ? (pick ? 'Tap a glowing square or room to use your ' + E.CARD_NAMES[pick] + '.' : 'Pick Sprint, Jog or Walk to see where you can go.') : '';
  $('passage').disabled = $('end').disabled = animating;
}
function toast(text, ms = 2200) {
  const t = $('toast'); t.textContent = text; t.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), ms);
}

// ---- moving ----
const HOP = { j: [130, 0.38], w: [210, 0.5], f: [300, 0.3] };
async function walk(p, dest, kind = 'w') {
  const pawn = pawns[p];
  if (kind === 'p') {       // sink into the hatch, pop out of the other one
    await tween(260, (k) => { pawn.scale.setScalar(1 - k); });
    pawn.position.copy(standAt(dest, seat[p]));
    await tween(300, (k) => { pawn.scale.setScalar(k); }, ease.outBack);
    return;
  }
  const steps = walkPath({ ...game.pos }, p, dest);
  if (kind === 's' && steps.length) {          // Sprint: a dash with a flashing light on its back, then a puff of smoke
    const dms = Math.max(420, Math.min(950, 260 + steps.length * 60));
    board.ripple(steps, dms);
    await fx.dash(pawn, [pawn.position.clone(), ...steps.map((v) => standAt(v, seat[p]))], dms);
    fx.smoke(standAt(dest, seat[p]));
    return;
  }
  const [t, h] = HOP[kind] || HOP.w;
  let at = pawn.position.clone();
  for (const v of steps) {
    const to = standAt(v, seat[p]), room = B.roomOf(v) >= 0;
    await hop(pawn, at, to, room ? t * 1.5 : t, room ? h * 1.8 : h);
    at = to;
  }
}
async function lookAt(point, closer) {
  const fromT = controls.target.clone(), fromP = camera.position.clone();
  const off = fromP.clone().sub(fromT).multiplyScalar(closer);
  const toT = point.clone(), toP = point.clone().add(off);
  await tween(650, (k) => { controls.target.lerpVectors(fromT, toT, k); camera.position.lerpVectors(fromP, toP, k); }, ease.inOutCubic);
}

async function enteredRoom(p, k) {
  const back = controls.target.clone();
  await lookAt(roomCenter(k), 0.55);
  toast((p === ME ? 'You' : names[p].replace(' (bot)', '')) + ' entered the ' + ROOM_NAMES[k] + '. (Suggestions come in a later task.)');
  await wait(1200);
  await lookAt(back, 1 / 0.55);
}

async function act(fn) { animating = true; hud(); try { await fn(); } finally { animating = false; hud(); } }

for (const k of ['s', 'j', 'w', 'f']) {
  $('c-' + k).onclick = () => {                  // only shows where I can go: nothing is spent yet
    if (animating) return;
    pick = pick === k ? null : k;
    go = pick ? E.reachWith(game, ME, pick) : null;
    board.showReach(go);
    hud();
  };
}
$('deduce').onclick = () => act(async () => {
  if (!E.canDeduce(game, ME)) { toast('Deduce unlocks once a kind of card runs out.'); return; }
  const next = E.deduce(game, ME, order); if (!next) return;
  pick = null; go = null; board.showReach(null);
  game = next;
  toast(ME + ' will skip this step: stamina refilled (1 Sprint, 2 Jog, 2 Walks)', 3000);
  runBots();
});
$('passage').onclick = () => act(async () => {
  const to = B.PASSAGE[B.roomOf(game.pos[ME])];
  const next = E.passage(game, ME); if (!next) return;
  pick = null; go = null; board.showReach(null);
  await walk(ME, B.inRoom(to), 'p');
  game = { ...next, phase: 'end' }; // sandbox: no suggestion yet
  await enteredRoom(ME, to);
});
$('end').onclick = () => act(async () => {
  if (game.phase === 'suggest') game = { ...game, phase: 'end' };
  game = E.endTurn(game, ME, order);
  runBots();
});

async function moveMe(dest) {
  const card = pick, next = E.move(game, ME, dest, card); if (!next) return;
  board.showReach(null); go = null; pick = null;
  await act(async () => {
    await walk(ME, dest, card);
    game = next;
    const k = B.roomOf(dest);
    if (k >= 0) { await enteredRoom(ME, k); game = { ...game, phase: 'end' }; }
  });
}

async function runBots() {
  while (game.turn !== ME && !game.over) {
    const p = game.turn;
    await act(async () => {
      await wait(500);
      const a = E.botTurn(game, p, Math.floor(Math.random() * 9), Math.random);
      if (a.act === 'deduce') { game = E.deduce(game, p, order); toast(names[p].replace(' (bot)', '') + ' will skip this step: stamina refilled', 2500); return; }
      let next = null;
      if (a.act === 'passage') { next = E.passage(game, p); if (next) await walk(p, next.pos[p], 'p'); }
      else if (a.act === 'move') { next = E.move(game, p, a.dest, a.card); if (next) await walk(p, a.dest, a.card); }
      else next = (game.called && game.called[p] ? E.stayIn(game, p) : null) || E.move(game, p, 'stay');
      game = next || { ...game, phase: 'end' };
      const k = B.roomOf(game.pos[p]);
      if (k >= 0 && a.act !== 'stay') await enteredRoom(p, k);
      game = E.endTurn({ ...game, phase: 'end' }, p, order);
    });
  }
}

// ---- tapping the board (a tap, not a drag of the camera) ----
const ndc = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return;
  if (game.turn !== ME || game.phase !== 'move' || animating || !go || !pick) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const hit = board.pick(ndc, camera);
  if (!hit) return;
  if (hit.room != null && go.rooms[hit.room] != null) moveMe(B.inRoom(hit.room));
  else if (hit.square != null && go.cells.has(hit.square)) moveMe(hit.square);
});

// ---- render loop ----
renderer.setAnimationLoop((t) => {
  step(t); board.tick(t);
  controls.update();
  const tp = pawns[game.turn];
  if (tp) { marker.position.set(tp.position.x, tp.position.y, tp.position.z); bobMarker(marker, t); }
  renderer.render(scene, camera);
});
hud();
window.__clue3d = { get game() { return game; }, scene, camera, board, pawns }; // for tests and debugging
