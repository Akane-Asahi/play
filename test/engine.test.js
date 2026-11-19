import assert from 'node:assert';
import * as E from '../clue/engine.js';
import { loadSolver } from './load-solver.js';
const S = loadSolver();

// rules: basic flow
{
  const order = ['a', 'b', 'c'];
  let g = E.newGame(order);
  assert.equal(E.suggest(g, 'b', [0, 6, 12], order), undefined, 'not your turn');
  g = E.suggest(g, 'a', [0, 6, 12], order);
  assert.deepEqual(g.cur.order, ['b', 'c']);
  assert.equal(E.answer(g, 'c', 'none'), undefined, 'c is not asked yet');
  g = E.answer(g, 'b', 'none');
  assert.equal(E.asked(g), 'c');
  g = E.answer(g, 'c', 'showed');
  assert.equal(g.phase, 'end'); assert.equal(g.cur, undefined); assert.equal(g.log.length, 1);
  assert.equal(E.endTurn(g, 'b', order), undefined);
  g = E.endTurn(g, 'a', order);
  assert.equal(g.turn, 'b');
  // wrong accusation knocks b out, turn passes to c
  g = E.accuse(g, 'b', [1, 7, 13]);
  g = E.resolveAccuse(g, [0, 6, 12], order);
  assert(g.out.b && !g.over); assert.equal(g.turn, 'c');
  // b still answers
  g = E.suggest(g, 'c', [1, 7, 13], order);
  assert.deepEqual(g.cur.order, ['a', 'b']);
  g = E.answer(E.answer(g, 'a', 'none'), 'b', 'none');
  assert.equal(g.phase, 'end');
  // second wrong accusation leaves one player: wins by default
  g = E.resolveAccuse(E.accuse(g, 'c', [2, 8, 14]), [0, 6, 12], order);
  assert(g.over && g.over.byDefault && g.over.winner === 'a');
  // nothing moves after the end
  assert.equal(E.suggest(g, 'a', [0, 6, 12], order), undefined);
}

// full game: cards, moving, rooms, passages, Deduce
{
  const B = await import('../clue/board.js');
  const order = ['a', 'b', 'c'];
  const fresh = () => E.newGame(order, { mode: 'full', rc0: 12 });
  let g = fresh();
  assert(g.phase === 'move' && !('dice' in g), 'a turn starts at the move step, no dice');
  assert.deepEqual(g.cards.a, { s: 3, j: 5, w: 4 }); assert.deepEqual(g.cards.c, { s: 3, j: 5, w: 4 });
  assert.equal(E.roll, undefined, 'dice are gone');
  assert.equal(E.suggest(g, 'a', [0, 6, 12], order), undefined, 'cannot suggest before moving');
  assert.equal(E.move(g, 'b', B.inRoom(0), 'w'), undefined, 'not your turn');
  assert.equal(E.move(g, 'a', B.inRoom(4), 'w'), undefined, 'the middle room is too far for a Walk');
  assert.equal(E.move(g, 'a', B.inRoom(0), 'x'), undefined, 'no such card');
  assert.equal(E.move(g, 'a', B.inRoom(0)), undefined, 'a card has to be named');
  assert.equal(E.move(g, 'a', B.inRoom(0), 'f'), undefined, 'Tired only when every card is gone');
  assert.equal(E.reachWith(g, 'a', 'f'), null);
  assert(E.reachWith(g, 'a', 's').rooms[4] != null || Object.keys(E.reachWith(g, 'a', 's').rooms).length > 0, 'a Sprint reaches rooms');
  assert(Object.keys(E.reachWith(g, 'a', 's').rooms).length >= Object.keys(E.reachWith(g, 'a', 'w').rooms).length, 'a bigger card never reaches less');
  assert(!E.canDeduce(g, 'a') && E.deduce(g, 'a', order) === undefined, 'Deduce is locked while every kind has a card');
  g = E.move(g, 'a', B.inRoom(0), 'j');
  assert.equal(g.phase, 'suggest'); assert.deepEqual(g.cards.a, { s: 3, j: 4, w: 4 }, 'only the card played is spent, and only on arrival');
  assert(g.mv.p === 'a' && g.mv.c === 'j' && g.mv.n === 1);
  assert.deepEqual(g.cards.b, { s: 3, j: 5, w: 4 }, 'other hands untouched');
  assert.equal(E.suggest(g, 'a', [0, 6, 13], order), undefined, 'only the room you are in');
  g = E.suggest(g, 'a', [0, 6, 12], order);
  assert(!g.mv, 'a suggestion clears the move note');
  g = E.answer(g, 'b', 'showed');
  g = E.endTurn(g, 'a', order);
  assert(g.phase === 'move' && g.turn === 'b');
  g = E.move(g, 'b', 'stay');
  assert(g.phase === 'end' && g.nosug && g.cards.b.w === 4, 'staying put costs nothing');
  g = E.endTurn(E.move(E.endTurn(g, 'b', order), 'c', 'stay'), 'c', order);
  g = E.passage(g, 'a');
  assert(g.phase === 'suggest' && g.pos.a === B.inRoom(8) && g.mv.c === 'p', 'kitchen passage leads to the study, free');
  assert.deepEqual(g.cards.a, { s: 3, j: 4, w: 4 }, 'a passage costs no card');
  // a named suspect's player is brought into the room and may suggest there next turn
  g = E.suggest(g, 'a', [1, 6, 20], order);                 // suspect 1 is seat 1: player b
  assert(g.pos.b === g.pos.a && g.called.b, 'b is moved into the study');
  g = E.endTurn(E.answer(g, 'b', 'showed'), 'a', order);
  assert.equal(E.stayIn(g, 'a'), undefined);
  const stay = E.stayIn(g, 'b');
  assert(stay.phase === 'suggest' && !stay.called, 'called player suggests without moving');
  const away = Number(Object.keys(E.reachWith(g, 'b', 's').rooms)[0]);
  assert(!E.move(g, 'b', B.inRoom(away), 's').called, 'moving gives the chance up');
  assert(!E.suggest(stay, 'b', [0, 7, 20], order).called, 'no call when already in the room');
  // nobody could show a card: the suggester calls again, but has to leave the room first
  {
    let h = E.move(fresh(), 'a', B.inRoom(0), 'j');
    h = E.suggest(h, 'a', [0, 6, 12], order);
    h = E.answer(E.answer(h, 'b', 'none'), 'c', 'none');
    assert(h.phase === 'move' && h.again && h.turn === 'a', 'no answer: move again');
    assert.equal(E.stayIn(h, 'a'), undefined);
    assert(E.accuse(h, 'a', [0, 6, 12]), 'a final accusation is allowed instead of moving');
    assert.equal(E.move(h, 'a', 'stay'), undefined, 'must leave the room');
    assert.equal(E.deduce(h, 'a', order), undefined, 'and Deduce is locked here anyway');
    const out = [...E.reachWith(h, 'a', 'w').cells.keys()][0];
    const moved = E.move(h, 'a', out, 'w');
    assert(moved.phase === 'end' && !moved.again, 'out in the corridor, call again later');
    const viaDoor = E.move(h, 'a', B.inRoom(1), 's');
    assert(viaDoor && viaDoor.phase === 'suggest' && !viaDoor.again, 'into another room: call again');
    const p2 = E.passage(h, 'a');
    assert(p2 && p2.phase === 'suggest' && !p2.again, 'the secret passage is a way out too');
    // a suggestion someone answered does not give another call
    let k = E.answer(E.suggest(E.move(fresh(), 'a', B.inRoom(0), 'j'), 'a', [0, 6, 12], order), 'b', 'showed');
    assert(k.phase === 'end' && !k.again);
  }
  // counts fall to zero, then Tired (2 spaces), then Deduce gives it all back
  {
    let h = fresh();
    h.cards.a = { s: 0, j: 2, w: 1 };
    assert(E.canDeduce(h, 'a') && E.playable(h, 'a').join() === 'j,w' && !E.tired(h, 'a'), 'one kind at zero unlocks Deduce');
    assert.equal(E.move(h, 'a', B.inRoom(0), 's'), undefined, 'no Sprint left');
    h.cards.a = { s: 0, j: 0, w: 0 };
    assert(E.tired(h, 'a') && E.playable(h, 'a').join() === 'f');
    assert.equal(E.move(h, 'a', B.inRoom(0), 'w'), undefined);
    const two = [...E.reachWith(h, 'a', 'f').cells.entries()];
    assert(two.length && two.every(([, d]) => d <= 2), 'Tired is two spaces');
    const t = E.move(h, 'a', two[0][0], 'f');
    assert(t && t.phase === 'end' && t.cards.a.s === 0 && t.cards.a.j === 0 && t.cards.a.w === 0 && t.mv.c === 'f', 'Tired never runs out');
    // Deduce
    h.cards.a = { s: 0, j: 3, w: 4 };
    const d = E.deduce(h, 'a', order);
    assert(d && d.turn === 'b' && d.phase === 'move', 'Deduce ends the turn: no move, no suggestion');
    assert.deepEqual(d.cards.a, { s: 1, j: 5, w: 6 }, 'refill adds 1 Sprint, 2 Jog, 2 Walk on top of what is left');
    assert.deepEqual(d.log[d.log.length - 1], { t: 'd', by: 'a', add: { s: 1, j: 2, w: 2 } });
    assert.equal(d.pos.a, h.pos.a, 'Deduce does not move you');
    assert(!d.nosug && !d.mv);
    h.cards.a = { s: 0, j: 0, w: 0 };
    assert.deepEqual(E.deduce(h, 'a', order).cards.a, { s: 1, j: 2, w: 2 }, 'from empty');
    h.cards.a = { s: 9, j: 9, w: 9 };
    assert.equal(E.deduce(h, 'a', order), undefined, 'locked with plenty');
    assert.equal(E.deduce({ ...h, cards: { ...h.cards, a: { s: 0, j: 1, w: 1 } }, phase: 'suggest' }, 'a', order), undefined, 'only at the start of the turn');
    assert.equal(E.deduce({ ...h, cards: { ...h.cards, a: { s: 0, j: 1, w: 1 } } }, 'b', order), undefined, 'only on your own turn');
    assert.equal(E.deduceHtml('Sir', { s: 1, j: 2, w: 2 }), '<h2>Sir will skip this step</h2><h5>Stamina refilled</h5><p>1 Sprint, 2 Jog, 2 Walks</p>');
  }
  // bots: every choice they make is a legal move
  {
    const rng = S.mulberry32(7);
    for (let i = 0; i < 400; i++) {
      const pid = order[i % 3], h0 = fresh();
      h0.cards[pid] = { s: Math.floor(rng() * 3), j: Math.floor(rng() * 3), w: Math.floor(rng() * 3) };
      if (rng() < 0.2) h0.cards[pid] = { s: 0, j: 0, w: 0 };
      h0.turn = pid;
      h0.pos[pid] = rng() < 0.5 ? B.inRoom(Math.floor(rng() * 9)) : B.STARTS[i % 6];
      if (rng() < 0.2) h0.again = true;
      const goal = Math.floor(rng() * 10) - 1, p = E.PERSONAS[i % E.PERSONAS.length];
      const a = E.botTurn(h0, pid, goal, rng, p);
      const nx = a.act === 'move' ? E.move(h0, pid, a.dest, a.card) : a.act === 'passage' ? E.passage(h0, pid) : a.act === 'deduce' ? E.deduce(h0, pid, order)
        : a.act === 'stay' ? (h0.called && h0.called[pid] ? E.stayIn(h0, pid) || E.move(h0, pid, 'stay') : E.move(h0, pid, 'stay')) : null;
      assert(nx, 'bot chose a legal action: ' + JSON.stringify(a) + ' ' + JSON.stringify(h0.cards[pid]) + ' at ' + h0.pos[pid] + (h0.again ? ' again' : ''));
    }
    // a bot with nothing left deduces (it can't reach a room with 2 steps), and a Sneak does not crawl at a far room
    const far = fresh(); far.cards.a = { s: 0, j: 0, w: 0 }; far.pos.a = B.STARTS[3];
    assert.equal(E.botTurn(far, 'a', 0, S.mulberry32(1), E.PERSONAS[0]).act, 'deduce', 'out of cards: Deduce');
    const sneak = fresh(); sneak.cards.a = { s: 0, j: 5, w: 4 }; sneak.pos.a = B.STARTS[3];
    assert(!['s', 'j', 'w'].some((k) => E.reachWith(sneak, 'a', k) && E.reachWith(sneak, 'a', k).rooms[0] != null), 'the study room is out of reach from there');
    let dd = 0; for (let i = 0; i < 100; i++) if (E.botTurn(sneak, 'a', 0, S.mulberry32(i), E.PERSONAS[2]).act === 'deduce') dd++;
    let dr = 0; for (let i = 0; i < 100; i++) if (E.botTurn(sneak, 'a', 0, S.mulberry32(i), E.PERSONAS[4]).act === 'deduce') dr++;
    assert(dd > 60 && dr < 40 && dd > dr, 'sneaks Deduce more than rushers when the room is too far: ' + dd + ' vs ' + dr);
  }
  // a pawn in a corridor blocks the square
  const r = B.reach({ a: B.idx(4, 0), b: B.idx(4, 1), c: B.idx(5, 0) }, 'a', 6);
  assert.equal(r.cells.size, 0, 'boxed in');
}

// showAdvice: show the card that helps the asker least
{
  const D = S.makeDeck(S.EDITIONS[0]);
  const s0 = D.CS[0], w0 = D.CS[1], r0 = D.CS[2];
  assert.equal(E.showAdvice(D, [], []), null, 'nothing to show');
  assert.equal(E.showAdvice(D, [s0, w0], [w0]), w0, 'a card they already saw from me costs nothing');
  // suspects pool is smaller than rooms/weapons once many are shown: prefer the roomier category
  const before = [D.CS[0] + 1, D.CS[0] + 2, D.CS[0] + 3];            // three suspects already shown to them
  assert.equal(E.showAdvice(D, [s0, r0], before), r0, 'keep them away from closing in on the suspect');
  assert.equal(E.showAdvice(D, [s0, r0], []), D.SZ[2] > D.SZ[0] ? r0 : s0, 'with nothing shown yet, the biggest category is the safest');
  assert.equal(E.showAdvice(D, [s0, w0], []), s0, 'equal pools: the lowest card');
}
// full games played by bots only
function playGame(n, seed) {
  const ed = S.EDITIONS[seed % 2], D = S.makeDeck(ed), rng = S.mulberry32(seed);
  const order = Array.from({ length: n }, (_, i) => 'bot-' + i);
  const sizes = S.defaultHands(n, D.N - 3);
  const players = {}; order.forEach((p, i) => { players[p] = { name: p, seat: i, bot: true, handSize: sizes[i] }; });
  const { envelope, hands } = E.deal(D, order, sizes, rng);
  assert.equal(new Set([].concat(envelope, ...Object.values(hands))).size, D.N, 'every card dealt once');
  const shown = {}; order.forEach((p) => { shown[p] = {}; });
  let g = E.newGame(order), steps = 0;
  while (!g.over) {
    assert(++steps < 3000, 'game should finish');
    if (g.phase === 'suggest' || g.phase === 'end') {
      const p = g.turn;
      const mv = E.botThink(S, E.solverState(ed, players, order, p, hands[p], g, shown[p]), rng);
      if (mv.accuse) g = E.accuse(g, p, mv.accuse);
      else if (g.phase === 'end') g = E.endTurn(g, p, order);
      else g = E.suggest(g, p, mv.suggest, order);
    } else if (g.phase === 'answer') {
      const p = E.asked(g), cur = g.cur, held = cur.cards.filter((c) => hands[p].includes(c));
      if (held.length) {
        const card = E.pickShow(held, E.shownTo(shown[p], cur.by));
        shown[cur.by][cur.n] = { card, from: p }; shown[p][cur.n] = { card, to: cur.by };
        g = E.answer(g, p, 'showed');
      } else g = E.answer(g, p, 'none');
    } else if (g.phase === 'accusing') {
      g = E.resolveAccuse(g, envelope, order);
    }
    assert(g, 'every move is legal');
  }
  assert(!g.over.byDefault, 'bots never accuse wrongly');
  assert.deepEqual(g.log[g.log.length - 1].cards.slice().sort(), envelope.slice().sort());
  return g.log.length;
}
let turns = 0, games = 0;
for (const n of [3, 4, 5, 6]) for (let s = 1; s <= 4; s++) { turns += playGame(n, n * 100 + s); games++; }
console.log('engine tests ok:', games, 'bot games, avg', Math.round(turns / games), 'log entries');

// Final accusation out of turn: request, window, cancel, pass, accuse
{
  const order = ['a', 'b', 'c'];
  const env = [0, 7, 14];
  let g = { phase: 'end', turn: 'a', mode: 'full', log: [] };
  assert.equal(E.requestAccuse(g, 'a', order), undefined, 'the player on turn accuses directly');
  g = E.requestAccuse(g, 'b', order);
  assert(g.req.b && !E.requestAccuse(g, 'b', order), 'b is queued once');
  g = E.requestAccuse(g, 'c', order);
  let h = E.endTurn(g, 'a', order);
  assert(h.phase === 'window' && h.turn === 'b' && h.win.q.join() === 'b,c' && h.win.phase === 'move', 'turn over: window opens in seat order');
  assert.equal(E.windowWho(h), 'b');
  assert.equal(E.accuse(h, 'c', env), undefined, 'only the prompted player can accuse');
  assert.equal(E.accuse(h, 'a', env), undefined, 'and not someone whose turn is over');
  const p = E.windowPass(h, 'b', order);
  assert(p.phase === 'window' && p.win.q.join() === 'c' && !p.req.b, 'pass moves on to the next requester');
  const q = E.windowPass(p, 'c', order);
  assert(q.phase === 'move' && q.turn === 'b' && !q.win && !q.req, 'last pass starts the next turn');
  // wrong accusation inside the window: out, next requester is asked, then play carries on
  const acc = E.accuse(h, 'b', [1, 8, 15]);
  assert(acc.phase === 'accusing' && acc.win && !acc.req.b, 'accusing keeps the window');
  const r = E.resolveAccuse(acc, env, order);
  assert(r.out.b && r.phase === 'window' && r.win.q.join() === 'c', 'wrong: b is out, c is asked');
  const r2 = E.resolveAccuse(E.accuse(r, 'c', env), env, order);
  assert(r2.over && r2.over.winner === 'c', 'c is right and wins');
  // the player whose turn was next is knocked out: play moves on
  const only = { phase: 'end', turn: 'a', mode: 'full', log: [], req: { b: true } };
  const w2 = E.endTurn(only, 'a', order);
  const x = E.resolveAccuse(E.accuse(w2, 'b', [1, 8, 15]), env, order);
  assert(x.out.b && x.phase === 'move' && x.turn === 'c' && !x.win, 'b was next to play and is out: c plays');
  // cancelling the only request while the window is open closes it
  const cc = E.cancelRequest(w2, 'b', order);
  assert(cc.phase === 'move' && cc.turn === 'b' && !cc.win, 'cancel closes an empty window');
  console.log('Final accusation queue ok');
}
