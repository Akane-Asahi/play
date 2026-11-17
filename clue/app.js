// Multiplayer Clues: lobby, turns, bots and notes. All network access goes through `net`
// (see main.js for the Firebase version), so the same code runs in tests against a fake.
import * as E from './engine.js';
import * as B from './board.js';
import { boardSvg, dieSvg, SEAT_COLORS } from './boardview.js';

export function startApp({ net, doc, win, delays }) {
  const S = win.ClueSolver;
  const D0 = { bot: 1100, none: 900, ...(delays || {}) };
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
  let unsubs = [];
  let msg = '';
  const ui = { notes: {}, sel: [null, null, null], accusing: false, confirm: false, plOpen: false, choosing: false, selKey: null, seen: 0, seenKey: null, plExp: {}, name: lsGet(NAME_KEY) || '', code: '', edition: 'clue-us' };
  let hostBusy = false, hostDirty = false, helperKey = null, helperRes = null, botPlan = null;

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
  function bigCard(D, c) {
    const src = portrait(D, c);
    return '<div class="bigcard art shownc">' + (src ? '<img class="pic" alt="" src="' + src + '" draggable="false">' : '') +
      '<small>' + S.CAT_NAMES[D.catOf(c)] + '</small><b>' + esc(D.CARDS[c]) + '</b></div>';
  }
  // The three-card fan. opts: tap(c) -> can be tapped, dead(c) -> greyed out, seen(c) -> eye, hint
  function fan(D, cards, opts) {
    opts = opts || {};
    return '<div class="fan">' + cards.map((c, i) => {
      const tap = opts.tap && opts.tap(c), live = !(opts.dead && opts.dead(c)), src = portrait(D, c);
      return '<div class="fc k' + i + (live ? ' live' : '') + (tap ? ' tap' : '') + (src ? ' art' : '') + '"' + (tap ? ' data-act="show" data-c="' + c + '"' : '') + '><div class="in">' +
        (src ? '<img class="pic" alt="" src="' + src + '" draggable="false">' : '') +
        '<small>' + S.CAT_NAMES[i] + '</small>' +
        (opts.seen && opts.seen(c) ? '<span class="seen" title="You showed them this card before">👁️</span>' : '') +
        '<b' + (D.CARDS[c].length > 10 ? ' class="long"' : '') + '>' + esc(D.CARDS[c]) + '</b>' + (tap && opts.hint ? '<i>' + esc(opts.hint) + '</i>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  // ---------- rooms ----------
  function needName() {
    const name = (ui.name || '').trim().slice(0, 20);
    if (!name) throw new Error('Type your name first.');
    lsSet(NAME_KEY, name);
    return name;
  }

  async function createRoom(mode) {
    const name = needName();
    uid = await net.signIn();
    let code = randomCode();
    for (let i = 0; i < 5 && (await net.get('rooms/' + code + '/meta')); i++) code = randomCode();
    await net.update('rooms/' + code, {
      'meta/host': uid, 'meta/edition': ui.edition, 'meta/status': 'lobby', 'meta/helper': true, 'meta/mode': mode === 'full' ? 'full' : 'fast', 'meta/createdAt': Date.now(),
      ['players/' + uid]: { name, seat: 0, bot: false },
    });
    enterRoom(code);
  }

  async function joinRoom(code) {
    const name = needName();
    uid = await net.signIn();
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
      net.on(room('meta'), (v) => { meta = v; render(); }, onErr),
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
    const up = { 'meta/status': 'playing', 'meta/startedAt': Date.now(), 'secret/envelope': envelope, game: E.newGame(ord, meta.mode === 'full' ? { mode: 'full', rc0: D.CS[2] } : null), shown: null };
    ord.forEach((pid, i) => { up['hands/' + pid] = hands[pid]; up['players/' + pid + '/handSize'] = sizes[i]; });
    await net.update(room(), up);
  }

  async function backToLobby() {
    if (!isHost()) return;
    const up = { 'meta/status': 'lobby', game: null, secret: null, shown: null };
    order().forEach((pid) => { up['hands/' + pid] = null; up['players/' + pid + '/handSize'] = null; });
    await net.update(room(), up);
  }

  // ---------- my moves ----------
  function resetPick() { ui.sel = [null, null, null]; ui.accusing = false; ui.confirm = false; }

  async function doSuggest() {
    if (!sugReady()) return;
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
  const die = () => 1 + Math.floor(Math.random() * 6);
  const doRoll = () => tx((g) => E.roll(g, uid, [die(), die()]));
  const doPassage = () => tx((g) => E.passage(g, uid));
  const doStayIn = () => tx((g) => E.stayIn(g, uid));
  const wasCalled = () => !!(game && game.called && game.called[uid]);
  const doMove = (d) => tx((g) => E.move(g, uid, d));
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
      if (!isBot(p)) return false;
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
    if (['suggest', 'end', 'roll', 'move'].includes(g.phase) && isBot(g.turn)) {
      const p = g.turn;
      await sleep(D0.bot);
      const key = p + ':' + E.logOf(g).length + ':' + (meta.startedAt || 0);
      if (!botPlan || botPlan.key !== key) {              // one think per turn, not one per step
        const hand = (await net.get(room('hands/' + p))) || [];
        const shown = await net.get(room('shown/' + p));
        botPlan = { key, mv: E.botThink(S, E.solverState(edition(), players, ord, p, hand, g, shown), Math.random) };
      }
      const mv = botPlan.mv;
      if (g.phase === 'move') return tx((x) => (x && x.phase === 'move' && x.turn === p ? E.move(x, p, E.botMove(x, p, mv.suggest ? mv.suggest[2] - x.rc0 : -1, Math.random)) : undefined));
      if (mv.accuse) return tx((x) => E.accuse(x, p, mv.accuse));
      if (g.phase === 'end') return tx((x) => E.endTurn(x, p, ord));
      if (g.phase === 'roll') {
        const here = B.roomOf(g.pos[p]);
        if (g.called && g.called[p]) return tx((x) => E.stayIn(x, p));
        if (B.PASSAGE[here] != null && B.PASSAGE[here] === mv.suggest[2] - g.rc0) return tx((x) => E.passage(x, p));
        return tx((x) => E.roll(x, p, [die(), die()]));
      }
      const cards = mv.suggest.slice();
      if (E.isFull(g)) cards[2] = E.roomCardHere(g, p);
      return tx((x) => E.suggest(x, p, cards, ord));
    }
    return false;
  }
  async function hostTick() {
    if (!isHost()) return;
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
      try { helperRes = S.analyse(E.solverState(edition(), players, order(), uid, myHand, game, myShown)); } catch (e) { helperRes = null; }
    }
    return helperRes && helperRes.ok ? helperRes : null;
  }

  // ---------- screens ----------
  function homeHtml() {
    return '<section class="card"><h2>Your name</h2><input type="text" id="name" maxlength="20" placeholder="e.g. Telot" autocomplete="nickname" value="' + esc(ui.name) + '"></section>' +
      '<section class="card"><h2>Start a room</h2><select id="edition">' +
      S.EDITIONS.map((e) => '<option value="' + esc(e.id) + '"' + (e.id === ui.edition ? ' selected' : '') + '>' + esc(e.name) + '</option>').join('') +
      '</select>' + (ui.choosing
        ? '<p class="muted" style="margin-top:12px">What kind of game?</p><div class="modes">' +
          '<button class="mode" data-act="mk" data-m="fast"><b>Fast game</b><span>Cards only. Take turns making suggestions, no board.</span></button>' +
          '<button class="mode" data-act="mk" data-m="full"><b>Full game</b><span>Roll the dice, walk the mansion and suggest in the room you enter.</span></button></div>'
        : '<button class="btn" data-act="create">Create room</button>') + '</section>' +
      '<section class="card"><h2>Join a room</h2><p class="muted">Type the code a friend sent you, or open their link.</p>' +
      '<input type="text" id="code" maxlength="5" placeholder="Room code" autocapitalize="characters" autocomplete="off" value="' + esc(ui.code) + '">' +
      '<button class="btn ghost" data-act="join">Join room</button></section>';
  }

  function lobbyHtml() {
    const ord = order(), host = isHost(), full = ord.length >= E.MAX_PLAYERS;
    let h = '<section class="card"><h2>Invite friends</h2><p class="muted">Share this link. Anyone who opens it can join.</p>' +
      '<div class="row"><input type="text" class="grow" id="share" readonly value="' + esc(shareUrl()) + '"><button class="btn ghost fit" data-act="copy">Copy</button></div></section>';
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
      h += '<section class="card"><h2>Game</h2><div class="modes">' + [['fast', 'Fast game', 'Cards only, no board.'], ['full', 'Full game', 'Dice, the mansion and rooms.']].map((m) =>
        '<button class="mode' + ((meta.mode || 'fast') === m[0] ? ' on' : '') + '" data-act="setmode" data-m="' + m[0] + '"><b>' + m[1] + '</b><span>' + m[2] + '</span></button>').join('') + '</div></section>';
      h += '<button class="btn" data-act="start"' + (ord.length < E.MIN_PLAYERS ? ' disabled' : '') + '>Start game</button>' +
        (ord.length < E.MIN_PLAYERS ? '<p class="muted center">You need at least ' + E.MIN_PLAYERS + ' players. Add a bot or invite a friend.</p>' : '');
    } else {
      h += '<p class="muted center">' + (meta.mode === 'full' ? 'Full game with dice and the mansion. ' : 'Fast game. ') + 'Waiting for ' + esc(nmFull(meta.host)) + ' to start the game.</p>';
    }
    return h;
  }

  // Am I choosing a suspect, weapon and room right now? (Then the names in my notes can be tapped.)
  function picking() {
    const g = game;
    if (!g || g.over || g.turn !== uid) return false;
    if (g.phase === 'answer' || g.phase === 'accusing' || g.phase === 'roll' || g.phase === 'move') return false;
    return g.phase !== 'end' || ui.accusing;
  }
  // The first cell of a notes row: the card's name, tappable while I'm choosing.
  function nameCell(D, c, k, mine, extra) {
    const pk = picking();
    return '<td' + (pk ? ' class="pkc" data-act="pick" data-k="' + k + '" data-c="' + c + '"' : '') + '>' + cardHtml(D, c) + (mine ? ' <span class="muted">yours</span>' : '') + (extra || '') + '</td>';
  }
  const selClass = (c, k) => (ui.sel[k] === c ? ' sel' : '') + (picking() ? ' pk' : '');

  // The buttons that float at the bottom of the screen on my turn.
  function floatHtml(D) {
    const g = game;
    if (!g || g.over || g.turn !== uid || g.phase === 'answer' || g.phase === 'accusing') return '';
    const ready = ui.sel.every((c) => c != null);
    let inner;
    if (g.phase === 'roll') {
      const to = B.PASSAGE[B.roomOf(g.pos[uid])];
      inner = '<div class="row"><button class="btn grow" data-act="roll">Roll the dice</button>' +
        (wasCalled() ? '<button class="btn ghost grow" data-act="stayin">Suggest here</button>' : '') +
        (to != null ? '<button class="btn ghost grow" data-act="passage">Secret passage to the ' + esc(D.CARDS[g.rc0 + to]) + '</button>' : '') + '</div>';
    } else if (g.phase === 'move') {
      inner = '<div class="fsum">Tap a glowing square or room on the board</div><div class="row"><button class="btn ghost grow" data-act="stay">Stay where you are</button></div>';
    } else if (g.phase === 'end' && !ui.accusing) {
      inner = '<div class="row"><button class="btn grow" data-act="end">End turn</button><button class="btn danger grow" data-act="accuse-open">Make an accusation</button></div>';
    } else if (ui.confirm && ready) {
      inner = '<div class="fsum warnt"><b>Accuse ' + esc(D.CARDS[ui.sel[0]]) + ' with the ' + esc(D.CARDS[ui.sel[1]]) + ' in the ' + esc(D.CARDS[ui.sel[2]]) + '?</b> If you are wrong, you are out.</div>' +
        '<div class="row"><button class="btn danger grow" data-act="accuse-yes">Yes, accuse</button><button class="btn ghost grow" data-act="accuse-no">Cancel</button></div>';
    } else {
      const sum = ready ? ui.sel.map((c) => esc(D.CARDS[c])).join(' · ') : (ui.sel.some((c) => c != null) ? ui.sel.map((c, k) => c != null ? esc(D.CARDS[c]) : '<i>' + S.CAT_NAMES[k].toLowerCase() + '?</i>').join(' · ') : 'Tap a suspect, a weapon and a room in your notes');
      inner = '<div class="fsum">' + sum + '</div>' + (g.phase === 'end'
        ? '<div class="row"><button class="btn danger grow" data-act="accuse"' + (ready ? '' : ' disabled') + '>Accuse</button><button class="btn ghost grow" data-act="accuse-back">Back</button></div>'
        : (full() && ready && !sugReady() ? '<div class="fsum"><i>You can only suggest the ' + esc(D.CARDS[hereCard()]) + ', where you are. An accusation can name any room.</i></div>' : '') +
          '<div class="row"><button class="btn grow" data-act="suggest"' + (sugReady() ? '' : ' disabled') + '>Suggest</button><button class="btn danger grow" data-act="accuse"' + (ready ? '' : ' disabled') + '>Accuse</button></div>');
    }
    return '<div class="float" role="region" aria-label="Your move">' + inner + '</div>';
  }

  // Cards I know a player holds: my own hand in full; for others only what I have marked.
  function knownCards(D, p) {
    if (p === uid) return (myHand || []).slice().sort((a, b) => a - b);
    const out = [], r = helper();
    if (r) { const o = order().indexOf(p); for (let c = 0; c < D.CARDS.length; c++) if (r.certain[c] === o) out.push(c); }
    else for (let c = 0; c < D.CARDS.length; c++) if (ui.notes[c + ':' + p] === 'y') out.push(c);
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
    return h + '</aside>';
  }

  function respPills(cur) {
    const resp = cur.resp || [];
    return '<div class="pills">' + cur.order.map((p, i) => {
      const r = resp[i];
      return '<span class="pill' + (i === cur.i ? ' on' : '') + (r ? ' done' : '') + '">' + esc(nm(p)) + (r ? ' · ' + (r.r === 'none' ? 'passed' : 'showed a card') : '') + '</span>';
    }).join('') + '</div>';
  }

  function lastResultHtml(D, mine) {
    const log = E.logOf(game), n = log.length - 1, e = log[n];
    if (!e || e.t !== 's') return '';
    const shower = (e.resp || []).find((r) => r.r === 'showed');
    const cards = e.cards.map((c) => D.CARDS[c]).join(', ');
    if (!shower) return '<div class="banner"><b>Nobody had any of these.</b><br>' + esc(cards) + '</div>';
    if (mine) {
      const sh = myShown && myShown[n], has = sh && sh.card != null;
      return '<div class="banner"><b>' + esc(nm(shower.p)) + ' showed you ' + (has ? esc(D.CARDS[sh.card]) : 'a card') + '.</b><br>You asked for ' + esc(cards) + '.</div>' +
        (has ? bigCard(D, sh.card) : '');
    }
    return '<div class="banner"><b>' + esc(nm(shower.p)) + ' showed ' + esc(nm(e.by)) + ' a card.</b><br>' + esc(cards) + '</div>';
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

  // What the pop-up shows while a suggestion or accusation is being answered.
  function liveHtml(D) {
    const g = game, me = uid;
    if (g.phase === 'answer' && g.cur) {
      const cur = g.cur, who = E.asked(g), iAsk = cur.by === me, meAsked = who === me;
      let h = respPills(cur) + '<div class="ask"><div class="muted">' + (iAsk ? 'You\'re asking' : esc(nm(cur.by)) + ' is asking') + '</div><div class="who">' + esc(nm(who)) + '</div><div class="muted">';
      if (meAsked) {
        const held = myHand ? cur.cards.filter((c) => myHand.includes(c)) : [];
        const before = E.shownTo(myShown, cur.by);
        h += (held.length ? 'Pick the card you show' : 'You have none of these') + '</div></div>';
        h += fan(D, cur.cards, { tap: (c) => held.includes(c), dead: (c) => !held.includes(c), seen: (c) => held.includes(c) && before.includes(c), hint: 'Tap to show' });
        h += held.length ? '<p class="muted center">Only ' + esc(nm(cur.by)) + ' sees the card you tap. 👁️ marks a card you already showed them.</p>'
          : (myHand ? '<button class="btn" data-act="pass">Pass</button>' : '');
      } else {
        h += 'if they have any of these</div></div>' + fan(D, cur.cards);
        h += '<p class="muted center">' + (iAsk ? 'If ' + esc(nm(who)) + ' has one, you will see it.' : 'You won\'t see which card is shown.') + '</p>';
      }
      return h;
    }
    if (g.phase === 'accusing' && g.acc) {
      return '<div class="ask"><div class="muted">Accusation</div><div class="who">' + esc(nm(g.acc.by)) + '</div><div class="muted">' + (g.acc.by === me ? 'You accuse' : 'accuses') + '</div></div>' +
        fan(D, g.acc.cards) + '<p class="muted center">Checking the envelope…</p>';
    }
    return '';
  }

  function actionHtml(D) {
    const g = game, me = uid;
    if (g.phase === 'answer' && g.cur) return '<div class="ask"><div class="muted">Turn</div><div class="who">' + esc(nmFull(g.turn)) + '</div><div class="muted">is waiting for answers</div></div>';
    if (g.phase === 'accusing' && g.acc) return '<div class="ask"><div class="muted">Accusation</div><div class="who">' + esc(nm(g.acc.by)) + '</div><div class="muted">is being checked…</div></div>';
    if (g.turn === me) {
      const dice = g.dice ? '<div class="dice">' + g.dice.map(dieSvg).join('') + '</div>' : '';
      if (g.phase === 'roll' && wasCalled()) return '<div class="ask"><div class="who">Your turn</div><div class="muted">You were called into the ' + esc(D.CARDS[hereCard()]) + '. Suggest here, or roll the dice.</div></div>';
      if (g.phase === 'roll') return '<div class="ask"><div class="who">Your turn</div><div class="muted">Roll the dice' + (B.PASSAGE[B.roomOf(g.pos[uid])] != null ? ', or take the secret passage' : '') + '</div></div>';
      if (g.phase === 'move') return '<div class="ask"><div class="who">Your turn</div>' + dice + '<div class="muted">You rolled ' + (g.dice[0] + g.dice[1]) + '. Tap where you want to go.</div></div>';
      if (full() && g.phase === 'suggest') return '<div class="ask"><div class="muted">You are in the</div><div class="who">' + esc(D.CARDS[hereCard()]) + '</div><div class="muted">Choose a suspect and a weapon in your notes</div></div>';
      if (g.phase === 'end' && !ui.accusing) return '<div class="ask"><div class="who">Your turn</div><div class="muted">End your turn, or make an accusation</div></div>';
      return '<div class="ask"><div class="who">Your turn</div><div class="muted">' + (g.phase === 'end' ? 'Make your accusation' : 'Make a suggestion, or accuse if you are sure') + '</div></div>';
    }
    let h = g.phase === 'end' && !g.nosug ? lastResultHtml(D, false) : '';
    const hereK = full() ? B.roomOf(g.pos[g.turn]) : -1;
    h += '<div class="ask"><div class="muted">' + (g.phase === 'end' ? 'Waiting for' : 'Turn') + '</div><div class="who">' + esc(nmFull(g.turn)) + '</div>' +
      (g.phase === 'move' && g.dice ? '<div class="dice">' + g.dice.map(dieSvg).join('') + '</div>' : '') + '<div class="muted">' +
      (g.phase === 'end' ? 'to end their turn' : g.phase === 'roll' ? 'is about to roll the dice' : g.phase === 'move' ? 'rolled ' + (g.dice[0] + g.dice[1]) + ' and is moving'
        : hereK >= 0 ? 'is in the ' + esc(D.CARDS[g.rc0 + hereK]) + ', choosing a suggestion' : 'is choosing a suggestion') + '</div></div>';
    if (E.isOut(g, me)) h += '<p class="muted center">Your accusation was wrong, so you are out. You still show cards when asked.</p>';
    return h;
  }

  // Drawn as SVG so phones can't swap the tick for a coloured emoji; both take the button's colour.
  const TICK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CROSS = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  // The notes sheet everyone gets: a tick or a cross per card and player, filled in by hand.
  function manualNotesHtml(D) {
    if (!myHand) return '';
    if (!meta.helper) return pickOnlyHtml(D);
    const others = order().filter((p) => p !== uid);
    const rd = (c, o, v, on) => '<button class="rd ' + v + (on ? ' on' : '') + '" role="radio" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="' + (v === 'y' ? 'Has it' : 'Does not have it') + '" data-act="mark" data-c="' + c + '" data-o="' + o + '" data-v="' + v + '">' + (v === 'y' ? TICK : CROSS) + '</button>';
    let h = '<section class="card"><h2>Your notes</h2><div class="nscroll"><table class="nt manual"><thead><tr><th></th><th>Envelope</th>' +
      others.map((p) => '<th>' + esc(nmFull(p).slice(0, 7)) + '</th>').join('') + '</tr></thead><tbody>';
    [0, 1, 2].forEach((k) => {
      h += '<tr class="cat"><td colspan="' + (2 + others.length) + '">' + S.CAT_PLURAL[k] + '</td></tr>';
      for (let c = D.CS[k]; c < D.CS[k] + D.SZ[k]; c++) {
        const mine = myHand.includes(c);
        h += '<tr class="' + (mine ? 'mine' : '') + selClass(c, k) + '">' + nameCell(D, c, k, mine);
        ['env'].concat(others).forEach((o) => {
          const v = ui.notes[c + ':' + o];
          h += mine ? '<td class="n">–</td>' : '<td class="mk">' + rd(c, o, 'y', v === 'y') + rd(c, o, 'n', v === 'n') + '</td>';
        });
        h += '</tr>';
      }
    });
    return h + '</tbody></table></div><p class="muted">Tap ✓ if they have the card (or it is in the envelope), ✕ if they don\'t. Tap again to clear.' + (picking() ? ' Tap a card name to choose it.' : '') + '</p></section>';
  }

  // With the notes sheet switched off there is still a list to choose cards from.
  function pickOnlyHtml(D) {
    let h = '<section class="card"><h2>Cards</h2><table class="nt pickonly"><tbody>';
    [0, 1, 2].forEach((k) => {
      h += '<tr class="cat"><td>' + S.CAT_PLURAL[k] + '</td></tr>';
      for (let c = D.CS[k]; c < D.CS[k] + D.SZ[k]; c++) h += '<tr class="' + (myHand.includes(c) ? 'mine' : '') + selClass(c, k) + '">' + nameCell(D, c, k, myHand.includes(c)) + '</tr>';
    });
    return h + '</tbody></table></section>';
  }

  function notesHtml(D) {
    const r = helper();
    if (!r) return isTelot() ? '' : manualNotesHtml(D);
    const ord = order(), E_ = r.nP, others = ord.filter((p) => p !== uid);
    let h = '<section class="card"><h2>Your notes</h2>';
    if (r.solved) h += '<div class="banner solvedb"><b>Solved:</b> ' + r.envelope.map((l) => esc(D.CARDS[l[0].card])).join(' · ') + '</div>';
    h += '<table class="nt"><thead><tr><th></th><th>Envelope</th>' + others.map((p) => '<th>' + esc(nmFull(p).slice(0, 7)) + '</th>').join('') + '</tr></thead><tbody>';
    [0, 1, 2].forEach((k) => {
      h += '<tr class="cat"><td colspan="' + (2 + others.length) + '">' + S.CAT_PLURAL[k] + '</td></tr>';
      for (let c = D.CS[k]; c < D.CS[k] + D.SZ[k]; c++) {
        const mine = myHand.includes(c), inEnv = r.certain[c] === E_, canEnv = r.possible[c][E_];
        const pct = inEnv ? '100%' : !canEnv ? '–' : r.prob ? Math.round(r.prob[c][E_] * 100) + '%' : '?';
        h += '<tr class="' + (mine ? 'mine' : inEnv ? 'hit' : !canEnv ? 'elim' : '') + selClass(c, k) + '">' + nameCell(D, c, k, mine) + '<td class="pc">' + pct + '</td>' +
          others.map((p) => { const o = ord.indexOf(p); return '<td class="' + (r.certain[c] === o ? 'y">✓' : !r.possible[c][o] ? 'n">✕' : 'q">?') + '</td>'; }).join('') + '</tr>';
      }
    });
    return h + '</tbody></table><p class="muted">Envelope shows the chance each card is the answer. ✓ they hold it, ✕ they can\'t, ? unknown.</p></section>';
  }

  function turnsHtml(D) {
    const log = E.logOf(game);
    if (!log.length) return '<section class="card"><h2>Turns</h2><p class="muted">No turns yet.</p></section>';
    const tag = (p) => '<span class="pn">' + esc(nm(p).slice(0, 7)) + '</span>';
    let t = '<section class="card"><h2>Turns</h2><table class="tt"><thead><tr><th>#</th><th>By</th><th>Suspect</th><th>Weapon</th><th>Room</th><th>Showed</th></tr></thead><tbody>';
    for (let n = log.length - 1; n >= 0; n--) {
      const e = log[n], sh = myShown && myShown[n];
      const cell = (c) => '<td>' + cardHtml(D, c) + (e.t === 's' && sh && sh.card === c ? '&nbsp;👁️' : '') + '</td>';
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
    return t + '</tbody></table><p class="muted">👁️ marks a card you saw or showed.</p></section>';
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
  // What someone else just did, waiting until I tap Next turn.
  function resultHtml(D, i) {
    const e = E.logOf(game)[i], names = e.cards.map((c) => D.CARDS[c]).join(', ');
    if (e.t === 's' && e.by === uid) {                       // my own suggestion: the card I was shown
      const resp = e.resp || [], shower = resp.find((r) => r.r === 'showed'), sh = myShown && myShown[i], has = sh && sh.card != null;
      return '<div class="pills">' + resp.map((r) => '<span class="pill done">' + esc(nm(r.p)) + ' · ' + (r.r === 'none' ? 'passed' : 'showed a card') + '</span>').join('') + '</div>' +
        '<div class="ask"><div class="muted">You asked about ' + esc(names) + '</div><div class="who">' + (shower ? esc(nm(shower.p)) : 'Nobody') + '</div><div class="muted">' +
        (shower ? 'showed you ' + (has ? 'the ' + esc(D.CARDS[sh.card]) : 'a card') : 'had any of these') + '</div></div>' +
        (shower ? (has ? bigCard(D, sh.card) : '') : fan(D, e.cards)) + '<button class="btn" data-act="next">OK</button>';
    }
    let h = '<div class="ask"><div class="muted">' + (e.t === 'a' ? 'Accusation' : 'Suggestion') + '</div><div class="who">' + esc(nmFull(e.by)) + '</div><div class="muted">' + (e.t === 'a' ? 'accused' : 'asked about') + '</div></div>' + fan(D, e.cards);
    if (e.t === 'a') {
      h += '<p class="rnote">' + esc(nm(e.by)) + ' was wrong and is out of the game.</p>';
    } else {
      const resp = e.resp || [], shower = resp.find((r) => r.r === 'showed');
      h += '<div class="pills">' + resp.map((r) => '<span class="pill done">' + esc(nm(r.p)) + ' · ' + (r.r === 'none' ? 'passed' : 'showed a card') + '</span>').join('') + '</div>';
      h += '<p class="rnote">' + (shower ? esc(nm(shower.p)) + ' showed ' + esc(nm(e.by)) + ' a card.' : 'Nobody had any of these.') + '</p>';
    }
    return h + '<button class="btn" data-act="next">Next turn</button>';
  }
  function modalHtml(D) {
    let inner = liveHtml(D);
    if (!inner) { const i = pendingEntry(); if (i >= 0) inner = resultHtml(D, i); }
    return inner ? '<div class="modal"><div class="mcard" role="dialog" aria-modal="true">' + inner + '</div></div>' : '';
  }

  // The mansion, for the full game.
  function boardHtml(D) {
    const g = game, ord = order();
    if (!E.isFull(g) || !g.pos) return '';
    const go = g.phase === 'move' && g.turn === uid && g.dice ? B.reach(g.pos, uid, g.dice[0] + g.dice[1]) : null;
    const roomNames = Array.from({ length: B.ROOMS }, (_, k) => D.CARDS[g.rc0 + k]);
    return '<section class="card boardc">' + boardSvg({ pos: g.pos, order: ord, me: uid, turn: g.over ? null : g.turn, out: g.out, roomNames, go }) +
      '<div class="legend">' + ord.map((p, i) => '<span class="lg' + (g.turn === p ? ' on' : '') + '"><i style="background:' + SEAT_COLORS[i % SEAT_COLORS.length] + '"></i>' + esc(nm(p)) + ' <em>' + esc(D.CARDS[i]) + '</em></span>').join('') + '</div></section>';
  }

  function gameHtml() {
    if (!game) return '<p class="muted center">Dealing…</p>';
    const D = deck(), ord = order();
    if (game.over) return '<section class="card finale">' + finaleHtml(D) + '</section>' + turnsHtml(D);
    const key = String(meta.startedAt || 0), log = E.logOf(game);
    if (ui.seenKey !== key) { ui.seenKey = key; ui.seen = log.length; }       // only what happens from now on
    if (full() && game.turn === uid && game.phase === 'suggest') {          // the room I walked into is already chosen
      const k = log.length + ':' + game.pos[uid];
      if (ui.selKey !== k) { ui.selKey = k; ui.sel[2] = hereCard(); }
    }
    const h = '<section class="card act">' + actionHtml(D) + '</section>' + boardHtml(D);
    return h + notesHtml(D) + turnsHtml(D) + floatHtml(D) + modalHtml(D);
  }

  function render() {
    const pill = $('code-pill');
    pill.hidden = !roomCode;
    if (roomCode) pill.textContent = 'Room ' + roomCode;
    let h;
    if (!roomCode || !meta) h = roomCode ? '<p class="muted center">Joining…</p>' : homeHtml();
    else if (!players[uid]) h = '<section class="card"><p>You are no longer in this room.</p><button class="btn" data-act="home">Back to start</button></section>';
    else if (meta.status === 'playing') h = gameHtml();
    else h = lobbyHtml();
    const inGame = !!(roomCode && meta && meta.status === 'playing' && players[uid] && game);
    const pb = $('players-btn');
    if (pb) pb.hidden = !inGame;
    $('view').innerHTML = h + (inGame ? playersPanel() : '');
    $('msg').textContent = msg;
    if (roomCode && meta && meta.status === 'playing') { hostTick(); }
  }

  // ---------- events ----------
  async function run(fn) {
    try { msg = ''; await fn(); } catch (err) { msg = (err && err.message) || String(err); }
    render();
  }

  doc.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'name') ui.name = t.value;
    else if (t.id === 'code') ui.code = t.value.toUpperCase();
    else if (t.id === 'edition') ui.edition = t.value;
  });
  doc.addEventListener('change', (e) => { if (e.target.id === 'edition') ui.edition = e.target.value; });

  doc.addEventListener('click', (e) => {
    const el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || el.classList.contains('off')) return;
    const a = el.getAttribute('data-act');
    switch (a) {
      case 'create': try { msg = ''; needName(); ui.choosing = true; } catch (err) { msg = err.message; } render(); break;
      case 'mk': run(() => createRoom(el.dataset.m)); break;
      case 'setmode': run(() => (isHost() ? net.set(room('meta/mode'), el.dataset.m === 'full' ? 'full' : 'fast') : null)); break;
      case 'roll': run(doRoll); break;
      case 'pass': run(doPass); break;
      case 'passage': run(doPassage); break;
      case 'stayin': run(doStayIn); break;
      case 'stay': run(() => doMove('stay')); break;
      case 'go': run(() => doMove(+el.getAttribute('data-d'))); break;
      case 'join': run(() => { const c = (ui.code || '').trim().toUpperCase(); if (!c) throw new Error('Type the room code first.'); return joinRoom(c); }); break;
      case 'copy': run(async () => {
        try { await win.navigator.clipboard.writeText(shareUrl()); msg = 'Link copied.'; }
        catch (err) { const i = $('share'); if (i) { i.focus(); i.select(); } msg = 'Select the link and copy it.'; }
      }); break;
      case 'bot': run(() => addBot(el.dataset.n)); break;
      case 'kick': run(() => removePlayer(el.dataset.p)); break;
      case 'helper': run(() => (isHost() ? net.set(room('meta/helper'), !meta.helper) : null)); break;
      case 'start': run(startGame); break;
      case 'again': run(backToLobby); break;
      case 'home': win.location.href = win.location.pathname; break;
      case 'pick': { const k = +el.dataset.k, c = +el.dataset.c; ui.sel[k] = ui.sel[k] === c ? null : c; ui.confirm = false; render(); break; }
      case 'next': ui.seen++; render(); break;
      case 'players': ui.plOpen = !ui.plOpen; render(); break;
      case 'pexp': ui.plExp[el.dataset.p] = !ui.plExp[el.dataset.p]; render(); break;
      case 'suggest': run(doSuggest); break;
      case 'accuse': ui.confirm = true; render(); break;
      case 'accuse-no': ui.confirm = false; render(); break;
      case 'accuse-yes': run(doAccuse); break;
      case 'accuse-open': ui.accusing = true; render(); break;
      case 'accuse-back': resetPick(); render(); break;
      case 'end': run(doEndTurn); break;
      case 'show': run(() => showCard(+el.dataset.c)); break;
      case 'mark': {
        const key = el.dataset.c + ':' + el.dataset.o;
        if (ui.notes[key] === el.dataset.v) delete ui.notes[key]; else ui.notes[key] = el.dataset.v;
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
    if (fromUrl) ui.code = fromUrl.toUpperCase().slice(0, 5);
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
