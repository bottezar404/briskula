// Korisnički računi: registracija, prijava, profil, prijatelji, tko je online, poziv i statistika.
// Pokreni: node test/accounts.js   (bez baze, sve u memoriji; s DATABASE_URL koristi Postgres)
'use strict';
process.env.PORT = 0; process.env.BRK_PACE_SCALE = '0.01';
if (!process.env.DATABASE_URL) process.env.BRK_DATA_FILE = ':memory:';
const assert = require('assert');
const WebSocket = require('ws');
const server = require('../server/index.js');
const PB = require('../public/poker-bot.js');

function client(port, name, auth) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, msgs: [], waiters: [], autoplay: false };
  ws.on('message', d => {
    const m = JSON.parse(d);
    c.msgs.push(m);
    if (m.type === 'account') c.acc = m;
    if (m.type === 'room') {
      c.room = m;
      const g = m.game;
      if (c.autoplay && g && g.kind === 'poker') {
        if (g.phase === 'play' && g.legal) c.send({ type: 'play', card: PB.choose(g, 'easy') });
        if (g.phase === 'hand' && !m.ready.includes(g.you) && !g.players[g.you].out) c.send({ type: 'next' });
      } else if (c.autoplay && g && g.phase === 'play' && g.turn === g.you) c.send({ type: 'play', card: g.hand[0] });
    }
    c.waiters = c.waiters.filter(w => !w(m));
  });
  c.send = m => ws.send(JSON.stringify(m));
  // čeka poruku (i one koje su već stigle od zadnjeg čekanja)
  c.pos = 0;
  c.until = (f, what) => new Promise((res, rej) => {
    for (let i = c.pos; i < c.msgs.length; i++) if (f(c.msgs[i])) { c.pos = i + 1; return res(c.msgs[i]); }
    const t = setTimeout(() => rej(new Error('timeout: ' + (what || f))), 8000);
    c.waiters.push(m => f(m) ? (clearTimeout(t), c.pos = c.msgs.length, res(m), true) : false);
  });
  c.open = new Promise(r => ws.on('open', () => { c.send({ type: 'hello', name, av: 'e3', auth }); r(); }));
  return c;
}
const uniq = 'u' + Date.now().toString(36).slice(-6);

(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  await server.accounts.ready;
  const port = server.address().port;
  const a = client(port, 'Ana'), b = client(port, 'Bruno');
  await a.open; await b.open;

  // registracija i greške
  a.send({ type: 'register', uname: 'a', pass: 'tajna123' });
  assert.match((await a.until(m => m.type === 'authError')).msg, /Korisničko ime/);
  a.send({ type: 'register', uname: 'ana_' + uniq, pass: '123' });
  assert.match((await a.until(m => m.type === 'authError')).msg, /Lozinka/);
  a.send({ type: 'register', uname: 'Ana_' + uniq, pass: 'tajna123' });
  const auth = await a.until(m => m.type === 'auth');
  const accA = await a.until(m => m.type === 'account' && m.user);
  assert.strictEqual(accA.user.name, 'Ana', 'račun preuzme ime iz profila');
  assert.strictEqual(accA.user.av, 'e3'); assert.strictEqual(accA.user.cm, undefined, 'nema više dužine pišulinca');
  b.send({ type: 'register', uname: 'ana_' + uniq.toUpperCase(), pass: 'tajna123' });
  assert.match((await b.until(m => m.type === 'authError')).msg, /zauzeto/, 'ime je jedinstveno bez obzira na velika slova');
  b.send({ type: 'register', uname: 'bruno_' + uniq, pass: 'lozinka9' });
  await b.until(m => m.type === 'account' && m.user);
  console.log('registracija ok');

  // promjena profila se sprema u račun
  a.send({ type: 'profile', name: 'Ana B', cm: 22, av: 'e5' });
  await new Promise(r => setTimeout(r, 100));
  const ua = server.accounts.byUname('ana_' + uniq);
  assert.strictEqual(ua.name, 'Ana B'); assert.strictEqual(ua.cm, undefined); assert.strictEqual(ua.av, 'e5');

  // prijava s "drugog uređaja" preuzme profil iz računa; kriva lozinka ne prolazi
  const a2 = client(port, 'Netko');
  await a2.open;
  a2.send({ type: 'login', uname: 'ana_' + uniq, pass: 'kriva' });
  assert.match((await a2.until(m => m.type === 'authError')).msg, /Pogrešno/);
  a2.send({ type: 'login', uname: 'ANA_' + uniq, pass: 'tajna123' });
  const acc2 = await a2.until(m => m.type === 'account' && m.user);
  assert.strictEqual(acc2.user.name, 'Ana B');
  a2.ws.close();
  // sesija vrijedi i nakon ponovnog spajanja (token u pregledniku)
  const a3 = client(port, 'Ana B', auth.token);
  await a3.open;
  assert.strictEqual((await a3.until(m => m.type === 'account')).user.uname, 'Ana_' + uniq);
  a3.ws.close();
  const bad = client(port, 'X', 'f'.repeat(48));
  await bad.open;
  assert((await bad.until(m => m.type === 'account')).expired, 'nepoznata sesija');
  bad.ws.close();
  console.log('prijava i sesija ok');

  // prijatelji: zahtjev, prihvaćanje, online status
  a.send({ type: 'friendAdd', uname: 'nepostoji_' + uniq });
  assert.match((await a.until(m => m.type === 'error')).msg, /Nema korisnika/);
  a.send({ type: 'friendAdd', uname: 'bruno_' + uniq });
  const inB = await b.until(m => m.type === 'account' && m.friends.length === 1);
  assert.strictEqual(inB.friends[0].status, 'in');
  assert.strictEqual(inB.friends[0].at, null, 'prije prihvaćanja ne vidi se je li online');
  b.send({ type: 'friendAccept', id: inB.friends[0].id });
  const okA = await a.until(m => m.type === 'account' && m.friends[0] && m.friends[0].status === 'ok' && m.friends[0].at);
  assert.strictEqual(okA.friends[0].at.where, 'menu');
  console.log('prijatelji ok');

  // Bruno napravi sobu → Ana vidi da je u sobi; poziv stiže Ani
  b.send({ type: 'create', mode: 2, kind: 'treseta', turnTime: 0 });
  const lobby = await b.until(m => m.type === 'room' && m.code);
  const seen = await a.until(m => m.type === 'account' && m.friends[0].at && m.friends[0].at.where === 'lobby');
  assert.strictEqual(seen.friends[0].at.code, lobby.code);
  assert(seen.friends[0].at.open, 'u sobi ima mjesta');
  b.send({ type: 'invite', id: inB.friends[0].id });
  const inv = await a.until(m => m.type === 'invite');
  assert.strictEqual(inv.code, lobby.code); assert.strictEqual(inv.kind, 'treseta');
  console.log('online status i poziv ok');

  // partija briškule u dvoje: statistika se upiše oboma (online)
  b.send({ type: 'variant', kind: 'briskula', low: false });
  await b.until(m => m.type === 'room' && m.kind === 'briskula');
  a.send({ type: 'join', code: lobby.code });
  const full = await b.until(m => m.type === 'room' && m.seats.every(s => s));
  assert(full.seats.every(s => s.uname), 'u sobi se vidi korisničko ime');
  assert(full.seats.every(s => s.st && s.st.w === 0 && s.st.p === 0), 'uz mjesto ide kratka statistika (pobjede, partije, vrijeme)');
  a.autoplay = b.autoplay = true;
  b.send({ type: 'start' });
  // status "u igri" (partija je ubrzana, pa može završiti prije nego se status pošalje: provjeri na serveru)
  await Promise.race([
    a.until(m => m.type === 'account' && m.friends[0].at && m.friends[0].at.where === 'game', 'u igri').then(() => 'game'),
    a.until(m => m.type === 'room' && m.game && m.game.phase === 'over', 'kraj').then(() => 'over'),
  ]);
  a.pos = 0; // kraj partije se čeka ponovno ispod
  const over = await a.until(m => m.type === 'room' && m.game && m.game.phase === 'over', 'kraj partije');
  const res = over.game.result;
  const stA = (await a.until(m => m.type === 'account' && m.user.stats.online.briskula)).user.stats.online.briskula;
  assert.strictEqual(stA.p, 1);
  const youA = over.you;
  assert.strictEqual(stA.w, !res.draw && res.winners.includes(youA) ? 1 : 0);
  assert.strictEqual(stA.d, res.draw ? 1 : 0);
  const ub = server.accounts.byUname('bruno_' + uniq);
  assert.strictEqual(ub.stats.online.briskula.p, 1);
  assert.strictEqual(ub.stats.online.briskula.w + stA.w + ub.stats.online.briskula.d, res.draw ? 2 : 1);
  assert(stA.t > 0, 'upisano je trajanje partije');
  console.log('statistika online ok:', JSON.stringify(stA));

  // partija protiv botova (javlja preglednik); prebrzo ponavljanje se ignorira
  a.send({ type: 'stat', kind: 'treseta', low: true, res: 'w' });
  a.send({ type: 'stat', kind: 'treseta', low: true, res: 'w' });
  const stBot = (await a.until(m => m.type === 'account' && m.user.stats.bots.treseta_meno)).user.stats.bots;
  await new Promise(r => setTimeout(r, 150));
  assert.deepStrictEqual(ua.stats.bots.treseta_meno, { p: 1, w: 1, d: 0 });
  assert(stBot);
  // trajanje partije protiv botova: najviše koliko je prošlo od početka (botGame), ne koliko klijent kaže
  a.send({ type: 'botGame', kind: 'briskula', mode: 2 });
  await new Promise(r => setTimeout(r, 300));
  a.send({ type: 'stat', kind: 'briskula', res: 'l', ms: 5 * 3600e3 });
  await new Promise(r => setTimeout(r, 150));
  const tb = ua.stats.bots.briskula.t;
  assert(tb >= 250 && tb < 5000, 'vrijeme protiv botova je ograničeno: ' + tb);
  console.log('statistika protiv botova ok');

  // žetoni za poker: novi račun ima 5000; partija protiv botova (pobjeda u troje +2000, poraz −1000)
  assert.strictEqual(accA.user.chips, 5000);
  const ub0 = server.accounts.byUname('bruno_' + uniq);
  a.send({ type: 'stat', kind: 'poker', res: 'w', mode: 3 });
  await a.until(m => m.type === 'account' && m.user.chips === 7000, 'pobjeda protiv botova');
  assert.strictEqual(ua.chipsLast.d, 2000);
  a.send({ type: 'stat', kind: 'poker', res: 'l', mode: 3 }); // poraz se upiše i odmah nakon pobjede
  await a.until(m => m.type === 'account' && m.user.chips === 6000, 'poraz protiv botova');
  // online poker u dvoje: pobjednik dobije ulog drugoga, u sobi se vide žetoni
  b.send({ type: 'variant', kind: 'poker' });
  const pl = await b.until(m => m.type === 'room' && m.kind === 'poker' && m.seats.every(x => x), 'poker soba');
  assert.deepStrictEqual(pl.seats.map(x => x.wallet).sort(), [5000, 6000]);
  b.send({ type: 'start' });
  const pOver = await a.until(m => m.type === 'room' && m.game && m.game.kind === 'poker' && m.game.phase === 'over', 'kraj pokera');
  const aWon = pOver.game.result.winners.includes(pOver.you);
  await a.until(m => m.type === 'account' && m.user.chips === (aWon ? 7000 : 5000), 'žetoni nakon pokera');
  assert.strictEqual(ub0.chips, aWon ? 4000 : 6000);
  // napuštanje pokera usred partije: ulog je izgubljen odmah
  a.autoplay = b.autoplay = false;
  b.send({ type: 'start' });
  await a.until(m => m.type === 'room' && m.game && m.game.phase !== 'over', 'nova partija');
  const before = ua.chips;
  a.send({ type: 'leave' });
  await a.until(m => m.type === 'account' && m.user.chips === before - 1000, 'izgubljen ulog');
  // dopuna kad padne ispod 1000
  ua.chips = 1500;
  assert.strictEqual(server.accounts.addChips(ua, -1000), 1000);
  assert.strictEqual(ua.refills, 1); assert(ua.chipsLast.refill);
  console.log('žetoni ok');

  // odjava: Bruno vidi da Ana više nije online
  a.autoplay = b.autoplay = false;
  a.send({ type: 'leave' }); b.send({ type: 'leave' });
  a.send({ type: 'logout' });
  await a.until(m => m.type === 'account' && !m.user);
  const offB = await b.until(m => m.type === 'account' && m.friends[0] && m.friends[0].at === null);
  assert(offB.friends[0].seen > 0);
  // uklanjanje prijatelja
  b.send({ type: 'friendRemove', id: offB.friends[0].id });
  await b.until(m => m.type === 'account' && m.friends.length === 0);
  assert.deepStrictEqual(ua.friends, {});
  console.log('odjava i uklanjanje prijatelja ok');

  await server.accounts.flush();
  server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
