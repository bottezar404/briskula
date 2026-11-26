// Grupni chat za sve online: samo prijavljeni (gosti ga ne vide), povijest se čuva, limiti, poziv u sobu, brisanje.
// Pokreni: node test/lobby.js
'use strict';
process.env.PORT = 0; process.env.BRK_PACE_SCALE = '0.01';
if (!process.env.DATABASE_URL) process.env.BRK_DATA_FILE = ':memory:';
const uniq = 'l' + Date.now().toString(36).slice(-6);
process.env.LOBBY_ADMINS = 'admin_' + uniq;
const assert = require('assert');
const WebSocket = require('ws');
const server = require('../server/index.js');

function client(port, name) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, msgs: [], waiters: [], pos: 0 };
  ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); if (m.type === 'account') c.acc = m; c.waiters = c.waiters.filter(w => !w(m)); });
  c.send = m => ws.send(JSON.stringify(m));
  c.until = (f, what) => new Promise((res, rej) => {
    for (let i = c.pos; i < c.msgs.length; i++) if (f(c.msgs[i])) { c.pos = i + 1; return res(c.msgs[i]); }
    const t = setTimeout(() => rej(new Error('timeout: ' + (what || f))), 8000);
    c.waiters.push(m => f(m) ? (clearTimeout(t), c.pos = c.msgs.length, res(m), true) : false);
  });
  c.open = new Promise(r => ws.on('open', () => { c.send({ type: 'hello', name }); r(); }));
  return c;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  await server.accounts.ready;
  const port = server.address().port;
  const a = client(port, 'Ana'), b = client(port, 'Bruno'), g = client(port, 'Gost'), adm = client(port, 'Admin');
  await Promise.all([a.open, b.open, g.open, adm.open]);
  const reg = async (c, u) => { c.send({ type: 'register', uname: u, pass: 'tajna123' }); await c.until(m => m.type === 'auth'); await c.until(m => m.type === 'account' && m.user); };
  await reg(a, 'ana_' + uniq); await reg(b, 'bruno_' + uniq); await reg(adm, 'admin_' + uniq);
  const idA = a.acc.user.id, idB = b.acc.user.id;

  // svi se pretplate; dobiju povijest i tko je online (prijavljeni + broj gostiju)
  for (const c of [a, b, g, adm]) c.send({ type: 'lobbyOpen' });
  const la = await a.until(m => m.type === 'lobby');
  await g.until(m => m.type === 'lobbyDenied', 'gost ne dobije grupni chat');
  await b.until(m => m.type === 'lobby'); await adm.until(m => m.type === 'lobby');
  assert.ok(Array.isArray(la.msgs));
  assert.ok(la.who.includes(idA) && la.who.includes(idB), 'prijavljeni su na popisu');
  assert.ok(la.guests >= 1, 'gost se broji');
  assert.strictEqual(la.users[idA].uname, 'ana_' + uniq);
  assert.strictEqual(adm.acc.user.lobbyAdmin, true); assert.strictEqual(a.acc.user.lobbyAdmin, false);
  console.log('povijest i tko je online ok');

  // gost ne može pisati
  g.send({ type: 'lobbySend', text: 'bok svima' });
  assert.match((await g.until(m => m.type === 'error')).msg, /Prijavi se/);

  // prijavljeni piše, svi (i gost, i oni koji nisu prijatelji) dobiju poruku
  a.send({ type: 'lobbySend', text: '  Tko   igra \u0007briškulu? ' });
  const ma = await a.until(m => m.type === 'lobbyMsg');
  const mb = await b.until(m => m.type === 'lobbyMsg');
  const mg = await adm.until(m => m.type === 'lobbyMsg');
  assert.strictEqual(mb.msg.t, 'Tko igra briškulu?');
  assert.strictEqual(mg.msg.f, idA);
  assert.strictEqual(mg.users[idA].name, 'Ana');
  assert.strictEqual(ma.msg.id, mb.msg.id);
  console.log('poruka stiže svima ok');

  // prebrzo i ista poruka opet
  a.send({ type: 'lobbySend', text: 'opet' });
  assert.match((await a.until(m => m.type === 'error')).msg, /Polako/);
  await wait(1600);
  a.send({ type: 'lobbySend', text: 'Tko igra briškulu?' });
  assert.match((await a.until(m => m.type === 'error')).msg, /Ista poruka/);
  // dugačka poruka se skrati
  b.send({ type: 'lobbySend', text: 'x'.repeat(900) });
  assert.strictEqual((await b.until(m => m.type === 'lobbyMsg' && m.msg.f === idB)).msg.t.length, 200);
  console.log('limiti ok');

  // poziv u sobu: samo vlastita soba sa slobodnim mjestom
  await wait(1600);
  b.send({ type: 'lobbySend', text: 'dođite', code: 'ZZZZZ' });
  assert.match((await b.until(m => m.type === 'error')).msg, /slobodnih/);
  b.send({ type: 'create', mode: 2, kind: 'briskula' });
  const room = await b.until(m => m.type === 'room');
  b.send({ type: 'lobbySend', text: 'Treba mi jedan za briškulu', code: room.code });
  const inv = await adm.until(m => m.type === 'lobbyMsg' && m.msg.code);
  assert.strictEqual(inv.msg.code, room.code);
  console.log('poziv u sobu ok');

  // nova veza (npr. osvježavanje): povijest je tu
  const late = client(port, 'Kasni'); await late.open;
  await reg(late, 'kasni_' + uniq);
  late.send({ type: 'lobbyOpen' });
  const ll = await late.until(m => m.type === 'lobby');
  assert.ok(ll.msgs.some(x => x.t === 'Tko igra briškulu?'));
  assert.ok(ll.users[idA] && ll.users[idB]);
  console.log('povijest za nove ok');

  // brisanje: tuđu poruku ne može obični korisnik, svoju može, admin može svaku
  a.send({ type: 'lobbyDel', id: inv.msg.id });
  await wait(200);
  assert.ok(!a.msgs.some(m => m.type === 'lobbyDel'));
  a.send({ type: 'lobbyDel', id: ma.msg.id });
  assert.strictEqual((await b.until(m => m.type === 'lobbyDel')).id, ma.msg.id);
  adm.send({ type: 'lobbyDel', id: inv.msg.id });
  assert.strictEqual((await b.until(m => m.type === 'lobbyDel')).id, inv.msg.id);
  late.send({ type: 'lobbyOpen' });
  const l2 = await late.until(m => m.type === 'lobby');
  assert.ok(!l2.msgs.some(x => x.id === ma.msg.id || x.id === inv.msg.id));
  console.log('brisanje ok');

  // gost nije dobio ništa iz grupnog chata
  assert.ok(!g.msgs.some(m => /^lobby(?!Denied)/.test(m.type)), 'gost ne vidi poruke ni tko je online');
  // nakon odjave više ne stižu poruke
  adm.send({ type: 'logout' }); await adm.until(m => m.type === 'account' && !m.user);
  const nAdm = adm.msgs.length;
  await wait(1600);
  late.send({ type: 'lobbySend', text: 'jel me itko čuje' });
  await a.until(m => m.type === 'lobbyMsg' && m.msg.t === 'jel me itko čuje');
  await wait(200);
  assert.ok(!adm.msgs.slice(nAdm).some(m => m.type === 'lobbyMsg'), 'odjavljeni ne dobiva poruke');
  console.log('samo prijavljeni ok');

  // odjava/odlazak: popis online se osvježi
  b.ws.close();
  await a.until(m => m.type === 'lobbyWho' && !m.who.includes(idB), 'b više nije online');
  console.log('tko je online se osvježava ok');

  console.log('SVE OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
