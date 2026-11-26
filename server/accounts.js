/* Korisnički računi: registracija, prijava, profil, statistika i prijatelji.
 * Zapisi u pohrani (store.js):
 *   user:<id>   { id, uname, name, pass, av, img, cm, stats, friends: { <id>: 'ok'|'out'|'in' }, created, seen,
 *                 chips, refills, chipsLast: { d, t, refill } }   (žetoni za poker; chips nema dok se prvi put ne igra)
 *   sess:<hash> { uid, t }   (hash = sha256 tokena; sam token zna samo preglednik)
 *   dm:<a>:<b>  { seq, m: [{ id, f, t, at }], r: { <uid>: id zadnje pročitane } }   (a < b; direktne poruke među prijateljima)
 *   lobby       { seq, m: [{ id, f, t, at, code? }] }   (grupni chat za sve, zadnjih LOBBY_KEEP poruka)
 */
'use strict';
const crypto = require('crypto');

const UNAME_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;
const PASS_MIN = 6, PASS_MAX = 100, FRIENDS_MAX = 200;
const DM_KEEP = 200, LOBBY_KEEP = 100;
// žetoni za poker: svaki račun počinje s WALLET_START; partija pokera košta ulog (žetoni za stolom),
// a nakon partije se na račun vraća ono s čim je igrač završio. Tko padne ispod WALLET_MIN, dobije dopunu do WALLET_MIN.
const WALLET_START = 5000, WALLET_MIN = 1000; // koliko zadnjih poruka po razgovoru se čuva
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
  const dmKey = (a, b) => 'dm:' + Math.min(a, b) + ':' + Math.max(a, b);
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

    // ---------- žetoni (poker) ----------
    chipsOf: u => (u && Number.isFinite(u.chips) ? u.chips : WALLET_START),
    /** promjena stanja žetona nakon partije pokera; vraća novo stanje */
    addChips(u, d) {
      d = Math.round(+d || 0);
      let chips = api.chipsOf(u) + d, refill = false;
      if (chips < WALLET_MIN) { chips = WALLET_MIN; refill = true; u.refills = (u.refills || 0) + 1; }
      u.chips = chips;
      u.chipsLast = { d, t: Date.now(), refill };
      save(u);
      return chips;
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
      store.del(dmKey(u.id, fid)); // razgovor nestaje s prijateljstvom
      return { friend: f };
    },

    // ---------- direktne poruke (samo među prihvaćenim prijateljima) ----------
    dmKey,
    /** cijeli razgovor s prijateljem (ili null ako niste prijatelji) */
    dmGet(u, fid) {
      if (u.friends[fid] !== 'ok') return null;
      return store.get(dmKey(u.id, fid)) || { seq: 0, m: [], r: {} };
    },
    /** pošalji poruku; vraća { msg } ili { error } */
    dmSend(u, fid, text) {
      const f = user(fid);
      if (!f || u.friends[fid] !== 'ok' || f.friends[u.id] !== 'ok') return { error: 'Poruke možeš slati samo prijateljima.' };
      if (!text) return { error: 'Prazna poruka.' };
      const k = dmKey(u.id, fid);
      const d = store.get(k) || { seq: 0, m: [], r: {} };
      const msg = { id: ++d.seq, f: u.id, t: text, at: Date.now() };
      d.m.push(msg);
      if (d.m.length > DM_KEEP) d.m.splice(0, d.m.length - DM_KEEP);
      d.r[u.id] = msg.id; // svoje poruke su pročitane
      store.put(k, d);
      return { msg, friend: f };
    },
    /** označi razgovor pročitanim; vraća id zadnje pročitane poruke ili 0 ako se ništa nije promijenilo */
    dmRead(u, fid) {
      const k = dmKey(u.id, fid), d = store.get(k);
      if (!d || u.friends[fid] !== 'ok' || (d.r[u.id] || 0) >= d.seq) return 0;
      d.r[u.id] = d.seq; store.put(k, d);
      return d.seq;
    },
    // ---------- grupni chat (jedna soba za sve prijavljene) ----------
    lobbyGet: () => store.get('lobby') || { seq: 0, m: [] },
    /** dodaj poruku u grupni chat; code = soba u koju poziva (nije obavezno) */
    lobbyAdd(u, text, code) {
      const d = store.get('lobby') || { seq: 0, m: [] };
      const msg = Object.assign({ id: ++d.seq, f: u.id, t: text, at: Date.now() }, code ? { code } : {});
      d.m.push(msg);
      if (d.m.length > LOBBY_KEEP) d.m.splice(0, d.m.length - LOBBY_KEEP);
      store.put('lobby', d);
      return msg;
    },
    /** obriši poruku iz grupnog chata (svoju, ili bilo koju ako je admin) */
    lobbyDel(u, id, admin) {
      const d = store.get('lobby');
      const i = d ? d.m.findIndex(x => x.id === id) : -1;
      if (i < 0 || (!admin && d.m[i].f !== u.id)) return false;
      d.m.splice(i, 1); store.put('lobby', d);
      return true;
    },
    /** broj nepročitanih poruka od prijatelja i vrijeme zadnje poruke */
    dmInfo(uid, fid) {
      const d = store.get(dmKey(uid, fid));
      if (!d || !d.m.length) return { unread: 0, last: 0 };
      const r = d.r[uid] || 0;
      let n = 0;
      for (let i = d.m.length - 1; i >= 0 && d.m[i].id > r; i--) if (d.m[i].f !== uid) n++;
      return { unread: n, last: d.m[d.m.length - 1].at };
    },
  };
  return api;
}

module.exports = { create, STAT_KEYS, statKey, WALLET_START, WALLET_MIN };
