/* Povijest online partija: tko je što odigrao.
 *
 * Potezi se bilježe tako da se omotaju funkcije play/collect/nextHand svih igara,
 * ali samo za partije koje je server prijavio s begin() (WeakMap; simulacije botova se ne bilježe).
 * Zapis jednog poteza (kratko, da stane u bazu):
 *   { p, c }            karta (briškula, trešeta)
 *   { w, pts }          tko je nosio štih i koliko bodova
 *   { p, a, ... }       zapis iz igre (poker: fold/check/call/raise, Čovječe: roll/move)
 *   { hr }              poker: ishod ruke (dobici, stol, pokazane ruke)
 *   { p, q, m }         kviz: odgovor igrača p na pitanje q
 *   { h, akuze }        nova ruka (trešeta, poker)
 */
'use strict';

const MOVES = new WeakMap(); // stanje igre -> popis poteza
const MAX_MOVES = 3000;

function push(g, x) {
  const L = MOVES.get(g);
  if (L && L.length < MAX_MOVES) L.push(x);
}
// novi zapisi u g.log od zadnjeg poznatog (igre ga skraćuju, pa se traži po objektu)
function logSince(g, last) {
  if (!Array.isArray(g.log)) return [];
  const i = last ? g.log.lastIndexOf(last) : -1;
  return g.log.slice(i + 1);
}
const lastLog = g => Array.isArray(g.log) && g.log.length ? g.log[g.log.length - 1] : null;

// igre koje same vode zapis poteza u g.log
const hasLog = g => (g.kind === 'poker' || g.kind === 'covjece') && Array.isArray(g.log);

function addLog(g, entries) {
  for (const e of entries) {
    push(g, Object.assign({}, e, e.a === 'street' && Array.isArray(g.board) ? { board: g.board.slice() } : {}));
    if (e.a === 'end' && g.handResult) {
      const h = g.handResult;
      push(g, { hr: { won: h.won, delta: h.delta, board: h.board, hands: Object.fromEntries(Object.entries(h.hands || {}).map(([p, x]) => [p, { name: x.name, hole: (g.shown && g.shown[p]) || null }])), busted: h.busted } });
    }
  }
}

/** omotaj funkcije igara (jednom pri pokretanju servera) */
function instrument(engines) {
  for (const eng of engines) {
    if (!eng || eng.__hist) continue;
    eng.__hist = true;
    const play = eng.play, collect = eng.collect, nextHand = eng.nextHand;
    eng.play = function (g, p, mv, ...rest) {
      if (!MOVES.has(g)) return play.call(this, g, p, mv, ...rest);
      const last = lastLog(g), qi = g.qi;
      const ok = play.call(this, g, p, mv, ...rest);
      if (ok) {
        if (g.kind === 'kviz') { const an = g.players[p] && g.players[p].ans; push(g, { p, q: qi, m: String(mv).slice(0, 60), ok: !!(an && an.ok) }); }
        else if (hasLog(g)) addLog(g, logSince(g, last));
        else push(g, { p, c: String(mv) });
      }
      return ok;
    };
    if (collect) eng.collect = function (g, ...rest) {
      if (!MOVES.has(g)) return collect.call(this, g, ...rest);
      const last = lastLog(g), lt = g.lastTrick;
      const ok = collect.apply(this, [g, ...rest]);
      if (hasLog(g)) addLog(g, logSince(g, last));
      else if (g.lastTrick && g.lastTrick !== lt) push(g, { w: g.lastTrick.winner, pts: g.lastTrick.points });
      return ok;
    };
    if (nextHand) eng.nextHand = function (g, ...rest) {
      if (!MOVES.has(g)) return nextHand.call(this, g, ...rest);
      const ok = nextHand.apply(this, [g, ...rest]);
      if (ok) { handStart(g); if (hasLog(g)) addLog(g, g.log); }
      return ok;
    };
  }
}
function handStart(g) {
  const x = { h: g.handNo || 0 };
  if (g.akuze && g.akuze.length) x.akuze = g.akuze.map(a => ({ p: a.p, text: a.text, pts: a.pts }));
  if (g.trump) x.trump = g.trump;
  push(g, x);
}

/** početak bilježenja partije */
function begin(g) {
  MOVES.set(g, []);
  if (g.kind !== 'kviz' && g.kind !== 'covjece') handStart(g);
  if (g.kind === 'poker') addLog(g, g.log);
}

/** zapis cijele partije za bazu (null ako se ne bilježi) */
function build(r, g, players) {
  const moves = MOVES.get(g);
  if (!moves) return null;
  MOVES.delete(g);
  const res = g.result || {};
  const doc = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    t: Date.now(), kind: g.kind || r.kind, low: !!r.low, mode: r.mode, target: g.target || null, tour: !!r.tour,
    players,
    result: {
      winners: res.winners || [], draw: !!res.draw, forfeit: res.forfeit == null ? null : res.forfeit, kapot: !!res.kapot,
      place: res.place || null,
      scores: (res.scores || []).map(s => ({ players: s.players, points: s.points, correct: s.correct })),
    },
    moves,
  };
  if (g.kind === 'kviz') doc.qs = g.qs.map(q => ({ text: q.text, opts: q.opts, ans: q.ans, answer: q.answer || null, round: q.round, mult: q.mult }));
  return doc;
}

module.exports = { instrument, begin, build };
