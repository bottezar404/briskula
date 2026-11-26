/* Korisnički računi: registracija, prijava, profil, statistika i prijatelji.
 * Zapisi u pohrani (store.js):
 *   user:<id>   { id, uname, name, pass, av, img, stats, friends: { <id>: 'ok'|'out'|'in' }, created, seen,
 *                 chips, refills, chipsLast: { d, t, refill } }   (žetoni za poker; chips nema dok se prvi put ne igra)
 *                 duk, dukLast: { n, why, t }, dukDay: { d, bots, daily }, inv: [id predmeta], eq: { fr, bd, ti, tb, kb }
 *                 (dukati i trgovina, vidi public/shop.js; duk nema dok se prvi put ne zatraži)
 *   sess:<hash> { uid, t }   (hash = sha256 tokena; sam token zna samo preglednik)
 *   dm:<a>:<b>  { seq, m: [{ id, f, t, at }], r: { <uid>: id zadnje pročitane } }   (a < b; direktne poruke među prijateljima)
 *   lobby       { seq, m: [{ id, f, t, at, code? }] }   (grupni chat za sve, zadnjih LOBBY_KEEP poruka)
 */
'use strict';
const crypto = require('crypto');
const Shop = require('../public/shop.js');

const UNAME_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;
const HIST_MAX = 20;
const PASS_MIN = 6, PASS_MAX = 100, FRIENDS_MAX = 200;
const DM_KEEP = 200, LOBBY_KEEP = 100;
// žetoni za poker: svaki račun počinje s WALLET_START; partija pokera košta ulog (žetoni za stolom),
// a nakon partije se na račun vraća ono s čim je igrač završio. Tko padne ispod WALLET_MIN, dobije dopunu do WALLET_MIN.
const WALLET_START = 5000, WALLET_MIN = 1000; // koliko zadnjih poruka po razgovoru se čuva
// vrste igara u statistici
const MAX_GAME_MS = 3 * 3600e3; // jedna partija se broji najviše 3 sata (npr. ostavljena otvorena)
const STAT_KEYS = ['briskula', 'briskula_meno', 'treseta', 'treseta_meno', 'poker', 'turnir', 'covjece', 'kviz'];
const statKey = (kind, low) => kind === 'poker' || kind === 'turnir' || kind === 'covjece' || kind === 'kviz' ? kind : (kind === 'treseta' ? 'treseta' : 'briskula') + (low ? '_meno' : '');

// datum po hrvatskom vremenu (dnevni bonus i granica za botove kreću u ponoć)
const today = () => { try { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zagreb' }); } catch { return new Date().toISOString().slice(0, 10); } };
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
  let kvTop = null; // popis korisnika s kviz bodovima (gradi se po potrebi)

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
        av: p.av || null, img: p.img || null,
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
      u.pass = hashPass(newPass); delete u.tempPass; save(u);
      return {};
    },

    /** admin: nova privremena lozinka za korisnika (sve njegove prijave se odjave) */
    resetPass(u) {
      const A = 'abcdefghjkmnpqrstuvwxyz23456789';
      const temp = Array.from({ length: 8 }, () => A[crypto.randomInt(A.length)]).join('');
      u.pass = hashPass(temp); u.tempPass = true; save(u);
      for (const [k, d] of store.docs) if (k.startsWith('sess:') && d.uid === u.id) store.del(k);
      return temp;
    },

    // ---------- povijest partija (zadnjih HIST_MAX po igraču) ----------
    saveGame(doc, uids) {
      store.put('game:' + doc.id, Object.assign(doc, { uids }));
      for (const uid of new Set(uids.filter(Boolean))) {
        const u = user(uid);
        if (!u) continue;
        u.hist = [doc.id].concat(u.hist || []);
        const drop = u.hist.slice(HIST_MAX);
        u.hist = u.hist.slice(0, HIST_MAX);
        save(u);
        // stari zapis se briše kad ga više nitko nema u povijesti
        for (const id of drop) {
          const gd = store.get('game:' + id);
          if (!gd || !(gd.uids || []).some(x => { const o = user(x); return o && (o.hist || []).includes(id); })) store.del('game:' + id);
        }
      }
    },
    game: id => typeof id === 'string' && /^[a-z0-9]{4,20}$/.test(id) ? store.get('game:' + id) || null : null,
    /** kratki popis partija za prikaz */
    history(u) {
      return (u.hist || []).map(id => store.get('game:' + id)).filter(Boolean).map(d => {
        const me = d.uids.indexOf(u.id);
        return { id: d.id, t: d.t, kind: d.kind, low: d.low, mode: d.mode, tour: d.tour, players: d.players.map(p => p.name), me, res: d.result.draw ? 'd' : d.result.winners.includes(me) ? 'w' : 'l', forfeit: d.result.forfeit };
      });
    },

    /** profil (već provjeren u serveru): name, av ('eN' ili 'img'), img (data URL) */
    setProfile(u, p) {
      let ch = false;
      for (const k of ['name', 'av', 'img']) if (k in p && p[k] !== u[k]) { u[k] = p[k]; ch = true; }
      if (ch) save(u);
    },
    touch(u) { u.seen = Date.now(); save(u); },

    /** upiši odigranu partiju: section 'online' ili 'bots', res 'w' | 'l' | 'd', ms = trajanje partije */
    record(u, section, key, res, ms) {
      if (!STAT_KEYS.includes(key) || !['online', 'bots'].includes(section)) return;
      const sec = u.stats[section] || (u.stats[section] = {});
      const s = sec[key] || (sec[key] = { p: 0, w: 0, d: 0 });
      s.p++; if (res === 'w') s.w++; else if (res === 'd') s.d++;
      ms = Math.round(+ms || 0);
      if (ms > 0) s.t = (s.t || 0) + Math.min(ms, MAX_GAME_MS);
      save(u);
    },
    /** zbroj svih igara (online + botovi): partije, pobjede, odigrano vrijeme (ms) */
    summary(u) {
      const r = { p: 0, w: 0, t: 0 };
      for (const sec of ['online', 'bots']) for (const x of Object.values((u && u.stats && u.stats[sec]) || {})) { r.p += x.p || 0; r.w += x.w || 0; r.t += x.t || 0; }
      return r;
    },

    // ---------- kviz bodovi (skupljaju se na računu, iz svih kvizova) ----------
    kvizOf: u => (u && u.kviz) || { pts: 0, ok: 0, n: 0, cats: {} },
    /** dodaj bodove za jedno odgovoreno pitanje (pts može biti 0 za netočan odgovor) */
    addKviz(u, pts, cat, ok) {
      pts = Math.max(0, Math.round(+pts || 0));
      if (!u.kviz) { u.kviz = { pts: 0, ok: 0, n: 0, cats: {} }; kvTop = null; }
      const k = u.kviz;
      k.pts += pts; k.n++;
      if (ok) k.ok++;
      if (cat && /^[a-z]{2,8}$/.test(cat)) {
        const c = k.cats[cat] || (k.cats[cat] = { pts: 0, ok: 0 });
        c.pts += pts; if (ok) c.ok++;
      }
      save(u);
      return k.pts;
    },
    /** ljestvica: najboljih n po ukupnim bodovima (ili u jednoj kategoriji) + mjesto zadanog korisnika */
    kvizTop(n, cat, me) {
      if (!kvTop) {
        kvTop = [];
        for (const [k, u] of store.docs) if (k.startsWith('user:') && u.kviz && u.kviz.pts > 0) kvTop.push(u);
      }
      const val = u => (cat ? (u.kviz.cats[cat] || {}).pts || 0 : u.kviz.pts);
      const all = kvTop.filter(u => val(u) > 0).sort((a, b) => val(b) - val(a) || a.id - b.id);
      const row = (u, i) => ({ u, pts: val(u), rank: i + 1 });
      const mi = me ? all.findIndex(u => u.id === me.id) : -1;
      return { top: all.slice(0, n).map(row), me: mi >= 0 ? row(all[mi], mi) : null, players: all.length };
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

    // ---------- dukati i trgovina ----------
    /** stanje dukata; stari računi dobiju početnih 100 + 5 za svaku dosadašnju pobjedu (jednom) */
    dukOf(u) {
      if (!u) return 0;
      if (!Number.isFinite(u.duk)) {
        let wins = 0;
        for (const sec of Object.values(u.stats || {})) for (const x of Object.values(sec || {})) wins += (x && x.w) || 0;
        u.duk = Shop.EARN.start + Math.min(Shop.EARN.oldMax, wins * Shop.EARN.perOldWin);
        save(u);
      }
      return u.duk;
    },
    /** dodaj dukate (why = kratko objašnjenje za obavijest); vraća koliko je stvarno dodano */
    addDuk(u, n, why, bots) {
      n = Math.max(0, Math.round(+n || 0));
      api.dukOf(u);
      const day = today();
      if (!u.dukDay || u.dukDay.d !== day) u.dukDay = { d: day, bots: 0 };
      // protiv botova (partije prijavljuje preglednik) ima dnevna granica
      if (bots) { n = Math.min(n, Math.max(0, Shop.EARN.botDay - u.dukDay.bots)); u.dukDay.bots += n; }
      if (!n) return 0;
      u.duk += n;
      u.dukLast = { n, why: String(why || ''), t: Date.now() };
      save(u);
      return n;
    },
    /** dnevni bonus kod prve prijave u danu */
    daily(u) {
      api.dukOf(u);
      const day = today();
      if (!u.dukDay || u.dukDay.d !== day) u.dukDay = { d: day, bots: 0 };
      if (u.dukDay.daily) return 0;
      u.dukDay.daily = true;
      return api.addDuk(u, Shop.EARN.daily, 'dnevni bonus');
    },
    invOf: u => (u && u.inv) || [],
    eqOf: u => (u && u.eq) || {},
    /** kupnja predmeta iz trgovine; kupljeni predmet se odmah i opremi */
    buy(u, id) {
      const it = Shop.BY_ID[id];
      if (!it) return { error: 'Taj predmet ne postoji.' };
      const inv = u.inv || (u.inv = []);
      if (inv.includes(id)) return { error: 'To već imaš.' };
      if (api.dukOf(u) < it.price) return { error: 'Nemaš dovoljno dukata.' };
      u.duk -= it.price;
      inv.push(id);
      (u.eq || (u.eq = {}))[it.slot] = id;
      save(u);
      return { item: it };
    },
    /** opremi kupljeni predmet ili skini (id = null) ono što je u tom mjestu */
    equip(u, slot, id) {
      if (!Shop.SLOTS.some(s => s.id === slot)) return { error: 'Neispravno mjesto.' };
      const eq = u.eq || (u.eq = {});
      if (id == null) { delete eq[slot]; save(u); return {}; }
      const it = Shop.BY_ID[id];
      if (!it || it.slot !== slot || !(u.inv || []).includes(id)) return { error: 'Taj predmet nemaš.' };
      eq[slot] = id; save(u);
      return {};
    },
    /** ukrasi koje vide drugi igrači (okvir, značka, titula) */
    cosOf(u) {
      const eq = (u && u.eq) || {}, o = {};
      for (const k of ['fr', 'bd', 'ti']) if (eq[k] && Shop.BY_ID[eq[k]]) o[k] = eq[k];
      return Object.keys(o).length ? o : null;
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

module.exports = { create, STAT_KEYS, statKey, WALLET_START, WALLET_MIN, Shop };
