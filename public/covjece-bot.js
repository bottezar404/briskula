/* Čovječe ne ljuti se – botovi (dijeli se između preglednika i servera)
 * choose(view, level) vraća 'roll' ili 'm:N'.
 *  easy   – uglavnom nasumično, ali rado jede i izlazi iz kućice
 *  normal – ocjena poteza: jedenje, izlazak, ulazak u cilj, opasnost od tuđih figura
 *  hard   – isto, s točnijom procjenom opasnosti (vjerojatnost da te netko pojede) i čuvanjem starta
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./covjece.js'));
  else root.CovjeceBot = factory(root.CovjeceEngine);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const { TRACK, abs } = C;

  // vjerojatnost da tuđa figura s udaljenosti dist (1–12 polja iza) dođe točno na to polje u jednom potezu
  function hitChance(dist) {
    if (dist >= 1 && dist <= 6) return 1 / 6; // izravno
    if (dist > 6 && dist <= 12) return 1 / 36; // šestica pa ostatak
    return 0;
  }

  // opasnost na zajedničkom polju sq za igrača p (zbroj šansi svih protivničkih figura iza)
  function danger(v, p, sq, ignore) {
    let risk = 0;
    for (let q = 0; q < v.mode; q++) {
      if (q === p) continue;
      const o = v.players[q];
      for (let i = 0; i < 4; i++) {
        if (ignore && ignore.p === q && ignore.i === i) continue;
        const x = o.pieces[i];
        if (x < 0 || x >= TRACK) continue;
        const from = abs(o.color, x);
        const dist = (sq - from + TRACK) % TRACK;
        // tuđa figura ne može proći svoj ulaz u cilj (39 koraka od starta)
        if (dist && x + dist <= TRACK - 1) risk += hitChance(dist);
      }
      // polje je tuđi start, a protivnik ima figure u kućici: izlazi sa šesticom i jede
      if (sq === abs(o.color, 0) && o.pieces.some(x => x < 0)) risk += 1 / 6;
    }
    return Math.min(1, risk);
  }

  // težine (hard je podešen simulacijama protiv normal: ~54 % pobjeda u dvoje; igra je puno sreće)
  const W = {
    normal: { cap: 40, capk: 0.8, out: 30, save: 35, prog: 0.4, d1: 35, d2: 40, dk: 0.75, start: 5 },
    hard: { cap: 40, capk: 0.8, out: 15, save: 35, prog: 0.4, d1: 60, d2: 70, dk: 2, start: 5 },
  };
  function score(v, p, mv, level) {
    const w = W[level] || W.normal;
    const me = v.players[p];
    let s = 0;
    // jedenje: što je pojedena figura dalje stigla, to bolje
    if (mv.cap) s += w.cap + v.players[mv.cap.p].pieces[mv.cap.i] * w.capk;
    if (mv.from < 0) s += w.out;
    if (mv.to >= TRACK && mv.from < TRACK) s += w.save; // ulazak u cilj (spašena figura)
    if (mv.to >= TRACK) s += (mv.to - TRACK) * 2; // u cilju što dublje, da ne smeta ostalima
    s += (mv.to - Math.max(0, mv.from)) * w.prog;
    // opasnost prije i poslije poteza (figura koja je dalje stigla vrijedi više)
    if (mv.from >= 0 && mv.from < TRACK) s += danger(v, p, abs(me.color, mv.from)) * w.d1 * (1 + w.dk * mv.from / TRACK);
    if (mv.to < TRACK) s -= danger(v, p, abs(me.color, mv.to), mv.cap) * w.d2 * (1 + w.dk * mv.to / TRACK);
    // vlastiti start: ako u kućici čekaju figure, bolje ga osloboditi
    if (mv.from === 0 && me.pieces.some(x => x < 0)) s += w.start;
    return s;
  }

  function choose(v, level) {
    if (v.need === 'roll' || !v.moves || !v.moves.length) return 'roll';
    const ms = v.moves;
    if (ms.length === 1) return 'm:' + ms[0].i;
    const p = v.turn;
    if (level === 'easy') {
      const good = ms.filter(m => m.cap || m.from < 0);
      if (good.length && Math.random() < 0.6) return 'm:' + good[Math.floor(Math.random() * good.length)].i;
      return 'm:' + ms[Math.floor(Math.random() * ms.length)].i;
    }
    let best = ms[0], bs = -Infinity;
    for (const m of ms) {
      const s = score(v, p, m, level) + Math.random() * 0.5;
      if (s > bs) { bs = s; best = m; }
    }
    return 'm:' + best.i;
  }

  return { choose, danger, score };
});
