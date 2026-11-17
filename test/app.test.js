import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { startApp } from '../clue/app.js';
import { FakeDb } from './fake-net.js';
import { loadSolver } from './load-solver.js';
const S = loadSolver();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function open(db, uid, query) {
  const dom = new JSDOM('<header><span id="code-pill" hidden></span></header><main><div id="view"></div><p id="msg"></p></main>',
    { url: 'https://example.test/play/clue/' + (query || ''), pretendToBeVisual: true });
  const win = dom.window;
  win.ClueSolver = S;
  if (!win.crypto || !win.crypto.getRandomValues) Object.defineProperty(win, 'crypto', { value: webcrypto });
  const app = startApp({ net: db.client(uid), doc: win.document, win, delays: { bot: 0, none: 0 } });
  const q = (sel) => win.document.querySelector(sel), qa = (sel) => Array.from(win.document.querySelectorAll(sel));
  const click = (sel) => { const el = typeof sel === 'string' ? q(sel) : sel; assert(el, 'missing ' + sel + ' for ' + uid + '\n' + q('#view').innerHTML.slice(0, 400)); el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };
  const type = (id, v) => { const el = q('#' + id); assert(el, 'missing #' + id); el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); };
  return { uid, win, app, q, qa, click, type, msg: () => q('#msg').textContent, text: () => q('#view').textContent };
}
const clean = (cs) => cs.forEach((c) => assert.equal(c.msg(), '', c.uid + ' sees: ' + c.msg()));

async function lobby(db, humans, bots) {
  const host = open(db, humans[0]);
  await wait(5);
  host.type('name', 'Hosty'); host.click('[data-act=create]'); await wait(10);
  const code = host.app.state().roomCode;
  assert.match(code, /^[A-Z0-9]{5}$/);
  assert(host.q('#share').value.endsWith('?room=' + code));
  const cs = [host];
  for (const h of humans.slice(1)) {
    const c = open(db, h + '-fresh', '?room=' + code); await wait(5);       // not in the room yet: sees the join form
    assert(c.q('#code').value === code, 'code prefilled from the link');
    const real = open(db, h, '?room=' + code); await wait(5);
    real.type('name', 'P-' + h); real.click('[data-act=join]'); await wait(10);
    cs.push(real);
  }
  assert(host.q('[data-act=start]').disabled === (humans.length < 3));
  for (const b of bots) { host.click('[data-act=bot][data-n=' + b + ']'); await wait(5); }
  assert.equal(cs[cs.length - 1].qa('.pl').length, humans.length + bots.length, 'guests see the bots too');
  assert(!cs[cs.length - 1].q('[data-act=start]') || cs.length === 1, 'only the host can start');
  host.click('[data-act=start]'); await wait(20);
  clean(cs);
  return { cs, code, host };
}

// One step for a human: do whatever the screen offers. `plan` can override the turn move.
function act(c, plan) {
  const tap = c.q('.fc.tap');
  if (tap) return c.click(tap);
  if (c.q('[data-act=end]')) return c.click('[data-act=end]');
  if (c.q('[data-act=suggest]')) {
    const want = plan && plan(c);
    [0, 1, 2].forEach((k) => {
      const opts = c.qa('[data-act=pick][data-k="' + k + '"]');
      c.click(want ? opts.find((o) => +o.dataset.c === want.cards[k]) : opts[Math.floor(Math.random() * opts.length)]);
    });
    if (want && want.accuse) { c.click('[data-act=accuse]'); return c.click('[data-act=accuse-yes]'); }
    return c.click('[data-act=suggest]');
  }
  return null;
}

async function play(db, cs, code, plan, until) {
  for (let i = 0; i < 4000; i++) {
    const g = db.read('rooms/' + code + '/game');
    if (g && (g.over || (until && until(g)))) return g;
    cs.forEach((c) => act(c, plan));
    await wait(1);
    clean(cs);
  }
  throw new Error('game did not finish: ' + JSON.stringify(db.read('rooms/' + code + '/game')).slice(0, 600));
}

// A: two humans and two bots play to the end; everyone agrees; private things stay private.
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2'], ['Sir', 'Bebun']);
  const hands = db.read('rooms/' + code + '/hands'), env = db.read('rooms/' + code + '/secret/envelope');
  assert.equal(Object.keys(hands).length, 4);
  cs.forEach((c) => assert.deepEqual(c.app.state().myHand, hands[c.uid], 'each player sees exactly their own hand'));
  assert(cs[1].text().includes('Your cards') && cs[1].q('table.nt'), 'game screen with notes');
  const g = await play(db, cs, code);
  await wait(20);
  assert.deepEqual(g.over.envelope.slice().sort(), env.slice().sort());
  cs.forEach((c) => {
    assert(c.text().includes(g.over.winner === c.uid ? 'You win!' : 'wins'), 'end screen');
    assert.equal(c.qa('table.tt tr.r').length, g.log.length, 'turn log shows every entry');
  });
  // a reload of a guest goes straight back into the game
  const again = open(db, 'h2', '?room=' + code); await wait(20);
  assert(again.text().includes('The envelope held'), 'rejoin after reload');
  // host starts over
  cs[0].click('[data-act=again]'); await wait(20);
  assert(cs[1].text().includes('Waiting for Hosty'), 'back in the lobby');
  assert.equal(db.read('rooms/' + code + '/hands'), null); assert.equal(db.read('rooms/' + code + '/shown'), null);
  console.log('A ok: 2 humans + 2 bots,', g.log.length, 'log entries, winner', g.over.winner);
}

// B: a human accuses correctly on the first turn and wins; the eye shows on repeat asks.
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], []);
  const env = db.read('rooms/' + code + '/secret/envelope');
  const g = await play(db, cs, code, (c) => (c.uid === 'h1' ? { cards: env, accuse: true } : null));
  await wait(10);
  assert.equal(g.over.winner, 'h1'); assert(!g.over.byDefault);
  assert(cs[0].text().includes('You win!') && cs[1].text().includes('Hosty wins'));
  console.log('B ok: correct accusation wins');
}

// C: a wrong accusation puts the player out, they still answer, and the game carries on.
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2'], ['Dada']);
  const D = S.makeDeck(S.EDITIONS[0]), env = db.read('rooms/' + code + '/secret/envelope');
  const wrong = [env[0], env[1], env[2] === D.CS[2] ? D.CS[2] + 1 : D.CS[2]];
  let g = await play(db, cs, code, (c) => (c.uid === 'h1' ? { cards: wrong, accuse: true } : null), (x) => x.out && x.out.h1);
  assert(g.out.h1 && !g.over && g.turn === 'h2');
  await wait(10);
  assert(cs[0].text().includes('you are out'));
  // h2 keeps asking for cards h1 holds: h1 must still be asked, and sees the eye the second time
  const h1hand = db.read('rooms/' + code + '/hands/h1');
  const pick = [0, 1, 2].map((k) => h1hand.find((c) => D.catOf(c) === k) ?? (D.CS[k] + 0));
  let eyes = 0, asks = 0;
  g = await play(db, cs, code, (c) => (c.uid === 'h2' ? { cards: pick } : null), (x) => {
    if (x.phase === 'answer' && x.cur.by === 'h2' && x.cur.order[x.cur.i] === 'h1' && cs[0].q('.fc.tap')) { asks++; if (cs[0].q('.fc .seen')) eyes++; }
    return x.log && x.log.filter((e) => e.t === 's' && e.by === 'h2').length >= 3;
  });
  assert(asks >= 2 && eyes >= 1, 'eye marker on a card already shown to this asker (asks ' + asks + ', eyes ' + eyes + ')');
  g = await play(db, cs, code);
  assert(g.over.winner !== 'h1');
  console.log('C ok: wrong accusation, out player still answers, eye marker; winner', g.over.winner);
}
console.log('app tests ok');
process.exit(0);
