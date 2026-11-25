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
// igra: briškula ili trešeta; low = "Chi fa meno" (na manje) za obje
// (stari klijenti šalju kind 'meno' = briškula na manje)
const kindOf = m => m.kind === 'treseta' ? 'treseta' : 'briskula';
const lowOf = m => !!m.low || m.kind === 'meno';
const engOf = r => r.kind === 'treseta' ? T : E;
const botOf = r => r.kind === 'treseta' ? TB : B;

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
const HAND_PAUSE = 9000, TRICK_PAUSE = 1400, BOT_DELAY = 750, AWAY_AUTOPLAY = 25000, ROOM_TTL = 30 * 60 * 1000;

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c; do { c = Array.from({ length: 5 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c));
  return c;
}
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function clean(s, n) { return String(s || '').replace(/[<>]/g, '').trim().slice(0, n || 20); }
// chat: bez kontrolnih znakova, razmaci sažeti, do 200 znakova
function cleanChat(s) { return String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_LEN); }

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
function setProfile(c, m) {
  if ('name' in m) c.name = clean(m.name) || c.name || 'Igrač';
  if ('cm' in m) c.cm = cleanCm(m.cm);
  if ('av' in m) {
    if (m.av === 'img') { const d = cleanImg(m.img); c.av = d ? 'i:' + storeImg(d) : (c.av || 'e0'); }
    else c.av = cleanAv(m.av) || c.av || null;
  }
}
// prikaz mjesta: ljudi uvijek s trenutnim profilom
function seatAv(s) {
  if (s.bot) return { av: s.av || AV.forName(s.name), cm: s.cm || 0 };
  const c = clients.get(s.token);
  return { av: (c && c.av) || AV.forName(s.name), cm: (c && c.cm) || 0 };
}

function createRoom(mode, host, opts) {
  const r = {
    code: code(), mode, seats: Array(mode).fill(null), host, game: null, timer: null,
    level: ['easy', 'normal', 'hard'].includes(opts.level) ? opts.level : 'normal',
    isPublic: !!opts.isPublic, kind: opts.kind || 'briskula', low: !!opts.low, target: T.TARGETS.includes(+opts.target) ? +opts.target : 41, signals: [], chat: [], chatSeq: 0, wins: Array(mode === 4 ? 2 : mode).fill(0), touched: Date.now(), awayTimer: null,
  };
  rooms.set(r.code, r);
  return r;
}

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
  if (!r.seats.some(s => s && !s.bot)) { clearTimeout(r.timer); rooms.delete(r.code); return; }
  broadcast(r);
}

function pushSignal(r, from, text, teamOnly) {
  r.signals.push({ id: Date.now() + Math.random(), from, text, team: teamOnly ? E.teamOf(r.mode, from) : null, t: Date.now() });
  if (r.signals.length > 20) r.signals.shift();
}

function roomView(r, token) {
  const you = seatOf(r, token);
  const g = r.game;
  const c = clients.get(token);
  const seats = r.seats.map(s => s ? Object.assign({ name: s.name, bot: !!s.bot, connected: s.bot || !!(clients.get(s.token) && clients.get(s.token).ws) }, seatAv(s)) : null);
  // slike koje ovaj klijent još nije dobio
  const imgs = {};
  for (const s of seats) if (s && s.av.startsWith('i:')) {
    const id = s.av.slice(2);
    if (c && c.sentImgs && c.sentImgs.has(id)) continue;
    if (IMGS.has(id)) { imgs[id] = IMGS.get(id); if (c && c.sentImgs) c.sentImgs.add(id); }
  }
  return {
    type: 'room', imgs,
    code: r.code, mode: r.mode, level: r.level, isPublic: r.isPublic, low: r.low, kind: r.kind, target: r.target,
    host: r.host === token, you, wins: r.wins,
    seats,
    game: g ? engOf(r).viewFor(g, you) : null,
    signals: r.signals.filter(s => s.team == null || (you >= 0 && s.team === E.teamOf(r.mode, you))).slice(-6),
    chat: r.chat.slice(-30),
  };
}

function broadcast(r) {
  r.touched = Date.now();
  for (const s of r.seats) if (s && !s.bot) { const c = clients.get(s.token); if (c && c.room === r.code) send(c.ws, roomView(r, s.token)); }
}

function startGame(r) {
  if (r.seats.some(s => !s)) return false;
  const prevDealer = r.game ? r.game.dealer : -1;
  const o = { names: r.seats.map(s => s.name), bots: r.seats.map(s => !!s.bot), dealer: prevDealer + 1 };
  r.game = r.kind === 'treseta' ? T.newGame(r.mode, Object.assign(o, { target: r.target, low: r.low })) : E.newGame(r.mode, Object.assign(o, { low: r.low }));
  r.signals = [];
  broadcast(r); schedule(r);
  return true;
}

function schedule(r) {
  clearTimeout(r.timer); clearTimeout(r.awayTimer);
  const g = r.game;
  if (!g) return;
  if (g.phase === 'collect') {
    r.timer = setTimeout(() => {
      engOf(r).collect(g);
      if (g.phase === 'over') {
        const res = g.result;
        if (!res.draw) r.wins[E.teamOf(r.mode, res.winners[0])]++;
      }
      broadcast(r); schedule(r);
    }, TRICK_PAUSE);
  } else if (g.phase === 'hand') {
    // kraj ruke u trešeti: kratka pauza za pregled bodova, pa nova ruka
    r.timer = setTimeout(() => nextHand(r), HAND_PAUSE);
  } else if (g.phase === 'play') {
    const s = r.seats[g.turn];
    const c = s && !s.bot ? clients.get(s.token) : null;
    if (s.bot) r.timer = setTimeout(() => botMove(r), BOT_DELAY + Math.random() * 400);
    else if (!c || !c.ws) r.awayTimer = setTimeout(() => botMove(r), AWAY_AUTOPLAY);
  }
}

function nextHand(r) {
  const g = r.game;
  if (!g || g.phase !== 'hand') return;
  T.nextHand(g); r.signals = [];
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

wss.on('connection', ws => {
  let token = null;
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
      return;
    }
    if (!token) return;
    const c = clients.get(token);
    const r = c.room ? rooms.get(c.room) : null;
    const err = msg => send(ws, { type: 'error', msg });
    switch (m.type) {
      case 'setName': c.name = clean(m.name) || c.name; break;
      case 'profile': {
        setProfile(c, m);
        const i = r ? seatOf(r, token) : -1;
        if (i >= 0 && (!r.game || r.game.phase === 'over')) r.seats[i].name = c.name;
        if (r) broadcast(r);
        break;
      }
      case 'create': {
        const mode = +m.mode;
        if (![2, 3, 4].includes(mode)) return err('Neispravan način igre.');
        leaveCurrent(token);
        const nr = createRoom(mode, token, { level: m.level, isPublic: false, kind: kindOf(m), low: lowOf(m), target: m.target });
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
        let nr = [...rooms.values()].find(x => x.isPublic && x.mode === mode && x.kind === kind && x.low === low && !x.game && x.seats.includes(null) && seatOf(x, token) < 0);
        if (!nr) { leaveCurrent(token); nr = createRoom(mode, token, { isPublic: true, kind, low }); }
        joinRoom(nr, token);
        if (!nr.seats.includes(null)) startGame(nr); else broadcast(nr);
        break;
      }
      case 'leave': leaveCurrent(token); send(ws, { type: 'left' }); break;
      case 'seat': {
        if (!r || (r.game && r.game.phase !== 'over')) return;
        const from = seatOf(r, token), to = +m.seat;
        if (from < 0 || !(to >= 0 && to < r.mode) || to === from) return;
        const t = r.seats[to];
        if (t && !t.bot) return err('To mjesto je zauzeto.');
        r.seats[to] = r.seats[from]; r.seats[from] = t || null;
        r.game = null; broadcast(r); break;
      }
      case 'addBot': if (r && r.host === token && !r.game) { addBot(r); broadcast(r); } break;
      case 'kick': if (r && r.host === token && !r.game) { const s = r.seats[+m.seat]; if (s && s.bot) { r.seats[+m.seat] = null; broadcast(r); } } break;
      case 'variant': if (r && r.host === token && !r.isPublic && (!r.game || r.game.phase === 'over')) { r.kind = kindOf(m); r.low = lowOf(m); r.game = null; r.wins = r.wins.map(() => 0); broadcast(r); } break;
      case 'target': if (r && r.host === token && T.TARGETS.includes(+m.target) && (!r.game || r.game.phase === 'over')) { r.target = +m.target; r.game = null; broadcast(r); } break;
      case 'next': if (r && r.host === token && r.game && r.game.phase === 'hand') nextHand(r); break;
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
        if (engOf(r).play(r.game, p, String(m.card))) { broadcast(r); schedule(r); }
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
  });
});

// čišćenje starih soba
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of rooms) if (now - r.touched > ROOM_TTL) { clearTimeout(r.timer); rooms.delete(k); }
  for (const [k, c] of clients) if (!c.ws && !c.room) clients.delete(k);
}, 60000).unref();

server.listen(PORT, () => console.log('Briškula server na http://localhost:' + PORT));
module.exports = server;
