// Clue3D: the walking path used to animate moves must agree with the game's own reach().
import assert from 'node:assert';
import * as B from '../clue/board.js';
import { walkPath } from '../Clue3D/js/path.js';

const adjacent = (a, b) => { const [ax, ay] = B.xy(a), [bx, by] = B.xy(b); return Math.abs(ax - bx) + Math.abs(ay - by) === 1; };

// From every start square, to every square and room reachable with 12 steps: the path is exactly as long
// as reach() says, every step is to a neighbouring corridor square, and room moves go in through a door.
for (const start of B.STARTS) {
  const pos = { me: start };
  const r = B.reach(pos, 'me', 12);
  r.cells.forEach((d, c) => {
    const p = walkPath(pos, 'me', c);
    assert.equal(p.length, d, 'length to square ' + c);
    let at = start;
    for (const s of p) { assert(adjacent(at, s), 'step ' + at + ' -> ' + s); at = s; }
  });
  for (const [k, d] of Object.entries(r.rooms)) {
    const p = walkPath(pos, 'me', B.inRoom(+k));
    assert.equal(p.length, d, 'length to room ' + k);
    assert.equal(p[p.length - 1], B.inRoom(+k));
    const door = p[p.length - 2];
    assert(B.DOORS.some((o) => o.k === +k && B.idx(o.x, o.y) === door), 'enters room ' + k + ' through a door');
  }
}

// Leaving a room: the first step is one of its doors. Other pawns block the corridor.
{
  const pos = { me: B.inRoom(4) };
  const r = B.reach(pos, 'me', 7);
  r.cells.forEach((d, c) => {
    const p = walkPath(pos, 'me', c);
    assert.equal(p.length, d);
    assert(B.DOORS.some((o) => o.k === 4 && B.idx(o.x, o.y) === p[0]));
  });
  const door = B.DOORS.find((o) => o.k === 4 && o.side === 'e'), sqr = B.idx(door.x, door.y);
  const blocked = walkPath({ me: B.inRoom(4), other: sqr }, 'me', sqr);
  assert.deepEqual(blocked, [], 'cannot walk onto another pawn');
}
console.log('clue3d path tests passed');
