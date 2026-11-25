// Timer za potez: igrač koji ne odigra na vrijeme gubi partiju (online, dva čovjeka).
// Pokreni: node test/timer.js   (vrijeme je ubrzano 100x preko BRK_TURN_SCALE)
'use strict';
process.env.PORT = 0; process.env.BRK_TURN_SCALE = '0.01';
const assert = require('assert');
const WebSocket = require('ws');
const server = require('../server/index.js');

function client(port, name) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, room: null, waiters: [] };
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.type === 'room') { c.room = m; c.waiters = c.waiters.filter(w => !w(m)); }
  });
  c.send = m => ws.send(JSON.stringify(m));
  c.until = f => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout: ' + f)), 5000); c.waiters.push(m => f(m) ? (clearTimeout(t), res(m), true) : false); });
  c.open = new Promise(r => ws.on('open', () => { c.send({ type: 'hello', name }); r(); }));
  return c;
}

(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  const port = server.address().port;
  for (const [kind, mode] of [['briskula', 2], ['treseta', 2], ['briskula', 3], ['briskula', 4]]) {
    const a = client(port, 'Ana'), b = client(port, 'Bruno');
    await a.open; await b.open;
    a.send({ type: 'create', mode, kind, turnTime: 15 });
    const lobby = await a.until(m => m.code);
    assert.strictEqual(lobby.turnTime, 15);
    b.send({ type: 'join', code: lobby.code });
    await a.until(m => m.seats.filter(s => s && !s.bot).length === 2);
    a.send({ type: 'start', fillBots: true });
    // čekamo da netko od ljudi bude na potezu i da ne odigra
    const over = await a.until(m => m.game && m.game.phase === 'over');
    const res = over.game.result;
    assert(res.forfeit === 0 || res.forfeit === 1, 'forfeit ' + res.forfeit);
    assert(!res.winners.includes(res.forfeit), 'gubitnik ne smije biti među pobjednicima');
    if (mode === 4) assert(!res.winners.includes((res.forfeit + 2) % 4), 'par gubi zajedno');
    assert.strictEqual(res.winners.length, mode === 2 ? 1 : 2);
    assert(over.signals.some(s => /na vrijeme/.test(s.text)));
    console.log(kind, mode, 'ok: igrač', res.forfeit, 'izgubio na vrijeme, pobjede', over.wins.join(':'));
    a.ws.close(); b.ws.close();
  }
  // bez ograničenja: timer se ne pokreće
  {
    const a = client(port, 'Ana'), b = client(port, 'Bruno');
    await a.open; await b.open;
    a.send({ type: 'create', mode: 2, turnTime: 0 });
    const lobby = await a.until(m => m.code);
    b.send({ type: 'join', code: lobby.code });
    await a.until(m => m.seats.every(Boolean));
    a.send({ type: 'start' });
    const g = await a.until(m => m.game && m.game.phase === 'play');
    assert.strictEqual(g.turnLeft, null);
    await new Promise(r => setTimeout(r, 1200));
    assert.strictEqual(a.room.game.phase, 'play');
    console.log('bez timera ok');
    a.ws.close(); b.ws.close();
  }
  // jedan čovjek protiv botova: nema timera
  {
    const a = client(port, 'Ana');
    await a.open;
    a.send({ type: 'create', mode: 2, turnTime: 15 });
    await a.until(m => m.code);
    a.send({ type: 'start', fillBots: true });
    await new Promise(r => setTimeout(r, 1500));
    assert(a.room.game.phase !== 'over' && a.room.turnLeft === null);
    console.log('samo s botovima ok');
    a.ws.close();
  }
  server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
