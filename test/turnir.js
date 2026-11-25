// Turnir: bodovanje po mjestu i cijeli turnir online (briškula → trešeta → poker) s botovima
'use strict';
process.env.PORT = 0; process.env.BRK_PACE_SCALE = '0.002';
const assert = require('assert');
const TR = require('../public/turnir.js');

// bodovanje
let t = TR.newTour(4);
TR.record(t, 'briskula', { scores: [{ team: 0, players: [0, 2], points: 70 }, { team: 1, players: [1, 3], points: 50 }], winners: [0, 2], draw: false });
assert.deepStrictEqual(t.points, [2, 0, 2, 0]); // par: po 2 boda (nadigrali oba protivnika)
TR.record(t, 'treseta', { scores: [{ team: 0, players: [0, 2], points: 30 }, { team: 1, players: [1, 3], points: 41 }], winners: [1, 3], draw: false });
assert.deepStrictEqual(t.points, [2, 2, 2, 2]);
TR.record(t, 'poker', { place: [3, 1, 0, 2], winners: [3] });
assert.deepStrictEqual(t.points, [3, 4, 2, 5]); // poker u četvero: 3/2/1/0
assert(t.done);
assert.deepStrictEqual(TR.standings(t).map(x => x.p), [3, 1, 0, 2]);
// izjednačeno po bodovima: odlučuje plasman u zadnjoj igri
t = TR.newTour(2); t.idx = 2; t.points = [1, 1];
TR.record(t, 'poker', { place: [1, 0], winners: [1] });
t.points = [2, 2];
const st = TR.standings(t);
assert.deepStrictEqual(st.map(x => x.p), [1, 0]);
assert.deepStrictEqual(st.map(x => x.place), [1, 2]);
t = TR.newTour(3);
TR.record(t, 'briskula', { scores: [{ team: 0, players: [0], points: 50 }, { team: 1, players: [1], points: 50 }, { team: 2, players: [2], points: 17 }], winners: [0, 1], draw: true });
assert.deepStrictEqual(t.points, [1, 1, 1]); // neriješeno: svi po ½ za svakog protivnika
TR.record(t, 'treseta', { scores: [{ team: 0, players: [0], points: 12 }, { team: 1, players: [1], points: 41 }, { team: 2, players: [2], points: 20 }], winners: [1], draw: false, low: false });
assert.deepStrictEqual(t.points, [1, 3, 2]);
assert.strictEqual(TR.fmt(1.5), '1½'); assert.strictEqual(TR.fmt(0), '0'); assert.strictEqual(TR.fmt(0.5), '½');
console.log('turnir bodovanje ok');

// cijeli turnir online: jedan čovjek (igra botovski potez) + 2 bota
const WebSocket = require('ws');
const B = require('../public/bot.js'), TB = require('../public/treseta-bot.js'), PB = require('../public/poker-bot.js');
const server = require('../server/index.js');
(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  const ws = new WebSocket(`ws://localhost:${server.address().port}/ws`);
  const send = m => ws.send(JSON.stringify(m));
  const kinds = [];
  let last = null, waiters = [];
  ws.on('message', d => {
    const m = JSON.parse(d); if (m.type !== 'room') return;
    last = m; waiters = waiters.filter(w => !w(m));
    const g = m.game; if (!g) return;
    if (g.phase === 'play' && g.turn === g.you) {
      const card = g.kind === 'poker' ? PB.choose(g, 'easy') : (g.kind === 'treseta' ? TB : B).choose(g, 'easy');
      send({ type: 'play', card });
    }
    if (g.phase === 'hand' && !m.ready.includes(g.you)) send({ type: 'next' });
  });
  const until = (f, ms) => new Promise((res, rej) => { const tm = setTimeout(() => rej(new Error('timeout ' + JSON.stringify(last && last.tour))), ms || 60000); waiters.push(m => f(m) ? (clearTimeout(tm), res(m), true) : false); });
  await new Promise(r => ws.on('open', r));
  send({ type: 'hello', name: 'Ivan' });
  send({ type: 'create', mode: 3, kind: 'turnir', target: 21, turnTime: 0 });
  const lob = await until(m => m.code);
  assert(lob.tour && lob.kind === 'briskula');
  send({ type: 'start', fillBots: true });
  for (let i = 0; i < 3; i++) {
    const m = await until(x => x.game && x.game.phase === 'over' && x.tour.results.length === i + 1, 120000);
    kinds.push(m.kind);
    if (i < 2) send({ type: 'start' });
    else {
      assert(m.tour.done);
      assert.strictEqual(m.tour.points.reduce((a, b) => a + b, 0), 9); // 3 igre × 3 boda (2+1+0)
    }
  }
  assert.deepStrictEqual(kinds, ['briskula', 'treseta', 'poker']);
  console.log('turnir online ok:', kinds.join(' → '), 'bodovi', last.tour.points);
  // novi turnir kreće od briškule
  send({ type: 'start' });
  const n = await until(x => x.game && x.game.phase === 'play' && x.tour.idx === 0);
  assert.strictEqual(n.kind, 'briskula');
  server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
