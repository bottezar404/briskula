const E = require('../public/engine.js'); const B = require('../public/bot.js');
const assert = require('assert');
function run(mode, levels, n) {
  const wins = {}; let draws = 0;
  for (let g = 0; g < n; g++) {
    const st = E.newGame(mode, { bots: Array(mode).fill(true) });
    let guard = 0;
    while (st.phase !== 'over') {
      if (st.phase === 'collect') { E.collect(st); continue; }
      const v = E.viewFor(st, st.turn);
      const c = B.choose(v, levels[st.turn]);
      assert(E.play(st, st.turn, c), 'invalid ' + c);
      assert(guard++ < 500);
    }
    const tot = st.result.scores.reduce((s, x) => s + x.points, 0);
    assert.strictEqual(tot, 120);
    assert(st.players.every(p => p.hand.length === 0));
    if (st.result.draw) draws++; else { const k = st.result.winners.join('+'); wins[k] = (wins[k] || 0) + 1; }
  }
  console.log(mode, levels.join(','), wins, 'draws', draws);
}
run(2, ['easy', 'normal'], 2000);
run(2, ['normal', 'hard'], 2000);
run(3, ['easy', 'normal', 'hard'], 2000);
run(4, ['easy', 'normal', 'easy', 'normal'], 2000);
// trick rules
assert(E.beats('kupe-1', 'kupe-3', 'bate'));
assert(!E.beats('spade-1', 'kupe-2', 'bate'));
assert(E.beats('bate-2', 'kupe-1', 'bate'));
assert.strictEqual(E.trickWinnerIndex([{p:0,card:'kupe-4'},{p:1,card:'kupe-13'},{p:2,card:'dinari-1'}], 'spade'), 1);
console.log('OK');
