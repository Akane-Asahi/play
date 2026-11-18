// Pure game rules for multiplayer Clues. No network, no DOM: every function takes the shared
// `game` object and returns the next one (or undefined when the move is not allowed right now).
//
// game = {
//   turn: pid,                       whose turn it is
//   phase: 'suggest' | 'answer' | 'end' | 'accusing' | 'window',
//   cur:  { by, cards:[s,w,r], order:[pid...], i, n, resp:[{p, r}] }   the suggestion being answered
//   acc:  { by, cards }              an accusation waiting for the host to check
//   log:  [ {t:'s', by, cards, resp:[{p, r:'none'|'showed'}]} | {t:'a', by, cards, ok} ]
//   out:  { pid: true }              players who made a wrong accusation (they still answer)
//   over: { winner, envelope, byDefault? }
//
//   Full game only (dice and a board, see board.js):
//   mode: 'full', rc0: index of the first room card
//   phase: also 'roll' and 'move'
//   pos:  { pid: square | -(room + 1) }
//   dice: [a, b]                     this turn's roll
//   nosug: true                      this turn ended without a suggestion
//   called: { pid: true }            moved into a room by someone's suggestion: may suggest there next turn
//   Each player is the suspect of their seat (seat 0 = first suspect card, ...).
// }

import * as B from './board.js';

export const BOT_NAMES = ['Bebun', 'Shishu', 'Protibondhi', 'Sir', 'Dada', 'Bro'];
export const MIN_PLAYERS = 3, MAX_PLAYERS = 6;

export const seatOrder = (players) => Object.keys(players || {}).sort((a, b) => players[a].seat - players[b].seat);
export const isOut = (game, pid) => !!(game && game.out && game.out[pid]);
export const logOf = (game) => (game && game.log) || [];

export function nextActive(game, order, from) {
  const i = order.indexOf(from), n = order.length;
  for (let k = 1; k <= n; k++) {
    const p = order[(i + k) % n];
    if (!isOut(game, p)) return p;
  }
  return null;
}

export const isFull = (game) => !!game && game.mode === 'full';
const turnStart = (game) => (isFull(game) ? 'roll' : 'suggest');

// opts: { mode: 'full', rc0 } for the board game; nothing for the fast game.
export function newGame(order, opts) {
  if (!opts || opts.mode !== 'full') return { turn: order[0], phase: 'suggest' };
  const pos = {};
  order.forEach((p, i) => { pos[p] = B.STARTS[i % B.STARTS.length]; });
  return { turn: order[0], phase: 'roll', mode: 'full', rc0: opts.rc0, pos };
}

// ---- full game: dice and moving ----
export const roomCardHere = (game, pid) => {
  const k = isFull(game) && game.pos ? B.roomOf(game.pos[pid]) : -1;
  return k < 0 ? null : game.rc0 + k;
};
const uncall = (game, pid) => {
  if (!game.called || !game.called[pid]) return game;
  const called = { ...game.called }; delete called[pid];
  const next = { ...game, called };
  if (!Object.keys(called).length) delete next.called;
  return next;
};
// Called into this room by someone else's suggestion: suggest here without rolling.
export function stayIn(game, pid) {
  if (!isFull(game) || game.over || game.phase !== 'roll' || game.turn !== pid) return undefined;
  if (!game.called || !game.called[pid] || B.roomOf(game.pos[pid]) < 0 || game.again) return undefined;
  return { ...uncall(game, pid), phase: 'suggest' };
}
export function roll(game, pid, dice) {
  if (!isFull(game) || game.over || game.phase !== 'roll' || game.turn !== pid) return undefined;
  if (!Array.isArray(dice) || dice.length !== 2 || !dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) return undefined;
  return { ...uncall(game, pid), phase: 'move', dice: dice.slice() };
}
export function passage(game, pid) {
  if (!isFull(game) || game.over || game.phase !== 'roll' || game.turn !== pid) return undefined;
  const to = B.PASSAGE[B.roomOf(game.pos[pid])];
  if (to == null) return undefined;
  const next = { ...uncall(game, pid), phase: 'suggest', pos: { ...game.pos, [pid]: B.inRoom(to) } };
  delete next.again;
  return next;
}
// dest: a corridor square, a room as -(k + 1), or 'stay'.
export function move(game, pid, dest) {
  if (!isFull(game) || game.over || game.phase !== 'move' || game.turn !== pid || !game.dice) return undefined;
  const r = B.reach(game.pos, pid, game.dice[0] + game.dice[1]);
  // After a call nobody could answer you must leave the room, unless the dice leave nowhere to go.
  if (dest === 'stay') {
    if (game.again && (r.cells.size || Object.keys(r.rooms).length)) return undefined;
    const next = { ...game, phase: 'end', nosug: true };
    delete next.again;
    return next;
  }
  if (!Number.isInteger(dest)) return undefined;
  if (dest < 0) {
    if (r.rooms[B.roomOf(dest)] == null) return undefined;
    const next = { ...game, phase: 'suggest', pos: { ...game.pos, [pid]: dest } };
    delete next.again;
    return next;
  }
  if (!r.cells.has(dest)) return undefined;
  const next = { ...game, phase: 'end', nosug: true, pos: { ...game.pos, [pid]: dest } };
  delete next.again;
  return next;
}
// Where a bot goes: the room it wants if it can get there, else any room, else closer to the one it wants.
export function botMove(game, pid, goal, rng) {
  const r = B.reach(game.pos, pid, game.dice[0] + game.dice[1]), here = B.roomOf(game.pos[pid]);
  const rooms = Object.keys(r.rooms).map(Number);
  if (rooms.includes(goal)) return B.inRoom(goal);
  if (rooms.length) return B.inRoom(rooms[Math.floor(rng() * rooms.length)]);
  if (goal == null || goal < 0 || goal === here) goal = ((here < 0 ? 0 : here) + 1 + Math.floor(rng() * (B.ROOMS - 1))) % B.ROOMS;
  const d = B.distTo(goal);
  let best = 'stay', bd = Infinity;
  r.cells.forEach((_, c) => { const v = d.get(c); if (v != null && v < bd) { bd = v; best = c; } });
  if (best === 'stay' && game.again && r.cells.size) best = r.cells.keys().next().value;
  return best;
}

const validCards = (cards) => Array.isArray(cards) && cards.length === 3 && cards.every((c) => Number.isInteger(c));

export function suggest(game, by, cards, order) {
  if (!game || game.over || game.phase !== 'suggest' || game.turn !== by || !validCards(cards)) return undefined;
  const i = order.indexOf(by);
  if (i < 0) return undefined;
  if (isFull(game) && cards[2] !== roomCardHere(game, by)) return undefined;     // only the room you are in
  const ask = [];
  for (let k = 1; k < order.length; k++) ask.push(order[(i + k) % order.length]);
  const next = { ...game, phase: 'answer', cur: { by, cards: cards.slice(), order: ask, i: 0, n: logOf(game).length } };
  if (isFull(game)) {                                    // the suspect named is brought into the room
    const who = order[cards[0]];
    if (who && who !== by && game.pos[who] !== game.pos[by]) {
      next.pos = { ...game.pos, [who]: game.pos[by] };
      next.called = { ...(game.called || {}), [who]: true };
    }
  }
  return next;
}

// Whoever is being asked right now (or null).
export function asked(game) {
  return game && game.phase === 'answer' && game.cur ? game.cur.order[game.cur.i] : null;
}

export function answer(game, pid, r) {
  if (!game || game.over || asked(game) !== pid || (r !== 'none' && r !== 'showed')) return undefined;
  const cur = game.cur;
  const resp = (cur.resp || []).concat([{ p: pid, r }]);
  if (r === 'none' && cur.i + 1 < cur.order.length) return { ...game, cur: { ...cur, resp, i: cur.i + 1 } };
  const next = { ...game, phase: 'end', log: logOf(game).concat([{ t: 's', by: cur.by, cards: cur.cards, resp }]) };
  delete next.cur;
  // Full game: if nobody could show a card, the suggester calls again, but has to leave the room first (roll and move).
  if (isFull(game) && !resp.some((x) => x.r === 'showed')) { next.phase = 'roll'; next.again = true; }
  return next;
}

export function endTurn(game, pid, order) {
  if (!game || game.over || game.phase !== 'end' || game.turn !== pid) return undefined;
  const next = { ...game, phase: turnStart(game), turn: nextActive(game, order, pid) };
  delete next.dice; delete next.nosug; delete next.again;
  return handoff(next, order);
}

// ---- Final accusations out of turn ----
// Any player can ask to make an accusation at any time. It waits until the turn in progress is over; then the app
// asks each waiting player in seat order (phase 'window'), and each of them can accuse or pass. Then play carries on.
export function requestAccuse(game, pid, order) {
  if (!game || game.over || isOut(game, pid) || !order.includes(pid) || game.turn === pid) return undefined;
  if (game.req && game.req[pid]) return undefined;
  const next = { ...game, req: { ...(game.req || {}), [pid]: true } };
  if (game.win && !game.win.q.includes(pid)) next.win = { ...game.win, q: game.win.q.concat([pid]) };
  return next;
}
export function cancelRequest(game, pid, order) {
  if (!game || game.over || !game.req || !game.req[pid]) return undefined;
  const next = { ...game, req: { ...game.req } };
  delete next.req[pid];
  if (!Object.keys(next.req).length) delete next.req;
  if (game.win && game.phase === 'window') {
    const q = game.win.q.filter((p) => p !== pid);
    if (q.length) next.win = { ...game.win, q }; else return closeWindow(next, order);
  }
  return next;
}
export function windowPass(game, pid, order) {
  if (!game || game.over || game.phase !== 'window' || !game.win || game.win.q[0] !== pid) return undefined;
  return cancelRequest(game, pid, order) || undefined;
}
// Who is being asked right now whether to accuse (or null).
export const windowWho = (game) => (game && game.phase === 'window' && game.win ? game.win.q[0] : null);

// The turn is over: if players are waiting to accuse, ask them before the next turn starts.
function handoff(next, order) {
  const q = order.filter((p) => next.req && next.req[p] && !isOut(next, p));
  if (!q.length) { delete next.req; return next; }
  return { ...next, win: { q, phase: next.phase }, phase: 'window' };
}
// Everyone waiting has answered: the next turn begins.
function closeWindow(game, order) {
  const n = { ...game, phase: game.win.phase };
  delete n.win;
  if (n.req && !Object.keys(n.req).length) delete n.req;
  if (isOut(n, n.turn)) { n.turn = nextActive(n, order, n.turn); n.phase = turnStart(n); }
  return n;
}

export function accuse(game, pid, cards) {
  if (!game || game.over || !validCards(cards) || isOut(game, pid)) return undefined;
  const mine = game.turn === pid && (game.phase === 'suggest' || game.phase === 'end' || (isFull(game) && (game.phase === 'roll' || game.phase === 'move')));
  if (!mine && windowWho(game) !== pid) return undefined;
  const next = { ...game, phase: 'accusing', acc: { by: pid, cards: cards.slice() } };
  if (next.req && next.req[pid]) { next.req = { ...next.req }; delete next.req[pid]; if (!Object.keys(next.req).length) delete next.req; }
  return next;
}

// Host only: compare the accusation with the envelope.
export function resolveAccuse(game, envelope, order) {
  if (!game || game.over || game.phase !== 'accusing' || !game.acc) return undefined;
  const { by, cards } = game.acc;
  const ok = cards.length === 3 && cards.every((c) => envelope.includes(c));
  const next = { ...game, log: logOf(game).concat([{ t: 'a', by, cards, ok }]) };
  delete next.acc;
  if (ok) {
    next.over = { winner: by, envelope: envelope.slice() };
    return next;
  }
  next.out = { ...(game.out || {}), [by]: true };
  const left = order.filter((p) => !isOut(next, p));
  if (left.length <= 1) {
    next.over = { winner: left[0] || null, envelope: envelope.slice(), byDefault: true };
    return next;
  }
  if (game.win) {                                          // asked in the accusation window: the next turn has not started yet
    const q = game.win.q.filter((p) => p !== by && !isOut(next, p));
    if (q.length) return { ...next, phase: 'window', win: { ...game.win, q } };
    return closeWindow(next, order);
  }
  next.phase = turnStart(game);
  delete next.dice; delete next.nosug; delete next.again;
  next.turn = nextActive(next, order, by);
  return handoff(next, order);
}

// Shuffle and deal. rng() -> [0,1). Returns { envelope:[s,w,r], hands:{pid:[cards]} }.
export function deal(D, order, sizes, rng) {
  const envelope = [0, 1, 2].map((k) => D.CS[k] + Math.floor(rng() * D.SZ[k]));
  const rest = [];
  for (let c = 0; c < D.N; c++) if (!envelope.includes(c)) rest.push(c);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const hands = {};
  let k = 0;
  order.forEach((pid, i) => { hands[pid] = rest.slice(k, k + sizes[i]).sort((a, b) => a - b); k += sizes[i]; });
  return { envelope, hands };
}

// What one player knows, in the shape ClueSolver.analyse() expects.
// shown[n] = { card } for log entry n: the card this player was shown, or showed.
export function solverState(edition, players, order, me, hand, game, shown) {
  const seat = (pid) => order.indexOf(pid);
  const events = [];
  logOf(game).forEach((e, n) => {
    if (e.t === 's') {
      const sh = shown && shown[n];
      events.push({
        type: 'suggest', by: seat(e.by), cards: e.cards.slice(),
        responses: (e.resp || []).map((r) => {
          const o = { p: seat(r.p), r: r.r };
          if (r.r === 'showed' && sh && sh.card != null && (e.by === me || r.p === me)) o.card = sh.card;
          return o;
        }),
      });
    } else if (e.t === 'a' && !e.ok) {
      events.push({ type: 'accuse', by: seat(e.by), cards: e.cards.slice() });
    }
  });
  return {
    edition,
    players: order.map((pid) => ({ name: players[pid].name, hand: players[pid].handSize })),
    me: seat(me), myCards: (hand || []).slice(), faceUp: [], events,
  };
}

// Which card a player shows: one they have already shown this asker if possible, else the lowest.
export function pickShow(held, shownBefore) {
  const again = held.find((c) => shownBefore && shownBefore.includes(c));
  return again != null ? again : held[0];
}

// Cards `me` has already shown to `asker` (from my private shown notes).
export function shownTo(shown, asker) {
  const out = [];
  if (shown) Object.keys(shown).forEach((n) => { const s = shown[n]; if (s && s.to === asker && s.card != null) out.push(s.card); });
  return out;
}

// A bot's move on its turn: { accuse:[s,w,r] } when it is certain, else { suggest:[s,w,r] }.
export function botThink(S, state, rng) {
  const D = S.makeDeck(state.edition);
  let res = null;
  try { res = S.analyse(state, { chains: 4, steps: 1500 }); } catch (e) { res = null; }
  if (res && res.ok && res.solved) return { accuse: res.envelope.map((l) => l[0].card) };
  if (res && res.ok) {
    let best = null;
    try { best = S.bestSuggestions(res, state, 1)[0]; } catch (e) { best = null; }
    if (best && validCards(best.cards)) return { suggest: best.cards.slice() };
  }
  const mine = new Set(state.myCards);
  return {
    suggest: [0, 1, 2].map((k) => {
      const pool = [];
      for (let c = D.CS[k]; c < D.CS[k] + D.SZ[k]; c++) if (!mine.has(c) && (!res || !res.ok || res.possible[c][res.nP])) pool.push(c);
      const from = pool.length ? pool : Array.from({ length: D.SZ[k] }, (_, i) => D.CS[k] + i);
      return from[Math.floor(rng() * from.length)];
    }),
  };
}
