/* Poker – botovi. Koriste samo ono što igrač vidi (viewFor).
 * Snagu ruke procjenjuju simulacijom (Monte Carlo): podijele protivnicima nasumične karte
 * i dovrše stol nekoliko stotina puta. Teži bot pretpostavlja da protivnik koji povisuje
 * ima jaču ruku, pazi na isplativost poziva (pot odds), ponekad blefira i "uspori" jaku ruku.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./poker.js'));
  else root.PokerBot = factory(root.PokerEngine);
})(typeof self !== 'undefined' ? self : this, function (P) {
  'use strict';

  const LV = {
    easy: { iters: 150, margin: -0.06, bluff: 0.03, noise: 0.22, raiseMul: 0.6, read: 0 },
    normal: { iters: 350, margin: 0.03, bluff: 0.07, noise: 0.06, raiseMul: 1, read: 0.45 },
    hard: { iters: 700, margin: 0.02, bluff: 0.11, noise: 0, raiseMul: 1, read: 0.75 },
  };

  // gruba snaga početne ruke (za procjenu što protivnik koji povisuje može imati)
  function preScore(a, b) {
    const x = P.pv(a), y = P.pv(b), hi = Math.max(x, y), lo = Math.min(x, y);
    let s = hi + lo * 0.5;
    if (x === y) s += 8 + x * 0.4;
    if (P.suitOf(a) === P.suitOf(b)) s += 2;
    if (hi - lo === 1) s += 1.2; else if (hi - lo === 2) s += 0.5;
    return s; // ~8 (7-2) … ~35 (A-A)
  }

  /** vjerojatnost pobjede (izjednačenje se dijeli) protiv nOpp protivnika */
  function equity(hand, board, nOpp, iters, tight, rng) {
    rng = rng || Math.random;
    const known = new Set(hand.concat(board));
    const rest = P.fullDeck().filter(c => !known.has(c));
    const need = 5 - board.length;
    let win = 0;
    const deck = rest.slice();
    for (let it = 0; it < iters; it++) {
      // djelomično miješanje: trebamo 2*nOpp + need karata
      let n = deck.length, k = 0;
      const take = () => { const j = k + Math.floor(rng() * (n - k)); const t = deck[k]; deck[k] = deck[j]; deck[j] = t; return deck[k++]; };
      const opps = [];
      for (let o = 0; o < nOpp; o++) {
        let a = take(), b = take();
        // protivnik koji je povisio rjeđe ima slabu ruku: slabe ruke ponekad zamijeni
        if (tight && tight[o] && k + 2 <= n && preScore(a, b) < 15 && rng() < tight[o]) { a = take(); b = take(); }
        opps.push([a, b]);
      }
      const full = board.slice();
      for (let i = 0; i < need; i++) full.push(take());
      const mine = P.evaluate(hand.concat(full));
      let best = true, ties = 0;
      for (const h of opps) {
        const s = P.evaluate(h.concat(full));
        if (s > mine) { best = false; break; }
        if (s === mine) ties++;
      }
      if (best) win += 1 / (ties + 1);
    }
    return win / iters;
  }

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function choose(v, level) {
    const cfg = LV[level] || LV.normal;
    const L = v.legal;
    if (!L) return 'fold';
    const me = v.players[v.you];
    const opps = v.players.map((pl, i) => i !== v.you && !pl.folded && !pl.out ? i : -1).filter(i => i >= 0);
    if (!opps.length) return L.check ? 'check' : 'call';
    // tko je u ovoj ruci povisivao (od zadnje podjele)
    const raised = {};
    for (const e of v.log) if ((e.a === 'raise' || e.a === 'bet') && e.p !== v.you) raised[e.p] = (raised[e.p] || 0) + 1;
    const tight = opps.map(q => raised[q] ? clamp(cfg.read * (0.6 + 0.25 * raised[q]), 0, 0.95) : 0);
    let eq = equity(v.hand, v.board, opps.length, cfg.iters, cfg.read ? tight : null);
    if (cfg.noise) eq = clamp(eq + (Math.random() - 0.5) * 2 * cfg.noise, 0, 1);

    const pot = v.pot, toCall = L.toCall, stack = me.chips;
    const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
    const base = 1 / (opps.length + 1);
    const rel = eq / base; // 1 = prosječna ruka za ovoliko igrača
    const bb = v.bb || 20;
    const r = Math.random();

    const raiseTo = frac => {
      if (!L.canRaise) return toCall ? 'call' : 'check';
      let size = Math.max(bb, Math.round((pot + toCall) * frac * cfg.raiseMul / 5) * 5);
      let to = L.bet + toCall + size;
      to = clamp(to, L.minTo, L.maxTo);
      if (to >= L.maxTo * 0.7) return 'allin';
      return 'raise:' + to;
    };

    // malo žetona (manje od 8 velikih blindova): sve ili ništa
    if (stack + me.bet <= bb * 8 && v.street === 0) {
      if (rel > 1.25 || eq > 0.6) return 'allin';
      if (L.check) return 'check';
      return eq >= potOdds + 0.02 ? 'call' : 'fold';
    }

    // vrlo jaka ruka
    if (eq > 0.82 || (rel > 1.9 && eq > 0.55)) {
      // teški bot ponekad samo provjeri na flopu da protivnik uloži
      if (level === 'hard' && L.check && v.street === 1 && r < 0.25) return 'check';
      return raiseTo(v.street === 0 ? 0.9 : 0.75);
    }
    // dobra ruka
    if (eq > 0.62 || rel > 1.45) {
      if (toCall <= pot * 0.35 && r < (level === 'easy' ? 0.25 : 0.55)) return raiseTo(0.55);
      if (L.check) return 'check';
      return eq >= potOdds + cfg.margin ? 'call' : 'fold';
    }
    // blef: nitko nije ulagao, a karte su na stolu
    if (L.check && v.street >= 1 && r < cfg.bluff * (opps.length === 1 ? 1.6 : 1)) return raiseTo(0.5);
    if (L.check) return 'check';
    // poziv ako se isplati (veliki ulog traži više sigurnosti)
    let need = potOdds + cfg.margin + (toCall > stack * 0.5 ? 0.06 : 0);
    if (level === 'easy' && toCall <= bb * 2) need -= 0.12; // lagani bot rado "vidi"
    if (eq >= need) return 'call';
    return 'fold';
  }

  /** Odigraj partiju do kraja samo s botovima (kad su svi ljudi ispali). */
  function finish(st, level) {
    let guard = 0;
    while (st.phase !== 'over' && guard++ < 100000) {
      if (st.phase === 'collect') P.collect(st);
      else if (st.phase === 'hand') P.nextHand(st);
      else if (st.phase === 'play') {
        // brža procjena (manje simulacija), ishod je isti po pravilima
        const v = P.viewFor(st, st.turn);
        P.play(st, st.turn, choose(v, 'easy') || 'fold') || P.play(st, st.turn, 'fold');
      } else break;
    }
    return st;
  }

  return { choose, equity, preScore, finish };
});
