// Povijest online partija (potez po potez) i admin reset lozinke.
// Pokreni: node test/history.js   (bez baze, sve u memoriji)
'use strict';
process.env.PORT = 0; process.env.BRK_PACE_SCALE = '0.01'; process.env.ADMINS = 'Sef_test';
if (!process.env.DATABASE_URL) process.env.BRK_DATA_FILE = ':memory:';
const assert = require('assert');
const WebSocket = require('ws');
const T = require('../public/treseta.js');
const server = require('../server/index.js');

function client(port, name, auth) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, msgs: [], waiters: [], autoplay: false, pos: 0 };
  ws.on('message', d => {
    const m = JSON.parse(d);
    c.msgs.push(m);
    const g = m.type === 'room' && m.game;
    if (c.autoplay && g && g.phase === 'play' && g.turn === g.you) c.send({ type: 'play', card: g.kind === 'treseta' ? T.legalCards(g.hand, g.trick)[0] : g.hand[0] });
    c.waiters = c.waiters.filter(w => !w(m));
  });
  c.send = m => ws.send(JSON.stringify(m));
  c.until = (f, what) => new Promise((res, rej) => {
    for (let i = c.pos; i < c.msgs.length; i++) if (f(c.msgs[i])) { c.pos = i + 1; return res(c.msgs[i]); }
    const t = setTimeout(() => rej(new Error('timeout: ' + (what || f))), 15000);
    c.waiters.push(m => f(m) ? (clearTimeout(t), c.pos = c.msgs.length, res(m), true) : false);
  });
  c.open = new Promise(r => ws.on('open', () => { c.send({ type: 'hello', name, auth }); r(); }));
  return c;
}
const id = Date.now().toString(36).slice(-5);

(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  await server.accounts.ready;
  const port = server.address().port;
  const a = client(port, 'Ana'), b = client(port, 'Bruno'), boss = client(port, 'Šef');
  await Promise.all([a.open, b.open, boss.open]);
  a.send({ type: 'register', uname: 'ana' + id, pass: 'tajna123' });
  b.send({ type: 'register', uname: 'bruno' + id, pass: 'tajna123' });
  boss.send({ type: 'register', uname: 'Sef_test', pass: 'tajna123' });
  await a.until(m => m.type === 'account' && m.user);
  await b.until(m => m.type === 'account' && m.user);
  const bAcc = await boss.until(m => m.type === 'account' && m.user);
  assert(bAcc.user.admin, 'Sef_test je admin');

  for (const kind of ['briskula', 'treseta']) {
    a.send({ type: 'create', mode: 2, kind, turnTime: 0, target: 21 });
    const lobby = await a.until(m => m.type === 'room' && m.code && m.kind === kind && !m.game);
    b.send({ type: 'join', code: lobby.code });
    await a.until(m => m.type === 'room' && m.seats.every(s => s));
    a.autoplay = b.autoplay = true;
    a.send({ type: 'start' });
    // trešeta: kraj ruke, oba igrača idu dalje
    for (;;) {
      const m = await a.until(x => x.type === 'room' && x.game && (x.game.phase === 'hand' || x.game.phase === 'over'), 'kraj ruke');
      if (m.game.phase === 'over') break;
      a.send({ type: 'next' }); b.send({ type: 'next' });
      await a.until(x => x.type === 'room' && x.game && x.game.phase === 'play', 'nova ruka');
    }
    a.autoplay = b.autoplay = false;
    a.send({ type: 'leave' }); b.send({ type: 'leave' });
    await a.until(m => m.type === 'left');
  }

  a.send({ type: 'history' });
  const h = await a.until(m => m.type === 'history');
  assert.strictEqual(h.list.length, 2);
  assert.deepStrictEqual(h.list.map(x => x.kind), ['treseta', 'briskula'], 'najnovija prva');
  a.send({ type: 'game', id: h.list[1].id });
  const g = (await a.until(m => m.type === 'game')).game;
  const cards = g.moves.filter(x => x.c), tricks = g.moves.filter(x => x.w != null);
  assert.strictEqual(cards.length, 40, 'briškula u dvoje: 40 karata');
  assert.strictEqual(tricks.length, 20, '20 štihova');
  assert.strictEqual(tricks.reduce((s, x) => s + x.pts, 0), 120, 'ukupno 120 bodova');
  assert(g.moves[0].trump, 'zabilježena briškula');
  assert.strictEqual(g.players[0].uname, 'ana' + id);
  assert(!('uids' in g), 'id-evi računa se ne šalju');
  a.send({ type: 'game', id: h.list[0].id });
  const gt = (await a.until(m => m.type === 'game')).game;
  assert(gt.moves.filter(x => x.c).length >= 40 && gt.moves.some(x => x.h != null), 'trešeta: karte i ruke');
  console.log('povijest ok:', g.moves.length, 'zapisa briškula,', gt.moves.length, 'trešeta');

  // tuđu povijest vidi samo admin
  b.send({ type: 'history', uname: 'ana' + id });
  assert.match((await b.until(m => m.type === 'error')).msg, /admin/);
  boss.send({ type: 'history', uname: 'ana' + id });
  const bh = await boss.until(m => m.type === 'history');
  assert.strictEqual(bh.list.length, 2); assert(!bh.mine);
  boss.send({ type: 'game', id: h.list[0].id });
  await boss.until(m => m.type === 'game');
  b.send({ type: 'game', id: 'nepostoji1' });
  await b.until(m => m.type === 'error');
  console.log('admin vidi tuđu povijest ok');

  // admin reset lozinke
  b.send({ type: 'adminReset', uname: 'ana' + id });
  assert.match((await b.until(m => m.type === 'error')).msg, /admin/);
  boss.send({ type: 'adminReset', uname: 'ANA' + id });
  const rs = await boss.until(m => m.type === 'adminReset');
  assert.match(rs.pass, /^[a-z0-9]{8}$/);
  assert((await a.until(m => m.type === 'account' && !m.user)).expired, 'Ana je odjavljena');
  a.send({ type: 'login', uname: 'ana' + id, pass: 'tajna123' });
  await a.until(m => m.type === 'authError');
  a.send({ type: 'login', uname: 'ana' + id, pass: rs.pass });
  const la = await a.until(m => m.type === 'account' && m.user);
  assert(la.user.tempPass, 'privremena lozinka');
  a.send({ type: 'password', old: rs.pass, pass: 'nova12345' });
  await a.until(m => m.type === 'info');
  assert(!server.accounts.byUname('ana' + id).tempPass);
  console.log('admin reset lozinke ok');

  await server.accounts.flush();
  server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
