/* Trešeta – botovi. Koriste samo ono što igrač vidi (viewFor). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./treseta.js'));
  else root.TresetaBot = factory(root.TresetaEngine);
})(typeof self !== 'undefined' ? self : this, function (T) {
  'use strict';
  const suit = T.suitOf, str = T.strength, bele = T.bele;

  // karte koje još nisu odigrane, a nisu u mojoj ruci (kod drugih ili u špilu)
  function outCards(v) {
    const gone = new Set(v.played);
    for (const c of v.hand) gone.add(c);
    for (const t of v.trick) gone.add(t.card);
    return T.deckFor(v.mode).filter(c => !gone.has(c));
  }
  const myTeam = v => T.teamOf(v.mode, v.you);
  const isMate = (v, q) => q !== v.you && T.teamOf(v.mode, q) === myTeam(v);
  function mateCards(v) {
    const s = new Set();
    v.known.forEach((k, q) => { if (isMate(v, q)) k.forEach(c => s.add(c)); });
    return s;
  }
  // je li karta najjača preostala u boji (ne računajući karte suigrača)
  function master(c, out, mates) {
    const s = suit(c), k = str(c);
    return !out.some(x => suit(x) === s && str(x) > k && !(mates && mates.has(x)));
  }
  function after(v) {
    const n = v.mode - 1 - v.trick.length, a = [];
    for (let i = 1; i <= n; i++) a.push((v.you + i) % v.mode);
    return a;
  }

  // baci najmanje vrijednu kartu
  function dump(cards, out) {
    let best = null, bk = Infinity;
    for (const c of cards) {
      const k = bele(c) * 3 + (master(c, out) && bele(c) ? 2 : 0) + str(c) * 0.05;
      if (k < bk) { bk = k; best = c; }
    }
    return best;
  }

  function lead(v) {
    const out = outCards(v), mates = mateCards(v);
    const partner = v.mode === 4 ? (v.you + 2) % 4 : -1;
    const others = [];
    for (let q = 0; q < v.mode; q++) if (q !== v.you && !isMate(v, q)) others.push(q);
    let best = null, bv = -Infinity;
    for (const c of v.hand) {
      const s = suit(c);
      const outS = out.filter(x => suit(x) === s);
      const mine = v.hand.filter(x => suit(x) === s).length;
      const oppCan = others.filter(q => !v.voids[q].includes(s)).length;
      let val;
      if (master(c, out, mates) && outS.length) {
        // siguran štih: pokupi figure koje su još vani
        val = 6 + outS.reduce((a, x) => a + bele(x), 0) * 0.6 + (oppCan ? 1 : -2) - (bele(c) === 3 ? 1 : 0);
      } else {
        val = -bele(c) * 2.5 + mine * 0.5 - str(c) * 0.08;
        if (rankOf(c) === 1) val -= 6; // as se ne vodi dok su trica ili dvica vani
        // suigrač ima jaku kartu u toj boji (vidjelo se iz akuže ili izvlačenja)
        if (partner >= 0 && v.known[partner].some(x => suit(x) === s && master(x, out.filter(y => y !== x), null)) && !bele(c)) val += 4;
        if (!oppCan && !bele(c)) val += 1; // protivnik nema boju, ne može ništa uzeti
      }
      if (val > bv) { bv = val; best = c; }
    }
    return best;
  }
  const rankOf = T.rankOf;

  function follow(v) {
    const legal = T.legalCards(v.hand, v.trick);
    if (legal.length === 1) return legal[0];
    const out = outCards(v), mates = mateCards(v);
    const s = suit(v.trick[0].card);
    const bi = T.trickWinnerIndex(v.trick), bestCard = v.trick[bi].card;
    const tableBele = v.trick.reduce((a, t) => a + bele(t.card), 0);
    const oppAfter = after(v).filter(q => !isMate(v, q) && !v.voids[q].includes(s));
    const partnerWinning = isMate(v, v.trick[bi].p);
    const safe = c => !oppAfter.length || master(c, out, mates);
    const following = suit(legal[0]) === s;

    if (partnerWinning && safe(bestCard)) {
      // suigrač sigurno nosi: daj mu bodove (ali ne troši svoje jake karte)
      let best = null, bv = -Infinity;
      for (const c of legal) {
        const val = bele(c) * 3 - (bele(c) === 1 && master(c, out) && str(c) >= 9 ? 4 : 0) - str(c) * 0.05;
        if (val > bv) { bv = val; best = c; }
      }
      return best;
    }
    if (following) {
      const winners = legal.filter(c => str(c) > str(bestCard));
      const sw = winners.filter(safe);
      if (sw.length) {
        const d = dump(legal, out);
        if (tableBele >= 1 || bele(d) > 0 || partnerWinning) {
          // uzmi asom ako je siguran, inače najslabijom sigurnom kartom
          const ace = sw.find(c => rankOf(c) === 1);
          if (ace) return ace;
          return sw.sort((a, b) => str(a) - str(b))[0];
        }
        return d;
      }
      return dump(legal, out);
    }
    // nemam boju: baci nešto
    return dump(legal, out);
  }

  // ---------- "Chi fa meno": što manje bodova ----------
  // vodi se niskom kartom u boji u kojoj su vani jače karte (netko drugi će nositi)
  function leadLow(v) {
    const out = outCards(v);
    let best = null, bv = -Infinity;
    for (const c of v.hand) {
      const higher = out.filter(x => suit(x) === suit(c) && str(x) > str(c)).length;
      const val = higher * 0.6 - str(c) * 0.5 - bele(c) * 1.5 + (higher ? 0 : -8);
      if (val > bv) { bv = val; best = c; }
    }
    return best;
  }
  function followLow(v) {
    const legal = T.legalCards(v.hand, v.trick);
    if (legal.length === 1) return legal[0];
    const s = suit(v.trick[0].card);
    const bi = T.trickWinnerIndex(v.trick), bestCard = v.trick[bi].card;
    const partnerWinning = isMate(v, v.trick[bi].p);
    const last = after(v).length === 0;
    const following = suit(legal[0]) === s;
    const pick = key => legal.slice().sort((a, b) => key(b) - key(a))[0];
    if (following) {
      const losers = legal.filter(c => str(c) < str(bestCard));
      if (losers.length) {
        // gubim štih: protivniku istovari bodove i jake karte, suigraču ne
        return partnerWinning ? pick(c => -bele(c) * 3 + str(c) * 0.1) : pick(c => bele(c) * 3 + str(c) * 0.2);
      }
      // moram preuzeti: zadnji baca najjaču (štih je ionako moj), inače najslabiju
      return last ? pick(c => -bele(c) * 3 + str(c) * 0.2) : pick(c => -bele(c) * 3 - str(c) * 0.2);
    }
    // nemam boju: riješi se bodova i jakih karata (ako suigrač ne nosi)
    return partnerWinning ? pick(c => -bele(c) * 3 + str(c) * 0.2) : pick(c => bele(c) * 3 + str(c) * 0.3);
  }

  function heuristic(v) {
    if (v.low) return v.trick.length ? followLow(v) : leadLow(v);
    return v.trick.length ? follow(v) : lead(v);
  }

  // ---------- teški bot: mnogo zamišljenih rasporeda karata ----------
  function rnd(n) { return Math.floor(Math.random() * n); }
  function determinize(v) {
    const mode = v.mode, me = v.you;
    const knownAll = new Set();
    v.known.forEach(k => k.forEach(c => knownAll.add(c)));
    const pool = outCards(v).filter(c => !knownAll.has(c));
    const need = v.players.map((pl, q) => q === me ? 0 : pl.handCount - v.known[q].length);
    const order = [];
    for (let q = 0; q < mode; q++) if (q !== me) order.push(q);
    order.sort((a, b) => v.voids[b].length - v.voids[a].length);
    for (let attempt = 0; attempt < 30; attempt++) {
      const p = pool.slice();
      for (let i = p.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = p[i]; p[i] = p[j]; p[j] = t; }
      const hands = v.players.map((_, q) => q === me ? v.hand.slice() : v.known[q].slice());
      let ok = true;
      for (const q of order) {
        const vs = attempt < 25 ? v.voids[q] : [];
        let n = need[q];
        for (let i = 0; i < p.length && n > 0;) {
          if (!vs.includes(suit(p[i]))) { hands[q].push(p[i]); p.splice(i, 1); n--; } else i++;
        }
        if (n > 0) { ok = false; break; }
      }
      if (ok) return { hands, deck: p };
    }
    return null;
  }

  function simState(v, d) {
    const st = {
      kind: 'treseta', mode: v.mode,
      players: v.players.map((pl, q) => ({ name: '', bot: true, hand: d.hands[q], won: [], bele: pl.points })),
      target: 999, akuzeOn: false, low: !!v.low, score: v.score.slice(), hands: [], handNo: v.handNo, dealer: 0,
      deck: d.deck, leader: v.leader, turn: v.turn, trick: v.trick.slice(), lastTrick: null, lastDraw: null,
      trickNo: v.trickNo, voids: v.voids.map(x => x.slice()), known: v.known.map(x => x.slice()), akuze: [],
      handResult: null, result: null, phase: 'play',
    };
    st.known[v.you] = [];
    // odigrane karte su potrebne za outCards u simulaciji
    st.players[v.you].won = v.played.slice();
    return st;
  }

  function evalState(st, me) {
    const mt = T.teamOf(st.mode, me);
    let mine = 0, opp = 0, no = 0;
    st.players.forEach((pl, q) => { if (T.teamOf(st.mode, q) === mt) mine += pl.bele; else { opp += pl.bele; no++; } });
    if (st.mode === 3) opp /= 2;
    return st.low ? opp - mine : mine - opp;
  }

  function playout(st, first, me) {
    T.play(st, st.turn, first);
    let guard = 0;
    while (st.phase === 'play' || st.phase === 'collect') {
      if (st.phase === 'collect') { T.collect(st); continue; }
      const c = heuristic(T.viewFor(st, st.turn));
      T.play(st, st.turn, c);
      if (++guard > 200) break;
    }
    return evalState(st, me);
  }

  function pimc(v, budgetMs) {
    const legal = T.legalCards(v.hand, v.trick);
    if (legal.length === 1) return legal[0];
    const tot = legal.map(() => 0);
    const t0 = Date.now();
    let n = 0;
    while (n < 8 || (Date.now() - t0 < budgetMs && n < 60)) {
      const d = determinize(v);
      if (!d) break;
      legal.forEach((c, i) => {
        const st = simState(v, { hands: d.hands.map(h => h.slice()), deck: d.deck.slice() });
        tot[i] += playout(st, c, v.you);
      });
      n++;
    }
    if (!n) return heuristic(v);
    let bi = 0;
    for (let i = 1; i < legal.length; i++) if (tot[i] > tot[bi]) bi = i;
    return legal[bi];
  }

  // ---------- savršena završnica u dvoje (špil prazan, sve karte poznate) ----------
  function endgame2(v) {
    const me = v.you, op = 1 - me;
    const opp = outCards(v); // u dvoje bez špila: točno protivnikove karte
    if (opp.length !== v.players[op].handCount) return null;
    const memo = new Map();
    // vraća razliku bela (ja - protivnik) do kraja ruke
    function solve(myH, opH, trick, turn) {
      if (trick.length === 2) {
        const w = T.trickWinnerIndex(trick);
        const wp = trick[w].p;
        let pts = bele(trick[0].card) + bele(trick[1].card);
        if (!myH.length && !opH.length) pts += T.LAST_BELE;
        const r = (myH.length || opH.length) ? solve(myH, opH, [], wp).val : 0;
        return { val: r + (wp === me ? pts : -pts) * (v.low ? -1 : 1) };
      }
      const key = trick.length ? null : myH.join() + '|' + opH.join() + '|' + turn;
      if (key && memo.has(key)) return memo.get(key);
      const hand = turn === me ? myH : opH;
      const legal = T.legalCards(hand, trick);
      let best = null;
      for (const c of legal) {
        const nh = hand.filter(x => x !== c);
        const nt = trick.concat([{ p: turn, card: c }]);
        const nturn = 1 - turn;
        const r = turn === me ? solve(nh, opH, nt, nturn) : solve(myH, nh, nt, nturn);
        if (!best || (turn === me ? r.val > best.val : r.val < best.val)) best = { val: r.val, card: c };
      }
      if (key) memo.set(key, best);
      return best;
    }
    const sorted = a => a.slice().sort();
    const r = solve(sorted(v.hand), sorted(opp), v.trick.slice(), me);
    return r && r.card;
  }

  function choose(v, level) {
    level = level || 'normal';
    if (!v.hand.length) return null;
    const legal = T.legalCards(v.hand, v.trick);
    if (legal.length === 1) return legal[0];
    if (level === 'easy' && Math.random() < 0.5) return legal[rnd(legal.length)];
    if (level === 'hard') {
      if (v.mode === 2 && v.deckCount === 0 && v.hand.length <= 7) {
        const c = endgame2(v);
        if (c) return c;
      }
      return pimc(v, 120);
    }
    return heuristic(v);
  }

  return { choose, heuristic };
});
