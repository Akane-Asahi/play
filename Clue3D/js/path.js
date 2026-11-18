// The squares a pawn walks through on its way somewhere, for animating a move.
// Pure: no three.js, no DOM. Uses the same board as the 2D game (../clue/board.js).
import * as B from '../../clue/board.js';

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// pos: { pid: square | -(room + 1) }, dest: a corridor square or B.inRoom(k).
// Returns the positions after `from`, in order, ending with dest. [] when dest cannot be reached.
// Pawns in corridors block the way, like in B.reach.
export function walkPath(pos, pid, dest) {
  const here = pos[pid], from = B.roomOf(here), destRoom = B.roomOf(dest);
  if (dest === here) return [];
  const occ = new Set(Object.keys(pos).filter((p) => p !== pid).map((p) => pos[p]).filter((v) => v >= 0));
  const prev = new Map(), q = [];
  if (from >= 0) {
    // Leaving a room: the first step is any free door square of that room.
    B.DOORS.forEach((d) => { const i = B.idx(d.x, d.y); if (d.k === from && !occ.has(i) && !prev.has(i)) { prev.set(i, null); q.push(i); } });
  } else { prev.set(here, null); q.push(here); }
  const isGoal = (c) => (destRoom >= 0 ? B.DOORS.some((d) => d.k === destRoom && B.idx(d.x, d.y) === c) : c === dest);
  let goal = null;
  for (let h = 0; h < q.length && goal == null; h++) {
    const c = q[h];
    if (isGoal(c) && !(from < 0 && c === here && destRoom < 0)) { goal = c; break; }
    const [x, y] = B.xy(c);
    for (const [dx, dy] of NB) {
      const nx = x + dx, ny = y + dy, n = B.idx(nx, ny);
      if (nx < 0 || ny < 0 || nx >= B.W || ny >= B.H || B.roomAt(nx, ny) >= 0 || occ.has(n) || prev.has(n)) continue;
      prev.set(n, c); q.push(n);
    }
  }
  if (goal == null) return [];
  const out = [];
  for (let c = goal; c != null; c = prev.get(c)) out.unshift(c);
  if (from < 0) out.shift(); // the square the pawn already stands on
  if (destRoom >= 0) out.push(dest);
  return out;
}
