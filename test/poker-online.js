// Online poker: dva igrača + bot u sobi odigraju partiju do kraja preko servera,
// istek vremena znači provjeru/odustajanje (partija ide dalje).
'use strict';
process.env.PORT = 0; process.env.BRK_PACE_SCALE = '0.01'; process.env.BRK_TURN_SCALE = '0.01';
const assert = require('assert');
const WebSocket = require('ws');
const PB = require('../public/poker-bot.js');
const server = require('../server/index.js');

function client(port, name, auto) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, room: null, waiters: [], auto };
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.type !== 'room') return;
    c.room = m; c.waiters = c.waiters.filter(w => !w(m));
    const g = m.game;
    if (!g || !c.auto) return;
    // tuđe karte se ne vide dok se ne otkriju
    g.players.forEach((_, q) => { if (q !== g.you && g.phase === 'play') assert(!g.shown[q], 'vidi tuđe karte'); });
    if (g.phase === 'play' && g.legal) c.send({ type: 'play', card: PB.choose(g, 'easy') });
    if (g.phase === 'hand' && !m.ready.includes(g.you) && !g.players[g.you].out) c.send({ type: 'next' });
  });
  c.send = m => ws.send(JSON.stringify(m));
  c.until = (f, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms || 20000); c.waiters.push(m => f(m) ? (clearTimeout(t), res(m), true) : false); });
  c.open = new Promise(r => ws.on('open', () => { c.send({ type: 'hello', name }); r(); }));
  return c;
}

(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  const port = server.address().port;
  const a = client(port, 'Ana', true), b = client(port, 'Bruno', true);
  await a.open; await b.open;
  a.send({ type: 'create', mode: 3, kind: 'poker', turnTime: 0 });
  const lobby = await a.until(m => m.code);
  assert.strictEqual(lobby.kind, 'poker'); assert.strictEqual(lobby.wins.length, 3);
  b.send({ type: 'join', code: lobby.code });
  await a.until(m => m.seats.filter(Boolean).length === 2);
  a.send({ type: 'start', fillBots: true });
  const end = await a.until(m => m.game && m.game.phase === 'over', 60000);
  const res = end.game.result;
  assert.strictEqual(res.place.length, 3);
  assert.strictEqual(end.game.players.reduce((s, p) => s + p.chips, 0), 3000);
  assert.strictEqual(end.wins.reduce((s, x) => s + x, 0), 1);
  console.log('poker online ok: pobjednik', end.game.players[res.winners[0]].name, 'nakon', end.game.handNo, 'ruku');

  // istek vremena: igrač koji ne igra odustaje/provjerava, partija ide dalje
  const c = client(port, 'Cvita', false), d = client(port, 'Dino', false);
  await c.open; await d.open;
  c.send({ type: 'create', mode: 2, kind: 'poker', turnTime: 15 });
  const l2 = await c.until(m => m.code);
  d.send({ type: 'join', code: l2.code });
  await c.until(m => m.seats.every(Boolean));
  c.send({ type: 'start' });
  const st = await c.until(m => m.game && m.game.phase === 'play');
  const h0 = st.game.handNo;
  const after = await c.until(m => m.game && (m.game.handNo > h0 || m.game.phase === 'hand'), 5000);
  assert.notStrictEqual(after.game.phase, 'over', 'istek vremena ne smije završiti partiju pokera');
  console.log('poker istek vremena ok: ruka završena odustajanjem');
  server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
