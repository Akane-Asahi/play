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

// full game: rolling, moving, rooms and passages
{
  const B = await import('../clue/board.js');
  const order = ['a', 'b', 'c'];
  let g = E.newGame(order, { mode: 'full', rc0: 12 });
  assert.equal(E.suggest(g, 'a', [0, 6, 12], order), undefined, 'cannot suggest before moving');
  assert.equal(E.roll(g, 'b', [3, 4]), undefined); assert.equal(E.roll(g, 'a', [7, 1]), undefined);
  g = E.roll(g, 'a', [1, 1]);
  assert.equal(E.move(g, 'a', B.inRoom(4)), undefined, 'the middle room is too far for a 2');
  g = E.move(g, 'a', B.inRoom(0));
  assert.equal(g.phase, 'suggest');
  assert.equal(E.suggest(g, 'a', [0, 6, 13], order), undefined, 'only the room you are in');
  g = E.suggest(g, 'a', [0, 6, 12], order);
  g = E.answer(g, 'b', 'showed');
  g = E.endTurn(g, 'a', order);
  assert(g.phase === 'roll' && g.turn === 'b' && !g.dice);
  g = E.move(E.roll(g, 'b', [1, 2]), 'b', 'stay');
  assert(g.phase === 'end' && g.nosug);
  g = E.endTurn(E.move(E.roll(E.endTurn(g, 'b', order), 'c', [6, 6]), 'c', 'stay'), 'c', order);
  g = E.passage(g, 'a');
  assert(g.phase === 'suggest' && g.pos.a === B.inRoom(8), 'kitchen passage leads to the study');
  // a named suspect's player is brought into the room and may suggest there next turn
  g = E.suggest(g, 'a', [1, 6, 20], order);                 // suspect 1 is seat 1: player b
  assert(g.pos.b === g.pos.a && g.called.b, 'b is moved into the study');
  g = E.endTurn(E.answer(g, 'b', 'showed'), 'a', order);
  assert.equal(E.stayIn(g, 'a'), undefined);
  const stay = E.stayIn(g, 'b');
  assert(stay.phase === 'suggest' && !stay.called, 'called player suggests without rolling');
  assert(!E.roll(g, 'b', [2, 2]).called, 'rolling gives the chance up');
  assert(!E.suggest(stay, 'b', [0, 7, 20], order).called, 'no call when already in the room');
  // nobody could show a card: the suggester calls again, but has to leave the room first
  {
    let h = E.roll(E.newGame(order, { mode: 'full', rc0: 12 }), 'a', [1, 1]);
    h = E.suggest(E.move(h, 'a', B.inRoom(0)), 'a', [0, 6, 12], order);
    h = E.answer(E.answer(h, 'b', 'none'), 'c', 'none');
    assert(h.phase === 'roll' && h.again && h.turn === 'a', 'no answer: roll again');
    assert.equal(E.stayIn(h, 'a'), undefined);
    assert(E.accuse(h, 'a', [0, 6, 12]), 'a final accusation is allowed instead of rolling');
    h = E.roll(h, 'a', [1, 1]);
    assert(h.phase === 'move' && h.again);
    assert.equal(E.move(h, 'a', 'stay'), undefined, 'must leave the room');
    const out = [...B.reach(h.pos, 'a', 2).cells.keys()][0];
    const moved = E.move(h, 'a', out);
    assert(moved.phase === 'end' && !moved.again, 'out in the corridor, call again later');
    const viaDoor = E.move(E.roll(E.passage ? { ...h, phase: 'roll' } : h, 'a', [6, 6]), 'a', B.inRoom(1));
    assert(viaDoor && viaDoor.phase === 'suggest' && !viaDoor.again, 'into another room: call again');
    const p2 = E.passage({ ...h, phase: 'roll' }, 'a');
    assert(p2 && p2.phase === 'suggest' && !p2.again, 'the secret passage is a way out too');
    // a suggestion someone answered does not give another call
    let k = E.roll(E.newGame(order, { mode: 'full', rc0: 12 }), 'a', [1, 1]);
    k = E.answer(E.suggest(E.move(k, 'a', B.inRoom(0)), 'a', [0, 6, 12], order), 'b', 'showed');
    assert(k.phase === 'end' && !k.again);
  }
  // a pawn in a corridor blocks the square
  const r = B.reach({ a: B.idx(4, 0), b: B.idx(4, 1), c: B.idx(5, 0) }, 'a', 6);
  assert.equal(r.cells.size, 0, 'boxed in');
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
  assert(h.phase === 'window' && h.turn === 'b' && h.win.q.join() === 'b,c' && h.win.phase === 'roll', 'turn over: window opens in seat order');
  assert.equal(E.windowWho(h), 'b');
  assert.equal(E.accuse(h, 'c', env), undefined, 'only the prompted player can accuse');
  assert.equal(E.accuse(h, 'a', env), undefined, 'and not someone whose turn is over');
  const p = E.windowPass(h, 'b', order);
  assert(p.phase === 'window' && p.win.q.join() === 'c' && !p.req.b, 'pass moves on to the next requester');
  const q = E.windowPass(p, 'c', order);
  assert(q.phase === 'roll' && q.turn === 'b' && !q.win && !q.req, 'last pass starts the next turn');
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
  assert(x.out.b && x.phase === 'roll' && x.turn === 'c' && !x.win, 'b was next to play and is out: c plays');
  // cancelling the only request while the window is open closes it
  const cc = E.cancelRequest(w2, 'b', order);
  assert(cc.phase === 'roll' && cc.turn === 'b' && !cc.win, 'cancel closes an empty window');
  console.log('Final accusation queue ok');
}
