// Multiplayer Clues: lobby, turns, bots and notes. All network access goes through `net`
// (see main.js for the Firebase version), so the same code runs in tests against a fake.
import * as E from './engine.js';
import * as B from './board.js';
import { boardSvg, SEAT_COLORS } from './boardview.js';

// Game modes chosen in the lobby. '3d' is the full game (same rules, same room) with the mansion drawn in 3D.
const MODES = ['fast', 'full', '3d'];
const modeOf = (m) => (MODES.includes(m) ? m : 'fast');
const isBoardMode = (m) => m === 'full' || m === '3d';

// load3d (optional): () => import(...) of the 3D board view. Without it, or when WebGL is missing, a 3D room shows the 2D map.
export function startApp({ net, doc, win, delays, load3d }) {
  const S = win.ClueSolver;
  const D0 = { bot: 3000, none: 900, min: 3000, slide: 260, bubble: 6000, ...(delays || {}) };   // min: how long each state stays on screen
  const NAME_KEY = 'clues-play-name';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const SUS_COLORS = { scarlett: ['#c62828', '#ffffff'], mustard: ['#e1ad01', '#231a00'], white: ['#ffffff', '#222222', '#b9b4aa'],
    green: ['#2e7d32', '#ffffff'], peacock: ['#1565c0', '#ffffff'], plum: ['#7b1fa2', '#ffffff'] };

  const $ = (id) => doc.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => win.setTimeout(r, ms));
  const lsGet = (k) => { try { return win.localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { win.localStorage.setItem(k, v); } catch (e) { /* private mode */ } };

  let uid = null, roomCode = null;
  let meta = null, players = {}, game = null, myHand = null, myShown = null;
  let gone = false;
  let unsubs = [];
  let msg = '';
  const ui = { card: null, notes: {}, sel: [null, null, null], accusing: false, confirm: false, plOpen: false, choosing: false, selKey: null, seen: 0, seenKey: null, plExp: {}, name: lsGet(NAME_KEY) || '', code: '', edition: 'clue-us' };
  let hostBusy = false, hostDirty = false, helperKey = null, helperRes = null, helperSt = null, askKey = null, askRes = null, botPlan = null;

  // ---------- helpers ----------
  const room = (p) => 'rooms/' + roomCode + (p ? '/' + p : '');
  const order = () => E.seatOrder(players);
  const isHost = () => !!meta && meta.host === uid;
  const edition = () => S.EDITIONS.find((e) => e.id === (meta && meta.edition)) || S.EDITIONS[0];
  const deck = () => S.makeDeck(edition());
  const nm = (pid) => (pid === uid ? 'You' : (players[pid] && players[pid].name) || 'Someone');
  const nmFull = (pid) => (players[pid] && players[pid].name) || 'Someone';
  const tx = (fn) => net.tx(room('game'), (g) => fn(g));

  function randomCode() {
    const buf = new Uint32Array(5);
    win.crypto.getRandomValues(buf);
    let s = '';
    for (let i = 0; i < 5; i++) s += CODE_CHARS[buf[i] % CODE_CHARS.length];
    return s;
  }
  const shareUrl = () => win.location.origin + win.location.pathname + '?room=' + roomCode;
  const nextSeat = (list) => { const s = Object.values(list).map((p) => p.seat); return s.length ? Math.max(...s) + 1 : 0; };

  // ---------- card drawing (same look as the Clues tracker) ----------
  function susKey(D, c) {
    if (D.catOf(c) !== 0) return null;
    return D.CARDS[c].toLowerCase().replace(/^(miss|mrs\.?|mr\.?|colonel|professor|prof\.?)\s+/, '').trim();
  }
  function portrait(D, c) {
    const P = win.CLUE_PORTRAITS;
    if (!P) return null;
    let key = susKey(D, c);
    if (!key) {
      key = D.CARDS[c].toLowerCase().replace(/[^a-z]/g, '');
      key = { dagger: 'knife', spanner: 'wrench', leadpiping: 'leadpipe', billiard: 'billiardroom', dining: 'diningroom' }[key] || key;
    }
    return P[key] || null;
  }
  function cardHtml(D, c) {
    const name = D.CARDS[c];
    const col = SUS_COLORS[susKey(D, c)];
    if (D.catOf(c) !== 0 || !col) return esc(name);
    return '<span class="sp" style="background:' + col[0] + ';color:' + col[1] + (col[2] ? ';border-color:' + col[2] : '') + '">' + esc(name) + '</span>';
  }
  function chip(D, c, cls, attrs) {
    const col = SUS_COLORS[susKey(D, c)];
    const style = col ? ' style="background:' + col[0] + ';color:' + col[1] + (col[2] ? ';border:1px solid ' + col[2] : '') + '"' : '';
    return '<span class="chip' + (col ? ' sus' : '') + (cls || '') + '"' + style + (attrs || '') + '>' + esc(D.CARDS[c]) + '</span>';
  }
  // One card, big, for the card a player was just shown.
  function bigCard(D, c, ft) {
    const src = portrait(D, c);
    return '<div class="bigcard art shownc"' + (ft != null ? ' style="--ft:' + ft + 's"' : '') + '>' + (src ? '<img class="pic" alt="" src="' + src + '" draggable="false">' : '') +
      '<small>' + S.CAT_NAMES[D.catOf(c)] + '</small><b>' + esc(D.CARDS[c]) + '</b></div>';
  }
  // The three-card fan. opts: tap(c) -> can be tapped, dead(c) -> greyed out, seen(c) -> eye, hint
  function fan(D, cards, opts) {
    opts = opts || {};
    return '<div class="fan' + (opts.ft != null ? ' cont" style="--ft:' + opts.ft + 's' : '') + '">' + cards.map((c, i) => {
      const bl = !!(opts.bluff && opts.bluff(c)), tap = opts.tap && opts.tap(c), live = !(bl || (opts.dead && opts.dead(c))), src = portrait(D, c);
      return '<div class="fc k' + i + (live ? ' live' : '') + (tap ? ' tap' : '') + (src ? ' art' : '') + '"' + (tap ? ' data-act="show" data-c="' + c + '"' : '') + '><div class="in">' +
        (src ? '<img class="pic" alt="" src="' + src + '" draggable="false">' : '') +
        '<small>' + S.CAT_NAMES[i] + '</small>' +
        (opts.seen && opts.seen(c) ? '<span class="seen" title="You showed them this card before">👁️</span>' : '') +
        '<b' + (D.CARDS[c].length > 10 ? ' class="long"' : '') + '>' + esc(D.CARDS[c]) + '</b>' + (tap && opts.hint ? '<i>' + esc(opts.hint) + '</i>' : '') +
        (bl ? '<span class="clown" title="Bluff: the suggester holds this card">🤡</span>' : '') +
        (opts.pick && opts.pick(c) ? '<span class="pick" title="Safest card to show">🛡️</span>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  // ---------- rooms ----------
  function needName() {
    const name = (ui.name || '').trim().slice(0, 20);
    if (!name) throw new Error('Type your name first.');
    lsSet(NAME_KEY, name);
    return name;
  }

  // Every room has a "delete after" time in roomIndex: 3 hours for a lobby, 24 hours once a game is running,
  // 2 hours after the case is closed. Nothing runs on a timer, so whoever opens or joins a room clears out the expired ones.
  const HOUR = 3600 * 1000, LIFE = { lobby: 3 * HOUR, playing: 24 * HOUR, done: 2 * HOUR };
  const setExpiry = async (code, kind) => { try { await net.set('roomIndex/' + code, Date.now() + LIFE[kind]); } catch (e) { /* best effort */ } };
  async function sweep() {
    try {
      const idx = (await net.get('roomIndex')) || {};
      for (const code of Object.keys(idx)) {
        if (typeof idx[code] !== 'number' || idx[code] >= Date.now()) continue;
        try { await net.remove('rooms/' + code); await net.remove('roomIndex/' + code); } catch (e) { /* somebody else got there first */ }
      }
    } catch (e) { /* cleaning up is best effort */ }
  }
  async function createRoom(mode) {
    const name = needName();
    uid = await net.signIn();
    await sweep();
    let code = randomCode();
    for (let i = 0; i < 5 && (await net.get('rooms/' + code + '/meta')); i++) code = randomCode();
    await net.update('rooms/' + code, {
      'meta/host': uid, 'meta/edition': ui.edition, 'meta/status': 'lobby', 'meta/helper': true, 'meta/mode': modeOf(mode), 'meta/createdAt': Date.now(),
      ['players/' + uid]: { name, seat: 0, bot: false },
    });
    await setExpiry(code, 'lobby');
    enterRoom(code);
  }

  async function joinRoom(code) {
    const name = needName();
    uid = await net.signIn();
    await sweep();
    const m = await net.get('rooms/' + code + '/meta');
    if (!m) throw new Error('No room with that code.');
    const list = (await net.get('rooms/' + code + '/players')) || {};
    if (!list[uid]) {
      if (m.status !== 'lobby') throw new Error('That game has already started.');
      if (Object.keys(list).length >= E.MAX_PLAYERS) throw new Error('That room is full.');
      await net.set('rooms/' + code + '/players/' + uid, { name, seat: nextSeat(list), bot: false });
    }
    enterRoom(code);
  }

  const notesKey = () => 'clues-notes-' + roomCode + '-' + uid;
  function enterRoom(code) {
    roomCode = code;
    try { ui.notes = JSON.parse(lsGet('clues-notes-' + code + '-' + uid) || '{}') || {}; } catch (e) { ui.notes = {}; }
    try {
      const url = new win.URL(win.location.href);
      url.searchParams.set('room', code);
      win.history.replaceState(null, '', url);
    } catch (e) { /* not fatal */ }
    unsubs.forEach((u) => u());
    const onErr = (err) => { msg = 'Connection problem: ' + (err && err.message ? err.message : err); render(); };
    unsubs = [
      net.on(room('meta'), (v) => { if (meta && !v) gone = true; meta = v; render(); }, onErr),
      net.on(room('players'), (v) => { players = v || {}; render(); }, onErr),
      net.on(room('game'), (v) => { game = v; render(); }, onErr),
      net.on(room('hands/' + uid), (v) => { myHand = v; render(); }, onErr),
      net.on(room('shown/' + uid), (v) => { myShown = v; render(); }, onErr),
    ];
  }

  async function addBot(name) {
    if (!isHost() || Object.keys(players).length >= E.MAX_PLAYERS) return;
    await net.set(room('players/bot-' + name.toLowerCase()), { name, seat: nextSeat(players), bot: true });
  }
  async function removePlayer(pid) {
    if (!isHost() || pid === uid) return;
    await net.remove(room('players/' + pid));
  }

  // Host only: pick the envelope, shuffle the rest and write each hand privately.
  async function startGame() {
    if (!isHost()) return;
    const ord = order();
    if (ord.length < E.MIN_PLAYERS) throw new Error('Need at least ' + E.MIN_PLAYERS + ' players.');
    const D = deck();
    const seed = win.crypto.getRandomValues(new Uint32Array(1))[0];
    const sizes = S.defaultHands(ord.length, D.N - 3);
    const { envelope, hands } = E.deal(D, ord, sizes, S.mulberry32(seed));
    const up = { 'meta/status': 'playing', 'meta/startedAt': Date.now(), 'secret/envelope': envelope, game: E.newGame(ord, isBoardMode(meta.mode) ? { mode: 'full', rc0: D.CS[2] } : null), shown: null };
    ord.forEach((pid, i) => { up['hands/' + pid] = hands[pid]; up['players/' + pid + '/handSize'] = sizes[i]; });
    await net.update(room(), up);
    await setExpiry(roomCode, 'playing');
  }

  async function backToLobby() {
    if (!isHost()) return;
    const up = { 'meta/status': 'lobby', game: null, secret: null, shown: null };
    order().forEach((pid) => { up['hands/' + pid] = null; up['players/' + pid + '/handSize'] = null; });
    await net.update(room(), up);
    await setExpiry(roomCode, 'lobby');
  }

  // ---------- my moves ----------
  function resetPick() { ui.sel = [null, null, null]; ui.accusing = false; ui.confirm = false; }

  // Slide the Notes / Turns sheet down and out, then take it away.
  function closeSheet() {
    if (!ui.sheet || ui.sheetClosing) return;
    const sh = doc.querySelector('.sheet'), bd = doc.querySelector('.sbackdrop');
    if (!sh || !D0.slide) { ui.sheet = null; ui.sheetEnter = false; render(); return; }
    ui.sheetClosing = true; sh.classList.remove('enter'); sh.classList.add('out'); if (bd) { bd.classList.remove('enter'); bd.classList.add('out'); }
    win.setTimeout(() => { ui.sheetClosing = false; ui.sheet = null; render(); }, D0.slide + 20);
  }
  async function doSuggest() {
    if (!sugReady()) return;
    closeSheet();                                    // the table closes as soon as the suggestion goes out
    const cards = ui.sel.slice(), ord = order();
    resetPick();
    await tx((g) => E.suggest(g, uid, cards, ord));
  }
  async function doAccuse() {
    if (!ui.sel.every((c) => c != null)) return;
    const cards = ui.sel.slice();
    resetPick();
    await tx((g) => E.accuse(g, uid, cards));
  }
  const full = () => E.isFull(game);
  const hereCard = () => E.roomCardHere(game, uid);
  const sugReady = () => ui.sel.every((c) => c != null) && (!full() || ui.sel[2] === hereCard());
  const doPassage = () => tx((g) => E.passage(g, uid));
  const doStayIn = () => tx((g) => E.stayIn(g, uid));
  const wasCalled = () => !!(game && game.called && game.called[uid]);
  // A card only shows where I can go; it is spent when I pick the square or room.
  async function doMove(d) {
    const c = ui.card;
    if (d !== 'stay' && !c) { toast('Pick Sprint, Jog or Walk first'); return; }
    ui.card = null;
    await tx((g) => E.move(g, uid, d, c));
  }
  async function doDeduce() {
    if (!game || !E.canDeduce(game, uid)) { toast('Deduce unlocks once a kind of card runs out'); return; }
    ui.card = null;
    const ord = order();
    await tx((g) => E.deduce(g, uid, ord));
  }
  async function doEndTurn() {
    const ord = order();
    resetPick();
    await tx((g) => E.endTurn(g, uid, ord));
  }
  async function showCard(c) {
    const cur = game && game.cur;
    if (!cur || E.asked(game) !== uid || !myHand || !myHand.includes(c) || !cur.cards.includes(c)) return;
    await net.update(room(), {
      ['shown/' + cur.by + '/' + cur.n]: { card: c, from: uid },
      ['shown/' + uid + '/' + cur.n]: { card: c, to: cur.by },
    });
    await tx((g) => E.answer(g, uid, 'showed'));
  }
  // When I'm asked and hold none of the cards, I tap Pass.
  async function doPass() {
    if (!game || game.over || E.asked(game) !== uid || !myHand) return;
    const cur = game.cur;
    if (cur.cards.some((c) => myHand.includes(c))) return;       // you must show a card if you have one
    await tx((g) => (g && g.cur && g.cur.n === cur.n && g.cur.i === cur.i ? E.answer(g, uid, 'none') : undefined));
  }

  // ---------- host duties: bots and checking accusations ----------
  async function hostStep() {
    const g = game, ord = order();
    if (!g || g.over || !meta || meta.status !== 'playing') return false;
    const isBot = (p) => !!(players[p] && players[p].bot);
    if (g.phase === 'accusing') {
      const env = await net.get(room('secret/envelope'));
      if (!env) return false;
      return tx((x) => E.resolveAccuse(x, env, ord));
    }
    if (g.phase === 'answer') {
      const p = E.asked(g), cur = g.cur;
      if (!isBot(p) || onHold()) return false;
      await sleep(D0.bot);
      const hand = (await net.get(room('hands/' + p))) || [];
      const held = cur.cards.filter((c) => hand.includes(c));
      const same = (x) => (x && x.cur && x.cur.n === cur.n && x.cur.i === cur.i);
      if (!held.length) return tx((x) => (same(x) ? E.answer(x, p, 'none') : undefined));
      const card = E.pickShow(held, E.shownTo(await net.get(room('shown/' + p)), cur.by));
      await net.update(room(), {
        ['shown/' + p + '/' + cur.n]: { card, to: cur.by },
        ['shown/' + cur.by + '/' + cur.n]: { card, from: p },
      });
      return tx((x) => (same(x) ? E.answer(x, p, 'showed') : undefined));
    }
    if (['suggest', 'end', 'move'].includes(g.phase) && isBot(g.turn)) {
      const p = g.turn;
      if (onHold()) return false;
      await sleep(D0.bot);
      const key = p + ':' + E.logOf(g).length + ':' + (meta.startedAt || 0);
      if (!botPlan || botPlan.key !== key) {              // one think per turn, not one per step
        const hand = (await net.get(room('hands/' + p))) || [];
        const shown = await net.get(room('shown/' + p));
        botPlan = { key, mv: E.botThink(S, E.solverState(edition(), players, ord, p, hand, g, shown), Math.random) };
      }
      const mv = botPlan.mv;
      if (g.phase === 'move') {
        const a = E.botTurn(g, p, mv.suggest ? mv.suggest[2] - g.rc0 : -1, Math.random);
        return tx((x) => {
          if (!x || x.phase !== 'move' || x.turn !== p) return undefined;
          if (a.act === 'passage') return E.passage(x, p);
          if (a.act === 'deduce') return E.deduce(x, p, ord);
          if (a.act === 'move') return E.move(x, p, a.dest, a.card);
          return (x.called && x.called[p] ? E.stayIn(x, p) : null) || E.move(x, p, 'stay');
        });
      }
      if (mv.accuse) return tx((x) => E.accuse(x, p, mv.accuse));
      if (g.phase === 'end') return tx((x) => E.endTurn(x, p, ord));
      const cards = mv.suggest.slice();
      if (E.isFull(g)) cards[2] = E.roomCardHere(g, p);
      return tx((x) => E.suggest(x, p, cards, ord));
    }
    return false;
  }
  // A player with a pop-up open (or still catching up with one) holds the bots, so the game can't run
  // ahead of what they are reading. Stored on their own player entry, refreshed while it lasts.
  const HOLD_MS = 90000;
  function onHold() {
    const now = Date.now();
    return Object.values(players).some((p) => p && !p.bot && p.hold && now - p.hold < HOLD_MS);
  }
  function syncHold(want) {
    if (!roomCode || !players[uid]) return;
    const now = Date.now();
    win.clearTimeout(ui.beatT);
    if (want) {
      if (!ui.holdAt || now - ui.holdAt > 30000) { ui.holdAt = now; Promise.resolve(net.set(room('players/' + uid + '/hold'), now)).catch(() => {}); }
      ui.beatT = win.setTimeout(render, Math.max(0, 30000 - (now - ui.holdAt)) + 50);
    } else if (ui.holdAt) { ui.holdAt = 0; Promise.resolve(net.set(room('players/' + uid + '/hold'), null)).catch(() => {}); }
  }
  async function hostTick() {
    if (!isHost()) return;
    if (game && game.over && meta && ui.doneKey !== roomCode + ':' + (meta.startedAt || 0)) { ui.doneKey = roomCode + ':' + (meta.startedAt || 0); setExpiry(roomCode, 'done'); }
    if (hostBusy) { hostDirty = true; return; }   // something changed while a bot was thinking: look again after
    hostBusy = true; hostDirty = false;
    let acted = false;
    try { acted = await hostStep(); } catch (e) { msg = e.message || String(e); }
    hostBusy = false;
    if (acted || hostDirty) win.setTimeout(hostTick, 30);
  }

  // ---------- my notes (the deduction helper) ----------
  const isTelot = () => /^telot$/i.test(((players[uid] && players[uid].name) || '').trim());
  function helper() {
    if (!isTelot() || !game || !myHand || !players[uid] || players[uid].handSize == null) return null;
    const key = E.logOf(game).length + '|' + JSON.stringify(myShown || {}) + '|' + myHand.join(',');
    if (key !== helperKey) {
      helperKey = key;
      try { helperSt = E.solverState(edition(), players, order(), uid, myHand, game, myShown); helperRes = S.analyse(helperSt); } catch (e) { helperRes = null; helperSt = null; }
      askKey = null;
    }
    return helperRes && helperRes.ok ? helperRes : null;
  }
  // Telot only: the questions worth asking. `room` fixes the room (the one I stand in); null lets any room be named.
  // `rank` 0 = the best, 1 = the runner-up. Cached until the log, my cards or the room change.
  const askMemo = {};
  function askFor(r, room, rank) {
    const k = helperKey + '|' + room + '|' + rank;
    if (askKey !== helperKey) { askKey = helperKey; Object.keys(askMemo).forEach((x) => delete askMemo[x]); }
    if (!(k in askMemo)) {
      let out = null;
      try { const b = S.bestSuggestions(r, helperSt, rank + 1, room == null ? undefined : room)[rank]; out = b ? b.cards.slice() : null; } catch (e) { out = null; }
      askMemo[k] = out;
    }
    return askMemo[k];
  }

  // ---------- screens ----------
  // The first page is a poster: the picture, the title mid-right, and only a name and Join room at the bottom.
  // Starting a room of your own lives behind the small round button in the top corner.
  function homeHtml() {
    let panel = '';
    if (!ui.invited && ui.menu) {                               // opened by Create room: edition and kind of game
      panel = '<section class="homepanel"><button class="px" data-act="menu-close" aria-label="Close">×</button><h2>Start a room</h2><select id="edition" aria-label="Edition">' +
        S.EDITIONS.map((e) => '<option value="' + esc(e.id) + '"' + (e.id === ui.edition ? ' selected' : '') + '>' + esc(e.name) + '</option>').join('') + '</select>' +
        '<p class="muted" style="margin-top:12px">What kind of game?</p><div class="modes">' +
        '<button class="mode" data-act="mk" data-m="fast"><b>Fast game</b><span>Cards only. Take turns making suggestions, no board.</span></button>' +
        '<button class="mode" data-act="mk" data-m="full"><b>Full game</b><span>Spend Sprint, Jog and Walk cards to cross the mansion and suggest in the room you enter.</span></button>' +
        '<button class="mode" data-act="mk" data-m="3d"><b>3D game</b><span>The full game with the mansion in 3D. Same rules, same room.</span></button>' +
        '<a class="mode" href="table/"><b>Real table</b><span>Playing with real cards? Log every suggestion and work out the envelope.</span></a></div></section>';
    }
    const name = '<input type="text" id="name" maxlength="20" placeholder="Your name" aria-label="Your name" autocomplete="nickname" value="' + esc(ui.name) + '">';
    const code = '<input type="text" id="code" maxlength="5" placeholder="Room code" aria-label="Room code" autocapitalize="characters" autocomplete="off" value="' + esc(ui.code) + '">';
    // Two rows of two: name + Create room, then room code + Join room. From a friend's link: just a name and Join room.
    const rows = ui.invited
      ? name + '<input type="hidden" id="code" value="' + esc(ui.code) + '"><button class="btn" data-act="join">Join room</button>'
      : '<div class="hline nm">' + name + '<button class="btn" data-act="create">Create room</button></div>' +
        '<div class="hor"><span>or</span></div>' +
        '<div class="hline cd">' + code + '<button class="btn ghost" data-act="join">Join room</button></div>' +
        '<a class="tablelink" href="table/">Playing with real cards? Open the table tracker</a>';
    return '<div class="homestage' + (ui.menu ? ' open' : '') + '"><div class="homebg" aria-hidden="true"></div><div class="hometitle"><img src="img/logo.webp" alt="Crime" width="1100" height="340" decoding="async"></div>' +
      (panel ? '<div class="homeback" data-act="menu-close"></div>' : '') + '<div class="homedock">' + panel + rows + '</div></div>';
  }

  function lobbyHtml() {
    const ord = order(), host = isHost(), full = ord.length >= E.MAX_PLAYERS;
    let h = '<section class="card"><h2>Invite friends</h2><p class="muted">Share this link. Anyone who opens it can join.</p>' +
      '<div class="row"><input type="text" class="grow" id="share" readonly value="' + esc(shareUrl()) + '"><button class="btn ghost fit' + (ui.copied ? ' done' : '') + '" data-act="copy">' + (ui.copied ? 'Copied ✓' : 'Copy') + '</button></div></section>';
    h += '<section class="card"><h2>Players (' + ord.length + ' of up to ' + E.MAX_PLAYERS + ')</h2><div class="plist">';
    ord.forEach((pid) => {
      const p = players[pid];
      h += '<div class="pl"><span class="pn">' + esc(p.name) + '</span><span class="muted grow">' +
        [pid === meta.host ? 'host' : '', p.bot ? 'bot' : '', pid === uid ? 'you' : ''].filter(Boolean).join(' · ') + '</span>' +
        (host && pid !== uid ? '<button class="btn ghost fit mini" data-act="kick" data-p="' + esc(pid) + '">Remove</button>' : '') + '</div>';
    });
    h += '</div></section>';
    if (host) {
      const taken = new Set(Object.values(players).map((p) => p.name));
      const free = E.BOT_NAMES.filter((n) => !taken.has(n));
      h += '<section class="card"><h2>Add bots</h2><div class="chips">' +
        (free.length ? free.map((n) => '<span class="chip' + (full ? ' off' : '') + '" data-act="bot" data-n="' + esc(n) + '">+ ' + esc(n) + '</span>').join('') : '<span class="muted">All six bots are in.</span>') +
        '</div><p class="muted">Bots play on your device, so keep this page open during the game.</p></section>';
      h += '<section class="card"><div class="switch"><div><b>Notes sheet for everyone</b><div class="muted">Each player gets a sheet to tick and cross by hand as they work out the case.</div></div>' +
        '<button class="tog' + (meta.helper ? ' on' : '') + '" data-act="helper" aria-label="Toggle notes"></button></div></section>';
      h += '<section class="card"><h2>Game</h2><div class="modes">' + [['fast', 'Fast game', 'Cards only, no board.'], ['full', 'Full game', 'Movement cards, the mansion and rooms.'], ['3d', '3D game', 'The full game, the mansion in 3D.']].map((m) =>
        '<button class="mode' + ((meta.mode || 'fast') === m[0] ? ' on' : '') + '" data-act="setmode" data-m="' + m[0] + '"><b>' + m[1] + '</b><span>' + m[2] + '</span></button>').join('') + '</div></section>';
      h += '<button class="btn" data-act="start"' + (ord.length < E.MIN_PLAYERS ? ' disabled' : '') + '>Start game</button>' +
        (ord.length < E.MIN_PLAYERS ? '<p class="muted center">You need at least ' + E.MIN_PLAYERS + ' players. Add a bot or invite a friend.</p>' : '');
    } else {
      h += '<p class="muted center">' + (meta.mode === '3d' ? '3D game: the full game with the mansion in 3D. ' : meta.mode === 'full' ? 'Full game with movement cards and the mansion. ' : 'Fast game. ') + 'Waiting for ' + esc(nmFull(meta.host)) + ' to start the game.</p>';
    }
    return h;
  }

  // Am I choosing a suspect, weapon and room right now? (Then the names in my notes can be tapped.)
  function picking() {
    const g = game;
    if (!g || g.over) return false;
    if (E.windowWho(g) === uid) return !!ui.accusing;
    if (g.turn !== uid) return false;
    if (g.phase === 'answer' || g.phase === 'accusing' || g.phase === 'window') return false;
    if (g.phase === 'move' || g.phase === 'end') return !!ui.accusing;     // only when making a final accusation
    return true;
  }
  // The first cell of a notes row: the card's name, tappable while I'm choosing.
  function nameCell(D, c, k, mine, extra) {
    const pk = picking();
    return '<td' + (pk ? ' class="pkc" data-act="pick" data-k="' + k + '" data-c="' + c + '"' : '') + '>' + cardHtml(D, c) + (mine ? ' <span class="muted">yours</span>' : '') + (extra || '') + '</td>';
  }
  const selClass = (c, k) => (ui.sel[k] === c ? ' sel' : '') + (picking() ? ' pk' : '');

  const LOCK = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor"/><path d="M5.2 7V5.2a2.8 2.8 0 015.6 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const LOCK_OPEN = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor"/><path d="M5.2 7V5.2a2.8 2.8 0 015.4-1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  // The buttons that float at the bottom of the screen on my turn.
  // The Final Accusation button is always there. On my own turn it opens the accusation at once; otherwise it puts
  // my name in the queue, and I'm asked when the turn in progress is over.
  function floatHtml(D) {
    const g = game;
    if (!g || g.over) return '';
    const prompted = E.windowWho(g) === uid;
    const mine = g.turn === uid && ['move', 'suggest', 'end'].includes(g.phase);
    if (!mine && !prompted) {
      if (E.isOut(g, uid) || g.phase === 'accusing' || g.turn === uid) return '';
      const queued = !!(g.req && g.req[uid]);
      return '<div class="float slim" role="region" aria-label="Final accusation">' + (queued
        ? '<div class="fsum">You will be asked when this turn is over.</div><div class="row"><button class="btn ghost grow" data-act="req-cancel">Cancel accusation</button></div>'
        : '<div class="row"><button class="btn danger grow" data-act="req-accuse">Final Accusation</button></div>') + '</div>';
    }
    const ready = ui.sel.every((c) => c != null);
    const accuseBtn = '<div class="row"><button class="btn danger grow" data-act="accuse-open">Final Accusation</button></div>';
    let inner;
    if (prompted && !ui.accusing && !ui.confirm) {
      inner = '<div class="fsum"><b>Make your accusation now?</b> If you are wrong, you are out.</div>' +
        '<div class="row"><button class="btn danger grow" data-act="accuse-open">Make accusation</button><button class="btn ghost grow" data-act="win-pass">Pass</button></div>';
    } else if (ui.confirm && ready) {
      inner = '<div class="fsum warnt"><b>Accuse ' + esc(D.CARDS[ui.sel[0]]) + ' with the ' + esc(D.CARDS[ui.sel[1]]) + ' in the ' + esc(D.CARDS[ui.sel[2]]) + '?</b> If you are wrong, you are out.</div>' +
        '<div class="row"><button class="btn danger grow" data-act="accuse-yes">Yes, accuse</button><button class="btn ghost grow" data-act="accuse-no">Cancel</button></div>';
    } else if (ui.accusing) {
      const sum = ready ? ui.sel.map((c) => esc(D.CARDS[c])).join(' · ') : (ui.sel.some((c) => c != null) ? ui.sel.map((c, k) => c != null ? esc(D.CARDS[c]) : '<i>' + S.CAT_NAMES[k].toLowerCase() + '?</i>').join(' · ') : 'Tap a suspect, a weapon and a room in your notes');
      inner = '<div class="fsum">' + sum + '</div><div class="row"><button class="btn danger grow" data-act="accuse"' + (ready ? '' : ' disabled') + '>Accuse</button><button class="btn ghost grow" data-act="accuse-back">' + (prompted ? 'Back' : 'Cancel') + '</button></div>';
    } else if (g.phase === 'move') {
      const here = B.roomOf(g.pos[uid]), to = B.PASSAGE[here], mustLeave = g.again && E.canLeave(g, uid), can = E.canDeduce(g, uid), tir = E.tired(g, uid);
      const hint = ui.card ? 'Tap a glowing square or room to use your ' + E.CARD_NAMES[ui.card] + ' (up to ' + E.STEPS[ui.card] + ' spaces)'
        : mustLeave ? 'You have to leave the room: pick a card' : tir ? 'You are tired: pick Tired to move 2 spaces, or Deduce' : 'Pick Sprint, Jog or Walk to see where you can go';
      inner = '<div class="fsum">' + hint + '</div><div class="row">' +
        '<button class="btn grow dbtn ' + (can ? 'open' : 'locked') + '" data-act="deduce" aria-label="Deduce, ' + (can ? 'unlocked' : 'locked') + '">' + (can ? LOCK_OPEN : LOCK) + ' Deduce <em>' + (can ? 'unlocked' : 'locked') + '</em></button>' +
        (to != null ? '<button class="btn ghost grow" data-act="passage">To ' + esc(D.CARDS[g.rc0 + to]) + '</button>' : '') +
        (wasCalled() && here >= 0 && !g.again ? '<button class="btn ghost grow" data-act="stayin">Suggest here</button>' : (!mustLeave ? '<button class="btn ghost grow" data-act="stay">Stay put</button>' : '')) +
        '</div>' + accuseBtn;
    } else if (g.phase === 'end') {
      inner = '<div class="row"><button class="btn grow" data-act="end">End turn</button><button class="btn danger grow" data-act="accuse-open">Final Accusation</button></div>';
    } else {
      const sum = ready ? ui.sel.map((c) => esc(D.CARDS[c])).join(' · ') : (ui.sel.some((c) => c != null) ? ui.sel.map((c, k) => c != null ? esc(D.CARDS[c]) : '<i>' + S.CAT_NAMES[k].toLowerCase() + '?</i>').join(' · ') : 'Tap a suspect, a weapon and a room in your notes');
      inner = '<div class="fsum">' + sum + '</div>' + (full() && ready && !sugReady() ? '<div class="fsum"><i>You can only suggest the ' + esc(D.CARDS[hereCard()]) + ', where you are. An accusation can name any room.</i></div>' : '') +
        '<div class="row"><button class="btn grow" data-act="suggest"' + (sugReady() ? '' : ' disabled') + '>Suggest</button><button class="btn danger grow" data-act="accuse"' + (ready ? '' : ' disabled') + '>Accuse</button></div>';
    }
    return '<div class="float" role="region" aria-label="Your move">' + inner + '</div>';
  }

  // Cards I know a player holds: my own hand in full; for others only what I have marked.
  function knownCards(D, p) {
    if (p === uid) return (myHand || []).slice().sort((a, b) => a - b);
    const out = [], r = helper();
    if (r) { const o = order().indexOf(p); for (let c = 0; c < D.CARDS.length; c++) if (r.certain[c] === o) out.push(c); }
    else { const auto = autoNotes(); for (let c = 0; c < D.CARDS.length; c++) if (noteVal(c + ':' + p, auto) === 'y') out.push(c); }
    return out;
  }
  function playersPanel() {
    if (!ui.plOpen || !game) return '';
    const D = deck();
    let h = '<div class="pbackdrop" data-act="players"></div><aside class="ppanel" role="dialog" aria-label="Players"><div class="phead"><b>Players</b><button class="x" data-act="players" aria-label="Close">×</button></div>';
    order().forEach((p) => {
      const open = !!ui.plExp[p], hs = players[p].handSize;
      const known = knownCards(D, p), extra = p === uid || hs == null ? 0 : Math.max(0, hs - known.length);
      h += '<div class="pr' + (game.turn === p && !game.over ? ' turn' : '') + '"><button class="prh" data-act="pexp" data-p="' + esc(p) + '" aria-expanded="' + open + '">' +
        '<span class="pn">' + esc(nmFull(p)) + '</span><span class="muted grow">' +
        [p === uid ? 'you' : '', players[p].bot ? 'bot' : '', (hs != null ? hs : '?') + ' cards', E.isOut(game, p) ? 'out' : '', game.turn === p && !game.over ? (p === uid ? 'your turn' : 'their turn') : ''].filter(Boolean).join(' · ') +
        '</span><span class="chev">' + (open ? '▴' : '▾') + '</span></button>';
      if (open) {
        h += '<div class="chips pcards">' + known.map((c) => chip(D, c, ' still')).join('') + Array(extra).fill('<span class="chip still unk">?</span>').join('') +
          (!known.length && !extra ? '<span class="muted">No cards.</span>' : '') + '</div>';
      }
      h += '</div>';
    });
    return h + (hasMap() ? cancelHtml() : '') + '</aside>';
  }

  // What the last suggestion came to, told as a bubble above the Final Accusation button: it pops up, stays a few seconds,
  // then sinks away (tap it to send it down early). `ui.bubOut` = the entry it is sinking for, `ui.bubGone` = done.
  function resultBubble(D) {
    const g = game, log = E.logOf(g), n = log.length - 1, e = log[n];
    if (!(g.phase === 'end' && !g.nosug && g.turn !== uid) || !e || e.t !== 's' || ui.bubGone === n || ui.sheet || pendingEntry() >= 0) return '';   // not while the pop-up is still telling it
    const shower = (e.resp || []).find((r) => r.r === 'showed');
    const cards = e.cards.map((c) => D.CARDS[c]).join(', ');
    if (ui.bubTimer !== n) {                         // first draw of this result: start its clock
      ui.bubTimer = n; ui.bubOut = null;
      win.setTimeout(() => { ui.bubOut = n; render(); win.setTimeout(() => { ui.bubGone = n; render(); }, D0.slide + 20); }, D0.bubble);
    }
    return '<div class="bubble' + (ui.bubOut === n ? ' out' : '') + '" data-act="bubble" role="status"><b>' +
      (shower ? esc(nm(shower.p)) + ' showed ' + esc(nm(e.by)) + ' a card.' : 'Nobody had any of these.') + '</b><span>' + esc(cards) + '</span></div>';
  }

  // The words on a card's label plate in the finale: "Mr. PLUM", "HALL", "REVOLVER".
  const TITLES = { scarlett: 'Miss', mustard: 'Col.', white: 'Mrs.', green: 'Mr.', peacock: 'Mrs.', plum: 'Mr.' };
  function plateText(D, c) {
    const key = susKey(D, c);
    if (key) return (TITLES[key] ? TITLES[key] + ' ' : '') + key.toUpperCase();
    return D.CARDS[c].toUpperCase();
  }
  // The case-closed finale: an open case file, three folded cards turned one at a time
  // (room, weapon, suspect), then WINNER is stamped on. Timing comes from --t (seconds since it
  // started), so a re-render in the middle of it carries on instead of starting over.
  function finaleHtml(D) {
    const g = game, w = g.over.winner;
    const key = (meta.startedAt || 0) + ':' + w;
    if (!ui.finale || ui.finale.key !== key) ui.finale = { key, at: Date.now() };
    const frozen = D0.reveal != null;
    const t = frozen ? D0.reveal : (Date.now() - ui.finale.at) / 1000;
    const st = (d) => ' style="--d:' + d + 's;--t:' + t.toFixed(2) + 's"';
    const cards = g.over.envelope.slice().sort((a, b) => a - b);          // suspect, weapon, room
    const at = [3.7, 2.5, 1.3];                                           // room first, then weapon, then suspect
    let h = '<div class="fin' + (frozen ? ' freeze' : '') + '" style="--t:' + t.toFixed(2) + 's">';
    h += '<div class="fin-top"><div class="muted">' + (g.over.byDefault ? 'Everyone else is out' : 'Case closed') + '</div>' +
      '<div class="fin-name"' + st(5.1) + '>' + esc(nmFull(w)) + '</div>' +
      '<div class="fin-stars" role="img" aria-label="Three stars"' + st(5.35) + '></div></div>';
    h += '<div class="folder"><div class="fshake"' + st(5) + '><div class="fbox"><div class="ftag">Case #' + esc(roomCode) + '</div>';
    cards.forEach((c, k) => {
      const src = portrait(D, c);
      h += '<div class="epos p' + k + '"><div class="ec"' + st(0.3 + 0.15 * k) + '><div class="ecin"' + st(at[k]) + '>' +
        '<div class="eb"></div><div class="ef" data-card="' + esc(D.CARDS[c]) + '">' +
        (src ? '<img class="eart" alt="" src="' + src + '" draggable="false">' : '<div class="eart none"></div>') +
        '<div class="plate">' + esc(plateText(D, c)) + '</div></div></div></div></div>';
    });
    h += '<div class="stampwrap"><div class="stamp"' + st(5) + '>' + (g.over.byDefault ? 'Closed' : 'Solved') + '</div></div></div></div></div>';
    h += '<div class="fin-actions"' + st(5.9) + '>' + (isHost()
      ? '<button class="btn grow" data-act="again">Play again</button><button class="btn ghost grow" data-act="home">Home</button>'
      : '<button class="btn grow" data-act="home">Home</button>') + '</div>';
    if (!isHost()) h += '<p class="muted center fin-wait"' + st(5.9) + '>Or wait for ' + esc(nmFull(meta.host)) + ' to start another game.</p>';
    return h + '</div>';
  }

  // Someone else's turn: each state (rolling, moving, choosing, finishing) stays up for at least D0.min,
  // even when the player finishes it sooner. My own turn is never held back.
  function actionHtml(D) {
    const raw = actionRaw(D), g = game;
    if (g.turn === uid || E.windowWho(g) === uid || !(D0.min > 0)) { ui.lbl = null; return raw; }
    const key = g.phase + ':' + g.turn + ':' + E.logOf(g).length, now = Date.now(), L = ui.lbl;
    if (!L || L.sk !== meta.startedAt) { ui.lbl = { sk: meta.startedAt, key, html: raw, at: now }; return raw; }
    if (L.key === key) { L.html = raw; return raw; }
    if (now - L.at >= D0.min) { L.key = key; L.html = raw; L.at = now; return raw; }
    win.clearTimeout(ui.lblT);
    ui.lblT = win.setTimeout(render, L.at + D0.min - now + 30);
    return L.html;
  }
  function actionRaw(D) {
    const g = game, me = uid;
    if (g.phase === 'answer' && g.cur) return '<div class="ask"><div class="muted">Turn</div><div class="who">' + esc(nmFull(g.turn)) + '</div><div class="muted">is waiting for answers</div></div>';
    if (g.phase === 'window') {
      const w = E.windowWho(g);
      if (w === me) return '<div class="ask"><div class="who">Final accusation</div><div class="muted">' + (ui.accusing ? 'Choose a suspect, a weapon and a room in your notes. If you are wrong, you are out.' : 'Make your accusation now, or pass.') + '</div></div>';
      return '<div class="ask"><div class="muted">Final accusation</div><div class="who">' + esc(nmFull(w)) + '</div><div class="muted">is deciding whether to accuse</div></div>';
    }
    if (g.phase === 'accusing' && g.acc) return '<div class="ask"><div class="muted">Accusation</div><div class="who">' + esc(nm(g.acc.by)) + '</div><div class="muted">is being checked…</div></div>';
    if (g.turn === me) {
      if (ui.accusing) return '<div class="ask"><div class="who">Final accusation</div><div class="muted">Choose a suspect, a weapon and a room in your notes. If you are wrong, you are out.</div></div>';
      if (g.phase === 'move' && g.again) return '<div class="ask"><div class="who">Call again</div><div class="muted">Nobody could show a card. Pick a card and leave the room to call again, or make your final accusation.</div></div>';
      if (g.phase === 'move' && wasCalled()) return '<div class="ask"><div class="who">Your turn</div><div class="muted">You were called into the ' + esc(D.CARDS[hereCard()]) + '. Suggest here, or pick a card to move on.</div></div>';
      if (g.phase === 'move') return '<div class="ask"><div class="who">Your turn</div><div class="muted">' + (E.tired(g, uid) ? 'You are tired. Move 2 spaces, or Deduce to refill' : 'Pick Sprint, Jog or Walk to see where you can go') + (B.PASSAGE[B.roomOf(g.pos[uid])] != null ? ', or take the secret passage' : '') + '</div></div>';
      if (full() && g.phase === 'suggest') return '<div class="ask"><div class="muted">You are in the</div><div class="who">' + esc(D.CARDS[hereCard()]) + '</div><div class="muted">Choose a suspect and a weapon in your notes</div></div>';
      if (g.phase === 'end' && !ui.accusing) return '<div class="ask"><div class="who">Your turn</div><div class="muted">End your turn, or make an accusation</div></div>';
      return '<div class="ask"><div class="who">Your turn</div><div class="muted">' + (g.phase === 'end' ? 'Make your accusation' : 'Make a suggestion, or accuse if you are sure') + '</div></div>';
    }
    let h = '';
    const hereK = full() ? B.roomOf(g.pos[g.turn]) : -1;
    h += '<div class="ask"><div class="muted">' + (g.phase === 'end' ? 'Waiting for' : 'Turn') + '</div><div class="who">' + esc(nmFull(g.turn)) + '</div>' +
      '<div class="muted">' +
      (g.phase === 'end' ? 'to end their turn' : g.phase === 'move' ? (g.again ? 'got no answer, and must leave the room to call again' : 'is choosing how fast to go')
        : hereK >= 0 ? 'is in the ' + esc(D.CARDS[g.rc0 + hereK]) + ', choosing a suggestion' : 'is choosing a suggestion') + '</div></div>';
    if (E.isOut(g, me)) h += '<p class="muted center">Your accusation was wrong, so you are out. You still show cards when asked.</p>';
    return h;
  }

  // Drawn as SVG so phones can't swap the tick for a coloured emoji; both take the button's colour.
  const TICK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CROSS = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  // Marks the game already knows for certain: a card someone showed me is theirs, so it is
  // ticked for them and crossed for the envelope and everyone else. Kept apart from the
  // hand-made marks; tapping a filled cell overrides it ('-' = cleared on purpose).
  function autoNotes() {
    const out = {};
    if (!myShown) return out;
    const others = order().filter((p) => p !== uid);
    Object.keys(myShown).forEach((n) => {
      const s = myShown[n];
      if (!s || s.from == null || s.card == null) return;
      ['env'].concat(others).forEach((o) => { out[s.card + ':' + o] = o === s.from ? 'y' : 'n'; });
    });
    return out;
  }
  function noteVal(key, auto) {
    const v = ui.notes[key];
    if (v === '-') return undefined;
    return v !== undefined ? v : (auto || autoNotes())[key];
  }
  // A card has one owner: the column with a tick in this row (or null). The other columns of
  // that row then read as crossed.
  const noteCols = () => ['env'].concat(order().filter((p) => p !== uid));
  function rowTick(c, auto) { auto = auto || autoNotes(); return noteCols().find((o) => noteVal(c + ':' + o, auto) === 'y') || null; }
  // Clear the stored value of one cell, remembering a cleared automatic mark as '-'.
  function clearNote(key, auto) { if ((auto || autoNotes())[key]) ui.notes[key] = '-'; else delete ui.notes[key]; }
  // The notes sheet everyone gets: a tick or a cross per card and player, filled in by hand
  // (cards shown to me are filled in automatically). A tick crosses out the rest of the row
  // and the card's name; tapping another column of that row moves the tick there.
  function manualNotesHtml(D) {
    if (!myHand) return '';
    if (!meta.helper) return pickOnlyHtml(D);
    const others = order().filter((p) => p !== uid), auto = autoNotes();
    const rd = (c, o, v, on) => '<button class="rd ' + v + (on ? ' on' : '') + '" role="radio" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="' + (v === 'y' ? 'Has it' : 'Does not have it') + '" data-act="mark" data-c="' + c + '" data-o="' + o + '" data-v="' + v + '">' + (v === 'y' ? TICK : CROSS) + '</button>';
    let h = '<section class="card notes"><h2>Your notes</h2><div class="nscroll"><table class="nt manual' + (others.length > 3 ? ' dense' : '') + '"><thead><tr><th></th><th>Envelope</th>' +
      others.map((p) => '<th>' + esc(nmFull(p).slice(0, 7)) + '</th>').join('') + '</tr></thead><tbody>';
    [0, 1, 2].forEach((k) => {
      h += '<tr class="cat"><td colspan="' + (2 + others.length) + '">' + S.CAT_PLURAL[k] + '</td></tr>';
      for (let c = D.CS[k]; c < D.CS[k] + D.SZ[k]; c++) {
        const mine = myHand.includes(c), tk = mine ? null : rowTick(c, auto);
        h += '<tr class="' + (mine ? 'mine' : tk && tk !== 'env' ? 'held' : '') + selClass(c, k) + '">' + nameCell(D, c, k, mine);
        ['env'].concat(others).forEach((o) => {
          const v = tk ? (o === tk ? 'y' : 'n') : noteVal(c + ':' + o, auto);
          h += mine ? '<td class="n">–</td>' : '<td class="mk">' + rd(c, o, 'y', v === 'y') + rd(c, o, 'n', v === 'n') + '</td>';
        });
        h += '</tr>';
      }
    });
    return h + '</tbody></table></div><p class="muted">Tap ✓ if they have the card (or it is in the envelope), ✕ if they don\'t. Tap again to clear. Cards shown to you are filled in for you.' + (picking() ? ' Tap a card name to choose it.' : '') + '</p></section>';
  }

  // With the notes sheet switched off there is still a list to choose cards from.
  function pickOnlyHtml(D) {
    let h = '<section class="card notes"><h2>Cards</h2><table class="nt pickonly"><tbody>';
    [0, 1, 2].forEach((k) => {
      h += '<tr class="cat"><td>' + S.CAT_PLURAL[k] + '</td></tr>';
      for (let c = D.CS[k]; c < D.CS[k] + D.SZ[k]; c++) h += '<tr class="' + (myHand.includes(c) ? 'mine' : '') + selClass(c, k) + '">' + nameCell(D, c, k, myHand.includes(c)) + '</tr>';
    });
    return h + '</tbody></table></section>';
  }

  function askCol(D, label, cards, empty) {
    return '<div class="muted">' + label + '</div>' + (cards ? '<div class="cl">' + cards.map((c) => '<b>' + cardHtml(D, c) + '</b>').join('') + '</div>' : '<div class="muted">' + empty + '</div>');
  }
  // Left: the best question from the room I stand in. Right: the best question anywhere (the one that cuts the
  // possibilities down the most). In the 2D game every room is open, so the right side shows the runner-up instead.
  function askLeft(D, r) {
    if (r.solved) return askCol(D, 'Best to ask', null, 'Nothing left to ask');
    if (!full()) return askCol(D, 'Best to ask', askFor(r, null, 0), 'No clear choice yet');
    const room = hereCard();
    if (room == null) return askCol(D, 'Best to ask here', null, 'Walk into a room first');
    return askCol(D, 'Best to ask in the ' + esc(D.CARDS[room]), askFor(r, room, 0), 'No clear choice yet');
  }
  function askRight(D, r) {
    if (r.solved) return '<div class="muted">Envelope solved</div><div class="cl">' + r.envelope.map((l) => '<b>' + cardHtml(D, l[0].card) + '</b>').join('') + '</div>';
    return full() ? askCol(D, 'Best to ask anywhere', askFor(r, null, 0), 'No clear choice yet')
      : askCol(D, 'Next best to ask', askFor(r, null, 1), 'No other clear choice');
  }

  function notesHtml(D) {
    const r = helper();
    if (!r) return isTelot() ? '' : manualNotesHtml(D);
    const ord = order(), E_ = r.nP, others = ord.filter((p) => p !== uid);
    let located = 0;
    for (let c = 0; c < D.N; c++) if (r.certain[c] != null && r.certain[c] >= 0) located++;
    let h = '<div class="prog"><div class="tx">Located ' + located + ' out of ' + D.N + ' cards</div><div class="tr"><i style="width:' + Math.round(located / D.N * 100) + '%"></i></div></div>' +
      '<section class="card sum3"><div class="sc ask">' + askLeft(D, r) + '</div>' +
      '<div class="sc mid" title="Candidates left: suspects · weapons · rooms">' + r.envelope.map((l) => l.length).join(' · ') + '</div>' +
      '<div class="sc guess">' + askRight(D, r) + '</div></section>';
    h += '<section class="card notes"><h2>Your notes</h2>';
    h += '<table class="nt"><thead><tr><th></th><th>Envelope</th>' + others.map((p) => '<th>' + esc(nmFull(p).slice(0, 7)) + '</th>').join('') + '</tr></thead><tbody>';
    [0, 1, 2].forEach((k) => {
      h += '<tr class="cat"><td colspan="' + (2 + others.length) + '">' + S.CAT_PLURAL[k] + '</td></tr>';
      for (let c = D.CS[k]; c < D.CS[k] + D.SZ[k]; c++) {
        const mine = myHand.includes(c), inEnv = r.certain[c] === E_, canEnv = r.possible[c][E_];
        const pct = inEnv ? '100%' : !canEnv ? '–' : r.prob ? Math.round(r.prob[c][E_] * 100) + '%' : '?';
        h += '<tr class="' + (mine ? 'mine' : inEnv ? 'hit' : !canEnv ? 'elim' : '') + selClass(c, k) + '">' + nameCell(D, c, k, mine) + '<td class="pc">' + pct + '<div class="bar"><i style="width:' + (inEnv ? 100 : !canEnv ? 0 : r.prob ? Math.round(r.prob[c][E_] * 100) : 0) + '%"></i></div></td>' +
          others.map((p) => { const o = ord.indexOf(p); return '<td class="' + (r.certain[c] === o ? 'y">✓' : !r.possible[c][o] ? 'n">✕' : 'q">?') + '</td>'; }).join('') + '</tr>';
      }
    });
    return h + '</tbody></table><p class="muted">Envelope shows the chance each card is the answer. ✓ they hold it, ✕ they can\'t, ? unknown.</p></section>';
  }

  // Moon for a card that might be the shown one: how likely the showing player holds it.
  function moonFor(p) {
    if (p == null) return '✨';
    const m = p >= 0.9 ? '🌕' : p > 0.5 ? '🌖' : p >= 0.45 ? '🌗' : '🌘';
    return '<span title="Chance they hold it: ' + Math.round(p * 100) + '%">' + m + '</span>';
  }

  function turnsHtml(D) {
    const log = E.logOf(game);
    if (!log.length) return '<section class="card"><h2>Turns</h2><p class="muted">No turns yet.</p></section>';
    const tag = (p) => '<span class="pn">' + esc(nm(p).slice(0, 7)) + '</span>';
    // Telot only: what the solver can tell about the cards others showed (👁️ one card, a moon for two, ? for envelope-only)
    const r = helper(), ord = order(), evAt = [];
    if (r) { let k = 0; log.forEach((e, n) => { if (e.t === 's' || (e.t === 'a' && !e.ok)) evAt[k++] = n; }); }
    const hints = (n) => {
      const eye = new Set(), moon = new Map(), qm = new Set();
      if (!r) return { eye, moon, qm };
      (r.located || []).forEach((l) => {
        if (evAt[l.ev] !== n) return;
        if (l.cards.length === 1) eye.add(l.cards[0]);
        else l.cards.forEach((c) => moon.set(c, moonFor(r.prob ? r.prob[c][l.p] : null)));
      });
      const e = log[n];
      if (e.t === 's') e.cards.forEach((c) => {
        if (r.certain[c] != null && r.certain[c] >= 0) return;
        const by = ord.indexOf(e.by);
        if (!r.possible[c][r.nP] || !r.possible[c][by]) return;
        for (let o = 0; o < r.nP; o++) if (o !== by && r.possible[c][o]) return;
        qm.add(c);
      });
      return { eye, moon, qm };
    };
    let t = '<section class="card"><h2>Turns</h2><table class="tt"><thead><tr><th>#</th><th>By</th><th>Suspect</th><th>Weapon</th><th>Room</th><th>Showed</th></tr></thead><tbody>';
    for (let n = log.length - 1; n >= 0; n--) {
      const e = log[n], sh = myShown && myShown[n];
      if (e.t === 'd') { t += '<tr class="r"><td class="n">' + (n + 1) + '</td><td>' + tag(e.by) + '</td><td colspan="4"><div class="dd">' + E.deduceHtml(esc(nm(e.by)), e.add) + '</div></td></tr>'; continue; }
      const hn = hints(n);
      const cell = (c) => '<td>' + cardHtml(D, c) + (e.t === 's' && sh && sh.card === c ? '&nbsp;👁️' : hn.eye.has(c) ? '&nbsp;👁️' : hn.moon.has(c) ? '&nbsp;' + hn.moon.get(c) : '') +
        (hn.qm.has(c) ? '&nbsp;<span class="qm" title="Only this player or the envelope can hold it">?</span>' : '') +
        (isTelot() && myHand && myHand.includes(c) ? '<small class="yrs">yours</small>' : '') + '</td>';
      let ans, note = '';
      if (e.t === 'a') ans = '<span class="muted">Accused ' + (e.ok ? '✓' : '✗') + '</span>';
      else {
        const resp = e.resp || [], shower = resp.find((r) => r.r === 'showed');
        ans = shower ? tag(shower.p) : '<span class="muted">Nobody</span>';
        const none = resp.filter((r) => r.r === 'none').map((r) => esc(nm(r.p)));
        if (none.length) note = 'Passed: ' + none.join(', ');
      }
      t += '<tr class="r"><td class="n">' + (n + 1) + '</td><td>' + tag(e.by) + '</td>' + cell(e.cards[0]) + cell(e.cards[1]) + cell(e.cards[2]) + '<td>' + ans + '</td></tr>';
      if (note) t += '<tr class="nt"><td></td><td colspan="5"><div class="evsub">' + note + '</div></td></tr>';
    }
    return t + '</tbody></table><p class="muted">👁️ marks a card you saw or showed.' + (r ? ' The calculator also marks 👁️ when it can tell which card was shown. A moon means it is down to two cards (🌕 almost certain, 🌖 more than half, 🌗 about even, 🌘 less likely). ? means only that player or the envelope can hold the card.' : '') + '</p></section>';
  }

  // Entries I don't need to be told about: my own moves and cards I showed.
  function skippable(e) {
    return (e.t === 'a' && e.by === uid) || (e.resp || []).some((r) => r.p === uid && r.r === 'showed');
  }
  function pendingEntry() {
    const log = E.logOf(game);
    while (ui.seen < log.length && skippable(log[ui.seen])) ui.seen++;
    return ui.seen < log.length ? ui.seen : -1;
  }
  // ---------- the pop-up ----------
  // A suggestion or accusation plays out as a row of players under the cards. Whoever is thinking sits in a
  // white pill in the middle with their state above; players still in line wait on the right; players who
  // have answered slide off to the left. Each state stays up for at least D0.min, even if the real player
  // was faster, and the finished result waits for a tap on Next turn.
  function popup(D) {
    const g = game, log = E.logOf(g), sk = meta.startedAt || 0;
    let P;
    if (g.phase === 'answer' && g.cur) {
      const c = g.cur;
      P = { key: sk + ':' + c.n, kind: 's', live: true, by: c.by, cards: c.cards, list: c.order.slice(), at: c.i };
    } else if (g.phase === 'accusing' && g.acc) {
      P = { key: sk + ':' + log.length, kind: 'a', live: true, by: g.acc.by, cards: g.acc.cards, list: [g.acc.by], at: 0 };
    } else {
      const i = pendingEntry();
      if (i < 0) return '';
      const e = log[i];
      P = { key: sk + ':' + i, kind: e.t, live: false, e, i, by: e.by, cards: e.cards, list: e.t === 's' ? (e.resp || []).map((r) => r.p) : [e.by] };
    }
    if (P.kind === 'd') {                                   // Deduce: skipped the turn to refill
      ui.holdWant = true;
      return '<div class="deduce">' + E.deduceHtml(esc(nm(P.by)), P.e.add) + '</div><button class="btn" data-act="next">' + (P.by === uid ? 'OK' : 'Next turn') + '</button>';
    }
    // one stage per player who is asked; the last one ends with the outcome ("Showed" / "Passed") on the same player
    const lastR = P.live ? null : (P.e.resp || [])[P.list.length - 1];
    // Everyone who is asked goes "Showing…", and whoever has nothing to show gets a "Passed" of their own before the next
    // player is asked. (A player's stage is 2 * their place in line.)
    P.stages = [];
    if (P.kind === 's') {
      P.list.forEach((p, k) => { P.stages.push({ i: k, label: 'Showing…' }); if (k < P.list.length - 1) P.stages.push({ i: k, label: 'Passed' }); });
      P.stages.push({ i: P.list.length - 1, label: lastR && lastR.r !== 'showed' ? 'Passed' : 'Showed', fin: true });
    } else P.stages = [{ i: 0, label: 'Accusing…' }, { i: 0, label: 'Wrong', fin: true }];
    const items = P.kind === 's' ? P.list : [P.by];

    // where the replay is: it catches up with the real state one stage at a time
    const T = P.live ? (P.kind === 's' ? 2 * P.at : P.at) : P.stages.length - 1, now = Date.now();
    let R = ui.rp;
    if (!R || R.key !== P.key) R = ui.rp = { key: P.key, d: P.live ? T : 0, prev: P.live ? T : 0, since: now, first: now };
    while (R.d < T && now - R.since >= D0.min) { R.prev = R.d; R.d++; R.since = now; }
    win.clearTimeout(ui.rpT);
    if (R.d < T) ui.rpT = win.setTimeout(render, Math.max(0, R.since + D0.min - now) + 30);
    ui.holdWant = !P.live || R.d < T;                      // the bots wait while I'm still reading this
    const st = P.stages[R.d], cur = R.d === T;             // cur: showing the real state, not a replay of an earlier one
    const ft = Math.min(1, (now - R.first) / 1000).toFixed(2);
    // Telot only: a 🤡 on a card the suggester is known to hold, so they can't be hoping to find it elsewhere
    const rr = helper(), byo = rr ? order().indexOf(P.by) : -1;
    const bluff = rr && P.by !== uid && byo >= 0 ? (c) => rr.certain[c] === byo : null;
    const fn = (o) => fan(D, P.cards, { bluff, ...(o || {}), ft });
    const who = st.fin ? P.by : P.list[st.i];
    let head, cards, note = '', btn = '';

    if (P.kind === 'a' && !st.fin) {
      head = '<div class="ask"><div class="muted">Accusation</div><div class="who">' + esc(nm(P.by)) + '</div><div class="muted">' + (P.by === uid ? 'You accuse' : 'accuses') + '</div></div>';
      cards = fn(); note = '<p class="muted center">Checking the envelope…</p>';
    } else if (P.kind === 'a') {
      head = '<div class="ask"><div class="muted">Accusation</div><div class="who">' + esc(nmFull(P.by)) + '</div><div class="muted">accused</div></div>';
      cards = fn(); note = '<p class="rnote">' + esc(nm(P.by)) + ' was wrong and is out of the game.</p>';
      btn = '<button class="btn" data-act="next">Next turn</button>';
    } else if (!st.fin) {
      const iAsk = P.by === uid;
      head = '<div class="ask"><div class="muted">' + (iAsk ? 'You\'re asking' : esc(nm(P.by)) + ' is asking') + '</div><div class="who">' + esc(nm(who)) + '</div><div class="muted">';
      if (P.live && cur && who === uid) {                   // my turn to show a card
        const held = myHand ? P.cards.filter((c) => myHand.includes(c)) : [];
        const before = E.shownTo(myShown, P.by);
        head += (held.length ? 'Pick the card you show' : 'You have none of these') + '</div></div>';
        // Telot only: 🛡️ on the card that tells the asker the least (see E.showAdvice), when there is a real choice
        const adv = isTelot() && held.length > 1 ? E.showAdvice(D, held, before) : null;
        cards = fn({ tap: (c) => held.includes(c), dead: (c) => !held.includes(c), seen: (c) => held.includes(c) && before.includes(c), pick: (c) => adv === c, hint: 'Tap to show' });
        note = held.length ? '<p class="muted center">Only ' + esc(nm(P.by)) + ' sees the card you tap. 👁️ marks a card you already showed them.' +
          (adv != null ? ' 🛡️ is the safest one to show: it helps ' + esc(nm(P.by)) + ' least.' : '') + '</p>' : '';
        btn = held.length ? '' : (myHand ? '<button class="btn" data-act="pass">Pass</button>' : '');
      } else {
        head += 'if they have any of these</div></div>';
        cards = fn();
        if (P.live && cur) note = '<p class="muted center">' + (iAsk ? 'If ' + esc(nm(who)) + ' has one, you will see it.' : 'You won\'t see which card is shown.') + '</p>';
      }
    } else {                                                // the finished suggestion
      const e = P.e, resp = e.resp || [], shower = resp.find((r) => r.r === 'showed');
      if (e.by === uid) {                                   // mine: the card I was shown
        const sh = myShown && myShown[P.i], has = sh && sh.card != null, names = e.cards.map((c) => D.CARDS[c]).join(', ');
        head = '<div class="ask"><div class="muted">You asked about ' + esc(names) + '</div><div class="who">' + (shower ? esc(nm(shower.p)) : 'Nobody') + '</div><div class="muted">' +
          (shower ? 'showed you ' + (has ? 'the ' + esc(D.CARDS[sh.card]) : 'a card') : 'had any of these') + '</div></div>';
        cards = shower ? (has ? bigCard(D, sh.card, ft) : '') : fn();
        btn = '<button class="btn" data-act="next">OK</button>';
      } else {
        head = '<div class="ask"><div class="muted">Suggestion</div><div class="who">' + esc(nmFull(e.by)) + '</div><div class="muted">asked about</div></div>';
        cards = fn();
        note = '<p class="rnote">' + (shower ? esc(nm(shower.p)) + ' showed ' + esc(nm(e.by)) + ' a card.' : 'Nobody had any of these.') + '</p>';
        btn = '<button class="btn" data-act="next">Next turn</button>';
      }
    }

    // when the state of the same player changes, the old text slides up and away while the new one rises in
    const pst = P.stages[R.prev], tt = (now - R.since) / 1000;
    const lbl = R.prev !== R.d && pst.i === st.i && pst.label !== st.label && tt < 0.7
      ? '<span class="lo" style="--t:' + tt.toFixed(2) + 's">' + esc(pst.label) + '</span><span class="ln" style="--t:' + tt.toFixed(2) + 's">' + esc(st.label) + '</span>' : esc(st.label);
    const W = 124, x = (k) => -(k * W + W / 2) + 'px';
    const car = '<div class="car"><div class="trk" style="--from:' + x(P.stages[R.prev].i) + ';--to:' + x(st.i) + ';--t:' + Math.min(0.8, (now - R.since) / 1000).toFixed(2) + 's">' +
      items.map((p, k) => '<div class="ci' + (k === st.i ? ' on' : k < st.i ? ' past' : '') + '"><span class="cl">' + (k === st.i ? lbl : '') + '</span><span class="cp">' + esc(nm(p)) + '</span></div>').join('') + '</div></div>';
    return head + cards + car + note + btn;
  }
  function modalHtml(D) {
    const inner = popup(D);
    return inner ? '<div class="modal"><div class="mcard" role="dialog" aria-modal="true">' + inner + '</div></div>' : '';
  }

  // The mansion, for the full game.
  function boardState(D) {
    const g = game, ord = order();
    if (!(g.phase === 'move' && g.turn === uid)) ui.card = null;
    const go = ui.card ? E.reachWith(g, uid, ui.card) : null;
    const roomNames = Array.from({ length: B.ROOMS }, (_, k) => D.CARDS[g.rc0 + k]);
    return { pos: g.pos, order: ord, me: uid, turn: g.over ? null : g.turn, out: g.out, roomNames, go, mv: g.mv || null, phase: g.phase };
  }
  function legendHtml(D) {
    const g = game, ord = order();
    return '<div class="legend">' + ord.map((p, i) => '<span class="lg' + (g.turn === p ? ' on' : '') + '"><i style="background:' + SEAT_COLORS[i % SEAT_COLORS.length] + '"></i>' + esc(nm(p)) + ' <em>' + esc(D.CARDS[i]) + '</em>' + (g.cards && g.cards[p] ? ' <b class="cc" title="Sprint · Jog · Walk left">' + (E.tired(g, p) ? 'tired' : g.cards[p].s + '·' + g.cards[p].j + '·' + g.cards[p].w) + '</b>' : '') + '</span>').join('') + '</div>';
  }
  function boardHtml(D) {
    const g = game;
    if (!E.isFull(g) || !g.pos) return '';
    const st = boardState(D);
    if (want3d()) {                                   // the 3D game: a canvas is mounted into #b3d-host after each render
      ensure3d();
      if (ui.v3 !== false) {
        ui.v3state = st;
        return '<div class="bmap b3d"><div class="b3d-view" id="b3d-host">' + (ui.v3 ? '' : '<p class="muted center b3d-wait">Loading the 3D mansion…</p>') + '</div>' + legendHtml(D) + '</div>';
      }
    }
    return '<div class="bmap">' + boardSvg({ pos: st.pos, order: st.order, me: uid, turn: st.turn, out: st.out, roomNames: st.roomNames, go: st.go }) + legendHtml(D) + '</div>';
  }

  // ---------- the 3D board (3D game only) ----------
  // ui.v3: undefined = not asked for yet, null = loading, false = not available (the 2D map is shown instead), else the view.
  const want3d = () => !!(load3d && meta && meta.mode === '3d' && game && E.isFull(game) && game.pos);
  function ensure3d() {
    if (ui.v3 !== undefined) return;
    ui.v3 = null;
    Promise.resolve().then(load3d)
      .then((m) => { ui.v3 = m.createBoardView({ doc, win, onMove: (d) => run(() => doMove(d)) }); })
      .catch(() => { ui.v3 = false; })     // no WebGL or the files did not load: carry on with the flat map
      .then(() => render());
  }
  function sync3d() {
    const host = $('b3d-host');
    if (!host || !ui.v3 || !ui.v3state) return;
    if (ui.v3.el.parentNode !== host) { host.textContent = ''; host.appendChild(ui.v3.el); }
    if (ui.v3key !== meta.startedAt) { ui.v3key = meta.startedAt; ui.v3.reset(); }
    ui.v3.update(ui.v3state);
  }

  // ---------- the full game: the map is the whole screen ----------
  const hasMap = () => !!(game && E.isFull(game) && game.pos);
  const ICON_NOTES = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 3h8l4 4v14H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 12h6M10 16h6M10 8h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const ICON_TURNS = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // Round buttons bottom right, sitting just above the move buttons (they share one fixed column).
  // Sprint / Jog / Walk, bottom left: they only show where I can go; the card is spent when I pick the square.
  const ICON_CARD = {
    s: '<path d="M13.5 2.5L5.5 13.5h5.5l-1 8 8-11h-5.5z" fill="currentColor"/>',
    j: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    w: '<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    f: '<path d="M6 7h6l-6 8h6M14 4h4l-4 5h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  // Sprint / Jog / Walk: round buttons in the right-hand column, above Turns and Notes. They only show where I can go;
  // the card is spent when I pick the square.
  function stamHtml() {
    const g = game;
    if (!hasMap() || g.over || !g.cards || !g.cards[uid] || E.isOut(g, uid) || ui.sheet) return '';   // hidden while Notes / Turns are open
    const c = E.cardsOf(g, uid), mine = g.turn === uid && g.phase === 'move', tir = E.tired(g, uid);
    const btn = (k, n, tag) => '<button class="fab stam k-' + k + (mine && ui.card === k ? ' on' : '') + (n ? '' : ' zero') + '" data-act="card" data-k="' + k + '"' + (mine && n ? '' : ' disabled') + ' aria-pressed="' + (mine && ui.card === k ? 'true' : 'false') +
      '" aria-label="' + E.CARD_NAMES[k] + ', ' + tag + (k === 'f' ? ' spaces' : ' left') + ', up to ' + E.STEPS[k] + ' spaces" title="' + E.CARD_NAMES[k] + '"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' + ICON_CARD[k] + '</svg><b>' + tag + '</b></button>';
    return '<div class="stams" role="group" aria-label="Your stamina">' + (tir ? btn('f', 1, '2') : ['s', 'j', 'w'].map((k) => btn(k, c[k], String(c[k]))).join('')) + '</div>';
  }
  function hudHtml(D) {
    const notes = notesHtml(D) ? '<button class="fab' + (ui.sheet === 'notes' ? ' on' : '') + '" data-act="sheet" data-s="notes" aria-label="Your notes">' + ICON_NOTES + '</button>' : '';
    return '<div class="hud"><div class="hrow"><div class="fabs">' + stamHtml() + '<button class="fab' + (ui.sheet === 'turns' ? ' on' : '') + '" data-act="sheet" data-s="turns" aria-label="Turns">' + ICON_TURNS + '</button>' + notes + '</div></div>' + resultBubble(D) + floatHtml(D) + '</div>';
  }
  function sheetHtml(D) {
    if (!ui.sheet) return '';
    const notes = ui.sheet === 'notes';
    const en = ui.sheetClosing ? ' out' : ui.sheetEnter ? ' enter' : '';
    return '<div class="sbackdrop' + en + '" data-act="sheet" data-s=""></div><aside class="sheet' + en + '" role="dialog" aria-label="' + (notes ? 'Your notes' : 'Turns') + '"><button class="x sx" data-act="sheet" data-s="" aria-label="Close">×</button>' +
      '<div class="sbody">' + (notes ? notesHtml(D) : turnsHtml(D)) + '</div></aside>';
  }

  // Only the host can cancel; it deletes the room for everyone.
  function cancelHtml() {
    if (!isHost()) return '';
    if (!ui.cancel) return '<button class="btn danger cancelg" data-act="cancel">Cancel game</button>';
    return '<section class="card cancelc"><p><b>Cancel this game for everyone?</b> The room and everything in it is deleted. This can\'t be undone.</p>' +
      '<div class="row"><button class="btn danger grow" data-act="cancel-yes">Yes, cancel</button><button class="btn ghost grow" data-act="cancel-no">Keep playing</button></div></section>';
  }

  function gameHtml() {
    if (!game) return '<p class="muted center">Dealing…</p>';
    const D = deck(), ord = order();
    if (game.over) {                                                          // the finale is a pop-up over the table
      const closed = ui.finaleClosed === (meta.startedAt || 0) + ':' + game.over.winner;
      const bar = '<section class="card finbar"><div class="muted">' + (game.over.byDefault ? 'Everyone else is out' : 'Case closed') + '</div><div class="who">' + esc(nmFull(game.over.winner)) + '</div>' +
        '<div class="row"><button class="btn grow" data-act="finale-open">Show result</button>' + (isHost() ? '<button class="btn ghost grow" data-act="again">Play again</button>' : '') + '<button class="btn ghost grow" data-act="home">Home</button></div></section>';
      if (hasMap()) return '<div class="mapfull">' + (closed ? bar : '') + boardHtml(D) + '</div>' + hudHtml(D) + sheetHtml(D) +
        (closed ? '' : '<div class="modal"><div class="mcard finale" role="dialog" aria-modal="true"><button class="mclose" data-act="finale-close" aria-label="Close">×</button>' + finaleHtml(D) + '</div></div>');
      return (closed ? bar : '') + boardHtml(D) + turnsHtml(D) +
        (closed ? '' : '<div class="modal"><div class="mcard finale" role="dialog" aria-modal="true"><button class="mclose" data-act="finale-close" aria-label="Close">×</button>' + finaleHtml(D) + '</div></div>');
    }
    const key = String(meta.startedAt || 0), log = E.logOf(game);
    if (ui.seenKey !== key) { ui.seenKey = key; ui.seen = log.length; ui.sheet = null; ui.sheetEnter = false; ui.sheetClosing = false; }   // only what happens from now on; a new game starts with Notes/Turns closed
    if (full() && game.turn === uid && game.phase === 'suggest') {          // the room I walked into is already chosen
      const k = log.length + ':' + game.pos[uid];
      if (ui.selKey !== k) { ui.selKey = k; ui.sel[2] = hereCard(); }
    }
    if (hasMap()) return '<div class="mapfull"><section class="card act">' + actionHtml(D) + '</section>' + boardHtml(D) + '</div>' + hudHtml(D) + sheetHtml(D) + modalHtml(D);
    const h = '<section class="card act">' + actionHtml(D) + '</section>' + boardHtml(D);
    return h + notesHtml(D) + turnsHtml(D) + cancelHtml() + floatHtml(D) + modalHtml(D);
  }

  // Marks belong to one game: Play again reuses the room, so wipe them when a new game (new startedAt) begins.
  function syncNotesGame() {
    if (!roomCode || !meta || !meta.startedAt || meta.status !== 'playing') return;
    const gk = notesKey() + '-game', now = String(meta.startedAt), was = lsGet(gk);
    if (was === now) return;
    if (was != null) { ui.notes = {}; lsSet(notesKey(), '{}'); }   // an older game's marks
    lsSet(gk, now);
  }
  function render() {
    syncNotesGame();
    ui.holdWant = false;
    const pill = $('code-pill');
    pill.hidden = !roomCode;
    if (roomCode) pill.textContent = 'Room ' + roomCode;
    { const bb = $('back-btn'); if (bb) bb.hidden = !(roomCode && !(meta && meta.status === 'playing')); }      // back to the first page while still in the lobby
    let h;
    if (roomCode && gone && !meta) h = '<section class="card"><h2>Game cancelled</h2><p>' + 'The host cancelled this game and deleted the room.</p><button class="btn" data-act="home">Back to start</button></section>';
    else if (!roomCode || !meta) h = roomCode ? '<p class="muted center">Joining…</p>' : homeHtml();
    else if (!players[uid]) h = '<section class="card"><p>You are no longer in this room.</p><button class="btn" data-act="home">Back to start</button></section>';
    else if (meta.status === 'playing') h = gameHtml();
    else h = (ui.cancel && isHost() ? '<section class="card cancelc"><p><b>Leave and delete this room?</b> Everyone who joined is sent back to the start. This can\'t be undone.</p>' +
      '<div class="row"><button class="btn danger grow" data-act="cancel-yes">Yes, delete room</button><button class="btn ghost grow" data-act="cancel-no">Stay</button></div></section>' : '') + lobbyHtml();
    const inGame = !!(roomCode && meta && meta.status === 'playing' && players[uid] && game);
    const ttl = doc.querySelector('header h1');
    if (ttl) ttl.innerHTML = inGame && !game.over ? 'Turn ' + (E.logOf(game).length + 1) + ' <span class="tdot">•</span> <span class="tname">' + esc(nm(game.turn)) + '</span>' : 'Clues';
    doc.body.classList.toggle('fullmap', inGame && hasMap());
    doc.body.classList.toggle('home', !roomCode);
    const hd = doc.querySelector('header');
    if (hd && hd.offsetHeight) doc.documentElement.style.setProperty('--hh', hd.offsetHeight + 'px');
    const pb = $('players-btn');
    if (pb) pb.hidden = !inGame;
    const html = h + (inGame ? playersPanel() : '');
    if (html !== ui.lastHtml) {                                // same picture: leave it alone, so nothing re-animates
      // the Notes / Turns sheet, the players panel and the wide table are redrawn from scratch: keep where they were scrolled
      const keep = ['.sheet', '.ppanel', '.nscroll'].map((q) => { const e = doc.querySelector(q); return e ? [q, e.scrollTop, e.scrollLeft] : null; }).filter(Boolean);
      $('view').innerHTML = html; ui.lastHtml = html;
      keep.forEach(([q, top, left]) => { const e = doc.querySelector(q); if (e) { e.scrollTop = top; e.scrollLeft = left; } });
    }
    sync3d();
    const mk = (ui.info ? 'i' : 'w') + msg;
    if (ui.msgKey !== mk) {                                    // only touch it when it changes, so it doesn't re-animate
      ui.msgKey = mk;
      $('msg').innerHTML = msg ? '<span class="mt">' + esc(msg) + '</span>' + (ui.info ? '' : '<button class="mx" data-act="msg-close" aria-label="Dismiss">×</button>') : '';
    }
    $('msg').className = 'toast ' + (ui.info ? 'ok' : 'warn');
    syncHold(inGame && !game.over && !!ui.holdWant);
    if (roomCode && meta && meta.status === 'playing') { hostTick(); }
  }

  // ---------- events ----------
  // A short note that appears over the page and goes away by itself (errors stay until the next tap).
  function toast(text) {
    msg = text; ui.info = true;
    win.clearTimeout(ui.toastT);
    ui.toastT = win.setTimeout(() => { if (ui.info) { msg = ''; ui.info = false; render(); } }, 2200);
  }
  async function run(fn) {
    try { msg = ''; ui.info = false; await fn(); } catch (err) { msg = (err && err.message) || String(err); ui.info = false; }
    render();
  }

  doc.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'name') ui.name = t.value;
    else if (t.id === 'code') ui.code = t.value.toUpperCase();
    else if (t.id === 'edition') ui.edition = t.value;
  });
  doc.addEventListener('change', (e) => { if (e.target.id === 'edition') ui.edition = e.target.value; });

  doc.addEventListener('touchstart', () => {}, { passive: true });
  doc.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('button') && win.navigator.vibrate) { try { win.navigator.vibrate(8); } catch (err) { /* not everywhere */ } }
    const el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || el.classList.contains('off')) return;
    const a = el.getAttribute('data-act');
    switch (a) {
      case 'msg-close': msg = ''; ui.info = false; render(); break;
      case 'create': try { msg = ''; needName(); ui.choosing = true; ui.menu = true; } catch (err) { msg = err.message; } render(); break;
      case 'menu-close': ui.menu = false; ui.choosing = false; render(); break;
      case 'mk': ui.menu = false; run(() => createRoom(el.dataset.m)); break;
      case 'setmode': run(() => (isHost() ? net.set(room('meta/mode'), modeOf(el.dataset.m)) : null)); break;
      case 'card': ui.card = ui.card === el.dataset.k ? null : el.dataset.k; render(); break;
      case 'deduce': run(doDeduce); break;
      case 'pass': run(doPass); break;
      case 'passage': run(doPassage); break;
      case 'stayin': run(doStayIn); break;
      case 'stay': run(() => doMove('stay')); break;
      case 'go': run(() => doMove(+el.getAttribute('data-d'))); break;
      case 'join':
        run(() => { const c = (ui.code || '').trim().toUpperCase(); if (!c) throw new Error('Type the room code first.'); return joinRoom(c); }); break;
      case 'copy': run(async () => {
        try { await win.navigator.clipboard.writeText(shareUrl()); ui.copied = true; win.clearTimeout(ui.copiedT); ui.copiedT = win.setTimeout(() => { ui.copied = false; render(); }, 2200); toast('Link copied'); }
        catch (err) { const i = $('share'); if (i) { i.focus(); i.select(); } toast('Select the link and copy it'); }
      }); break;
      case 'bot': run(() => addBot(el.dataset.n)); break;
      case 'kick': run(() => removePlayer(el.dataset.p)); break;
      case 'helper': run(() => (isHost() ? net.set(room('meta/helper'), !meta.helper) : null)); break;
      case 'start': run(startGame); break;
      case 'again': run(backToLobby); break;
      case 'cancel': ui.cancel = true; render(); break;
      case 'cancel-no': ui.cancel = false; render(); break;
      case 'cancel-yes': run(async () => { if (!isHost()) return; const code = roomCode; await net.remove('roomIndex/' + code); await net.remove('rooms/' + code); win.location.href = win.location.pathname; }); break;
      case 'back':
        if (isHost()) {                                                  // the host's room would be left behind: ask first
          ui.cancel = true; render();
        } else run(async () => {
          try { if (roomCode && players[uid]) await net.remove(room('players/' + uid)); } catch (err) { /* leaving anyway */ }
          win.location.href = win.location.pathname;
        });
        break;
      case 'home': win.location.href = win.location.pathname; break;
      case 'pick': { const k = +el.dataset.k, c = +el.dataset.c; ui.sel[k] = ui.sel[k] === c ? null : c; ui.confirm = false; render(); break; }
      case 'next': ui.seen++; render(); break;
      case 'finale-close': ui.finaleClosed = (meta.startedAt || 0) + ':' + game.over.winner; render(); break;
      case 'finale-open': ui.finaleClosed = null; render(); break;
      case 'players': ui.plOpen = !ui.plOpen; render(); break;
      case 'bubble': { const n = E.logOf(game).length - 1; if (ui.bubOut !== n) { ui.bubOut = n; render(); win.setTimeout(() => { ui.bubGone = n; render(); }, D0.slide + 20); } break; }
      case 'sheet': {
        const want = el.dataset.s && ui.sheet !== el.dataset.s ? el.dataset.s : null;
        if (ui.sheetClosing) break;
        if (!want && ui.sheet) { closeSheet(); break; }
        ui.sheetEnter = !ui.sheet && !!want && D0.slide > 0;   // slide up from the bottom only when it was closed
        ui.sheet = want; render();
        if (ui.sheetEnter) win.setTimeout(() => { ui.sheetEnter = false; }, D0.slide + 60);
        break;
      }
      case 'pexp': ui.plExp[el.dataset.p] = !ui.plExp[el.dataset.p]; render(); break;
      case 'suggest': run(doSuggest); break;
      case 'accuse': ui.confirm = true; render(); break;
      case 'accuse-no': ui.confirm = false; render(); break;
      case 'accuse-yes': run(doAccuse); break;
      case 'accuse-open': ui.accusing = true; render(); break;
      case 'req-accuse': run(async () => { const ord = order(); await tx((g) => E.requestAccuse(g, uid, ord)); toast('You will be asked when this turn is over'); }); break;
      case 'req-cancel': run(() => { const ord = order(); return tx((g) => E.cancelRequest(g, uid, ord)); }); break;
      case 'win-pass': run(() => { const ord = order(); resetPick(); return tx((g) => E.windowPass(g, uid, ord)); }); break;
      case 'accuse-back': resetPick(); render(); break;
      case 'end': run(doEndTurn); break;
      case 'show': run(() => showCard(+el.dataset.c)); break;
      case 'mark': {
        const key = el.dataset.c + ':' + el.dataset.o;
        const all = autoNotes(), auto = all[key], c = el.dataset.c, tk = rowTick(c, all);
        if (tk && tk !== el.dataset.o) {                 // the row belongs to someone else: move the tick here
          clearNote(c + ':' + tk, all);
          if (auto === 'y') delete ui.notes[key]; else ui.notes[key] = 'y';
        } else if (noteVal(key, all) === el.dataset.v) clearNote(key, all);
        else if (auto === el.dataset.v) delete ui.notes[key];
        else ui.notes[key] = el.dataset.v;
        lsSet(notesKey(), JSON.stringify(ui.notes));
        render(); break;
      }
      default: break;
    }
  });

  // ---------- start ----------
  async function boot() {
    let fromUrl = null;
    try { fromUrl = new win.URL(win.location.href).searchParams.get('room'); } catch (e) { fromUrl = null; }
    if (fromUrl) { ui.code = fromUrl.toUpperCase().slice(0, 5); ui.invited = true; }
    render();
    if (!fromUrl) return;
    // Coming back to a room I'm already in (reload, or the host reopening the page).
    try {
      const u = await net.ready();
      if (u && (await net.get('rooms/' + ui.code + '/players/' + u))) { uid = u; enterRoom(ui.code); return; }
    } catch (e) { /* fall through to the join form */ }
    msg = 'Type your name, then tap Join room.';
    render();
  }
  boot();

  return { state: () => ({ uid, roomCode, meta, players, game, myHand, myShown }) };
}
