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
 * Potez je 'a:N' (odgovor N, 0–3). Vrijeme se mjeri u play() (Date.now() ili opts.clock).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./kviz-pitanja.js'));
  else root.KvizEngine = factory(root.KvizPitanja);
})(typeof self !== 'undefined' ? self : this, function (KP) {
  'use strict';

  const QTIME = 15000, ROUNDS = 3, PER_ROUND = 5, GRACE = 600;
  const PAUSE = { intro: 2800, reveal: 4200 };
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

  /** odabir pitanja: rounds = [{ cat, mult, qs: [pitanje...] }] */
  function pickQuestions(rng, exclude, bank) {
    bank = bank || BANK;
    const ex = new Set(exclude || []);
    const fresh = q => !ex.has(q.id);
    const used = new Set();
    const take = (pool, n) => {
      const a = shuffle(pool.filter(q => !used.has(q.id)), rng);
      // najprije pitanja koja se nisu nedavno pojavila, pa (ako ih nema dovoljno) ostala
      const out = a.filter(fresh).concat(a.filter(q => !fresh(q))).slice(0, n);
      out.forEach(q => used.add(q.id));
      return out;
    };
    const cats = shuffle(CATS.map(c => c.id).filter(c => bank.some(q => q.cat === c)), rng);
    const rounds = [];
    for (let r = 0; r < ROUNDS - 1; r++) rounds.push({ cat: cats[r], mult: 1, qs: take(bank.filter(q => q.cat === cats[r]), PER_ROUND) });
    // finale: po jedno pitanje iz različitih ostalih kategorija
    const rest = shuffle(cats.slice(ROUNDS - 1), rng);
    const fin = [];
    for (let k = 0; fin.length < PER_ROUND && k < rest.length * PER_ROUND; k++) fin.push(...take(bank.filter(q => q.cat === rest[k % rest.length]), 1));
    rounds.push({ cat: 'mix', mult: 2, qs: fin });
    return rounds;
  }

  function newGame(mode, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const names = opts.names || [];
    const rounds = pickQuestions(rng, opts.exclude, opts.bank);
    const qs = [];
    rounds.forEach((r, ri) => r.qs.forEach((q, k) => {
      // odgovori se miješaju; ans = indeks točnog
      const order = shuffle([0, 1, 2, 3], rng);
      qs.push({ id: q.id, cat: q.cat, text: q.text, opts: order.map(i => q.opts[i]), ans: order.indexOf(0), round: ri, k, mult: r.mult });
    }));
    const players = Array.from({ length: mode }, (_, i) => ({
      name: names[i] || 'Igrač ' + (i + 1), bot: !!(opts.bots && opts.bots[i]),
      score: 0, correct: 0, time: 0, streak: 0, best: 0, ans: null,
    }));
    return {
      kind: 'kviz', mode, players, qs, rounds: rounds.map(r => ({ cat: r.cat, mult: r.mult, n: r.qs.length })),
      qi: 0, phase: 'collect', stage: 'intro', wait: PAUSE.intro, qStart: 0, qEnd: 0,
      qTime: opts.qTime || QTIME, clock: opts.clock || Date.now,
      // polja koja očekuje ostatak aplikacije (zajednička za sve igre)
      turn: -1, trick: [], trickNo: 0, dealer: opts.dealer || 0, result: null, last: null,
    };
  }

  function startQuestion(g) {
    const now = g.clock();
    g.phase = 'play'; g.stage = 'q'; g.wait = 0;
    g.qStart = now; g.qEnd = now + g.qTime;
    g.players.forEach(pl => { pl.ans = null; });
    g.trickNo++;
  }

  /** odgovor igrača p: 'a:N' */
  function play(g, p, move, now) {
    if (!g || g.phase !== 'play') return false;
    const pl = g.players[p];
    if (!pl || pl.ans) return false;
    const m = /^a:([0-3])$/.exec(String(move));
    if (!m) return false;
    now = now == null ? g.clock() : now;
    if (now > g.qEnd + GRACE) return false;
    const q = g.qs[g.qi], c = +m[1];
    const t = Math.max(0, Math.min(g.qTime, now - g.qStart));
    const ok = c === q.ans;
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
    const prev = g.qs[g.qi];
    g.qi++;
    if (g.qi >= g.qs.length) { finish(g); return true; }
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
    return ['a:0', 'a:1', 'a:2', 'a:3'];
  }

  /** prikaz za igrača p: točan odgovor i tuđi odgovori vide se tek nakon zatvaranja pitanja */
  function viewFor(g, p, now) {
    now = now == null ? g.clock() : now;
    const q = g.qs[g.qi];
    const open = g.phase === 'play';
    const showQ = q && g.phase !== 'over' && !(g.phase === 'collect' && g.stage === 'intro');
    const rnd = q ? g.rounds[q.round] : null;
    return {
      kind: 'kviz', mode: g.mode, you: p, phase: g.phase, stage: g.stage, wait: g.wait,
      players: g.players.map((pl, i) => ({
        name: pl.name, bot: pl.bot, score: pl.score, correct: pl.correct, streak: pl.streak, best: pl.best,
        done: !!pl.ans,
        ans: !pl.ans ? null : open ? (i === p ? { c: pl.ans.c } : null) : { c: pl.ans.c, t: pl.ans.t, ok: pl.ans.ok, pts: pl.ans.pts },
      })),
      qi: g.qi, total: g.qs.length, perRound: PER_ROUND, rounds: g.rounds,
      round: q ? q.round : ROUNDS - 1, k: q ? q.k : 0, mult: q ? q.mult : 1, cat: rnd ? rnd.cat : null, qcat: q ? q.cat : null,
      q: showQ ? { text: q.text, opts: q.opts.slice(), ans: open ? null : q.ans, cat: q.cat } : null,
      qTime: g.qTime, qLeft: open ? Math.max(0, g.qEnd - now) : 0,
      last: g.last && !open ? g.last : null,
      turn: -1, trick: [], trickNo: g.trickNo, dealer: g.dealer, result: g.result,
      legal: legal(g, p),
    };
  }

  return { NAME, QTIME, ROUNDS, PER_ROUND, GRACE, PAUSE, CATS, BANK, catOf, pointsFor, pickQuestions, newGame, play, timeUp, collect, nextHand, legal, viewFor, standings };
});
