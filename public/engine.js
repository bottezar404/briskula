/* Briškula – pravila igre (dijeli se između preglednika i servera) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BriskulaEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['kupe', 'dinari', 'spade', 'bate'];
  // 1=as, 11=fanat, 12=konj, 13=kralj
  const RANKS = [1, 2, 3, 4, 5, 6, 7, 11, 12, 13];
  const POINTS = { 1: 11, 3: 10, 13: 4, 12: 3, 11: 2 };
  const STRENGTH = { 1: 10, 3: 9, 13: 8, 12: 7, 11: 6, 7: 5, 6: 4, 5: 3, 4: 2, 2: 1 };
  const SUIT_NAMES = { kupe: 'Kupe', dinari: 'Dinari', spade: 'Špade', bate: 'Bate' };
  const RANK_NAMES = { 1: 'As', 2: 'Dvica', 3: 'Trica', 4: 'Četvorka', 5: 'Petica', 6: 'Šestica', 7: 'Sedmica', 11: 'Fanat', 12: 'Konj', 13: 'Kralj' };

  function card(suit, rank) { return suit + '-' + rank; }
  function suitOf(c) { return c.split('-')[0]; }
  function rankOf(c) { return +c.split('-')[1]; }
  function points(c) { return POINTS[rankOf(c)] || 0; }
  function strength(c) { return STRENGTH[rankOf(c)]; }
  function cardName(c) { return RANK_NAMES[rankOf(c)] + ' ' + SUIT_NAMES[suitOf(c)].toLowerCase(); }

  function fullDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push(card(s, r));
    return d;
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** Pobjednik štiha: indeks u nizu trick (lista {p, card}) */
  function trickWinnerIndex(trick, trumpSuit) {
    let best = 0;
    for (let i = 1; i < trick.length; i++) {
      if (beats(trick[i].card, trick[best].card, trumpSuit)) best = i;
    }
    return best;
  }
  /** Je li karta a jača od trenutno najjače karte b (b je odigrana prije) */
  function beats(a, b, trumpSuit) {
    const sa = suitOf(a), sb = suitOf(b);
    if (sa === sb) return strength(a) > strength(b);
    return sa === trumpSuit; // druga boja tuče samo ako je briškula
  }

  function teamOf(mode, p) { return mode === 4 ? p % 2 : p; }

  /**
   * mode: 2, 3 ili 4 (4 = parovi, suigrači sjede nasuprot: 0+2 protiv 1+3)
   * opts: { names:[], bots:[bool], dealer, rng, showPartner }
   */
  function newGame(mode, opts) {
    opts = opts || {};
    if (![2, 3, 4].includes(mode)) throw new Error('Neispravan način igre');
    let deck = fullDeck();
    if (mode === 3) deck = deck.filter(c => c !== 'dinari-2'); // u troje se izbacuje dvica dinara
    shuffle(deck, opts.rng);
    const players = [];
    for (let p = 0; p < mode; p++) {
      players.push({ name: (opts.names && opts.names[p]) || ('Igrač ' + (p + 1)), bot: !!(opts.bots && opts.bots[p]), hand: [], won: [] });
    }
    const dealer = opts.dealer != null ? opts.dealer % mode : Math.floor((opts.rng || Math.random)() * mode);
    const first = (dealer + 1) % mode;
    // deck[0] je okrenuta briškula (zadnja se vuče), vuče se s kraja
    const trump = deck[0];
    for (let k = 0; k < 3; k++) for (let i = 0; i < mode; i++) players[(first + i) % mode].hand.push(deck.pop());
    return {
      mode, players, deck, trump, trumpSuit: suitOf(trump),
      dealer, leader: first, turn: first, trick: [], lastTrick: null,
      phase: 'play', // play | collect | over
      trickNo: 0, result: null,
      showPartner: opts.showPartner !== false,
      log: [],
    };
  }

  function canPlay(st, p, c) {
    return st.phase === 'play' && st.turn === p && st.players[p].hand.includes(c);
  }

  /** Odigraj kartu. Vraća true ako je potez valjan. */
  function play(st, p, c) {
    if (!canPlay(st, p, c)) return false;
    const h = st.players[p].hand;
    h.splice(h.indexOf(c), 1);
    st.trick.push({ p, card: c });
    if (st.trick.length === st.mode) st.phase = 'collect';
    else st.turn = (st.turn + 1) % st.mode;
    return true;
  }

  /** Pokupi štih, podijeli karte i odredi tko igra sljedeći. */
  function collect(st) {
    if (st.phase !== 'collect') return false;
    const wi = trickWinnerIndex(st.trick, st.trumpSuit);
    const winner = st.trick[wi].p;
    const pts = st.trick.reduce((s, t) => s + points(t.card), 0);
    st.players[winner].won.push(...st.trick.map(t => t.card));
    st.lastTrick = { cards: st.trick.slice(), winner, points: pts };
    st.trick = [];
    st.trickNo++;
    // vučenje: prvi vuče pobjednik štiha
    if (st.deck.length) {
      for (let i = 0; i < st.mode; i++) {
        const q = (winner + i) % st.mode;
        if (st.deck.length) st.players[q].hand.push(st.deck.pop());
      }
    }
    st.leader = winner; st.turn = winner;
    if (st.players.every(pl => pl.hand.length === 0)) {
      st.phase = 'over';
      st.result = computeResult(st);
    } else st.phase = 'play';
    return true;
  }

  function playerPoints(st, p) { return st.players[p].won.reduce((s, c) => s + points(c), 0); }

  function computeResult(st) {
    const scores = [];
    if (st.mode === 4) {
      scores.push({ team: 0, players: [0, 2], points: playerPoints(st, 0) + playerPoints(st, 2) });
      scores.push({ team: 1, players: [1, 3], points: playerPoints(st, 1) + playerPoints(st, 3) });
    } else {
      for (let p = 0; p < st.mode; p++) scores.push({ team: p, players: [p], points: playerPoints(st, p) });
    }
    const max = Math.max(...scores.map(s => s.points));
    const top = scores.filter(s => s.points === max);
    return { scores, winners: top.length === 1 ? top[0].players : [], draw: top.length > 1 };
  }

  /** Ono što igrač p smije vidjeti. */
  function viewFor(st, p) {
    const deckEmpty = st.deck.length === 0;
    const partner = st.mode === 4 ? (p + 2) % 4 : -1;
    return {
      mode: st.mode,
      you: p,
      players: st.players.map((pl, i) => ({
        name: pl.name, bot: pl.bot, handCount: pl.hand.length, team: teamOf(st.mode, i),
        wonCount: pl.won.length / st.mode, points: playerPoints(st, i),
      })),
      hand: p >= 0 ? st.players[p].hand.slice() : [],
      partnerHand: (partner >= 0 && st.showPartner && deckEmpty) ? st.players[partner].hand.slice() : null,
      trick: st.trick.slice(),
      lastTrick: st.lastTrick,
      trump: st.trump, trumpSuit: st.trumpSuit,
      trumpInDeck: st.deck.length > 0,
      deckCount: st.deck.length,
      turn: st.turn, leader: st.leader, phase: st.phase, trickNo: st.trickNo,
      played: st.players.reduce((a, pl) => a.concat(pl.won), []),
      result: st.result,
    };
  }

  return {
    SUITS, RANKS, POINTS, SUIT_NAMES, RANK_NAMES,
    suitOf, rankOf, points, strength, cardName, fullDeck, shuffle,
    trickWinnerIndex, beats, teamOf, newGame, canPlay, play, collect, viewFor, playerPoints,
  };
});
