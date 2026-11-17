// Pure game rules for multiplayer Clues. No network, no DOM: every function takes the shared
// `game` object and returns the next one (or undefined when the move is not allowed right now).
//
// game = {
//   turn: pid,                       whose turn it is
//   phase: 'suggest' | 'answer' | 'end' | 'accusing',
//   cur:  { by, cards:[s,w,r], order:[pid...], i, n, resp:[{p, r}] }   the suggestion being answered
//   acc:  { by, cards }              an accusation waiting for the host to check
//   log:  [ {t:'s', by, cards, resp:[{p, r:'none'|'showed'}]} | {t:'a', by, cards, ok} ]
//   out:  { pid: true }              players who made a wrong accusation (they still answer)
//   over: { winner, envelope, byDefault? }
// }

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

export function newGame(order) {
  return { turn: order[0], phase: 'suggest' };
}

const validCards = (cards) => Array.isArray(cards) && cards.length === 3 && cards.every((c) => Number.isInteger(c));

export function suggest(game, by, cards, order) {
  if (!game || game.over || game.phase !== 'suggest' || game.turn !== by || !validCards(cards)) return undefined;
  const i = order.indexOf(by);
  if (i < 0) return undefined;
  const ask = [];
  for (let k = 1; k < order.length; k++) ask.push(order[(i + k) % order.length]);
  return { ...game, phase: 'answer', cur: { by, cards: cards.slice(), order: ask, i: 0, n: logOf(game).length } };
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
  return next;
}

export function endTurn(game, pid, order) {
  if (!game || game.over || game.phase !== 'end' || game.turn !== pid) return undefined;
  return { ...game, phase: 'suggest', turn: nextActive(game, order, pid) };
}

export function accuse(game, pid, cards) {
  if (!game || game.over || game.turn !== pid || !validCards(cards)) return undefined;
  if (game.phase !== 'suggest' && game.phase !== 'end') return undefined;
  return { ...game, phase: 'accusing', acc: { by: pid, cards: cards.slice() } };
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
  next.phase = 'suggest';
  next.turn = nextActive(next, order, by);
  return next;
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
