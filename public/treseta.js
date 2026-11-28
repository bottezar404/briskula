/* Trešeta – pravila igre (dijeli se između preglednika i servera)
 *
 * Bodovi se broje u "belama" (trećinama boda): as = 3 bele (1 bod),
 * trica, dvica, kralj, konj i fanat = 1 bela, zadnji štih = 3 bele (1 bod).
 * Na kraju ruke bele se dijele s 3 i ostatak se odbacuje, pa ruka vrijedi 11 bodova
 * (u troje 10 ili 11). Akuže (napolitana, tri/četiri trice, dvice ili asa)
 * dodaju se cijelim bodovima. Igra se do zadanog broja bodova (zadano 41).
 *
 * "Chi fa meno" (opts.low): cilj je skupiti što MANJE bodova. Nema akuža.
 * Tko u jednoj ruci pokupi sve bodove (kapot), dobije 0, a svi ostali po 11.
 * Partija završava kad netko dođe do cilja; pobjeđuje tko tada ima najmanje.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TresetaEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['kupe', 'dinari', 'spade', 'bate'];
  const RANKS = [1, 2, 3, 4, 5, 6, 7, 11, 12, 13];
  // jačina: trica, dvica, as, kralj, konj, fanat, 7, 6, 5, 4
  const STRENGTH = { 3: 10, 2: 9, 1: 8, 13: 7, 12: 6, 11: 5, 7: 4, 6: 3, 5: 2, 4: 1 };
  const BELE = { 1: 3, 3: 1, 2: 1, 13: 1, 12: 1, 11: 1 };
  const LAST_BELE = 3;
  const TARGETS = [21, 31, 41];
  const SUIT_IN = { kupe: 'u kupama', dinari: 'u dinarima', spade: 'u špadama', bate: 'u batama' };
  const SUIT_GEN = { kupe: 'kupa', dinari: 'dinara', spade: 'špada', bate: 'bata' };
  const RANK_PL = { 3: ['tri trice', 'četiri trice'], 2: ['tri dvice', 'četiri dvice'], 1: ['tri asa', 'četiri asa'] };

  function card(suit, rank) { return suit + '-' + rank; }
  // tablica svih karata: bot u jednom potezu ove funkcije zove stotine tisuća puta,
  // pa se boja/broj ne smiju svaki put računati iz teksta (split je bio glavni trošak)
  const INFO = Object.create(null);
  for (const s of SUITS) for (const r of RANKS) INFO[card(s, r)] = { s, r, b: BELE[r] || 0, k: STRENGTH[r] };
  function info(c) {
    return INFO[c] || { s: c.split('-')[0], r: +c.split('-')[1], b: BELE[+c.split('-')[1]] || 0, k: STRENGTH[+c.split('-')[1]] };
  }
  function suitOf(c) { return info(c).s; }
  function rankOf(c) { return info(c).r; }
  function bele(c) { return info(c).b; }
  function strength(c) { return info(c).k; }
  // za zajedničko sučelje s briškulom: "bodovi" karte u belama
  const points = bele;

  /** bele -> tekst, npr. 11 -> "3⅔" */
  function fmt(b) {
    const w = Math.floor(b / 3), r = b % 3;
    return r ? (w ? w : '') + (r === 1 ? '⅓' : '⅔') : String(w);
  }

  const FULL = Object.keys(INFO);
  // u troje se izbacuje četvorka dinara (39 karata, 13 svakome)
  const DECK3 = FULL.filter(c => c !== 'dinari-4');
  function fullDeck() { return FULL.slice(); }
  function deckFor(mode) { return (mode === 3 ? DECK3 : FULL).slice(); }

  // kriptografski slučajni brojevi (preglednik i Node 18+); Math.random samo kao rezerva
  const RNG = (function () {
    const c = typeof globalThis !== 'undefined' && globalThis.crypto;
    if (!c || typeof c.getRandomValues !== 'function') return Math.random;
    const buf = new Uint32Array(2);
    return function () { c.getRandomValues(buf); return (buf[0] * 2097152 + (buf[1] >>> 11)) / 9007199254740992; };
  })();

  function shuffle(arr, rng) {
    rng = rng || RNG;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** Pobjednik štiha: najjača karta boje koja je prva bačena (nema aduta). */
  function trickWinnerIndex(trick) {
    const s = suitOf(trick[0].card);
    let best = 0;
    for (let i = 1; i < trick.length; i++) {
      const c = trick[i].card;
      if (suitOf(c) === s && strength(c) > strength(trick[best].card)) best = i;
    }
    return best;
  }
  function beats(a, b) { return suitOf(a) === suitOf(b) && strength(a) > strength(b); }

  function teamOf(mode, p) { return mode === 4 ? p % 2 : p; }
  function teamCount(mode) { return mode === 4 ? 2 : mode; }
  function teamPlayers(mode, t) { return mode === 4 ? [t, t + 2] : [t]; }

  /** Karte koje se smiju baciti: mora se odgovoriti na boju ako se ima. */
  function legalCards(hand, trick) {
    if (!trick.length) return hand.slice();
    const s = suitOf(trick[0].card);
    const same = hand.filter(c => suitOf(c) === s);
    return same.length ? same : hand.slice();
  }

  /** Akuže u ruci: napolitana (trica, dvica i as iste boje) = 3 boda,
   *  tri trice/dvice/asa = 3 boda, sve četiri = 4 boda. */
  function findAkuze(hand) {
    const out = [];
    for (const s of SUITS) {
      const cs = [3, 2, 1].map(r => card(s, r));
      if (cs.every(c => hand.includes(c))) out.push({ kind: 'napolitana', text: 'napolitana ' + SUIT_IN[s], pts: 3, cards: cs });
    }
    for (const r of [3, 2, 1]) {
      const cs = SUITS.map(s => card(s, r)).filter(c => hand.includes(c));
      if (cs.length === 4) out.push({ kind: 'four', text: RANK_PL[r][1], pts: 4, cards: cs });
      else if (cs.length === 3) {
        const miss = SUITS.find(s => !hand.includes(card(s, r)));
        out.push({ kind: 'three', text: RANK_PL[r][0] + ' (bez ' + SUIT_GEN[miss] + ')', pts: 3, cards: cs });
      }
    }
    return out;
  }

  /**
   * mode: 2, 3 ili 4 (4 = parovi, suigrači nasuprot: 0+2 protiv 1+3)
   * opts: { names:[], bots:[bool], dealer, rng, target (21/31/41), akuze (true), low }
   */
  function newGame(mode, opts) {
    opts = opts || {};
    if (![2, 3, 4].includes(mode)) throw new Error('Neispravan način igre');
    const players = [];
    for (let p = 0; p < mode; p++) {
      players.push({ name: (opts.names && opts.names[p]) || ('Igrač ' + (p + 1)), bot: !!(opts.bots && opts.bots[p]), hand: [], won: [], bele: 0 });
    }
    const st = {
      kind: 'treseta', mode, players,
      target: TARGETS.includes(+opts.target) ? +opts.target : 41,
      low: !!opts.low,
      akuzeOn: opts.akuze !== false && !opts.low,
      score: Array(teamCount(mode)).fill(0),
      hands: [], handNo: 0,
      dealer: opts.dealer != null ? ((opts.dealer % mode) + mode) % mode : Math.floor((opts.rng || RNG)() * mode),
      rng: null, result: null, handResult: null,
    };
    Object.defineProperty(st, 'rng', { value: opts.rng || null, enumerable: false, writable: true });
    deal(st, true);
    return st;
  }

  function deal(st, firstHand) {
    const mode = st.mode;
    if (!firstHand) st.dealer = (st.dealer + 1) % mode;
    const deck = shuffle(deckFor(mode), st.rng || undefined);
    const per = mode === 3 ? 13 : 10;
    const first = (st.dealer + 1) % mode;
    for (const pl of st.players) { pl.hand = []; pl.won = []; pl.bele = 0; }
    for (let k = 0; k < per; k++) for (let i = 0; i < mode; i++) st.players[(first + i) % mode].hand.push(deck.pop());
    st.deck = deck; // u dvoje ostaje 20 karata za vučenje
    st.handNo++;
    st.leader = first; st.turn = first;
    st.trick = []; st.lastTrick = null; st.lastDraw = null; st.trickNo = 0;
    st.voids = st.players.map(() => []);
    st.known = st.players.map(() => []); // karte koje su svi vidjeli (akuže, izvučene karte)
    st.akuze = [];
    if (st.akuzeOn) {
      for (let p = 0; p < mode; p++) {
        for (const a of findAkuze(st.players[p].hand)) {
          st.akuze.push({ p, kind: a.kind, text: a.text, pts: a.pts, cards: a.cards });
          for (const c of a.cards) if (!st.known[p].includes(c)) st.known[p].push(c);
        }
      }
    }
    st.handResult = null;
    st.phase = 'play'; // play | collect | hand (kraj ruke) | over
  }

  function canPlay(st, p, c) {
    if (st.phase !== 'play' || st.turn !== p) return false;
    const h = st.players[p].hand;
    return h.includes(c) && legalCards(h, st.trick).includes(c);
  }

  function play(st, p, c) {
    if (!canPlay(st, p, c)) return false;
    const h = st.players[p].hand;
    if (st.trick.length) {
      const s = suitOf(st.trick[0].card);
      if (suitOf(c) !== s && !st.voids[p].includes(s)) st.voids[p].push(s);
    }
    h.splice(h.indexOf(c), 1);
    const k = st.known[p].indexOf(c); if (k >= 0) st.known[p].splice(k, 1);
    st.trick.push({ p, card: c });
    if (st.trick.length === st.mode) st.phase = 'collect';
    else st.turn = (st.turn + 1) % st.mode;
    return true;
  }

  function collect(st) {
    if (st.phase !== 'collect') return false;
    const wi = trickWinnerIndex(st.trick);
    const winner = st.trick[wi].p;
    let b = st.trick.reduce((s, t) => s + bele(t.card), 0);
    const pw = st.players[winner];
    pw.won.push(...st.trick.map(t => t.card));
    st.trickNo++;
    const handsEmpty = st.players.every(pl => pl.hand.length === 0);
    const last = handsEmpty && st.deck.length === 0;
    if (last) b += LAST_BELE;
    pw.bele += b;
    st.lastTrick = { cards: st.trick.slice(), winner, points: b, last };
    st.trick = [];
    st.lastDraw = null;
    // u dvoje: nakon štiha svatko vuče jednu kartu (prvi pobjednik) i pokaže je
    if (st.deck.length) {
      st.lastDraw = [];
      for (let i = 0; i < st.mode && st.deck.length; i++) {
        const q = (winner + i) % st.mode;
        const c = st.deck.pop();
        st.players[q].hand.push(c);
        st.known[q].push(c);
        st.lastDraw.push({ p: q, card: c });
      }
    }
    st.leader = winner; st.turn = winner;
    if (last) endHand(st, winner);
    else st.phase = 'play';
    return true;
  }

  function endHand(st, lastWinner) {
    const n = teamCount(st.mode);
    const teams = [];
    for (let t = 0; t < n; t++) {
      const ps = teamPlayers(st.mode, t);
      const cardBele = ps.reduce((s, p) => s + st.players[p].bele, 0) - (ps.includes(lastWinner) ? LAST_BELE : 0);
      const ak = st.akuze.filter(a => teamOf(st.mode, a.p) === t);
      const akPts = ak.reduce((s, a) => s + a.pts, 0);
      const last = ps.includes(lastWinner);
      const pts = Math.floor((cardBele + (last ? LAST_BELE : 0)) / 3) + akPts;
      teams.push({ team: t, players: ps, cardBele, last, akuze: ak.map(a => ({ p: a.p, text: a.text, pts: a.pts })), akPts, points: pts });
    }
    if (st.low) {
      // kapot: jedna strana pokupila sve bodove -> ona 0, ostali po 11
      const all = teams.reduce((a, t) => a + t.cardBele + (t.last ? LAST_BELE : 0), 0);
      const k = teams.find(t => t.cardBele + (t.last ? LAST_BELE : 0) === all);
      if (k) teams.forEach(t => { t.kapot = t === k; t.points = t === k ? 0 : 11; });
    }
    teams.forEach(t => { st.score[t.team] += t.points; t.total = st.score[t.team]; });
    st.handResult = { handNo: st.handNo, teams };
    st.hands.push({ handNo: st.handNo, points: teams.map(t => t.points), score: st.score.slice() });
    const max = Math.max(...st.score);
    const best = st.low ? Math.min(...st.score) : max;
    const top = st.score.map((s, t) => s === best ? t : -1).filter(t => t >= 0);
    if (max >= st.target && top.length === 1) {
      st.phase = 'over';
      st.result = {
        scores: st.score.map((s, t) => ({ team: t, players: teamPlayers(st.mode, t), points: s })),
        winners: teamPlayers(st.mode, top[0]), draw: false, hands: st.hands.slice(), target: st.target, low: st.low,
      };
    } else st.phase = 'hand'; // nitko još nije došao do cilja (ili je izjednačeno): nova ruka
  }

  /** Nova ruka (poziva se kad je phase === 'hand'). */
  function nextHand(st) {
    if (st.phase !== 'hand') return false;
    deal(st, false);
    return true;
  }

  function playerPoints(st, p) { return st.players[p].bele; }

  /** Ono što igrač p smije vidjeti. */
  function viewFor(st, p) {
    return {
      kind: 'treseta', mode: st.mode, you: p, low: !!st.low,
      players: st.players.map((pl, i) => ({
        name: pl.name, bot: pl.bot, handCount: pl.hand.length, team: teamOf(st.mode, i),
        wonCount: pl.won.length / st.mode, points: pl.bele,
      })),
      hand: p >= 0 ? st.players[p].hand.slice() : [],
      partnerHand: null,
      trick: st.trick.slice(),
      lastTrick: st.lastTrick,
      lastDraw: st.lastDraw,
      trump: null, trumpSuit: null, trumpInDeck: false,
      deckCount: st.deck.length,
      known: st.known.map((k, i) => i === p ? [] : k.slice()),
      voids: st.voids.map(v => v.slice()),
      akuze: st.akuze.map(a => ({ p: a.p, text: a.text, pts: a.pts, cards: a.cards.slice() })),
      turn: st.turn, leader: st.leader, phase: st.phase, trickNo: st.trickNo,
      played: st.players.reduce((a, pl) => a.concat(pl.won), []),
      score: st.score.slice(), target: st.target, handNo: st.handNo, hands: st.hands.slice(),
      handResult: st.handResult, result: st.result,
    };
  }

  return {
    SUITS, RANKS, STRENGTH, BELE, LAST_BELE, TARGETS,
    suitOf, rankOf, bele, points, strength, fmt, fullDeck, deckFor, shuffle, RNG,
    trickWinnerIndex, beats, teamOf, teamCount, teamPlayers, legalCards, findAkuze,
    newGame, canPlay, play, collect, nextHand, viewFor, playerPoints,
  };
});
