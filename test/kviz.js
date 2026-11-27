// Kviz Znalac: bodovanje po brzini, skrivanje točnog odgovora, runde i finale, poredak,
// botovi, i online partija preko servera (istodobni odgovori, istek vremena).
'use strict';
process.env.PORT = 0; process.env.BRK_PACE_SCALE = '0.02';
process.env.BRK_DATA_FILE = ':memory:'; process.env.DATABASE_URL = '';
const assert = require('assert');
const K = require('../public/kviz.js');
const KB = require('../public/kviz-bot.js');
const KP = require('../public/kviz-pitanja.js');

{ // banka pitanja: dosta pitanja, 4 različita odgovora, oznake jedinstvene
  assert(KP.ALL.length >= 300, 'barem 300 pitanja');
  const ids = new Set();
  for (const q of KP.ALL) {
    assert(!ids.has(q.id)); ids.add(q.id);
    assert(q.text.length > 8 && q.text.length < 120, 'duljina pitanja: ' + q.text);
    if (q.type === 'w') { assert(q.accept.length >= 1 && q.accept[0] === q.answer); assert(K.matchText(q.accept, q.answer), 'točan odgovor prolazi: ' + q.text); continue; }
    assert.strictEqual(q.opts.length, 4, 'četiri odgovora: ' + q.text);
    assert.strictEqual(new Set(q.opts.map(o => o.toLowerCase())).size, 4, 'odgovori se razlikuju: ' + q.text);
  }
  for (const c of KP.CATS) {
    assert(KP.ALL.filter(q => q.cat === c.id && q.type !== 'w').length >= 40, 'dosta pitanja u kategoriji ' + c.name);
    assert(KP.ALL.filter(q => q.cat === c.id && q.type === 'w').length >= 12, 'dosta pitanja na pisanje: ' + c.name);
  }
  { // pitanja sa slikama: svaka slika postoji, sve ili nijedna opcija je slika, svaka slika ima ime
    const KS = require('../public/kviz-slike.js');
    let n = 0;
    for (const q of KP.ALL) {
      if (q.type === 'w') { assert(!String(q.answer).startsWith('#'), 'slika u pitanju na pisanje: ' + q.text); continue; }
      const im = q.opts.filter(o => /^#[a-z]/.test(o));
      if (!im.length) continue;
      n++;
      assert.strictEqual(im.length, 4, 'sve četiri opcije su slike: ' + q.text);
      for (const o of im) { assert(KS.isImg(o), 'nema slike ' + o + ': ' + q.text); assert(/^<svg viewBox/.test(KS.svg(o.slice(1)))); assert(KS.label(o) && KS.label(o) !== o, 'ime slike ' + o); }
    }
    assert(n >= 60, 'barem 60 pitanja sa slikama, ima ' + n);
    for (const id of Object.keys(KS.ALL)) assert(!/<script|on\w+=|href=/i.test(KS.svg(id)), 'čist SVG: ' + id);
  }
  const texts = new Set(); for (const q of KP.ALL) { assert(!texts.has(q.text), 'isto pitanje dvaput: ' + q.text); texts.add(q.text); }
}
{ // bodovi: 1000 odmah, 500 na kraju, finale dvostruko
  assert.strictEqual(K.pointsFor(0, 15000), 1000);
  assert.strictEqual(K.pointsFor(15000, 15000), 500);
  assert.strictEqual(K.pointsFor(7500, 15000), 750);
  assert.strictEqual(K.pointsFor(0, 15000, 2), 2000);
}
// točan / krivi potez za pitanje (s ponuđenim odgovorima ili na pisanje)
const right = q => q.type === 'w' ? 't:' + q.answer : 'a:' + q.ans;
const wrong = (q, k) => q.type === 'w' ? 't:krivo' + k : 'a:' + ((q.ans + k) % 4);
{ // provjera odgovora na pisanje
  const ok = (acc, t) => K.matchText(acc, t);
  assert(ok(['Pariz', 'Paris'], 'pariz')); assert(ok(['Pariz'], '  PARIZ! ')); assert(ok(['Pariz'], 'Parizz'), 'sitna greška');
  assert(ok(['Mihail Gorbačov', 'Gorbačov'], 'gorbacov'), 'bez kvačica'); assert(ok(['Đakovo'], 'dakovo'));
  assert(ok(['Južna Amerika'], 'juznaamerika'), 'bez razmaka');
  assert(!ok(['Pariz'], 'Rim')); assert(!ok(['144'], '145'), 'brojevi točno'); assert(!ok(['Ag'], 'Au'), 'kratki odgovori točno');
  assert(!ok(['Zagreb'], '')); assert(!ok(['Velebit'], 'Biokovo'));
  const g = K.newGame(2, {});
  assert.strictEqual(g.qs.filter(q => q.type === 'w').length, K.ROUNDS, 'po jedno pitanje na pisanje u rundi');
  assert(g.qs.every(q => q.type !== 'w' || q.k > 0), 'pitanje na pisanje nije prvo u rundi');
  g.qi = g.qs.findIndex(q => q.type === 'w'); K.collect(g); K.collect(g);
  const q = g.qs[g.qi];
  assert.strictEqual(g.qTime, K.WTIME, 'na pisanje ima više vremena');
  assert.deepStrictEqual(K.legal(g, 0), ['t']);
  assert(!K.play(g, 0, 'a:0'), 'nije izbor'); assert(!K.play(g, 0, 't:   '), 'prazno');
  assert(K.play(g, 0, 't:' + q.answer.toUpperCase())); assert(K.play(g, 1, 't:nešto sasvim krivo'));
  const v = K.viewFor(g, 1);
  assert.strictEqual(v.q.answer, q.answer); assert.strictEqual(v.players[0].ans.ok, true); assert.strictEqual(v.players[1].ans.c, 'nešto sasvim krivo');
}
{ // tijek partije sa zadanim satom
  let now = 1000;
  const g = K.newGame(3, { names: ['A', 'B', 'C'], clock: () => now });
  assert.strictEqual(g.qs.length, K.ROUNDS * K.PER_ROUND);
  assert.strictEqual(new Set(g.qs.map(q => q.id)).size, g.qs.length, 'bez ponavljanja u partiji');
  assert.strictEqual(new Set(g.qs.filter(q => q.round === 0).map(q => q.cat)).size, 1, 'runda 1 je jedna kategorija');
  assert(g.qs.filter(q => q.round === 2).every(q => q.mult === 2), 'finale nosi dvostruko');
  assert.strictEqual(g.phase, 'collect'); assert.strictEqual(g.stage, 'intro');
  assert.strictEqual(K.viewFor(g, 0).q, null, 'najava runde: pitanje se još ne vidi');
  K.collect(g);
  assert.strictEqual(g.phase, 'play');
  const q = g.qs[0];
  let v = K.viewFor(g, 0);
  assert.strictEqual(v.q.ans, null, 'točan odgovor se ne šalje dok je pitanje otvoreno');
  assert.strictEqual(v.qLeft, K.QTIME);
  now += 3000;
  assert(K.play(g, 0, right(q)));
  assert(!K.play(g, 0, right(q)), 'samo jedan odgovor');
  assert(!K.play(g, 1, 'a:7'), 'neispravan potez');
  v = K.viewFor(g, 1);
  assert.strictEqual(v.players[0].done, true); assert.strictEqual(v.players[0].ans, null, 'tuđi odgovor se ne vidi');
  assert.strictEqual(v.players[0].score, 0, 'bodovi se dodaju tek na kraju pitanja');
  assert.deepStrictEqual(K.viewFor(g, 0).players[0].ans, { c: q.ans });
  now += 2000;
  assert(K.play(g, 1, wrong(q, 1)));
  assert.strictEqual(g.phase, 'play', 'čeka se treći');
  assert(K.timeUp(g));
  assert.strictEqual(g.stage, 'reveal');
  v = K.viewFor(g, 2);
  assert.strictEqual(v.q.ans, q.ans, 'nakon pitanja se vidi točan odgovor');
  assert.strictEqual(v.players[0].score, K.pointsFor(3000, K.QTIME));
  assert.strictEqual(v.players[1].ans.ok, false); assert.strictEqual(v.players[2].ans, null);
  assert.strictEqual(v.last.fast, 0);
  // kasni odgovor se ne prima
  K.collect(g); now += K.QTIME + K.GRACE + 1;
  assert(!K.play(g, 2, 'a:0'), 'prekasno');
  // odigraj do kraja: igrač 2 uvijek točno i odmah
  let rounds = new Set();
  while (g.phase !== 'over') {
    if (g.phase === 'collect') { if (g.stage === 'intro') rounds.add(g.qs[g.qi].round); K.collect(g); continue; }
    now = g.qStart;
    K.play(g, 2, right(g.qs[g.qi]));
    K.play(g, 0, wrong(g.qs[g.qi], 1));
    K.play(g, 1, wrong(g.qs[g.qi], 2));
  }
  assert.deepStrictEqual([...rounds], [1, 2], 'najava runda 2 i 3');
  assert.deepStrictEqual(g.result.winners, [2]);
  assert.strictEqual(g.result.place[0], 2); assert.strictEqual(g.result.place[1], 0);
  assert.strictEqual(g.players[2].score, 1000 * 9 + 2000 * 5); // prvo pitanje nije odgovorio
  assert.strictEqual(g.players[2].best, 14);
}
{ // izbjegavanje nedavnih pitanja
  const g1 = K.newGame(2, {});
  const ex = g1.qs.map(q => q.id);
  for (let k = 0; k < 20; k++) { const g2 = K.newGame(2, { exclude: ex }); assert(!g2.qs.some(q => ex.includes(q.id)), 'nedavna pitanja se ne ponavljaju'); }
}
{ // isti rezultat = neriješeno; inače brži pobjeđuje
  const g = K.newGame(2, {});
  g.qi = g.qs.length - 1; g.phase = 'collect'; g.stage = 'reveal';
  g.players[0].score = g.players[1].score = 500; g.players[0].correct = g.players[1].correct = 1; g.players[0].time = g.players[1].time = 3000;
  K.collect(g);
  assert.strictEqual(g.result.draw, true);
  const h = K.newGame(2, {});
  h.qi = h.qs.length - 1; h.phase = 'collect'; h.stage = 'reveal';
  h.players[0].score = h.players[1].score = 500; h.players[0].correct = h.players[1].correct = 1; h.players[0].time = 4000; h.players[1].time = 3000;
  K.collect(h);
  assert.deepStrictEqual(h.result.winners, [1]); assert.strictEqual(h.result.draw, false);
}
{ // botovi: jači bot pogađa češće
  const rate = lv => { let ok = 0, n = 0; for (let k = 0; k < 60; k++) { const g = K.newGame(2, { names: ['Bot Jure', 'Bot Mare'] }); K.collect(g); for (let i = 0; i < 15; i++) { const p = KB.plan(g, 0, lv); assert(p.delay > 0 && p.delay < g.qTime); if (g.qs[g.qi].type === 'w' ? K.matchText(g.qs[g.qi].accept, p.move.slice(2)) : p.move === 'a:' + g.qs[g.qi].ans) ok++; n++; g.qi = (g.qi + 1) % g.qs.length; } } return ok / n; };
  const e = rate('easy'), h = rate('hard');
  assert(h > e + 0.2, `teški bot (${h.toFixed(2)}) bolji od laganog (${e.toFixed(2)})`);
  console.log('kviz pravila i botovi ok · pitanja:', KP.ALL.length, '· točnost botova lako/teško', e.toFixed(2), h.toFixed(2));
}

{ // stalna soba: igrači dolaze i odlaze, krugovi
  let now = 0;
  const g = K.newEndless('geo', { clock: () => now });
  assert.strictEqual(g.phase, 'idle');
  K.addPlayer(g, 'Ana'); K.newKrug(g);
  assert.strictEqual(g.qs.length, K.KRUG); assert(g.qs.every(q => q.cat === 'geo'), 'samo geografija');
  assert.strictEqual(g.qs.filter(q => q.type === 'w').length, 2);
  K.collect(g); assert.strictEqual(g.phase, 'play');
  K.addPlayer(g, 'Bruno');
  assert(K.play(g, 0, right(g.qs[0]))); assert.strictEqual(g.phase, 'play', 'čeka se Bruna');
  K.removePlayer(g, 1); assert.strictEqual(g.stage, 'reveal', 'Bruno izašao: svi su odgovorili');
  const first = new Set(g.qs.map(q => q.id));
  while (g.stage !== 'board') { if (g.phase === 'collect') K.collect(g); else { K.play(g, 0, right(g.qs[g.qi])); } }
  assert.strictEqual(g.result.place[0], 0); assert(g.players[0].score > 0); assert.strictEqual(g.result.scores[0].seen, K.KRUG);
  K.collect(g);
  assert.strictEqual(g.stage, 'intro'); assert.strictEqual(g.players[0].score, 0, 'novi krug od nule'); assert.strictEqual(g.krugNo, 2);
  assert(!g.qs.some(q => first.has(q.id)), 'novi krug, nova pitanja');
  const m = K.newEndless('mix'); K.addPlayer(m, 'X'); K.newKrug(m);
  assert(new Set(m.qs.map(q => q.cat)).size >= 5, 'miješano: razne kategorije');
  K.pause(m); assert.strictEqual(m.players.length, 0);
  // špil: u sobi se pitanje ne ponovi dok se ne potroše sva ostala (ni pitanja na pisanje)
  for (const cat of ['mix', ...KP.CATS.map(c => c.id)]) {
    const r = K.newEndless(cat); K.addPlayer(r, 'Y');
    const pool = KP.ALL.filter(q => cat === 'mix' || q.cat === cat);
    const nW = pool.filter(q => q.type === 'w').length, nC = pool.length - nW;
    const krugs = Math.floor(Math.min(nW / 2, cat === 'mix' ? Math.min(...KP.CATS.map(c => pool.filter(q => q.cat === c.id && q.type !== 'w').length)) : nC / 8));
    const seen = new Set();
    for (let k = 0; k < krugs; k++) {
      K.newKrug(r);
      assert.strictEqual(r.qs.length, K.KRUG);
      for (const q of r.qs) { assert(!seen.has(q.id), `${cat}: ponovljeno ${q.id} u ${k + 1}. krugu od ${krugs}`); seen.add(q.id); }
    }
    const last = new Set(r.qs.map(q => q.id));
    K.newKrug(r); K.newKrug(r);
    assert(r.qs.length === K.KRUG && !r.qs.some(q => last.has(q.id)) || cat === 'mix', cat + ': i nakon novog špila nema odmah ponavljanja');
  }
  console.log('kviz pisanje i stalne sobe ok');
}

// ---------- kviz bodovi na računu ----------
{
  const Accounts = require('../server/accounts.js');
  const docs = new Map();
  const st = { docs, ready: Promise.resolve(), isReady: () => true, kind: 'test', flush: async () => {}, get: k => docs.get(k), put: (k, v) => docs.set(k, v), del: k => docs.delete(k) };
  const A = Accounts.create(st);
  const u1 = { id: 1, uname: 'ana', name: 'Ana' }, u2 = { id: 2, uname: 'bo', name: 'Bo' }, u3 = { id: 3, uname: 'ci', name: 'Ci' };
  for (const u of [u1, u2, u3]) docs.set('user:' + u.id, u);
  assert.deepStrictEqual(A.kvizOf(u1), { pts: 0, ok: 0, n: 0, cats: {} });
  A.addKviz(u1, 900, 'geo', true); A.addKviz(u1, 0, 'geo', false); A.addKviz(u1, 700.4, 'spo', true);
  A.addKviz(u2, 1000, 'spo', true);
  A.addKviz(u3, -50, 'x<y', false); // negativno i neispravna kategorija se ne broje
  assert.deepStrictEqual(u1.kviz, { pts: 1600, ok: 2, n: 3, cats: { geo: { pts: 900, ok: 1 }, spo: { pts: 700, ok: 1 } } });
  assert.deepStrictEqual(u3.kviz, { pts: 0, ok: 0, n: 1, cats: {} });
  let t = A.kvizTop(10, null, u2);
  assert.deepStrictEqual(t.top.map(x => [x.u.uname, x.pts, x.rank]), [['ana', 1600, 1], ['bo', 1000, 2]]);
  assert.strictEqual(t.me.rank, 2); assert.strictEqual(t.players, 2);
  t = A.kvizTop(10, 'spo', u1);
  assert.deepStrictEqual(t.top.map(x => [x.u.uname, x.pts]), [['bo', 1000], ['ana', 700]]);
  assert.strictEqual(A.kvizTop(1, null, u2).top.length, 1);
  assert.strictEqual(A.kvizTop(10, null, u3).me, null, 'bez bodova nema mjesta');
  A.addKviz(u2, 900, 'spo', true); // ljestvica se osvježi bez ponovnog građenja
  assert.strictEqual(A.kvizTop(10).top[0].u.uname, 'bo');
  console.log('kviz bodovi na računu ok');
}

// ---------- online ----------
const WebSocket = require('ws');
const server = require('../server/index.js');
function client(port, name, auto) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const c = { ws, room: null, waiters: [], auto, answered: new Set() };
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.type !== 'room') return;
    c.room = m; c.waiters = c.waiters.filter(w => !w(m));
    const g = m.game;
    if (g && c.auto && g.phase === 'play' && g.legal.length && !c.answered.has(g.qi)) { c.answered.add(g.qi); c.send({ type: 'play', card: g.q.type === 'w' ? 't:nešto' : 'a:' + (g.qi % 4) }); }
  });
  c.send = m => ws.send(JSON.stringify(m));
  c.until = (f, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms || 20000); c.waiters.push(m => f(m) ? (clearTimeout(t), res(m), true) : false); });
  c.open = new Promise(r => ws.on('open', () => { c.send({ type: 'hello', name }); r(); }));
  return c;
}
(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  const port = server.address().port;
  const a = client(port, 'Ana', true), b = client(port, 'Bruno', false);
  await a.open; await b.open;
  a.send({ type: 'create', mode: 3, kind: 'kviz', low: true });
  const lobby = await a.until(m => m.code);
  assert.strictEqual(lobby.kind, 'kviz'); assert.strictEqual(lobby.low, false); assert.strictEqual(lobby.wins.length, 3, 'svatko za sebe');
  b.send({ type: 'join', code: lobby.code });
  await a.until(m => m.seats.filter(Boolean).length === 2);
  a.send({ type: 'start', fillBots: true });
  const q1 = await a.until(m => m.game && m.game.phase === 'play');
  assert.strictEqual(q1.game.q.ans, null, 'server ne šalje točan odgovor');
  assert(q1.game.qLeft > 0);
  // Bruno ne odgovara: pitanje se zatvori kad istekne vrijeme
  const rev = await b.until(m => m.game && m.game.stage === 'reveal');
  assert.strictEqual(rev.game.players[1].ans, null);
  assert(rev.game.players[0].ans && rev.game.players[2].ans, 'Ana i bot su odgovorili');
  assert(Number.isInteger(rev.game.q.ans));
  const end = await a.until(m => m.game && m.game.phase === 'over', 60000);
  assert.strictEqual(end.game.result.place.length, 3);
  assert.strictEqual(end.wins.reduce((s, x) => s + x, 0), end.game.result.draw ? 0 : 1);
  console.log('kviz online ok: pobjednik', end.game.players[end.game.result.place[0]].name, end.game.players.map(p => p.score).join(' / '));
  // nova partija u istoj sobi: druga pitanja
  const used = new Set();
  a.send({ type: 'start' });
  const g2 = await a.until(m => m.game && m.game.phase === 'play' && m.game.qi === 0);
  assert(g2.game.q.text);
  used.add(g2.game.q.text);
  a.send({ type: 'leave' });

  // stalne sobe: popis, ulazak, dva igrača odgovaraju, izlazak
  const c = client(port, 'Cvita', false), d = client(port, 'Dino', false);
  await c.open; await d.open;
  const msgOf = (cl, type, f) => new Promise(res => { const h = x => { const m = JSON.parse(x); if (m.type === type && (!f || f(m))) { cl.ws.off('message', h); res(m); } }; cl.ws.on('message', h); });
  const reg = msgOf(c, 'account', m => m.user);
  c.send({ type: 'register', uname: 'cvita_' + Date.now().toString(36), pass: 'tajna123' });
  assert.deepStrictEqual((await reg).user.kviz, { pts: 0, ok: 0, n: 0, cats: {} });
  const list = new Promise(res => c.ws.on('message', x => { const m = JSON.parse(x); if (m.type === 'kvList') res(m); }));
  c.send({ type: 'kvList' });
  const L = await list;
  assert.strictEqual(L.rooms.length, KP.CATS.length + 1); assert.strictEqual(L.rooms[0].id, 'mix');
  c.send({ type: 'join', code: 'KV-HRV' });
  const k1 = await c.until(m => m.kvRoom === 'hrv');
  assert.strictEqual(k1.seats.length, 1); assert.strictEqual(k1.you, 0);
  d.send({ type: 'join', code: 'kv-hrv' });
  await c.until(m => m.kvRoom && m.seats.length === 2);
  const q = await d.until(m => m.game && m.game.phase === 'play');
  assert.strictEqual(q.game.qcat, 'hrv'); assert.strictEqual(q.game.q.ans, null);
  c.send({ type: 'play', card: q.game.q.type === 'w' ? 't:Zagreb' : 'a:0' }); d.send({ type: 'play', card: q.game.q.type === 'w' ? 't:Split' : 'a:1' });
  const r1 = await c.until(m => m.game && m.game.stage === 'reveal');
  assert(r1.game.players.every(p => p.ans), 'oba odgovora');
  // prijavljena Cvita odmah vidi bodove na računu, gost Dino ih nema
  const myPts = r1.game.players[0].ans.ok ? r1.game.players[0].ans.pts : 0;
  assert.strictEqual(r1.seats[0].kvPts, myPts, 'bodovi s pitanja su na računu');
  assert.strictEqual(r1.seats[1].kvPts, undefined, 'gost ne skuplja');
  const top = msgOf(c, 'kvTop');
  c.send({ type: 'kvTop' });
  const T = await top;
  assert.strictEqual(T.guest, false);
  if (myPts) assert(T.me && T.me.pts === myPts && T.top.some(x => x.me));
  const topCat = msgOf(d, 'kvTop');
  d.send({ type: 'kvTop', cat: 'hrv' });
  const T2 = await topCat;
  assert.strictEqual(T2.cat, 'hrv'); assert.strictEqual(T2.guest, true); assert.strictEqual(T2.me, null);
  // gost ne vidi imena ni avatare na ljestvici, samo "Igrač 1", "Igrač 2"...
  if (myPts) assert(T2.top.length > 0, 'ljestvica nije prazna');
  assert(T2.top.every(x => !x.uname && x.name === 'Igrač ' + x.rank && !x.av.startsWith('i:')), 'gost vidi samo Igrač N');
  if (myPts) assert(T.top.some(x => x.uname && x.name === 'Cvita'), 'prijavljeni vide imena');
  c.send({ type: 'chat', text: 'bok' });
  await d.until(m => m.chat && m.chat.some(x => x.text === 'bok' && x.from === 0));
  d.send({ type: 'leave' });
  await c.until(m => m.kvRoom && m.seats.length === 1);
  assert.strictEqual(server.kvRooms.get('hrv').members.length, 1);
  c.send({ type: 'leave' });
  await new Promise(r => setTimeout(r, 200));
  assert.strictEqual(server.kvRooms.get('hrv').game.phase, 'idle', 'prazna soba miruje');
  // nakon izlaska i ulaska u drugu sobu bodovi ostaju i dalje se skupljaju
  c.send({ type: 'join', code: 'KV-GEO' });
  const k2 = await c.until(m => m.kvRoom === 'geo');
  assert.strictEqual(k2.seats[0].kvPts, myPts, 'bodovi ostaju na računu');
  const q2 = await c.until(m => m.game && m.game.phase === 'play' && m.kvRoom === 'geo');
  const acc2 = msgOf(c, 'account', m => m.user && m.user.kviz.n >= 2);
  c.send({ type: 'play', card: q2.game.q.type === 'w' ? 't:Pariz' : 'a:2' });
  const r2 = await c.until(m => m.game && m.game.stage === 'reveal' && m.kvRoom === 'geo');
  const pts2 = r2.game.players[0].ans.ok ? r2.game.players[0].ans.pts : 0;
  assert.strictEqual(r2.seats[0].kvPts, myPts + pts2);
  c.send({ type: 'leave' });
  c.send({ type: 'account' });
  const A2 = await acc2;
  assert.strictEqual(A2.user.kviz.pts, myPts + pts2); assert.strictEqual(A2.user.kviz.n, 2);
  assert.strictEqual(A2.user.kviz.cats.geo ? A2.user.kviz.cats.geo.pts : 0, pts2);
  console.log('kviz stalne sobe online ok');

  // sam/a u praznoj sobi: kraj kruga se upiše u statistiku (vježba, sekcija "botovi") s vremenom igranja i dukatima
  const e = client(port, 'Eni', true);
  await e.open;
  const regE = msgOf(e, 'account', m => m.user);
  e.send({ type: 'register', uname: 'eni_' + Date.now().toString(36), pass: 'tajna123' });
  const duk0 = (await regE).user.duk;
  const soloAcc = msgOf(e, 'account', m => m.user && m.user.stats.bots && m.user.stats.bots.kviz);
  e.send({ type: 'join', code: 'KV-HRV' });
  await e.until(m => m.kvRoom === 'hrv' && m.seats.length === 1);
  const S1 = (await soloAcc).user;
  assert.strictEqual(S1.stats.bots.kviz.p, 1, 'krug sam/a u sobi se broji');
  assert(S1.stats.bots.kviz.t > 0, 'vrijeme igranja u kviz sobi');
  assert(!S1.stats.online.kviz, 'sam/a nije online partija');
  assert(S1.duk > duk0, 'dukati za kviz sam/a');
  e.send({ type: 'leave' });
  console.log('kviz sam u sobi ok');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
