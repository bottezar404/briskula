/* Trajna pohrana za korisničke račune.
 *
 * Svi zapisi se drže u memoriji (Map ključ -> objekt), a svaka promjena se zapisuje:
 *  - u Postgres, ako postoji DATABASE_URL (npr. besplatna baza na neon.tech) – podaci ostaju i nakon restarta servera;
 *  - inače u JSON datoteku (BRK_DATA_FILE, zadano data/accounts.json) – dobro za lokalni rad,
 *    ali na Renderu (besplatni plan) se datoteke brišu kod svakog restarta i nove verzije.
 *  - BRK_DATA_FILE=':memory:' ništa ne zapisuje (testovi).
 * Tablica je jednostavna: brk_kv(k text primary key, v jsonb).
 */
'use strict';
const fs = require('fs');
const path = require('path');

function open(opts) {
  opts = opts || {};
  const url = opts.url !== undefined ? opts.url : process.env.DATABASE_URL;
  const file = opts.file || process.env.BRK_DATA_FILE || path.join(__dirname, '..', 'data', 'accounts.json');
  const docs = new Map();
  const dirty = new Set();
  let flushTimer = null, flushing = null;
  let backend;

  if (url) {
    const { Pool } = require('pg');
    // lokalna baza bez SSL-a, hostane (Neon, Supabase, Render…) uvijek preko SSL-a.
    // Supabase potpisuje certifikat svojim CA-om koji Node ne poznaje, pa se tamo veza šifrira bez provjere certifikata.
    // (sslmode iz linka se makne jer bi inače on odlučivao o provjeri)
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);
    const supa = /supabase\.(co|com)\b/.test(url);
    const conn = url.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '');
    const pool = new Pool({ connectionString: conn, max: 3, ssl: local ? false : { rejectUnauthorized: !supa } });
    pool.on('error', e => console.error('baza:', e.message));
    backend = {
      kind: 'postgres',
      async load() {
        await pool.query('CREATE TABLE IF NOT EXISTS brk_kv (k text PRIMARY KEY, v jsonb NOT NULL, updated timestamptz NOT NULL DEFAULT now())');
        const { rows } = await pool.query('SELECT k, v FROM brk_kv');
        for (const r of rows) docs.set(r.k, r.v);
      },
      async write(keys) {
        const put = [], del = [];
        for (const k of keys) (docs.has(k) ? put : del).push(k);
        if (put.length) await pool.query(
          'INSERT INTO brk_kv (k, v, updated) SELECT k, v, now() FROM unnest($1::text[], $2::jsonb[]) AS t(k, v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated = now()',
          [put, put.map(k => JSON.stringify(docs.get(k)))]);
        if (del.length) await pool.query('DELETE FROM brk_kv WHERE k = ANY($1::text[])', [del]);
      },
      close: () => pool.end(),
    };
  } else if (file === ':memory:') {
    backend = { kind: 'memory', async load() { }, async write() { }, async close() { } };
  } else {
    backend = {
      kind: 'file',
      async load() {
        try { const o = JSON.parse(fs.readFileSync(file, 'utf8')); for (const k in o) docs.set(k, o[k]); }
        catch (e) { if (e.code !== 'ENOENT') console.error('podaci:', e.message); }
      },
      async write() {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(docs)));
        fs.renameSync(tmp, file);
      },
      async close() { },
    };
  }

  async function flush() {
    clearTimeout(flushTimer); flushTimer = null;
    if (flushing) { await flushing; if (!dirty.size) return; }
    if (!dirty.size) return;
    const keys = [...dirty]; dirty.clear();
    flushing = backend.write(keys).catch(e => {
      console.error('zapis u bazu nije uspio:', e.message);
      for (const k of keys) dirty.add(k); // pokušaj ponovno kasnije
      if (!flushTimer) flushTimer = setTimeout(flush, 5000);
    }).finally(() => { flushing = null; });
    await flushing;
  }
  const mark = k => { dirty.add(k); if (!flushTimer) flushTimer = setTimeout(flush, 400); };

  // ako baza nije dostupna, server i dalje radi (igra bez prijave), a učitavanje se ponavlja
  let loaded = false;
  const ready = new Promise(res => {
    const tryLoad = n => backend.load().then(() => {
      loaded = true;
      console.log(`računi: ${backend.kind}${backend.kind === 'file' ? ' (' + file + ')' : ''}, ${docs.size} zapisa`);
      res();
    }, e => {
      console.error('baza nije dostupna (' + e.message + '), ponovni pokušaj…');
      docs.clear();
      setTimeout(() => tryLoad(n + 1), Math.min(60000, 3000 * n)).unref();
    });
    tryLoad(1);
  });

  return {
    kind: backend.kind, ready, docs, isReady: () => loaded,
    get: k => docs.get(k),
    put(k, v) { docs.set(k, v); mark(k); },
    del(k) { if (docs.delete(k)) mark(k); },
    flush,
    async close() { await flush(); await backend.close(); },
  };
}

module.exports = { open };
