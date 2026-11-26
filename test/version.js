// Broj verzije u public/version.js mora biti isti kao u package.json, a popis promjena uredan.
const assert = require('assert');
const pkg = require('../package.json');
const { VERSION, NOTES } = require('../public/version.js');
assert.strictEqual(VERSION, pkg.version, `public/version.js (${VERSION}) i package.json (${pkg.version}) nemaju isti broj verzije`);
const num = v => v.split('.').map(Number);
const cmp = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
NOTES.forEach((n, i) => {
  assert.match(n.v, /^\d+\.\d+\.\d+$/, 'loš broj verzije: ' + n.v);
  assert.match(n.d, /^\d{4}-\d{2}-\d{2}$/, 'loš datum: ' + n.d);
  assert.ok(n.t && n.t.length <= 140, 'opis mora biti kratak: ' + n.v);
  if (i) assert.ok(cmp(NOTES[i - 1].v, n.v) > 0, 'verzije moraju ići od najnovije prema starijima: ' + n.v);
});
console.log('verzija ok', VERSION, '(' + NOTES.length + ' unosa)');
