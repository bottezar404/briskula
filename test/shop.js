// Dukati i trgovina: početno stanje, dnevni bonus, zarada od partija, kupnja, opremanje i prikaz u sobi.
// Pokreni: node test/shop.js
'use strict';
process.env.PORT = 0; process.env.BRK_PACE_SCALE = '0.01';
process.env.BRK_DATA_FILE = ':memory:'; delete process.env.DATABASE_URL;
const assert = require('assert');
const WebSocket = require('ws');
const server = require('../server/index.js');
const Shop = require('../public/shop.js');
const E$ = Shop.EARN;

function client(port, name) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, msgs: [], waiters: [], autoplay: false };
  ws.on('message', d => {
    const m = JSON.parse(d);
    c.msgs.push(m);
    if (m.type === 'room') {
      const g = m.game;
      if (c.autoplay && g && g.phase === 'play' && g.turn === g.you) c.send({ type: 'play', card: g.hand[0] });
    }
    c.waiters = c.waiters.filter(w => !w(m));
  });
  c.send = m => ws.send(JSON.stringify(m));
  c.pos = 0;
  c.until = (f, what) => new Promise((res, rej) => {
    for (let i = c.pos; i < c.msgs.length; i++) if (f(c.msgs[i])) { c.pos = i + 1; return res(c.msgs[i]); }
    const t = setTimeout(() => rej(new Error('timeout: ' + (what || f))), 8000);
    c.waiters.push(m => f(m) ? (clearTimeout(t), c.pos = c.msgs.length, res(m), true) : false);
  });
  c.open = new Promise(r => ws.on('open', () => { c.send({ type: 'hello', name, av: 'e3' }); r(); }));
  return c;
}
const uniq = 's' + Date.now().toString(36).slice(-6);

(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  await server.accounts.ready;
  const ACC = server.accounts;
  const port = server.address().port;

  // stari račun (bez dukata) dobije početne + 5 po dosadašnjoj pobjedi
  const old = { stats: { online: { briskula: { p: 9, w: 7, d: 0 } }, bots: { poker: { p: 3, w: 2, d: 0 } } } };
  assert.strictEqual(ACC.dukOf(old), E$.start + 9 * E$.perOldWin);
  old.duk = undefined; old.stats.bots.poker.w = 999;
  assert.strictEqual(ACC.dukOf(old), E$.start + E$.oldMax, 'najviše oldMax za stare pobjede');

  const a = client(port, 'Ana'), b = client(port, 'Bruno');
  await a.open; await b.open;
  a.send({ type: 'register', uname: 'ana_' + uniq, pass: 'tajna123' });
  b.send({ type: 'register', uname: 'bruno_' + uniq, pass: 'tajna123' });
  const accA = await a.until(m => m.type === 'account' && m.user, 'račun A');
  await b.until(m => m.type === 'account' && m.user, 'račun B');
  // novi račun: početni dukati + dnevni bonus
  assert.strictEqual(accA.user.duk, E$.start + E$.daily);
  assert.strictEqual(accA.user.dukLast.why, 'dnevni bonus');
  const ua = ACC.byUname('ana_' + uniq), ub = ACC.byUname('bruno_' + uniq);
  assert.strictEqual(ACC.daily(ua), 0, 'dnevni bonus samo jednom na dan');
  console.log('početni dukati i dnevni bonus ok');

  // kupnja: preskupo, nepostojeće, uspješno; kupljeno se odmah opremi
  a.send({ type: 'shopBuy', id: 'fr_dijamant' });
  assert.match((await a.until(m => m.type === 'error')).msg, /dovoljno/);
  a.send({ type: 'shopBuy', id: 'nema_toga' });
  assert.match((await a.until(m => m.type === 'error')).msg, /ne postoji/);
  a.send({ type: 'shopBuy', id: 'fr_srebro' });
  let m = await a.until(x => x.type === 'account' && x.user.inv.includes('fr_srebro'), 'kupljen okvir');
  assert.strictEqual(m.user.duk, E$.start + E$.daily - Shop.BY_ID.fr_srebro.price);
  assert.strictEqual(m.user.eq.fr, 'fr_srebro');
  a.send({ type: 'shopBuy', id: 'fr_srebro' });
  assert.match((await a.until(x => x.type === 'error')).msg, /već/);
  ua.duk += 100; // za još jednu kupnju
  a.send({ type: 'shopBuy', id: 'bd_sidro' });
  await a.until(x => x.type === 'account' && x.user.eq.bd === 'bd_sidro', 'kupljena značka');
  // skidanje i ponovno stavljanje; tuđi/nekupljeni predmet se ne može staviti
  a.send({ type: 'shopEquip', slot: 'fr', id: null });
  await a.until(x => x.type === 'account' && !x.user.eq.fr, 'skinut okvir');
  a.send({ type: 'shopEquip', slot: 'fr', id: 'fr_zlato' });
  assert.match((await a.until(x => x.type === 'error')).msg, /nemaš/);
  a.send({ type: 'shopEquip', slot: 'bd', id: 'fr_srebro' });
  assert.match((await a.until(x => x.type === 'error')).msg, /nemaš/);
  a.send({ type: 'shopEquip', slot: 'fr', id: 'fr_srebro' });
  await a.until(x => x.type === 'account' && x.user.eq.fr === 'fr_srebro', 'ponovno stavljen okvir');
  console.log('kupnja i opremanje ok');

  // u sobi drugi igrač vidi okvir i značku
  b.send({ type: 'create', mode: 2, kind: 'briskula', turnTime: 0 });
  const lobby = await b.until(x => x.type === 'room' && x.code);
  a.send({ type: 'join', code: lobby.code });
  const full = await b.until(x => x.type === 'room' && x.seats.every(s => s), 'puna soba');
  const seatA = full.seats.find(s => s.uname === ua.uname), seatB = full.seats.find(s => s.uname === ub.uname);
  assert.deepStrictEqual(seatA.cos, { fr: 'fr_srebro', bd: 'bd_sidro' });
  assert(!seatB.cos, 'bez ukrasa nema cos');

  // online partija: pobjeda 30, poraz 8, neriješeno 15
  const dA = ua.duk, dB = ub.duk;
  a.autoplay = b.autoplay = true;
  b.send({ type: 'start' });
  const over = await a.until(x => x.type === 'room' && x.game && x.game.phase === 'over', 'kraj partije');
  await new Promise(r => setTimeout(r, 100)); // dukati se upišu prije poruke o kraju partije
  const res = over.game.result, aWin = !res.draw && res.winners.includes(over.you);
  const expA = res.draw ? E$.onlineDraw : aWin ? E$.onlineWin : E$.onlineLoss;
  const expB = res.draw ? E$.onlineDraw : aWin ? E$.onlineLoss : E$.onlineWin;
  assert.strictEqual(ua.duk - dA, expA); assert.strictEqual(ub.duk - dB, expB);
  console.log('dukati za online partiju ok:', ua.duk - dA, ub.duk - dB);

  // tko izađe usred partije ne dobije ništa
  a.autoplay = b.autoplay = false;
  b.send({ type: 'start' });
  await a.until(x => x.type === 'room' && x.game && x.game.phase === 'play', 'nova partija');
  const dA2 = ua.duk, dB2 = ub.duk;
  a.send({ type: 'leave' });
  b.autoplay = true; b.send({ type: 'ping' });
  // Bruno odigra do kraja protiv bota
  const g = (await b.until(x => x.type === 'room' && x.game && x.game.phase === 'play' && x.seats.some(s => s.bot))).game;
  if (g.turn === g.you) b.send({ type: 'play', card: g.hand[0] });
  await b.until(x => x.type === 'room' && x.game && x.game.phase === 'over', 'kraj s botom');
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(ua.duk, dA2, 'napustio/la: bez dukata');
  assert(ub.duk > dB2, 'tko je ostao, dobije dukate (protiv bota)');
  console.log('napuštanje partije ok');

  // protiv botova (javlja preglednik): po jačini, dnevna granica
  const d3 = ua.duk;
  a.send({ type: 'stat', kind: 'treseta', res: 'w', level: 'hard' });
  await a.until(x => x.type === 'account' && x.user.duk === d3 + E$.botWin.hard, 'pobjeda protiv botova');
  ua.dukDay.bots = E$.botDay - 2;
  assert.strictEqual(ACC.addDuk(ua, 10, 'test', true), 2, 'granica za botove');
  assert.strictEqual(ACC.addDuk(ua, 10, 'test', true), 0);
  assert.strictEqual(ACC.addDuk(ua, 10, 'online'), 10, 'online nema granice');
  console.log('dukati protiv botova ok');

  a.ws.close(); b.ws.close();
  await ACC.flush();
  console.log('trgovina: sve ok');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
