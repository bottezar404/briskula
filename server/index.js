/* Briškula online – HTTP + WebSocket server */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');
const E = require('../public/engine.js');
const B = require('../public/bot.js');
const T = require('../public/treseta.js');
const TB = require('../public/treseta-bot.js');
const AV = require('../public/avatars.js');
const P = require('../public/poker.js');
const PB = require('../public/poker-bot.js');
const TR = require('../public/turnir.js');
const CJ = require('../public/covjece.js');
const CB = require('../public/covjece-bot.js');
const KV = require('../public/kviz.js');
const KB = require('../public/kviz-bot.js');
const Store = require('./store.js');
const Accounts = require('./accounts.js');
const History = require('./history.js');
History.instrument([E, T, P, CJ, KV]); // povijest online partija (bilježi samo partije prijavljene s History.begin)
const ACC = Accounts.create(Store.open());
// igra: briškula ili trešeta; low = "Chi fa meno" (na manje) za obje
// (stari klijenti šalju kind 'meno' = briškula na manje)
// 'covjece' = Čovječe ne ljuti se (društvena igra s kockom, ne karte)
// 'kviz' = kviz Znalac (svi odgovaraju u isto vrijeme, nema reda poteza)
const KINDS = ['treseta', 'poker', 'turnir', 'covjece', 'kviz'];
const kindOf = m => KINDS.includes(m.kind) ? m.kind : 'briskula';
const lowOf = m => ['briskula', 'treseta'].includes(kindOf(m)) && (!!m.low || m.kind === 'meno');
const engOf = r => r.kind === 'treseta' ? T : r.kind === 'poker' ? P : r.kind === 'covjece' ? CJ : r.kind === 'kviz' ? KV : E;
const botOf = r => r.kind === 'treseta' ? TB : r.kind === 'poker' ? PB : r.kind === 'covjece' ? CB : r.kind === 'kviz' ? KB : B;
// u pokeru, Čovječe i kvizu svatko igra za sebe, i u četvero
const solo = r => r.kind === 'poker' || r.kind === 'covjece' || r.kind === 'kviz';
// strana (za brojanje pobjeda)
const sideOf = (r, p) => solo(r) ? p : E.teamOf(r.mode, p);
const sideCount = r => r.mode === 4 && !solo(r) ? 2 : r.mode;

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// Sigurnosna zaglavlja (Mozilla HTTP Observatory). Sve skripte, stilovi i slike su
// s istog poslužitelja; slike avatara su data: (JPEG) i blob: (dok se smanjuje);
// inline style="" atributi se koriste u HTML-u koji gradi app.js pa style-src
// treba 'unsafe-inline' (skripte NE). WebSocket je na istom hostu (/ws).
const CSP_BASE = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", "media-src 'self'", "worker-src 'self'", "manifest-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"];
const SEC_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
};
function securityHeaders(req, res) {
  for (const k in SEC_HEADERS) res.setHeader(k, SEC_HEADERS[k]);
  // 'self' pokriva ws/wss u novijim preglednicima; za starije (npr. stari Safari)
  // dodajemo i izričit ws(s)://host, samo ako je Host ispravan naziv poslužitelja
  const host = String(req.headers.host || '');
  const conn = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i.test(host) ? `connect-src 'self' wss://${host} ws://${host}` : "connect-src 'self'";
  res.setHeader('Content-Security-Policy', CSP_BASE.concat(conn).join('; '));
}

const GZIP_EXT = new Set(['.js', '.css', '.html', '.json', '.svg', '.webmanifest']);
const gzCache = new Map(); // datoteka -> sažeti sadržaj
const server = http.createServer((req, res) => {
  securityHeaders(req, res);
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (p === '/health') { res.writeHead(200); return res.end('ok'); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { // SPA fallback
      return fs.readFile(path.join(PUB, 'index.html'), (e2, d2) => { res.writeHead(e2 ? 404 : 200, { 'Content-Type': TYPES['.html'] }); res.end(d2); });
    }
    const ext = path.extname(file);
    const head = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': p === '/sw.js' ? 'no-cache' : 'public, max-age=300' };
    // tekstualne datoteke (npr. velik popis kviz pitanja) šalju se sažete ako preglednik to podržava
    if (GZIP_EXT.has(ext) && data.length > 1024) {
      head.Vary = 'Accept-Encoding';
      if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
        let z = gzCache.get(file);
        if (!z || z.len !== data.length || !z.src.equals(data)) { z = { len: data.length, src: data, gz: zlib.gzipSync(data) }; gzCache.set(file, z); }
        head['Content-Encoding'] = 'gzip';
        res.writeHead(200, head);
        return res.end(z.gz);
      }
    }
    res.writeHead(200, head);
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Map(); // token -> { ws, name, room }
const rooms = new Map();   // code -> room

const BOT_NAMES = ['Bot Jure', 'Bot Mare', 'Bot Ante', 'Bot Frane', 'Bot Luce', 'Bot Šime', 'Bot Bepo', 'Bot Tonka'];
const CHAT_LEN = 200, CHAT_KEEP = 50, CHAT_GAP = 700;
const DM_LEN = 500, DM_GAP = 500;
// vrijeme za potez (sekunde, 0 = bez ograničenja); kad istekne, partija je gotova
const TURN_TIMES = [0, 15, 30, 60], TURN_DEFAULT = 30, TURN_GRACE = 1500;
const TURN_SCALE = +process.env.BRK_TURN_SCALE || 1; // samo za testove
const turnTimeOf = v => TURN_TIMES.includes(+v) ? +v : TURN_DEFAULT;
// trešeta ima puno više štihova i ruku od briškule (2 igrača do 41 ≈ 130 štihova),
// pa su pauze kraće da partija ne traje predugo
const PACE = {
  briskula: { trick: 1400, bot: 750, botRnd: 400 },
  treseta: { trick: 1050, bot: 450, botRnd: 300 },
  poker: { trick: 1100, bot: 800, botRnd: 700 }, // trick = pauza prije sljedeće karte na stolu
  covjece: { trick: 900, bot: 550, botRnd: 300 }, // trick = pauza kad bacanje nema poteza (da se vidi kocka)
  kviz: { trick: 1, bot: 1, botRnd: 0 }, // kviz: pauze i vrijeme za pitanje su u kviz.js (množe se s PACE_SCALE)
};
const PACE_SCALE = +process.env.BRK_PACE_SCALE || 1; // samo za testove
for (const k in PACE) for (const f in PACE[k]) PACE[k][f] *= PACE_SCALE;
const pace = r => PACE[r.kind] || PACE.briskula;
const HAND_PAUSE = 9000, POKER_PAUSE = 7000, AWAY_AUTOPLAY = 25000, ROOM_TTL = 30 * 60 * 1000;

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c; do { c = Array.from({ length: 5 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c));
  return c;
}
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function clean(s, n) { return String(s || '').replace(/[<>]/g, '').trim().slice(0, n || 20); }
// chat: bez kontrolnih znakova, razmaci sažeti, do 200 znakova
function cleanChat(s, n) { return String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || CHAT_LEN); }

// ---------- profil: avatar (+ kratka statistika uz avatar u igri) ----------
// slike se drže jednom po sadržaju (hash) i šalju klijentu samo prvi put
const IMGS = new Map(), IMG_KEEP = 600;
function cleanAv(av) { const m = /^e(\d{1,2})$/.exec(String(av || '')); return m && +m[1] < AV.N ? 'e' + +m[1] : null; }
function cleanImg(d) {
  if (typeof d !== 'string' || d.length > AV.MAX_LEN + 200) return null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(d);
  if (!m) return null;
  const head = Buffer.from(m[1].slice(0, 8), 'base64');
  if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return null; // nije JPEG
  return d;
}
function storeImg(d) {
  const id = crypto.createHash('sha1').update(d).digest('hex').slice(0, 12);
  IMGS.delete(id); IMGS.set(id, d);
  while (IMGS.size > IMG_KEEP) IMGS.delete(IMGS.keys().next().value);
  return id;
}
// vraća profil za korisnički račun (ako je igrač prijavljen)
function setProfile(c, m) {
  const acc = {};
  if ('name' in m) acc.name = c.name = clean(m.name) || c.name || 'Igrač';
  if ('av' in m) {
    if (m.av === 'img') {
      const d = cleanImg(m.img);
      if (d) { c.av = 'i:' + storeImg(d); acc.av = 'img'; acc.img = d; } else c.av = c.av || 'e0';
    } else { c.av = cleanAv(m.av) || c.av || null; if (c.av && !c.av.startsWith('i:')) acc.av = c.av; }
  }
  return acc;
}
// trenutni profil igrača u obliku za račun
function accProfile(c) {
  const id = c.av && c.av.startsWith('i:') ? c.av.slice(2) : null;
  return { name: c.name, av: id ? (IMGS.has(id) ? 'img' : null) : c.av || null, img: id && IMGS.get(id) || null };
}
// profil iz računa (npr. nakon prijave na drugom uređaju)
function profileFromUser(c, u) {
  c.name = u.name || u.uname;
  c.av = u.av === 'img' && u.img ? 'i:' + storeImg(u.img) : cleanAv(u.av) || c.av;
}
// kratka statistika za prikaz uz avatar: ukupno pobjeda i odigranih sati (samo prijavljeni)
function statOf(u) { const x = ACC.summary(u); return { w: x.w, p: x.p, t: x.t }; }
// prikaz mjesta: ljudi uvijek s trenutnim profilom
function seatAv(s) {
  if (s.bot) return { av: s.av || AV.forName(s.name) };
  const c = clients.get(s.token);
  const u = c && c.uid && ACC.user(c.uid);
  return Object.assign({ av: (c && c.av) || AV.forName(s.name) }, u ? { uname: u.uname, st: statOf(u) } : {});
}

function createRoom(mode, host, opts) {
  const r = {
    code: code(), mode, seats: Array(mode).fill(null), host, game: null, timer: null,
    level: ['easy', 'normal', 'hard'].includes(opts.level) ? opts.level : 'normal',
    isPublic: !!opts.isPublic, kind: opts.kind || 'briskula', low: !!opts.low, tour: null, target: T.TARGETS.includes(+opts.target) ? +opts.target : 41, signals: [], chat: [], chatSeq: 0, wins: null, touched: Date.now(), awayTimer: null,
    turnTime: turnTimeOf(opts.turnTime), turnTimer: null, turnKey: null, turnEnds: 0,
    kvUsed: [], kvBots: [], kvQ: -1, // kviz: nedavna pitanja u sobi (da se ne ponavljaju), timeri botova
  };
  setKind(r, r.kind, r.low);
  rooms.set(r.code, r);
  return r;
}

// vrsta igre u sobi; 'turnir' = niz igara (briškula → trešeta → poker), r.kind je trenutna igra
function setKind(r, kind, low) {
  if (kind === 'turnir') { r.tour = TR.newTour(r.mode); r.kind = TR.stageKind(r.tour); r.low = false; }
  else { r.tour = null; r.kind = kind; r.low = !!low; }
  r.wins = Array(sideCount(r)).fill(0);
}
const TOUR_BLINDS = 4; // u turniru blindovi u pokeru rastu brže
const tourBusy = r => r.tour && r.tour.idx > 0 && !r.tour.done;

function seatOf(r, token) { return r.seats.findIndex(s => s && s.token === token); }

function addBot(r) {
  const i = r.seats.indexOf(null);
  if (i < 0) return false;
  const used = new Set(r.seats.filter(Boolean).map(s => s.name));
  const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot';
  r.seats[i] = { bot: true, name, av: AV.forName(name) };
  return true;
}

function joinRoom(r, token) {
  const c = clients.get(token);
  if (seatOf(r, token) >= 0) { c.room = r.code; return true; }
  if (r.game && r.game.phase !== 'over') return false;
  let i = r.seats.indexOf(null);
  if (i < 0) i = r.seats.findIndex(s => s && s.bot); // zamijeni bota
  if (i < 0) return false;
  leaveCurrent(token);
  r.seats[i] = { token, name: c.name };
  c.room = r.code;
  return true;
}

function leaveCurrent(token) {
  const c = clients.get(token);
  if (c && c.kvRoom) kvrLeave(token);
  if (!c || !c.room) return;
  const r = rooms.get(c.room);
  c.room = null;
  if (!r) return;
  const i = seatOf(r, token);
  if (i < 0) return;
  if (r.game && r.game.phase !== 'over') {
    chipsLeave(r, i);
    // tijekom igre bot preuzima mjesto
    const p = seatAv(r.seats[i]);
    r.seats[i] = { bot: true, name: r.seats[i].name + ' (bot)', av: p.av };
    r.game.players[i].bot = true;
    r.game.players[i].name = r.seats[i].name;
    pushSignal(r, -1, r.seats[i].name.replace(' (bot)', '') + ' je napustio/la igru, bot igra umjesto njega/nje.');
    schedule(r);
  } else r.seats[i] = null;
  if (r.host === token) {
    const h = r.seats.find(s => s && !s.bot);
    r.host = h ? h.token : null;
  }
  if (!r.seats.some(s => s && !s.bot)) { clearTimeout(r.timer); stopTurnTimer(r); kvStop(r); rooms.delete(r.code); return; }
  broadcast(r);
}

function pushSignal(r, from, text, teamOnly) {
  r.signals.push({ id: Date.now() + Math.random(), from, text, team: teamOnly ? E.teamOf(r.mode, from) : null, t: Date.now() });
  if (r.signals.length > 20) r.signals.shift();
}

// slike koje ovaj klijent još nije dobio
function newImgs(c, avs) {
  const imgs = {};
  for (const av of avs) if (av && av.startsWith('i:')) {
    const id = av.slice(2);
    if (c && c.sentImgs && c.sentImgs.has(id)) continue;
    if (IMGS.has(id)) { imgs[id] = IMGS.get(id); if (c && c.sentImgs) c.sentImgs.add(id); }
  }
  return imgs;
}

function roomView(r, token) {
  const you = seatOf(r, token);
  const g = r.game;
  const c = clients.get(token);
  const seats = r.seats.map(s => {
    if (!s) return null;
    const sc = !s.bot && clients.get(s.token);
    const su = sc && sc.uid && ACC.user(sc.uid);
    // prijavljeni igrači: stanje žetona na računu (vidi se u sobi)
    return Object.assign({ name: s.name, bot: !!s.bot, connected: s.bot || !!(sc && sc.ws) }, su ? { wallet: ACC.chipsOf(su) } : {}, seatAv(s));
  });
  const imgs = newImgs(c, seats.map(s => s && s.av));
  const tl = turnLeft(r);
  return {
    type: 'room', imgs, turnTime: r.turnTime, turnLeft: tl,
    code: r.code, mode: r.mode, level: r.level, isPublic: r.isPublic, low: r.low, kind: r.kind, target: r.target, tour: r.tour,
    host: r.host === token, you, wins: r.wins,
    seats,
    game: g ? engOf(r).viewFor(g, you) : null,
    signals: r.signals.filter(s => s.team == null || (you >= 0 && s.team === E.teamOf(r.mode, you))).slice(-6),
    chat: r.chat.slice(-30),
    ready: g && g.phase === 'hand' && r.ready ? [...r.ready] : [],
  };
}

function broadcast(r) {
  r.touched = Date.now();
  // kraj partije: jednom upiši pobjedu (poker može završiti i usred ulaganja, kad svi odustanu)
  const g = r.game;
  if (g && g.phase === 'over' && r.counted !== g) {
    r.counted = g;
    if (!g.result.draw && g.result.forfeit == null) r.wins[sideOf(r, g.result.winners[0])]++;
    if (r.tour && !r.tour.done) TR.record(r.tour, r.kind, g.result);
    recordStats(r, g);
  }
  presenceSoon();
  turnTimer(r); // pokreni/zaustavi timer za potez prije slanja, da klijenti vide odbrojavanje
  for (const s of r.seats) if (s && !s.bot) { const c = clients.get(s.token); if (c && c.room === r.code) send(c.ws, roomView(r, s.token)); }
}

function startGame(r) {
  if (r.seats.some(s => !s)) return false;
  // turnir: sljedeća igra u nizu (nakon zadnje počinje novi turnir)
  if (r.tour) {
    if (r.tour.done) r.tour = TR.newTour(r.mode);
    const k = TR.stageKind(r.tour);
    if (k !== r.kind) { r.kind = k; r.wins = Array(sideCount(r)).fill(0); }
  }
  const prevDealer = r.game && r.game.kind === r.kind ? r.game.dealer : -1;
  r.gameAt = Date.now();
  const o = { names: r.seats.map(s => s.name), bots: r.seats.map(s => !!s.bot), dealer: prevDealer + 1, blindEvery: r.tour ? TOUR_BLINDS : undefined };
  if (r.kind === 'poker') r.game = P.newGame(r.mode, o);
  else if (r.kind === 'covjece') r.game = CJ.newGame(r.mode, o);
  else if (r.kind === 'kviz') {
    r.game = KV.newGame(r.mode, Object.assign(o, { exclude: r.kvUsed, qTime: KV.QTIME * PACE_SCALE }));
    r.kvUsed = r.kvUsed.concat(r.game.qs.map(q => q.id)).slice(-800);
    kvStop(r);
  }
  else r.game = r.kind === 'treseta' ? T.newGame(r.mode, Object.assign(o, { target: r.target, low: r.low })) : E.newGame(r.mode, Object.assign(o, { low: r.low }));
  r.signals = []; r.ready = new Set();
  // tko je za stolom s računom (za statistiku; tko izađe usred partije, upiše mu se poraz)
  r.uids = r.seats.map(s => { const c = !s.bot && clients.get(s.token); return c && c.uid || null; });
  r.humans = r.seats.filter(s => !s.bot).length;
  // povijest: bilježe se online partije (barem dva čovjeka) u kojima je netko prijavljen
  r.histPlayers = null;
  if (r.humans >= 2 && r.uids.some(Boolean)) {
    r.histPlayers = r.seats.map((s, i) => { const u = r.uids[i] && ACC.user(r.uids[i]); return { name: s.name, bot: !!s.bot, uname: u ? u.uname : null }; });
    History.begin(r.game);
  }
  // poker: žetoni s računa (ulog = početni žetoni za stolom), obračun na kraju partije
  r.chipUids = r.kind === 'poker' ? r.uids.slice() : null;
  broadcast(r); schedule(r);
  return true;
}

// ---------- statistika ----------
function recordStats(r, g) {
  if (g.result) settleChips(r, g);
  if (!r.uids || !g.result) return;
  const res = g.result;
  const section = r.humans >= 2 ? 'online' : 'bots';
  const key = Accounts.statKey(r.kind, r.low);
  // zadnja igra turnira: upiši i cijeli turnir (pobjeda = prvo mjesto)
  const st = r.tour && r.tour.done ? TR.standings(r.tour) : null;
  const ms = r.gameAt ? Date.now() - r.gameAt : 0; // odigrano vrijeme (sati igranja u statistici)
  if (r.histPlayers) {
    const doc = History.build(r, g, r.histPlayers);
    if (doc) ACC.saveGame(doc, r.uids.slice());
    r.histPlayers = null;
  }
  r.uids.forEach((uid, i) => {
    const u = uid && ACC.user(uid);
    if (!u) return;
    ACC.record(u, section, key, res.draw ? 'd' : res.winners.includes(i) ? 'w' : 'l', ms);
    if (st) {
      const firsts = st.filter(x => x.place === 1).length;
      ACC.record(u, section, 'turnir', firsts === st.length ? 'd' : st.find(x => x.p === i).place === 1 ? 'w' : 'l');
    }
    pushAccount(uid);
  });
  r.uids = null; // jednom po partiji
}

// poker: na račun ide razlika između žetona na kraju i uloga (početnih žetona za stolom)
function settleChips(r, g) {
  if (!r.chipUids || g.kind !== 'poker') return;
  r.chipUids.forEach((uid, i) => {
    const u = uid && ACC.user(uid);
    if (!u) return;
    ACC.addChips(u, g.players[i].chips - g.startChips);
    pushAccount(uid);
  });
  r.chipUids = null;
}
// tko napusti poker usred partije, gubi ulog (njegove žetone za stolom dalje igra bot)
function chipsLeave(r, i) {
  const uid = r.chipUids && r.chipUids[i];
  if (!uid || !r.game || r.game.phase === 'over') return;
  r.chipUids[i] = null;
  const u = ACC.user(uid);
  if (u) { ACC.addChips(u, -r.game.startChips); pushAccount(uid); }
}

// timer za potez vrijedi samo kad su za stolom barem dva čovjeka
function timedTurn(r) {
  const g = r.game;
  if (!g || g.phase !== 'play' || !r.turnTime || g.kind === 'kviz') return false;
  const s = r.seats[g.turn];
  return !!s && !s.bot && r.seats.filter(x => x && !x.bot).length >= 2;
}
function turnLeft(r) { return r.turnTimer && timedTurn(r) ? Math.max(0, r.turnEnds - Date.now()) : null; }
function stopTurnTimer(r) { clearTimeout(r.turnTimer); r.turnTimer = null; r.turnKey = null; }
function turnTimer(r) {
  if (!timedTurn(r)) return stopTurnTimer(r);
  const g = r.game;
  const key = [g.handNo || 0, g.trickNo, g.trick.length, g.turn].join(':');
  if (r.turnTimer && r.turnKey === key) return; // isti potez (npr. ponovno spajanje): timer teče dalje
  stopTurnTimer(r);
  r.turnKey = key;
  const ms = r.turnTime * 1000 * TURN_SCALE;
  r.turnEnds = Date.now() + ms;
  r.turnTimer = setTimeout(() => {
    r.turnTimer = null;
    if (r.turnKey !== key || !timedTurn(r)) return;
    if (r.kind === 'poker') pokerTimeout(r, g.turn);
    else if (r.kind === 'covjece') covjeceTimeout(r, g.turn);
    else forfeit(r, g.turn);
  }, ms + TURN_GRACE * TURN_SCALE);
}

// poker: tko ne odigra na vrijeme, provjerava (ako može) ili odustaje od ruke; partija ide dalje
function pokerTimeout(r, p) {
  const g = r.game;
  const L = P.legal(g, p);
  if (!L) return;
  P.play(g, p, L.check ? 'check' : 'fold');
  pushSignal(r, -1, g.players[p].name + ' nije odigrao/la na vrijeme' + (L.check ? ' (provjera).' : ' i odustaje od ruke.'));
  broadcast(r); schedule(r);
}

// Čovječe: tko ne odigra na vrijeme, potez (bacanje i pomak) odigra se umjesto njega; igra ide dalje
function covjeceTimeout(r, p) {
  const g = r.game;
  for (let k = 0; k < 2 && g.phase === 'play' && g.turn === p; k++) {
    const mv = CB.choose(CJ.viewFor(g, p), 'normal');
    if (!CJ.play(g, p, mv) || mv !== 'roll') break; // nakon pomaka figure stani (šestica: igrač opet baca sam)
  }
  pushSignal(r, -1, g.players[p].name + ' nije odigrao/la na vrijeme, potez je odigran automatski.');
  broadcast(r); schedule(r);
}

// igrač nije odigrao na vrijeme: partija je gotova, njegova strana gubi
function forfeit(r, p) {
  const g = r.game;
  const mode = r.mode, lost = E.teamOf(mode, p);
  const teams = mode === 4 ? [[0, 2], [1, 3]] : Array.from({ length: mode }, (_, i) => [i]);
  let scores;
  if (r.kind === 'treseta') scores = teams.map((ps, t) => ({ team: t, players: ps, points: g.score[t] }));
  else scores = teams.map((ps, t) => ({ team: t, players: ps, points: ps.reduce((a, i) => a + E.playerPoints(g, i), 0) }));
  const winners = [].concat(...teams.filter((_, t) => t !== lost));
  clearTimeout(r.timer); clearTimeout(r.awayTimer); stopTurnTimer(r);
  g.phase = 'over';
  g.result = { scores, winners, draw: false, low: !!r.low, forfeit: p, hands: (g.hands || []).slice(), target: g.target };
  teams.forEach((_, t) => { if (t !== lost) r.wins[t]++; });
  r.counted = g;
  if (r.tour && !r.tour.done) TR.record(r.tour, r.kind, g.result);
  recordStats(r, g);
  pushSignal(r, -1, g.players[p].name + ' nije odigrao/la na vrijeme. Partija je gotova.');
  broadcast(r);
}

function schedule(r) {
  clearTimeout(r.timer); clearTimeout(r.awayTimer);
  const g = r.game;
  turnTimer(r);
  if (!g) return;
  if (g.kind === 'kviz') return kvSchedule(r);
  if (g.phase === 'collect') {
    r.timer = setTimeout(() => {
      engOf(r).collect(g);
      broadcast(r); schedule(r);
    }, pace(r).trick);
  } else if (g.phase === 'hand') {
    // kraj ruke (trešeta, poker): kratka pauza za pregled bodova, pa nova ruka
    if (r.kind === 'poker' && !pokerHumans(r).length) return pokerFinish(r);
    r.timer = setTimeout(() => nextHand(r), r.kind === 'poker' ? POKER_PAUSE : HAND_PAUSE);
  } else if (g.phase === 'play') {
    const s = r.seats[g.turn];
    const c = s && !s.bot ? clients.get(s.token) : null;
    if (s.bot) r.timer = setTimeout(() => botMove(r), pace(r).bot + Math.random() * pace(r).botRnd);
    // odspojeni igrač: ako nema timera za potez, bot nakon nekog vremena igra umjesto njega
    else if ((!c || !c.ws) && !r.turnTimer) r.awayTimer = setTimeout(() => botMove(r), AWAY_AUTOPLAY);
  }
}

// ---------- kviz: svi odgovaraju istodobno ----------
// kviz bodovi na računu: nakon otkrivanja odgovora svakom prijavljenom se dodaju bodovi s pitanja
// (jednom po pitanju; uidOf(i) vraća id računa igrača na mjestu i ili null za gosta/bota)
function kvPay(g, key, uidOf) {
  if (g.phase !== 'collect' || g.stage !== 'reveal' || g.kvPaid === key) return;
  g.kvPaid = key;
  const q = g.qs[g.qi], done = new Set(); // isti račun u dvije kartice dobije bodove samo jednom
  g.players.forEach((pl, i) => {
    const uid = uidOf(i), u = uid && !done.has(uid) && ACC.user(uid);
    if (!u || !pl.ans) return;
    done.add(uid);
    ACC.addKviz(u, pl.ans.ok ? pl.ans.pts : 0, q && q.cat, !!pl.ans.ok);
  });
}
function kvStop(r) { for (const t of r.kvBots || []) clearTimeout(t); r.kvBots = []; r.kvQ = -1; }
function kvSchedule(r) {
  const g = r.game;
  if (g.phase === 'collect') {
    kvStop(r);
    if (r.uids) kvPay(g, g.qi, i => r.uids && r.seats[i] && !r.seats[i].bot ? r.uids[i] : null);
    // rok pauze se pamti, da je npr. ponovno spajanje igrača ne produlji
    const key = g.qi + ':' + g.stage;
    if (!r.kvDue || r.kvDue.g !== g || r.kvDue.key !== key) r.kvDue = { g, key, at: Date.now() + g.wait * PACE_SCALE };
    r.timer = setTimeout(() => { if (r.game !== g) return; KV.collect(g); broadcast(r); schedule(r); }, Math.max(0, r.kvDue.at - Date.now()));
  } else if (g.phase === 'play') {
    // kraj vremena za pitanje (uz malo tolerancije za kašnjenje mreže)
    r.timer = setTimeout(() => { if (r.game !== g) return; if (KV.timeUp(g)) { broadcast(r); schedule(r); } }, Math.max(0, g.qEnd - Date.now()) + KV.GRACE * PACE_SCALE);
    // botovi odgovaraju svaki u svoje vrijeme (jednom po pitanju)
    if (r.kvQ !== g.qi) {
      kvStop(r); r.kvQ = g.qi;
      g.players.forEach((pl, p) => {
        const s = r.seats[p];
        if (!s || !s.bot || pl.ans) return;
        const pick = KB.plan(g, p, s.name.endsWith(' (bot)') ? 'normal' : r.level);
        r.kvBots.push(setTimeout(() => {
          if (r.game !== g || g.phase !== 'play' || r.kvQ !== g.qi) return;
          if (KV.play(g, p, pick.move)) { broadcast(r); schedule(r); }
        }, Math.min(pick.delay, g.qTime - 50)));
      });
    }
  } else kvStop(r);
}

// poker: ljudi koji su još u igri (nisu ispali)
function pokerHumans(r) {
  return r.seats.map((s, i) => s && !s.bot && !r.game.players[i].out ? i : -1).filter(i => i >= 0);
}
// svi ljudi su ispali: botovi odigraju ostatak odmah, da se zna poredak
function pokerFinish(r) {
  PB.finish(r.game, r.level);
  broadcast(r);
}

function nextHand(r) {
  const g = r.game;
  if (!g || g.phase !== 'hand') return;
  engOf(r).nextHand(g); r.signals = []; r.ready = new Set();
  broadcast(r); schedule(r);
}

function botMove(r) {
  const g = r.game;
  if (!g || g.phase !== 'play') return;
  const p = g.turn;
  const card = botOf(r).choose(engOf(r).viewFor(g, p), r.seats[p].bot ? r.level : 'normal');
  engOf(r).play(g, p, card);
  broadcast(r); schedule(r);
}

// ---------- kviz: stalne javne sobe (Miješano + jedna po kategoriji) ----------
// Sobe uvijek postoje; igrači ulaze i izlaze kad hoće, pitanja se vrte u krugovima
// (KV.KRUG pitanja), a kad u sobi nema nikoga, soba miruje.
const KV_ROOMS = new Map();
const KVR_MAX = 30, KVR_AWAY = 30000;
const KVR_MSGS = new Set(['play', 'chat', 'signal']);
for (const c of [{ id: 'mix', name: 'Miješano', icon: '🎲' }].concat(KV.CATS)) {
  KV_ROOMS.set(c.id, { id: c.id, name: c.name, icon: c.icon, game: KV.newEndless(c.id, { qTime: KV.QTIME * PACE_SCALE }), members: [], timer: null, due: null, chat: [], chatSeq: 0, signals: [], counted: 0 });
}
const kvCode = kr => 'KV-' + kr.id.toUpperCase();
function kvListMsg() {
  return { type: 'kvList', rooms: [...KV_ROOMS.values()].map(kr => ({ id: kr.id, code: kvCode(kr), name: kr.name, icon: kr.icon, n: kr.members.length, max: KVR_MAX })) };
}
// ljestvica kviz bodova (svi kvizovi zajedno, ili jedna kategorija)
function kvTopMsg(c, cat) {
  cat = KV.CATS.some(x => x.id === cat) ? cat : null;
  const me = c && c.uid && ACC.user(c.uid);
  const t = ACC.kvizTop(10, cat, me);
  // gosti ne vide tko je na ljestvici: umjesto imena i avatara "Igrač 1", "Igrač 2"...
  const row = x => !me ? { uname: '', name: 'Igrač ' + x.rank, av: AV.forName('Igrač ' + x.rank), pts: x.pts, rank: x.rank, me: false }
    : { uname: x.u.uname, name: x.u.name || x.u.uname, av: x.u.av === 'img' && x.u.img ? 'i:' + storeImg(x.u.img) : x.u.av || AV.forName(x.u.name || x.u.uname), pts: x.pts, rank: x.rank, me: x.u.id === me.id };
  const top = t.top.map(row);
  return { type: 'kvTop', cat, top, me: t.me ? row(t.me) : null, players: t.players, guest: !me, imgs: newImgs(c, top.map(x => x.av)) };
}
let kvListTimer = null;
function kvListSoon() {
  if (kvListTimer) return;
  kvListTimer = setTimeout(() => {
    kvListTimer = null;
    const msg = kvListMsg();
    for (const c of clients.values()) if (c.ws && c.kvList) send(c.ws, msg);
  }, 400);
}
function kvrView(kr, token) {
  const g = kr.game, you = kr.members.indexOf(token), c = clients.get(token);
  const seats = kr.members.map(t => {
    const sc = clients.get(t), su = sc && sc.uid && ACC.user(sc.uid);
    return Object.assign({ name: (sc && sc.name) || 'Igrač', bot: false, connected: !!(sc && sc.ws) }, seatAv({ token: t, name: (sc && sc.name) || 'Igrač' }), su ? { kvPts: ACC.kvizOf(su).pts } : {});
  });
  const from = t => kr.members.indexOf(t);
  return {
    type: 'room', kvRoom: kr.id, roomName: kr.name, roomIcon: kr.icon, imgs: newImgs(c, seats.map(s => s.av)),
    code: kvCode(kr), mode: kr.members.length, kind: 'kviz', isPublic: true, host: false, you, wins: [], level: 'normal', low: false, target: 41, tour: null, turnTime: 0, turnLeft: null,
    seats, game: KV.viewFor(g, you),
    signals: kr.signals.map(x => ({ id: x.id, from: x.tok ? from(x.tok) : -1, text: x.text, team: null, t: x.t })).filter(x => x.from >= 0 || !x.tok).slice(-6),
    chat: kr.chat.slice(-30).map(x => ({ id: x.id, from: from(x.tok), name: x.name, text: x.text, t: x.t })),
    ready: [],
  };
}
function kvrBroadcast(kr) {
  // bodovi se upišu na račun prije slanja, da svatko odmah vidi novi zbroj
  kvPay(kr.game, kr.game.krugNo + ':' + kr.game.qi, i => { const c = clients.get(kr.members[i]); return c && c.uid; });
  for (const t of kr.members) { const c = clients.get(t); if (c && c.ws && c.kvRoom === kr.id) send(c.ws, kvrView(kr, t)); }
}
function kvrStop(kr) { clearTimeout(kr.timer); kr.timer = null; kr.due = null; }
function kvrSchedule(kr) {
  clearTimeout(kr.timer);
  const g = kr.game;
  if (!kr.members.length || g.phase === 'idle') return kvrStop(kr);
  if (g.phase === 'collect') {
    if (g.stage === 'board' && kr.counted !== g.krugNo) { kr.counted = g.krugNo; kvrStats(kr); }
    const key = g.krugNo + ':' + g.qi + ':' + g.stage;
    if (!kr.due || kr.due.key !== key) kr.due = { key, at: Date.now() + g.wait * PACE_SCALE };
    kr.timer = setTimeout(() => { KV.collect(g); kvrBroadcast(kr); kvrSchedule(kr); }, Math.max(0, kr.due.at - Date.now()));
  } else if (g.phase === 'play') {
    kr.timer = setTimeout(() => { if (KV.timeUp(g)) { kvrBroadcast(kr); kvrSchedule(kr); } }, Math.max(0, g.qEnd - Date.now()) + KV.GRACE * PACE_SCALE);
  }
}
// kraj kruga: prijavljenima koji su bili barem pola kruga upiše se partija (online)
function kvrStats(kr) {
  const res = kr.game.result;
  if (!res) return;
  kr.members.forEach((t, i) => {
    const c = clients.get(t), sc = res.scores[i];
    const u = c && c.uid && ACC.user(c.uid);
    if (!u) return;
    if (kr.members.length >= 2 && sc && sc.seen >= res.total / 2) ACC.record(u, 'online', 'kviz', res.winners.includes(i) ? (res.winners.length > 1 ? 'd' : 'w') : 'l');
    pushAccount(u.id); // i skupljeni kviz bodovi
  });
}
function kvrJoin(token, id) {
  const kr = KV_ROOMS.get(id), c = clients.get(token);
  if (!kr || !c) return 'Soba ne postoji.';
  if (c.kvRoom === id && kr.members.includes(token)) { kvrBroadcast(kr); return null; }
  if (kr.members.length >= KVR_MAX) return 'Soba je puna, probaj drugu.';
  leaveCurrent(token);
  c.kvRoom = id; clearTimeout(c.kvAway);
  kr.members.push(token);
  KV.addPlayer(kr.game, c.name);
  if (kr.game.phase === 'idle') { kr.chat = []; kr.signals = []; KV.newKrug(kr.game); }
  kvrSignal(kr, null, c.name + ' je ušao/la u sobu.');
  kvrBroadcast(kr); kvrSchedule(kr); kvListSoon(); presenceSoon();
  return null;
}
function kvrLeave(token) {
  const c = clients.get(token);
  const kr = c && c.kvRoom && KV_ROOMS.get(c.kvRoom);
  if (c) { c.kvRoom = null; clearTimeout(c.kvAway); }
  if (!kr) return;
  const i = kr.members.indexOf(token);
  if (i < 0) return;
  kr.members.splice(i, 1);
  KV.removePlayer(kr.game, i);
  if (!kr.members.length) { kvrStop(kr); KV.pause(kr.game); }
  else { kvrSignal(kr, null, ((c && c.name) || 'Igrač') + ' je izašao/la.'); kvrBroadcast(kr); kvrSchedule(kr); }
  kvListSoon(); presenceSoon();
}
function kvrSignal(kr, tok, text) {
  kr.signals.push({ id: Date.now() + Math.random(), tok, text, t: Date.now() });
  if (kr.signals.length > 20) kr.signals.shift();
}
function kvrMessage(m, token, c, ws) {
  const kr = KV_ROOMS.get(c.kvRoom);
  if (!kr) return;
  const p = kr.members.indexOf(token);
  if (p < 0) return;
  if (m.type === 'play') {
    if (KV.play(kr.game, p, String(m.card).slice(0, 2 + KV.MAX_ANS + 10))) { kvrBroadcast(kr); kvrSchedule(kr); }
  } else if (m.type === 'signal') {
    const text = clean(m.text, 40);
    if (text) { kvrSignal(kr, token, text); kvrBroadcast(kr); }
  } else if (m.type === 'chat') {
    const now = Date.now();
    if (now - (c.lastChat || 0) < CHAT_GAP) return send(ws, { type: 'error', msg: 'Polako, malo pričekaj.' });
    const text = cleanChat(m.text);
    if (!text) return;
    c.lastChat = now;
    kr.chat.push({ id: ++kr.chatSeq, tok: token, name: c.name, text, t: now });
    if (kr.chat.length > CHAT_KEEP) kr.chat.shift();
    kvrBroadcast(kr);
  }
}

// ---------- računi, prijatelji, tko je online ----------
const online = new Map(); // uid -> Set(token)
const tokensOf = uid => online.get(uid) || new Set();
const isOnline = uid => [...tokensOf(uid)].some(t => { const c = clients.get(t); return c && c.ws; });
function attach(token, c, u, sess) {
  detach(token, c);
  c.uid = u.id; c.sess = sess;
  if (!online.has(u.id)) online.set(u.id, new Set());
  online.get(u.id).add(token);
  ACC.touch(u);
  presenceSoon();
}
function detach(token, c) {
  if (!c.uid) return;
  const set = online.get(c.uid);
  if (set) { set.delete(token); if (!set.size) online.delete(c.uid); }
  c.uid = null; c.sess = null;
  c.lobby = false; // grupni chat je samo za prijavljene
  presenceSoon();
}
// gdje je korisnik: null (offline), 'menu', 'lobby' ili 'game' (+ soba)
function presenceOf(uid) {
  let best = null;
  for (const t of tokensOf(uid)) {
    const c = clients.get(t);
    if (!c || !c.ws) continue;
    const kr = c.kvRoom && KV_ROOMS.get(c.kvRoom);
    if (kr) { best = { where: 'game', kind: 'kviz', mode: kr.members.length, code: kvCode(kr), open: true, kvName: kr.name }; continue; }
    const r = c.room && rooms.get(c.room);
    if (!r) {
      // partija protiv botova se igra u pregledniku, klijent javi koju igra
      const b = c.bots ? { where: 'bots', kind: c.bots.kind, low: c.bots.low, mode: c.bots.mode } : { where: 'menu' };
      if (!best || (best.where === 'menu' && b.where === 'bots')) best = b;
      continue;
    }
    const playing = r.game && r.game.phase !== 'over';
    const p = { where: playing ? 'game' : 'lobby', code: r.code, kind: r.tour ? 'turnir' : r.kind, low: r.low, mode: r.mode, open: !playing && r.seats.some(s => !s || s.bot) };
    if (!best || best.where === 'menu' || (p.where === 'lobby' && best.where === 'game')) best = p;
  }
  return best;
}
function friendsView(u, c) {
  const list = [];
  for (const fid in u.friends) {
    const f = ACC.user(+fid);
    if (!f) continue;
    const av = f.av === 'img' && f.img ? 'i:' + storeImg(f.img) : f.av || AV.forName(f.name || f.uname);
    const ok = u.friends[fid] === 'ok';
    const dm = ok ? ACC.dmInfo(u.id, f.id) : null;
    list.push({ id: f.id, uname: f.uname, name: f.name || f.uname, av, status: u.friends[fid], at: ok ? presenceOf(f.id) : null, seen: ok ? f.seen : null, unread: dm ? dm.unread : 0, last: dm ? dm.last : 0 });
  }
  return { list, imgs: newImgs(c, list.map(f => f.av)) };
}
function accountMsg(u, c, withImg) {
  const fv = friendsView(u, c);
  return {
    type: 'account', storage: ACC.kind,
    user: Object.assign({ id: u.id, uname: u.uname, name: u.name, av: u.av, stats: u.stats, chips: ACC.chipsOf(u), refills: u.refills || 0, chipsLast: u.chipsLast || null, lobbyAdmin: isAdmin(u), admin: isAppAdmin(u), tempPass: !!u.tempPass, kviz: ACC.kvizOf(u) }, withImg ? { img: u.img } : {}),
    friends: fv.list, imgs: fv.imgs,
  };
}
function pushAccount(uid, withImg) {
  const u = ACC.user(uid);
  if (!u) return;
  for (const t of tokensOf(uid)) { const c = clients.get(t); if (c && c.ws) send(c.ws, accountMsg(u, c, withImg)); }
}
// promjene "tko je gdje" šalju se prijateljima (skupljeno, najviše jednom u 300 ms)
const lastPresence = new Map();
let presenceTimer = null;
function presenceSoon() { if (!presenceTimer) presenceTimer = setTimeout(presenceTick, 300); }
function presenceTick() {
  presenceTimer = null;
  const ids = new Set([...online.keys(), ...lastPresence.keys()]);
  const notify = new Set();
  for (const uid of ids) {
    const p = JSON.stringify(presenceOf(uid));
    if (lastPresence.get(uid) === p) continue;
    if (p === 'null') lastPresence.delete(uid); else lastPresence.set(uid, p);
    const u = ACC.user(uid);
    if (!u) continue;
    if (p === 'null') ACC.touch(u); // zadnji put viđen
    for (const fid in u.friends) if (u.friends[fid] === 'ok' && online.has(+fid)) notify.add(+fid);
  }
  for (const uid of notify) pushAccount(uid);
  lobbyWhoTick();
}
// direktne poruke: šalju se svim otvorenim vezama korisnika
function toUser(uid, msg) { for (const t of tokensOf(uid)) { const c = clients.get(t); if (c && c.ws) send(c.ws, msg); } }
function dmMessage(m, c, ws, u) {
  const err = msg => send(ws, { type: 'error', msg });
  if (!u) return err('Prijavi se da šalješ poruke.');
  const fid = +m.id;
  switch (m.type) {
    case 'dmOpen': {
      const d = ACC.dmGet(u, fid);
      if (!d) return err('Poruke možeš slati samo prijateljima.');
      send(ws, { type: 'dm', with: fid, msgs: d.m, seen: d.r[fid] || 0 });
      if (ACC.dmRead(u, fid)) { toUser(fid, { type: 'dmSeen', with: u.id, seen: d.seq }); toUser(u.id, { type: 'dmRead', with: fid }); }
      return;
    }
    case 'dmRead': {
      const seq = ACC.dmRead(u, fid);
      if (seq) { toUser(fid, { type: 'dmSeen', with: u.id, seen: seq }); toUser(u.id, { type: 'dmRead', with: fid }); }
      return;
    }
    case 'dmSend': {
      const now = Date.now();
      if (now - (c.lastDm || 0) < DM_GAP) return err('Polako, malo pričekaj.');
      const text = cleanChat(m.text, DM_LEN);
      if (!text) return;
      const res = ACC.dmSend(u, fid, text);
      if (res.error) return err(res.error);
      c.lastDm = now;
      toUser(u.id, { type: 'dmMsg', with: fid, msg: res.msg, nonce: m.nonce });
      toUser(fid, { type: 'dmMsg', with: u.id, msg: res.msg, from: u.name || u.uname, uname: u.uname });
      return;
    }
  }
}
const DM_MSGS = new Set(['dmOpen', 'dmRead', 'dmSend']);

// ---------- grupni chat: jedna soba za sve koji su online ----------
// samo za prijavljene: gosti ne dobivaju ni poruke ni popis tko je online, i ne mogu pisati.
// Poruke se čuvaju u bazi (zadnjih 100). LOBBY_ADMINS = korisnička imena (zarezom) koja smiju brisati tuđe poruke.
const LOBBY_LEN = 200, LOBBY_GAP = 1500, LOBBY_BURST = 6, LOBBY_WIN = 30000;
const LOBBY_ADMINS = new Set(String(process.env.LOBBY_ADMINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
// ADMINS = admini aplikacije (reset lozinke, povijest partija svih igrača); zadano Botti. Admini smiju i sve iz LOBBY_ADMINS.
const ADMINS = new Set(String(process.env.ADMINS || 'Botti').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const isAppAdmin = u => !!u && ADMINS.has(u.uname.toLowerCase());
const isAdmin = u => !!u && (LOBBY_ADMINS.has(u.uname.toLowerCase()) || isAppAdmin(u));
function userCard(uid) {
  const u = ACC.user(uid);
  if (!u) return { id: uid, name: 'Igrač', uname: '', av: 'e0' };
  const av = u.av === 'img' && u.img ? 'i:' + storeImg(u.img) : u.av || AV.forName(u.name || u.uname);
  return { id: u.id, name: u.name || u.uname, uname: u.uname, av };
}
// tko je online: prijavljeni (po računu) + broj gostiju (po vezi)
function lobbyWho() {
  const ids = [...online.keys()].filter(isOnline);
  let guests = 0;
  for (const c of clients.values()) if (c.ws && !c.uid) guests++;
  return { who: ids, guests };
}
function lobbyUsers(c, ids) {
  const users = {};
  for (const id of ids) if (!users[id]) users[id] = userCard(id);
  const list = Object.values(users);
  return { users, imgs: newImgs(c, list.map(x => x.av)) };
}
const lobbySubs = () => [...clients.values()].filter(c => c.ws && c.lobby && c.uid);
function lobbyMessage(m, c, ws) {
  const err = msg => send(ws, { type: 'error', msg });
  const u = c.uid ? ACC.user(c.uid) : null;
  switch (m.type) {
    case 'lobbyOpen': {
      if (!u) { c.lobby = false; return send(ws, { type: 'lobbyDenied' }); }
      c.lobby = true;
      const d = ACC.lobbyGet(), w = lobbyWho();
      const ux = lobbyUsers(c, d.m.map(x => x.f).concat(w.who));
      send(ws, { type: 'lobby', msgs: d.m, who: w.who, guests: w.guests, users: ux.users, imgs: ux.imgs });
      return;
    }
    case 'lobbyClose': c.lobby = false; return;
    case 'lobbySend': {
      if (!u) return err('Prijavi se da pišeš u grupni chat.');
      if (!ACC.isReady()) return err('Chat trenutno nije dostupan, pokušaj za minutu.');
      const now = Date.now();
      c.lobbyT = (c.lobbyT || []).filter(t => now - t < LOBBY_WIN);
      if (now - (c.lastLobby || 0) < LOBBY_GAP || c.lobbyT.length >= LOBBY_BURST) return err('Polako, malo pričekaj.');
      const text = cleanChat(m.text, LOBBY_LEN);
      if (!text) return;
      if (text === c.lobbyLast && now - (c.lastLobby || 0) < 30000) return err('Ista poruka je već poslana.');
      // poziv u sobu: samo u vlastitu sobu koja ima slobodno mjesto i u kojoj se još ne igra
      let code = null;
      if (m.code) {
        const r = c.room && rooms.get(c.room);
        if (!r || r.code !== m.code || (r.game && r.game.phase !== 'over') || !r.seats.some(s => !s || s.bot)) return err('Soba nema slobodnih mjesta.');
        code = r.code;
      }
      c.lastLobby = now; c.lobbyLast = text; c.lobbyT.push(now);
      const msg = ACC.lobbyAdd(u, text, code);
      for (const sc of lobbySubs()) {
        const ux = lobbyUsers(sc, [u.id]);
        send(sc.ws, { type: 'lobbyMsg', msg, users: ux.users, imgs: ux.imgs });
      }
      return;
    }
    case 'lobbyDel': {
      if (!u || !ACC.lobbyDel(u, +m.id, isAdmin(u))) return;
      for (const sc of lobbySubs()) send(sc.ws, { type: 'lobbyDel', id: +m.id });
      return;
    }
  }
}
const LOBBY_MSGS = new Set(['lobbyOpen', 'lobbyClose', 'lobbySend', 'lobbyDel']);
let lastWho = '';
function lobbyWhoTick() {
  const w = lobbyWho(), k = JSON.stringify(w);
  if (k === lastWho) return;
  lastWho = k;
  for (const sc of lobbySubs()) {
    const ux = lobbyUsers(sc, w.who);
    send(sc.ws, { type: 'lobbyWho', who: w.who, guests: w.guests, users: ux.users, imgs: ux.imgs });
  }
}
const ipOf = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
const STAT_GAP = 8000; // partija protiv botova ne može trajati kraće

function accountMessage(m, token, c, ws, ip) {
  const err = msg => send(ws, { type: 'error', msg });
  const authErr = msg => send(ws, { type: 'authError', msg });
  const u = c.uid ? ACC.user(c.uid) : null;
  if (DM_MSGS.has(m.type)) return dmMessage(m, c, ws, u);
  switch (m.type) {
    case 'register': case 'login': {
      const res = m.type === 'register'
        ? ACC.register(m.uname, m.pass, accProfile(c), ip)
        : ACC.login(m.uname, m.pass, ip);
      if (res.error) return authErr(res.error);
      attach(token, c, res.user, res.token);
      if (m.type === 'login') profileFromUser(c, res.user);
      send(ws, { type: 'auth', token: res.token, fresh: m.type === 'register' });
      send(ws, accountMsg(res.user, c, true));
      const r = c.room && rooms.get(c.room);
      if (r) broadcast(r);
      return;
    }
    case 'logout': if (c.sess) ACC.logout(c.sess); detach(token, c); send(ws, { type: 'account', user: null, friends: [] }); return;
    case 'account': if (u) send(ws, accountMsg(u, c)); return;
    case 'password': {
      if (!u) return;
      const res = ACC.changePass(u, m.old, m.pass);
      return res.error ? authErr(res.error) : send(ws, { type: 'info', msg: 'Lozinka je promijenjena.' });
    }
    case 'adminReset': {
      if (!isAppAdmin(u)) return err('To smije samo admin.');
      const t = ACC.byUname(m.uname);
      if (!t) return err('Nema korisnika s tim imenom.');
      const pass = ACC.resetPass(t);
      // sve prijave tog korisnika se odjave
      for (const tk of [...tokensOf(t.id)]) {
        const tc = clients.get(tk);
        if (!tc) continue;
        detach(tk, tc);
        if (tc.ws) send(tc.ws, { type: 'account', user: null, friends: [], expired: true });
      }
      send(ws, { type: 'adminReset', uname: t.uname, pass });
      return;
    }
    case 'history': {
      if (!u) return;
      let who = u;
      if (m.uname && String(m.uname).toLowerCase() !== u.uname.toLowerCase()) {
        if (!isAppAdmin(u)) return err('Tuđu povijest vidi samo admin.');
        who = ACC.byUname(m.uname);
        if (!who) return err('Nema korisnika s tim imenom.');
      }
      send(ws, { type: 'history', uname: who.uname, mine: who === u, list: ACC.history(who) });
      return;
    }
    case 'game': {
      if (!u) return;
      const d = ACC.game(m.id);
      if (!d || !(d.uids.includes(u.id) || isAppAdmin(u))) return err('Ta partija više nije spremljena.');
      const { uids, ...doc } = d;
      send(ws, { type: 'game', game: Object.assign(doc, { me: uids.indexOf(u.id) }) });
      return;
    }
    case 'friendAdd': {
      if (!u) return err('Prijavi se da dodaš prijatelje.');
      const res = ACC.befriend(u, m.uname);
      if (res.error) return err(res.error);
      send(ws, { type: 'info', msg: res.accepted ? res.friend.uname + ' ti je sada prijatelj/ica!' : 'Zahtjev poslan korisniku ' + res.friend.uname + '.' });
      pushAccount(u.id); pushAccount(res.friend.id);
      return;
    }
    case 'friendAccept': case 'friendRemove': {
      if (!u) return;
      const res = m.type === 'friendAccept' ? ACC.accept(u, +m.id) : ACC.unfriend(u, +m.id);
      if (res.error) return err(res.error);
      pushAccount(u.id); if (res.friend) pushAccount(res.friend.id);
      return;
    }
    case 'invite': {
      if (!u) return;
      const f = ACC.user(+m.id);
      const r = c.room && rooms.get(c.room);
      if (!f || u.friends[f.id] !== 'ok') return err('Možeš pozvati samo prijatelje.');
      if (!r) return err('Prvo napravi sobu.');
      if (!isOnline(f.id)) return err((f.name || f.uname) + ' nije online.');
      const now = Date.now();
      if (now - (c.lastInvite || 0) < 1500) return;
      c.lastInvite = now;
      const inv = { type: 'invite', from: u.name || u.uname, uname: u.uname, code: r.code, kind: r.tour ? 'turnir' : r.kind, low: r.low, mode: r.mode };
      for (const t of tokensOf(f.id)) { const fc = clients.get(t); if (fc && fc.ws && fc.room !== r.code) send(fc.ws, inv); }
      send(ws, { type: 'info', msg: 'Poziv poslan: ' + (f.name || f.uname) });
      return;
    }
    case 'stat': {
      // partija protiv botova u pregledniku (server je ne vidi, pa vjeruje klijentu)
      if (!u) return;
      const key = Accounts.statKey(kindOf(m), lowOf(m));
      if (!['w', 'l', 'd'].includes(m.res)) return;
      c.statAt = c.statAt || {};
      const now = Date.now();
      // poker protiv botova: poraz = izgubljen ulog, pobjeda = ulozi svih botova (iznos računa server, ne klijent)
      const bank = key === 'poker' && [2, 3, 4].includes(m.mode) && m.res !== 'd';
      if (bank && m.res === 'l') ACC.addChips(u, -P.START_CHIPS);
      if (now - (c.statAt[key] || 0) < STAT_GAP) { if (bank && m.res === 'l') pushAccount(u.id); return; }
      c.statAt[key] = now;
      if (bank && m.res === 'w') ACC.addChips(u, (m.mode - 1) * P.START_CHIPS);
      ACC.record(u, 'bots', key, m.res, Math.min(+m.ms || 0, now - (c.botT || now)));
      c.botT = now; // sljedeća partija se broji od sad
      pushAccount(u.id);
      return;
    }
  }
}
const ACCOUNT_MSGS = new Set(['register', 'login', 'logout', 'account', 'password', 'friendAdd', 'friendAccept', 'friendRemove', 'invite', 'stat', 'adminReset', 'history', 'game', ...DM_MSGS]);

wss.on('connection', (ws, req) => {
  let token = null;
  const ip = ipOf(req);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'hello') {
      token = (typeof m.token === 'string' && /^[a-f0-9]{32}$/.test(m.token)) ? m.token : crypto.randomBytes(16).toString('hex');
      const old = clients.get(token);
      if (old && old.ws && old.ws !== ws) try { old.ws.close(); } catch { }
      const c = old || { room: null };
      c.ws = ws; c.name = clean(m.name) || c.name || 'Igrač';
      c.sentImgs = new Set(); // nova veza: slike treba poslati ponovno
      c.lobby = false;        // grupni chat: klijent se ponovno pretplati (lobbyOpen)
      setProfile(c, { av: m.av, img: m.img });
      clients.set(token, c);
      send(ws, { type: 'welcome', token });
      const r = c.room && rooms.get(c.room);
      if (r && seatOf(r, token) >= 0) { broadcast(r); schedule(r); }
      else c.room = null;
      const kr = c.kvRoom && KV_ROOMS.get(c.kvRoom);
      if (kr && kr.members.includes(token)) kvrBroadcast(kr); else c.kvRoom = null;
      // prijavljeni korisnik (token sesije iz preglednika)
      if (m.auth) ACC.ready.then(() => {
        const u = ACC.bySession(m.auth);
        if (c.ws !== ws) return;
        if (!u) { detach(token, c); return send(ws, { type: 'account', user: null, friends: [], expired: true }); }
        attach(token, c, u, m.auth);
        send(ws, accountMsg(u, c, true));
      });
      else detach(token, c);
      presenceSoon();
      return;
    }
    if (!token) return;
    const c = clients.get(token);
    const r = c.room ? rooms.get(c.room) : null;
    const err = msg => send(ws, { type: 'error', msg });
    if (LOBBY_MSGS.has(m.type)) return lobbyMessage(m, c, ws);
    if (m.type === 'kvList') { c.kvList = !m.off; if (c.kvList) send(ws, kvListMsg()); return; }
    if (m.type === 'kvTop') return send(ws, kvTopMsg(c, m.cat));
    if (c.kvRoom && KVR_MSGS.has(m.type)) return kvrMessage(m, token, c, ws);
    if (ACCOUNT_MSGS.has(m.type)) {
      if (!ACC.isReady()) return m.type === 'login' || m.type === 'register' ? send(ws, { type: 'authError', msg: 'Računi trenutno nisu dostupni (baza se spaja). Pokušaj za minutu.' }) : undefined;
      return accountMessage(m, token, c, ws, ip);
    }
    switch (m.type) {
      case 'setName': c.name = clean(m.name) || c.name; break;
      case 'botGame': if (!m.off) c.botT = Date.now(); c.bots = m.off ? null : { kind: kindOf(m), low: lowOf(m), mode: [2, 3, 4].includes(+m.mode) ? +m.mode : 2 }; presenceSoon(); break;
      case 'profile': {
        const acc = setProfile(c, m);
        const u = c.uid && ACC.user(c.uid);
        if (u) ACC.setProfile(u, acc);
        const i = r ? seatOf(r, token) : -1;
        if (i >= 0 && (!r.game || r.game.phase === 'over')) r.seats[i].name = c.name;
        if (r) broadcast(r);
        break;
      }
      case 'create': {
        const mode = +m.mode;
        if (![2, 3, 4].includes(mode)) return err('Neispravan način igre.');
        leaveCurrent(token);
        const nr = createRoom(mode, token, { level: m.level, isPublic: false, kind: kindOf(m), low: lowOf(m), target: m.target, turnTime: m.turnTime });
        joinRoom(nr, token);
        broadcast(nr); break;
      }
      case 'join': {
        const kc = clean(m.code, 8).toUpperCase();
        if (kc.startsWith('KV-')) { const e = kvrJoin(token, kc.slice(3).toLowerCase()); if (e) err(e); break; }
        const nr = rooms.get(kc);
        if (!nr) return err('Soba ne postoji.');
        if (!joinRoom(nr, token)) return err('Soba je puna ili igra već traje.');
        broadcast(nr); break;
      }
      case 'quick': {
        const mode = +m.mode;
        if (![2, 3, 4].includes(mode)) return err('Neispravan način igre.');
        const kind = kindOf(m), low = lowOf(m);
        let nr = [...rooms.values()].find(x => x.isPublic && x.mode === mode && (kind === 'turnir' ? !!x.tour && !tourBusy(x) : !x.tour && x.kind === kind && x.low === low) && !x.game && x.seats.includes(null) && seatOf(x, token) < 0);
        if (!nr) { leaveCurrent(token); nr = createRoom(mode, token, { isPublic: true, kind, low }); }
        joinRoom(nr, token);
        if (!nr.seats.includes(null)) startGame(nr); else broadcast(nr);
        break;
      }
      case 'leave': leaveCurrent(token); send(ws, { type: 'left' }); presenceSoon(); break;
      case 'seat': {
        if (!r || (r.game && r.game.phase !== 'over')) return;
        if (tourBusy(r)) return err('Tijekom turnira mjesta se ne mijenjaju (bodovi pripadaju mjestu).');
        const from = seatOf(r, token), to = +m.seat;
        if (from < 0 || !(to >= 0 && to < r.mode) || to === from) return;
        const t = r.seats[to];
        if (t && !t.bot) return err('To mjesto je zauzeto.');
        r.seats[to] = r.seats[from]; r.seats[from] = t || null;
        r.game = null; broadcast(r); break;
      }
      case 'addBot': if (r && r.host === token && !r.game) { addBot(r); broadcast(r); } break;
      case 'kick': if (r && r.host === token && !r.game) { const s = r.seats[+m.seat]; if (s && s.bot) { r.seats[+m.seat] = null; broadcast(r); } } break;
      case 'variant': if (r && r.host === token && !r.isPublic && (!r.game || r.game.phase === 'over')) { setKind(r, kindOf(m), lowOf(m)); r.game = null; broadcast(r); } break;
      case 'target': if (r && r.host === token && T.TARGETS.includes(+m.target) && (!r.game || r.game.phase === 'over')) { r.target = +m.target; r.game = null; broadcast(r); } break;
      case 'next': {
        // kraj ruke: svatko pritisne "Dalje"; kad su svi spremni, odmah nova ruka (inače nakon HAND_PAUSE)
        if (!r || !r.game || r.game.phase !== 'hand') break;
        const i = seatOf(r, token);
        if (i < 0) break;
        if (!r.ready) r.ready = new Set();
        r.ready.add(i);
        const humans = r.seats.map((x, q) => x && !x.bot && clients.get(x.token) && clients.get(x.token).ws && !(r.kind === 'poker' && r.game.players[q].out) ? q : -1).filter(q => q >= 0);
        if (humans.every(q => r.ready.has(q))) nextHand(r); else broadcast(r);
        break;
      }
      case 'turnTime': if (r && r.host === token && !r.isPublic && (!r.game || r.game.phase === 'over')) { r.turnTime = turnTimeOf(m.turnTime); broadcast(r); } break;
      case 'level': if (r && r.host === token && ['easy', 'normal', 'hard'].includes(m.level)) { r.level = m.level; broadcast(r); } break;
      case 'start':
        if (!r || r.host !== token) return;
        if (r.game && r.game.phase !== 'over') return;
        if (m.fillBots) while (r.seats.includes(null)) addBot(r);
        if (!startGame(r)) err('Sva mjesta moraju biti popunjena.');
        break;
      case 'toLobby': if (r && r.host === token && r.game && r.game.phase === 'over') { r.game = null; broadcast(r); } break;
      case 'play': {
        if (!r || !r.game) return;
        const p = seatOf(r, token);
        if (engOf(r).play(r.game, p, String(m.card).slice(0, 20))) { broadcast(r); schedule(r); }
        break;
      }
      case 'signal': {
        if (!r || !r.game) return;
        const p = seatOf(r, token);
        if (p < 0) return;
        const text = clean(m.text, 40);
        if (!text) return;
        pushSignal(r, p, text, r.mode === 4 && m.team);
        broadcast(r); break;
      }
      case 'chat': {
        if (!r) return;
        const p = seatOf(r, token);
        if (p < 0) return;
        const now = Date.now();
        if (now - (c.lastChat || 0) < CHAT_GAP) return err('Polako, malo pričekaj.');
        const text = cleanChat(m.text);
        if (!text) return;
        c.lastChat = now;
        r.chat.push({ id: ++r.chatSeq, from: p, name: r.seats[p].name, text, t: now });
        if (r.chat.length > CHAT_KEEP) r.chat.shift();
        broadcast(r); break;
      }
    }
  });
  ws.on('close', () => {
    const c = token && clients.get(token);
    if (!c || c.ws !== ws) return;
    c.ws = null;
    const r = c.room && rooms.get(c.room);
    if (r) { broadcast(r); schedule(r); }
    // stalna kviz soba: tko se ne vrati za 30 s, izlazi iz sobe
    const kr = c.kvRoom && KV_ROOMS.get(c.kvRoom);
    if (kr) { kvrBroadcast(kr); clearTimeout(c.kvAway); c.kvAway = setTimeout(() => { if (!c.ws && c.kvRoom) kvrLeave(token); }, KVR_AWAY); }
    presenceSoon();
  });
});

// čišćenje starih soba
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of rooms) if (now - r.touched > ROOM_TTL) { clearTimeout(r.timer); stopTurnTimer(r); kvStop(r); rooms.delete(k); }
  for (const [k, c] of clients) if (!c.ws && !c.room && !c.kvRoom) { detach(k, c); clients.delete(k); }
}, 60000).unref();

// Render (i ostali) šalju SIGTERM prije gašenja: zapiši sve u bazu
process.once('SIGTERM', () => { ACC.flush().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 4000).unref(); });

server.listen(PORT, () => console.log('Briškula server na http://localhost:' + PORT));
server.accounts = ACC;
server.kvRooms = KV_ROOMS;
module.exports = server;
