'use strict';
/*
 * Clue (Cluedo) deduction solver.
 *
 * Model: every card has exactly one owner: a seated player (0..nSeats-1), the "table"
 * (face-up cards, only when there are any) or the envelope. The envelope holds exactly
 * one suspect, one weapon and one room. Each owner holds exactly `hand` cards.
 * Game events become constraints:
 *   - your own hand / a card you marked as held   -> card is owned by that player
 *   - face-up cards                               -> card is owned by the table
 *   - a player answered "none"                    -> they own none of the 3 cards
 *   - a player showed a card                      -> they own >= 1 of the 3 (or the known card)
 *   - a player refused                            -> no information
 *   - wrong accusation                            -> the 3 cards are not all in the envelope
 *
 * Two layers:
 *   1. Exact logic: for every (card, owner) pair a backtracking search decides whether ANY
 *      consistent deal exists. This gives the certain facts.
 *   2. Probabilities: an MCMC sampler (card swaps) over consistent deals estimates how
 *      likely each card is to be in each hand / the envelope.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClueSolver = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ROOMS_CLASSIC = ['Kitchen', 'Ballroom', 'Conservatory', 'Dining Room', 'Billiard Room', 'Library', 'Lounge', 'Hall', 'Study'];
  const SUSPECTS_CLASSIC = ['Scarlett', 'Mustard', 'White', 'Green', 'Peacock', 'Plum'];
  const EDITIONS = [
    { id: 'clue-us', name: 'Clue (US)', suspects: SUSPECTS_CLASSIC, weapons: ['Candlestick', 'Knife', 'Lead Pipe', 'Revolver', 'Rope', 'Wrench'], rooms: ROOMS_CLASSIC },
    { id: 'cluedo-uk', name: 'Cluedo (UK)', suspects: SUSPECTS_CLASSIC, weapons: ['Candlestick', 'Dagger', 'Lead Pipe', 'Revolver', 'Rope', 'Spanner'], rooms: ROOMS_CLASSIC },
  ];
  const CAT_NAMES = ['Suspect', 'Weapon', 'Room'];
  const CAT_PLURAL = ['Suspects', 'Weapons', 'Rooms'];

  function makeDeck(ed) {
    ed = ed || EDITIONS[0];
    const cats = [ed.suspects, ed.weapons, ed.rooms];
    const CARDS = [].concat(cats[0], cats[1], cats[2]);
    const CS = [], SZ = [];
    let s = 0;
    cats.forEach((c) => { CS.push(s); SZ.push(c.length); s += c.length; });
    const catArr = new Array(CARDS.length);
    cats.forEach((c, k) => c.forEach((_, i) => { catArr[CS[k] + i] = k; }));
    return { CARDS, N: CARDS.length, CS, SZ, catOf: (c) => catArr[c], name: ed.name };
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Split `total` cards over n players; the first players get any extra card.
  function defaultHands(n, total) {
    total = total == null ? 18 : total;
    const base = Math.floor(total / n), extra = total % n;
    return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
  }

  // Ordered answers to a suggestion. New events carry `responses`; the older shape
  // (shownBy / shownCard) is converted: everyone between suggester and shower said "none".
  function responsesOf(ev, nSeats) {
    if (ev.responses) return ev.responses;
    const out = [];
    let p = (ev.by + 1) % nSeats;
    while (p !== ev.by && p !== ev.shownBy) { out.push({ p, r: 'none' }); p = (p + 1) % nSeats; }
    if (ev.shownBy != null) out.push({ p: ev.shownBy, r: 'showed', card: ev.shownCard });
    return out;
  }

  function buildConstraints(state) {
    const D = makeDeck(state.edition);
    const nSeats = state.players.length;
    const faceUp = state.faceUp || [];
    const hasTable = faceUp.length > 0;
    const nP = nSeats + (hasTable ? 1 : 0);
    if (nSeats < 2 || nSeats > 8) return { error: 'Need 2-8 players.' };
    const hand = state.players.map((p) => p.hand);
    if (hasTable) hand.push(faceUp.length);
    const total = hand.reduce((a, b) => a + b, 0);
    const want = D.N - 3;
    if (total !== want) {
      return { error: 'Cards per player must add up to ' + want + ' (all cards minus the 3 in the envelope). Currently ' + total + '.' };
    }
    const clauses = [];
    for (const c of state.myCards || []) clauses.push({ t: 'is', p: state.me, c });
    for (const c of faceUp) clauses.push({ t: 'is', p: nSeats, c });
    for (const ev of state.events || []) {
      if (ev.type === 'suggest') {
        for (const rs of responsesOf(ev, nSeats)) {
          if (rs.r === 'none') for (const c of ev.cards) clauses.push({ t: 'not', p: rs.p, c });
          else if (rs.r === 'showed') {
            if (rs.card != null) clauses.push({ t: 'is', p: rs.p, c: rs.card });
            else clauses.push({ t: 'some', p: rs.p, cards: ev.cards.slice() });
          }
          // 'refused' carries no information
        }
      } else if (ev.type === 'accuse' && !ev.correct) {
        clauses.push({ t: 'notall', cards: ev.cards.slice() });
      } else if (ev.type === 'has') {
        clauses.push({ t: 'is', p: ev.p, c: ev.card });
      }
    }
    return { D, nSeats, nP, hasTable, hand, clauses };
  }

  function makeSearch(C) {
    const { D, nP, hand, clauses } = C;
    const dom0 = Array.from({ length: D.N }, () => new Array(nP + 1).fill(true));
    for (const cl of clauses) {
      if (cl.t === 'not') dom0[cl.c][cl.p] = false;
      else if (cl.t === 'is') for (let o = 0; o <= nP; o++) if (o !== cl.p) dom0[cl.c][o] = false;
    }
    return {
      D, dom0, nP, hand, E: nP,
      some: clauses.filter((c) => c.t === 'some'),
      notall: clauses.filter((c) => c.t === 'notall'),
    };
  }

  // Backtracking search for one consistent deal. Returns {sol, aborted}.
  function dfs(S, opts) {
    opts = opts || {};
    const { D, dom0, some, notall, nP, hand, E } = S;
    const N = D.N, CS = D.CS, SZ = D.SZ, catOf = D.catOf;
    const dom = dom0.map((r) => r.slice());
    if (opts.force) for (const [c, o] of opts.force) for (let k = 0; k <= nP; k++) if (k !== o) dom[c][k] = false;
    const owner = new Array(N).fill(-1);
    const cnt = new Array(nP).fill(0);
    const env = [false, false, false];
    const limit = opts.limit || 20000;
    const rng = opts.rng;
    let nodes = 0, aborted = false;

    function feasible() {
      for (let p = 0; p < nP; p++) {
        const need = hand[p] - cnt[p];
        if (need < 0) return false;
        if (need > 0) {
          let a = 0;
          for (let c = 0; c < N; c++) if (owner[c] < 0 && dom[c][p]) a++;
          if (a < need) return false;
        }
      }
      for (let k = 0; k < 3; k++) {
        if (env[k]) continue;
        let ok = false;
        for (let c = CS[k]; c < CS[k] + SZ[k]; c++) if (owner[c] < 0 && dom[c][E]) { ok = true; break; }
        if (!ok) return false;
      }
      for (const cl of some) {
        let has = false, can = false;
        for (const c of cl.cards) {
          if (owner[c] === cl.p) { has = true; break; }
          if (owner[c] < 0 && dom[c][cl.p]) can = true;
        }
        if (!has && !(can && cnt[cl.p] < hand[cl.p])) return false;
      }
      return true;
    }

    function rec(assigned) {
      if (assigned === N) return true;
      if (++nodes > limit) { aborted = true; return false; }
      let best = -1, bestOpts = null;
      for (let c = 0; c < N; c++) {
        if (owner[c] >= 0) continue;
        const o2 = [];
        for (let o = 0; o <= nP; o++) {
          if (dom[c][o] && (o === E ? !env[catOf(c)] : cnt[o] < hand[o])) o2.push(o);
        }
        if (o2.length === 0) return false;
        if (best < 0 || o2.length < bestOpts.length) { best = c; bestOpts = o2; }
      }
      if (rng) shuffle(bestOpts, rng);
      for (const o of bestOpts) {
        owner[best] = o;
        if (o === E) env[catOf(best)] = true; else cnt[o]++;
        let ok = true;
        if (o === E) for (const cl of notall) if (cl.cards.every((c) => owner[c] === E)) { ok = false; break; }
        if (ok && feasible() && rec(assigned + 1)) return true;
        owner[best] = -1;
        if (o === E) env[catOf(best)] = false; else cnt[o]--;
        if (aborted) return false;
      }
      return false;
    }

    if (!feasible()) return { sol: null, aborted: false };
    const ok = rec(0);
    return { sol: ok ? owner.slice() : null, aborted };
  }

  // MCMC over consistent deals: swap the owners of two cards, keep if still valid.
  function sampleDeals(S, startSols, o) {
    const { D, dom0, some, notall, nP, E } = S;
    const N = D.N, catOf = D.catOf;
    const counts = Array.from({ length: N }, () => new Array(nP + 1).fill(0));
    let taken = 0;
    const samples = [];
    const rng = mulberry32(o.seed || 12345);
    function valid(owner, a, b) {
      if (!dom0[a][owner[a]] || !dom0[b][owner[b]]) return false;
      const e = [0, 0, 0];
      for (let c = 0; c < N; c++) if (owner[c] === E) e[catOf(c)]++;
      if (e[0] !== 1 || e[1] !== 1 || e[2] !== 1) return false;
      for (const cl of some) {
        let has = false;
        for (const c of cl.cards) if (owner[c] === cl.p) { has = true; break; }
        if (!has) return false;
      }
      for (const cl of notall) if (cl.cards.every((c) => owner[c] === E)) return false;
      return true;
    }
    for (const start of startSols) {
      const owner = start.slice();
      for (let step = 0; step < o.steps; step++) {
        const a = Math.floor(rng() * N), b = Math.floor(rng() * N);
        if (owner[a] !== owner[b]) {
          const oa = owner[a], ob = owner[b];
          owner[a] = ob; owner[b] = oa;
          if (!valid(owner, a, b)) { owner[a] = oa; owner[b] = ob; }
        }
        if (step >= o.burn && step % o.thin === 0) {
          for (let c = 0; c < N; c++) counts[c][owner[c]]++;
          taken++;
          if (taken % (o.keep || 8) === 0) samples.push(owner.slice());
        }
      }
    }
    return { counts, taken, samples };
  }

  /*
   * analyse(state, opts) ->
   *   { ok:false, error }  or
   *   { ok:true, deck, nSeats, nP, hasTable, possible[c][o], prob[c][o]|null,
   *     certain[c] (owner or -1), envelope: [ [ {card,p,certain} sorted ] x 3 ],
   *     solved, located:[{ev,resp,p,card}], uncertain }
   * Owner index: 0..nSeats-1 seats, nSeats = table (if any), nP = envelope.
   * state = { edition?, players:[{name,hand}], me, myCards, faceUp?, events:[...] }
   */
  function analyse(state, opts) {
    opts = opts || {};
    const C = buildConstraints(state);
    if (C.error) return { ok: false, error: C.error };
    const S = makeSearch(C);
    const D = C.D, N = D.N, nP = C.nP;
    const first = dfs(S, { limit: 200000 });
    if (!first.sol) {
      return { ok: false, error: first.aborted ? 'Search limit reached.' : 'These entries contradict each other. Check or delete the latest log entry.', inconsistent: !first.aborted };
    }
    const possible = Array.from({ length: N }, () => new Array(nP + 1).fill(false));
    const mark = (sol) => sol.forEach((o, c) => { possible[c][o] = true; });
    mark(first.sol);
    let uncertain = false;
    for (let c = 0; c < N; c++) {
      for (let o = 0; o <= nP; o++) {
        if (possible[c][o] || !S.dom0[c][o]) continue;
        const r = dfs(S, { force: [[c, o]] });
        if (r.sol) mark(r.sol);
        else if (r.aborted) { possible[c][o] = true; uncertain = true; }
      }
    }
    const certain = possible.map((row) => {
      const idx = [];
      row.forEach((v, o) => { if (v) idx.push(o); });
      return idx.length === 1 ? idx[0] : -1;
    });

    let prob = null, samples = null;
    const nChains = opts.chains == null ? 6 : opts.chains;
    if (nChains > 0) {
      const starts = [];
      const rng = mulberry32((opts.seed || 7) + 1);
      for (let i = 0; i < nChains; i++) {
        const r = dfs(S, { rng, limit: 20000 });
        starts.push(r.sol || first.sol);
      }
      const sd = sampleDeals(S, starts, {
        steps: opts.steps || 5000, burn: 500, thin: 4, seed: opts.seed || 99,
      });
      const { counts, taken } = sd; samples = sd.samples;
      prob = counts.map((row, c) => row.map((n, o) => (possible[c][o] ? n / taken : 0)));
    }

    const envelope = [0, 1, 2].map((k) => {
      const list = [];
      for (let c = D.CS[k]; c < D.CS[k] + D.SZ[k]; c++) {
        if (!possible[c][nP]) continue;
        list.push({ card: c, p: prob ? prob[c][nP] : null, certain: certain[c] === nP });
      }
      list.sort((a, b) => (b.p || 0) - (a.p || 0));
      return list;
    });
    const solved = envelope.every((l) => l.length === 1);

    // "Located" cards: someone showed a card we didn't see, but only one or two of the three
    // cards could possibly be theirs (cards = the candidates).
    const located = [];
    (state.events || []).forEach((ev, ei) => {
      if (ev.type !== 'suggest') return;
      responsesOf(ev, C.nSeats).forEach((rs, ri) => {
        if (rs.r !== 'showed' || rs.card != null || rs.p === state.me) return;
        const cand = ev.cards.filter((c) => possible[c][rs.p]);
        if (cand.length === 1 || cand.length === 2) located.push({ ev: ei, resp: ri, p: rs.p, card: cand[0], cards: cand });
      });
    });

    return { ok: true, deck: D, nSeats: C.nSeats, nP, hasTable: C.hasTable, possible, prob, certain, envelope, solved, located, uncertain, samples };
  }

  /*
   * bestSuggestions(result, state, top) -> [ { cards:[s,w,r], gain, rel } ]
   * For every suspect/weapon/room triple I could name, simulate the answers over the sampled
   * consistent deals (first player in turn order who holds a named card shows one; I see which
   * card) and measure the expected drop in uncertainty: envelope entropy first, plus a small
   * share of the entropy over everybody's cards. Higher gain = the question that cuts the
   * possibilities down the most. Not the same as the best guess for the envelope.
   */
  function bestSuggestions(result, state, top, room) {
    if (!result || !result.ok || !result.samples || !result.samples.length || result.solved) return [];
    const D = result.deck, N = D.N, E = result.nP, nO = E + 1, me = state.me || 0;
    const n = state.players.length, step = state.dir === 'ccw' ? -1 : 1;
    const order = []; for (let k = 1; k < n; k++) order.push((((me + step * k) % n) + n) % n);
    const kk = Math.max(1, Math.ceil(result.samples.length / 450));
    const smp = result.samples.filter((_, i) => i % kk === 0), M = smp.length;
    const lg = (x) => (x > 0 ? x * Math.log2(x) : 0);
    // entropy helpers over weighted samples
    const envH = (idx, w) => {
      let tot = 0; const cnt = new Map();
      for (const i of idx) { const sm = smp[i], ww = w ? w.get(i) : 1; tot += ww; for (let c = 0; c < N; c++) if (sm[c] === E) cnt.set(c, (cnt.get(c) || 0) + ww); }
      let h = 0; if (tot <= 0) return 0;
      // per category entropy
      for (let k = 0; k < 3; k++) { let hk = 0; for (let c = D.CS[k]; c < D.CS[k] + D.SZ[k]; c++) { const q = (cnt.get(c) || 0) / tot; hk -= lg(q); } h += hk; }
      return h;
    };
    const ownH = (rows, tot) => {
      let h = 0; if (tot <= 0) return 0;
      for (let c = 0; c < N; c++) for (let o = 0; o < nO; o++) { const q = rows[c * nO + o] / tot; h -= lg(q); }
      return h;
    };
    const baseEnv = (() => { const idx = smp.map((_, i) => i); return envH(idx, null); })();
    const baseOwn = (() => { const rows = new Float64Array(N * nO); for (const sm of smp) for (let c = 0; c < N; c++) rows[c * nO + sm[c]]++; return ownH(rows, M); })();
    const WOWN = 0.15;
    const res = [];
    for (let a = D.CS[0]; a < D.CS[0] + D.SZ[0]; a++) for (let b = D.CS[1]; b < D.CS[1] + D.SZ[1]; b++) for (let r = D.CS[2]; r < D.CS[2] + D.SZ[2]; r++) {
      if (room != null && r !== room) continue;
      const tri = [a, b, r];
      const groups = new Map(); // key -> { w, env: Float64Array(N), own: Float64Array(N*nO) }
      for (let i = 0; i < M; i++) {
        const sm = smp[i];
        let key = null, shown = null;
        for (const p of order) { const held = tri.filter((c) => sm[c] === p); if (held.length) { key = p; shown = held; break; } }
        const outcomes = shown ? shown.map((c) => [key * 100 + c, 1 / shown.length]) : [[-1, 1]];
        for (const [k, w] of outcomes) {
          let g = groups.get(k);
          if (!g) { g = { w: 0, env: new Float64Array(N), own: new Float64Array(N * nO) }; groups.set(k, g); }
          g.w += w;
          for (let c = 0; c < N; c++) { g.own[c * nO + sm[c]] += w; if (sm[c] === E) g.env[c] += w; }
        }
      }
      let eEnv = 0, eOwn = 0;
      for (const g of groups.values()) {
        let h = 0;
        for (let k = 0; k < 3; k++) { for (let c = D.CS[k]; c < D.CS[k] + D.SZ[k]; c++) h -= lg(g.env[c] / g.w); }
        eEnv += (g.w / M) * h;
        eOwn += (g.w / M) * ownH(g.own, g.w);
      }
      const gEnv = baseEnv - eEnv, gOwn = baseOwn - eOwn;
      res.push({ cards: tri, gain: gEnv + WOWN * gOwn, envGain: gEnv, rel: baseEnv > 0 ? gEnv / baseEnv : 0 });
    }
    res.sort((x, y) => y.gain - x.gain);
    return res.slice(0, top || 1);
  }

  function describeEvent(state, ev) {
    const D = makeDeck(state.edition);
    const nm = (i) => (state.players[i] && state.players[i].name) || 'P' + (i + 1);
    const cd = (c) => D.CARDS[c];
    if (ev.type === 'accuse') return nm(ev.by) + ' accused ' + ev.cards.map(cd).join(' / ') + ' (wrong)';
    if (ev.type === 'has') return 'You marked ' + nm(ev.p) + ' as holding ' + cd(ev.card);
    const rs = responsesOf(ev, state.players.length);
    let s = nm(ev.by) + ' suggested ' + ev.cards.map(cd).join(' / ') + '. ';
    const parts = rs.map((r) => {
      if (r.r === 'none') return nm(r.p) + ' had none';
      if (r.r === 'refused') return nm(r.p) + ' refused';
      return nm(r.p) + ' showed a card' + (r.card != null ? ' (' + cd(r.card) + ')' : '');
    });
    if (parts.length && !rs.some((r) => r.r === 'showed' || r.r === 'refused')) s += parts.join(', ') + '. Nobody showed a card.';
    else if (parts.length) s += parts.join(', ') + '.';
    else s += 'Nobody was asked.';
    return s.trim();
  }

  return {
    EDITIONS, CAT_NAMES, CAT_PLURAL, CARDS: makeDeck(EDITIONS[0]).CARDS,
    makeDeck, defaultHands, responsesOf, buildConstraints, analyse, bestSuggestions, describeEvent, mulberry32,
  };
});
