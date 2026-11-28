// Skakavac: fizika (skok, slijetanje, stabljike), kombo bodovi, dizanje ekrana i pad,
// te spremanje rekorda, ljestvica i dukati preko servera.
// Pokreni: node test/skok.js
'use strict';
process.env.PORT = 0; process.env.BRK_DATA_FILE = ':memory:'; delete process.env.DATABASE_URL;
const assert = require('assert');
const WebSocket = require('ws');
const SK = require('../public/skok.js');

const run = (g, inp, n) => { for (let i = 0; i < n && !g.over; i++) SK.step(g, typeof inp === 'function' ? inp(g) : inp); return g; };

{ // stoji na tlu, hoda, ne prolazi kroz stabljike
  const g = SK.newGame(1, 760);
  run(g, {}, 30);
  assert(g.ground && g.y === 0 && g.floor === 0, 'stoji na tlu');
  run(g, { r: true }, 200);
  assert(g.x <= SK.W - SK.WALL - SK.PW / 2 + 1e-9, 'ne izlazi desno');
  run(g, { l: true }, 200);
  assert(g.x >= SK.WALL + SK.PW / 2 - 1e-9, 'ne izlazi lijevo');
  assert(!g.over, 'prije 5. kata nema pada');
}
{ // platforme su iste za isto sjeme, katovi idu prema gore, svaki 50. je preko cijele širine
  const a = SK.newGame(77), b = SK.newGame(77);
  for (let i = 1; i < 120; i++) {
    const p = SK.plat(a, i), q = SK.plat(b, i);
    assert.deepStrictEqual([p.x0, p.x1, p.y], [q.x0, q.x1, q.y]);
    assert(p.x0 >= SK.WALL && p.x1 <= SK.W - SK.WALL && p.x1 - p.x0 >= 40, 'platforma u granicama ' + i);
    assert.strictEqual(p.y, -i * SK.FH);
  }
  const p = SK.plat(a, 50);
  assert(p.x0 === SK.WALL && p.x1 === SK.W - SK.WALL);
}
{ // skok iz mjesta: oko jednog kata; zalet: puno više
  const g = SK.newGame(3);
  SK.step(g, { j: true });
  let top = 0; while (!g.ground) { SK.step(g, {}); top = Math.min(top, g.y); }
  const low = -top;
  const h = SK.newGame(3);
  run(h, { r: true }, 120); // zalet do stabljike, odbije se
  h.vx = 10; SK.step(h, { j: true, r: true });
  let top2 = 0; for (let i = 0; i < 200 && h.vy < 0.01; i++) { SK.step(h, {}); top2 = Math.min(top2, h.y); }
  for (let i = 0; i < 40; i++) { SK.step(h, {}); top2 = Math.min(top2, h.y); }
  assert(low > SK.FH * 1.1 && low < SK.FH * 2, 'skok iz mjesta ~1,5 kat: ' + low);
  assert(-top2 > low * 2.5, 'zalet = viši skok');
}
{ // kombo: dva i više skokova preko ≥2 kata = katovi² bodova; prekida ga mali skok ili isteklo vrijeme
  const g = SK.newGame(5);
  const land = i => { const p = SK.plat(g, i); g.x = (p.x0 + p.x1) / 2; g.ground = false; g.y = p.y - 5; g.vy = 6; SK.step(g, {}); assert(g.ground && g.floor === i, 'sletio na ' + i); };
  land(3); land(6); land(9);
  assert.strictEqual(g.combo.jumps, 3); assert.strictEqual(g.combo.floors, 9);
  land(10); // samo jedan kat: kraj komba
  assert.strictEqual(g.bonus, 81, 'kombo 9 katova = 81 bod');
  assert.strictEqual(g.bestCombo, 9);
  assert.strictEqual(SK.score(g), 10 * 10 + 81);
  land(13); // jedan dobar skok nije kombo
  run(g, {}, SK.COMBO_T + 2);
  assert.strictEqual(g.bonus, 81, 'jedan skok ne nosi bonus');
  land(15); land(17);
  run(g, {}, SK.COMBO_T + 2);
  assert.strictEqual(g.bonus, 81 + 16, 'kombo istekne nakon 3 s');
}
{ // od 5. kata ekran se diže sam, sve brže; tko stoji, padne s ekrana
  const g = SK.newGame(9, 760);
  const p = SK.plat(g, 5); g.x = (p.x0 + p.x1) / 2; g.ground = false; g.y = p.y - 5; g.vy = 6; g.floor = 3;
  SK.step(g, {});
  assert(g.startT >= 0 && g.level === 1, 'kreće na 5. katu');
  const cam = g.cam; run(g, {}, 60);
  assert(g.cam < cam, 'ekran se diže');
  run(g, {}, 60 * 60);
  assert(g.over, 'tko stoji, padne');
  const h = SK.newGame(9); h.startT = 0; h.maxFloor = 5;
  for (let i = 0; i < SK.LEVEL_T * 3 + 2; i++) { h.y = h.cam + 100; h.ground = false; h.vy = -1; SK.step(h, {}); }
  assert.strictEqual(h.level, 4, 'svakih 30 s brže');
  assert(SK.speedOf(4) > SK.speedOf(1));
}
{ // jednostavan bot koji trči i skače stigne visoko i složi kombo
  const g = SK.newGame(42, 760); let d = 1;
  run(g, g => { if (g.x > SK.W - 60) d = -1; if (g.x < 60) d = 1; return { l: d < 0, r: d > 0, j: Math.abs(g.vx) > 8 }; }, 60 * 300);
  assert(g.maxFloor >= 30, 'bot stigne barem do 30. kata: ' + g.maxFloor);
  assert(g.bestCombo >= 4 && g.bonus > 0, 'bot složi kombo');
  console.log('fizika i kombo ok (bot: kat', g.maxFloor, '· bodova', SK.score(g) + ')');
}

// ---------- server: spremanje rekorda, ljestvica, dukati, provjera nemogućih rezultata ----------
const server = require('../server/index.js');
const Shop = require('../public/shop.js');
function client(port, name) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, msgs: [], waiters: [] };
  ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); c.waiters = c.waiters.filter(w => !w(m)); });
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
const uniq = 'k' + Date.now().toString(36).slice(-6);
(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  await server.accounts.ready;
  const ACC = server.accounts, port = server.address().port;
  const a = client(port, 'Ana'), b = client(port, 'Bruno'), guest = client(port, 'Gost');
  await a.open; await b.open; await guest.open;
  a.send({ type: 'register', uname: 'ana_' + uniq, pass: 'tajna123' });
  b.send({ type: 'register', uname: 'bruno_' + uniq, pass: 'tajna123' });
  const acA = await a.until(m => m.type === 'account' && m.user, 'račun A');
  await b.until(m => m.type === 'account' && m.user, 'račun B');
  assert.deepStrictEqual([acA.user.skok.best, acA.user.skok.n], [0, 0]);
  const ua = ACC.byUname('ana_' + uniq), ub = ACC.byUname('bruno_' + uniq);
  const duk0 = ua.duk;

  a.send({ type: 'skokEnd', score: 1700, floor: 120, ms: 90000, combo: 30 });
  const s1 = await a.until(m => m.type === 'skokSaved', 'spremljeno');
  assert(s1.rec && s1.best === 1700);
  const ac = await a.until(m => m.type === 'account' && m.user && m.user.skok.n === 1, 'račun nakon igre');
  assert.strictEqual(ac.user.skok.floor, 120);
  assert.strictEqual(ua.duk - duk0, Math.min(Shop.EARN.skokMax, Math.floor(120 / Shop.EARN.skokPer)), 'dukati po katovima');

  // nemogući rezultati se ne spremaju
  b.send({ type: 'skokEnd', score: 999999, floor: 50, ms: 60000, combo: 10 }); // previše bodova
  b.send({ type: 'skokEnd', score: 5000, floor: 500, ms: 20000, combo: 10 });  // prebrzo
  b.send({ type: 'skokEnd', score: 'x', floor: 10, ms: 9000 });
  b.send({ type: 'skokEnd', score: 400, floor: 30, ms: 40000, combo: 6 });
  await b.until(m => m.type === 'skokSaved', 'B spremljeno');
  assert.strictEqual(ub.skok.n, 1, 'samo ispravan rezultat'); assert.strictEqual(ub.skok.best, 400);
  // prebrzo ponovno slanje se ignorira
  b.send({ type: 'skokEnd', score: 600, floor: 40, ms: 40000, combo: 6 });
  await new Promise(r => setTimeout(r, 150));
  assert.strictEqual(ub.skok.n, 1, 'razmak između igara');

  // lošiji rezultat ne mijenja rekord
  ACC.addSkok(ua, 100, 10, 2, 5000);
  assert.strictEqual(ua.skok.best, 1700); assert.strictEqual(ua.skok.n, 2);

  // ljestvica: A prva, B druga; gost vidi bez imena
  a.send({ type: 'skokTop' });
  const t = await a.until(m => m.type === 'skokTop', 'ljestvica');
  const mine = t.top.filter(x => x.pts === 1700 || x.pts === 400);
  assert(t.top[0].pts >= t.top[t.top.length - 1].pts, 'poredano');
  assert(mine.some(x => x.me && x.pts === 1700 && x.floor === 120));
  guest.send({ type: 'skokTop' });
  const tg = await guest.until(m => m.type === 'skokTop', 'ljestvica gost');
  assert(tg.guest && tg.top.every(x => /^Igrač \d+$/.test(x.name)), 'gost ne vidi imena');
  // gost ne može spremiti rezultat
  guest.send({ type: 'skokEnd', score: 100, floor: 10, ms: 9000 });
  await new Promise(r => setTimeout(r, 100));
  assert(!guest.msgs.some(m => m.type === 'skokSaved'));
  console.log('server: rekord, ljestvica i dukati ok');
  for (const c of [a, b, guest]) c.ws.close();
  server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
