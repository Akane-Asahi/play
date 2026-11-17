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
