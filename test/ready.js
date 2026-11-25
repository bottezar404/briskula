// Kraj ruke u online trešeti: nova ruka kreće čim svi ljudi pritisnu "Sljedeća ruka".
// Pokreni: node test/ready.js   (pauze između štihova ubrzane preko BRK_PACE_SCALE)
'use strict';
process.env.PORT = 0; process.env.BRK_PACE_SCALE = '0.01';
const assert = require('assert');
const WebSocket = require('ws');
const T = require('../public/treseta.js');
const server = require('../server/index.js');

function client(port, name) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, room: null, waiters: [] };
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.type !== 'room') return;
    c.room = m; c.waiters = c.waiters.filter(w => !w(m));
    const g = m.game;
    // automatski odigraj prvu dopuštenu kartu
    if (g && g.phase === 'play' && g.turn === g.you) c.send({ type: 'play', card: T.legalCards(g.hand, g.trick)[0] });
  });
  c.send = m => ws.send(JSON.stringify(m));
  c.until = f => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout: ' + f)), 8000); c.waiters.push(m => f(m) ? (clearTimeout(t), res(m), true) : false); });
  c.open = new Promise(r => ws.on('open', () => { c.send({ type: 'hello', name }); r(); }));
  return c;
}

(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  const port = server.address().port;
  const a = client(port, 'Ana'), b = client(port, 'Bruno');
  await a.open; await b.open;
  a.send({ type: 'create', mode: 2, kind: 'treseta', turnTime: 0 });
  const lobby = await a.until(m => m.code);
  b.send({ type: 'join', code: lobby.code });
  await a.until(m => m.seats.every(s => s));
  a.send({ type: 'start' });
  await a.until(m => m.game && m.game.phase === 'hand');
  b.send({ type: 'next' });
  const half = await a.until(m => m.ready.length === 1);
  assert.strictEqual(half.game.phase, 'hand', 'jedan igrač ne smije sam pokrenuti novu ruku');
  a.send({ type: 'next' });
  const nx = await a.until(m => m.game.handNo === 2);
  assert.deepStrictEqual(nx.ready, []);
  console.log('treseta kraj ruke ok: nova ruka kad su oba igrača spremna');
  server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
