// Sigurnosna zaglavlja (Mozilla HTTP Observatory) i neispravan URL ne smije srušiti server.
'use strict';
process.env.PORT = 0;
const assert = require('assert');
const http = require('http');
const server = require('../server/index.js');
const get = (port, p, host) => new Promise((res, rej) => {
  http.get({ port, path: p, headers: host ? { Host: host } : {} }, r => { r.resume(); r.on('end', () => res(r)); }).on('error', rej);
});
(async () => {
  await new Promise(r => server.listening ? r() : server.on('listening', r));
  const port = server.address().port;
  for (const p of ['/', '/app.js', '/sw.js', '/nema-me', '/health']) {
    const r = await get(port, p);
    assert.strictEqual(r.statusCode, 200, p);
    const h = r.headers, csp = h['content-security-policy'] || '';
    assert.match(h['strict-transport-security'], /max-age=\d{8,}/, p);
    assert.strictEqual(h['x-content-type-options'], 'nosniff', p);
    assert.strictEqual(h['x-frame-options'], 'DENY', p);
    assert.ok(h['referrer-policy'], p);
    for (const d of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-ancestors 'none'", 'img-src \'self\' data: blob:'])
      assert.ok(csp.includes(d), p + ' CSP: ' + d);
    assert.ok(!/script-src[^;]*unsafe/.test(csp), 'script-src bez unsafe');
    assert.ok(/connect-src 'self' wss:\/\/localhost:\d+/.test(csp), 'connect-src ws');
  }
  const bad = await get(port, '/x', 'evil.com; script-src *');
  assert.ok(!bad.headers['content-security-policy'].includes('evil'), 'Host se ne ubacuje u CSP');
  const mal = await get(port, '/%E0%A4%A');
  assert.strictEqual(mal.statusCode, 400);
  assert.strictEqual((await get(port, '/health')).statusCode, 200, 'server živ nakon neispravnog URL-a');
  console.log('sigurnosna zaglavlja ok');
  server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
