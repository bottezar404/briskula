/* Briškula – botovi. Koriste samo ono što igrač vidi (viewFor). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.BriskulaBot = factory(root.BriskulaEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  function cost(c, T) {
    // koliko "boli" baciti kartu: bodovi + vrijednost briškule
    return E.points(c) + (E.suitOf(c) === T ? 6 + E.strength(c) : 0);
  }
  const byCost = T => (a, b) => cost(a, T) - cost(b, T) || E.strength(a) - E.strength(b);

  function bestOfTrick(trick, T) {
    const i = E.trickWinnerIndex(trick, T);
    return trick[i];
  }

  function lead(v) {
    const T = v.trumpSuit;
    return v.hand.slice().sort(byCost(T))[0];
  }

  function follow(v) {
    const T = v.trumpSuit, me = v.you, mode = v.mode, trick = v.trick;
    const best = bestOfTrick(trick, T);
    const tablePts = trick.reduce((s, t) => s + E.points(t.card), 0);
    const last = trick.length === mode - 1;
    const sorted = v.hand.slice().sort(byCost(T));
    const partnerWinning = mode === 4 && E.teamOf(4, best.p) === E.teamOf(4, me);

    if (partnerWinning) {
      const bc = best.card;
      const safe = last || (E.suitOf(bc) === T && E.strength(bc) >= 8) ||
        (trick.length === 2 && E.suitOf(bc) === T && E.strength(bc) >= 6);
      if (safe) {
        // karikaj: daj suigraču najviše bodova bez trošenja briškula
        const nonTrump = v.hand.filter(c => E.suitOf(c) !== T).sort((a, b) => E.points(b) - E.points(a));
        if (nonTrump.length && E.points(nonTrump[0]) > 0) return nonTrump[0];
      }
      return sorted[0];
    }

    const winners = v.hand.filter(c => E.beats(c, best.card, T));
    if (!winners.length) return sorted[0];

    const sameSuit = winners.filter(c => E.suitOf(c) !== T);
    if (sameSuit.length) {
      // ista boja, jača karta – uzmi s najviše bodova
      sameSuit.sort((a, b) => E.points(b) - E.points(a) || E.strength(a) - E.strength(b));
      const c = sameSuit[0];
      if (last || E.points(c) + tablePts > 0 || E.suitOf(best.card) !== T) return c;
    }
    const trumps = winners.filter(c => E.suitOf(c) === T).sort((a, b) => E.strength(a) - E.strength(b));
    if (trumps.length) {
      const cheapThrow = sorted.find(c => E.suitOf(c) !== T);
      const throwCost = cheapThrow ? E.points(cheapThrow) : 99;
      const late = v.deckCount <= mode * 2;
      const t = trumps[0];
      const tCost = cost(t, T);
      const gain = tablePts + E.points(t);
      if (gain >= 10 || throwCost >= 10 || (late && gain >= 4) || (gain >= 3 && tCost <= 8)) {
        // ne troši jaku briškulu na sitniš
        if (!(E.strength(t) >= 9 && gain < 10 && throwCost < 4)) return t;
      }
    }
    return sorted[0];
  }

  // ---------- "Chi fa meno": cilj je skupiti što manje bodova ----------
  // Tko vodi štih najčešće ga i nosi (ne mora se odgovarati na boju, pa
  // ostali samo bace slabiju kartu i "utovare" mu bodove). Zato se vodi
  // kartom bez bodova, a jake karte (briškule, visoke karte) se troše kad
  // se ionako mora nositi, dok se niske karte čuvaju da se može izgubiti štih.
  function leadLow(v) {
    const T = v.trumpSuit;
    return v.hand.slice().sort((a, b) =>
      E.points(a) - E.points(b) ||
      (E.suitOf(b) === T) - (E.suitOf(a) === T) ||
      E.strength(b) - E.strength(a))[0];
  }

  function followLow(v) {
    const T = v.trumpSuit, me = v.you, mode = v.mode, trick = v.trick;
    const best = bestOfTrick(trick, T);
    const losers = v.hand.filter(c => !E.beats(c, best.card, T));
    const partnerWinning = mode === 4 && E.teamOf(4, best.p) === E.teamOf(4, me);
    if (losers.length) {
      if (partnerWinning) {
        // suigrač nosi: ne dodaji mu bodove
        return losers.sort((a, b) => E.points(a) - E.points(b) || E.strength(b) - E.strength(a))[0];
      }
      // protivnik nosi: istovari mu što više bodova (prvo opasne karte)
      return losers.sort((a, b) => E.points(b) - E.points(a) ||
        (E.suitOf(b) === T) - (E.suitOf(a) === T) || E.strength(b) - E.strength(a))[0];
    }
    // moram nositi: što manje bodova, a usput se riješi najjače karte
    return v.hand.slice().sort((a, b) => E.points(a) - E.points(b) || E.strength(b) - E.strength(a))[0];
  }

  // Savršena igra u završnici za dvoje (špil prazan, sve karte poznate)
  function endgame2(v) {
    const T = v.trumpSuit;
    const sign = v.low ? -1 : 1; // u "Chi fa meno" bodovi su loši
    const seen = new Set([...v.played, ...v.hand, ...v.trick.map(t => t.card)]);
    const opp = E.fullDeck().filter(c => !seen.has(c));
    const me = v.you;
    function solve(myH, opH, trick, turnMe, leaderMe) {
      // vraća razliku bodova (ja - protivnik) za ostatak, i najbolju kartu
      if (trick.length === 2) {
        const w = E.trickWinnerIndex(trick, T);
        const winnerMe = trick[w].p === me;
        const pts = E.points(trick[0].card) + E.points(trick[1].card);
        const r = solve(myH, opH, [], winnerMe, winnerMe);
        return { val: r.val + sign * (winnerMe ? pts : -pts) };
      }
      if (!myH.length && !opH.length) return { val: 0 };
      const hand = turnMe ? myH : opH;
      let best = null;
      for (const c of hand) {
        const nh = hand.filter(x => x !== c);
        const nt = trick.concat([{ p: turnMe ? me : 1 - me, card: c }]);
        const r = turnMe ? solve(nh, opH, nt, !turnMe, leaderMe) : solve(myH, nh, nt, !turnMe, leaderMe);
        if (!best || (turnMe ? r.val > best.val : r.val < best.val)) best = { val: r.val, card: c };
      }
      return best;
    }
    const r = solve(v.hand, opp, v.trick.slice(), true, v.trick.length === 0);
    return r.card;
  }

  function choose(v, level) {
    level = level || 'normal';
    if (!v.hand.length) return null;
    if (level === 'easy' && Math.random() < 0.55) return v.hand[Math.floor(Math.random() * v.hand.length)];
    if (level === 'hard' && v.mode === 2 && v.deckCount === 0) {
      const c = endgame2(v);
      if (c) return c;
    }
    if (v.low) return v.trick.length === 0 ? leadLow(v) : followLow(v);
    return v.trick.length === 0 ? lead(v) : follow(v);
  }

  return { choose };
});
