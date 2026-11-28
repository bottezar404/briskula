/* Poker (Texas Hold'em) s običnim špilom od 52 karte – pravila (dijeli se između preglednika i servera)
 *
 * Karte: pik ♠, herc ♥, karo ♦, tref ♣; brojevi 2–10, dečko (J), dama (Q), kralj (K), as (A).
 * Oznaka karte je "boja-broj", npr. 'herc-14' (as herc), 'pik-11' (dečko pik).
 * As može biti i najniža karta (skala A-2-3-4-5).
 *
 * Standardni poredak ruku (od najslabije): visoka karta, par, dva para, tris, skala, boja, ful, poker, skala u boji.
 *
 * Igra se "No limit": svaki igrač počinje s istim brojem žetona, male i velike ulog (blindovi)
 * rastu svakih nekoliko ruku. Tko ostane bez žetona ispada; pobjeđuje zadnji koji ima žetone.
 *
 * Potezi su tekst (da ih server šalje kao i karte): 'fold', 'check', 'call', 'raise:IZNOS', 'allin'.
 * IZNOS kod povišenja je ukupni ulog igrača u ovom krugu ("povisi na").
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PokerEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['pik', 'herc', 'karo', 'tref'];
  const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 11 dečko, 12 dama, 13 kralj, 14 as
  const PV_NAME = { 2: 'dvice', 3: 'trice', 4: 'četvorke', 5: 'petice', 6: 'šestice', 7: 'sedmice', 8: 'osmice', 9: 'devetke', 10: 'desetke', 11: 'dečki', 12: 'dame', 13: 'kraljevi', 14: 'asovi' };
  const PV_SHORT = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  // kategorije, od najslabije (standardni poker)
  const CAT = ['Visoka karta', 'Par', 'Dva para', 'Tris', 'Skala', 'Boja', 'Ful', 'Poker', 'Skala u boji'];
  const HIGH = 0, PAIR = 1, TWO = 2, TRIPS = 3, STRAIGHT = 4, FLUSH = 5, FULL = 6, QUADS = 7, SFLUSH = 8;
  const START_CHIPS = 1000;
  // blindovi (mali, veliki) – rastu svakih `blindEvery` ruku
  const BLINDS = [[10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200], [150, 300], [250, 500], [400, 800], [600, 1200], [1000, 2000], [1500, 3000], [2500, 5000]];
  const BLIND_EVERY = 6;

  function card(s, r) { return s + '-' + r; }
  const INFO = Object.create(null);
  for (const s of SUITS) for (const r of RANKS) INFO[card(s, r)] = { s, r, v: r };
  const suitOf = c => INFO[c].s, rankOf = c => INFO[c].r, pv = c => INFO[c].v;
  const FULL_DECK = Object.keys(INFO);
  function fullDeck() { return FULL_DECK.slice(); }
  // za zajedničko sučelje (slaganje karata u ruci)
  const strength = pv;
  const points = () => 0;

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

  // najviša karta skale iz skupa vrijednosti (bitmaska), 0 ako nema skale
  function straightTop(mask) {
    if (mask & (1 << 14)) mask |= 1 << 1; // as kao jedinica
    for (let top = 14; top >= 5; top--) {
      const need = 0b11111 << (top - 4);
      if ((mask & need) === need) return top;
    }
    return 0;
  }

  /**
   * Ocjena najbolje ruke od 5–7 karata. Vraća broj (veći = jača ruka):
   * kategorija * 16^5 + do pet "kickera" po 4 bita.
   */
  function evaluate(cards) {
    const cnt = new Array(15).fill(0);
    const bySuit = { pik: 0, herc: 0, karo: 0, tref: 0 };
    const suitN = { pik: 0, herc: 0, karo: 0, tref: 0 };
    let mask = 0;
    for (const c of cards) {
      const i = INFO[c];
      cnt[i.v]++; mask |= 1 << i.v;
      bySuit[i.s] |= 1 << i.v; suitN[i.s]++;
    }
    const enc = (cat, ks) => { let x = cat; for (let k = 0; k < 5; k++) x = x * 16 + (ks[k] || 0); return x; };
    const quads = [], trips = [], pairs = [];
    for (let v = 14; v >= 2; v--) {
      if (cnt[v] === 4) quads.push(v); else if (cnt[v] === 3) trips.push(v);
      else if (cnt[v] === 2) pairs.push(v);
    }
    const kick = (excl, n) => { const out = []; for (let v = 14; v >= 2 && out.length < n; v--) if (cnt[v] && !excl.includes(v)) out.push(v); return out; };
    // skala u boji / boja
    let flush = -1;
    for (const s of SUITS) if (suitN[s] >= 5) {
      const top = straightTop(bySuit[s]);
      if (top) return enc(SFLUSH, [top]);
      const ks = [];
      for (let v = 14; v >= 2 && ks.length < 5; v--) if (bySuit[s] & (1 << v)) ks.push(v);
      flush = Math.max(flush, enc(FLUSH, ks));
    }
    if (quads.length) return enc(QUADS, [quads[0]].concat(kick([quads[0]], 1)));
    if (trips.length && (trips.length > 1 || pairs.length)) return enc(FULL, [trips[0], Math.max(trips[1] || 0, pairs[0] || 0)]);
    if (flush >= 0) return flush;
    const top = straightTop(mask);
    if (top) return enc(STRAIGHT, [top]);
    if (trips.length) return enc(TRIPS, [trips[0]].concat(kick([trips[0]], 2)));
    if (pairs.length >= 2) return enc(TWO, [pairs[0], pairs[1]].concat(kick([pairs[0], pairs[1]], 1)));
    if (pairs.length) return enc(PAIR, [pairs[0]].concat(kick([pairs[0]], 3)));
    return enc(HIGH, kick([], 5));
  }
  const catOf = score => Math.floor(score / 1048576);
  function handName(score) {
    const cat = catOf(score);
    const k1 = Math.floor(score / 65536) % 16, k2 = Math.floor(score / 4096) % 16;
    switch (cat) {
      case HIGH: return 'Visoka karta (' + PV_SHORT[k1] + ')';
      case PAIR: return 'Par (' + PV_NAME[k1] + ')';
      case TWO: return 'Dva para (' + PV_NAME[k1] + ' i ' + PV_NAME[k2] + ')';
      case STRAIGHT: return 'Skala do ' + (k1 === 5 ? '5' : PV_SHORT[k1]);
      case TRIPS: return 'Tris (' + PV_NAME[k1] + ')';
      case FULL: return 'Ful (' + PV_NAME[k1] + ' na ' + PV_NAME[k2] + ')';
      case FLUSH: return 'Boja (do ' + PV_SHORT[k1] + ')';
      case QUADS: return 'Poker (' + PV_NAME[k1] + ')';
      default: return k1 === 14 ? 'Kraljevska skala u boji' : 'Skala u boji do ' + (k1 === 5 ? '5' : PV_SHORT[k1]);
    }
  }
  // karte koje čine najbolju ruku (za isticanje na stolu)
  function bestFive(cards) {
    if (cards.length <= 5) return cards.slice();
    const sc = evaluate(cards);
    let out = null;
    const n = cards.length;
    for (let a = 0; a < n && !out; a++) for (let b = a + 1; b < n && !out; b++) {
      const rest = cards.filter((_, i) => i !== a && i !== b);
      if (rest.length > 5) { const r2 = bestFive(rest); if (evaluate(r2) === sc) out = r2; }
      else if (evaluate(rest) === sc) out = rest;
    }
    return out || cards.slice(0, 5);
  }

  const teamOf = (mode, p) => p;
  const blindsFor = (st, lvl) => BLINDS[Math.min(BLINDS.length - 1, lvl)].slice();

  /**
   * mode: 2–4 igrača, svatko za sebe.
   * opts: { names, bots, dealer, rng, chips (1000), blindEvery (6) }
   */
  function newGame(mode, opts) {
    opts = opts || {};
    if (![2, 3, 4].includes(mode)) throw new Error('Neispravan način igre');
    const chips = +opts.chips > 0 ? +opts.chips : START_CHIPS;
    const players = [];
    for (let p = 0; p < mode; p++) players.push({
      name: (opts.names && opts.names[p]) || ('Igrač ' + (p + 1)), bot: !!(opts.bots && opts.bots[p]),
      chips, hole: [], bet: 0, total: 0, folded: false, allIn: false, out: false, acted: false,
    });
    const st = {
      kind: 'poker', mode, players, startChips: chips,
      blindEvery: +opts.blindEvery > 0 ? +opts.blindEvery : BLIND_EVERY,
      dealer: opts.dealer != null ? ((opts.dealer % mode) + mode) % mode : Math.floor((opts.rng || RNG)() * mode),
      handNo: 0, board: [], deck: [], street: 0, curBet: 0, minRaise: 0, turn: 0, leader: 0,
      trick: [], trickNo: 0, log: [], shown: {}, handResult: null, result: null, elim: [], hands: [],
      phase: 'play',
    };
    Object.defineProperty(st, 'rng', { value: opts.rng || null, enumerable: false, writable: true });
    st.dealer = (st.dealer + mode - 1) % mode; // deal() pomiče djelitelja
    deal(st);
    return st;
  }

  const alive = st => st.players.map((pl, i) => pl.out ? -1 : i).filter(i => i >= 0);
  function nextAlive(st, from, pred) {
    for (let k = 1; k <= st.mode; k++) {
      const q = (from + k) % st.mode;
      const pl = st.players[q];
      if (!pl.out && (!pred || pred(pl))) return q;
    }
    return -1;
  }
  const canAct = pl => !pl.out && !pl.folded && !pl.allIn;
  const inHand = pl => !pl.out && !pl.folded;

  function postBlind(st, p, amt) {
    const pl = st.players[p];
    const a = Math.min(amt, pl.chips);
    pl.chips -= a; pl.bet += a; pl.total += a;
    if (!pl.chips) pl.allIn = true;
    return a;
  }

  function deal(st) {
    const mode = st.mode;
    st.handNo++;
    st.level = Math.floor((st.handNo - 1) / st.blindEvery);
    const [sb, bb] = blindsFor(st, st.level);
    st.sb = sb; st.bb = bb;
    st.dealer = nextAlive(st, st.dealer);
    const deck = shuffle(fullDeck(), st.rng || undefined);
    for (const pl of st.players) {
      pl.hole = []; pl.bet = 0; pl.total = 0; pl.folded = pl.out; pl.allIn = false; pl.acted = false;
    }
    const live = alive(st);
    const first = nextAlive(st, st.dealer);
    for (let k = 0; k < 2; k++) for (let i = 0; i < mode; i++) {
      const q = (first + i) % mode;
      if (!st.players[q].out) st.players[q].hole.push(deck.pop());
    }
    st.deck = deck; st.board = []; st.street = 0; st.shown = {}; st.log = [];
    st.handResult = null; st.trick = [];
    // u dvoje djelitelj je mali blind i prvi igra prije flopa
    const sbP = live.length === 2 ? st.dealer : nextAlive(st, st.dealer);
    const bbP = nextAlive(st, sbP);
    st.sbP = sbP; st.bbP = bbP;
    postBlind(st, sbP, sb); postBlind(st, bbP, bb);
    st.log.push({ p: sbP, a: 'sb', amt: st.players[sbP].bet }, { p: bbP, a: 'bb', amt: st.players[bbP].bet });
    st.curBet = Math.max(st.players[sbP].bet, st.players[bbP].bet, bb);
    st.minRaise = bb;
    st.phase = 'play';
    st.turn = nextAlive(st, bbP, canAct);
    st.leader = st.turn;
    st.trickNo++;
    advanceIfDone(st, true);
  }

  // je li krug ulaganja gotov
  function roundDone(st) {
    const ins = st.players.filter(inHand);
    if (ins.length <= 1) return true;
    const act = st.players.filter(canAct);
    if (!act.length) return true;
    // svi koji mogu igrati su odigrali i izjednačili ulog
    if (act.every(pl => pl.acted && pl.bet === st.curBet)) return true;
    // ostao samo jedan koji može igrati, a već je izjednačio najveći ulog
    if (act.length === 1 && act[0].bet >= Math.max(...ins.map(pl => pl.bet))) return true;
    return false;
  }

  function advanceIfDone(st, fresh) {
    if (!roundDone(st)) {
      if (fresh && st.turn < 0) st.turn = nextAlive(st, st.dealer, canAct);
      return;
    }
    const ins = st.players.filter(inHand);
    if (ins.length <= 1) return showdown(st);
    st.phase = 'collect'; // kratka pauza, pa sljedeća karta na stolu ili otkrivanje
  }

  function legal(st, p) {
    const pl = st.players[p];
    if (st.phase !== 'play' || st.turn !== p || !canAct(pl)) return null;
    const toCall = Math.min(st.curBet - pl.bet, pl.chips);
    const maxTo = pl.bet + pl.chips;
    const minTo = Math.min(st.curBet + st.minRaise, maxTo);
    // smije li povisiti: ima više od poziva i bar jedan protivnik još može igrati
    const others = st.players.filter((q, i) => i !== p && canAct(q)).length;
    const canRaise = maxTo > st.curBet && others > 0;
    return { toCall, check: toCall === 0, minTo, maxTo, canRaise, bet: pl.bet, curBet: st.curBet };
  }

  function canPlay(st, p, move) { return !!parse(st, p, move); }
  function parse(st, p, move) {
    const L = legal(st, p);
    if (!L) return null;
    const m = /^(fold|check|call|allin|raise):?(\d+)?$/.exec(String(move));
    if (!m) return null;
    const a = m[1];
    if (a === 'fold') return { a: 'fold' };
    if (a === 'check') return L.check ? { a: 'check' } : null;
    if (a === 'call') return L.check ? { a: 'check' } : { a: 'call', to: L.bet + L.toCall };
    if (a === 'allin') {
      if (L.canRaise) return { a: 'raise', to: L.maxTo };
      return L.check ? { a: 'check' } : { a: 'call', to: L.bet + L.toCall };
    }
    if (!L.canRaise) return null;
    let to = Math.floor(+m[2] || 0);
    if (to >= L.maxTo) to = L.maxTo;
    if (to < L.minTo) return null;
    return { a: 'raise', to };
  }

  function play(st, p, move) {
    const mv = parse(st, p, move);
    if (!mv) return false;
    const pl = st.players[p];
    if (mv.a === 'fold') {
      pl.folded = true;
      st.log.push({ p, a: 'fold' });
    } else if (mv.a === 'check') {
      st.log.push({ p, a: 'check' });
    } else {
      const add = mv.to - pl.bet;
      pl.chips -= add; pl.bet = mv.to; pl.total += add;
      if (!pl.chips) pl.allIn = true;
      if (mv.a === 'raise' && mv.to > st.curBet) {
        const wasBet = st.street > 0 && st.curBet === 0;
        const inc = mv.to - st.curBet;
        if (inc >= st.minRaise) st.minRaise = inc;
        st.curBet = mv.to;
        // ostali moraju ponovno odlučiti
        st.players.forEach((q, i) => { if (i !== p) q.acted = false; });
        st.log.push({ p, a: wasBet ? 'bet' : 'raise', amt: mv.to, allIn: pl.allIn });
      } else st.log.push({ p, a: 'call', amt: mv.to, allIn: pl.allIn });
    }
    pl.acted = true;
    st.trickNo++;
    if (st.log.length > 40) st.log.splice(0, st.log.length - 40);
    if (roundDone(st)) return advanceIfDone(st), true;
    st.turn = nextAlive(st, p, canAct);
    return true;
  }

  /** Sljedeća ulica (flop/turn/river) ili otkrivanje karata. Poziva se kad je phase === 'collect'. */
  function collect(st) {
    if (st.phase !== 'collect') return false;
    const ins = st.players.filter(inHand);
    if (ins.length <= 1 || st.street >= 3) { showdown(st); return true; }
    for (const pl of st.players) { pl.bet = 0; pl.acted = false; }
    st.curBet = 0; st.minRaise = st.bb;
    st.street++;
    const n = st.street === 1 ? 3 : 1;
    for (let k = 0; k < n; k++) st.board.push(st.deck.pop());
    st.log.push({ p: -1, a: 'street', street: st.street });
    st.trickNo++;
    st.phase = 'play';
    st.turn = nextAlive(st, st.dealer, canAct);
    st.leader = st.turn;
    // nitko više ne može ulagati (svi all-in): odmah dalje
    if (roundDone(st)) st.phase = 'collect';
    return true;
  }

  function showdown(st) {
    // ako je otkrivanje s više igrača, a stol nije pun, dijele se preostale karte
    const ins = st.players.map((pl, i) => inHand(pl) ? i : -1).filter(i => i >= 0);
    if (ins.length > 1) while (st.board.length < 5) st.board.push(st.deck.pop());
    for (const pl of st.players) pl.bet = 0;
    const scores = {};
    for (const i of ins) scores[i] = evaluate(st.players[i].hole.concat(st.board));
    // lonci (glavni i sporedni) prema ukupnim ulozima
    const levels = [...new Set(st.players.filter(pl => pl.total > 0).map(pl => pl.total))].sort((a, b) => a - b);
    const pots = [];
    let prevL = 0;
    for (const L of levels) {
      let amount = 0;
      st.players.forEach(pl => { amount += Math.max(0, Math.min(pl.total, L) - prevL); });
      const elig = ins.filter(i => st.players[i].total >= L);
      if (amount > 0) {
        if (elig.length) pots.push({ amount, elig });
        else if (pots.length) pots[pots.length - 1].amount += amount; // samo odustali: ide u prethodni lonac
        else pots.push({ amount, elig: ins.slice() });
      }
      prevL = L;
    }
    const won = st.players.map(() => 0);
    const potRes = [];
    for (const pot of pots) {
      const el = pot.elig.length ? pot.elig : ins;
      const top = Math.max(...el.map(i => ins.length > 1 ? scores[i] : 0));
      const ws = el.filter(i => (ins.length > 1 ? scores[i] : 0) === top);
      const share = Math.floor(pot.amount / ws.length);
      let rest = pot.amount - share * ws.length;
      // ostatak ide prvome lijevo od djelitelja
      const order = ws.slice().sort((a, b) => ((a - st.dealer - 1 + st.mode) % st.mode) - ((b - st.dealer - 1 + st.mode) % st.mode));
      for (const w of order) { won[w] += share + (rest > 0 ? 1 : 0); rest--; }
      potRes.push({ amount: pot.amount, winners: ws, hand: ins.length > 1 ? handName(top) : null });
    }
    const before = st.players.map(pl => pl.chips + pl.total);
    st.players.forEach((pl, i) => { pl.chips += won[i]; });
    st.shown = {};
    if (ins.length > 1) for (const i of ins) st.shown[i] = st.players[i].hole.slice();
    const shownHands = {};
    for (const i of ins) if (ins.length > 1) shownHands[i] = { name: handName(scores[i]), best: bestFive(st.players[i].hole.concat(st.board)) };
    // ispadanje: tko je ostao bez žetona (više njih u istoj ruci: bolji je tko je imao više na početku)
    const busted = st.players.map((pl, i) => !pl.out && pl.chips === 0 ? i : -1).filter(i => i >= 0)
      .sort((a, b) => before[a] - before[b]);
    for (const i of busted) { st.players[i].out = true; st.elim.push(i); }
    st.handResult = {
      handNo: st.handNo, pots: potRes, won, delta: st.players.map((pl, i) => pl.chips - before[i]),
      showdown: ins.length > 1, hands: shownHands, busted, board: st.board.slice(),
    };
    st.hands.push({ handNo: st.handNo, chips: st.players.map(pl => pl.chips) });
    st.log.push({ p: -1, a: 'end' });
    st.trickNo++;
    const left = alive(st);
    if (left.length <= 1) {
      const w = left[0];
      const order = [w].concat(st.elim.slice().reverse()); // 1. mjesto, 2. ...
      st.phase = 'over';
      st.result = {
        winners: [w], draw: false, place: order,
        scores: order.map((p, k) => ({ team: p, players: [p], points: st.players[p].chips, place: k + 1 })),
        hands: st.hands.slice(),
      };
    } else st.phase = 'hand';
  }

  function nextHand(st) {
    if (st.phase !== 'hand') return false;
    deal(st);
    return true;
  }

  function pot(st) { return st.players.reduce((a, pl) => a + pl.total, 0); }
  function playerPoints(st, p) { return st.players[p].chips; }

  /** Ono što igrač p smije vidjeti. */
  function viewFor(st, p) {
    const L = p >= 0 ? legal(st, p) : null;
    return {
      kind: 'poker', mode: st.mode, you: p,
      players: st.players.map((pl, i) => ({
        name: pl.name, bot: pl.bot, chips: pl.chips, bet: pl.bet, total: pl.total,
        folded: pl.folded, allIn: pl.allIn, out: pl.out, team: i, handCount: pl.hole.length,
        points: pl.chips, wonCount: 0,
      })),
      hand: p >= 0 ? st.players[p].hole.slice() : [],
      shown: Object.assign({}, st.shown),
      board: st.board.slice(), street: st.street, pot: pot(st),
      curBet: st.curBet, minRaise: st.minRaise, legal: L,
      dealer: st.dealer, sbP: st.sbP, bbP: st.bbP, sb: st.sb, bb: st.bb, level: st.level,
      nextBlinds: blindsFor(st, st.level + 1), blindsIn: st.blindEvery - ((st.handNo - 1) % st.blindEvery),
      handNo: st.handNo, log: st.log.slice(-12),
      trick: [], lastTrick: null, trickNo: st.trickNo, deckCount: 0, trumpSuit: null,
      turn: st.turn, leader: st.leader, phase: st.phase,
      handResult: st.handResult, result: st.result, elim: st.elim.slice(), startChips: st.startChips,
    };
  }

  return {
    SUITS, RANKS, CAT, PV_SHORT, BLINDS, START_CHIPS, BLIND_EVERY,
    suitOf, rankOf, pv, strength, points, fullDeck, shuffle, RNG, evaluate, catOf, handName, bestFive,
    teamOf, newGame, legal, canPlay, play, collect, nextHand, viewFor, playerPoints, pot,
  };
});
