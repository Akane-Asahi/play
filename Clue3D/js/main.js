// Clue3D sandbox: the 3D board running the real full-game rules (../clue/engine.js) on one device,
// you (Scarlett) against two simple bots. Suggestions, cards and the network come in later tasks
// (see tasks.html); this proves the look, the board, moving, dice and the camera.
import * as THREE from 'three';
import * as B from '../../clue/board.js';
import * as E from '../../clue/engine.js';
import { createStage } from './scene.js';
import { buildBoard, standAt, roomCenter, ROOM_NAMES } from './board3d.js';
import { makePawn, makeTurnMarker, bobMarker, setPawnModel, SUSPECTS } from './pawns.js';
import { makeDice } from './dice.js';
import { step, hop, tween, ease, wait } from './anim.js';
import { walkPath } from './path.js';
import { loadManifest, loadModels } from './assets.js';

const $ = (id) => document.getElementById(id);
const stage = createStage($('scene'));
const { scene, camera, controls, renderer } = stage;
const board = buildBoard(scene);
const dice = makeDice(scene);

// ---- the local game ----
const ME = 'p0';
const order = ['p0', 'p1', 'p2'];
const names = { p0: 'You', p1: 'Mustard (bot)', p2: 'White (bot)' };
const seat = { p0: 0, p1: 1, p2: 2 };
let game = E.newGame(order, { mode: 'full', rc0: 12 });
let go = null;          // where I can move this roll
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
  $('roll').hidden = !(mine && game.phase === 'roll');
  $('passage').hidden = !(mine && game.phase === 'roll' && here >= 0 && B.PASSAGE[here] != null);
  if (!$('passage').hidden) $('passage').textContent = 'Secret passage → ' + ROOM_NAMES[B.PASSAGE[here]];
  $('end').hidden = !(mine && (game.phase === 'end' || game.phase === 'suggest'));
  $('hint').textContent = mine && game.phase === 'move' ? 'Rolled ' + (game.dice[0] + game.dice[1]) + '. Tap a glowing square or room.' : '';
  $('roll').disabled = $('passage').disabled = $('end').disabled = animating;
}
function toast(text, ms = 2200) {
  const t = $('toast'); t.textContent = text; t.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), ms);
}

// ---- moving ----
async function walk(p, dest, viaPassage = false) {
  const pawn = pawns[p];
  const steps = viaPassage ? [dest] : walkPath({ ...game.pos }, p, dest);
  let at = pawn.position.clone();
  for (const v of steps) {
    const to = standAt(v, seat[p]);
    if (viaPassage) { // sink into the hatch, pop out of the other one
      await tween(260, (k) => { pawn.scale.setScalar(1 - k); });
      pawn.position.copy(to);
      await tween(300, (k) => { pawn.scale.setScalar(k); }, ease.outBack);
    } else await hop(pawn, at, to, B.roomOf(v) >= 0 ? 320 : 190, B.roomOf(v) >= 0 ? 0.9 : 0.5);
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

$('roll').onclick = () => act(async () => {
  const d = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
  game = E.roll(game, ME, d);
  await dice.throwDice(d);
  go = B.reach(game.pos, ME, d[0] + d[1]);
  board.showReach(go);
});
$('passage').onclick = () => act(async () => {
  const to = B.PASSAGE[B.roomOf(game.pos[ME])];
  const next = E.passage(game, ME); if (!next) return;
  await walk(ME, B.inRoom(to), true);
  game = { ...next, phase: 'end' }; // sandbox: no suggestion yet
  await enteredRoom(ME, to);
});
$('end').onclick = () => act(async () => {
  if (game.phase === 'suggest') game = { ...game, phase: 'end' };
  game = E.endTurn(game, ME, order);
  dice.hide();
  runBots();
});

async function moveMe(dest) {
  const next = E.move(game, ME, dest); if (!next) return;
  board.showReach(null); go = null;
  await act(async () => {
    await walk(ME, dest);
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
      const d = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
      game = E.roll(game, p, d);
      await dice.throwDice(d);
      const dest = E.botMove(game, p, Math.floor(Math.random() * 9), Math.random);
      const next = E.move(game, p, dest);
      if (dest !== 'stay' && next) await walk(p, dest);
      game = next || { ...game, phase: 'end' };
      if (B.roomOf(dest) >= 0) await enteredRoom(p, B.roomOf(dest));
      game = E.endTurn({ ...game, phase: 'end' }, p, order);
      dice.hide();
    });
  }
}

// ---- tapping the board (a tap, not a drag of the camera) ----
const ndc = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return;
  if (game.turn !== ME || game.phase !== 'move' || animating || !go) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const hit = board.pick(ndc, camera);
  if (!hit) return;
  if (hit.room != null && go.rooms[hit.room] != null) moveMe(B.inRoom(hit.room));
  else if (hit.square != null && go.cells.has(hit.square)) moveMe(hit.square);
});

// ---- render loop ----
renderer.setAnimationLoop((t) => {
  step(t);
  controls.update();
  const tp = pawns[game.turn];
  if (tp) { marker.position.set(tp.position.x, tp.position.y, tp.position.z); bobMarker(marker, t); }
  renderer.render(scene, camera);
});
hud();
window.__clue3d = { get game() { return game; }, scene, camera, board, pawns }; // for tests and debugging
