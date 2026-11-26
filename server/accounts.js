/* Korisnički računi: registracija, prijava, profil, statistika i prijatelji.
 * Zapisi u pohrani (store.js):
 *   user:<id>   { id, uname, name, pass, av, img, cm, stats, friends: { <id>: 'ok'|'out'|'in' }, created, seen }
 *   sess:<hash> { uid, t }   (hash = sha256 tokena; sam token zna samo preglednik)
 */
'use strict';
const crypto = require('crypto');

const UNAME_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;
const PASS_MIN = 6, PASS_MAX = 100, FRIENDS_MAX = 200;
// vrste igara u statistici
const STAT_KEYS = ['briskula', 'briskula_meno', 'treseta', 'treseta_meno', 'poker', 'turnir'];
const statKey = (kind, low) => kind === 'poker' || kind === 'turnir' ? kind : (kind === 'treseta' ? 'treseta' : 'briskula') + (low ? '_meno' : '');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function hashPass(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 's1:' + salt + ':' + crypto.scryptSync(pass, salt, 32).toString('hex');
}
function checkPass(pass, stored) {
  const [v, salt, h] = String(stored || '').split(':');
  if (v !== 's1' || !salt || !h) return false;
  const a = crypto.scryptSync(pass, salt, 32), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function create(store) {
  const byName = new Map(); // uname (mala slova) -> id
  let nextId = 1;
  store.ready.then(() => {
    for (const [k, u] of store.docs) if (k.startsWith('user:')) { byName.set(u.uname.toLowerCase(), u.id); nextId = Math.max(nextId, u.id + 1); }
  });
  const user = id => store.get('user:' + id) || null;
  const save = u => store.put('user:' + u.id, u);
  const norm = s => String(s || '').normalize('NFC').trim();

  function newSession(uid) {
    const token = crypto.randomBytes(24).toString('hex');
    store.put('sess:' + sha(token), { uid, t: Date.now() });
    return token;
  }

  // neuspjele prijave po IP adresi (zaštita od pogađanja lozinke)
  const fails = new Map();
  const FAIL_MAX = 10, FAIL_WIN = 10 * 60 * 1000;
  const blocked = ip => { const f = fails.get(ip); return f && Date.now() - f.t < FAIL_WIN && f.n >= FAIL_MAX; };
  const failed = ip => { const f = fails.get(ip); if (!f || Date.now() - f.t > FAIL_WIN) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; };
  setInterval(() => { const now = Date.now(); for (const [k, f] of fails) if (now - f.t > FAIL_WIN) fails.delete(k); }, 60000).unref();

  const api = {
    ready: store.ready, isReady: store.isReady, kind: store.kind, flush: store.flush, STAT_KEYS, statKey, user,
    byUname: n => { const id = byName.get(norm(n).toLowerCase()); return id ? user(id) : null; },

    register(uname, pass, profile, ip) {
      uname = norm(uname); pass = String(pass || '');
      if (!UNAME_RE.test(uname)) return { error: 'Korisničko ime: 3–20 slova ili brojki (smiju i _ . -).' };
      if (pass.length < PASS_MIN) return { error: `Lozinka mora imati barem ${PASS_MIN} znakova.` };
      if (pass.length > PASS_MAX) return { error: 'Lozinka je predugačka.' };
      if (blocked(ip)) return { error: 'Previše pokušaja, pokušaj ponovno za nekoliko minuta.' };
      if (byName.has(uname.toLowerCase())) { failed(ip); return { error: 'To korisničko ime je zauzeto.' }; }
      const p = profile || {};
      const u = {
        id: nextId++, uname, name: p.name || uname, pass: hashPass(pass),
        av: p.av || null, img: p.img || null, cm: p.cm || 0,
        stats: { online: {}, bots: {} }, friends: {}, created: Date.now(), seen: Date.now(),
      };
      byName.set(uname.toLowerCase(), u.id);
      save(u);
      return { user: u, token: newSession(u.id) };
    },

    login(uname, pass, ip) {
      if (blocked(ip)) return { error: 'Previše pokušaja, pokušaj ponovno za nekoliko minuta.' };
      const u = api.byUname(uname);
      if (!u || !checkPass(String(pass || ''), u.pass)) { failed(ip); return { error: 'Pogrešno korisničko ime ili lozinka.' }; }
      return { user: u, token: newSession(u.id) };
    },

    bySession(token) {
      if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) return null;
      const s = store.get('sess:' + sha(token));
      return s ? user(s.uid) : null;
    },
    logout(token) { if (typeof token === 'string') store.del('sess:' + sha(token)); },

    changePass(u, oldPass, newPass) {
      if (!checkPass(String(oldPass || ''), u.pass)) return { error: 'Stara lozinka nije točna.' };
      newPass = String(newPass || '');
      if (newPass.length < PASS_MIN || newPass.length > PASS_MAX) return { error: `Nova lozinka mora imati barem ${PASS_MIN} znakova.` };
      u.pass = hashPass(newPass); save(u);
      return {};
    },

    /** profil (već provjeren u serveru): name, av ('eN' ili 'img'), img (data URL), cm */
    setProfile(u, p) {
      let ch = false;
      for (const k of ['name', 'av', 'img', 'cm']) if (k in p && p[k] !== u[k]) { u[k] = p[k]; ch = true; }
      if (ch) save(u);
    },
    touch(u) { u.seen = Date.now(); save(u); },

    /** upiši odigranu partiju: section 'online' ili 'bots', res 'w' | 'l' | 'd' */
    record(u, section, key, res) {
      if (!STAT_KEYS.includes(key) || !['online', 'bots'].includes(section)) return;
      const sec = u.stats[section] || (u.stats[section] = {});
      const s = sec[key] || (sec[key] = { p: 0, w: 0, d: 0 });
      s.p++; if (res === 'w') s.w++; else if (res === 'd') s.d++;
      save(u);
    },

    // ---------- prijatelji ----------
    /** zahtjev za prijateljstvo; ako je drugi već poslao zahtjev, odmah ste prijatelji */
    befriend(u, uname) {
      const f = api.byUname(uname);
      if (!f) return { error: 'Nema korisnika s tim imenom.' };
      if (f.id === u.id) return { error: 'To si ti 🙂' };
      const st = u.friends[f.id];
      if (st === 'ok') return { error: f.uname + ' ti je već prijatelj/ica.' };
      if (st === 'out') return { error: 'Zahtjev je već poslan.' };
      if (Object.keys(u.friends).length >= FRIENDS_MAX) return { error: 'Previše prijatelja na popisu.' };
      if (st === 'in') { u.friends[f.id] = 'ok'; f.friends[u.id] = 'ok'; save(u); save(f); return { friend: f, accepted: true }; }
      u.friends[f.id] = 'out'; f.friends[u.id] = 'in'; save(u); save(f);
      return { friend: f };
    },
    accept(u, fid) {
      const f = user(fid);
      if (!f || u.friends[fid] !== 'in') return { error: 'Zahtjev više ne postoji.' };
      u.friends[fid] = 'ok'; f.friends[u.id] = 'ok'; save(u); save(f);
      return { friend: f };
    },
    /** odbij zahtjev, povuci svoj zahtjev ili ukloni prijatelja */
    unfriend(u, fid) {
      const f = user(fid);
      if (!(fid in u.friends)) return {};
      delete u.friends[fid]; save(u);
      if (f && f.friends[u.id]) { delete f.friends[u.id]; save(f); }
      return { friend: f };
    },
  };
  return api;
}

module.exports = { create, STAT_KEYS, statKey };
