// Čovječe ne ljuti se: pravila (izlazak šesticom, jedenje, točan ulazak u cilj, 3 pokušaja),
// botovi odigraju partije do kraja, i online partija preko servera (s istekom vremena).
'use strict';
process.env.PORT = 0; process.env.BRK_PACE_SCALE = '0.01'; process.env.BRK_TURN_SCALE = '0.01';
const assert = require('assert');
const C = require('../public/covjece.js');
const CB = require('../public/covjece-bot.js');

// kocka s unaprijed zadanim bacanjima
const dice = seq => { let k = 0; return () => (seq[k++ % seq.length] - 1) / 6 + 0.01; };

{ // izlazak samo sa šesticom, 3 pokušaja, šestica = još jedno bacanje
  const g = C.newGame(2, { dealer: 0, rng: dice([2, 3, 4, 6, 5]) });
  for (let k = 0; k < 2; k++) { assert(C.play(g, 0, 'roll')); assert.strictEqual(g.phase, 'collect'); C.collect(g); assert.strictEqual(g.turn, 0, 'još pokušaja'); }
  assert(C.play(g, 0, 'roll')); C.collect(g); assert.strictEqual(g.turn, 1, 'nakon 3 pokušaja red je na drugog');
  assert(C.play(g, 1, 'roll')); assert.strictEqual(g.need, 'move'); // šestica
  assert.deepStrictEqual(g.moves.map(m => m.to), [0, 0, 0, 0]);
  assert(!C.play(g, 1, 'm:9')); assert(C.play(g, 1, 'm:2'));
  assert.strictEqual(g.players[1].pieces[2], 0); assert.strictEqual(g.turn, 1, 'šestica: opet baca');
  assert(C.play(g, 1, 'roll')); assert.strictEqual(g.need, 'move'); assert(C.play(g, 1, 'm:2'));
  assert.strictEqual(g.players[1].pieces[2], 5); assert.strictEqual(g.turn, 0);
}
{ // jedenje: crveni (boja 0) stane na polje zelenog (boja 2) i vrati ga u kućicu
  const g = C.newGame(2, { dealer: 0, rng: dice([3]) });
  g.players[0].pieces = [17, -1, -1, -1]; // polje 17
  g.players[1].pieces = [0, -1, -1, -1];  // zeleni start = zajedničko polje 20
  assert(C.play(g, 0, 'roll'));
  assert.strictEqual(g.moves.length, 1); assert.deepStrictEqual(g.moves[0].cap, { p: 1, i: 0 });
  assert(C.play(g, 0, 'm:0'));
  assert.strictEqual(g.players[1].pieces[0], -1); assert.strictEqual(g.players[0].caps, 1);
}
{ // u cilj točnim brojem, bez preskakanja svojih; pobjeda kad su sve 4 u cilju
  const g = C.newGame(2, { dealer: 0, rng: dice([5, 2]) });
  g.players[0].pieces = [41, 42, 43, 38];
  assert(C.play(g, 0, 'roll')); // 5: 38+5 = 43 previše, ostale ne mogu
  assert.strictEqual(g.phase, 'collect'); C.collect(g); assert.strictEqual(g.turn, 1);
  g.players[0].pieces = [42, 41, 43, 38]; g.turn = 0;
  assert(C.play(g, 0, 'roll')); // 2: 38 → 40 (ne preskače 41)
  assert.deepStrictEqual(g.moves.map(m => [m.i, m.to]), [[3, 40]]);
  g.players[0].pieces = [41, 42, 43, 39]; g.phase = 'play'; g.need = 'roll'; g.rng = dice([1]);
  assert(C.play(g, 0, 'roll')); assert(C.play(g, 0, 'm:3'));
  assert.strictEqual(g.phase, 'over'); assert.deepStrictEqual(g.result.winners, [0]); assert.strictEqual(g.result.place.length, 2);
}
{ // ne može na svoju figuru; ne može iz kućice ako mu je start zauzet vlastitom figurom
  const g = C.newGame(3, { dealer: 0, rng: dice([6]) });
  g.players[0].pieces = [0, 6, -1, -1];
  assert(C.play(g, 0, 'roll'));
  assert.deepStrictEqual(g.moves.map(m => m.i), [1]);
}
{ // botovi odigraju partije u svim načinima
  for (const mode of [2, 3, 4]) for (const lv of ['easy', 'normal', 'hard']) {
    const g = C.newGame(mode, {});
    let n = 0;
    while (g.phase !== 'over' && n++ < 20000) {
      if (g.phase === 'collect') { C.collect(g); continue; }
      assert(C.play(g, g.turn, CB.choose(C.viewFor(g, g.turn), lv)), 'bot igra ispravno');
    }
    assert.strictEqual(g.phase, 'over'); assert.strictEqual(g.result.place.length, mode);
    assert.strictEqual(g.players[g.result.winners[0]].pieces.every(x => x >= 40), true);
  }
  console.log('čovječe pravila i botovi ok');
}

// ---------- online ----------
const WebSocket = require('ws');
const server = require('../server/index.js');
function client(port, name, auto) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, room: null, waiters: [], auto };
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.type !== 'room') return;
    c.room = m; c.waiters = c.waiters.filter(w => !w(m));
    const g = m.game;
    if (g && c.auto && g.phase === 'play' && g.legal) c.send({ type: 'play', card: CB.choose(g, 'normal') });
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
  a.send({ type: 'create', mode: 4, kind: 'covjece', low: true, turnTime: 0 });
  const lobby = await a.until(m => m.code);
  assert.strictEqual(lobby.kind, 'covjece'); assert.strictEqual(lobby.low, false); assert.strictEqual(lobby.wins.length, 4, 'svatko za sebe');
  b.send({ type: 'join', code: lobby.code });
  await a.until(m => m.seats.filter(Boolean).length === 2);
  a.send({ type: 'start', fillBots: true });
  const end = await a.until(m => m.game && m.game.phase === 'over', 60000);
  assert.strictEqual(end.game.result.place.length, 4);
  assert.strictEqual(end.wins.reduce((s, x) => s + x, 0), 1);
  console.log('čovječe online ok: pobjednik', end.game.players[end.game.result.winners[0]].name, 'nakon', end.game.rolls, 'bacanja');

  // istek vremena: potez se odigra automatski, igra ide dalje
  const c = client(port, 'Cvita', false), d = client(port, 'Dino', false);
  await c.open; await d.open;
  c.send({ type: 'create', mode: 2, kind: 'covjece', turnTime: 15 });
  const l2 = await c.until(m => m.code);
  d.send({ type: 'join', code: l2.code });
  await c.until(m => m.seats.every(Boolean));
  c.send({ type: 'start' });
  const st = await c.until(m => m.game && m.game.phase === 'play');
  assert(st.turnLeft > 0, 'timer teče');
  const after = await c.until(m => m.game && m.game.rolls > st.game.rolls, 5000);
  assert.notStrictEqual(after.game.phase, 'over', 'istek vremena ne završava igru');
  console.log('čovječe istek vremena ok');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
