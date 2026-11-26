// Poker: pravila, procjena ruku, simulacija partija botova
const P = require('../public/poker.js'); const PB = require('../public/poker-bot.js');
const assert = require('assert');
const ev = s => P.evaluate(s.split(' '));
const H = s => P.catOf(ev(s));
// kategorije (standardni poker, 52 karte)
assert.strictEqual(P.fullDeck().length, 52);
assert.strictEqual(new Set(P.fullDeck()).size, 52);
assert.strictEqual(H('herc-14 herc-13 herc-12 herc-11 herc-10'), 8); // kraljevska skala u boji
assert.strictEqual(P.handName(ev('herc-14 herc-13 herc-12 herc-11 herc-10')), 'Kraljevska skala u boji');
assert.strictEqual(H('pik-14 herc-2 karo-3 tref-4 pik-5'), 4);  // skala A-5
assert.strictEqual(H('pik-10 herc-11 karo-12 tref-13 pik-14'), 4); // 10-A skala
assert.strictEqual(H('pik-13 herc-14 karo-2 tref-3 pik-4'), 0); // nema "okretanja" preko asa
assert.strictEqual(H('karo-14 karo-3 karo-5 karo-7 karo-12'), 5);   // boja
assert.strictEqual(H('pik-14 herc-14 karo-14 pik-5 herc-5'), 6); // ful
assert.strictEqual(H('pik-14 herc-14 karo-14 pik-5 herc-7'), 3); // tris
assert.strictEqual(H('pik-9 herc-9 karo-9 tref-9 herc-7'), 7); // poker
// standardni poredak: skala > tris, ful > boja, boja > skala
assert(ev('pik-2 herc-3 karo-4 tref-5 pik-6') > ev('pik-14 herc-14 karo-14 tref-13 pik-12'));
assert(ev('pik-2 herc-2 karo-2 pik-5 herc-5') > ev('karo-14 karo-13 karo-12 karo-11 karo-9'));
assert(ev('karo-2 karo-4 karo-5 karo-7 karo-9') > ev('pik-10 herc-11 karo-12 tref-13 pik-14'));
assert(ev('pik-2 herc-3 karo-4 tref-5 pik-6') > ev('pik-14 herc-2 karo-3 tref-4 pik-5')); // 6-visoka > A-5
assert(ev('pik-14 herc-14 karo-13 tref-4 pik-5') > ev('pik-13 herc-13 karo-14 tref-4 pik-5'));
assert(ev('pik-10 herc-10 karo-14 tref-4 pik-5') > ev('pik-10 herc-10 karo-13 tref-4 pik-5')); // kicker
// 7 karata: tris i skala zajedno -> skala; boja i skala -> boja
assert.strictEqual(H('pik-3 herc-3 karo-3 tref-4 pik-5 herc-6 karo-7'), 4);
assert.strictEqual(H('karo-3 karo-8 karo-10 karo-12 karo-2 pik-4 tref-5'), 5);
assert.strictEqual(H('pik-3 herc-3 karo-3 tref-5 pik-5 herc-5 karo-7'), 6); // dva trisa = ful
assert.strictEqual(P.handName(ev('pik-14 herc-14 karo-14 pik-5 herc-5')), 'Ful (asovi na petice)');
assert.strictEqual(P.handName(ev('pik-12 herc-12 karo-11 tref-11 pik-5')), 'Dva para (dame i dečki)');
assert.strictEqual(P.handName(ev('pik-12 herc-9 karo-2 tref-5 pik-7')), 'Visoka karta (Q)');
assert.deepStrictEqual(P.bestFive('pik-14 herc-14 karo-14 pik-5 herc-5 tref-2 karo-9'.split(' ')).sort(), 'pik-14 herc-14 karo-14 pik-5 herc-5'.split(' ').sort());

// sporedni lonac: A (100) all-in protiv B i C (po 300)
{
  const st = P.newGame(3, { dealer: 0, chips: 1000 });
  st.players[0].chips = 100; st.players[1].chips = 300; st.players[2].chips = 300;
  // namjesti ruku ručno
  for (const pl of st.players) { pl.total = 0; pl.bet = 0; pl.folded = false; pl.allIn = false; }
  st.players[0].hole = ['pik-14', 'herc-14']; st.players[1].hole = ['pik-13', 'herc-13']; st.players[2].hole = ['pik-2', 'herc-4'];
  st.board = ['karo-14', 'tref-13', 'pik-5', 'herc-8', 'karo-11'];
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
