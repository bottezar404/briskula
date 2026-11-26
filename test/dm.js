// Direktne poruke među prijateljima: samo prijatelji, spremaju se, stižu odmah, nepročitane, "viđeno".
// Pokreni: node test/dm.js
'use strict';
process.env.PORT = 0; process.env.BRK_PACE_SCALE = '0.01';
if (!process.env.DATABASE_URL) process.env.BRK_DATA_FILE = ':memory:';
const assert = require('assert');
const WebSocket = require('ws');
const server = require('../server/index.js');

function client(port, name, auth) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, msgs: [], waiters: [], pos: 0 };
  ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); if (m.type === 'account') c.acc = m; c.waiters = c.waiters.filter(w => !w(m)); });
  c.send = m => ws.send(JSON.stringify(m));
  c.until = (f, what) => new Promise((res, rej) => {
    for (let i = c.pos; i < c.msgs.length; i++) if (f(c.msgs[i])) { c.pos = i + 1; return res(c.msgs[i]); }
    const t = setTimeout(() => rej(new Error('timeout: ' + (what || f))), 8000);
    c.waiters.push(m => f(m) ? (clearTimeout(t), c.pos = c.msgs.length, res(m), true) : false);
  });
  c.none = (f, ms) => new Promise((res, rej) => { const n = c.msgs.length; setTimeout(() => c.msgs.slice(n).some(f) ? rej(new Error('neočekivana poruka')) : res(), ms || 300); });
  c.open = new Promise(r => ws.on('open', () => { c.send({ type: 'hello', name, auth }); r(); }));
  return c;
}
const uniq = 'd' + Date.now().toString(36).slice(-6);
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  await server.accounts.ready;
  const port = server.address().port;
  const a = client(port, 'Ana'), b = client(port, 'Bruno'), x = client(port, 'Xena');
  await Promise.all([a.open, b.open, x.open]);
  const reg = async (c, u) => { c.send({ type: 'register', uname: u, pass: 'tajna123' }); const t = (await c.until(m => m.type === 'auth')).token; await c.until(m => m.type === 'account' && m.user); return t; };
  const tokA = await reg(a, 'ana_' + uniq), tokB = await reg(b, 'bruno_' + uniq);
  await reg(x, 'xena_' + uniq);
  const idA = a.acc.user.id, idB = b.acc.user.id, idX = x.acc.user.id;

  // bez prijateljstva nema poruka
  a.send({ type: 'dmSend', id: idB, text: 'bok' });
  assert.match((await a.until(m => m.type === 'error')).msg, /prijateljima/);
  a.send({ type: 'friendAdd', uname: 'bruno_' + uniq });
  await b.until(m => m.type === 'account' && m.friends.some(f => f.id === idA && f.status === 'in'));
  a.send({ type: 'dmSend', id: idB, text: 'još nismo prijatelji' });
  assert.match((await a.until(m => m.type === 'error')).msg, /prijateljima/, 'zahtjev još nije prihvaćen');
  b.send({ type: 'friendAccept', id: idA });
  await a.until(m => m.type === 'account' && m.friends.some(f => f.id === idB && f.status === 'ok'));
  await wait(550);
  console.log('samo prijatelji ok');

  // poruka stiže odmah, oboma
  a.send({ type: 'dmSend', id: idB, text: '  Bok   Bruno, \u0007igramo?  ', nonce: 7 });
  const echo = await a.until(m => m.type === 'dmMsg');
  assert.strictEqual(echo.with, idB); assert.strictEqual(echo.msg.t, 'Bok Bruno, igramo?'); assert.strictEqual(echo.nonce, 7);
  const got = await b.until(m => m.type === 'dmMsg');
  assert.strictEqual(got.with, idA); assert.strictEqual(got.msg.f, idA); assert.strictEqual(got.from, 'Ana');
  // prebrzo slanje se odbije
  a.send({ type: 'dmSend', id: idB, text: 'opet' });
  assert.match((await a.until(m => m.type === 'error')).msg, /Polako/);
  await wait(550);
  a.send({ type: 'dmSend', id: idB, text: 'x'.repeat(900) });
  assert.strictEqual((await b.until(m => m.type === 'dmMsg')).msg.t.length, 500, 'najviše 500 znakova');
  // treći ne vidi ništa i ne može čitati
  await x.none(m => m.type === 'dmMsg');
  x.send({ type: 'dmOpen', id: idA });
  assert.match((await x.until(m => m.type === 'error')).msg, /prijateljima/);
  console.log('slanje u stvarnom vremenu ok');

  // nepročitane poruke u popisu prijatelja (i nakon ponovne prijave na drugom uređaju)
  b.send({ type: 'account' });
  let fa = (await b.until(m => m.type === 'account')).friends.find(f => f.id === idA);
  assert.strictEqual(fa.unread, 2); assert.ok(fa.last > 0);
  const b2 = client(port, 'Bruno mob', tokB); await b2.open;
  fa = (await b2.until(m => m.type === 'account' && m.user)).friends.find(f => f.id === idA);
  assert.strictEqual(fa.unread, 2, 'nepročitano se vidi i na drugom uređaju');
  // otvori razgovor: povijest, pročitano, pošiljatelj dobije "viđeno", drugi uređaj makne oznaku
  b.send({ type: 'dmOpen', id: idA });
  const conv = await b.until(m => m.type === 'dm');
  assert.strictEqual(conv.msgs.length, 2); assert.strictEqual(conv.msgs[0].t, 'Bok Bruno, igramo?');
  const seen = await a.until(m => m.type === 'dmSeen');
  assert.strictEqual(seen.with, idB); assert.strictEqual(seen.seen, 2);
  await b2.until(m => m.type === 'dmRead' && m.with === idA);
  b.send({ type: 'account' });
  assert.strictEqual((await b.until(m => m.type === 'account')).friends.find(f => f.id === idA).unread, 0);
  // odgovor: svoje poruke se ne broje kao nepročitane
  b.send({ type: 'dmSend', id: idA, text: 'Može!' });
  await b2.until(m => m.type === 'dmMsg' && m.msg.t === 'Može!');
  b.send({ type: 'account' });
  assert.strictEqual((await b.until(m => m.type === 'account')).friends.find(f => f.id === idA).unread, 0);
  console.log('nepročitano i viđeno ok');

  // poruka prijatelju koji nije online čeka ga
  a.ws.close(); await wait(100);
  await wait(450);
  b.send({ type: 'dmSend', id: idA, text: 'Javi se kad dođeš' });
  await b.until(m => m.type === 'dmMsg' && m.msg.t === 'Javi se kad dođeš');
  const a2 = client(port, 'Ana', tokA); await a2.open;
  fa = (await a2.until(m => m.type === 'account' && m.user)).friends.find(f => f.id === idB);
  assert.strictEqual(fa.unread, 2, 'Može! + Javi se kad dođeš');
  a2.send({ type: 'dmOpen', id: idB });
  assert.deepStrictEqual((await a2.until(m => m.type === 'dm')).msgs.map(m => m.t).slice(-2), ['Može!', 'Javi se kad dođeš']);
  console.log('offline poruke ok');

  // ostaje i nakon restarta (zapis u pohrani) i nestaje s prijateljstvom
  const key = server.accounts.dmKey(idA, idB);
  assert.ok(server.accounts.dmGet(server.accounts.user(idA), idB).m.length === 4);
  a2.send({ type: 'friendRemove', id: idB });
  await b.until(m => m.type === 'account' && !m.friends.some(f => f.id === idA));
  assert.strictEqual(server.accounts.dmInfo(idA, idB).unread, 0);
  await wait(550);
  b.send({ type: 'dmSend', id: idA, text: 'hej?' });
  assert.match((await b.until(m => m.type === 'error')).msg, /prijateljima/);
  assert.strictEqual(server.accounts.dmGet(server.accounts.user(idA), idB), null);
  console.log('uklanjanje prijatelja briše razgovor ok (' + key + ')');

  server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
