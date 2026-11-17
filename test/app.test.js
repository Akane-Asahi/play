import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { startApp } from '../clue/app.js';
import { FakeDb } from './fake-net.js';
import { loadSolver } from './load-solver.js';
const S = loadSolver();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let DL = { bot: 0, none: 0, min: 0 };          // delays for every page: no waiting, unless a test says otherwise
function open(db, uid, query) {
  const dom = new JSDOM('<header><span class="hside"><button id="players-btn" data-act="players" hidden></button></span><span id="code-pill" hidden></span></header><main><div id="view"></div><p id="msg"></p></main>',
    { url: 'https://example.test/play/clue/' + (query || ''), pretendToBeVisual: true });
  const win = dom.window;
  win.ClueSolver = S;
  if (!win.crypto || !win.crypto.getRandomValues) Object.defineProperty(win, 'crypto', { value: webcrypto });
  const app = startApp({ net: db.client(uid), doc: win.document, win, delays: DL });
  const q = (sel) => win.document.querySelector(sel), qa = (sel) => Array.from(win.document.querySelectorAll(sel));
  const click = (sel) => { const el = typeof sel === 'string' ? q(sel) : sel; assert(el, 'missing ' + sel + ' for ' + uid + '\n' + q('#view').innerHTML.slice(0, 400)); el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };
  const type = (id, v) => { const el = q('#' + id); assert(el, 'missing #' + id); el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); };
  return { uid, win, app, q, qa, click, type, msg: () => q('#msg').textContent, text: () => q('#view').textContent };
}
const clean = (cs) => cs.forEach((c) => assert.equal(c.msg(), '', c.uid + ' sees: ' + c.msg()));

async function lobby(db, humans, bots, names, mode) {
  names = names || {};
  const host = open(db, humans[0]);
  await wait(5);
  host.type('name', names[humans[0]] || 'Hosty'); host.click('[data-act=create]'); host.click('[data-act=mk][data-m=' + (mode || 'fast') + ']'); await wait(10);
  const code = host.app.state().roomCode;
  assert.match(code, /^[A-Z0-9]{5}$/);
  assert(host.q('#share').value.endsWith('?room=' + code));
  const cs = [host];
  for (const h of humans.slice(1)) {
    const c = open(db, h + '-fresh', '?room=' + code); await wait(5);       // not in the room yet: sees the join form
    assert(c.q('#code').value === code, 'code prefilled from the link');
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
  if (c.q('[data-act=roll]')) return c.click('[data-act=roll]');
  if (c.q('[data-act=stay]')) {
    const go = c.qa('[data-act=go]'), rooms = go.filter((x) => +x.getAttribute('data-d') < 0), from = rooms.length ? rooms : go;
    return c.click(from.length ? from[Math.floor(Math.random() * from.length)] : '[data-act=stay]');
  }
  if (c.q('[data-act=suggest]')) {
    if (c.q('.iso')) {                                  // full game: the room is the one I am standing in
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
  assert(!other.q('.float'), 'only the player on turn has the floating buttons');
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
// I: the full game: dice, walking the mansion, suggesting only in the room you are in
{
  const db = new FakeDb();
  const { cs, code } = await lobby(db, ['h1', 'h2'], ['Sir', 'Dada'], null, 'full');
  let g = db.read('rooms/' + code + '/game');
  assert(g.mode === 'full' && g.phase === 'roll' && Object.keys(g.pos).length === 4, 'full game starts with a roll');
  const me = cs.find((c) => c.uid === g.turn);
  assert(me.q('.iso') && me.qa('.iso .pawn').length === 4 && !me.q('[data-act=suggest]'), 'board with four pawns, no suggesting from the corridor');
  me.click('[data-act=roll]'); await wait(10);
  g = db.read('rooms/' + code + '/game');
  assert(g.phase === 'move' && me.qa('.die').length === 2 && me.qa('[data-act=go]').length > 0, 'dice shown and squares to tap');
  assert(!cs.find((c) => c.uid !== g.turn).q('[data-act=go]'), 'only the mover can tap squares');
  const end = await play(db, cs, code);
  await wait(20);
  assert(end.over && cs.every((c) => c.q('.stamp')), 'full game plays to the finale');
  const D = S.makeDeck(S.EDITIONS[0]);
  end.log.filter((e) => e.t === 's').forEach((e) => assert(e.cards[2] >= D.CS[2], 'suggestions name a room'));
  console.log('I ok: full game with dice and board,', end.log.length, 'log entries');
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
  host.type('name', 'Hosty'); host.click('[data-act=create]'); host.click('[data-act=mk][data-m=fast]'); await wait(10);
  const code = host.app.state().roomCode;
  host.click('[data-act=bot][data-n=Sir]'); await wait(5);
  const h2 = open(db, 'h2', '?room=' + code); await wait(5);
  h2.type('name', 'Hana'); h2.click('[data-act=join]'); await wait(10);
  host.click('[data-act=start]'); await wait(20);
  assert.equal(db.read('rooms/' + code + '/game').turn, 'h1');
  const hand2 = db.read('rooms/' + code + '/hands/h2');
  [0, 1, 2].forEach((k) => { const o = host.qa('tr.pk td[data-act=pick][data-k="' + k + '"]'); host.click(o.find((x) => !hand2.includes(+x.dataset.c)) || o[0]); });
  host.click('[data-act=suggest]'); await wait(60);
  // Sir (a bot) has already answered for real, but Hana still sees him as the one thinking
  assert.equal(db.read('rooms/' + code + '/game').cur.i, 1, 'the bot has moved on');
  assert.equal(h2.q('.mcard .ci.on .cp').textContent, 'Sir', 'Sir stays up for the minimum time');
  assert.equal(h2.q('.mcard .ci.on .cl').textContent, 'Showing…');
  assert(!h2.q('[data-act=pass]'), 'her own turn to answer has not arrived on screen yet');
  const fan = h2.q('.mcard .fan'), car = h2.q('.mcard .car');
  assert(fan && car && (fan.compareDocumentPosition(car) & 4), 'names are under the cards');
  await wait(320);
  assert.equal(h2.q('.mcard .ci.on .cp').textContent, 'You', 'then it is her turn');
  h2.click('[data-act=pass]'); await wait(300);
  assert.equal(db.read('rooms/' + code + '/game').phase, 'end');
  for (let i = 0; i < 60 && !(host.q('[data-act=next]') && h2.q('[data-act=next]')); i++) await wait(50);
  assert.equal(h2.q('.mcard .ci.on .cl').textContent, 'Finishing…', 'the result ends on the player finishing the turn');
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
  DL = { bot: 0, none: 0, min: 0 };
  console.log('K ok: states last a minimum, names under the cards, bots wait for Next turn');
}
console.log('app tests ok');
process.exit(0);
