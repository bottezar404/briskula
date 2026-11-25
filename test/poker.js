// Poker: pravila, procjena ruku, simulacija partija botova
const P = require('../public/poker.js'); const PB = require('../public/poker-bot.js');
const assert = require('assert');
const ev = s => P.evaluate(s.split(' '));
const H = s => P.catOf(ev(s));
// kategorije
assert.strictEqual(H('kupe-1 kupe-13 kupe-12 kupe-11 kupe-7'), 8); // skala u boji (7-A)
assert.strictEqual(H('kupe-1 dinari-2 spade-3 bate-4 kupe-5'), 3);  // skala A-5
assert.strictEqual(H('kupe-7 dinari-11 spade-12 bate-13 kupe-1'), 3); // 7-F-C-K-A je skala
assert.strictEqual(H('kupe-1 kupe-3 kupe-5 kupe-7 kupe-12'), 6);   // boja
assert.strictEqual(H('kupe-1 dinari-1 spade-1 kupe-5 dinari-5'), 5); // ful
assert.strictEqual(H('kupe-1 dinari-1 spade-1 kupe-5 dinari-7'), 4); // tris
// poredak 40 karata: tris > skala, boja > ful
assert(ev('kupe-2 dinari-2 spade-2 kupe-5 dinari-7') > ev('kupe-1 dinari-13 spade-12 bate-11 kupe-7'));
assert(ev('kupe-2 kupe-4 kupe-5 kupe-7 kupe-6') > ev('kupe-1 dinari-1 spade-1 kupe-13 dinari-13'));
assert(ev('kupe-2 dinari-3 spade-4 bate-5 kupe-6') > ev('kupe-1 dinari-2 spade-3 bate-4 kupe-5')); // 6-visoka > A-5
assert(ev('kupe-1 dinari-1 spade-13 bate-4 kupe-5') > ev('kupe-13 dinari-13 spade-1 bate-4 kupe-5'));
// 7 karata: tris i skala zajedno -> tris
assert.strictEqual(H('kupe-3 dinari-3 spade-3 bate-4 kupe-5 dinari-6 spade-7'), 4);
assert.strictEqual(P.handName(ev('kupe-1 dinari-1 spade-1 kupe-5 dinari-5')), 'Ful (asovi na petice)');

// sporedni lonac: A (100) all-in protiv B i C (po 300)
{
  const st = P.newGame(3, { dealer: 0, chips: 1000 });
  st.players[0].chips = 100; st.players[1].chips = 300; st.players[2].chips = 300;
  // namjesti ruku ručno
  for (const pl of st.players) { pl.total = 0; pl.bet = 0; pl.folded = false; pl.allIn = false; }
  st.players[0].hole = ['kupe-1', 'dinari-1']; st.players[1].hole = ['kupe-13', 'dinari-13']; st.players[2].hole = ['kupe-2', 'dinari-4'];
  st.board = ['spade-1', 'bate-13', 'kupe-5', 'dinari-6', 'spade-11'];
  st.players[0].total = 100; st.players[0].chips = 0; st.players[0].allIn = true;
  st.players[1].total = 300; st.players[1].chips = 0; st.players[1].allIn = true;
  st.players[2].total = 300; st.players[2].chips = 0; st.players[2].allIn = true;
  st.phase = 'collect'; st.street = 3;
  P.collect(st);
  assert.deepStrictEqual(st.players.map(p => p.chips), [300, 400, 0]); // A glavni lonac 300, B sporedni 400
  assert.deepStrictEqual(st.elim, [2]);
}

function run(mode, levels, n) {
  const wins = Array(mode).fill(0); let hands = 0;
  for (let g = 0; g < n; g++) {
    const st = P.newGame(mode, { bots: Array(mode).fill(true), chips: 500 });
    let guard = 0;
    while (st.phase !== 'over') {
      assert(guard++ < 20000, 'predugo');
      if (st.phase === 'collect') { P.collect(st); continue; }
      if (st.phase === 'hand') {
        const tot = st.players.reduce((a, p) => a + p.chips, 0);
        assert.strictEqual(tot, 500 * mode, 'žetoni se ne slažu');
        P.nextHand(st); continue;
      }
      const v = P.viewFor(st, st.turn);
      assert(v.legal, 'nema poteza za ' + st.turn);
      // protivničke karte se ne vide
      for (let q = 0; q < mode; q++) if (q !== st.turn) assert(!v.shown[q]);
      const mv = PB.choose(v, levels[st.turn]);
      assert(P.play(st, st.turn, mv), 'neispravan potez ' + mv + ' ' + JSON.stringify(v.legal));
    }
    const tot = st.players.reduce((a, p) => a + p.chips, 0);
    assert.strictEqual(tot, 500 * mode);
    assert.strictEqual(st.result.place.length, mode);
    wins[st.result.winners[0]]++; hands += st.handNo;
  }
  console.log('poker', mode, levels.join(','), 'pobjede', wins, 'prosj. ruku', (hands / n).toFixed(1));
}
run(2, ['easy', 'normal'], 30);
run(2, ['normal', 'hard'], 30);
run(3, ['easy', 'normal', 'hard'], 20);
run(4, ['easy', 'normal', 'hard', 'normal'], 15);
console.log('poker OK');
