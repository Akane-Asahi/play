// Draws the mansion as an isometric picture (SVG text). See board.js for the layout.
import * as B from './board.js';

const TW = 40, TH = 20, WH = 14, TOP = WH + 12, OX = B.H * TW / 2;
export const SEAT_COLORS = ['#c62828', '#e1ad01', '#f2efe8', '#2e7d32', '#1565c0', '#8e24aa'];
const FLOORS = ['#8b8f78', '#7d6c93', '#5c8a6a', '#94705c', '#4c7b72', '#7d5d49', '#8e5c6b', '#8d8062', '#5c6d8f'];
const P = (x, y, z) => [(x - y) * TW / 2 + OX, (x + y) * TH / 2 + TOP - (z || 0)];
const pts = (a) => a.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
const quad = (x, y, w, h) => pts([P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)]);
const poly = (points, attrs) => '<polygon points="' + points + '" ' + attrs + '/>';
const line = (a, b, attrs) => '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" ' + attrs + '/>';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Where a pawn stands, in grid units.
function spot(v, seat) {
  const k = B.roomOf(v);
  if (k < 0) { const [x, y] = B.xy(v); return [x + 0.5, y + 0.5]; }
  const r = B.roomRect(k);
  return [r.x + 0.8 + (seat % 3) * 1.2, r.y + (seat < 3 ? 0.85 : 3.2)];
}

// o: { pos, order, me, turn, out:{pid}, roomNames:[9], go: { cells: Map, rooms: {} } | null }
export function boardSvg(o) {
  const Hh = (B.W + B.H) * TH / 2 + TOP + 18;
  let s = '<svg class="iso" viewBox="0 0 ' + (B.W * TW) + ' ' + Hh + '" role="img" aria-label="The mansion">' +
    '<defs><radialGradient id="cg"><stop offset="0" stop-color="#ffd27a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient></defs>';
  // slab
  const A = P(0, 0), Bq = P(B.W, 0), C = P(B.W, B.H), Dq = P(0, B.H), dn = (p) => [p[0], p[1] + 12];
  s += poly(pts([Dq, C, dn(C), dn(Dq)]), 'fill="#15130f"') + poly(pts([C, Bq, dn(Bq), dn(C)]), 'fill="#1e1b16"') + poly(pts([A, Bq, C, Dq]), 'fill="#2c2a26"');
  // corridors
  const doorAt = {}; B.DOORS.forEach((d) => { doorAt[B.idx(d.x, d.y)] = d; });
  const starts = new Set(B.STARTS);
  for (let y = 0; y < B.H; y++) for (let x = 0; x < B.W; x++) {
    if (B.roomAt(x, y) >= 0) continue;
    const i = B.idx(x, y);
    s += poly(quad(x, y, 1, 1), 'fill="' + (doorAt[i] ? '#8c7446' : (x + y) % 2 ? '#4b5053' : '#44494c') + '" stroke="#2f3336" stroke-width=".7"');
    if (starts.has(i)) { const c = P(x + 0.5, y + 0.5); s += '<ellipse cx="' + c[0] + '" cy="' + c[1] + '" rx="9" ry="4.5" fill="none" stroke="#8d949a" stroke-width="1" stroke-dasharray="2 2"/>'; }
  }
  // rooms
  for (let k = 0; k < B.ROOMS; k++) {
    const r = B.roomRect(k), x0 = r.x, y0 = r.y;
    s += poly(quad(x0, y0, 4, 4), 'fill="' + FLOORS[k] + '"');
    for (let t = 1; t < 4; t++) s += line(P(x0 + t, y0), P(x0 + t, y0 + 4), 'stroke="rgba(0,0,0,.13)" stroke-width=".7"') + line(P(x0, y0 + t), P(x0 + 4, y0 + t), 'stroke="rgba(0,0,0,.13)" stroke-width=".7"');
    if (B.PASSAGE[k] != null) s += poly(quad(x0 + 3.1, y0 + 0.1, 0.8, 0.8), 'fill="#17120d" stroke="#d9b45f" stroke-width="1"');
    s += '<circle cx="' + P(x0 + 0.9, y0 + 0.9)[0] + '" cy="' + P(x0 + 0.9, y0 + 0.9)[1] + '" r="34" fill="url(#cg)" pointer-events="none"/>';
    // back walls with their doors
    s += poly(pts([P(x0, y0), P(x0, y0 + 4), P(x0, y0 + 4, WH), P(x0, y0, WH)]), 'fill="#50525b"') +
      poly(pts([P(x0, y0), P(x0 + 4, y0), P(x0 + 4, y0, WH), P(x0, y0, WH)]), 'fill="#6c6f7a"');
    B.DOORS.filter((d) => d.k === k).forEach((d) => {
      if (d.side === 'n') s += poly(pts([P(x0 + 1.15, y0), P(x0 + 1.85, y0), P(x0 + 1.85, y0, WH - 3), P(x0 + 1.15, y0, WH - 3)]), 'fill="#24170c" stroke="#d9b45f" stroke-width=".8"');
      if (d.side === 'w') s += poly(pts([P(x0, y0 + 2.15), P(x0, y0 + 2.85), P(x0, y0 + 2.85, WH - 3), P(x0, y0 + 2.15, WH - 3)]), 'fill="#1c1209" stroke="#d9b45f" stroke-width=".8"');
    });
    s += '<polyline points="' + pts([P(x0, y0 + 4, WH), P(x0, y0, WH), P(x0 + 4, y0, WH)]) + '" fill="none" stroke="#9a9eab" stroke-width="1.2"/>';
    s += '<ellipse cx="' + P(x0 + 0.25, y0 + 0.25, WH + 5)[0] + '" cy="' + P(x0 + 0.25, y0 + 0.25, WH + 5)[1] + '" rx="2" ry="3.4" fill="#ffd87a"/>';
    // front edges, open where the doors are
    s += '<polyline points="' + pts([P(x0 + 4, y0), P(x0 + 4, y0 + 4), P(x0, y0 + 4)]) + '" fill="none" stroke="#211e1a" stroke-width="2.4"/>';
    B.DOORS.filter((d) => d.k === k).forEach((d) => {
      if (d.side === 'e') s += line(P(x0 + 4, y0 + 1.1), P(x0 + 4, y0 + 1.9), 'stroke="#e6c67c" stroke-width="2.8"');
      if (d.side === 's') s += line(P(x0 + 2.1, y0 + 4), P(x0 + 2.9, y0 + 4), 'stroke="#e6c67c" stroke-width="2.8"');
    });
    const c = P(x0 + 2, y0 + 2), words = String(o.roomNames[k] || '').split(' ');
    s += '<text class="rl" x="' + c[0] + '" y="' + (c[1] + (words.length > 1 ? -3 : 5)) + '">' +
      words.map((w, i) => '<tspan x="' + c[0] + '"' + (i ? ' dy="15"' : '') + '>' + esc(w) + '</tspan>').join('') + '</text>';
  }
  // where I can go
  if (o.go) {
    o.go.cells.forEach((_, i) => { const [x, y] = B.xy(i); s += poly(quad(x, y, 1, 1), 'class="go" data-act="go" data-d="' + i + '"'); });
    Object.keys(o.go.rooms).forEach((k) => { const r = B.roomRect(+k); s += poly(quad(r.x, r.y, 4, 4), 'class="go room" data-act="go" data-d="' + B.inRoom(+k) + '"'); });
  }
  // pawns, far ones first
  o.order.map((p, seat) => ({ p, seat, at: spot(o.pos[p], seat) })).filter((q) => o.pos[q.p] != null)
    .sort((a, b) => (a.at[0] + a.at[1]) - (b.at[0] + b.at[1])).forEach((q) => {
      const c = P(q.at[0], q.at[1]), col = SEAT_COLORS[q.seat % SEAT_COLORS.length];
      s += '<g class="pawn" pointer-events="none" transform="translate(' + c[0].toFixed(1) + ',' + c[1].toFixed(1) + ')"' + (o.out && o.out[q.p] ? ' opacity=".45"' : '') + '>' +
        '<ellipse rx="9" ry="4.5" fill="rgba(0,0,0,.5)"/>' +
        (q.p === o.turn ? '<ellipse rx="12.5" ry="6.2" fill="none" stroke="#ffd87a" stroke-width="2"/>' : '') +
        '<path d="M-7 0 Q0 4.5 7 0 L2.6 -15 L-2.6 -15 Z" fill="' + col + '" stroke="#0e0c0a" stroke-width="1"/>' +
        '<circle cy="-19" r="5.6" fill="' + col + '" stroke="#0e0c0a" stroke-width="1"/>' +
        (q.p === o.me ? '<path d="M-4.5 -33 L4.5 -33 L0 -27 Z" fill="#fff" stroke="#0e0c0a" stroke-width=".8"/>' : '') + '</g>';
    });
  return s + '</svg>';
}

// One die face.
export function dieSvg(n) {
  const at = { 1: [[12, 12]], 2: [[6, 6], [18, 18]], 3: [[6, 6], [12, 12], [18, 18]], 4: [[6, 6], [18, 6], [6, 18], [18, 18]],
    5: [[6, 6], [18, 6], [12, 12], [6, 18], [18, 18]], 6: [[6, 5], [18, 5], [6, 12], [18, 12], [6, 19], [18, 19]] }[n] || [];
  return '<svg class="die" viewBox="0 0 24 24" width="30" height="30" role="img" aria-label="' + n + '"><rect x="1" y="1" width="22" height="22" rx="5" fill="#f4eee2" stroke="#b59a5b"/>' +
    at.map((p) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.2" fill="#241b0d"/>').join('') + '</svg>';
}
