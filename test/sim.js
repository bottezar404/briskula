const E = require('../public/engine.js'); const B = require('../public/bot.js');
const assert = require('assert');
function run(mode, levels, n, low) {
  const wins = {}; let draws = 0;
  for (let g = 0; g < n; g++) {
    const st = E.newGame(mode, { bots: Array(mode).fill(true), low });
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
  console.log(low ? 'chi fa meno' : 'briskula', mode, levels.join(','), wins, 'draws', draws);
}
run(2, ['easy', 'normal'], 2000);
run(2, ['normal', 'hard'], 2000);
run(3, ['easy', 'normal', 'hard'], 2000);
run(4, ['easy', 'normal', 'easy', 'normal'], 2000);
run(2, ['easy', 'normal'], 2000, true);
run(2, ['normal', 'hard'], 2000, true);
run(3, ['easy', 'normal', 'hard'], 2000, true);
run(4, ['easy', 'normal', 'easy', 'normal'], 2000, true);
// chi fa meno: manje bodova pobjeđuje, kapot (svih 120) pobjeđuje
function finish(mode, owner) {
  const st = E.newGame(mode, { low: true });
  const last = [{ p: 0, card: 'kupe-2' }, { p: 1, card: 'kupe-4' }];
  st.deck = []; st.players.forEach(p => { p.hand = []; p.won = []; });
  E.fullDeck().filter(c => c !== 'kupe-2' && c !== 'kupe-4').forEach(c => st.players[owner(c)].won.push(c));
  st.trick = last; st.phase = 'collect';
  E.collect(st);
  assert.strictEqual(st.phase, 'over');
  return st.result;
}
let res = finish(2, c => (c === 'kupe-1' || c === 'kupe-3') ? 0 : 1); // 21 : 99
assert.deepStrictEqual(res.winners, [0]); assert(!res.kapot);
res = finish(4, () => 1); // par B ima svih 120
assert(res.kapot); assert.deepStrictEqual(res.winners, [1, 3]);
// trick rules
assert(E.beats('kupe-1', 'kupe-3', 'bate'));
assert(!E.beats('spade-1', 'kupe-2', 'bate'));
assert(E.beats('bate-2', 'kupe-1', 'bate'));
assert.strictEqual(E.trickWinnerIndex([{p:0,card:'kupe-4'},{p:1,card:'kupe-13'},{p:2,card:'dinari-1'}], 'spade'), 1);
console.log('OK');

// ---------------- trešeta ----------------
const T = require('../public/treseta.js'); const TB = require('../public/treseta-bot.js');
function runT(mode, levels, n, low) {
  const sum = Array(mode === 4 ? 2 : mode).fill(0);
  for (let g = 0; g < n; g++) {
    const st = T.newGame(mode, { bots: Array(mode).fill(true), target: 1, low });
    let guard = 0;
    while (st.phase === 'play' || st.phase === 'collect') {
      if (st.phase === 'collect') { T.collect(st); continue; }
      const v = T.viewFor(st, st.turn);
      const c = TB.choose(v, levels[st.turn]);
      assert(T.legalCards(v.hand, v.trick).includes(c), 'nedozvoljena karta ' + c);
      assert(T.play(st, st.turn, c));
      assert(guard++ < 100);
    }
    assert(st.players.every(p => p.hand.length === 0) && st.deck.length === 0);
    const hr = st.handResult;
    const cardPts = hr.teams.reduce((a, t) => a + t.points - t.akPts, 0);
    if (low) { assert(st.akuze.length === 0); if (hr.teams.some(t => t.kapot)) { hr.teams.forEach(t => assert.strictEqual(t.points, t.kapot ? 0 : 11)); continue; } }
    if (mode === 3) assert(cardPts === 10 || cardPts === 11); else assert.strictEqual(cardPts, 11);
    assert.strictEqual(hr.teams.reduce((a, t) => a + t.cardBele, 0), 32 + (mode === 3 ? 0 : 0));
    hr.teams.forEach(t => sum[t.team] += t.points - t.akPts);
  }
  console.log(low ? 'treseta chi fa meno' : 'treseta', mode, levels.join(','), sum.map(x => (x / n).toFixed(2)).join(' : '));
  return sum.map(x => x / n);
}
let r2 = runT(2, ['easy', 'normal'], 300); assert(r2[1] > r2[0]);
runT(3, ['easy', 'normal', 'normal'], 300);
let r4 = runT(4, ['easy', 'normal', 'easy', 'normal'], 300); assert(r4[1] > r4[0]);
r2 = runT(2, ['normal', 'hard'], 20); assert(r2[1] > r2[0]);
r2 = runT(2, ['easy', 'normal'], 300, true); assert(r2[1] < r2[0]);
r4 = runT(4, ['easy', 'normal', 'easy', 'normal'], 300, true); assert(r4[1] < r4[0]);
runT(3, ['easy', 'normal', 'hard'], 10, true);
r2 = runT(2, ['normal', 'hard'], 20, true); assert(r2[1] < r2[0]);
// trešeta na manje: partija završava kad netko dođe do cilja, pobjeđuje tko ima manje
{
  const st = T.newGame(2, { target: 21, low: true });
  while (st.phase !== 'over') {
    if (st.phase === 'hand') { T.nextHand(st); continue; }
    if (st.phase === 'collect') { T.collect(st); continue; }
    T.play(st, st.turn, TB.choose(T.viewFor(st, st.turn), 'normal'));
  }
  const w = st.result.winners[0];
  assert(Math.max(...st.score) >= 21 && st.score[w] < st.score[1 - w] && st.result.low);
}
// pravila trešete
assert.strictEqual(T.trickWinnerIndex([{ p: 0, card: 'kupe-1' }, { p: 1, card: 'kupe-3' }, { p: 2, card: 'bate-3' }]), 1);
assert.strictEqual(T.trickWinnerIndex([{ p: 0, card: 'kupe-13' }, { p: 1, card: 'spade-3' }]), 0);
assert(T.beats('kupe-2', 'kupe-1') && !T.beats('kupe-1', 'kupe-2') && !T.beats('kupe-4', 'kupe-7'));
assert.deepStrictEqual(T.legalCards(['kupe-4', 'bate-3', 'kupe-1'], [{ p: 0, card: 'kupe-7' }]), ['kupe-4', 'kupe-1']);
assert.deepStrictEqual(T.legalCards(['bate-3', 'spade-1'], [{ p: 0, card: 'kupe-7' }]), ['bate-3', 'spade-1']);
let ak = T.findAkuze(['kupe-3', 'kupe-2', 'kupe-1', 'bate-3', 'spade-3', 'dinari-3', 'bate-1', 'spade-1']);
assert.deepStrictEqual(ak.map(a => a.kind + a.pts), ['napolitana3', 'four4', 'three3']);
assert.strictEqual(T.fmt(11), '3⅔'); assert.strictEqual(T.fmt(2), '⅔'); assert.strictEqual(T.fmt(9), '3');
// partija do 21: kraj ruke, nova ruka, pobjednik
{
  const st = T.newGame(4, { target: 21, dealer: 0 });
  let hands = 0;
  while (st.phase !== 'over') {
    if (st.phase === 'hand') { T.nextHand(st); continue; }
    if (st.phase === 'collect') { if (T.collect(st) && (st.phase === 'hand' || st.phase === 'over')) hands++; continue; }
    T.play(st, st.turn, TB.choose(T.viewFor(st, st.turn), 'normal'));
  }
  const w = st.result.winners;
  assert(st.score[w[0] % 2] >= 21 && st.score[w[0] % 2] > st.score[1 - w[0] % 2]);
  assert(hands >= 2 && st.hands.length === hands);
  // ne smije se baciti druga boja ako se ima boja
  const s2 = T.newGame(2, { dealer: 1 });
  const led = s2.players[0].hand[0]; T.play(s2, 0, led);
  const h = s2.players[1].hand, same = h.filter(c => T.suitOf(c) === T.suitOf(led)), other = h.find(c => T.suitOf(c) !== T.suitOf(led));
  if (same.length && other) assert(!T.play(s2, 1, other));
}
console.log('TREŠETA OK');
