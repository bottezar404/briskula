// Pravedno dijeljenje: miješanje je ravnomjerno, karte i prvi potez su jednako raspoređeni,
// a online soba vrti djelitelja i kad se igra vrati u sobu (prije je uvijek kretao igrač na mjestu 2).
// Pokreni: node test/fair.js
'use strict';
process.env.PORT = 0; process.env.BRK_PACE_SCALE = '0.01';
const assert = require('assert');
const WebSocket = require('ws');
const E = require('../public/engine.js');
const T = require('../public/treseta.js');

// 1) miješanje: svaka karta jednako često na svakom mjestu u špilu (hi-kvadrat, df = 39*39 = 1521)
{
  const M = 40000, cnt = {};
  for (let g = 0; g < M; g++) E.shuffle(E.fullDeck()).forEach((c, i) => { (cnt[c] = cnt[c] || Array(40).fill(0))[i]++; });
  let chi = 0; const exp = M / 40;
  for (const c in cnt) for (const v of cnt[c]) chi += (v - exp) ** 2 / exp;
  assert(chi > 1300 && chi < 1750, 'miješanje nije ravnomjerno, chi2=' + chi.toFixed(0));
  console.log('miješanje ok, chi2 =', chi.toFixed(0), '(očekivano ~1521)');
}
// 2) asovi i prvi potez po mjestima (briškula i trešeta, 2/3/4 igrača)
for (const [name, Eng] of [['briškula', E], ['trešeta', T]]) for (const mode of [2, 3, 4]) {
  const N = 24000, aces = Array(mode).fill(0), lead = Array(mode).fill(0);
  let d = -1;
  for (let g = 0; g < N; g++) {
    const st = Eng.newGame(mode, { dealer: d + 1 }); d = st.dealer;
    lead[st.leader]++;
    st.players.forEach((p, i) => p.hand.forEach(c => { if (Eng.rankOf(c) === 1) aces[i]++; }));
  }
  const mean = aces.reduce((a, b) => a + b) / mode;
  aces.forEach(a => assert(Math.abs(a - mean) / mean < 0.05, `${name} ${mode}: asovi nejednako ${aces}`));
  lead.forEach(l => assert.strictEqual(l, N / mode, `${name} ${mode}: prvi potez nejednako ${lead}`));
}
console.log('asovi i prvi potez jednako raspoređeni po mjestima');

// 3) online soba: djelitelj se vrti i nakon povratka u sobu, a prvi je nasumičan
const server = require('../server/index.js');
function client(port, name) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, room: null, waiters: [] };
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.type !== 'room') return;
    c.room = m; c.waiters = c.waiters.filter(w => !w(m));
    const g = m.game;
    if (g && g.phase === 'play' && g.turn === g.you && g.trick.length < g.mode) c.send({ type: 'play', card: g.hand[0] });
  });
  c.send = m => ws.send(JSON.stringify(m));
  c.until = f => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), 15000); c.waiters.push(m => f(m) ? (clearTimeout(t), res(m), true) : false); });
  c.open = new Promise(r => ws.on('open', () => { c.send({ type: 'hello', name }); r(); }));
  return c;
}
(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  const port = server.address().port;
  // prvi potez u novoj sobi: ne smije uvijek biti isto mjesto
  const firstLead = [0, 0];
  for (let i = 0; i < 16; i++) {
    const a = client(port, 'Ana' + i), b = client(port, 'Bruno' + i);
    await a.open; await b.open;
    a.send({ type: 'create', mode: 2, turnTime: 0 });
    const lobby = await a.until(m => m.code);
    b.send({ type: 'join', code: lobby.code });
    await a.until(m => m.seats.every(s => s));
    a.send({ type: 'start' });
    const g = await a.until(m => m.game && m.game.phase === 'play');
    firstLead[g.game.turn]++;
    if (i === 0) {
      // odigraj do kraja, vrati se u sobu i ponovi: prvi potez se mora izmjenjivati
      const leads = [g.game.turn];
      for (let k = 0; k < 3; k++) {
        await a.until(m => m.game && m.game.phase === 'over');
        a.send({ type: 'toLobby' });
        await a.until(m => !m.game);
        a.send({ type: 'start' });
        const n = await a.until(m => m.game && m.game.phase === 'play' && m.game.trickNo === 0);
        leads.push(n.game.turn);
      }
      for (let k = 1; k < leads.length; k++) assert.notStrictEqual(leads[k], leads[k - 1], 'nakon povratka u sobu kreće isti igrač: ' + leads);
      console.log('povratak u sobu: prvi potez se izmjenjuje', leads.join(' '));
    }
    a.ws.close(); b.ws.close();
  }
  assert(firstLead[0] > 0 && firstLead[1] > 0, 'u novoj sobi uvijek kreće isto mjesto: ' + firstLead);
  console.log('nova soba: prvi potez po mjestima', firstLead.join(' / '));
  server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
