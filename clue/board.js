// The mansion for the full game: a 16 x 16 grid. Nine 4 x 4 rooms in three rows of three,
// with corridors two squares wide between them. Pure data and path finding, no DOM.
//
// A position is one number: a corridor square is y * W + x, room k is -(k + 1).
// Room k is the k-th room card of the deck (Kitchen, Ballroom, ... Study).
export const W = 16, H = 16, ROOMS = 9;
export const idx = (x, y) => y * W + x;
export const xy = (i) => [i % W, Math.floor(i / W)];
export const roomAt = (x, y) => (x % 6 < 4 && y % 6 < 4 ? Math.floor(y / 6) * 3 + Math.floor(x / 6) : -1);
export const roomRect = (k) => ({ x: 6 * (k % 3), y: 6 * Math.floor(k / 3), w: 4, h: 4 });
export const roomOf = (v) => (typeof v === 'number' && v < 0 ? -v - 1 : -1);
export const inRoom = (k) => -(k + 1);

// Each door is the corridor square you step from. side: which wall of the room it is in.
export const DOORS = [];
for (let k = 0; k < ROOMS; k++) {
  const i = k % 3, j = Math.floor(k / 3), x0 = 6 * i, y0 = 6 * j;
  if (i < 2) DOORS.push({ k, x: x0 + 4, y: y0 + 1, side: 'e' });
  if (j < 2) DOORS.push({ k, x: x0 + 2, y: y0 + 4, side: 's' });
  if (i > 0) DOORS.push({ k, x: x0 - 1, y: y0 + 2, side: 'w' });
  if (j > 0) DOORS.push({ k, x: x0 + 1, y: y0 - 1, side: 'n' });
}
// Secret passages join opposite corners.
export const PASSAGE = { 0: 8, 8: 0, 2: 6, 6: 2 };
// Where pawns start, by seat.
export const STARTS = [[4, 0], [11, 0], [15, 4], [15, 11], [11, 15], [4, 15]].map(([x, y]) => idx(x, y));

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && roomAt(x, y) < 0;

// Where `pid` can get to with `steps` steps. Pawns in corridors block the way; a room ends the move;
// the room you start in cannot be re-entered on the same move.
// Returns { cells: Map(square -> steps), rooms: { k: steps } }.
export function reach(pos, pid, steps) {
  const here = pos[pid], from = roomOf(here);
  const occ = new Set(Object.keys(pos).filter((p) => p !== pid).map((p) => pos[p]).filter((v) => v >= 0));
  const dist = new Map(), q = [], rooms = {};
  if (from >= 0) {
    DOORS.forEach((d) => { const i = idx(d.x, d.y); if (d.k === from && !occ.has(i) && steps >= 1 && !dist.has(i)) { dist.set(i, 1); q.push(i); } });
  } else if (here != null) { dist.set(here, 0); q.push(here); }
  for (let h = 0; h < q.length; h++) {
    const c = q[h], d = dist.get(c), [x, y] = xy(c);
    if (d >= steps) continue;
    DOORS.forEach((o) => { if (o.x === x && o.y === y && o.k !== from && rooms[o.k] == null) rooms[o.k] = d + 1; });
    NB.forEach(([dx, dy]) => {
      const nx = x + dx, ny = y + dy, n = idx(nx, ny);
      if (open(nx, ny) && !occ.has(n) && !dist.has(n)) { dist.set(n, d + 1); q.push(n); }
    });
  }
  if (from < 0) dist.delete(here);
  return { cells: dist, rooms };
}

// Steps from every corridor square into room k, ignoring pawns. Map(square -> steps).
const cache = {};
export function distTo(k) {
  if (cache[k]) return cache[k];
  const dist = new Map(), q = [];
  DOORS.forEach((d) => { if (d.k === k) { const i = idx(d.x, d.y); dist.set(i, 1); q.push(i); } });
  for (let h = 0; h < q.length; h++) {
    const c = q[h], [x, y] = xy(c);
    NB.forEach(([dx, dy]) => { const nx = x + dx, ny = y + dy, n = idx(nx, ny); if (open(nx, ny) && !dist.has(n)) { dist.set(n, dist.get(c) + 1); q.push(n); } });
  }
  return (cache[k] = dist);
}
