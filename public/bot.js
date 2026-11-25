/* Briškula – botovi. Koriste samo ono što igrač vidi (viewFor).
 *
 * Normalni bot broji karte: zna koje su karte izašle, pa za svaku kartu u
 * ruci procijeni što se dogodi u štihu (hoće li ga netko poslije njega
 * preuzeti) i koliko ta karta vrijedi ako je zadrži (briškule su
 * dragocjene, sitne karte nisu). Teški bot uz to odigra stotine zamišljenih
 * partija (nasumičan raspored karata koje ne vidi) i izabere kartu koja
 * u prosjeku donese najviše; u dvoje, kad je špil prazan, igra savršeno.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.BriskulaBot = factory(root.BriskulaEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  // tablica karata: bot u teškoj razini ove podatke traži stotine tisuća puta
  const INFO = Object.create(null);
  for (const c of E.fullDeck()) INFO[c] = { s: E.suitOf(c), k: E.strength(c), p: E.points(c), r: E.rankOf(c) };
  const pts = c => INFO[c].p, str = c => INFO[c].k, suit = c => INFO[c].s;
  function beats(a, b, T) {
    const x = INFO[a], y = INFO[b];
    return x.s === y.s ? x.k > y.k : x.s === T;
  }
  function winnerIdx(trick, T) {
    let w = 0;
    for (let i = 1; i < trick.length; i++) if (beats(trick[i].card, trick[w].card, T)) w = i;
    return w;
  }
  const DECK = { 2: E.fullDeck(), 4: E.fullDeck(), 3: E.fullDeck().filter(c => c !== 'dinari-2') };
  const team = (v, p) => E.teamOf(v.mode, p);
  // težine (namještene simulacijama protiv starog bota):
  // a, b – koliko vrijedi čuvati briškulu dok ima karata u špilu (la, lb – kad je špil prazan)
  // nm – udio bodova briškule koja nije najjača preostala; nt – visoka karta druge boje kad je jača još vani
  // tri – kazna za vođenje trice dok je as vani; pp – koliko se vjeruje da suigrač preuzme štih
  // pu – koliko se vjeruje da će protivnik zaista preuzeti štih kad može
  // lf – koliko "boli" kad protivnik pokupi bodove (u troje ih nosi jedan od dvojice)
  const BASE = { pu: 1, a: 3, b: 0.4, la: 1.5, lb: 0.3, nm: 0.6, nt: 0, tri: 4, pp: 0.6, lf: 1 };
  const PM = {
    2: Object.assign({}, BASE),
    3: Object.assign({}, BASE, { a: 4, b: 0.5, nt: -0.3, lf: 0.5 }),
    4: Object.assign({}, BASE, { a: 4, b: 0.5, nt: -0.3, pp: 0.75 }),
  };

  // ---------- što bot zna ----------
  // karte čiji položaj ne zna (u tuđim rukama ili u špilu, bez okrenute briškule)
  function unknownCards(v) {
    const gone = new Set(v.played);
    for (const c of v.hand) gone.add(c);
    for (const t of v.trick) gone.add(t.card);
    if (v.partnerHand) for (const c of v.partnerHand) gone.add(c);
    if (v.trumpInDeck && v.trump) gone.add(v.trump);
    return DECK[v.mode].filter(c => !gone.has(c));
  }
  // igrači koji igraju poslije mene u ovom štihu
  function after(v) {
    const a = [];
    for (let i = 1; i <= v.mode - 1 - v.trick.length; i++) a.push((v.you + i) % v.mode);
    return a;
  }
  // vjerojatnost da igrač s h nepoznatih karata (od U) ima barem jednu od B "dobrih"
  function pHas(B, U, h) {
    if (B <= 0 || h <= 0) return 0;
    if (B + h > U) return 1;
    let q = 1;
    for (let i = 0; i < h; i++) q *= (U - B - i) / (U - i);
    return 1 - q;
  }
  function ctx(v) {
    const T = v.trumpSuit, unk = unknownCards(v);
    const partner = v.mode === 4 ? (v.you + 2) % 4 : -1;
    // above[boja][j] = koliko nepoznatih karata te boje je jače od jačine j
    const above = {};
    for (const s of E.SUITS) above[s] = new Array(12).fill(0);
    for (const c of unk) { const x = INFO[c]; const a = above[x.s]; for (let j = 0; j < x.k; j++) a[j]++; }
    // najjača nevidljiva briškula (uključujući okrenutu, koja će nekome doći)
    let trMax = 0;
    for (const c of unk) if (INFO[c].s === T && INFO[c].k > trMax) trMax = INFO[c].k;
    if (v.trumpInDeck && v.trump && str(v.trump) > trMax) trMax = str(v.trump);
    const P = PM[v.mode];
    return { T, unk, U: unk.length, above, nT: above[T][0], partner, trMax, late: v.deckCount === 0, lf: P.lf, P };
  }
  // koliko nepoznatih karata tuče kartu c
  function beaters(k, c) {
    const x = INFO[c];
    return x.s === k.T ? k.above[k.T][x.k] : k.above[x.s][x.k] + k.nT;
  }
  // vjerojatnost da netko od protivnika poslije mene preuzme štih kartom win
  function pBeaten(v, k, win, opps) {
    if (!opps.length) return 0;
    const B = beaters(k, win);
    if (!B) return 0;
    let keep = 1;
    for (const q of opps) keep *= 1 - pHas(B, k.U, v.players[q].handCount);
    return (1 - keep) * k.P.pu;
  }

  // koliko vrijedi zadržati kartu za kasnije
  function holdValue(c, k) {
    const P = k.P, x = INFO[c];
    if (x.s !== k.T) return x.p && k.above[x.s][x.k] ? x.p * P.nt : 0;
    const power = k.late ? P.la + P.lb * x.k : P.a + P.b * x.k;
    return x.p * (k.trMax > x.k ? P.nm : 1) + power;
  }

  // ---------- obična briškula ----------
  function follow(v) {
    const k = ctx(v), me = v.you, my = team(v, me);
    const rest = after(v);
    const opps = rest.filter(q => team(v, q) !== my);
    const partnerAfter = rest.includes(k.partner);
    const wi = winnerIdx(v.trick, k.T), cur = v.trick[wi];
    let table = 0;
    for (const t of v.trick) table += pts(t.card);
    let best = null, bv = -Infinity;
    for (const c of v.hand) {
      const w = beats(c, cur.card, k.T) ? { p: me, card: c } : cur;
      const total = table + pts(c);
      let swing;
      if (team(v, w.p) === my) {
        const p = pBeaten(v, k, w.card, opps);
        swing = total * (1 - p - k.lf * p);
      } else {
        // protivnik nosi; možda ga suigrač poslije mene još preuzme
        let pp = 0;
        if (partnerAfter) {
          if (v.partnerHand) pp = v.partnerHand.some(x => beats(x, w.card, k.T)) ? 0.9 : 0;
          else pp = k.P.pp * pHas(beaters(k, w.card), k.U, v.players[k.partner].handCount);
        }
        swing = total * (pp - k.lf * (1 - pp));
      }
      const val = swing - holdValue(c, k) - 0.02 * str(c);
      if (val > bv) { bv = val; best = c; }
    }
    return best;
  }

  function lead(v) {
    const k = ctx(v), my = team(v, v.you);
    const opps = after(v).filter(q => team(v, q) !== my);
    let best = null, bv = -Infinity;
    for (const c of v.hand) {
      const p = pBeaten(v, k, c, opps);
      let swing = pts(c) * (1 - p - k.lf * p);
      // trica dok je as iste boje vani: as je odnese i još doda svojih 11
      if (suit(c) !== k.T && INFO[c].r === 3 && k.above[suit(c)][9]) swing -= k.P.tri;
      const val = swing - holdValue(c, k) - 0.02 * str(c);
      if (val > bv) { bv = val; best = c; }
    }
    return best;
  }

  // ---------- "Chi fa meno": cilj je skupiti što manje bodova ----------
  // Tko vodi štih najčešće ga i nosi (ne mora se odgovarati na boju, pa
  // ostali samo bace slabiju kartu i "utovare" mu bodove). Zato se vodi
  // kartom bez bodova, a jake karte (briškule, visoke karte) se troše kad
  // se ionako mora nositi, dok se niske karte čuvaju da se može izgubiti štih.
  function leadLow(v) {
    const T = v.trumpSuit;
    return v.hand.slice().sort((a, b) =>
      pts(a) - pts(b) ||
      (suit(b) === T) - (suit(a) === T) ||
      str(b) - str(a))[0];
  }

  function followLow(v) {
    const T = v.trumpSuit, me = v.you, mode = v.mode, trick = v.trick;
    const best = trick[winnerIdx(trick, T)];
    const losers = v.hand.filter(c => !beats(c, best.card, T));
    const partnerWinning = mode === 4 && E.teamOf(4, best.p) === E.teamOf(4, me);
    if (losers.length) {
      if (partnerWinning) {
        // suigrač nosi: ne dodaji mu bodove
        return losers.sort((a, b) => pts(a) - pts(b) || str(b) - str(a))[0];
      }
      // protivnik nosi: istovari mu što više bodova (prvo opasne karte)
      return losers.sort((a, b) => pts(b) - pts(a) ||
        (suit(b) === T) - (suit(a) === T) || str(b) - str(a))[0];
    }
    // moram nositi: što manje bodova, a usput se riješi najjače karte
    return v.hand.slice().sort((a, b) => pts(a) - pts(b) || str(b) - str(a))[0];
  }

  function heuristic(v) {
    if (v.low) return v.trick.length === 0 ? leadLow(v) : followLow(v);
    return v.trick.length === 0 ? lead(v) : follow(v);
  }

  // ---------- savršena igra u završnici za dvoje (špil prazan, sve karte poznate) ----------
  function endgame2(v) {
    const T = v.trumpSuit;
    const sign = v.low ? -1 : 1; // u "Chi fa meno" bodovi su loši
    const opp = unknownCards(v);
    if (opp.length !== v.players[1 - v.you].handCount) return null;
    const me = v.you;
    function solve(myH, opH, trick, turnMe) {
      // vraća razliku bodova (ja - protivnik) za ostatak, i najbolju kartu
      if (trick.length === 2) {
        const w = E.trickWinnerIndex(trick, T);
        const winnerMe = trick[w].p === me;
        const p = pts(trick[0].card) + pts(trick[1].card);
        const r = solve(myH, opH, [], winnerMe);
        return { val: r.val + sign * (winnerMe ? p : -p) };
      }
      if (!myH.length && !opH.length) return { val: 0 };
      const hand = turnMe ? myH : opH;
      let best = null;
      for (const c of hand) {
        const nh = hand.filter(x => x !== c);
        const nt = trick.concat([{ p: turnMe ? me : 1 - me, card: c }]);
        const r = turnMe ? solve(nh, opH, nt, !turnMe) : solve(myH, nh, nt, !turnMe);
        if (!best || (turnMe ? r.val > best.val : r.val < best.val)) best = { val: r.val, card: c };
      }
      return best;
    }
    const r = solve(v.hand, opp, v.trick.slice(), true);
    return r && r.card;
  }

  // ---------- teški bot: mnogo zamišljenih rasporeda karata ----------
  const HARD_MS = 150, HB = 2;
  function rnd(n) { return Math.floor(Math.random() * n); }
  function determinize(v) {
    const pool = unknownCards(v);
    for (let i = pool.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    const hands = v.players.map((pl, q) => {
      if (q === v.you) return v.hand.slice();
      if (v.partnerHand && q === (v.you + 2) % 4) return v.partnerHand.slice();
      return pool.splice(0, pl.handCount);
    });
    // špil: okrenuta briškula je na dnu (vuče se zadnja)
    const deck = v.trumpInDeck ? [v.trump].concat(pool) : pool;
    if (deck.length !== v.deckCount) return null;
    return { hands, deck };
  }
  function simState(v, d) {
    const players = v.players.map((pl, q) => ({ name: '', bot: true, hand: d.hands[q], won: [] }));
    // odigrane karte idu "meni" (potrebne su da botovi znaju što je izašlo);
    // isto je za svaki potez, pa ne mijenja usporedbu
    players[v.you].won = v.played.slice();
    return {
      mode: v.mode, players, deck: d.deck, trump: v.trump, trumpSuit: v.trumpSuit,
      dealer: 0, leader: v.leader, turn: v.turn, trick: v.trick.slice(), lastTrick: null,
      phase: 'play', trickNo: v.trickNo, result: null, showPartner: true, low: !!v.low, log: [],
    };
  }
  function evalState(st, me) {
    const my = E.teamOf(st.mode, me);
    let mine = 0, opp = 0, no = 0;
    st.players.forEach((pl, q) => {
      const p = pl.won.reduce((s, c) => s + pts(c), 0);
      if (E.teamOf(st.mode, q) === my) mine += p; else { opp += p; no++; }
    });
    if (st.mode === 3) opp /= 2;
    return st.low ? opp - mine : mine - opp;
  }
  function playout(st, first, me) {
    E.play(st, st.turn, first);
    let guard = 0;
    while (st.phase !== 'over') {
      if (st.phase === 'collect') { E.collect(st); continue; }
      E.play(st, st.turn, heuristic(E.viewFor(st, st.turn)));
      if (++guard > 120) break;
    }
    return evalState(st, me);
  }
  function pimc(v, budgetMs, maxN) {
    const legal = Array.from(new Set(v.hand));
    if (legal.length === 1) return legal[0];
    const h = legal.indexOf(heuristic(v));
    const tot = legal.map(() => 0), sq = legal.map(() => 0);
    const t0 = Date.now();
    let n = 0;
    while (n < 10 || (Date.now() - t0 < budgetMs && n < maxN)) {
      const d = determinize(v);
      if (!d) break;
      const r = legal.map(c => playout(simState(v, { hands: d.hands.map(x => x.slice()), deck: d.deck.slice() }), c, v.you));
      // razlika prema karti koju bi izabrala pravila (isti raspored karata za sve)
      r.forEach((x, i) => { const dd = x - r[h]; tot[i] += dd; sq[i] += dd * dd; });
      n++;
    }
    if (!n) return legal[h];
    // zamišljene partije su "bučne": pravila se napuštaju samo kad je druga
    // karta jasno bolja (barem HB bodova i izvan slučajnog odstupanja)
    let bi = h, bv = 0;
    for (let i = 0; i < legal.length; i++) {
      if (i === h) continue;
      const mean = tot[i] / n, se = Math.sqrt(Math.max(0, sq[i] / n - mean * mean) / n);
      const margin = mean - Math.max(HB, 2 * se);
      if (margin > bv) { bv = margin; bi = i; }
    }
    return legal[bi];
  }

  function choose(v, level) {
    level = level || 'normal';
    if (!v.hand.length) return null;
    if (v.hand.length === 1) return v.hand[0];
    if (level === 'easy' && Math.random() < 0.55) return v.hand[rnd(v.hand.length)];
    if (level === 'hard') {
      if (v.mode === 2 && v.deckCount === 0) {
        const c = endgame2(v);
        if (c) return c;
      }
      return pimc(v, HARD_MS, 400);
    }
    return heuristic(v);
  }

  return { choose, heuristic, PM };
});
