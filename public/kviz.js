/* Kviz „Znalac” – pravila (dijeli se između preglednika i servera)
 *
 * Svi igrači odgovaraju na ista pitanja u isto vrijeme (nema reda poteza).
 * Partija: 3 runde po 5 pitanja. Runde 1 i 2 imaju svaka svoju kategoriju,
 * runda 3 je finale s pitanjima iz ostalih kategorija i dvostrukim bodovima.
 *
 * Svako pitanje ima 4 ponuđena odgovora i traje QTIME ms. Točan odgovor donosi
 * 500–1000 bodova: što brže, to više (1000 odmah, 500 u zadnji tren). Krivi ili
 * nikakav odgovor 0. Bodovi se pribrajaju tek kad se pitanje zatvori (da se ne vidi
 * tko je pogodio dok drugi još razmišljaju).
 *
 * Faze: 'collect' + stage 'intro' (najava runde) → 'play' (pitanje otvoreno) →
 * 'collect' + stage 'reveal' (točan odgovor i tko je što odabrao) → … → 'over'.
 * Koliko traje pauza u 'collect', piše u g.wait (ms); poslužitelj/preglednik
 * nakon toga zove collect(g).
 * Potez je 'a:N' (odgovor N, 0–3) ili 't:tekst' (pitanja na pisanje). Vrijeme se mjeri u
 * play() (Date.now() ili opts.clock).
 *
 * Pitanja na pisanje (type 'w'): u svakoj rundi jedno, traju WTIME. Odgovor se uspoređuje
 * bez obzira na velika/mala slova, kvačice (č→c, đ→d…), razmake i interpunkciju, a prašta
 * se i sitna greška u tipkanju (1 slovo za kraće riječi, 2 za duže; brojevi moraju biti točni).
 *
 * Stalne sobe (endless): newEndless(cat) – igrači ulaze i izlaze kad hoće (addPlayer /
 * removePlayer), pitanja idu u krugovima po KRUG pitanja; na kraju kruga je poredak
 * (stage 'board'), pa novi krug s bodovima od nule.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./kviz-pitanja.js'));
  else root.KvizEngine = factory(root.KvizPitanja);
})(typeof self !== 'undefined' ? self : this, function (KP) {
  'use strict';

  const QTIME = 15000, WTIME = 22000, ROUNDS = 3, PER_ROUND = 5, WRITE_PER_ROUND = 1, GRACE = 600;
  const KRUG = 10, KRUG_WRITE = 2, MAX_ANS = 40;
  const PAUSE = { intro: 2800, reveal: 4200, board: 9000 };
  const NAME = 'Znalac';
  const CATS = KP.CATS, BANK = KP.ALL;
  const catOf = id => CATS.find(c => c.id === id) || { id, name: id, icon: '❓' };

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // bodovi za točan odgovor nakon t ms (zaokruženo na 10)
  function pointsFor(t, qTime, mult) {
    const f = Math.max(0, Math.min(1, 1 - t / qTime));
    return Math.round((500 + 500 * f) / 10) * 10 * (mult || 1);
  }

  // ---------- provjera odgovora na pisanje ----------
  const norm = t => String(t == null ? '' : t).toLowerCase().replace(/đ/g, 'd').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  function lev(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  /** je li upisani tekst točan odgovor (accept = popis prihvaćenih oblika) */
  function matchText(accept, text) {
    const t = norm(text);
    if (!t) return false;
    const tc = t.replace(/ /g, '');
    return accept.some(a => {
      const n = norm(a);
      if (!n) return false;
      if (t === n || tc === n.replace(/ /g, '')) return true;
      if (/\d/.test(n)) return false; // brojevi i godine moraju biti točni
      const tol = n.length <= 3 ? 0 : n.length <= 6 ? 1 : 2;
      return lev(tc, n.replace(/ /g, '')) <= tol;
    });
  }
  const cleanAns = t => String(t || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_ANS);

  /** n pitanja iz skupa: najprije ona koja se nisu nedavno pojavila */
  function taker(rng, exclude) {
    const ex = new Set(exclude || []);
    const used = new Set();
    return (pool, n) => {
      const a = shuffle(pool.filter(q => !used.has(q.id)), rng);
      const out = a.filter(q => !ex.has(q.id)).concat(a.filter(q => ex.has(q.id))).slice(0, n);
      out.forEach(q => used.add(q.id));
      return out;
    };
  }
  const isW = q => q.type === 'w';
  // pitanja jedne skupine: n ukupno, od toga w na pisanje (na nasumičnom mjestu, ne na prvom)
  function mixRound(take, pool, n, w, rng) {
    const ws = take(pool.filter(isW), w);
    const mc = take(pool.filter(q => !isW(q)), n - ws.length);
    const out = mc.slice();
    for (const q of ws) out.splice(1 + Math.floor(rng() * out.length), 0, q);
    return out;
  }

  /** odabir pitanja: rounds = [{ cat, mult, qs: [pitanje...] }] */
  function pickQuestions(rng, exclude, bank) {
    bank = bank || BANK;
    const take = taker(rng, exclude);
    const cats = shuffle(CATS.map(c => c.id).filter(c => bank.some(q => q.cat === c)), rng);
    const rounds = [];
    for (let r = 0; r < ROUNDS - 1; r++) rounds.push({ cat: cats[r], mult: 1, qs: mixRound(take, bank.filter(q => q.cat === cats[r]), PER_ROUND, WRITE_PER_ROUND, rng) });
    // finale: po jedno pitanje iz različitih ostalih kategorija (jedno od njih na pisanje)
    const rest = shuffle(cats.slice(ROUNDS - 1), rng);
    const fin = [];
    for (let k = 0; fin.length < PER_ROUND - WRITE_PER_ROUND && k < rest.length * PER_ROUND; k++) fin.push(...take(bank.filter(q => q.cat === rest[k % rest.length] && !isW(q)), 1));
    for (const q of take(bank.filter(q => isW(q) && rest.includes(q.cat)), WRITE_PER_ROUND)) fin.splice(1 + Math.floor(rng() * fin.length), 0, q);
    rounds.push({ cat: 'mix', mult: 2, qs: fin });
    return rounds;
  }
  // pitanje za igru: ponuđeni odgovori izmiješani (ans = indeks točnog), ili na pisanje
  function makeQ(q, rng, round, k, mult) {
    const base = { id: q.id, cat: q.cat, text: q.text, round, k, mult };
    if (isW(q)) return Object.assign(base, { type: 'w', answer: q.answer, accept: q.accept.slice(), opts: null, ans: -1, time: WTIME });
    const order = shuffle([0, 1, 2, 3], rng);
    return Object.assign(base, { type: 'c', opts: order.map(i => q.opts[i]), ans: order.indexOf(0), time: QTIME });
  }

  function newGame(mode, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const names = opts.names || [];
    const rounds = pickQuestions(rng, opts.exclude, opts.bank);
    const qs = [];
    rounds.forEach((r, ri) => r.qs.forEach((q, k) => qs.push(makeQ(q, rng, ri, k, r.mult))));
    const players = Array.from({ length: mode }, (_, i) => ({
      name: names[i] || 'Igrač ' + (i + 1), bot: !!(opts.bots && opts.bots[i]),
      score: 0, correct: 0, time: 0, streak: 0, best: 0, ans: null,
    }));
    return {
      kind: 'kviz', mode, players, qs, rounds: rounds.map(r => ({ cat: r.cat, mult: r.mult, n: r.qs.length })),
      qi: 0, phase: 'collect', stage: 'intro', wait: PAUSE.intro, qStart: 0, qEnd: 0,
      qScale: opts.qTime ? opts.qTime / QTIME : 1, qTime: opts.qTime || QTIME, clock: opts.clock || Date.now,
      // polja koja očekuje ostatak aplikacije (zajednička za sve igre)
      turn: -1, trick: [], trickNo: 0, dealer: opts.dealer || 0, result: null, last: null,
    };
  }

  function startQuestion(g) {
    const now = g.clock();
    g.phase = 'play'; g.stage = 'q'; g.wait = 0;
    g.qTime = Math.round((g.qs[g.qi].time || QTIME) * (g.qScale || 1));
    g.qStart = now; g.qEnd = now + g.qTime;
    g.players.forEach(pl => { pl.ans = null; });
    g.trickNo++;
  }

  /** odgovor igrača p: 'a:N' */
  function play(g, p, move, now) {
    if (!g || g.phase !== 'play') return false;
    const pl = g.players[p];
    if (!pl || pl.ans) return false;
    const q = g.qs[g.qi];
    move = String(move);
    let c, ok;
    if (q.type === 'w') {
      if (!move.startsWith('t:')) return false;
      c = cleanAns(move.slice(2));
      if (!c) return false;
      ok = matchText(q.accept, c);
    } else {
      const m = /^a:([0-3])$/.exec(move);
      if (!m) return false;
      c = +m[1]; ok = c === q.ans;
    }
    now = now == null ? g.clock() : now;
    if (now > g.qEnd + GRACE) return false;
    const t = Math.max(0, Math.min(g.qTime, now - g.qStart));
    pl.ans = { c, t, ok, pts: ok ? pointsFor(t, g.qTime, q.mult) : 0 };
    if (g.players.every(x => x.ans)) reveal(g);
    return true;
  }

  /** vrijeme za pitanje je isteklo: tko nije odgovorio, dobiva 0 */
  function timeUp(g) {
    if (!g || g.phase !== 'play') return false;
    reveal(g);
    return true;
  }

  function reveal(g) {
    const q = g.qs[g.qi];
    let fast = -1;
    g.players.forEach((pl, i) => {
      pl.seen = (pl.seen || 0) + 1;
      if (pl.ans) pl.answered = (pl.answered || 0) + 1;
      if (pl.ans && pl.ans.ok) {
        pl.score += pl.ans.pts; pl.correct++; pl.time += pl.ans.t;
        pl.streak++; pl.best = Math.max(pl.best, pl.streak);
        if (fast < 0 || pl.ans.t < g.players[fast].ans.t) fast = i;
      } else pl.streak = 0;
    });
    g.last = { qi: g.qi, ans: q.ans, fast };
    g.phase = 'collect'; g.stage = 'reveal'; g.wait = PAUSE.reveal;
  }

  /** nakon pauze: sljedeće pitanje, najava nove runde ili kraj */
  function collect(g) {
    if (!g || g.phase !== 'collect') return false;
    if (g.stage === 'intro') { startQuestion(g); return true; }
    if (g.stage === 'board') { newKrug(g); return true; }
    const prev = g.qs[g.qi];
    g.qi++;
    if (g.qi >= g.qs.length) { if (g.endless) endKrug(g); else finish(g); return true; }
    if (g.qs[g.qi].round !== prev.round) { g.stage = 'intro'; g.wait = PAUSE.intro; g.players.forEach(pl => { pl.ans = null; }); return true; }
    startQuestion(g);
    return true;
  }

  // poredak: bodovi, pa broj točnih, pa ukupno vrijeme točnih odgovora (brži je bolji)
  const cmp = (a, b) => b.score - a.score || b.correct - a.correct || a.time - b.time;
  function standings(g) {
    return g.players.map((pl, i) => ({ p: i, score: pl.score, correct: pl.correct, time: pl.time })).sort(cmp);
  }

  function finish(g) {
    const st = standings(g);
    const place = st.map(x => x.p);
    const draw = st.length > 1 && cmp(st[0], st[1]) === 0;
    g.phase = 'over'; g.stage = 'over'; g.wait = 0;
    g.players.forEach(pl => { pl.ans = null; });
    g.result = {
      winners: draw ? st.filter(x => cmp(x, st[0]) === 0).map(x => x.p) : [place[0]], draw, place,
      scores: g.players.map((pl, i) => ({ team: i, players: [i], points: pl.score, correct: pl.correct, time: pl.time, best: pl.best })),
      total: g.qs.length, hands: [],
    };
  }
  function nextHand() { return false; }

  function legal(g, p) {
    if (g.phase !== 'play' || !g.players[p] || g.players[p].ans) return [];
    return g.qs[g.qi].type === 'w' ? ['t'] : ['a:0', 'a:1', 'a:2', 'a:3'];
  }

  // ---------- stalne sobe: igrači dolaze i odlaze, krugovi od KRUG pitanja ----------
  function newEndless(cat, opts) {
    opts = opts || {};
    const g = newGame(0, { rng: opts.rng, clock: opts.clock, qTime: opts.qTime, bank: [] });
    Object.assign(g, { endless: true, cat, krugNo: 0, recent: [], rng: opts.rng || Math.random, bank: opts.bank || BANK, phase: 'idle', stage: 'idle' });
    return g;
  }
  function newPlayer(name, bot) { return { name, bot: !!bot, score: 0, correct: 0, time: 0, streak: 0, best: 0, ans: null, seen: 0, answered: 0 }; }
  function addPlayer(g, name) { g.players.push(newPlayer(name)); g.mode = g.players.length; return g.players.length - 1; }
  function removePlayer(g, p) {
    if (!g.players[p]) return;
    g.players.splice(p, 1); g.mode = g.players.length;
    if (g.last && g.last.fast >= 0) g.last.fast = g.last.fast === p ? -1 : g.last.fast > p ? g.last.fast - 1 : g.last.fast;
    if (g.phase === 'play' && g.players.length && g.players.every(x => x.ans)) reveal(g);
  }
  /** novi krug: bodovi od nule, nova pitanja (cat 'mix' = sve kategorije) */
  function newKrug(g) {
    const rng = g.rng, take = taker(rng, g.recent);
    const pool = g.cat === 'mix' ? g.bank : g.bank.filter(q => q.cat === g.cat);
    let qs;
    if (g.cat === 'mix') {
      // miješano: kategorije se izmjenjuju
      const cats = shuffle(CATS.map(c => c.id), rng), mc = [];
      for (let k = 0; mc.length < KRUG - KRUG_WRITE && k < KRUG * cats.length; k++) mc.push(...take(pool.filter(q => q.cat === cats[k % cats.length] && !isW(q)), 1));
      qs = mc;
      for (const q of take(pool.filter(isW), KRUG_WRITE)) qs.splice(1 + Math.floor(rng() * qs.length), 0, q);
    } else qs = mixRound(take, pool, KRUG, KRUG_WRITE, rng);
    g.krugNo++;
    g.qs = qs.map((q, k) => makeQ(q, rng, 0, k, 1));
    g.rounds = [{ cat: g.cat, mult: 1, n: g.qs.length }];
    g.recent = g.recent.concat(g.qs.map(q => q.id)).slice(-Math.floor(pool.length * 0.7));
    g.qi = 0; g.last = null; g.result = null;
    g.players.forEach(pl => Object.assign(pl, newPlayer(pl.name, pl.bot)));
    g.phase = 'collect'; g.stage = 'intro'; g.wait = PAUSE.intro;
  }
  function endKrug(g) {
    const st = standings(g);
    g.phase = 'collect'; g.stage = 'board'; g.wait = PAUSE.board;
    g.players.forEach(pl => { pl.ans = null; });
    g.result = {
      krug: g.krugNo, total: g.qs.length, place: st.map(x => x.p),
      winners: st.length && st[0].score > 0 ? st.filter(x => cmp(x, st[0]) === 0).map(x => x.p) : [],
      scores: g.players.map((pl, i) => ({ team: i, players: [i], points: pl.score, correct: pl.correct, time: pl.time, best: pl.best, seen: pl.seen, answered: pl.answered })),
    };
  }
  /** soba ostala bez igrača: stani (sljedeći igrač pokreće novi krug) */
  function pause(g) { g.phase = 'idle'; g.stage = 'idle'; g.wait = 0; g.players = []; g.mode = 0; }

  /** prikaz za igrača p: točan odgovor i tuđi odgovori vide se tek nakon zatvaranja pitanja */
  function viewFor(g, p, now) {
    now = now == null ? g.clock() : now;
    const q = g.qs[g.qi];
    const open = g.phase === 'play';
    const showQ = q && (g.phase === 'play' || (g.phase === 'collect' && g.stage === 'reveal'));
    const rnd = q ? g.rounds[q.round] : null;
    return {
      kind: 'kviz', mode: g.mode, you: p, phase: g.phase, stage: g.stage, wait: g.wait,
      players: g.players.map((pl, i) => ({
        name: pl.name, bot: pl.bot, score: pl.score, correct: pl.correct, streak: pl.streak, best: pl.best,
        done: !!pl.ans,
        ans: !pl.ans ? null : open ? (i === p ? { c: pl.ans.c } : null) : { c: pl.ans.c, t: pl.ans.t, ok: pl.ans.ok, pts: pl.ans.pts },
        seen: pl.seen || 0,
      })),
      qi: g.qi, total: g.qs.length, perRound: PER_ROUND, rounds: g.rounds,
      round: q ? q.round : ROUNDS - 1, k: q ? q.k : 0, mult: q ? q.mult : 1, cat: rnd ? rnd.cat : null, qcat: q ? q.cat : null,
      q: showQ ? { text: q.text, type: q.type || 'c', opts: q.opts ? q.opts.slice() : null, ans: open ? null : q.ans, answer: open ? null : q.answer || null, cat: q.cat } : null,
      endless: !!g.endless, krugNo: g.krugNo || 0, roomCat: g.endless ? g.cat : null,
      qTime: g.qTime, qLeft: open ? Math.max(0, g.qEnd - now) : 0,
      last: g.last && !open ? g.last : null,
      turn: -1, trick: [], trickNo: g.trickNo, dealer: g.dealer, result: g.result,
      legal: legal(g, p),
    };
  }

  return { NAME, QTIME, WTIME, ROUNDS, PER_ROUND, KRUG, GRACE, PAUSE, MAX_ANS, CATS, BANK, catOf, pointsFor, norm, matchText, pickQuestions, newGame, play, timeUp, collect, nextHand, legal, viewFor, standings,
    newEndless, addPlayer, removePlayer, newKrug, pause };
});
