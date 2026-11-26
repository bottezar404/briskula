/* Čovječe ne ljuti se – pravila (dijeli se između preglednika i servera)
 *
 * Ploča: staza od 40 polja u obliku križa, 4 boje. Svaka boja ima kućicu (4 rupe u kutu),
 * startno polje na stazi i cilj (4 polja prema sredini).
 *
 * Položaj figure je broj koraka od vlastitog starta:
 *   -1      = u kućici (još nije izašla)
 *   0..39   = na stazi (0 = vlastito startno polje)
 *   40..43  = u cilju
 * Polje na stazi (zajedničko za sve) = (boja * 10 + položaj) % 40.
 *
 * Pravila:
 *  - Iz kućice se izlazi samo sa šesticom (na vlastito startno polje).
 *  - Šestica = još jedno bacanje.
 *  - Tko nema nijednu figuru koja se može micati (sve u kućici ili složene na kraju cilja), baca do 3 puta.
 *  - Na polje gdje je tuđa figura: ona se vraća u svoju kućicu („pojedena”). Na svoju figuru se ne može.
 *  - U cilj se ulazi točnim brojem; u cilju se ne preskaču vlastite figure.
 *  - Pobjeđuje tko prvi dovede sve 4 figure u cilj (ostali su poredani po tome koliko su blizu).
 *  - Potezi su tekst: 'roll' (baci kocku) ili 'm:N' (pomakni figuru N, 0–3).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CovjeceEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TRACK = 40, LANE = 4, PIECES = 4, FINISH = TRACK + LANE - 1; // 43
  const TRIES = 3;
  const COLOR_NAMES = ['Crveni', 'Plavi', 'Zeleni', 'Žuti'];
  // boje po broju igrača: u dvoje sjede jedan nasuprot drugome
  const COLORS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

  const abs = (color, pos) => (color * 10 + pos) % TRACK;

  function newGame(mode, opts) {
    opts = opts || {};
    const names = opts.names || [];
    const colors = COLORS[mode] || COLORS[4];
    const players = Array.from({ length: mode }, (_, i) => ({
      name: names[i] || 'Igrač ' + (i + 1), bot: !!(opts.bots && opts.bots[i]),
      color: colors[i], pieces: [-1, -1, -1, -1], caps: 0, lost: 0, sixes: 0,
    }));
    const first = opts.dealer != null && opts.dealer >= 0 ? opts.dealer % mode : Math.floor(Math.random() * mode);
    return {
      kind: 'covjece', mode, players, turn: first, phase: 'play', need: 'roll',
      die: 0, dieBy: -1, rolls: 0, tries: 0, moves: [], pend: null,
      trickNo: 0, trick: [], last: null, log: [], result: null, dealer: first, rng: opts.rng || Math.random,
    };
  }

  // tko stoji na polju staze (zajedničko polje): { p, i } ili null
  function occupant(st, sq) {
    for (let p = 0; p < st.mode; p++) {
      const pl = st.players[p];
      for (let i = 0; i < PIECES; i++) {
        const x = pl.pieces[i];
        if (x >= 0 && x < TRACK && abs(pl.color, x) === sq) return { p, i };
      }
    }
    return null;
  }

  /** svi mogući potezi igrača p s bacanjem d: [{ i, from, to, cap: {p,i} | null }] */
  function movesFor(st, p, d) {
    const pl = st.players[p], out = [];
    const own = new Set(pl.pieces);
    for (let i = 0; i < PIECES; i++) {
      const from = pl.pieces[i];
      let to;
      if (from < 0) {
        if (d !== 6 || own.has(0)) continue;
        to = 0;
      } else {
        to = from + d;
        if (to > FINISH || own.has(to)) continue;
        // u cilju se ne preskaču vlastite figure
        let blocked = false;
        for (let k = Math.max(TRACK, from + 1); k < to; k++) if (own.has(k)) { blocked = true; break; }
        if (blocked) continue;
      }
      let cap = null;
      if (to < TRACK) {
        const o = occupant(st, abs(pl.color, to));
        if (o && o.p !== p) cap = o;
      }
      out.push({ i, from, to, cap });
    }
    return out;
  }

  // nema figure koja se može micati bez šestice: sve su u kućici ili složene na samom kraju cilja
  function stuck(pl) {
    const own = new Set(pl.pieces);
    return pl.pieces.every(x => {
      if (x < 0) return true;
      if (x < TRACK) return false;
      for (let k = x; k <= FINISH; k++) if (!own.has(k)) return false;
      return true;
    });
  }
  const homeCount = pl => pl.pieces.filter(x => x >= TRACK).length;
  // koliko je igrač blizu cilja (za poredak kad netko pobijedi): zbroj koraka svih figura
  const progress = pl => pl.pieces.reduce((s, x) => s + (x < 0 ? 0 : x + 1), 0);

  function legal(st, p) {
    if (st.phase !== 'play' || st.turn !== p) return null;
    return st.need === 'roll' ? ['roll'] : st.moves.map(m => 'm:' + m.i);
  }

  function nextTurn(st) {
    st.turn = (st.turn + 1) % st.mode;
    st.need = 'roll'; st.tries = 0; st.moves = [];
    st.players[st.turn].sixes = 0;
  }

  /** potez: 'roll' ili 'm:N'. Vraća true ako je potez valjan. */
  function play(st, p, move) {
    if (st.phase !== 'play' || st.turn !== p) return false;
    const pl = st.players[p];
    if (move === 'roll') {
      if (st.need !== 'roll') return false;
      const d = 1 + Math.floor(st.rng() * 6);
      st.die = d; st.dieBy = p; st.rolls++; st.trickNo++;
      const wasStuck = stuck(pl);
      st.tries++;
      if (d === 6) pl.sixes++;
      st.moves = movesFor(st, p, d);
      st.log.push({ p, a: 'roll', d });
      if (st.log.length > 30) st.log.shift();
      if (st.moves.length) { st.need = 'move'; return true; }
      // nema poteza: kratka pauza (da se vidi kocka), pa ponovno bacanje ili sljedeći igrač
      const again = d === 6 || (wasStuck && st.tries < TRIES);
      st.pend = { again };
      st.need = 'none';
      st.phase = 'collect';
      return true;
    }
    const m = /^m:([0-3])$/.exec(String(move));
    if (!m || st.need !== 'move') return false;
    const mv = st.moves.find(x => x.i === +m[1]);
    if (!mv) return false;
    pl.pieces[mv.i] = mv.to;
    if (mv.cap) {
      const v = st.players[mv.cap.p];
      v.pieces[mv.cap.i] = -1; v.lost++; pl.caps++;
    }
    st.trickNo++;
    st.last = { p, i: mv.i, from: mv.from, to: mv.to, cap: mv.cap, n: st.trickNo };
    st.log.push({ p, a: 'move', i: mv.i, from: mv.from, to: mv.to, cap: mv.cap });
    if (st.log.length > 30) st.log.shift();
    st.moves = [];
    if (homeCount(pl) === PIECES) return finish(st, p), true;
    if (st.die === 6) { st.need = 'roll'; st.tries = 0; }
    else nextTurn(st);
    return true;
  }

  /** nakon pauze bez poteza (phase === 'collect'): isti igrač baca ponovno ili je red na sljedećeg */
  function collect(st) {
    if (st.phase !== 'collect') return false;
    const again = st.pend && st.pend.again;
    st.pend = null; st.phase = 'play'; st.trickNo++;
    if (again) { st.need = 'roll'; st.moves = []; if (st.die === 6) st.tries = 0; }
    else nextTurn(st);
    return true;
  }

  function finish(st, winner) {
    const order = st.players.map((_, i) => i).filter(i => i !== winner)
      .sort((a, b) => homeCount(st.players[b]) - homeCount(st.players[a]) || progress(st.players[b]) - progress(st.players[a]));
    const place = [winner].concat(order);
    st.phase = 'over'; st.need = 'none';
    st.result = {
      winners: [winner], draw: false, place,
      scores: st.players.map((pl, i) => ({ team: i, players: [i], points: homeCount(pl), progress: progress(pl) })),
      hands: [],
    };
  }
  function nextHand() { return false; }

  function viewFor(st, p) {
    return {
      kind: 'covjece', mode: st.mode, you: p,
      players: st.players.map(pl => ({ name: pl.name, bot: pl.bot, color: pl.color, pieces: pl.pieces.slice(), caps: pl.caps, lost: pl.lost, home: homeCount(pl) })),
      turn: st.turn, phase: st.phase, need: st.need, die: st.die, dieBy: st.dieBy, rolls: st.rolls, tries: st.tries,
      stuck: st.phase === 'play' ? stuck(st.players[st.turn]) : false,
      moves: st.moves.map(m => ({ i: m.i, from: m.from, to: m.to, cap: m.cap })),
      trickNo: st.trickNo, trick: [], last: st.last, log: st.log.slice(-8), result: st.result, dealer: st.dealer,
      legal: legal(st, p),
    };
  }

  return { TRACK, LANE, PIECES, FINISH, TRIES, COLOR_NAMES, COLORS, abs, newGame, movesFor, stuck, homeCount, progress, legal, play, collect, nextHand, viewFor, occupant };
});
