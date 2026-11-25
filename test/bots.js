// Primjeri situacija u kojima su botovi prije igrali besmisleno.
const assert = require('assert');
const B = require('../public/bot.js');
const TB = require('../public/treseta-bot.js');
const T = require('../public/treseta.js');

// ---------------- briškula ----------------
// rani dio partije: ništa nije odigrano, svi imaju 3 karte (2 ako su već bacili u ovaj štih)
function bview(o) {
  const mode = o.mode || 2, you = o.you || 0, trick = o.trick || [];
  const players = Array.from({ length: mode }, (_, q) => ({ handCount: q === you || !trick.some(t => t.p === q) ? 3 : 2 }));
  const inHands = players.reduce((s, p) => s + p.handCount, 0);
  return Object.assign({
    mode, low: false, you, hand: [], partnerHand: null, trick, trump: 'spade-5', trumpSuit: 'spade',
    trumpInDeck: true, deckCount: 40 - inHands - trick.length, played: [], leader: trick.length ? trick[0].p : you, trickNo: 0, players,
  }, o, { turn: you });
}
const bris = (o, lvl) => B.choose(bview(o), lvl || 'normal');
const many = (f, n) => { const r = {}; for (let i = 0; i < (n || 5); i++) { const c = f(); r[c] = (r[c] || 0) + 1; } return r; };
function always(name, f, want, lvls) {
  for (const l of lvls || ['normal', 'hard']) {
    const r = many(() => f(l), l === 'hard' ? 3 : 6);
    const ok = Array.isArray(want) ? Object.keys(r).every(c => want.includes(c)) : Object.keys(r).every(c => c !== want.not);
    assert(ok, name + ' [' + l + ']: ' + JSON.stringify(r));
  }
}

// 1) parovi: suigrač nosi peticom, a protivnik iza mene lako preuzme -> ne karikaj tricu
always('nesigurno karikanje', l => bris({ mode: 4, you: 2, leader: 0, hand: ['bate-3', 'kupe-4', 'dinari-6'],
  trick: [{ p: 0, card: 'kupe-5' }, { p: 1, card: 'kupe-2' }] }, l), { not: 'bate-3' });
// 2) parovi: protivnik vodi 7, ja drugi s asom te boje – iza mene protivnik može sjeći briškulom -> ne baci asa
always('as u nesiguran štih', l => bris({ mode: 4, you: 1, leader: 0, hand: ['kupe-1', 'dinari-2', 'bate-5'],
  trick: [{ p: 0, card: 'kupe-7' }] }, l), { not: 'kupe-1' }, ['normal']);
// 3) dvoje: protivnik baci dvicu, ne troši tricu briškule na prazan štih
always('trica briškule na dvicu', l => bris({ hand: ['spade-3', 'dinari-4', 'bate-6'], you: 1, leader: 0,
  trick: [{ p: 0, card: 'kupe-2' }] }, l), { not: 'spade-3' });
// 4) dvoje: protivnik baci asa druge boje -> uzmi ga sitnom briškulom
always('as se reže briškulom', l => bris({ hand: ['spade-2', 'dinari-4', 'bate-6'], you: 1, leader: 0,
  trick: [{ p: 0, card: 'kupe-1' }] }, l), ['spade-2']);
// 5) dvoje: protivnik baci četvorku, imam asa iste boje -> uzmi asom (siguran je)
always('siguran as', l => bris({ hand: ['kupe-1', 'dinari-5', 'bate-6'], you: 1, leader: 0,
  trick: [{ p: 0, card: 'kupe-4' }] }, l), ['kupe-1'], ['normal']);
// 6) parovi: zadnji sam, suigrač nosi -> karikaj (daj mu najviše bodova, ne briškulu)
always('karikanje zadnji', l => bris({ mode: 4, you: 3, leader: 0, hand: ['kupe-3', 'dinari-5', 'spade-1'],
  trick: [{ p: 0, card: 'bate-4' }, { p: 1, card: 'bate-13' }, { p: 2, card: 'bate-6' }] }, l), ['kupe-3']);
// 7) dvoje: ne vodi se tricom dok je as te boje vani
always('vođenje trice', l => bris({ hand: ['kupe-3', 'dinari-5', 'bate-12'] }, l), { not: 'kupe-3' });
console.log('BRIŠKULA PRIMJERI OK');

// ---------------- trešeta ----------------
// o.out: karte u rukama ostalih igrača (sve ostalo je već odigrano); o.hc: broj karata svakog igrača
function tview(o) {
  const mode = o.mode || 2;
  const inPlay = new Set([...o.hand, ...o.trick.map(t => t.card), ...o.out]);
  o.played = T.fullDeck().filter(c => !inPlay.has(c));
  o.players = o.hc.map(n => ({ handCount: n, points: 0 }));
  delete o.out; delete o.hc;
  return Object.assign({
    kind: 'treseta', mode, low: false, you: 0, hand: [], trick: [], deckCount: 0, played: [], leader: 0, turn: 0, trickNo: 5,
    known: Array.from({ length: mode }, () => []), voids: Array.from({ length: mode }, () => []), akuze: [], score: Array(mode === 4 ? 2 : mode).fill(0), handNo: 1, hands: [],
  }, o, { turn: o.you || 0 });
}
const tres = (o, l) => TB.choose(tview(Object.assign({}, o)), l);
// 8) parovi: suigrač igra tricu (najjaču), ja zadnji -> karikaj asom, ne sitnom kartom
always('trešeta karikanje', l => tres({ mode: 4, you: 3, leader: 0, hc: [2, 2, 2, 3], out: ['kupe-2', 'bate-1', 'dinari-3', 'spade-2', 'spade-7', 'dinari-5'], hand: ['kupe-1', 'kupe-5', 'bate-4'],
  trick: [{ p: 0, card: 'kupe-4' }, { p: 1, card: 'kupe-3' }, { p: 2, card: 'kupe-6' }] }, l), ['kupe-1']);
// 9) dvoje: protivnik vodi kralja, imam asa i petu -> uzmi asom
always('trešeta uzmi asom', l => tres({ you: 1, hc: [3, 4], out: ['kupe-6', 'spade-3', 'dinari-2'], hand: ['kupe-1', 'kupe-5', 'bate-4', 'dinari-6'],
  trick: [{ p: 0, card: 'kupe-13' }] }, l), ['kupe-1']);
// 10) na manje: protivnik vodi dvicu, ja imam asa i četvorku te boje -> istovari asa (ne nosim)
always('na manje istovari asa', l => tres({ low: true, you: 1, hc: [3, 4], out: ['kupe-3', 'spade-1', 'bate-2'], hand: ['kupe-1', 'kupe-4', 'bate-5', 'dinari-6'],
  trick: [{ p: 0, card: 'kupe-2' }] }, l), ['kupe-1']);
console.log('TREŠETA PRIMJERI OK');
