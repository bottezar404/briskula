// Kutija za prijedloge: pišu samo prijavljeni, popis vidi samo admin, HTTP API s tajnim tokenom (since/seen).
// Pokreni: node test/prijedlozi.js
'use strict';
process.env.PORT = 0; process.env.BRK_PACE_SCALE = '0.01';
if (!process.env.DATABASE_URL) process.env.BRK_DATA_FILE = ':memory:';
const uniq = 's' + Date.now().toString(36).slice(-6);
process.env.ADMINS = 'adm_' + uniq;
const TOKEN = 'test-token-' + 'x'.repeat(30);
process.env.SUGGEST_TOKEN = TOKEN;
const assert = require('assert');
const http = require('http');
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
function req(port, method, path, auth, body) {
  return new Promise((res, rej) => {
    const r = http.request({ port, method, path, headers: Object.assign({}, auth ? { Authorization: 'Bearer ' + auth } : {}, body ? { 'Content-Type': 'application/json' } : {}) }, rs => {
      let d = ''; rs.on('data', x => d += x); rs.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { } res({ code: rs.statusCode, json: j, type: rs.headers['content-type'] }); });
    });
    r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end();
  });
}

(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  await server.accounts.ready;
  const port = server.address().port;
  const a = client(port, 'Ana'), g = client(port, 'Gost'), adm = client(port, 'Admin');
  await Promise.all([a.open, g.open, adm.open]);
  const reg = async (c, u) => { c.send({ type: 'register', uname: u, pass: 'tajna123' }); await c.until(m => m.type === 'auth'); await c.until(m => m.type === 'account' && m.user); };
  await reg(a, 'ana_' + uniq); await reg(adm, 'adm_' + uniq);
  assert.strictEqual(adm.acc.user.admin, true);

  // gost ne može poslati
  g.send({ type: 'sugSend', text: 'Dodajte belot molim vas' });
  assert.match((await g.until(m => m.type === 'error')).msg, /Prijavi se/);
  // prekratko
  a.send({ type: 'sugSend', text: 'ab' });
  assert.match((await a.until(m => m.type === 'error')).msg, /prekratak/);

  // prijavljeni šalje; admin odmah dobije popis
  a.send({ type: 'sugSend', text: '  Dodajte   belot\u0007\n\n\n\nhvala  ' });
  await a.until(m => m.type === 'sugOk');
  const live = await adm.until(m => m.type === 'sugList');
  assert.strictEqual(live.list[0].text, 'Dodajte belot\n\nhvala');
  assert.strictEqual(live.list[0].uname, 'ana_' + uniq);
  // prebrzo drugi
  a.send({ type: 'sugSend', text: 'Još jedna ideja' });
  assert.match((await a.until(m => m.type === 'error')).msg, /Polako/);
  console.log('slanje ok');

  // obični korisnik ne vidi popis
  a.send({ type: 'sugList' });
  assert.match((await a.until(m => m.type === 'error')).msg, /samo admin/);
  adm.send({ type: 'sugList' });
  const l = await adm.until(m => m.type === 'sugList');
  assert.strictEqual(l.list.length, 1);
  const id = l.list[0].id;
  console.log('samo admin vidi ok');

  // HTTP API
  assert.strictEqual((await req(port, 'GET', '/api/prijedlozi')).code, 401);
  assert.strictEqual((await req(port, 'GET', '/api/prijedlozi', 'krivi-token-' + 'y'.repeat(30))).code, 401);
  let r = await req(port, 'GET', '/api/prijedlozi', TOKEN);
  assert.strictEqual(r.code, 200); assert.match(r.type, /json/);
  assert.strictEqual(r.json.count, 1); assert.strictEqual(r.json.suggestions[0].id, id);
  assert.match(r.json.suggestions[0].at, /^\d{4}-/);
  r = await req(port, 'POST', '/api/prijedlozi/seen', TOKEN, { id });
  assert.strictEqual(r.json.seen, id);
  r = await req(port, 'GET', '/api/prijedlozi', TOKEN);
  assert.strictEqual(r.json.count, 0, 'nakon seen nema novih');
  r = await req(port, 'GET', '/api/prijedlozi?since=0', TOKEN);
  assert.strictEqual(r.json.count, 1, 'since=0 vraća sve');
  assert.strictEqual((await req(port, 'POST', '/api/prijedlozi/seen', 'krivo')).code, 401);
  console.log('API ok');

  // admin označi riješeno i obriše
  adm.send({ type: 'sugDone', id, done: true });
  assert.strictEqual((await adm.until(m => m.type === 'sugList')).list[0].done, true);
  a.send({ type: 'sugDel', id });
  assert.match((await a.until(m => m.type === 'error')).msg, /admin/);
  adm.send({ type: 'sugDel', id });
  assert.strictEqual((await adm.until(m => m.type === 'sugList')).list.length, 0);
  console.log('admin riješeno/brisanje ok');

  for (const c of [a, g, adm]) c.ws.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
