// Multiplayer room lobby + private deal for Clues. Data lives in Firebase Realtime Database.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getDatabase, ref, get, set, update, remove, onValue } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const S = window.ClueSolver;
const BOT_NAMES = ['Bebun', 'Shishu', 'Protibondhi', 'Sir', 'Dada', 'Bro'];
const MIN_PLAYERS = 3, MAX_PLAYERS = 6;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const NAME_KEY = 'clues-play-name';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let uid = null;
let roomCode = null;
let meta = null;
let players = {};
let myHand = null;
let unsubs = [];

const roomPath = (p) => `rooms/${roomCode}/${p}`;

function setMsg(text) { $('msg').textContent = text || ''; }

function randomCode() {
  let s = '';
  const buf = new Uint32Array(5);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 5; i++) s += CODE_CHARS[buf[i] % CODE_CHARS.length];
  return s;
}

function shareUrl(code) {
  return `${location.origin}${location.pathname}?room=${code}`;
}

function nextSeat(list) {
  const seats = Object.values(list).map((p) => p.seat);
  return seats.length ? Math.max(...seats) + 1 : 0;
}

function showSection(id) {
  for (const s of ['home', 'lobby', 'game']) $(s).hidden = s !== id;
  $('code-pill').hidden = !roomCode;
  if (roomCode) $('code-pill').textContent = `Room ${roomCode}`;
}

async function signIn() {
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

function getName() {
  const name = $('name').value.trim();
  if (!name) throw new Error('Type your name first.');
  localStorage.setItem(NAME_KEY, name);
  return name;
}

async function createRoom() {
  const name = getName();
  const user = await signIn();
  uid = user.uid;

  let code = randomCode();
  for (let tries = 0; tries < 5; tries++) {
    const taken = (await get(ref(db, `rooms/${code}/meta`))).exists();
    if (!taken) break;
    code = randomCode();
  }

  await update(ref(db, `rooms/${code}`), {
    'meta/host': uid,
    'meta/edition': $('edition').value,
    'meta/status': 'lobby',
    'meta/createdAt': Date.now(),
    [`players/${uid}`]: { name, seat: 0, bot: false },
  });
  enterRoom(code);
}

async function joinRoom(code) {
  const name = getName();
  const user = await signIn();
  uid = user.uid;

  const m = (await get(ref(db, `rooms/${code}/meta`))).val();
  if (!m) throw new Error('No room with that code.');

  const list = (await get(ref(db, `rooms/${code}/players`))).val() || {};
  if (!list[uid]) {
    if (m.status !== 'lobby') throw new Error('That game has already started.');
    if (Object.keys(list).length >= MAX_PLAYERS) throw new Error('That room is full.');
    await set(ref(db, `rooms/${code}/players/${uid}`), { name, seat: nextSeat(list), bot: false });
  }
  enterRoom(code);
}

function enterRoom(code) {
  roomCode = code;
  const url = new URL(location.href);
  url.searchParams.set('room', code);
  history.replaceState(null, '', url);
  unsubs.forEach((u) => u());
  unsubs = [
    onValue(ref(db, `rooms/${code}/meta`), (snap) => { meta = snap.val(); render(); }, onErr),
    onValue(ref(db, `rooms/${code}/players`), (snap) => { players = snap.val() || {}; render(); }, onErr),
    onValue(ref(db, `rooms/${code}/hands/${uid}`), (snap) => { myHand = snap.val(); render(); }, onErr),
  ];
}

function onErr(err) {
  setMsg(`Connection problem: ${err.message}`);
}

function isHost() {
  return meta && meta.host === uid;
}

function render() {
  if (!roomCode) return;
  if (!meta) {
    showSection('home');
    return;
  }
  if (meta.status === 'playing') renderGame();
  else renderLobby();
}

function renderLobby() {
  showSection('lobby');
  $('share').value = shareUrl(roomCode);

  const sorted = Object.entries(players).sort((a, b) => a[1].seat - b[1].seat);
  $('players').innerHTML = sorted.map(([pid, p]) =>
    `<li>${esc(p.name)}${pid === meta.host ? ' <span class="muted">(host)</span>' : ''}${p.bot ? ' <span class="muted">(bot)</span>' : ''}
      ${isHost() && p.bot ? `<button class="btn ghost small" data-remove="${esc(pid)}">Remove</button>` : ''}</li>`
  ).join('') || '<li class="muted">Nobody yet.</li>';

  $('host-tools').hidden = !isHost();
  $('waiting').hidden = isHost();
  if (isHost()) {
    const taken = new Set(Object.values(players).map((p) => p.name));
    const full = sorted.length >= MAX_PLAYERS;
    $('bots').innerHTML = BOT_NAMES.filter((n) => !taken.has(n)).map((n) =>
      `<button class="chip" data-bot="${esc(n)}" ${full ? 'disabled' : ''}>+ ${esc(n)}</button>`
    ).join('') || '<span class="muted">All bots are in.</span>';
    $('start').disabled = sorted.length < MIN_PLAYERS;
  }
}

function renderGame() {
  showSection('game');
  const ed = S.EDITIONS.find((e) => e.id === meta.edition) || S.EDITIONS[0];
  const D = S.makeDeck(ed);
  $('game-title').textContent = `Game · ${ed.name}`;

  const cards = myHand || [];
  $('my-cards').innerHTML = cards.length
    ? cards.map((c) => `<li>${esc(S.CAT_NAMES[D.catOf(c)])}: <strong>${esc(D.CARDS[c])}</strong></li>`).join('')
    : '<li class="muted">Your cards will appear once the host deals.</li>';

  const sorted = Object.entries(players).sort((a, b) => a[1].seat - b[1].seat);
  $('game-players').innerHTML = sorted.map(([pid, p]) =>
    `<li>${esc(p.name)}${p.bot ? ' <span class="muted">(bot)</span>' : ''}${pid === uid ? ' <span class="muted">(you)</span>' : ''} · ${p.handSize ?? '?'} cards</li>`
  ).join('');
}

async function addBot(botName) {
  if (!isHost()) return;
  const id = 'bot-' + botName.toLowerCase();
  await set(ref(db, roomPath(`players/${id}`)), { name: botName, seat: nextSeat(players), bot: true });
}

async function removeBot(id) {
  if (!isHost()) return;
  await remove(ref(db, roomPath(`players/${id}`)));
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Host only: pick the envelope, shuffle the rest and write each hand privately.
async function startGame() {
  if (!isHost()) return;
  const list = Object.entries(players).sort((a, b) => a[1].seat - b[1].seat);
  if (list.length < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players.`);

  const ed = S.EDITIONS.find((e) => e.id === meta.edition) || S.EDITIONS[0];
  const D = S.makeDeck(ed);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const rng = S.mulberry32(seed);

  const envelope = [0, 1, 2].map((k) => D.CS[k] + Math.floor(rng() * D.SZ[k]));
  const rest = [];
  for (let c = 0; c < D.N; c++) if (!envelope.includes(c)) rest.push(c);
  shuffleInPlace(rest, rng);

  const sizes = S.defaultHands(list.length, rest.length);
  const updates = {
    'meta/status': 'playing',
    'meta/startedAt': Date.now(),
    'secret/envelope': envelope,
  };
  let k = 0;
  list.forEach(([pid], i) => {
    updates[`hands/${pid}`] = rest.slice(k, k + sizes[i]);
    updates[`players/${pid}/handSize`] = sizes[i];
    k += sizes[i];
  });
  await update(ref(db, `rooms/${roomCode}`), updates);
}

async function boot() {
  $('name').value = localStorage.getItem(NAME_KEY) || '';
  const fromUrl = new URL(location.href).searchParams.get('room');
  if (fromUrl) $('code').value = fromUrl.toUpperCase();

  $('create').onclick = () => run(createRoom);
  $('join').onclick = () => {
    const code = $('code').value.trim().toUpperCase();
    if (!code) return setMsg('Type the room code first.');
    run(() => joinRoom(code));
  };
  $('copy').onclick = async () => {
    await navigator.clipboard.writeText(shareUrl(roomCode));
    setMsg('Link copied.');
  };
  $('start').onclick = () => run(startGame);
  $('bots').onclick = (e) => { const b = e.target.closest('[data-bot]'); if (b) run(() => addBot(b.dataset.bot)); };
  $('players').onclick = (e) => { const b = e.target.closest('[data-remove]'); if (b) run(() => removeBot(b.dataset.remove)); };

  showSection('home');
  if (fromUrl) setMsg('Enter your name, then join.');
}

async function run(fn) {
  try {
    setMsg('');
    await fn();
  } catch (err) {
    setMsg(err.message || String(err));
  }
}

boot();
