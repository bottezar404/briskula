/* Kviz „Znalac” – botovi (dijeli se između preglednika i servera)
 * plan(g, p, level, rng) vraća { delay, move }: za koliko ms bot odgovara i što.
 * Bot „zna” odgovor s određenom vjerojatnošću (ovisno o jačini), a svaki bot ima
 * jednu jaču kategoriju (izabranu po imenu, ista cijelu partiju).
 *  easy   – pogađa oko 45 %, sporiji
 *  normal – oko 65 %
 *  hard   – oko 85 %, brz
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./kviz.js'));
  else root.KvizBot = factory(root.KvizEngine);
})(typeof self !== 'undefined' ? self : this, function (K) {
  'use strict';
  const LV = {
    easy: { p: 0.45, min: 0.35, max: 0.85 },
    normal: { p: 0.65, min: 0.25, max: 0.7 },
    hard: { p: 0.85, min: 0.15, max: 0.55 },
  };
  const hash = s => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
  const strongCat = name => K.CATS[hash(name) % K.CATS.length].id;

  function plan(g, p, level, rng) {
    rng = rng || Math.random;
    const L = LV[level] || LV.normal;
    const q = g.qs[g.qi], pl = g.players[p];
    let know = L.p + (q.cat === strongCat(pl.name) ? 0.15 : 0);
    know = Math.min(0.97, know);
    const sure = rng() < know;
    // tko zna, odgovori brže; tko nagađa, duže razmišlja (ponekad i ne stigne)
    const span = L.max - L.min;
    let f = L.min + span * (sure ? rng() * 0.7 : 0.35 + rng() * 0.75);
    const delay = Math.round(g.qTime * f);
    const wrong = [0, 1, 2, 3].filter(i => i !== q.ans);
    // i kad ne zna, ponekad pogodi (1 od 4)
    const c = sure ? q.ans : rng() < 0.25 ? q.ans : wrong[Math.floor(rng() * 3)];
    return { delay, move: 'a:' + c };
  }
  // za zajedničko sučelje s ostalim botovima (ne koristi se za odluku o vremenu)
  function choose(view) { return view.legal && view.legal.length ? view.legal[0] : null; }
  return { plan, choose, strongCat };
});
