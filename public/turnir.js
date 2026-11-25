/* Turnir: niz igara (briškula → trešeta → poker) s ukupnim poretkom.
 * Dijeli se između preglednika i servera.
 *
 * Bodovanje: u svakoj igri dobiješ 1 bod za svakog protivnika kojeg si nadigrao
 * (izjednačeno = ½). U dvoje je to 1 ili 0, u troje 2/1/0, u pokeru u četvero 3/2/1/0,
 * a u parovima (briškula, trešeta) pobjednički par dobije po 2 boda.
 * Na kraju pobjeđuje tko ima najviše bodova; ako je izjednačeno, odlučuje bolji plasman u zadnjoj igri.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Turnir = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STAGES = ['briskula', 'treseta', 'poker'];
  const NAMES = { briskula: 'Briškula', treseta: 'Trešeta', poker: 'Poker' };

  function newTour(mode) {
    return { stages: STAGES.slice(), idx: 0, mode, points: Array(mode).fill(0), results: [], done: false };
  }
  const stageKind = t => t.stages[Math.min(t.idx, t.stages.length - 1)];
  // u parovima (4 igrača) briškula i trešeta su par protiv para; poker je uvijek svatko za sebe
  const mateOf = (kind, mode, p, q) => kind !== 'poker' && mode === 4 && p % 2 === q % 2;

  /** mjesto svakog igrača u jednoj igri (1 = najbolji, izjednačeni dijele mjesto) */
  function places(kind, mode, res) {
    if (kind === 'poker') return Array.from({ length: mode }, (_, p) => res.place.indexOf(p) + 1);
    const sideOf = p => mode === 4 ? p % 2 : p;
    const sides = res.scores.map(s => ({ team: s.team, win: !res.draw && s.players.every(p => res.winners.includes(p)), pts: s.points }));
    const better = (a, b) => {
      if (res.draw) return false;
      if (a.win !== b.win) return a.win;
      if (res.forfeit != null) return false; // istek vremena: ostali gubitnici su izjednačeni
      return res.low ? a.pts < b.pts : a.pts > b.pts;
    };
    const rank = {};
    for (const s of sides) rank[s.team] = 1 + sides.filter(o => o !== s && better(o, s)).length;
    return Array.from({ length: mode }, (_, p) => rank[sideOf(p)]);
  }

  /** upiši rezultat igre u turnir; vraća bodove iz ove igre */
  function record(t, kind, res) {
    const mode = t.mode;
    const pl = places(kind, mode, res);
    const pts = pl.map((mine, p) => {
      let s = 0;
      for (let q = 0; q < mode; q++) {
        if (q === p || mateOf(kind, mode, p, q)) continue;
        if (pl[q] > mine) s += 1; else if (pl[q] === mine) s += 0.5;
      }
      return s;
    });
    pts.forEach((x, p) => { t.points[p] += x; });
    t.results.push({ kind, places: pl, pts });
    t.idx++;
    if (t.idx >= t.stages.length) t.done = true;
    return pts;
  }

  /** ukupni poredak: [{ p, points, place }] */
  function standings(t) {
    const last = t.results[t.results.length - 1];
    const order = t.points.map((x, p) => p).sort((a, b) => t.points[b] - t.points[a] || (last ? last.places[a] - last.places[b] : 0) || a - b);
    const out = [];
    order.forEach((p, i) => {
      const prev = out[i - 1];
      const tied = prev && t.points[p] === prev.points && (!last || last.places[p] === last.places[prev.p]);
      out.push({ p, points: t.points[p], place: tied ? prev.place : i + 1 });
    });
    return out;
  }

  const fmt = x => (Math.floor(x) || (x % 1 ? '' : '0')) + (x % 1 ? '½' : '');

  return { STAGES, NAMES, newTour, stageKind, places, record, standings, fmt };
});
