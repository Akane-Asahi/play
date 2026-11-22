import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { startApp } from '../clue/app.js';
import * as E from '../clue/engine.js';
import { FakeDb } from './fake-net.js';
import { loadSolver } from './load-solver.js';
const S = loadSolver();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let DL = { bot: 0, none: 0, min: 0, slide: 0, bubble: 40 };          // delays for every page: no waiting, unless a test says otherwise
let L3D;                                       // fake loader for the 3D board view, set by the 3D tests
function open(db, uid, query) {
  const dom = new JSDOM('<header><span class="hside"><button id="players-btn" data-act="players" hidden></button></span><span id="code-pill" hidden></span></header><main><div id="view"></div><p id="msg"></p></main>',
    { url: 'https://example.test/play/clue/' + (query || ''), pretendToBeVisual: true });
  const win = dom.window;
  win.ClueSolver = S;
  if (!win.crypto || !win.crypto.getRandomValues) Object.defineProperty(win, 'crypto', { value: webcrypto });
  const app = startApp({ net: db.client(uid), doc: win.document, win, delays: DL, load3d: L3D });
  const q = (sel) => win.document.querySelector(sel), qa = (sel) => Array.from(win.document.querySelectorAll(sel));
  const click = (sel) => { const el = typeof sel === 'string' ? q(sel) : sel; assert(el, 'missing ' + sel + ' for ' + uid + '\n' + q('#view').innerHTML.slice(0, 400)); el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };
  const type = (id, v) => { const el = q('#' + id); assert(el, 'missing #' + id); el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); };
  return { uid, win, app, q, qa, click, type, msg: () => { const m = q('#msg .mt'); return m ? m.textContent : ''; }, text: () => q('#view').textContent };
}
const clean = (cs) => cs.forEach((c) => assert.equal(c.msg(), '', c.uid + ' sees: ' + c.msg()));

async function lobby(db, humans, bots, names, mode) {
  names = names || {};
  const host = open(db, humans[0]);
  await wait(5);
  host.type('name', names[humans[0]] || 'Hosty'); host.click('[data-act=menu]'); host.click('[data-act=create]'); host.click('[data-act=mk][data-m="' + (mode || 'fast') + '"]'); await wait(10);
  const code = host.app.state().roomCode;
  assert.match(code, /^[A-Z0-9]{5}$/);
  assert(host.q('#share').value.endsWith('?room=' + code));
  const cs = [host];
  for (const h of humans.slice(1)) {
    const c = open(db, h + '-fresh', '?room=' + code); await wait(5);       // not in the room yet: sees the join form
    assert(c.q('#code').value === code, 'code prefilled from the link');
    assert(!c.q('[data-act=create]') && !c.q('#edition') && !c.q('[data-act=menu]'), 'an invited player cannot start a room');
    assert(c.q('[data-act=join]').className === 'btn', 'Join room is the gold button');
    const real = open(db, h, '?room=' + code); await wait(5);
    real.type('name', names[h] || 'P-' + h); real.click('[data-act=join]'); await wait(10);
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
  if (c.q('[data-act=pass]')) return c.click('[data-act=pass]');
  if (c.q('[data-act=next]')) return c.click('[data-act=next]');
  if (c.q('[data-act=end]')) return c.click('[data-act=end]');
  const cardBtns = c.qa('[data-act=card]').filter((x) => !x.disabled);
  if (c.q('.sheet') && c.q('[data-act=deduce]') && !cardBtns.length) return c.click('.sheet .sx');   // the movement buttons hide while Notes is open
  if (c.q('[data-act=deduce]') && cardBtns.length) {          // my move: Deduce now and then when it is open, else pick a card, then a square
    if (c.q('[data-act=deduce].open') && Math.random() < 0.3) return c.click('[data-act=deduce]');
    const on = cardBtns.find((x) => x.classList.contains('on'));
    if (!on) return c.click(cardBtns[Math.floor(Math.random() * cardBtns.length)]);
    if (!c.q('[data-act=go]')) return c.q('[data-act=stay]') ? c.click('[data-act=stay]') : c.click(on);
  }
  if (c.q('[data-act=stay]') || c.q('[data-act=go]')) {
    const go = c.qa('[data-act=go]'), rooms = go.filter((x) => +x.getAttribute('data-d') < 0), from = rooms.length ? rooms : go;
    return c.click(from.length ? from[Math.floor(Math.random() * from.length)] : '[data-act=stay]');
  }
  if (c.q('[data-act=suggest]')) {
    if (c.q('.iso')) {                                  // full game: the room is the one I am standing in
      if (!c.q('.sheet')) c.click('[data-act=sheet][data-s=notes]');
      [0, 1].forEach((k) => { const o = c.qa('[data-act=pick][data-k="' + k + '"]'); c.click(o[Math.floor(Math.random() * o.length)]); });
      return c.click('[data-act=suggest]');
    }
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
  assert(cs[1].text().includes('Your notes') && cs[1].q('table.nt.manual') && cs[1].q('.rd'), 'game screen with a hand-filled notes sheet');
  assert(!cs[1].q('.nt .pc'), 'no calculated percentages for other names');
  const g = await play(db, cs, code);
  await wait(20);
  assert.deepEqual(g.over.envelope.slice().sort(), env.slice().sort());
  cs.forEach((c) => {
    const wname = db.read('rooms/' + code + '/players/' + g.over.winner).name;
    assert(c.q('.stamp').textContent === 'Solved' && c.q('.fin-stars') && c.q('.fin-name').textContent === wname, 'finale: name, stars and SOLVED stamp');
    const names = c.qa('.ec .ef').map((b) => b.dataset.card).sort(), D0 = S.makeDeck(S.EDITIONS[S.EDITIONS.findIndex((e) => e.id === db.read('rooms/' + code + '/meta/edition'))]);
    assert.deepEqual(names, env.map((x) => D0.CARDS[x]).sort(), 'finale shows the three envelope cards');
    assert(c.qa('.ecin').length === 3 && c.q('[data-act=home]'), 'folder with three cards and a Home button');
    assert.equal(c.q('.ftag').textContent, 'Case #' + code, 'room number written on the folder tab');
    assert.equal(c.qa('table.tt tr.r').length, g.log.length, 'turn log shows every entry');
  });
  // a reload of a guest goes straight back into the game
  const again = open(db, 'h2', '?room=' + code); await wait(20);
  assert(again.q('.stamp'), 'rejoin after reload shows the finale');
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
  assert(cs[0].q('.fin-name').textContent === 'Hosty' && cs[1].q('.fin-name').textContent === 'Hosty', 'everyone sees who won');
  assert(cs[0].q('[data-act=again]') && !cs[1].q('[data-act=again]'), 'only the host can start again');
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
  // cards h1 holds; where h1 has none in a category, a card in the envelope (nobody can show it)
  const pick = [0, 1, 2].map((k) => h1hand.find((c) => D.catOf(c) === k) ?? env.find((c) => D.catOf(c) === k));
  assert(pick.some((c) => h1hand.includes(c)), 'h1 holds at least one picked card');
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

// D: the asker sees the shown card drawn as a card; others do not
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], []);
  const D = S.makeDeck(S.EDITIONS[0]);
  const h2 = db.read('rooms/' + code + '/hands/h2'), h3 = db.read('rooms/' + code + '/hands/h3');
  const mine = db.read('rooms/' + code + '/hands/h1');
  const cat = (k) => (h2.find((c) => D.catOf(c) === k) ?? (D.CS[k] + 0));
  const cards = [0, 1, 2].map((k) => { const own = mine.filter((c) => D.catOf(c) === k); return h2.find((c) => D.catOf(c) === k) ?? [...Array(D.SZ[k])].map((_, i) => D.CS[k] + i).find((c) => !mine.includes(c)); });
  let g = await play(db, cs, code, (c) => (c.uid === 'h1' ? { cards } : null), (x) => x.phase === 'end');
  await wait(10);
  assert.equal(g.log.length, 1);
  const shower = g.log[0].resp.find((r) => r.r === 'showed');
  const sh = db.read('rooms/' + code + '/shown/h1/0');
  assert(shower && sh && sh.card != null, 'asker got a shown card');
  const big = cs[0].q('.bigcard.shownc');
  assert(big && big.textContent.includes(D.CARDS[sh.card]), 'asker sees the card drawn');
  assert(!cs[1].q('.bigcard.shownc') && !cs[2].q('.bigcard.shownc'), 'other players do not see it');
  console.log('D ok: asker sees the shown card as a card');
}

// E: a bot shows a guest a card: the guest sees it drawn as a card
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2'], ['Sir']);
  const D = S.makeDeck(S.EDITIONS[0]);
  const sir = db.read('rooms/' + code + '/hands/bot-sir'), h1 = db.read('rooms/' + code + '/hands/h1');
  const k = [0, 1, 2].find((x) => sir.some((c) => D.catOf(c) === x));
  const cards = [0, 1, 2].map((x) => (x === k ? sir.find((c) => D.catOf(c) === x) : D.CS[x] + (h1.some((c) => c === D.CS[x]) ? 1 : 0)));
  await play(db, cs, code, (c) => (c.uid === 'h2' ? { cards } : null), (x) => x.phase === 'end' && x.turn === 'h2');
  await wait(20);
  assert(cs[1].q('.bigcard.shownc'), 'guest asker sees the card a bot showed');
  console.log('E ok: bot-shown card is drawn for a non-host asker');
}

// F: only a player named Telot gets the calculated table; everyone else ticks and crosses by hand
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], [], { h2: ' telot ' });
  const [host, tel, other] = cs;
  assert(tel.q('table.nt:not(.manual)') && tel.q('.nt .pc') && !tel.q('.rd'), 'Telot sees the calculation');
  assert(!other.q('.nt .pc') && other.q('.rd') && !host.q('.nt .pc'), 'others see only the hand-filled sheet');
  const cellOf = (b) => b.dataset.c + ':' + b.dataset.o;
  const ticks = () => other.qa('.rd.y.on').map(cellOf), crosses = () => other.qa('.rd.n.on').map(cellOf);
  const A = other.qa('.rd.y')[0], B = other.qa('.rd.n')[1];
  assert.notEqual(cellOf(A), cellOf(B));
  const Ac = cellOf(A), Bc = cellOf(B);                // the page redraws after each tap, so look the buttons up again
  other.click(A); other.click(other.qa('.rd.n').find((x) => cellOf(x) === Bc));
  assert.deepEqual([ticks(), crosses()], [[Ac], [Bc]], 'a tick and a cross on different cells');
  assert.equal(other.q('.rd.y.on').getAttribute('aria-checked'), 'true');
  other.click(other.qa('.rd.n').find((x) => cellOf(x) === cellOf(A)));
  assert.deepEqual([ticks(), crosses()], [[], [Bc, Ac].sort()], 'a cross replaces the tick on the same cell');
  other.click(other.qa('.rd.n').find((x) => cellOf(x) === Ac));
  assert.deepEqual(crosses(), [Bc], 'tapping again clears it');
  const saved = JSON.parse(other.win.localStorage.getItem('clues-notes-' + code + '-h3'));
  assert.deepEqual(saved, { [Bc]: 'n' }, 'notes saved on the device');
  // reloading the page on the same device keeps them
  const again = open(db, 'h3', '?room=' + code);
  again.win.localStorage.setItem('clues-notes-' + code + '-h3', JSON.stringify(saved));
  await wait(20);
  assert.deepEqual(again.qa('.rd.n.on').map(cellOf), [Bc], 'notes come back after a reload');
  console.log('F ok: Telot gets the calculation, others get a hand-filled sheet');
}
// G: choose cards from the notes, floating move bar, players list with marked cards only
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], []);
  const g = db.read('rooms/' + code + '/game');
  const me = cs.find((c) => c.uid === g.turn), other = cs.find((c) => c.uid !== g.turn);
  assert(me.q('.float [data-act=suggest]').disabled, 'Suggest waits until three cards are chosen');
  assert(!me.q('.card.act [data-act=pick]') && !me.q('.card.act .chip'), 'no card names in the Your turn section');
  assert(!me.q('.plist') && !/\bPlayers\b/.test(me.text()), 'no Players section');
  assert(!other.q('.float [data-act=suggest]') && !other.q('.float [data-act=end]'), 'only the player on turn has the turn buttons');
  assert(other.q('.float [data-act=req-accuse]'), 'everyone else still has the Final Accusation button');
  [0, 1, 2].forEach((k) => me.click(me.qa('tr.pk td[data-act=pick][data-k="' + k + '"]')[0]));
  assert.equal(me.qa('.nt tr.sel').length, 3, 'chosen cards are highlighted in the notes');
  assert(!me.q('.float [data-act=suggest]').disabled);
  me.click('tr.sel td[data-act=pick]');                 // tap again to unchoose
  assert.equal(me.qa('.nt tr.sel').length, 2);
  // players list: mark one card for the other player, open the list
  const pid = other.uid, mark = me.qa('.rd.y').find((b) => b.dataset.o === pid);
  const c0 = mark.dataset.c; me.click(mark);
  assert(me.q('#players-btn') && !me.q('.ppanel'));
  me.click('#players-btn'); assert(me.q('.ppanel'), 'list opens');
  me.click('.ppanel [data-act=pexp][data-p="' + pid + '"]');
  const hs = db.read('rooms/' + code + '/players/' + pid + '/handSize');
  const chips = me.qa('.ppanel .pr.turn ~ .pr .chip, .ppanel .pr .pcards .chip').map((x) => x.textContent);
  assert.equal(chips.length, hs, 'one chip per card they hold');
  assert.equal(chips.filter((x) => x === '?').length, hs - 1, 'unmarked cards show as ?');
  assert(!chips.includes('?') || chips.some((x) => x !== '?'), 'the marked card is named');
  me.click('.ppanel [data-act=pexp][data-p="' + me.uid + '"]');
  assert.equal(me.qa('.ppanel .pr')[cs.findIndex((c) => c.uid === me.uid)].querySelectorAll('.chip').length, me.app.state().myHand.length, 'my own cards in full');
  me.click('.phead .x'); assert(!me.q('.ppanel'), 'list closes');
  console.log('G ok: notes picking, floating buttons, players list');
}
// H: the pop-up for someone else's suggestion waits for Next turn
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], []);
  const g0 = db.read('rooms/' + code + '/game');
  const mover = cs.find((c) => c.uid === g0.turn), watcher = cs.find((c) => c.uid !== g0.turn && c.uid !== cs.find((x) => x.uid !== g0.turn).uid) || cs.find((c) => c.uid !== g0.turn);
  assert(!watcher.q('.modal'), 'no pop-up before anything happens');
  [0, 1, 2].forEach((k) => mover.click(mover.qa('tr.pk td[data-act=pick][data-k="' + k + '"]')[0]));
  mover.click('[data-act=suggest]'); await wait(10);
  assert(watcher.q('.modal .fan'), 'asked players and watchers get a pop-up with the cards');
  // let everybody answer, never tapping Next turn
  for (let i = 0; i < 300 && db.read('rooms/' + code + '/game').phase === 'answer'; i++) { cs.forEach((c) => { const t = c.q('.fc.tap'); if (t) c.click(t); else if (c.q('[data-act=pass]')) c.click('[data-act=pass]'); }); await wait(2); }
  await wait(10);
  assert.equal(db.read('rooms/' + code + '/game').phase, 'end');
  const w2 = cs.filter((c) => c.uid !== mover.uid && !c.q('.fc.tap'));
  w2.forEach((c) => { if (c.q('[data-act=next]')) { assert(c.q('.modal'), 'result pop-up stays'); c.click('[data-act=next]'); } assert(!c.q('.modal'), c.uid + ' pop-up closes after Next turn'); });
  assert(mover.q('.modal [data-act=next]') && !mover.q('.card.act .bigc, .card.act .banner'), 'my result is in the pop-up, not the turn section');
  mover.click('[data-act=next]'); assert(!mover.q('.modal') && mover.q('[data-act=end]'), 'OK closes it');
  assert(!/Your cards/.test(mover.text()), 'no Your cards section');
  console.log('H ok: pop-up waits for Next turn');
}
// I: the full game: movement cards, walking the mansion, suggesting only in the room you are in
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2'], ['Sir', 'Dada'], null, 'full');
  let g = db.read('rooms/' + code + '/game');
  assert(g.mode === 'full' && g.phase === 'move' && Object.keys(g.pos).length === 4 && g.cards[g.turn].s === 3, 'full game starts at the move step with full hands');
  const me = cs.find((c) => c.uid === g.turn);
  assert(me.q('.iso') && me.qa('.iso .pawn').length === 4 && !me.q('[data-act=suggest]'), 'board with four pawns, no suggesting from the corridor');
  assert(!me.q('.die') && !me.q('[data-act=roll]') && !/dice/i.test(me.text()), 'no dice anywhere');
  assert(me.qa('[data-act=go]').length === 0, 'nothing glows until a card is picked');
  me.click('[data-act=card][data-k=s]'); await wait(10);
  assert(me.qa('[data-act=go]').length > 0 && db.read('rooms/' + code + '/game').cards[me.uid].s === 3, 'a Sprint shows where I can go without spending it');
  assert(!cs.find((c) => c.uid !== g.turn).q('[data-act=go]'), 'only the mover can tap squares');
  const end = await play(db, cs, code);
  await wait(20);
  assert(end.over && cs.every((c) => c.q('.stamp')), 'full game plays to the finale');
  const D = S.makeDeck(S.EDITIONS[0]);
  end.log.filter((e) => e.t === 's').forEach((e) => assert(e.cards[2] >= D.CS[2], 'suggestions name a room'));
  console.log('I ok: full game with cards and board,', end.log.length, 'log entries');
}
// J: the host cancels the game; the room is deleted and everyone is told
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2'], ['Sir']);
  const host = cs[0], guest = cs[1];
  assert(!guest.q('[data-act=cancel]'), 'only the host can cancel');
  host.click('[data-act=cancel]'); host.click('[data-act=cancel-no]');
  assert(db.read('rooms/' + code), 'Keep playing leaves the room alone');
  await assert.rejects(guest.app.net ? guest.app.net.remove('rooms/' + code) : db.client(guest.uid).remove('rooms/' + code));
  host.click('[data-act=cancel]'); host.click('[data-act=cancel-yes]'); await wait(10);
  assert.equal(db.read('rooms/' + code), null, 'room deleted');
  assert(/Game cancelled/.test(guest.text()), 'other players are told');
  console.log('J ok: host cancels and the room is deleted');
}
// K: the pop-up keeps every state up for a minimum time, names sit under the cards,
// and the bots wait while someone still has a pop-up open
{
  DL = { bot: 0, none: 0, min: 250 };
  const db = new FakeDb();
  const host = open(db, 'h1'); await wait(5);
  host.type('name', 'Hosty'); host.click('[data-act=menu]'); host.click('[data-act=create]'); host.click('[data-act=mk][data-m=fast]'); await wait(10);
  const code = host.app.state().roomCode;
  host.click('[data-act=bot][data-n=Sir]'); await wait(5);
  const h2 = open(db, 'h2', '?room=' + code); await wait(5);
  h2.type('name', 'Hana'); h2.click('[data-act=join]'); await wait(10);
  host.click('[data-act=start]'); await wait(20);
  assert.equal(db.read('rooms/' + code + '/game').turn, 'h1');
  const hand2 = db.read('rooms/' + code + '/hands/h2').concat(db.read('rooms/' + code + '/hands/bot-sir'));   // nobody can show a card: Sir and Hana both pass
  [0, 1, 2].forEach((k) => { const o = host.qa('tr.pk td[data-act=pick][data-k="' + k + '"]'); host.click(o.find((x) => !hand2.includes(+x.dataset.c)) || o[0]); });
  host.click('[data-act=suggest]'); await wait(60);
  // Sir (a bot) has already answered for real, but Hana still sees him as the one thinking
  assert.equal(db.read('rooms/' + code + '/game').cur.i, 1, 'the bot has moved on');
  assert.equal(h2.q('.mcard .ci.on .cp').textContent, 'Sir', 'Sir stays up for the minimum time');
  assert.equal(h2.q('.mcard .ci.on .cl').textContent, 'Showing…');
  assert(!h2.q('[data-act=pass]'), 'her own turn to answer has not arrived on screen yet');
  const fan = h2.q('.mcard .fan'), car = h2.q('.mcard .car');
  assert(fan && car && (fan.compareDocumentPosition(car) & 4), 'names are under the cards');
  await wait(260);
  assert.equal(h2.q('.mcard .ci.on .cp').textContent, 'Sir', 'Sir is still the one in the pill…');
  assert.equal((h2.q('.mcard .ci.on .cl .ln') || h2.q('.mcard .ci.on .cl')).textContent, 'Passed', '…and it says he passed before anyone else is asked');
  await wait(300);
  assert.equal(h2.q('.mcard .ci.on .cp').textContent, 'You', 'then it is her turn');
  h2.click('[data-act=pass]'); await wait(300);
  assert.equal(db.read('rooms/' + code + '/game').phase, 'end');
  for (let i = 0; i < 60 && !(host.q('[data-act=next]') && h2.q('[data-act=next]')); i++) await wait(50);
  assert.equal(h2.q('.mcard .ci.on .cp').textContent, 'You', 'the result ends on the last player asked, in the white pill');
  assert.equal((h2.q('.mcard .ci.on .cl .ln') || h2.q('.mcard .ci.on .cl')).textContent, 'Passed', 'with what they did');
  assert(h2.q('.mcard .fan').compareDocumentPosition(h2.q('.mcard .car')) & 4, 'and names are still under the cards');
  assert.equal(typeof db.read('rooms/' + code + '/players/h2/hold'), 'number', 'Hana is holding the game');
  host.click('[data-act=next]'); host.click('[data-act=end]'); await wait(30);
  const g1 = db.read('rooms/' + code + '/game');
  assert.equal(g1.turn, 'bot-sir');
  await wait(500);                                          // Sir would have moved long ago, if nobody was reading
  const g2 = db.read('rooms/' + code + '/game');
  assert(g2.turn === 'bot-sir' && g2.phase === 'suggest' && (g2.log || []).length === 1, 'the bot waits for Hana to tap Next turn: ' + JSON.stringify(g2));
  h2.click('[data-act=next]'); await wait(80);
  const g3 = db.read('rooms/' + code + '/game');
  assert(g3.phase === 'answer' || (g3.log || []).length === 2, 'then the bot plays');
  assert.equal(db.read('rooms/' + code + '/players/h2/hold'), null, 'Hana lets go of the game');
  DL = { bot: 0, none: 0, min: 0, slide: 0, bubble: 40 };
  console.log('K ok: states last a minimum, names under the cards, bots wait for Next turn');
}
// L: when nobody could show a card, the player can move or make a final accusation
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], [], null, 'full');
  const g0 = db.read('rooms/' + code + '/game');
  const me = cs.find((c) => c.uid === g0.turn);
  assert(me.q('[data-act=deduce]') && me.q('[data-act=accuse-open]'), 'Final Accusation is always there on your own turn');
  db.write('rooms/' + code + '/game', { ...g0, again: true }); db.notify(); await wait(20);
  const b = me.q('[data-act=accuse-open]');
  assert(b && b.textContent === 'Final Accusation' && me.q('[data-act=deduce]') && me.q('[data-act=card]:not([disabled])'), 'cards and Final Accusation are both offered');
  me.click(b); await wait(10);
  assert(!me.q('[data-act=deduce]') && me.q('[data-act=accuse-back]') && me.q('[data-act=accuse]').disabled, 'picking an accusation');
  me.click('[data-act=sheet][data-s=notes]');
  [0, 1, 2].forEach((k) => me.click(me.qa('tr.pk td[data-act=pick][data-k="' + k + '"]')[0]));
  assert(!me.q('[data-act=accuse]').disabled, 'accusation is ready once suspect, weapon and room are picked');
  me.click('[data-act=accuse-back]'); await wait(10);
  assert(me.q('[data-act=deduce]'), 'back to the move step');
  console.log('L ok: Final Accusation when nobody could show a card');
}
// M: anyone can ask for a final accusation at any time; they are asked when the turn in progress is over
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], [], null, 'full');
  const g0 = db.read('rooms/' + code + '/game');
  const me = cs.find((c) => c.uid === g0.turn), w = cs.find((c) => c.uid !== g0.turn);
  const b = w.q('.float [data-act=req-accuse]');
  assert(b && b.textContent === 'Final Accusation', 'the waiting player has a floating Final Accusation');
  w.click(b); await wait(30);
  assert(db.read('rooms/' + code + '/game').req[w.uid], 'the request is queued');
  assert(w.q('[data-act=req-cancel]') && !w.q('[data-act=req-accuse]'), 'and can be cancelled');
  w.click('[data-act=req-cancel]'); await wait(30);
  assert(!db.read('rooms/' + code + '/game').req, 'cancelled');
  w.click('[data-act=req-accuse]'); await wait(30);
  // the turn player finishes their turn (end phase)
  db.write('rooms/' + code + '/game', { ...db.read('rooms/' + code + '/game'), phase: 'end' }); db.notify(); await wait(20);
  me.click('[data-act=end]'); await wait(40);
  const g1 = db.read('rooms/' + code + '/game');
  assert(g1.phase === 'window' && g1.win.q[0] === w.uid, 'the turn is over: the window opens for the requester');
  assert(w.q('[data-act=win-pass]') && w.q('[data-act=accuse-open]'), 'they are asked: accuse or pass');
  assert(!me.q('.float [data-act=deduce]'), 'nobody else can play meanwhile');
  w.click('[data-act=win-pass]'); await wait(40);
  const g2 = db.read('rooms/' + code + '/game');
  assert(g2.phase === 'move' && !g2.win && !g2.req, 'passing carries on with the next turn');
  console.log('M ok: queued final accusation, prompt, pass');
}
// N: error messages can be dismissed with a cross
{
  const db = new FakeDb();
  const c = open(db, 'h1');
  await wait(20);
  c.click('[data-act=join]'); await wait(20);                // no name yet
  assert(c.msg().length > 0 && c.q('#msg [data-act=msg-close]'), 'an error shows with a cross');
  c.click('#msg [data-act=msg-close]'); await wait(10);
  assert(c.msg() === '' && !c.q('#msg [data-act=msg-close]'), 'the cross dismisses it');
  console.log('N ok: error message has a cross');
}
// K: rooms older than a day are swept away when anyone opens or joins a room
{
  const db = new FakeDb();
  const old = await lobby(db, ['h1', 'h2', 'h3'], []);
  const keep = await lobby(db, ['k1', 'k2', 'k3'], []);
  const oldCode = old.code, keepCode = keep.code;
  assert(db.read('roomIndex/' + oldCode) > 0 && db.read('roomIndex/' + keepCode) > 0, 'every room is indexed');
  db.write('roomIndex/' + oldCode, Date.now() - 1000);                        // its time is up
  const fresh = open(db, 'n1'); await wait(5);
  fresh.type('name', 'New'); fresh.click('[data-act=menu]'); fresh.click('[data-act=create]'); fresh.click('[data-act=mk][data-m=fast]'); await wait(20);
  assert.equal(db.read('rooms/' + oldCode), null, 'the old room is gone');
  assert.equal(db.read('roomIndex/' + oldCode), null, 'and its index entry');
  assert(db.read('rooms/' + keepCode), 'a recent room is left alone');
  assert(db.read('roomIndex/' + fresh.app.state().roomCode), 'the new room is indexed');
  // a stranger cannot delete a recent room
  await assert.rejects(db.client('stranger').remove('rooms/' + keepCode));
  console.log('K ok: rooms older than 24 hours are swept');
}
// L: how long a room lives: a lobby 3 hours, a running game 24 hours, a finished one 2 hours
{
  const db = new FakeDb(), H = 3600000;
  const { cs, code } = await lobby(db, ['h1', 'h2'], ['Sir']);
  const near = (v, h) => Math.abs(v - Date.now() - h * H) < 5 * 60000;
  assert(near(db.read('roomIndex/' + code), 24), 'a game that has started is kept 24 hours');
  const end = await play(db, cs, code);
  await wait(30);
  assert(end.over);
  assert(near(db.read('roomIndex/' + code), 2), 'a finished game is kept 2 hours');
  cs[0].click('[data-act=again]'); await wait(10);
  assert(near(db.read('roomIndex/' + code), 3), 'back in the lobby: 3 hours again');
  console.log('L2 ok: running 24h, finished 2h, lobby 3h');
}
// O: 3D game mode: same game as the full game, chosen in the lobby, drawn by the 3D board view
{
  const db = new FakeDb();
  const views = new Map(), calls = [];
  L3D = async () => ({ createBoardView: ({ doc, onMove }) => {
    const el = doc.createElement('div'); el.id = 'fake3d';
    views.set(doc, { onMove });
    return { el, update: (st) => calls.push(st), reset: () => calls.push('reset') };
  } });
  // the create screen offers three kinds of game
  const probe = open(db, 'p1'); await wait(5);
  probe.type('name', 'Pat'); probe.click('[data-act=menu]'); probe.click('[data-act=create]');
  assert.deepEqual(probe.qa('[data-act=mk]').map((b) => b.dataset.m), ['fast', 'full', '3d'], 'Fast, Full and 3D to choose from');
  // the host can switch a lobby to 3D, and everybody sees it
  const host = open(db, 'h1'); await wait(5);
  host.type('name', 'Hosty'); host.click('[data-act=menu]'); host.click('[data-act=create]'); host.click('[data-act=mk][data-m="fast"]'); await wait(10);
  const code = host.app.state().roomCode;
  host.click('[data-act=bot][data-n=Sir]'); await wait(5); host.click('[data-act=bot][data-n=Dada]'); await wait(5);
  const h2 = open(db, 'h2', '?room=' + code); await wait(5);
  h2.type('name', 'Hana'); h2.click('[data-act=join]'); await wait(10);
  const cs = [host, h2];
  cs[0].click('[data-act=setmode][data-m="3d"]'); await wait(10);
  assert.equal(db.read('rooms/' + code + '/meta/mode'), '3d');
  assert(cs[0].q('[data-act=setmode][data-m="3d"].on') && /3D game/.test(cs[1].text()), 'the lobby shows the 3D game');
  cs[0].click('[data-act=start]'); await wait(30);
  let g = db.read('rooms/' + code + '/game');
  assert(g.mode === 'full' && g.phase === 'move' && Object.keys(g.pos).length === 4, 'a 3D game is a full game underneath');
  const me = cs.find((c) => c.uid === g.turn);
  assert(me.q('#b3d-host #fake3d') && !me.q('.iso'), 'the 3D view replaces the flat map');
  const first = calls.find((c) => c !== 'reset');
  assert(first && first.order.length === 4 && first.roomNames.length === 9 && first.pos[g.turn] === g.pos[g.turn], 'the view is given the game state');
  me.click('[data-act=card][data-k=j]'); await wait(10);
  const st = calls.filter((c) => c !== 'reset').pop();
  assert(st.phase === 'move' && !('dice' in st) && st.go && st.go.cells.size > 0, 'after picking a card the view is told where I can go');
  const dest = st.go.cells.keys().next().value;
  views.get(me.win.document).onMove(dest); await wait(10);            // a tap in 3D
  g = db.read('rooms/' + code + '/game');
  assert(g.pos[me.uid] === dest && g.phase === 'end' && g.cards[me.uid].j === 4 && g.mv.c === 'j', 'a tap in 3D moves like a tap on the flat map, and spends the Jog');
  assert(calls.filter((c) => c !== 'reset').pop().mv.c === 'j', 'the 3D view is told which card was played');
  assert(me.q('#b3d-host #fake3d'), 'the canvas stays on the page after the screen redraws');
  // no WebGL (or the files do not load): the same room shows the flat map instead
  L3D = async () => { throw new Error('no WebGL'); };
  const db2 = new FakeDb();
  const b = await lobby(db2, ['h1', 'h2'], ['Sir'], null, '3d');
  await wait(30);                                                   // lobby() already started the game
  assert(b.cs.every((c) => c.q('.iso') && !c.q('#b3d-host')), 'falls back to the flat map');
  L3D = undefined;
  console.log('O ok: 3D game mode');
}
// P: Stamina & Pace: public counts, buttons, glow without spending, Deduce lock, refill pop-up, Tired
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], [], null, 'full');
  const path = 'rooms/' + code + '/game';
  let g = db.read(path);
  const me = cs.find((c) => c.uid === g.turn), other = cs.find((c) => c.uid !== g.turn);
  const lab = (c, k) => { const b = c.q('[data-act=card][data-k=' + k + ']'); return b.getAttribute('title') + ' ' + b.textContent.trim(); };
  assert.deepEqual(['s', 'j', 'w'].map((k) => lab(me, k)), ['Sprint 3', 'Jog 5', 'Walk 4'], 'three buttons with what is left');
  assert(!me.q('.stam:disabled') && other.qa('.stam').every((x) => x.disabled), 'only the player on turn can press them');
  assert(me.q('.legend .cc') && /3·5·4/.test(me.q('.legend').textContent), 'everyone can see the counts');
  assert(me.q('[data-act=deduce].locked') && /locked/.test(me.q('[data-act=deduce]').textContent), 'Deduce says it is locked');
  me.click('[data-act=deduce]'); await wait(20);
  assert(db.read(path).turn === g.turn && db.read(path).phase === 'move', 'a locked Deduce does nothing');
  me.click('[data-act=card][data-k=w]'); await wait(10);
  const walkGo = me.qa('[data-act=go]').length;
  me.click('[data-act=card][data-k=s]'); await wait(10);
  assert(me.qa('[data-act=go]').length >= walkGo && me.q('.stam.on[data-k=s]'), 'switching card changes the glow');
  me.click('[data-act=card][data-k=s]'); await wait(10);
  assert(me.qa('[data-act=go]').length === 0, 'tapping the card again hides it');
  // Deduce once a kind has run out
  const mine = { ...g.cards, [me.uid]: { s: 0, j: 2, w: 1 } };
  db.write(path, { ...g, cards: mine }); db.notify(); await wait(20);
  assert(me.q('[data-act=deduce].open') && /unlocked/.test(me.q('[data-act=deduce]').textContent), 'Deduce unlocks when a kind is at zero');
  assert(me.q('.stam.zero[data-k=s]') && me.q('.stam.zero[data-k=s]').disabled, 'a spent kind cannot be pressed');
  me.click('[data-act=deduce]'); await wait(30);
  g = db.read(path);
  assert.deepEqual(g.cards[me.uid], { s: 1, j: 4, w: 3 }, 'refill adds on top');
  assert(g.turn !== me.uid && g.phase === 'move' && g.log[g.log.length - 1].t === 'd', 'Deduce used the turn');
  [me, other].forEach((c) => {
    const m = c.q('.modal');
    assert(m && m.querySelector('h2') && /will skip this step/.test(m.querySelector('h2').textContent) && /Stamina refilled/.test(m.querySelector('h5').textContent) &&
      m.querySelector('p').textContent === '1 Sprint, 2 Jog, 2 Walks', 'everyone sees the refill pop-up');
  });
  me.click('[data-act=next]'); other.click('[data-act=next]'); await wait(10);
  assert(!me.q('.modal'), 'closed with a tap');
  me.click('[data-act=sheet][data-s=turns]'); await wait(10);
  assert(me.q('.dd h2') && /Stamina refilled/.test(me.q('.dd').textContent), 'the Turns list keeps it');
  // Tired
  const t = cs.find((c) => c.uid === db.read(path).turn);
  db.write(path, { ...db.read(path), cards: { ...db.read(path).cards, [t.uid]: { s: 0, j: 0, w: 0 } } }); db.notify(); await wait(20);
  assert(t.qa('[data-act=card]').length === 1 && /Tired/.test(t.q('[data-act=card]').getAttribute('title')) && /tired/.test(t.q('.legend').textContent), 'with nothing left there is one Tired button');
  t.click('[data-act=card][data-k=f]'); await wait(10);
  const cells = t.qa('[data-act=go]');
  assert(cells.length > 0 && cells.length < 30, 'Tired glows a couple of squares');
  const before = db.read(path).cards[t.uid];
  t.click(cells[0]); await wait(20);
  assert.deepEqual(db.read(path).cards[t.uid], before, 'Tired is never spent');
  console.log('P ok: Stamina & Pace buttons, Deduce, Tired');
}
// S: Turns table marks (👁️, moons, ?) from the calculator appear for Telot only
{
  DL = { bot: 0, none: 0, min: 0, slide: 0, bubble: 40 };
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], [], { h1: 'Telot' }, 'full');
  const path = 'rooms/' + code + '/game', hands = db.read('rooms/' + code + '/hands');
  const tel = cs[0], oth = cs[1];
  const g = db.read(path), pids = Object.keys(hands);
  const A = pids.find((p) => p !== tel.uid), D0 = S.makeDeck(S.EDITIONS[S.EDITIONS.findIndex((e) => e.id === db.read('rooms/' + code + '/meta/edition'))]);
  const B = pids.find((p) => p !== tel.uid && p !== A);
  // B says "none" to (x, y, z0), then shows a card for (x, y, z1): so B must hold z1, and Telot never saw it.
  const free = (k, skip) => { for (let c = D0.CS[k]; c < D0.CS[k] + D0.SZ[k]; c++) if (!hands[tel.uid].includes(c) && !(skip || []).includes(c)) return c; };
  const x = free(0), y = free(1), z0 = free(2), z1 = free(2, [z0]);
  db.write(path, { ...g, log: [...(g.log || []),
    { t: 's', by: A, cards: [x, y, z0], resp: [{ p: B, r: 'none' }] },
    { t: 's', by: A, cards: [x, y, z1], resp: [{ p: B, r: 'showed' }] }] }); db.notify(); await wait(20);
  tel.click('[data-act=sheet][data-s=turns]'); oth.click('[data-act=sheet][data-s=turns]'); await wait(20);
  const marks = (c) => c.qa('table.tt tr.r td').map((t) => t.textContent).join(' ');
  assert(/👁️/u.test(marks(tel)), 'Telot sees 👁️ where the calculator knows the shown card');
  assert(!/👁️|[🌕🌖🌗🌘✨]/u.test(marks(oth)) && !oth.q('.qm'), 'other players do not');
  console.log('S ok: calculator marks in the Turns table are Telot-only');
}
// T: the 🤡 bluff mark in the suggestion pop-up is Telot-only
{
  DL = { bot: 0, none: 0, min: 0, slide: 0, bubble: 40 };
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], [], { h1: 'Telot' }, 'full');
  const path = 'rooms/' + code + '/game', hands = db.read('rooms/' + code + '/hands');
  const tel = cs[0], oth = cs[1];
  const g = db.read(path), A = oth.uid;
  const D0 = S.makeDeck(S.EDITIONS[S.EDITIONS.findIndex((e) => e.id === db.read('rooms/' + code + '/meta/edition'))]);
  const free = (k) => { for (let c = D0.CS[k]; c < D0.CS[k] + D0.SZ[k]; c++) if (!hands[tel.uid].includes(c)) return c; };
  const x = free(0), y = free(1), z = free(2);
  // Telot asked; A showed him x, so Telot knows A holds x. Then A suggests x: a bluff.
  db.write('rooms/' + code + '/shown/' + tel.uid, { 0: { card: x, to: tel.uid } });
  db.write(path, { ...g, log: [...(g.log || []),
    { t: 's', by: tel.uid, cards: [x, y, z], resp: [{ p: A, r: 'showed' }] },
    { t: 's', by: A, cards: [x, y, z], resp: [{ p: tel.uid, r: 'none' }] }] }); db.notify(); await wait(30);
  let seenTel = false, seenOth = false;
  for (let i = 0; i < 6; i++) {
    if (tel.q('.modal .clown')) seenTel = true;
    if (oth.q('.modal .clown')) seenOth = true;
    if (!tel.q('[data-act=next]') && !oth.q('[data-act=next]')) break;
    if (tel.q('[data-act=next]')) tel.click('[data-act=next]');
    if (oth.q('[data-act=next]')) oth.click('[data-act=next]');
    await wait(20);
  }
  assert(seenTel, 'Telot sees the 🤡 on a card the suggester holds');
  assert(!seenOth, 'others never see it');
  console.log('T ok: bluff 🤡 for Telot only');
}
// U: a new game starts with the Notes / Turns sheet closed, even if it was open at the end of the last one
{
  DL = { bot: 0, none: 0, min: 0, slide: 0, bubble: 40 };
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], [], null, 'full');
  const host = cs[0];
  host.click('[data-act=sheet][data-s=notes]'); await wait(10);
  assert(host.q('.sheet'), 'notes open during the game');
  const mp = 'rooms/' + code + '/meta', g = db.read('rooms/' + code + '/game');
  db.write(mp, { ...db.read(mp), startedAt: (db.read(mp).startedAt || 0) + 1 }); db.notify(); await wait(20);
  assert(!host.q('.sheet'), 'a new game does not reopen the sheet');
  console.log('U ok: new game starts with the sheet closed');
}
// V: the Turns table says "yours" under the cards Telot holds, and only for Telot
{
  DL = { bot: 0, none: 0, min: 0, slide: 0, bubble: 40 };
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], [], { h1: 'Telot' }, 'full');
  const path = 'rooms/' + code + '/game', hands = db.read('rooms/' + code + '/hands'), tel = cs[0], oth = cs[1], g = db.read(path);
  const D0 = S.makeDeck(S.EDITIONS[S.EDITIONS.findIndex((e) => e.id === db.read('rooms/' + code + '/meta/edition'))]);
  const mine = hands[tel.uid][0], k = D0.catOf(mine), pick = (kk) => hands[tel.uid].find((c) => D0.catOf(c) === kk) != null ? hands[tel.uid].find((c) => D0.catOf(c) === kk) : D0.CS[kk];
  const cards = [0, 1, 2].map((kk) => kk === k ? mine : D0.CS[kk]);
  db.write(path, { ...g, log: [...(g.log || []), { t: 's', by: oth.uid, cards, resp: [] }] }); db.notify(); await wait(20);
  tel.click('[data-act=sheet][data-s=turns]'); oth.click('[data-act=sheet][data-s=turns]'); await wait(20);
  assert(tel.qa('table.tt .yrs').some((x) => /yours/i.test(x.textContent)), 'Telot sees "yours" under his own card');
  assert(!oth.q('table.tt .yrs'), 'other players do not');
  console.log('V ok: "yours" label in the Turns table for Telot only');
}
// W: when Telot has a choice of cards to show, a 🛡️ sits on the safest one; nobody else gets it
{
  DL = { bot: 0, none: 0, min: 0, slide: 0, bubble: 40 };
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], [], { h1: 'Telot' }, 'full');
  const path = 'rooms/' + code + '/game', hands = db.read('rooms/' + code + '/hands'), tel = cs[0], oth = cs[1], g = db.read(path);
  const D0 = S.makeDeck(S.EDITIONS[S.EDITIONS.findIndex((e) => e.id === db.read('rooms/' + code + '/meta/edition'))]);
  const mine = hands[tel.uid], cats = [0, 1, 2].filter((k) => mine.some((c) => D0.catOf(c) === k));
  if (cats.length >= 2) {
    const cards = [0, 1, 2].map((k) => mine.find((c) => D0.catOf(c) === k) ?? D0.CS[k]);
    const held = cards.filter((c) => mine.includes(c)), adv = E.showAdvice(D0, held, []);
    db.write(path, { ...g, phase: 'answer', cur: { by: oth.uid, cards, order: [tel.uid], i: 0, n: (g.log || []).length, resp: [] } }); db.notify(); await wait(30);
    const picks = tel.qa('.fc .pick');
    assert.equal(picks.length, 1, 'one 🛡️ for Telot');
    assert.equal(tel.qa('.fc').indexOf(picks[0].closest('.fc')), cards.indexOf(adv), 'on the card the algorithm picks');
    assert(!cs[2].q('.fc .pick') && !oth.q('.fc .pick'), 'nobody else sees one');
  }
  console.log('W ok: 🛡️ safest-card marker for Telot');
}
// X: Telot's summary card: best to ask (left), counts (middle, no "left"), best guess (right)
{
  DL = { bot: 0, none: 0, min: 0, slide: 0, bubble: 40 };
  const db = new FakeDb();
  const { cs } = await lobby(db, ['h1', 'h2', 'h3'], [], { h1: 'Telot' });
  const tel = cs[0], oth = cs[1];
  const sec = tel.q('.sum3');
  assert(sec, 'summary card has three sections');
  assert(/^\d+ · \d+ · \d+$/.test(sec.querySelector('.mid').textContent.trim()) && !/left/i.test(sec.textContent.replace(/Best guess|Envelope solved/g, '')), 'counts only, in the middle');
  assert(/Best to ask/.test(sec.querySelector('.ask').textContent), 'ask section on the left');
  assert.equal(sec.querySelectorAll('.ask b').length, 3, 'a suspect, a weapon and a room to ask about (2D game: any room)');
  assert(/Next best to ask/.test(sec.querySelector('.guess').textContent), '2D game: the runner-up question on the right');
  assert(!oth.q('.sum3'), 'others do not get it');
  // 3D/map game: the room I stand in decides
  const db2 = new FakeDb();
  const L = await lobby(db2, ['h1', 'h2', 'h3'], [], { h1: 'Telot' }, 'full');
  const t2 = L.cs[0];
  t2.click('[data-act=sheet][data-s=notes]'); await wait(10);
  assert(/Walk into a room first/.test(t2.q('.sum3 .ask').textContent), 'on the street: no room to ask from yet');
  assert(/Best to ask anywhere/.test(t2.q('.sum3 .guess').textContent) && t2.qa('.sum3 .guess b').length === 3, 'right side: the best question anywhere');
  console.log('X ok: Best to ask / counts / best guess');
}
// Z: the result of a suggestion comes as a bubble above the Final Accusation panel, then sinks away
{
  DL = { bot: 0, none: 0, min: 0, slide: 0, bubble: 150 };
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], [], null, 'full');
  const path = 'rooms/' + code + '/game', g = db.read(path), A = cs[1].uid, B = cs[2].uid, watcher = cs[0];
  const hands = db.read('rooms/' + code + '/hands'), cards = [0, 1, 2].map((k) => 0 + k);
  db.write(path, { ...g, turn: A, phase: 'end', cur: null, log: [...(g.log || []), { t: 's', by: A, cards: [0, 7, 12], resp: [{ p: B, r: 'showed' }] }] });
  db.notify(); await wait(30);
  assert(!watcher.q('.hud .bubble'), 'not while the pop-up is still telling it');
  while (watcher.q('.modal [data-act=next]')) { watcher.click('.modal [data-act=next]'); await wait(10); }
  assert(watcher.q('.hud .bubble'), 'a bubble shows the result once the pop-up is done');
  assert(/showed/.test(watcher.q('.hud .bubble').textContent), 'it says who showed a card');
  assert(!watcher.q('.card.act .banner'), 'no gold rectangle in the turn card any more');
  await wait(250);
  assert(!watcher.q('.hud .bubble'), 'the bubble sinks away after a few seconds');
  console.log('Z ok: result bubble above the Final Accusation panel');
}
// Q: Notes / Turns: the movement buttons hide while a sheet is open; the sheet slides up and slides back out
{
  DL = { bot: 0, none: 0, min: 0, slide: 60 };
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], [], null, 'full');
  const me = cs.find((c) => c.uid === db.read('rooms/' + code + '/game').turn);
  assert(me.qa('.stam').length === 3, 'movement buttons before opening');
  me.click('[data-act=sheet][data-s=turns]'); await wait(10);
  assert(me.q('.sheet.enter') && me.q('.sbackdrop.enter'), 'slides up when opened');
  assert(!me.q('.stam'), 'movement buttons are gone while the sheet is open');
  me.click('[data-act=sheet][data-s=notes]'); await wait(10);
  assert(me.q('.sheet') && !me.q('.sheet.enter') && !me.q('.stam'), 'switching sheets does not slide again');
  me.click('.sheet .sx'); await wait(10);
  assert(me.q('.sheet.out') && me.q('.sbackdrop.out') && !me.q('.stam'), 'slides down before it goes');
  await wait(150);
  assert(!me.q('.sheet') && me.qa('.stam').length === 3, 'gone, and the movement buttons are back');
  DL = { bot: 0, none: 0, min: 0, slide: 0, bubble: 40 };
  console.log('Q ok: sheets slide, movement buttons hide');
}
// R: Suggest closes the notes table
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2', 'h3'], [], null, 'full');
  const path = 'rooms/' + code + '/game';
  let g = db.read(path);
  const me = cs.find((c) => c.uid === g.turn);
  me.click('[data-act=card][data-k=s]'); await wait(10);
  const dest = me.qa('[data-act=go]').find((x) => +x.getAttribute('data-d') < 0);
  assert(dest, 'a room within a Sprint');
  me.click(dest); await wait(20);
  assert(db.read(path).phase === 'suggest');
  me.click('[data-act=sheet][data-s=notes]'); await wait(10);
  assert(me.q('.sheet'), 'notes open to pick the cards');
  [0, 1].forEach((k) => { const o = me.qa('[data-act=pick][data-k="' + k + '"]'); me.click(o[0]); });
  me.click('[data-act=suggest]'); await wait(20);
  assert(!me.q('.sheet') && !me.q('.sbackdrop'), 'the table is closed once the suggestion is sent');
  assert(db.read(path).phase === 'answer' || db.read(path).phase === 'end' || db.read(path).log.length === 1, 'and the suggestion went through');
  console.log('R ok: Suggest closes the table');
}
// S: first page is the poster: only a name and Join room, everything else behind the corner button
{
  const db = new FakeDb();
  const c = open(db, 'h1');
  await wait(20);
  assert(c.q('.homebg') && /Crime/.test(c.q('.hometitle').textContent), 'poster with the title');
  assert(c.q('#name') && c.q('[data-act=join]') && !c.q('#code'), 'at first just a name and Join room');
  assert(!c.q('[data-act=create]') && !c.q('#edition'), 'starting a room is hidden');
  assert(c.win.document.body.classList.contains('home'), 'home layout');
  c.type('name', 'Zed'); c.click('[data-act=join]'); await wait(10);
  assert(c.q('#code'), 'Join room asks for the room code');
  c.click('[data-act=join]'); await wait(10);
  assert(/room code/i.test(c.msg()), 'and complains if it is empty');
  c.click('[data-act=menu]'); await wait(10);
  assert(c.q('#edition') && c.q('[data-act=create]') && c.q('#name'), 'the corner button opens Start a room, the name stays visible');
  c.click('[data-act=menu-close]'); await wait(10);
  assert(!c.q('[data-act=create]'), 'tapping outside closes it');
  console.log('S ok: poster home page');
}
console.log('app tests ok');
process.exit(0);
