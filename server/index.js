/* Briškula online – HTTP + WebSocket server */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const E = require('../public/engine.js');
const B = require('../public/bot.js');
const T = require('../public/treseta.js');
const TB = require('../public/treseta-bot.js');
const AV = require('../public/avatars.js');
const P = require('../public/poker.js');
const PB = require('../public/poker-bot.js');
const TR = require('../public/turnir.js');
const Store = require('./store.js');
const Accounts = require('./accounts.js');
const ACC = Accounts.create(Store.open());
// igra: briškula ili trešeta; low = "Chi fa meno" (na manje) za obje
// (stari klijenti šalju kind 'meno' = briškula na manje)
const kindOf = m => m.kind === 'treseta' || m.kind === 'poker' || m.kind === 'turnir' ? m.kind : 'briskula';
const lowOf = m => m.kind !== 'poker' && m.kind !== 'turnir' && (!!m.low || m.kind === 'meno');
const engOf = r => r.kind === 'treseta' ? T : r.kind === 'poker' ? P : E;
const botOf = r => r.kind === 'treseta' ? TB : r.kind === 'poker' ? PB : B;
// strana (za brojanje pobjeda): u pokeru svatko igra za sebe, i u četvero
const sideOf = (r, p) => r.kind === 'poker' ? p : E.teamOf(r.mode, p);
const sideCount = r => r.mode === 4 && r.kind !== 'poker' ? 2 : r.mode;

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/health') { res.writeHead(200); return res.end('ok'); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { // SPA fallback
      return fs.readFile(path.join(PUB, 'index.html'), (e2, d2) => { res.writeHead(e2 ? 404 : 200, { 'Content-Type': TYPES['.html'] }); res.end(d2); });
    }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': p === '/sw.js' ? 'no-cache' : 'public, max-age=300' });
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

// ---------- profil: avatar i "dužina pišulinca" ----------
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
const cleanCm = v => { v = Math.round(+v); return v >= 1 && v <= 50 ? v : 0; };
// vraća profil za korisnički račun (ako je igrač prijavljen)
function setProfile(c, m) {
  const acc = {};
  if ('name' in m) acc.name = c.name = clean(m.name) || c.name || 'Igrač';
  if ('cm' in m) acc.cm = c.cm = cleanCm(m.cm);
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
  return { name: c.name, cm: c.cm || 0, av: id ? (IMGS.has(id) ? 'img' : null) : c.av || null, img: id && IMGS.get(id) || null };
}
// profil iz računa (npr. nakon prijave na drugom uređaju)
function profileFromUser(c, u) {
  c.name = u.name || u.uname; c.cm = u.cm || 0;
  c.av = u.av === 'img' && u.img ? 'i:' + storeImg(u.img) : cleanAv(u.av) || c.av;
}
// prikaz mjesta: ljudi uvijek s trenutnim profilom
function seatAv(s) {
  if (s.bot) return { av: s.av || AV.forName(s.name), cm: s.cm || 0 };
  const c = clients.get(s.token);
  const u = c && c.uid && ACC.user(c.uid);
  return Object.assign({ av: (c && c.av) || AV.forName(s.name), cm: (c && c.cm) || 0 }, u ? { uname: u.uname } : {});
}

function createRoom(mode, host, opts) {
  const r = {
    code: code(), mode, seats: Array(mode).fill(null), host, game: null, timer: null,
    level: ['easy', 'normal', 'hard'].includes(opts.level) ? opts.level : 'normal',
    isPublic: !!opts.isPublic, kind: opts.kind || 'briskula', low: !!opts.low, tour: null, target: T.TARGETS.includes(+opts.target) ? +opts.target : 41, signals: [], chat: [], chatSeq: 0, wins: null, touched: Date.now(), awayTimer: null,
    turnTime: turnTimeOf(opts.turnTime), turnTimer: null, turnKey: null, turnEnds: 0,
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
  // botovi dobiju nasumičnu dužinu pišulinca (1–50 cm), ista dok sjede u sobi
  r.seats[i] = { bot: true, name, av: AV.forName(name), cm: 1 + Math.floor(Math.random() * 50) };
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
  if (!c || !c.room) return;
  const r = rooms.get(c.room);
  c.room = null;
  if (!r) return;
  const i = seatOf(r, token);
  if (i < 0) return;
  if (r.game && r.game.phase !== 'over') {
    // tijekom igre bot preuzima mjesto
    const p = seatAv(r.seats[i]);
    r.seats[i] = { bot: true, name: r.seats[i].name + ' (bot)', av: p.av, cm: p.cm };
    r.game.players[i].bot = true;
    r.game.players[i].name = r.seats[i].name;
    pushSignal(r, -1, r.seats[i].name.replace(' (bot)', '') + ' je napustio/la igru, bot igra umjesto njega/nje.');
    schedule(r);
  } else r.seats[i] = null;
  if (r.host === token) {
    const h = r.seats.find(s => s && !s.bot);
    r.host = h ? h.token : null;
  }
  if (!r.seats.some(s => s && !s.bot)) { clearTimeout(r.timer); stopTurnTimer(r); rooms.delete(r.code); return; }
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
  const seats = r.seats.map(s => s ? Object.assign({ name: s.name, bot: !!s.bot, connected: s.bot || !!(clients.get(s.token) && clients.get(s.token).ws) }, seatAv(s)) : null);
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
  const o = { names: r.seats.map(s => s.name), bots: r.seats.map(s => !!s.bot), dealer: prevDealer + 1, blindEvery: r.tour ? TOUR_BLINDS : undefined };
  if (r.kind === 'poker') r.game = P.newGame(r.mode, o);
  else r.game = r.kind === 'treseta' ? T.newGame(r.mode, Object.assign(o, { target: r.target, low: r.low })) : E.newGame(r.mode, Object.assign(o, { low: r.low }));
  r.signals = []; r.ready = new Set();
  // tko je za stolom s računom (za statistiku; tko izađe usred partije, upiše mu se poraz)
  r.uids = r.seats.map(s => { const c = !s.bot && clients.get(s.token); return c && c.uid || null; });
  r.humans = r.seats.filter(s => !s.bot).length;
  broadcast(r); schedule(r);
  return true;
}

// ---------- statistika ----------
function recordStats(r, g) {
  if (!r.uids || !g.result) return;
  const res = g.result;
  const section = r.humans >= 2 ? 'online' : 'bots';
  const key = Accounts.statKey(r.kind, r.low);
  // zadnja igra turnira: upiši i cijeli turnir (pobjeda = prvo mjesto)
  const st = r.tour && r.tour.done ? TR.standings(r.tour) : null;
  r.uids.forEach((uid, i) => {
    const u = uid && ACC.user(uid);
    if (!u) return;
    ACC.record(u, section, key, res.draw ? 'd' : res.winners.includes(i) ? 'w' : 'l');
    if (st) {
      const firsts = st.filter(x => x.place === 1).length;
      ACC.record(u, section, 'turnir', firsts === st.length ? 'd' : st.find(x => x.p === i).place === 1 ? 'w' : 'l');
    }
    pushAccount(uid);
  });
  r.uids = null; // jednom po partiji
}

// timer za potez vrijedi samo kad su za stolom barem dva čovjeka
function timedTurn(r) {
  const g = r.game;
  if (!g || g.phase !== 'play' || !r.turnTime) return false;
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
    if (r.kind === 'poker') pokerTimeout(r, g.turn); else forfeit(r, g.turn);
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
  presenceSoon();
}
// gdje je korisnik: null (offline), 'menu', 'lobby' ili 'game' (+ soba)
function presenceOf(uid) {
  let best = null;
  for (const t of tokensOf(uid)) {
    const c = clients.get(t);
    if (!c || !c.ws) continue;
    const r = c.room && rooms.get(c.room);
    if (!r) { best = best || { where: 'menu' }; continue; }
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
    list.push({ id: f.id, uname: f.uname, name: f.name || f.uname, av, cm: f.cm || 0, status: u.friends[fid], at: ok ? presenceOf(f.id) : null, seen: ok ? f.seen : null, unread: dm ? dm.unread : 0, last: dm ? dm.last : 0 });
  }
  return { list, imgs: newImgs(c, list.map(f => f.av)) };
}
function accountMsg(u, c, withImg) {
  const fv = friendsView(u, c);
  return {
    type: 'account', storage: ACC.kind,
    user: Object.assign({ id: u.id, uname: u.uname, name: u.name, av: u.av, cm: u.cm, stats: u.stats }, withImg ? { img: u.img } : {}),
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
      if (now - (c.statAt[key] || 0) < STAT_GAP) return;
      c.statAt[key] = now;
      ACC.record(u, 'bots', key, m.res);
      pushAccount(u.id);
      return;
    }
  }
}
const ACCOUNT_MSGS = new Set(['register', 'login', 'logout', 'account', 'password', 'friendAdd', 'friendAccept', 'friendRemove', 'invite', 'stat', ...DM_MSGS]);

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
      setProfile(c, { av: m.av, img: m.img, cm: m.cm });
      clients.set(token, c);
      send(ws, { type: 'welcome', token });
      const r = c.room && rooms.get(c.room);
      if (r && seatOf(r, token) >= 0) { broadcast(r); schedule(r); }
      else c.room = null;
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
    if (ACCOUNT_MSGS.has(m.type)) {
      if (!ACC.isReady()) return m.type === 'login' || m.type === 'register' ? send(ws, { type: 'authError', msg: 'Računi trenutno nisu dostupni (baza se spaja). Pokušaj za minutu.' }) : undefined;
      return accountMessage(m, token, c, ws, ip);
    }
    switch (m.type) {
      case 'setName': c.name = clean(m.name) || c.name; break;
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
        const nr = rooms.get(clean(m.code, 8).toUpperCase());
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
    presenceSoon();
  });
});

// čišćenje starih soba
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of rooms) if (now - r.touched > ROOM_TTL) { clearTimeout(r.timer); stopTurnTimer(r); rooms.delete(k); }
  for (const [k, c] of clients) if (!c.ws && !c.room) { detach(k, c); clients.delete(k); }
}, 60000).unref();

// Render (i ostali) šalju SIGTERM prije gašenja: zapiši sve u bazu
process.once('SIGTERM', () => { ACC.flush().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 4000).unref(); });

server.listen(PORT, () => console.log('Briškula server na http://localhost:' + PORT));
server.accounts = ACC;
module.exports = server;
