/* Briškula – klijent */
(function () {
  'use strict';
  const E = window.BriskulaEngine, B = window.BriskulaBot, Art = window.CardArt;
  const T = window.TresetaEngine, TB = window.TresetaBot, AV = window.Avatars;
  const P = window.PokerEngine, PB = window.PokerBot, TR = window.Turnir;
  const engOf = k => k === 'treseta' ? T : k === 'poker' ? P : E;
  const botOf = k => k === 'treseta' ? TB : k === 'poker' ? PB : B;
  // strana za brojanje pobjeda: u pokeru svatko za sebe (i u četvero)
  const sideOf = (kind, mode, p) => kind === 'poker' ? p : E.teamOf(mode, p);
  const $app = document.getElementById('app');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MODE_NAMES = { 2: 'Dvoje', 3: 'Troje', 4: 'Parovi (2 na 2)' };
  const MODE_SHORT = { 2: 'Dvoje', 3: 'Troje', 4: 'Parovi' };
  const LEVEL_NAMES = { easy: 'Lako', normal: 'Srednje', hard: 'Teško' };
  const LOW_NAME = 'Chi fa meno';
  const KIND_NAMES = { briskula: 'Briškula', treseta: 'Trešeta', poker: 'Poker', turnir: 'Turnir' };
  const KINDS = [['briskula', 'Briškula'], ['treseta', 'Trešeta'], ['poker', 'Poker'], ['turnir', 'Turnir']];
  const LOWS = [[0, 'Obično'], [1, LOW_NAME]];
  const kindLabel = (k, low) => (k === 'treseta' ? ' · Trešeta' : k === 'poker' ? ' · Poker' : '') + (low && k !== 'poker' ? ' · ' + LOW_NAME : '');
  // u pokeru se u četvero ne igra u parovima
  const modeName = (kind, mode, short) => kind === 'poker' && mode === 4 ? 'Četvero' : (short ? MODE_SHORT : MODE_NAMES)[mode];
  const modeSeg = kind => [[2, 'Dvoje'], [3, 'Troje'], [4, kind === 'poker' || kind === 'turnir' ? 'Četvero' : 'Parovi']];
  // naslov za turnir, npr. "Turnir 2/3 · Trešeta"
  const TOUR_BLINDS = 4; // u turniru blindovi u pokeru rastu brže (svake 4 ruke)
  // redni broj igre u turniru (kad je igra gotova, već je upisana u rezultate)
  const tourLabel = (t, g) => t ? `Turnir ${Math.min(g && g.phase === 'over' ? t.results.length : t.idx + 1, t.stages.length)}/${t.stages.length} · ` : '';
  const TOUR_ABBR = { briskula: 'Briš.', treseta: 'Treš.', poker: 'Poker' };

  // ---------- postavke ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('brk_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('brk_' + k, JSON.stringify(v)); } catch { } },
  };
  const S = {
    name: store.get('name', ''),
    showPoints: store.get('showPoints', true),
    showCm: store.get('showCm', true), // dužina pišulinca ispod avatara u igri
    sound: store.get('sound', true),
    botMode: store.get('botMode', 2), botLevel: store.get('botLevel', 'normal'),
    onMode: store.get('onMode', 2),
    // vrsta igre: briškula, "Chi fa meno" (pobjeđuje tko ima manje bodova) ili trešeta
    // igra (briškula ili trešeta) i "Chi fa meno" (na manje) za obje
    kind: store.get('kind', store.get('low', false) ? 'meno' : 'briskula'),
    naManje: store.get('naManje', store.get('kind', null) === 'meno' || (store.get('kind', null) == null && store.get('low', false)) ? 1 : 0),
    target: store.get('target', 41), // trešeta: do koliko bodova
    // profil: generički avatar 'eN' ili 'img' (vlastita slika), te "dužina pišulinca" u cm (0 = tajna)
    avatar: store.get('avatar', 'e' + Math.floor(Math.random() * AV.N)),
    avatarImg: store.get('avatarImg', ''),
    cm: store.get('cm', 0),
    turnTime: store.get('turnTime', 30), // online: sekunde za potez (0 = bez ograničenja)
  };
  if (!/^e\d{1,2}$/.test(S.avatar) && !(S.avatar === 'img' && S.avatarImg)) S.avatar = 'e0';
  S.cm = Math.max(0, Math.min(50, Math.round(+S.cm) || 0));
  if (!KIND_NAMES[S.kind]) S.kind = 'briskula'; // stari 'meno' = briškula na manje
  S.naManje = S.naManje ? 1 : 0;
  if (![21, 31, 41].includes(S.target)) S.target = 41;
  if (![0, 15, 30, 60].includes(S.turnTime)) S.turnTime = 30;
  const TURN_OPTS = [[15, '15 s'], [30, '30 s'], [60, '60 s'], [0, 'Bez']];
  function save() { for (const k in S) store.set(k, S[k]); syncProfile(); }

  // ---------- avatari ----------
  const CM_MAX = 50;
  const imgCache = {}; // id -> data URL (slike igrača koje je poslao server)
  const myAv = () => S.avatar === 'img' && S.avatarImg ? (imgCache.me = S.avatarImg, 'i:me') : S.avatar;
  const profileMsg = () => Object.assign({ type: 'profile', name: S.name, cm: S.cm }, S.avatar === 'img' && S.avatarImg ? { av: 'img', img: S.avatarImg } : { av: S.avatar });
  const cmText = cm => cm ? cm + ' cm' : 'tajna 🤫';
  const botCm = () => 1 + Math.floor(Math.random() * CM_MAX);
  function avatar(seat, cls, extra) {
    if (!seat) return `<span class="av ${cls || ''} empty"></span>`;
    return `<span class="av ${cls || ''}">${AV.inner(seat.av, imgCache, seat.name)}${seat.cm ? `<span class="cmb" title="Dužina pišulinca">${seat.cm}<small>cm</small></span>` : ''}${extra || ''}</span>`;
  }

  // ---------- korisnički račun (nije obavezan: bez prijave se igra kao gost) ----------
  const acc = { user: null, friends: [], storage: null, err: '', tab: 'login', busy: false };
  const loggedIn = () => !!acc.user;
  const STAT_ROWS = [['briskula', 'Briškula'], ['briskula_meno', 'Briškula · ' + LOW_NAME], ['treseta', 'Trešeta'], ['treseta_meno', 'Trešeta · ' + LOW_NAME], ['poker', 'Poker'], ['turnir', 'Turnir']];
  let profSent = '', profTimer = null;
  function syncProfile() {
    if (!loggedIn() || !net) return;
    clearTimeout(profTimer);
    profTimer = setTimeout(() => {
      const m = JSON.stringify(profileMsg());
      if (m !== profSent) { profSent = m; net.send(profileMsg()); }
    }, 700);
  }
  function onAccount(m) {
    if (m.imgs) Object.assign(imgCache, m.imgs);
    if (m.storage) acc.storage = m.storage;
    const was = acc.user;
    acc.user = m.user; acc.friends = m.friends || [];
    if (dm.with && !acc.friends.some(f => f.id === dm.with && f.status === 'ok')) dm.with = null;
    else if (dm.with && m.user && 'img' in m.user) net.send({ type: 'dmOpen', id: dm.with }); // nova veza: dohvati propušteno
    if (!m.user) {
      dm.conv = {};
      if (m.expired || was) store.set('auth', null);
      if (m.expired) toast('Prijava je istekla, prijavi se ponovno.');
    } else if ('img' in m.user) {
      // nakon prijave profil dolazi iz računa (isti na svim uređajima)
      const u = m.user;
      if (u.name) S.name = u.name;
      S.cm = Math.max(0, Math.min(CM_MAX, +u.cm || 0));
      if (u.av === 'img' && u.img) { S.avatarImg = u.img; S.avatar = 'img'; }
      else if (/^e\d{1,2}$/.test(u.av || '')) S.avatar = u.av;
      profSent = JSON.stringify(profileMsg());
      save();
    }
    if (!was && m.user && modal === 'account') modal = null;
    acc.busy = false;
    if (!room || modal || !room.game) render();
  }
  function friendCounts() {
    const ok = acc.friends.filter(f => f.status === 'ok');
    return { on: ok.filter(f => f.at).length, req: acc.friends.filter(f => f.status === 'in').length, msg: ok.reduce((a, f) => a + (f.unread || 0), 0) };
  }
  // poziv u sobu od prijatelja
  function showInvite(m) {
    let el = document.getElementById('invite');
    if (!el) { el = document.createElement('div'); el.id = 'invite'; el.className = 'invite'; document.body.appendChild(el); }
    const what = m.kind === 'turnir' ? 'Turnir' : (KIND_NAMES[m.kind] || 'Briškula') + (m.low && m.kind !== 'poker' ? ' · ' + LOW_NAME : '');
    el.innerHTML = `<div><b>${esc(m.from)}</b> te zove u sobu<br><span class="muted">${esc(what)} · ${esc(modeName(m.kind, m.mode, true))} · ${esc(m.code)}</span></div>
      <button class="small" id="invGo">Uđi</button><button class="ghost small" id="invX" aria-label="Zatvori">✕</button>`;
    el.hidden = false;
    sfx.chat();
    clearTimeout(showInvite.t); showInvite.t = setTimeout(() => { el.hidden = true; }, 30000);
    el.querySelector('#invX').onclick = () => { el.hidden = true; };
    el.querySelector('#invGo').onclick = () => { el.hidden = true; joinRoomCode(m.code); };
  }
  function joinRoomCode(code) {
    if (room && room.code === code) return;
    if (room && room.game && room.game.phase !== 'over' && !confirmLeave()) return;
    if (room) leave();
    modal = null;
    if (!S.name) { S.name = 'Igrač' + Math.floor(Math.random() * 900 + 100); save(); }
    ctrl = getNet(); ctrl.send(profileMsg()); ctrl.send({ type: 'join', code });
  }
  // partija protiv botova: rezultat se javi serveru za statistiku (samo kad je igrač prijavljen)
  function reportBotGame(kind, low, res) {
    if (loggedIn() && net) net.send({ type: 'stat', kind, low: !!low, res });
  }
  function agoText(t) {
    if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return 'upravo';
    if (m < 60) return `prije ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `prije ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? 'jučer' : `prije ${d} dana`;
  }
  function friendWhere(f) {
    const a = f.at;
    if (!a) return f.seen ? 'Offline · ' + agoText(f.seen) : 'Offline';
    if (a.where === 'menu') return 'Online';
    const what = a.kind === 'turnir' ? 'Turnir' : (KIND_NAMES[a.kind] || 'Briškula');
    return (a.where === 'game' ? 'Igra: ' : 'U sobi: ') + what + ' · ' + modeName(a.kind, a.mode, true);
  }

  let room = null;       // trenutni prikaz sobe (lokalne ili online)
  let ctrl = null;       // kontroler: LocalGame ili Net
  let modal = null;      // 'rules' | 'last' | 'settings' | null
  let installEvt = null;

  function toast(t) {
    const el = document.getElementById('toast');
    el.textContent = t; el.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- zvuk ----------
  let actx = null;
  function beep(f, d, type) {
    if (!S.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(.12, actx.currentTime); g.gain.exponentialRampToValueAtTime(.001, actx.currentTime + d);
      o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + d);
    } catch { }
  }
  const sfx = { play: () => beep(420, .08), win: () => { beep(660, .12); setTimeout(() => beep(880, .18), 110); }, turn: () => beep(520, .1, 'sine'), chat: () => { beep(740, .06, 'sine'); setTimeout(() => beep(990, .08, 'sine'), 70); } };

  // ---------- lokalna igra protiv botova ----------
  class LocalGame {
    constructor(mode, level, name, kind, target, low) {
      this.mode = mode; this.level = level; this.local = true; this.kind = kind || 'briskula'; this.low = !!low; this.target = target || 41;
      // turnir: briškula → trešeta → poker, ukupni bodovi po mjestu u svakoj igri
      this.tour = this.kind === 'turnir' ? TR.newTour(mode) : null;
      if (this.tour) { this.kind = TR.stageKind(this.tour); this.low = false; }
      this.E = engOf(this.kind); this.B = botOf(this.kind);
      const botNames = ['Jure', 'Mare', 'Ante', 'Luce', 'Frane', 'Tonka'].sort(() => Math.random() - .5);
      this.names = [name || 'Ti'].concat(botNames.slice(0, mode - 1).map(n => 'Bot ' + n));
      this.avs = this.names.map((n, i) => i ? AV.forName(n) : null);
      this.cms = this.names.map((n, i) => i ? botCm() : 0); // botovi: nasumično, isto cijelu partiju
      this.wins = Array(mode === 4 && this.kind !== 'poker' ? 2 : mode).fill(0);
      this.signals = []; this.dealer = Math.floor(Math.random() * mode) - 1;
      this.start();
    }
    start() {
      if (this.tour) {
        if (this.tour.done) this.tour = TR.newTour(this.mode);
        const k = TR.stageKind(this.tour);
        if (k !== this.kind) {
          this.kind = k; this.E = engOf(k); this.B = botOf(k);
          this.wins = Array(this.mode === 4 && k !== 'poker' ? 2 : this.mode).fill(0);
        }
      }
      this.dealer = (this.dealer + 1) % this.mode;
      this.st = this.E.newGame(this.mode, { names: this.names, bots: this.names.map((_, i) => i > 0), dealer: this.dealer, low: this.low, target: this.target, blindEvery: this.tour ? TOUR_BLINDS : undefined });
      this.counted = false;
      this.signals = [];
      this.emit(); this.schedule();
    }
    view() {
      return {
        type: 'room', local: true, code: null, mode: this.mode, level: this.level, low: this.low, kind: this.kind, target: this.target, host: true, you: 0, wins: this.wins, tour: this.tour,
        seats: this.names.map((n, i) => ({ name: n, bot: i > 0, connected: true, av: i ? this.avs[i] : myAv(), cm: i ? this.cms[i] : S.cm })),
        game: this.E.viewFor(this.st, 0), signals: this.signals.slice(-6),
      };
    }
    emit() {
      const st = this.st;
      // kraj partije: pobjeda se upiše jednom (poker može završiti i kad svi odustanu)
      if (st.phase === 'over' && !this.counted) {
        this.counted = true;
        if (!st.result.draw) this.wins[sideOf(this.kind, this.mode, st.result.winners[0])]++;
        if (this.tour && !this.tour.done) TR.record(this.tour, this.kind, st.result);
        reportBotGame(this.kind, this.low, st.result.draw ? 'd' : st.result.winners.includes(0) ? 'w' : 'l');
        if (this.tour && this.tour.done) {
          const sd = TR.standings(this.tour);
          reportBotGame('turnir', false, sd.every(x => x.place === 1) ? 'd' : sd.find(x => x.p === 0).place === 1 ? 'w' : 'l');
        }
      }
      onRoom(this.view());
    }
    schedule() {
      clearTimeout(this.timer);
      const st = this.st;
      const pk = this.kind === 'poker';
      if (st.phase === 'collect') this.timer = setTimeout(() => {
        this.E.collect(st);
        this.emit(); this.schedule();
      }, this.kind === 'treseta' ? 1000 : pk ? 1000 : 1350);
      else if (st.phase === 'play' && st.turn !== 0) this.timer = setTimeout(() => {
        const c = this.B.choose(this.E.viewFor(st, st.turn), this.level);
        this.E.play(st, st.turn, c); this.emit(); this.schedule();
      }, this.kind === 'treseta' ? 400 + Math.random() * 300 : pk ? 700 + Math.random() * 600 : 650 + Math.random() * 450);
    }
    play(c) { if (this.E.play(this.st, 0, c)) { this.emit(); this.schedule(); } }
    next() {
      const st = this.st;
      if (st.phase !== 'hand') return;
      // poker: ako sam ispao/la, botovi odigraju ostatak odmah (da se zna poredak)
      if (this.kind === 'poker' && st.players[0].out) PB.finish(st, this.level);
      else this.E.nextHand(st);
      this.signals = []; this.emit(); this.schedule();
    }
    signal(text, team) {
      this.signals.push({ id: Math.random(), from: 0, text, team: team ? 0 : null });
      this.emit();
    }
    rematch() { this.start(); }
    leave() { clearTimeout(this.timer); }
  }

  // ---------- online veza ----------
  class Net {
    constructor() {
      this.token = store.get('token', null); this.q = []; this.retry = 0; this.alive = true; this.ok = false;
      this.connect();
    }
    connect() {
      const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + location.pathname.replace(/[^/]*$/, '') + 'ws';
      let ws;
      try { ws = new WebSocket(url); } catch { return this.later(); }
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 0; this.ok = true;
        ws.send(JSON.stringify(Object.assign(profileMsg(), { type: 'hello', token: this.token, auth: store.get('auth', null) || undefined })));
        const q = this.q; this.q = []; q.forEach(m => ws.send(JSON.stringify(m)));
        render();
      };
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.type === 'welcome') { this.token = m.token; store.set('token', m.token); }
        else if (m.type === 'room') { if (m.imgs) Object.assign(imgCache, m.imgs); if (ctrl === this) onRoom(m); }
        else if (m.type === 'left') { if (ctrl === this) { room = null; chat.open = false; render(); } }
        else if (m.type === 'error') toast(m.msg);
        else if (m.type === 'info') toast(m.msg);
        else if (m.type === 'auth') { store.set('auth', m.token); if (m.fresh) toast('Račun je napravljen. Dobrodošao/la!'); }
        else if (m.type === 'account') onAccount(m);
        else if (m.type === 'authError') { acc.err = m.msg; acc.busy = false; if (modal === 'account') render(); else toast(m.msg); }
        else if (m.type === 'invite') showInvite(m);
        else if (m.type === 'dm' || m.type === 'dmMsg' || m.type === 'dmSeen' || m.type === 'dmRead') onDm(m);
      };
      ws.onclose = () => { this.ok = false; if (ctrl === this && room) render(); this.later(); };
    }
    later() { if (!this.alive) return; this.retry++; setTimeout(() => this.connect(), Math.min(8000, 500 * this.retry)); }
    send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); else this.q.push(m); }
    play(c) { this.send({ type: 'play', card: c }); }
    signal(text, team) { this.send({ type: 'signal', text, team }); }
    chat(text) { this.send({ type: 'chat', text }); }
    rematch() { this.send({ type: 'start' }); }
    next() { this.send({ type: 'next' }); }
    leave() { this.send({ type: 'leave' }); }
  }
  let net = null;
  function getNet() { if (!net) net = new Net(); return net; }

  // ---------- stanje ----------
  let prev = null;
  const seenSignals = new Map();
  function onRoom(r) {
    // timer za potez: server šalje koliko je ostalo, ovdje to pretvaramo u lokalni rok
    r.turnDeadline = r.turnLeft != null ? Date.now() + r.turnLeft : 0;
    const old = room; room = r;
    const g = r.game, og = old && old.game;
    if (g && og) {
      if (g.trick.length > og.trick.length || (g.kind === 'poker' && g.log && og.log && g.trickNo > og.trickNo && g.log.length && g.log[g.log.length - 1].p >= 0)) sfx.play();
      if (g.phase === 'play' && g.turn === g.you && !(og.phase === 'play' && og.turn === og.you)) sfx.turn();
      if (g.phase === 'over' && og.phase !== 'over') setTimeout(() => sfx.win(), 200);
    }
    for (const s of r.signals || []) if (!seenSignals.has(s.id)) seenSignals.set(s.id, Date.now());
    chatUpdate(r, old);
    render();
  }

  // ---------- chat (samo online sobe) ----------
  const CHAT_MAX = 200;
  const chat = { open: false, read: {}, el: null, key: '' };
  const chatKey = (r, m) => 'c:' + r.code + ':' + m.id;
  function chatUnread(r) {
    if (!r || !r.chat) return 0;
    const last = chat.read[r.code] || 0;
    return r.chat.filter(m => m.id > last && m.from !== r.you).length;
  }
  function chatUpdate(r, old) {
    const msgs = r.chat || [];
    const sameRoom = old && old.code === r.code;
    const fresh = msgs.filter(m => !seenSignals.has(chatKey(r, m)));
    // poruke koje su već bile kad smo ušli u sobu ne iskaču kao mjehurići
    for (const m of msgs) if (!seenSignals.has(chatKey(r, m))) seenSignals.set(chatKey(r, m), sameRoom ? Date.now() : 0);
    if (!(r.code in chat.read)) chat.read[r.code] = sameRoom ? 0 : msgs.reduce((a, m) => Math.max(a, m.id), 0);
    if (chat.open) chat.read[r.code] = msgs.reduce((a, m) => Math.max(a, m.id), chat.read[r.code]);
    if (sameRoom && fresh.some(m => m.from !== r.you)) {
      if (!chat.open) {
        sfx.chat();
        const m = fresh.filter(x => x.from !== r.you).pop();
        if (!r.game) toast(m.name + ': ' + (m.text.length > 60 ? m.text.slice(0, 60) + '…' : m.text));
      }
    }
  }
  function chatBtn() {
    if (!room || room.local || !room.code) return '';
    const n = chatUnread(room);
    return `<button class="ghost small chat-btn ${chat.open ? 'on' : ''}" id="chatBtn" aria-label="Chat">💬${n ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : ''}</button>`;
  }
  function bindChatBtn() {
    const b = $app.querySelector('#chatBtn');
    if (b) b.onclick = () => setChat(!chat.open);
  }
  function setChat(open) {
    chat.open = open;
    if (open) dm.with = null;
    if (open && room) chat.read[room.code] = (room.chat || []).reduce((a, m) => Math.max(a, m.id), 0);
    render();
    if (open && chat.el && window.matchMedia('(min-width: 900px)').matches) chat.el.querySelector('input').focus();
  }
  function renderChat() {
    const show = chat.open && room && !room.local && room.code;
    document.body.classList.toggle('chat-open', !!show);
    if (!show) { if (chat.el) chat.el.hidden = true; return; }
    if (!chat.el) {
      const el = chat.el = document.createElement('div');
      el.id = 'chat'; el.className = 'chat';
      el.innerHTML = `<div class="chat-head"><b>Chat</b><span class="muted" id="chatRoom"></span><button class="ghost small" id="chatClose" aria-label="Zatvori">✕</button></div>
        <div class="chat-list" id="chatList"></div>
        <form class="chat-form" id="chatForm" autocomplete="off">
          <input id="chatIn" maxlength="${CHAT_MAX}" placeholder="Napiši poruku…" enterkeyhint="send">
          <button type="submit">Pošalji</button>
        </form>`;
      document.body.appendChild(el);
      el.querySelector('#chatClose').onclick = () => setChat(false);
      el.querySelector('#chatForm').onsubmit = e => {
        e.preventDefault();
        const inp = el.querySelector('#chatIn');
        const t = inp.value.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
        if (!t || !ctrl || !ctrl.chat) return;
        ctrl.chat(t); inp.value = '';
      };
      chat.key = '';
    }
    chat.el.hidden = false;
    const msgs = room.chat || [];
    const key = room.code + ':' + msgs.map(m => m.id).join(',') + ':' + room.you + ':' + room.seats.map(s => s ? s.av : '').join(',');
    if (key === chat.key) return;
    chat.key = key;
    chat.el.querySelector('#chatRoom').textContent = 'soba ' + room.code;
    const list = chat.el.querySelector('#chatList');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = msgs.length ? msgs.map(m => {
      const mine = m.from === room.you;
      const time = new Date(m.t).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
      const dot = room.mode === 4 ? `<span class="dot t${m.from % 2}"></span>` : '';
      const st = room.seats[m.from];
      const av = st ? avatar(st, 'xs') : '';
      return `<div class="msg ${mine ? 'mine' : ''}"><div class="who">${av}${dot}${mine ? 'Ti' : esc(m.name)} <span class="t">${time}</span></div><div class="txt">${esc(m.text)}</div></div>`;
    }).join('') : '<p class="muted chat-empty">Još nema poruka. Pozdravi ostale!</p>';
    if (atBottom || msgs.length && msgs[msgs.length - 1].from === room.you) list.scrollTop = list.scrollHeight;
  }

  // ---------- direktne poruke među prijateljima ----------
  const DM_MAX = 500;
  const dm = { with: null, conv: {}, el: null, key: '' }; // conv[id] = { msgs, seen }
  const friendById = id => acc.friends.find(f => f.id === id);
  const dmVisible = () => !!dm.with && loggedIn() && document.visibilityState === 'visible';
  function openDm(id) {
    const f = friendById(id);
    if (!f || f.status !== 'ok' || !net) return;
    dm.with = id; chat.open = false; modal = null; f.unread = 0;
    net.send({ type: 'dmOpen', id });
    hideDmNote();
    render();
    if (dm.el && window.matchMedia('(min-width: 900px)').matches) dm.el.querySelector('input').focus();
  }
  function closeDm() { dm.with = null; render(); }
  function onDm(m) {
    const id = m.with;
    const cv = dm.conv[id] || (dm.conv[id] = { msgs: [], seen: 0 });
    const f = friendById(id);
    if (m.type === 'dm') { cv.msgs = m.msgs || []; cv.seen = m.seen || 0; cv.loaded = true; }
    else if (m.type === 'dmSeen') cv.seen = Math.max(cv.seen, m.seen || 0);
    else if (m.type === 'dmRead') { if (f) f.unread = 0; }
    else if (m.type === 'dmMsg') {
      const x = m.msg;
      if (!cv.msgs.some(y => y.id === x.id)) cv.msgs.push(x);
      if (cv.msgs.length > 200) cv.msgs.shift();
      const mine = acc.user && x.f === acc.user.id;
      if (!mine) {
        if (dm.with === id && dmVisible()) net.send({ type: 'dmRead', id });
        else {
          if (f) f.unread = (f.unread || 0) + 1;
          if (f) f.last = x.at;
          sfx.chat();
          if (dm.with !== id) showDmNote(f || { id, name: m.from || m.uname }, x.t);
        }
      }
    }
    if (m.type === 'dm' || m.type === 'dmSeen') return renderDm();
    if (!room || !room.game || modal === 'friends') render(); else renderDm();
  }
  // obavijest o novoj poruci (kad razgovor nije otvoren)
  function showDmNote(f, text) {
    let el = document.getElementById('dmNote');
    if (!el) { el = document.createElement('div'); el.id = 'dmNote'; el.className = 'invite dm-note'; document.body.appendChild(el); }
    el.innerHTML = `<div>💬 <b>${esc(f.name)}</b><br><span class="muted">${esc(text.length > 80 ? text.slice(0, 80) + '…' : text)}</span></div>
      <button class="small" id="dmGo">Odgovori</button><button class="ghost small" id="dmX" aria-label="Zatvori">✕</button>`;
    el.hidden = false;
    clearTimeout(showDmNote.t); showDmNote.t = setTimeout(hideDmNote, 9000);
    el.querySelector('#dmX').onclick = hideDmNote;
    el.querySelector('#dmGo').onclick = () => openDm(f.id);
  }
  function hideDmNote() { const el = document.getElementById('dmNote'); if (el) el.hidden = true; }
  function dmTime(t) {
    const d = new Date(t), now = new Date();
    const hm = d.toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return hm;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'jučer ' + hm;
    return d.getDate() + '.' + (d.getMonth() + 1) + '. ' + hm;
  }
  function renderDm() {
    const f = dm.with && loggedIn() && friendById(dm.with);
    const show = !!(f && f.status === 'ok');
    if (show) document.body.classList.add('chat-open');
    else if (!(chat.open && room && !room.local && room.code)) document.body.classList.remove('chat-open');
    if (!show) { if (dm.el) dm.el.hidden = true; return; }
    if (!dm.el) {
      const el = dm.el = document.createElement('div');
      el.id = 'dm'; el.className = 'chat dm';
      el.innerHTML = `<div class="chat-head"><span id="dmAv"></span><span class="dm-who"><b id="dmName"></b><span class="muted" id="dmSub"></span></span><button class="ghost small" id="dmBack" aria-label="Prijatelji">👥</button><button class="ghost small" id="dmClose" aria-label="Zatvori">✕</button></div>
        <div class="chat-list" id="dmList"></div>
        <form class="chat-form" id="dmForm" autocomplete="off">
          <input id="dmIn" maxlength="${DM_MAX}" placeholder="Poruka…" enterkeyhint="send">
          <button type="submit">Pošalji</button>
        </form>`;
      document.body.appendChild(el);
      el.querySelector('#dmClose').onclick = closeDm;
      el.querySelector('#dmBack').onclick = () => { dm.with = null; modal = 'friends'; render(); };
      el.querySelector('#dmForm').onsubmit = e => {
        e.preventDefault();
        const inp = el.querySelector('#dmIn');
        const t = inp.value.replace(/\s+/g, ' ').trim().slice(0, DM_MAX);
        if (!t || !dm.with || !net) return;
        net.send({ type: 'dmSend', id: dm.with, text: t }); inp.value = '';
      };
      dm.key = '';
    }
    dm.el.hidden = false;
    const cv = dm.conv[f.id] || { msgs: [], seen: 0 };
    const head = f.id + ':' + f.name + ':' + f.av + ':' + friendWhere(f);
    if (dm.head !== head) {
      dm.head = head;
      dm.el.querySelector('#dmAv').innerHTML = avatar({ av: f.av, name: f.name, cm: 0 }, '', `<span class="pres ${f.at ? 'on' : ''}"></span>`);
      dm.el.querySelector('#dmName').textContent = f.name;
      dm.el.querySelector('#dmSub').textContent = friendWhere(f);
    }
    const me = acc.user.id;
    const lastMine = cv.msgs.filter(x => x.f === me).pop();
    const seenId = lastMine && cv.seen >= lastMine.id ? lastMine.id : 0;
    const key = f.id + ':' + cv.msgs.map(x => x.id).join(',') + ':' + seenId + ':' + !!cv.loaded;
    if (key === dm.key) return;
    const switched = !dm.key.startsWith(f.id + ':');
    dm.key = key;
    const list = dm.el.querySelector('#dmList');
    const atBottom = switched || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = cv.msgs.length ? cv.msgs.map(x => {
      const mine = x.f === me;
      return `<div class="msg ${mine ? 'mine' : ''}"><div class="who">${mine ? 'Ti' : esc(f.name)} <span class="t">${dmTime(x.at)}</span></div><div class="txt">${esc(x.t)}</div>${x.id === seenId ? '<div class="seen">Viđeno ✓</div>' : ''}</div>`;
    }).join('') : `<p class="muted chat-empty">${cv.loaded ? 'Još nema poruka. Napiši nešto ' + esc(f.name) + '!' : 'Učitavanje…'}</p>`;
    if (atBottom || (cv.msgs.length && cv.msgs[cv.msgs.length - 1].f === me)) list.scrollTop = list.scrollHeight;
  }
  document.addEventListener('visibilitychange', () => { if (dmVisible() && net) { const f = friendById(dm.with); if (f && f.unread) { f.unread = 0; render(); } net.send({ type: 'dmRead', id: dm.with }); } });

  // ---------- prikaz ----------
  function render() {
    if (!room) renderMenu();
    else if (!room.game) renderLobby();
    else renderGame();
    renderModal();
    renderChat();
    renderDm();
  }

  function seg(name, opts, val) {
    return `<div class="seg" data-seg="${name}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  }

  const KIND_DESC = {
    briskula: 'Klasična briškula: pobjeđuje tko skupi više bodova.',
    treseta: 'Trešeta: bez briškule, mora se odgovoriti na boju. Igra se u više ruku, do zadanog broja bodova.',
    poker: 'Poker (Texas Hold\'em) s kartama briškule: 2 karte u ruci, 5 na stolu, ulaže se žetonima. Pobjeđuje tko pokupi sve žetone.',
    turnir: 'Turnir: tri igre zaredom, <b>briškula → trešeta → poker</b>. U svakoj igri dobiješ bod za svakog protivnika kojeg nadigraš; pobjeđuje tko na kraju ima najviše bodova. U četvero se briškula i trešeta igraju u parovima, a poker svatko za sebe.',
  };
  function kindDesc(kind, low) {
    if (kind === 'turnir') return KIND_DESC.turnir + ` Trešeta se igra do ${S.target}.`;
    if (!low || kind === 'poker') return KIND_DESC[kind];
    return kind === 'treseta'
      ? `Trešeta „${LOW_NAME}”: pobjeđuje tko skupi <b>manje</b> bodova. Partija traje dok netko ne dođe do cilja.`
      : `Briškula „${LOW_NAME}”: pobjeđuje tko skupi <b>manje</b> bodova.`;
  }
  function renderMenu() {
    const fan = ['kupe-1', 'spade-13', 'dinari-3', 'bate-12'].map((c, i) => `<div style="transform: rotate(${(i - 1.5) * 12}deg) translateY(${Math.abs(i - 1.5) * 6}px)">${Art.face(c)}</div>`).join('');
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
    $app.innerHTML = `<div class="menu home">
      <div class="logo"><div class="fan">${fan}</div><h1>Briškula</h1></div>
      <div class="panel profile">
        <h2 class="desk-only">Igrač</h2>
        <div class="prof-row">
          <button class="av-pick" id="avBtn" aria-label="Odaberi avatar">${avatar({ av: myAv(), name: S.name }, 'lg')}<span class="pen">✎</span></button>
          <input id="name" maxlength="20" placeholder="Tvoje ime" value="${esc(S.name)}">
        </div>
        <div class="cm-row">
          <div class="cm-head"><span>Dužina pišulinca</span><b id="cmVal">${cmText(S.cm)}</b></div>
          <div class="cm-ctl">
            <button class="ghost small" data-cm="-1" aria-label="Manje">−</button>
            <input type="range" id="cm" min="0" max="${CM_MAX}" step="1" value="${S.cm}" aria-label="Dužina pišulinca u cm">
            <button class="ghost small" data-cm="1" aria-label="Više">+</button>
          </div>
        </div>
        ${window.BRK_OFFLINE ? '' : accountRow()}
      </div>
      <div class="panel">
        <h2>Vrsta igre</h2>
        ${seg('kind', KINDS, S.kind)}
        ${S.kind === 'poker' || S.kind === 'turnir' ? '' : seg('naManje', LOWS, S.naManje)}
        ${S.kind === 'treseta' || S.kind === 'turnir' ? seg('target', [[21, 'Do 21'], [31, 'Do 31'], [41, 'Do 41']], S.target) : ''}
        <p class="muted" style="margin:0">${kindDesc(S.kind, S.naManje)}</p>
      </div>
      <div class="panel">
        <h2>Igraj protiv botova</h2>
        ${seg('botMode', modeSeg(S.kind), S.botMode)}
        ${seg('botLevel', [['easy', 'Lako'], ['normal', 'Srednje'], ['hard', 'Teško']], S.botLevel)}
        <button id="playBots" style="width:100%">Igraj</button>
      </div>
      ${window.BRK_OFFLINE ? '<p class="muted" style="text-align:center">Ovo je probna verzija samo s botovima. Online igra radi kad se aplikacija postavi na server.</p>' : `<div class="panel">
        <h2>Online s drugim igračima</h2>
        ${seg('onMode', modeSeg(S.kind), S.onMode)}
        <div class="stack">
          <div class="row"><button id="create">Napravi sobu</button><button id="quick" class="ghost">Brza igra</button></div>
          <div class="row"><input id="code" maxlength="5" placeholder="Kod sobe" style="text-transform:uppercase"><button id="join" class="ghost" style="flex:0 0 auto">Uđi</button></div>
        </div>
        <p class="muted" style="margin:10px 0 0">Napravi sobu i pošalji link prijateljima. Prazna mjesta možeš popuniti botovima.</p>
      </div>`}
      <div class="links">
        <button class="ghost small" id="rules">Pravila</button>
        <button class="ghost small" id="settings">Postavke</button>
        ${installEvt ? '<button class="small" id="install">Instaliraj aplikaciju</button>' : ''}
      </div>
      ${isIOS ? '<p class="muted" style="text-align:center">Na iPhoneu: Podijeli → „Dodaj na početni zaslon” za aplikaciju.</p>' : ''}
    </div>`;
    const nameEl = $app.querySelector('#name');
    nameEl.oninput = () => { S.name = nameEl.value.trim(); save(); };
    $app.querySelector('#avBtn').onclick = () => { modal = 'avatar'; render(); };
    const cmEl = $app.querySelector('#cm'), cmVal = $app.querySelector('#cmVal');
    const setCm = v => { S.cm = Math.max(0, Math.min(CM_MAX, v)); cmEl.value = S.cm; cmVal.textContent = cmText(S.cm); save(); };
    cmEl.oninput = () => setCm(+cmEl.value);
    $app.querySelectorAll('[data-cm]').forEach(b => b.onclick = () => setCm(S.cm + +b.dataset.cm));
    bindSegs();
    const needName = () => { if (!S.name) { S.name = 'Igrač' + Math.floor(Math.random() * 900 + 100); save(); } };
    $app.querySelector('#playBots').onclick = () => { needName(); ctrl = new LocalGame(+S.botMode, S.botLevel, S.name, S.kind, S.target, !['poker', 'turnir'].includes(S.kind) && !!S.naManje); };
    if (!window.BRK_OFFLINE) {
    $app.querySelector('#create').onclick = () => { needName(); ctrl = getNet(); ctrl.send(profileMsg()); ctrl.send({ type: 'create', mode: +S.onMode, level: 'normal', kind: S.kind, low: !!S.naManje, target: S.target, turnTime: S.turnTime }); };
    $app.querySelector('#quick').onclick = () => { needName(); ctrl = getNet(); ctrl.send(profileMsg()); ctrl.send({ type: 'quick', mode: +S.onMode, kind: S.kind, low: !!S.naManje }); };
    const join = () => {
      const c = $app.querySelector('#code').value.trim().toUpperCase();
      if (c.length < 4) return toast('Upiši kod sobe');
      needName(); ctrl = getNet(); ctrl.send(profileMsg()); ctrl.send({ type: 'join', code: c });
    };
    $app.querySelector('#join').onclick = join;
    $app.querySelector('#code').onkeydown = e => { if (e.key === 'Enter') join(); };
    }
    $app.querySelector('#rules').onclick = () => { modal = 'rules'; render(); };
    $app.querySelector('#settings').onclick = () => { modal = 'settings'; render(); };
    bindAccountRow();
    const ib = $app.querySelector('#install');
    if (ib) ib.onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); };
  }

  function bindSegs() {
    $app.querySelectorAll('[data-seg]').forEach(el => {
      el.querySelectorAll('button').forEach(b => b.onclick = () => {
        const k = el.dataset.seg; const v = b.dataset.v;
        S[k] = /^\d+$/.test(v) ? +v : v; save(); render();
      });
    });
  }

  function link() { return location.origin + location.pathname + '?soba=' + room.code; }

  function renderLobby() {
    const r = room;
    const full = r.seats.every(Boolean);
    const conn = net && net.ok;
    $app.innerHTML = `<div class="menu">
      <div class="topbar"><button class="ghost small" id="leave">← Izlaz</button><div class="mid">${r.tour ? tourLabel(r.tour) + modeName('turnir', r.mode) : modeName(r.kind, r.mode) + kindLabel(r.kind, r.low)}${r.isPublic ? ' · javna igra' : ''}</div>${chatBtn()}</div>
      <div class="panel" style="text-align:center">
        <div class="muted">Kod sobe</div>
        <div class="code">${esc(r.code)}</div>
        <div class="row center-row">${r.isPublic ? '' : '<button id="share" class="ghost small">Pošalji poziv</button>'}${loggedIn() ? `<button id="inviteF" class="ghost small">👥 Prijatelji${friendCounts().on ? ` <span class="on-n">${friendCounts().on}</span>` : ''}${friendCounts().msg ? `<span class="badge">${friendCounts().msg}</span>` : ''}</button>` : ''}</div>
        ${conn ? '' : '<p class="muted">Spajanje na server…</p>'}
      </div>
      <div class="panel">
        <h2>Igrači</h2>
        <ul class="seats">${r.seats.map((s, i) => `<li>
          ${avatar(s, 'md')}
          <span class="n">${s ? esc(s.name) + (i === r.you ? ' (ti)' : '') : '<span class="muted">čeka se igrač…</span>'}${s && s.cm ? `<span class="cmt">Dužina pišulinca: ${s.cm} cm</span>` : ''}</span>
          ${r.mode === 4 && r.kind !== 'poker' ? `<span class="tag team${i % 2}">${i % 2 ? 'Par B' : 'Par A'}</span>` : ''}
          ${s && s.bot ? '<span class="tag">bot</span>' : ''}
          ${s && !s.bot && !s.connected ? '<span class="tag">odspojen</span>' : ''}
          ${s && s.uname && i !== r.you && loggedIn() && !acc.friends.some(f => f.uname === s.uname) ? `<button class="ghost small" data-addf="${esc(s.uname)}" title="Dodaj za prijatelja">+👥</button>` : ''}
          ${(!s || s.bot) && i !== r.you ? `<button class="ghost small" data-seat="${i}">Sjedni ovdje</button>` : ''}
          ${r.host && s && s.bot ? `<button class="ghost small" data-kick="${i}">✕</button>` : ''}
        </li>`).join('')}</ul>
        ${r.tour && (r.tour.idx > 0 || r.tour.done) ? tourTable(r, true) : ''}
        ${r.mode === 4 && r.kind !== 'poker' ? '<p class="muted">Par A (1. i 3. mjesto) igra protiv para B (2. i 4.). Klikni „Sjedni ovdje” da promijeniš mjesto.</p>' : ''}
        ${r.host && !r.isPublic ? `
          <div class="muted" style="margin-bottom:6px">Vrsta igre</div>
          ${seg('roomKind', KINDS, r.tour ? 'turnir' : r.kind || 'briskula')}
          ${r.kind === 'poker' || r.tour ? '' : seg('roomLow', LOWS, r.low ? 1 : 0)}
          ${r.tour ? `<p class="muted" style="margin-top:-4px">${KIND_DESC.turnir}</p>` : ''}
          ${r.kind === 'treseta' || r.tour ? seg('roomTarget', [[21, 'Do 21'], [31, 'Do 31'], [41, 'Do 41']], r.target) : ''}
          <div class="muted" style="margin-bottom:6px">Vrijeme za potez</div>
          ${seg('roomTime', TURN_OPTS, r.turnTime || 0)}
          <p class="muted" style="margin-top:-4px">${turnTimeDesc(r.turnTime)}</p>`
        : r.tour ? `<p class="muted">${KIND_DESC.turnir} Trešeta se igra do ${r.target}.</p>`
        : r.kind === 'poker' ? `<p class="muted">Igra se <b>poker</b> (Texas Hold'em s kartama briškule).</p>`
        : r.kind === 'treseta' ? `<p class="muted">Igra se <b>trešeta</b>${r.low ? ' ' + LOW_NAME + ' (pobjeđuje tko ima manje)' : ''} do ${r.target} bodova.</p>`
        : r.low ? `<p class="muted">Igra se <b>${LOW_NAME}</b>: pobjeđuje tko skupi manje bodova.</p>` : ''}
        ${!r.host || r.isPublic ? `<p class="muted">${turnTimeDesc(r.turnTime)}</p>` : ''}
        ${r.host ? `
          <div class="muted" style="margin-bottom:6px">Jačina botova</div>
          ${seg('roomLevel', [['easy', 'Lako'], ['normal', 'Srednje'], ['hard', 'Teško']], r.level)}
          <div class="row"><button class="ghost" id="addBot" ${full ? 'disabled' : ''}>+ Dodaj bota</button>
          <button id="start">${full ? 'Započni igru' : 'Započni (botovi popune)'}</button></div>`
        : `<p class="muted" style="text-align:center">Čekamo da domaćin pokrene igru…</p>`}
      </div>
    </div>`;
    $app.querySelector('#leave').onclick = leave;
    bindChatBtn();
    const sh = $app.querySelector('#share');
    if (sh) sh.onclick = async () => {
      const url = link();
      if (navigator.share) { try { await navigator.share({ title: 'Briškula', text: (r.tour ? 'Dođi na turnir (briškula, trešeta, poker)' : 'Dođi na partiju ' + ({ treseta: 'trešete', poker: 'pokera' }[r.kind] || 'briškule')) + '! Kod: ' + r.code, url }); return; } catch { } }
      try { await navigator.clipboard.writeText(url); toast('Link kopiran'); } catch { toast(url); }
    };
    $app.querySelectorAll('[data-seat]').forEach(b => b.onclick = () => ctrl.send({ type: 'seat', seat: +b.dataset.seat }));
    $app.querySelectorAll('[data-addf]').forEach(b => b.onclick = () => net.send({ type: 'friendAdd', uname: b.dataset.addf }));
    const invF = $app.querySelector('#inviteF'); if (invF) invF.onclick = () => { modal = 'friends'; render(); };
    if (r.host) {
      $app.querySelector('#addBot').onclick = () => ctrl.send({ type: 'addBot' });
      $app.querySelector('#start').onclick = () => ctrl.send({ type: 'start', fillBots: true });
      $app.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => ctrl.send({ type: 'kick', seat: +b.dataset.kick }));
      $app.querySelectorAll('[data-seg="roomKind"] button').forEach(b => b.onclick = () => { if (b.dataset.v !== (r.tour ? 'turnir' : r.kind)) ctrl.send({ type: 'variant', kind: b.dataset.v, low: !!r.low }); });
      $app.querySelectorAll('[data-seg="roomLow"] button').forEach(b => b.onclick = () => ctrl.send({ type: 'variant', kind: r.kind || 'briskula', low: b.dataset.v === '1' }));
      $app.querySelectorAll('[data-seg="roomTarget"] button').forEach(b => b.onclick = () => ctrl.send({ type: 'target', target: +b.dataset.v }));
      $app.querySelectorAll('[data-seg="roomTime"] button').forEach(b => b.onclick = () => { S.turnTime = +b.dataset.v; save(); ctrl.send({ type: 'turnTime', turnTime: +b.dataset.v }); });
      $app.querySelectorAll('[data-seg="roomLevel"] button').forEach(b => b.onclick = () => ctrl.send({ type: 'level', level: b.dataset.v }));
    }
  }

  function turnTimeDesc(t) {
    return t ? `⏱ Svaki igrač ima <b>${t} s</b> za potez. Tko ne odigra na vrijeme, gubi partiju.` : '⏱ Bez ograničenja vremena za potez.';
  }
  // odbrojavanje oko avatara igrača na potezu
  function turnRing(r, g, p) {
    if (!r.turnDeadline || g.phase !== 'play' || g.turn !== p) return '';
    const total = (r.turnTime || 30) * 1000, left = Math.max(0, r.turnDeadline - Date.now());
    return `<span class="tt" style="--d:${total}ms;--e:-${total - left}ms"><svg viewBox="0 0 40 40"><circle class="trk" cx="20" cy="20" r="18"/><circle class="run" cx="20" cy="20" r="18" pathLength="100"/></svg><b class="ttn" data-dl="${r.turnDeadline}">${Math.ceil(left / 1000)}</b></span>`;
  }
  let tickBeep = 0;
  setInterval(() => {
    const els = document.querySelectorAll('[data-dl]');
    for (const el of els) {
      const s = Math.max(0, Math.ceil((+el.dataset.dl - Date.now()) / 1000));
      if (el.textContent !== String(s)) el.textContent = s;
      el.classList.toggle('low', s <= 10);
    }
    // kratki zvuk u zadnjih 5 sekundi kad sam ja na potezu
    const g = room && room.game;
    if (g && room.turnDeadline && g.phase === 'play' && g.turn === g.you) {
      const s = Math.ceil((room.turnDeadline - Date.now()) / 1000);
      if (s <= 5 && s > 0 && s !== tickBeep) { tickBeep = s; beep(880, .05, 'square'); }
    }
  }, 250);

  function leave() {
    if (ctrl) ctrl.leave();
    ctrl = null; room = null; modal = null; chat.open = false;
    if (location.search) history.replaceState(null, '', location.pathname);
    render();
  }

  // relativni položaj igrača p u odnosu na mene
  function posOf(p, g) {
    const rel = (p - g.you + g.mode) % g.mode;
    if (g.mode === 2) return ['bottom', 'top'][rel];
    if (g.mode === 3) return ['bottom', 'right', 'left'][rel];
    return ['bottom', 'right', 'top', 'left'][rel];
  }

  function suitOrder(TS) { return s => (s === TS ? 10 : 0) + E.SUITS.indexOf(s); }
  function sortHand(h, TS, G) {
    const so = suitOrder(TS);
    G = G || E;
    return h.slice().sort((a, b) => so(E.suitOf(a)) - so(E.suitOf(b)) || G.strength(a) - G.strength(b));
  }
  // bodovi za prikaz: u trešeti bele (trećine), npr. 3⅔
  const ptsText = (g, b) => g.kind === 'treseta' ? T.fmt(b) : String(b);

  // oblačići (znakovi, chat) iznad avatara i sistemske poruke
  function gameBubbles(r, now) {
    const bubbles = {};
    for (const s of r.signals || []) {
      const t = seenSignals.get(s.id) || 0;
      if (now - t < 4000 && s.from >= 0) bubbles[s.from] = s;
    }
    for (const m of r.chat || []) {
      const t = seenSignals.get(chatKey(r, m)) || 0;
      if (now - t < 4000 && !(bubbles[m.from] && (seenSignals.get(bubbles[m.from].id) || 0) > t)) bubbles[m.from] = { text: m.text.length > 40 ? m.text.slice(0, 40) + '…' : m.text, team: null, chat: true };
    }
    const sysMsg = (r.signals || []).filter(s => s.from < 0 && now - (seenSignals.get(s.id) || 0) < 5000).pop();
    return { bubbles, sysMsg };
  }

  let flyTimer = null, enterKeys = new Set();
  function renderGame() {
    if (room.game.kind === 'poker') return renderPoker();
    const r = room, g = r.game, me = g.you;
    const tre = g.kind === 'treseta';
    // online: po pravilima se bodovi broje sami, pa se tijekom ruke ne prikazuju (samo ukupni rezultat)
    const secret = !r.local;
    const G = engOf(g.kind);
    const myTurn = g.phase === 'play' && g.turn === me;
    const now = Date.now();
    const { bubbles, sysMsg } = gameBubbles(r, now);
    // trešeta: akuže se vide tijekom prvog štiha
    if (tre && g.trickNo <= 1 && g.phase === 'play' && g.akuze && g.akuze.length) {
      for (let p = 0; p < g.mode; p++) {
        const a = g.akuze.filter(x => x.p === p);
        if (a.length && !bubbles[p]) bubbles[p] = { text: 'Akuža: ' + a.map(x => x.text + ' (' + x.pts + ')').join(', '), team: null, akuza: true };
      }
    }

    const plate = (p) => {
      const pl = g.players[p];
      const seat = r.seats[p];
      const off = seat && !seat.bot && !seat.connected;
      const turn = g.phase === 'play' && g.turn === p;
      // u parovima bodovi nisu po igraču nego zajedno za par (vidi pairBox)
      const pts = g.mode === 4 || secret ? '' : S.showPoints ? `<span class="pts">${ptsText(g, pl.points)}</span>` : `<span class="muted">${pl.wonCount}</span>`;
      const who = seat || { name: pl.name };
      const av = S.showCm
        ? `<span class="avw">${avatar(Object.assign({}, who, { cm: 0 }), turn ? 'turn' : '', bubble(p) + turnRing(r, g, p))}<span class="cml ${who.cm ? '' : 'secret'}" title="Dužina pišulinca">${who.cm ? who.cm + ' cm' : 'tajna'}</span></span>`
        : avatar(who, turn ? 'turn' : '', bubble(p) + turnRing(r, g, p));
      // avatar s oblačićem poruke iznad njega, pa pločica s imenom i bodovima
      return `<div class="pl pl-${p === me ? 'me' : posOf(p, g)}">${av}<div class="nameplate ${turn ? 'turn' : ''}">
        ${g.mode === 4 ? `<span class="dot t${p % 2}"></span>` : ''}${esc(pl.name)}${off ? ' <span class="off">⚠</span>' : ''} ${pts}</div></div>`;
    };
    const bubble = p => bubbles[p] ? `<div class="bubble ${bubbles[p].team != null ? 'team' : ''} ${bubbles[p].chat ? 'chatb' : ''} ${bubbles[p].akuza ? 'akuza' : ''}">${esc(bubbles[p].text)}</div>` : '';

    let seats = '';
    for (let p = 0; p < g.mode; p++) {
      if (p === me) continue;
      const pos = posOf(p, g);
      const isPartner = g.mode === 4 && (p - me + 4) % 4 === 2;
      const n = g.players[p].handCount;
      let cards;
      if (isPartner && g.partnerHand) cards = `<div class="partner-hand">${sortHand(g.partnerHand, g.trumpSuit).map(c => `<div class="card sm">${Art.face(c)}</div>`).join('')}</div>`;
      else if (tre) {
        // karte koje su svi vidjeli (akuža, izvučene iz špila) okrenute su licem
        const known = sortHand((g.known && g.known[p]) || [], null, T);
        const hidden = n - known.length;
        const side = pos !== 'top';
        const shown = side ? Math.min(hidden, 3) : hidden;
        cards = `<div class="tcards ${side ? 'side' : ''}">
          ${known.length ? `<div class="known">${known.map(c => `<div class="card sm">${Art.face(c)}</div>`).join('')}</div>` : ''}
          ${hidden ? `<div class="backs">${Array.from({ length: shown }, () => `<div class="card sm">${Art.back()}</div>`).join('')}</div>` : ''}
          ${side && n ? `<div class="hc">${n}</div>` : ''}
        </div>`;
      }
      else cards = `<div class="backs">${Array.from({ length: n }, () => `<div class="card sm">${Art.back()}</div>`).join('')}</div>`;
      seats += `<div class="seat ${pos}">${pos === 'top' ? cards + plate(p) : plate(p) + cards}</div>`;
    }

    // parovi: zbrojeni bodovi para (ili broj štihova ako su bodovi skriveni)
    const myT = E.teamOf(g.mode, me);
    const teamSum = (t, k) => g.players[t][k] + g.players[t + 2][k];
    const pairVal = t => S.showPoints ? ptsText(g, teamSum(t, 'points')) : teamSum(t, 'wonCount');
    const pairRows = g.mode === 4 ? [[myT, 'Mi'], [1 - myT, 'Vi']].map(([t, n]) => `<div class="ts"><span><i class="dot t${t}"></i> ${n}</span><b>${pairVal(t)}</b></div>`).join('') : '';
    const pairHead = S.showPoints ? 'Bodovi parova' : 'Štihovi parova';
    // ukupni rezultat (dobivene partije) za online briškulu
    const winRows = (g.mode === 4 ? [[myT, 'Mi'], [1 - myT, 'Vi']] : g.players.map((_, i) => (me + i) % g.mode).map(q => [q, q === me ? 'Ti' : esc(g.players[q].name.replace(/^Bot /, ''))]))
      .map(([t, n]) => `<div class="ts"><span>${g.mode === 4 ? `<i class="dot t${t}"></i> ` : ''}${n}</span><b>${(r.wins || [])[t] || 0}</b></div>`).join('');

    // špil + briškula (u trešeti nema briškule; u dvoje se vuče iz špila)
    let deck;
    if (tre) {
      const names = g.mode === 4 ? ['Mi', 'Vi'] : g.players.map((pl, i) => i === me ? 'Ti' : pl.name.replace(/^Bot /, ''));
      const order = g.mode === 4 ? [myT, 1 - myT] : g.players.map((_, i) => (me + i) % g.mode);
      deck = `<div class="tinfo">
        ${g.deckCount > 0 ? `<div class="tdeck"><div class="card sm">${Art.back()}</div><div class="count">${g.deckCount}</div></div>` : ''}
        <div class="tscore"><div class="muted">Ruka ${g.handNo} · do ${g.target}</div>
          ${order.map(t => `<div class="ts"><span>${g.mode === 4 ? `<i class="dot t${t}"></i> ` : ''}${esc(g.mode === 4 ? names[t === myT ? 0 : 1] : names[t])}</span><b>${g.score[t]}${g.mode === 4 && !secret ? ` <em title="${S.showPoints ? 'bodovi u ovoj ruci' : 'štihovi u ovoj ruci'}">+${pairVal(t)}</em>` : ''}</b></div>`).join('')}
          ${g.mode === 4 && !secret ? `<div class="muted tsh">+ ${S.showPoints ? 'ova ruka' : 'štihovi u ruci'}</div>` : ''}
        </div></div>`;
    } else if (g.deckCount > 0) {
      deck = `<div class="deck">
        <div class="card sm trump">${Art.face(g.trump)}</div>
        ${g.deckCount > 1 ? `<div class="card sm pile">${Art.back()}</div>` : ''}
        <div class="count">${g.deckCount}</div></div>`;
    } else {
      deck = `<div class="trumpinfo">${Art.suit(g.trumpSuit, .85)}<span>briškula</span></div>`;
    }
    if (r.tour && (tre ? g.mode !== 4 : secret || g.mode !== 4)) {
      // turnir: umjesto broja pobjeda prikaži bodove turnira
      const rows = g.players.map((_, i) => (me + i) % g.mode).map(q => `<div class="ts"><span>${q === me ? 'Ti' : esc(g.players[q].name.replace(/^Bot /, ''))}</span><b>${TR.fmt(r.tour.points[q])}</b></div>`).join('');
      deck += `<div class="tscore pscore"><div class="muted">Turnir (bodovi)</div>${rows}</div>`;
    }
    else if (!tre && secret) deck += `<div class="tscore pscore"><div class="muted">Rezultat (partije)</div>${winRows}</div>`;
    else if (!tre && g.mode === 4) deck += `<div class="tscore pscore"><div class="muted">${pairHead}</div>${pairRows}</div>`;

    // štih
    const showTrick = g.trick.length ? g.trick : [];
    let winIdx = -1;
    if (g.phase === 'collect') winIdx = G.trickWinnerIndex(g.trick, g.trumpSuit);
    const newKeys = new Set();
    const trickHtml = showTrick.map((t, i) => {
      const key = g.handNo + ':' + g.trickNo + ':' + t.p;
      newKeys.add(key);
      const enter = !enterKeys.has(key) ? 'enter' : '';
      return `<div class="card pos-${posOf(t.p, g)} ${enter} ${i === winIdx ? 'win' : ''}">${Art.face(t.card)}</div>`;
    }).join('');
    enterKeys = newKeys;

    // poruka
    let status = '';
    if (g.phase === 'play') status = (myTurn ? 'Na potezu si' : 'Igra ' + esc(g.players[g.turn].name) + '…') + (r.turnDeadline ? ` · ⏱ <b class="ttn" data-dl="${r.turnDeadline}">${Math.max(0, Math.ceil((r.turnDeadline - now) / 1000))}</b> s` : '');
    else if (g.phase === 'collect') {
      const w = g.trick[winIdx].p;
      let pts = g.trick.reduce((s, t) => s + G.points(t.card), 0);
      const lastOne = tre && g.deckCount === 0 && g.players.every(pl => pl.handCount === 0);
      if (lastOne) pts += T.LAST_BELE;
      status = (w === me ? 'Tvoj štih' : (g.mode === 4 && w % 2 === me % 2 ? 'Štih za vaš par' : 'Štih nosi ' + esc(g.players[w].name))) + (pts && !secret ? ` (+${ptsText(g, pts)})` : '') + (lastOne ? ' · zadnji štih' : '');
    }
    else if (g.phase === 'hand') status = 'Kraj ruke';
    if (sysMsg) status = esc(sysMsg.text);

    const hand = sortHand(g.hand, g.trumpSuit, G);
    const legal = myTurn ? (tre ? T.legalCards(g.hand, g.trick) : g.hand) : [];
    const handHtml = hand.map(c => {
      const ok = legal.includes(c);
      return `<div class="card ${ok ? 'playable' : ''} ${myTurn && !ok ? 'dim' : ''} ${!tre && E.suitOf(c) === g.trumpSuit ? 'trumpcard' : ''}" data-card="${c}">${Art.face(c)}</div>`;
    }).join('');
    const many = tre ? hand.length > 1 : hand.length > 5;

    let sigList = [];
    if (tre) { if (g.mode === 4) sigList = [['Kucam', 0], ['Strišo', 0], ['Volo', 0]]; }
    else if (g.mode === 4) sigList = ['Imam briškulu', 'Nemam briškulu', 'Imam asa', 'Imam tricu'].concat(g.low ? ['Nosim ja', 'Ne mogu pustiti'] : ['Karikaj!', 'Ne karikaj']).map(t => [t, 1]);
    const sigs = g.phase === 'over' || g.phase === 'hand' ? '' : `<div class="signals ${tre ? 'tre' : ''}">
      ${sigList.map(([t, team]) => `<button class="team" data-sig="${t}" ${team ? 'data-team="1"' : ''}>${t}</button>`).join('')}
      ${['👍', '😂', '😮', '🙈', '😤'].map(t => `<button class="ghost" data-sig="${t}">${t}</button>`).join('')}
    </div>`;

    let tally = '';
    if (r.wins && r.wins.some(x => x) && !(secret && !tre) && !r.tour) tally = g.mode === 4 ? ` · ${r.wins[me % 2]}:${r.wins[1 - me % 2]}` : ` · pobjede ${r.wins[me]}`;

    $app.innerHTML = `
      <div class="topbar">
        <button class="ghost small" id="leave">←</button>
        <div class="mid">${tourLabel(r.tour, g)}${(g.kind === 'treseta' || g.low || r.tour ? MODE_SHORT : MODE_NAMES)[g.mode]}${kindLabel(g.kind || 'briskula', g.low)}${r.code ? ' · ' + esc(r.code) : (g.kind === 'treseta' && g.low ? '' : ' · ' + LEVEL_NAMES[r.level])}${tally}</div>
        <button class="ghost small" id="last" ${g.lastTrick ? '' : 'disabled'}>Zadnji štih</button>
        ${chatBtn()}
        <button class="ghost small" id="menuBtn">⚙</button>
      </div>
      <div class="table mode${g.mode} ${g.mode >= 3 ? 'has-left' : ''} ${tre ? 'tre' : ''}">
        ${seats}${deck}
        <div class="trick" id="trick">${trickHtml}</div>
        <div class="status">${status}</div>
      </div>
      <div class="me ${tre ? 'tre' : ''}">
        <div class="hand ${myTurn ? 'myturn' : ''} ${many ? 'many' : ''}" style="--n:${hand.length}">${handHtml}</div>
        <div class="mypl">${plate(me)}</div>
        ${sigs}
      </div>`;

    $app.querySelector('#leave').onclick = () => { if (g.phase === 'over' || confirmLeave()) leave(); };
    $app.querySelector('#last').onclick = () => { modal = 'last'; render(); };
    $app.querySelector('#menuBtn').onclick = () => { modal = 'settings'; render(); };
    bindChatBtn();
    $app.querySelectorAll('.hand .card.playable').forEach(el => el.onclick = () => {
      el.style.transform = 'translateY(-30px)';
      ctrl.play(el.dataset.card);
    });
    $app.querySelectorAll('.hand .card.dim').forEach(el => el.onclick = () => toast('Moraš odgovoriti na boju'));
    $app.querySelectorAll('[data-sig]').forEach(b => b.onclick = () => {
      const k = Date.now(); if (k - (renderGame.lastSig || 0) < 1500) return; renderGame.lastSig = k;
      ctrl.signal(b.dataset.sig, !!b.dataset.team);
    });

    clearTimeout(flyTimer);
    if (g.phase === 'collect') {
      const w = g.trick[winIdx].p;
      flyTimer = setTimeout(() => { const t = document.getElementById('trick'); if (t) t.className = 'trick fly-' + posOf(w, g); }, tre ? 600 : 850);
    }
    // osvježi kad mjehurići isteknu
    clearTimeout(renderGame.bt);
    if (Object.keys(bubbles).length || sysMsg) renderGame.bt = setTimeout(() => render(), 4100);
  }

  // ---------- poker ----------
  const pk = { key: '', open: false, amt: 0 }; // stanje gumba za povišenje
  const chipsHtml = n => `<span class="chips">${n}</span>`;
  const ACT_NAMES = { fold: 'Pas', check: 'Provjera', call: 'Prati', raise: 'Povišenje', bet: 'Ulog', sb: 'Mali blind', bb: 'Veliki blind' };
  function pokerLastActs(g) {
    // zadnji potez svakog igrača u ovom krugu ulaganja
    const out = {};
    for (const e of g.log) {
      if (e.a === 'street' || e.a === 'end') { for (const k in out) if (out[k].a !== 'fold') delete out[k]; continue; }
      if (e.p >= 0) out[e.p] = e;
    }
    return out;
  }
  function actText(e) {
    if (!e) return '';
    if (e.allIn && e.a !== 'fold') return 'All-in';
    return ACT_NAMES[e.a] || '';
  }
  function renderPoker() {
    const r = room, g = r.game, me = g.you;
    const now = Date.now();
    const L = g.legal;
    const myTurn = !!L;
    const { bubbles, sysMsg } = gameBubbles(r, now);
    const bubble = p => bubbles[p] ? `<div class="bubble ${bubbles[p].chat ? 'chatb' : ''}">${esc(bubbles[p].text)}</div>` : '';
    const acts = pokerLastActs(g);
    const hr = g.phase === 'hand' || g.phase === 'over' ? g.handResult : null;
    const winners = new Set(hr ? [].concat(...hr.pots.map(x => x.winners)) : []);
    const plate = p => {
      const pl = g.players[p];
      const seat = r.seats[p];
      const off = seat && !seat.bot && !seat.connected;
      const turn = g.phase === 'play' && g.turn === p;
      const who = seat || { name: pl.name };
      const av = S.showCm
        ? `<span class="avw">${avatar(Object.assign({}, who, { cm: 0 }), turn ? 'turn' : '', bubble(p) + turnRing(r, g, p))}<span class="cml ${who.cm ? '' : 'secret'}" title="Dužina pišulinca">${who.cm ? who.cm + ' cm' : 'tajna'}</span></span>`
        : avatar(who, turn ? 'turn' : '', bubble(p) + turnRing(r, g, p));
      return `<div class="pl pl-${p === me ? 'me' : posOf(p, g)} ${pl.folded || pl.out ? 'folded' : ''}">${av}<div class="nameplate ${turn ? 'turn' : ''}">
        ${g.dealer === p ? '<span class="dealer" title="Djelitelj">D</span>' : ''}${esc(pl.name)}${off ? ' <span class="off">⚠</span>' : ''} ${pl.out ? '' : chipsHtml(pl.chips)}</div></div>`;
    };
    // ispod igrača: zadnji potez i ulog u ovom krugu
    const betPill = p => {
      const pl = g.players[p];
      const tag = pl.out ? 'Ispao/la' : winners.has(p) ? 'Dobitak' : actText(acts[p]);
      if (!tag && !pl.bet) return '';
      return `<div class="pbet">${tag ? `<span class="act ${winners.has(p) ? 'won' : ''} ${pl.allIn && !pl.folded ? 'allin' : ''}">${tag}</span>` : ''}${pl.bet ? chipsHtml(pl.bet) : ''}</div>`;
    };
    const best = hr && hr.hands ? hr.hands : {};
    let seats = '';
    for (let p = 0; p < g.mode; p++) {
      if (p === me) continue;
      const pos = posOf(p, g), pl = g.players[p];
      const shown = g.shown && g.shown[p];
      const cards = pl.out ? '' : `<div class="pcards ${pl.folded ? 'folded' : ''}">${shown
        ? shown.map(c => `<div class="card sm ${best[p] && best[p].best.includes(c) ? 'best' : ''}">${Art.face(c)}</div>`).join('')
        : Array.from({ length: pl.handCount }, () => `<div class="card sm">${Art.back()}</div>`).join('')}</div>`;
      const hn = shown && best[p] ? `<div class="hname">${esc(best[p].name)}</div>` : '';
      seats += `<div class="seat ${pos}">${pos === 'top' ? cards + plate(p) + hn + betPill(p) : plate(p) + cards + hn + betPill(p)}</div>`;
    }
    // stol: 5 karata, lonac, blindovi
    const myBest = best[me] ? best[me].best : (g.hand.length && g.board.length >= 3 ? P.bestFive(g.hand.concat(g.board)) : []);
    const board = Array.from({ length: 5 }, (_, i) => g.board[i]
      ? `<div class="card bc ${hr && myBest.includes(g.board[i]) && winners.has(me) ? 'best' : ''}">${Art.face(g.board[i])}</div>`
      : '<div class="card bc slot"></div>').join('');
    const potNow = g.pot;
    const center = `<div class="pboard">
        <div class="bcards">${board}</div>
        <div class="pot">Lonac ${chipsHtml(potNow)}</div>
      </div>`;
    const blinds = `<div class="tscore pblinds"><div class="muted">Ruka ${g.handNo}</div>
        <div class="ts"><span>Blindovi</span><b>${g.sb}/${g.bb}</b></div>
        <div class="muted">${g.blindsIn === 1 ? 'rastu od sljedeće ruke' : 'rastu za ' + g.blindsIn + ' ruke'}</div></div>`;

    // poruka
    let status = '';
    const streetName = ['Prije flopa', 'Flop', 'Turn', 'River'][g.street] || '';
    if (g.phase === 'play') status = (myTurn ? 'Na potezu si' : 'Igra ' + esc(g.players[g.turn].name) + '…') + ' · ' + streetName + (r.turnDeadline ? ` · ⏱ <b class="ttn" data-dl="${r.turnDeadline}">${Math.max(0, Math.ceil((r.turnDeadline - now) / 1000))}</b> s` : '');
    else if (g.phase === 'collect') status = g.players.filter(pl => !pl.out && !pl.folded && !pl.allIn).length <= 1 ? 'Otkrivanje karata…' : streetName + ' gotov…';
    else if (hr) status = hr.pots.map(x => x.winners.map(w => esc(g.players[w].name)).join(' i ') + ' nosi ' + x.amount + (x.hand ? ' · ' + esc(x.hand) : '')).join(' · ');
    if (sysMsg) status = esc(sysMsg.text);

    // moje karte i potezi
    const mine = g.players[me];
    const hand = g.hand.slice().sort((a, b) => P.pv(b) - P.pv(a));
    const handHtml = hand.map(c => `<div class="card ${hr && myBest.includes(c) && winners.has(me) ? 'best' : ''} ${mine.folded ? 'dim' : ''}">${Art.face(c)}</div>`).join('');
    const myHandName = g.hand.length === 2 && g.board.length >= 3 && !mine.folded ? P.handName(P.evaluate(g.hand.concat(g.board))) : '';
    let actions = '';
    if (myTurn) {
      const key = g.handNo + ':' + g.trickNo;
      if (pk.key !== key) { pk.key = key; pk.open = false; pk.amt = L.minTo; }
      pk.amt = Math.max(L.minTo, Math.min(L.maxTo, pk.amt));
      const potAfter = potNow + L.toCall;
      const pre = [['Min', L.minTo], ['½ lonca', L.bet + L.toCall + Math.round(potAfter / 2)], ['Lonac', L.bet + L.toCall + potAfter]]
        .map(([t, v]) => [t, Math.max(L.minTo, Math.min(L.maxTo, v))]);
      const raiseWord = L.curBet ? 'Povisi' : 'Uloži';
      actions = `<div class="pact">
        <button class="ghost fold" data-act="fold">Odustani</button>
        <button class="${L.check ? 'ghost' : ''}" data-act="${L.check ? 'check' : 'call'}">${L.check ? 'Provjeri' : L.toCall >= mine.chips ? 'Prati (all-in ' + L.toCall + ')' : 'Prati ' + L.toCall}</button>
        ${L.canRaise ? `<button data-act="open" class="${pk.open ? 'on' : ''}">${raiseWord}…</button>` : ''}
      </div>
      ${L.canRaise && pk.open ? `<div class="praise">
        <div class="row"><input type="range" id="raiseR" min="${L.minTo}" max="${L.maxTo}" step="${Math.max(1, Math.min(g.sb, L.maxTo - L.minTo))}" value="${pk.amt}"><b id="raiseV">${pk.amt}</b></div>
        <div class="row pre">${pre.map(([t, v]) => `<button class="ghost small" data-to="${v}">${t}</button>`).join('')}<button class="ghost small" data-to="${L.maxTo}">Sve</button></div>
        <button id="raiseGo" style="width:100%">${raiseWord} na <span id="raiseV2">${pk.amt}</span>${pk.amt >= L.maxTo ? ' (all-in)' : ''}</button>
      </div>` : ''}`;
    } else if (g.phase !== 'over' && g.phase !== 'hand') {
      actions = `<div class="signals">${['👍', '😂', '😮', '🙈', '😤', '🤑'].map(t => `<button class="ghost" data-sig="${t}">${t}</button>`).join('')}</div>`;
    }
    const myInfo = mine.out ? '<div class="hname">Ispao/la si – gledaš do kraja</div>' : myHandName ? `<div class="hname">${esc(myHandName)}</div>` : '';

    let tally = '';
    if (r.wins && r.wins.some(x => x) && !r.tour) tally = ` · pobjede ${r.wins[me]}`;
    $app.innerHTML = `
      <div class="topbar">
        <button class="ghost small" id="leave">←</button>
        <div class="mid">${tourLabel(r.tour, g)}Poker · ${modeName('poker', g.mode, true)}${r.code ? ' · ' + esc(r.code) : ' · ' + LEVEL_NAMES[r.level]}${tally}</div>
        ${chatBtn()}
        <button class="ghost small" id="menuBtn">⚙</button>
      </div>
      <div class="table poker mode${g.mode} ${g.mode >= 3 ? 'has-left' : ''}">
        ${seats}${blinds}${center}
        <div class="status">${status}</div>
      </div>
      <div class="me poker">
        ${betPill(me)}
        <div class="hand">${handHtml}</div>
        <div class="mypl">${plate(me)}${myInfo}</div>
        ${actions ? `<div class="pctl">${actions}</div>` : ''}
      </div>`;

    $app.querySelector('#leave').onclick = () => { if (g.phase === 'over' || confirmLeave()) leave(); };
    $app.querySelector('#menuBtn').onclick = () => { modal = 'settings'; render(); };
    bindChatBtn();
    $app.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'open') { pk.open = !pk.open; return render(); }
      ctrl.play(a);
    });
    const rr = $app.querySelector('#raiseR');
    const setAmt = v => {
      pk.amt = Math.max(L.minTo, Math.min(L.maxTo, Math.round(+v)));
      if (rr) rr.value = pk.amt;
      $app.querySelector('#raiseV').textContent = pk.amt;
      $app.querySelector('#raiseGo').innerHTML = `${L.curBet ? 'Povisi' : 'Uloži'} na <span id="raiseV2">${pk.amt}</span>${pk.amt >= L.maxTo ? ' (all-in)' : ''}`;
    };
    if (rr) rr.oninput = () => setAmt(rr.value);
    $app.querySelectorAll('[data-to]').forEach(b => b.onclick = () => setAmt(b.dataset.to));
    const go = $app.querySelector('#raiseGo');
    if (go) go.onclick = () => { pk.open = false; ctrl.play(pk.amt >= L.maxTo ? 'allin' : 'raise:' + pk.amt); };
    $app.querySelectorAll('[data-sig]').forEach(b => b.onclick = () => {
      const k = Date.now(); if (k - (renderGame.lastSig || 0) < 1500) return; renderGame.lastSig = k;
      ctrl.signal(b.dataset.sig, false);
    });
    clearTimeout(renderGame.bt);
    if (Object.keys(bubbles).length || sysMsg) renderGame.bt = setTimeout(() => render(), 4100);
  }

  const placeText = k => k + '. mjesto';
  function pokerHandHtml() {
    const r = room, g = r.game, me = g.you, hr = g.handResult;
    if (!hr) return '';
    const order = g.players.map((_, i) => (me + i) % g.mode).filter(p => hr.delta[p] !== 0 || hr.hands[p] || !g.players[p].out || hr.busted.includes(p));
    const rows = order.map(p => {
      const pl = g.players[p], h = hr.hands[p], cards = g.shown && g.shown[p];
      const d = hr.delta[p];
      return `<tr class="${hr.won[p] ? 'win' : ''}"><td>${esc(pl.name)}${p === me ? ' (ti)' : ''}
          <div class="muted ak">${h ? esc(h.name) : pl.folded && !pl.out ? 'odustao/la' : hr.busted.includes(p) ? 'ispao/la' : ''}</div></td>
        <td class="hc2">${cards ? cards.map(c => `<div class="card xs ${h && h.best.includes(c) ? 'best' : ''}">${Art.face(c)}</div>`).join('') : ''}</td>
        <td class="${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d > 0 ? '+' + d : d < 0 ? '−' + -d : '0'}</td><td class="tot">${pl.chips}</td></tr>`;
    }).join('');
    const potsTxt = hr.pots.map((x, i) => `${hr.pots.length > 1 ? (i ? 'Sporedni lonac' : 'Glavni lonac') : 'Lonac'} ${x.amount}: <b>${x.winners.map(w => esc(g.players[w].name)).join(' i ')}</b>${x.hand ? ' – ' + esc(x.hand) : ''}`).join('<br>');
    const out = g.players[me].out;
    const myReady = !r.local && (r.ready || []).includes(me);
    const humans = r.local ? 1 : r.seats.filter((s, i) => s && !s.bot && s.connected && !g.players[i].out).length;
    const bustNote = hr.busted.length ? `<p class="forfeit">${hr.busted.map(p => p === me ? 'Ostao/la si bez žetona' : esc(g.players[p].name) + ' ispada').join(' · ')}.</p>` : '';
    const btn = out
      ? (r.local ? '<button id="nextHand" style="width:100%">Odigraj do kraja (botovi)</button>' : '<p class="muted" style="text-align:center">Gledaš do kraja, sljedeća ruka počinje za nekoliko sekundi.</p>')
      : !myReady ? '<button id="nextHand" style="width:100%">Sljedeća ruka</button>' : `<p class="muted" style="text-align:center">Čeka se ostale (${(r.ready || []).length}/${humans})… Sljedeća ruka počinje za nekoliko sekundi.</p>`;
    return `<h2>Kraj ${hr.handNo}. ruke</h2>
      <div class="pboard-sm">${hr.board.map(c => `<div class="card xs">${Art.face(c)}</div>`).join('')}</div>
      <p style="text-align:center;margin:8px 0">${potsTxt}</p>
      ${bustNote}
      <table class="scores hand-table ptable"><tr class="th"><td></td><td>Karte</td><td>+/−</td><td>Žetoni</td></tr>${rows}</table>
      ${btn}`;
  }
  function pokerResultHtml() {
    const r = room, g = r.game, res = g.result, me = g.you;
    const myPlace = res.place.indexOf(me) + 1;
    const title = myPlace === 1 ? 'Pobijedio/la si!' : placeText(myPlace);
    const rows = res.place.map((p, k) => `<tr class="${k === 0 ? 'win' : ''}"><td>${k + 1}. ${esc(g.players[p].name)}${p === me ? ' (ti)' : ''}</td><td>${g.players[p].chips}</td></tr>`).join('');
    const tally = 'Pobjede: ' + r.seats.map((s, i) => esc(s.name) + ' ' + (r.wins[i] || 0)).join(' · ');
    const canRestart = r.local || r.host;
    return `<div class="result-big">${title}</div>
      ${res.forfeit != null ? forfeitNote(g, res) : `<p class="muted" style="text-align:center">${esc(g.players[res.winners[0]].name)} je pokupio/la sve žetone (${res.hands.length} ruku).</p>`}
      <table class="scores">${rows}</table>
      ${r.tour ? '' : `<p class="muted" style="text-align:center">${tally}</p>`}
      ${tourTable(r)}${againHtml(r, canRestart)}
      <div class="row" style="margin-top:8px">${!r.local && r.host ? '<button class="ghost" id="lobby">Natrag u sobu</button>' : ''}<button class="ghost" id="out">Izlaz</button></div>`;
  }
  function pokerRulesHtml() {
    return `<div class="rules"><h2>Pravila pokera</h2>
      <p>Igra se <b>Texas Hold'em</b> s 40 karata briškule. Za poker je redoslijed <b>2, 3, 4, 5, 6, 7, fanat, konj, kralj, as</b> (fanat je kao dečko, konj kao dama). As može biti i najniži (skala A-2-3-4-5), a 7-fanat-konj-kralj-as je najviša skala.</p>
      <ul>
        <li>Svatko dobije <b>2 karte</b>. Na stol se otvaraju 3 karte (flop), pa jedna (turn) i još jedna (river). Najbolja ruka od 5 karata (od svojih 2 i 5 na stolu) nosi lonac.</li>
        <li>Svi počinju s <b>${P.START_CHIPS} žetona</b>. Dvojica lijevo od djelitelja (D) ulažu mali i veliki blind, koji <b>rastu svakih ${P.BLIND_EVERY} ruku</b>.</li>
        <li>Na potezu možeš <b>odustati</b>, <b>provjeriti</b> (kad nema uloga), <b>pratiti</b> ili <b>povisiti</b> (bez limita, do all-ina). Tko ostane bez žetona, ispada. Pobjeđuje zadnji sa žetonima.</li>
        <li><b>Jačina ruku</b> (od najslabije): visoka karta, par, dva para, <b>skala</b>, <b>tris</b>, <b>ful</b>, <b>boja</b>, poker (četiri iste), skala u boji.</li>
        <li>Jer u špilu nema 8, 9 i 10, skala je češća od trisa, a ful češći od boje, pa je ovdje <b>tris jači od skale</b>, a <b>boja jača od fula</b> (kao u „short deck” pokeru).</li>
        <li>U online igri, tko ne odigra na vrijeme provjeri (ako može) ili odustane od te ruke.</li>
      </ul>
      <button id="close" style="width:100%">Zatvori</button></div>`;
  }

  // ---------- turnir ----------
  const ordinal = k => k + '.';
  function tourTable(r, lobby) {
    const t = r.tour;
    if (!t) return '';
    const me = r.you;
    const head = t.stages.map((k, i) => `<td title="${TR.NAMES[k]}">${i < t.results.length ? TOUR_ABBR[k] : `<span class="muted">${TOUR_ABBR[k]}</span>`}</td>`).join('');
    const rows = TR.standings(t).map(x => {
      const s = r.seats[x.p];
      const cells = t.stages.map((_, i) => { const res = t.results[i]; return `<td>${res ? TR.fmt(res.pts[x.p]) : '–'}</td>`; }).join('');
      return `<tr class="${t.done && x.place === 1 ? 'win' : ''}"><td>${ordinal(x.place)} ${esc(s ? s.name : '')}${x.p === me ? ' (ti)' : ''}</td>${cells}<td class="tot">${TR.fmt(x.points)}</td></tr>`;
    }).join('');
    const title = t.done ? 'Konačni poredak turnira' : `Turnir nakon ${t.results.length}. igre`;
    return `<div class="tour ${lobby ? 'lobby' : ''}"><div class="tour-h">${title}</div>
      <table class="scores small ttable"><tr class="th"><td></td>${head}<td>Ukupno</td></tr>${rows}</table></div>`;
  }
  function againHtml(r, canRestart) {
    const t = r.tour;
    let label = 'Nova partija', wait = 'Čeka se domaćin za novu partiju…', banner = '';
    if (t) {
      if (t.done) {
        const st = TR.standings(t), mine = st.find(x => x.p === r.you);
        const winners = st.filter(x => x.place === 1).map(x => esc(r.seats[x.p].name));
        banner = `<div class="tour-win">🏆 ${mine && mine.place === 1 ? (winners.length > 1 ? 'Dijeliš pobjedu u turniru!' : 'Pobijedio/la si turnir!') : 'Turnir je osvojio/la ' + winners.join(' i ') + (mine ? ` · ti si ${mine.place}. mjesto` : '')}</div>`;
        label = 'Novi turnir'; wait = 'Čeka se domaćin za novi turnir…';
      } else {
        label = 'Sljedeća igra: ' + TR.NAMES[TR.stageKind(t)];
        wait = 'Čeka se domaćin za sljedeću igru (' + TR.NAMES[TR.stageKind(t)] + ')…';
      }
    }
    return banner + (canRestart ? `<button id="again" style="width:100%">${label}</button>` : `<p class="muted" style="text-align:center">${wait}</p>`);
  }

  function confirmLeave() {
    if (window.BRK_OFFLINE) return true;
    return window.confirm(room.local ? 'Prekinuti partiju?' : 'Napustiti igru? Bot će igrati umjesto tebe.');
  }

  // ---------- račun: red u izborniku i prozori ----------
  function accountRow() {
    if (!loggedIn()) return `<div class="acc-row guest"><span class="muted">Igraš kao gost</span><button class="small" id="accBtn">Prijava / registracija</button></div>`;
    const fc = friendCounts();
    return `<div class="acc-row">
      <button class="ghost small" id="accBtn" title="Račun">👤 ${esc(acc.user.uname)}</button>
      <button class="ghost small" id="statsBtn">📊 Statistika</button>
      <button class="ghost small" id="friendsBtn">👥 Prijatelji${fc.on ? ` <span class="on-n">${fc.on}</span>` : ''}${fc.req + fc.msg ? `<span class="badge">${fc.req + fc.msg > 9 ? '9+' : fc.req + fc.msg}</span>` : ''}</button>
    </div>`;
  }
  function bindAccountRow() {
    const a = $app.querySelector('#accBtn'); if (a) a.onclick = () => { acc.err = ''; modal = 'account'; render(); };
    const st = $app.querySelector('#statsBtn'); if (st) st.onclick = () => { modal = 'stats'; net && net.send({ type: 'account' }); render(); };
    const fr = $app.querySelector('#friendsBtn'); if (fr) fr.onclick = () => { modal = 'friends'; render(); };
  }
  const storageNote = () => acc.storage && acc.storage !== 'postgres' ? '<p class="warn">Server još nema spojenu bazu, pa se računi mogu izgubiti kod restarta servera.</p>' : '';
  function accountHtml() {
    if (loggedIn()) {
      const u = acc.user;
      return `<h2>Moj račun</h2>
        <div class="acc-head">${avatar({ av: myAv(), name: S.name, cm: S.cm }, 'lg')}<div><b>${esc(S.name || u.name)}</b><div class="muted">korisničko ime: ${esc(u.uname)}</div></div></div>
        <p class="muted">Ime, avatar i dužina pišulinca spremaju se u račun, pa ih imaš na svakom uređaju gdje se prijaviš. Prijatelji te dodaju po korisničkom imenu.</p>
        ${storageNote()}
        <details class="pw"><summary>Promijeni lozinku</summary>
          <form id="pwForm" class="stack" autocomplete="on">
            <input type="password" id="pwOld" placeholder="Stara lozinka" autocomplete="current-password">
            <input type="password" id="pwNew" placeholder="Nova lozinka (barem 6 znakova)" autocomplete="new-password">
            ${acc.err ? `<p class="err">${esc(acc.err)}</p>` : ''}
            <button type="submit" class="ghost">Spremi lozinku</button>
          </form>
        </details>
        <div class="row" style="margin-top:12px"><button class="ghost" id="logout">Odjava</button><button id="close">Zatvori</button></div>`;
    }
    const reg = acc.tab === 'register';
    return `<h2>${reg ? 'Registracija' : 'Prijava'}</h2>
      ${seg('accTab', [['login', 'Prijava'], ['register', 'Novi račun']], acc.tab)}
      <form id="accForm" class="stack" autocomplete="on">
        <input id="accUser" maxlength="20" placeholder="Korisničko ime" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(acc.lastUser || (reg ? (S.name || '').replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_.-]/gu, '') : ''))}">
        <input id="accPass" type="password" maxlength="100" placeholder="Lozinka${reg ? ' (barem 6 znakova)' : ''}" autocomplete="${reg ? 'new-password' : 'current-password'}">
        ${reg ? '<input id="accPass2" type="password" maxlength="100" placeholder="Ponovi lozinku" autocomplete="new-password">' : ''}
        ${acc.err ? `<p class="err">${esc(acc.err)}</p>` : ''}
        <button type="submit" ${acc.busy ? 'disabled' : ''}>${reg ? 'Napravi račun' : 'Prijavi se'}</button>
      </form>
      <p class="muted">${reg ? 'Račun pamti tvoj profil i statistiku (odigrane partije i pobjede), a možeš dodavati prijatelje i vidjeti tko je online. Ne treba e-mail.' : 'Nemaš račun? Odaberi „Novi račun”. Igrati možeš i bez prijave, kao gost.'}</p>
      ${storageNote()}
      <button class="ghost" id="close" style="width:100%">Zatvori</button>`;
  }
  function statsHtml() {
    const st = (acc.user && acc.user.stats) || {};
    const table = (sec, title) => {
      const d = st[sec] || {};
      let tp = 0, tw = 0;
      const rows = STAT_ROWS.map(([k, n]) => {
        const x = d[k] || { p: 0, w: 0, d: 0 };
        tp += x.p; tw += x.w;
        return `<tr class="${x.p ? '' : 'zero'}"><td>${n}</td><td>${x.p}</td><td>${x.w}</td><td>${x.p ? Math.round(100 * x.w / x.p) + '%' : '–'}</td></tr>`;
      }).join('');
      return `<h3>${title}</h3><table class="scores stats"><tr><th>Igra</th><th>Odigrano</th><th>Pobjede</th><th>%</th></tr>${rows}
        <tr class="tot"><td>Ukupno</td><td>${tp}</td><td>${tw}</td><td>${tp ? Math.round(100 * tw / tp) + '%' : '–'}</td></tr></table>`;
    };
    return `<h2>Statistika</h2>
      <p class="muted" style="text-align:center;margin-top:-4px">${esc(acc.user ? acc.user.uname : '')}</p>
      ${table('online', 'Online (s drugim igračima)')}
      ${table('bots', 'Protiv botova')}
      <p class="muted">Turnir se broji kao jedna partija (pobjeda = prvo mjesto), a njegove igre se broje i pod briškulom, trešetom i pokerom. Tko napusti online partiju prije kraja, upiše mu se poraz.</p>
      <button id="close" style="width:100%">Zatvori</button>`;
  }
  function friendsHtml() {
    if (!loggedIn()) return `<h2>Prijatelji</h2><p>Za prijatelje treba račun.</p><div class="row"><button class="ghost" id="close">Zatvori</button><button id="toAcc">Prijava / registracija</button></div>`;
    const inRoom = room && !room.local && room.code;
    const order = { in: 0, ok: 1, out: 2 };
    const list = acc.friends.slice().sort((a, b) => order[a.status] - order[b.status] || (!!b.at - !!a.at) || a.name.localeCompare(b.name, 'hr'));
    const item = f => {
      let btns = '', sub = '';
      if (f.status === 'in') { sub = 'želi biti tvoj prijatelj'; btns = `<button class="small" data-facc="${f.id}">Prihvati</button><button class="ghost small" data-frem="${f.id}" aria-label="Odbij">✕</button>`; }
      else if (f.status === 'out') { sub = 'čeka potvrdu'; btns = `<button class="ghost small" data-frem="${f.id}">Povuci</button>`; }
      else {
        sub = friendWhere(f);
        const here = f.at && inRoom && f.at.code === room.code;
        if (here) sub = 'U tvojoj sobi';
        else if (inRoom && f.at) btns += `<button class="small" data-finv="${f.id}">Pozovi</button>`;
        else if (f.at && f.at.open && f.at.code) btns += `<button class="small" data-fjoin="${esc(f.at.code)}">Pridruži se</button>`;
        btns = `<button class="ghost small msg-btn${f.unread ? ' new' : ''}" data-fmsg="${f.id}" aria-label="Poruke">💬${f.unread ? `<span class="badge">${f.unread > 9 ? '9+' : f.unread}</span>` : ''}</button>` + btns;
        if (f.unread) sub = f.unread === 1 ? 'Nova poruka' : f.unread + (f.unread < 5 ? ' nove poruke' : ' novih poruka');
        btns += `<button class="ghost small" data-frem="${f.id}" data-fname="${esc(f.name)}" aria-label="Ukloni">✕</button>`;
      }
      return `<li class="${f.at ? 'online' : ''}${f.unread ? ' unread' : ''}">${avatar({ av: f.av, name: f.name, cm: 0 }, 'md', f.status === 'ok' ? `<span class="pres ${f.at ? 'on' : ''}"></span>` : '')}
        <span class="n"><b>${esc(f.name)}</b> <span class="muted">${esc(f.uname)}</span><span class="sub">${esc(sub)}</span></span>${btns}</li>`;
    };
    return `<h2>Prijatelji</h2>
      <form id="fAdd" class="row" autocomplete="off"><input id="fName" maxlength="20" placeholder="Korisničko ime prijatelja" autocapitalize="off" spellcheck="false"><button type="submit" style="flex:0 0 auto">Dodaj</button></form>
      <p class="muted" style="margin:6px 0 10px">Tvoje korisničko ime je <b>${esc(acc.user.uname)}</b>, pošalji ga prijateljima.</p>
      ${list.length ? `<ul class="seats friends">${list.map(item).join('')}</ul>` : '<p class="muted" style="text-align:center">Još nemaš prijatelja na popisu.</p>'}
      ${list.some(f => f.status === 'ok') ? '<p class="muted">💬 šalje poruku prijatelju, i kad nije online (vidjet će je kad uđe).</p>' : ''}
      ${inRoom ? '<p class="muted">Prijatelji koji su online dobit će poziv u tvoju sobu.</p>' : ''}
      <button id="close" style="width:100%">Zatvori</button>`;
  }
  function bindAccountModal(el, refocus) {
    el.querySelectorAll('[data-seg="accTab"] button').forEach(b => b.onclick = () => { acc.tab = b.dataset.v; acc.err = ''; render(); });
    const f = el.querySelector('#accForm');
    if (f) {
      if (!refocus && window.matchMedia('(min-width: 900px)').matches) (el.querySelector('#accUser').value ? el.querySelector('#accPass') : el.querySelector('#accUser')).focus();
      f.onsubmit = e => {
        e.preventDefault();
        const uname = el.querySelector('#accUser').value.trim(), pass = el.querySelector('#accPass').value;
        const p2 = el.querySelector('#accPass2');
        acc.lastUser = uname;
        if (!uname || !pass) { acc.err = 'Upiši korisničko ime i lozinku.'; return render(); }
        if (p2 && p2.value !== pass) { acc.err = 'Lozinke se ne podudaraju.'; return render(); }
        acc.err = ''; acc.busy = true;
        if (!S.name && acc.tab === 'register') { S.name = uname; save(); }
        const n = getNet();
        if (acc.tab === 'register') n.send(profileMsg());
        n.send({ type: acc.tab === 'register' ? 'register' : 'login', uname, pass });
        render();
      };
    }
    const lo = el.querySelector('#logout');
    if (lo) lo.onclick = () => { net && net.send({ type: 'logout' }); store.set('auth', null); acc.user = null; acc.friends = []; dm.with = null; dm.conv = {}; modal = null; render(); toast('Odjavljen/a si.'); };
    const pw = el.querySelector('#pwForm');
    if (pw) pw.onsubmit = e => { e.preventDefault(); acc.err = ''; net.send({ type: 'password', old: el.querySelector('#pwOld').value, pass: el.querySelector('#pwNew').value }); pw.reset(); };
    const ta = el.querySelector('#toAcc'); if (ta) ta.onclick = () => { modal = 'account'; render(); };
    const fa = el.querySelector('#fAdd');
    if (fa) fa.onsubmit = e => { e.preventDefault(); const v = el.querySelector('#fName').value.trim(); if (v) { net.send({ type: 'friendAdd', uname: v }); el.querySelector('#fName').value = ''; } };
    el.querySelectorAll('[data-facc]').forEach(b => b.onclick = () => net.send({ type: 'friendAccept', id: +b.dataset.facc }));
    el.querySelectorAll('[data-frem]').forEach(b => b.onclick = () => {
      if (b.dataset.fname && !window.confirm('Ukloniti ' + b.dataset.fname + ' s popisa prijatelja?')) return;
      net.send({ type: 'friendRemove', id: +b.dataset.frem });
    });
    el.querySelectorAll('[data-finv]').forEach(b => b.onclick = () => net.send({ type: 'invite', id: +b.dataset.finv }));
    el.querySelectorAll('[data-fjoin]').forEach(b => b.onclick = () => joinRoomCode(b.dataset.fjoin));
    el.querySelectorAll('[data-fmsg]').forEach(b => b.onclick = () => openDm(+b.dataset.fmsg));
  }

  function renderModal() {
    let el = document.getElementById('overlay');
    let html = '';
    const g = room && room.game;
    if (modal === 'rules') html = rulesHtml();
    else if (modal === 'settings') html = `<h2>Postavke</h2>
      ${room && !room.local && room.game ? '<p class="muted">U online igri bodovi se tijekom ruke ne prikazuju, po pravilima ih brojiš sam/a. Vidi se samo ukupni rezultat.</p>' : ''}
      <label class="chk"><input type="checkbox" id="sp" ${S.showPoints ? 'checked' : ''}> Prikaži bodove tijekom igre (protiv botova)</label>
      <label class="chk"><input type="checkbox" id="scm" ${S.showCm ? 'checked' : ''}> Prikaži dužinu pišulinca ispod avatara</label>
      <label class="chk"><input type="checkbox" id="snd" ${S.sound ? 'checked' : ''}> Zvukovi</label>
      <div class="row" style="margin-top:12px"><button class="ghost" id="rulesB">Pravila</button><button id="close">Zatvori</button></div>`;
    else if (modal === 'account') html = accountHtml();
    else if (modal === 'stats') html = statsHtml();
    else if (modal === 'friends') html = friendsHtml();
    else if (modal === 'avatar') {
      const tiles = Array.from({ length: AV.N }, (_, i) => `<button class="av-opt ${S.avatar === 'e' + i ? 'on' : ''}" data-av="e${i}" aria-label="Avatar ${i + 1}">${AV.face(i)}</button>`);
      if (S.avatarImg) tiles.unshift(`<button class="av-opt ${S.avatar === 'img' ? 'on' : ''}" data-av="img" aria-label="Moja slika"><img src="${esc(S.avatarImg)}" alt=""></button>`);
      html = `<h2>Odaberi avatar</h2>
        <div class="av-grid">${tiles.join('')}</div>
        <label class="upload ghost"><input type="file" id="avFile" accept="image/*" hidden>📷 ${S.avatarImg ? 'Učitaj drugu sliku' : 'Učitaj svoju sliku'}</label>
        <p class="muted" style="text-align:center;margin:8px 0 12px">Slika se izreže na kvadrat i smanji, pa je vide i ostali igrači u online igri.</p>
        <div class="row">${S.avatarImg ? '<button class="ghost" id="avDel">Ukloni sliku</button>' : ''}<button id="close">Gotovo</button></div>`;
    }
    else if (modal === 'last' && g && g.lastTrick) html = `<h2>Zadnji štih</h2>
      <div class="lasttrick">${g.lastTrick.cards.map(t => `<div style="text-align:center"><div class="card">${Art.face(t.card)}</div><div class="muted">${esc(g.players[t.p].name)}</div></div>`).join('')}</div>
      <p style="text-align:center">Nosi: <b>${esc(g.players[g.lastTrick.winner].name)}</b>${room.local ? ` (+${ptsText(g, g.lastTrick.points)})` : ''}${g.lastTrick.last ? ' · zadnji štih' : ''}</p>
      <button id="close" style="width:100%">Zatvori</button>`;
    else if (g && g.phase === 'over') html = g.kind === 'poker' ? pokerResultHtml() : g.kind === 'treseta' ? tresetaResultHtml() : resultHtml();
    else if (g && g.phase === 'hand') html = g.kind === 'poker' ? pokerHandHtml() : handEndHtml();
    if (!html) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'overlay'; el.className = 'overlay'; document.body.appendChild(el); }
    // ako se prozor iscrta ponovno dok se tipka (npr. stigne promjena popisa prijatelja), upisano ostaje
    const same = el.dataset.modal === String(modal);
    const keep = same ? [...el.querySelectorAll('input[id]:not([type=checkbox]):not([type=range]):not([type=file])')].map(i => [i.id, i.value]) : [];
    const focus = same && el.contains(document.activeElement) && document.activeElement.id;
    const scroll = same && el.querySelector('.modal') ? el.querySelector('.modal').scrollTop : 0;
    const pwOpen = same && el.querySelector('details.pw[open]');
    el.dataset.modal = String(modal);
    el.innerHTML = `<div class="modal">${html}</div>`;
    for (const [id, v] of keep) { const i = el.querySelector('#' + id); if (i && v) i.value = v; }
    if (pwOpen) { const d = el.querySelector('details.pw'); if (d) d.open = true; }
    if (scroll) el.querySelector('.modal').scrollTop = scroll;
    bindAccountModal(el, !!focus);
    if (focus) { const f = el.querySelector('#' + focus); if (f) f.focus(); }
    const c = el.querySelector('#close'); if (c) c.onclick = () => { modal = null; render(); };
    const sp = el.querySelector('#sp'); if (sp) sp.onchange = () => { S.showPoints = sp.checked; save(); render(); };
    const scm = el.querySelector('#scm'); if (scm) scm.onchange = () => { S.showCm = scm.checked; save(); render(); };
    const snd = el.querySelector('#snd'); if (snd) snd.onchange = () => { S.sound = snd.checked; save(); };
    const rb = el.querySelector('#rulesB'); if (rb) rb.onclick = () => { modal = 'rules'; render(); };
    el.querySelectorAll('[data-av]').forEach(b => b.onclick = () => { S.avatar = b.dataset.av; save(); render(); });
    const avFile = el.querySelector('#avFile');
    if (avFile) avFile.onchange = async () => {
      const f = avFile.files && avFile.files[0];
      if (!f) return;
      try { S.avatarImg = await AV.fromFile(f); S.avatar = 'img'; save(); toast('Slika postavljena'); }
      catch (e) { toast(e && e.message || 'Slika se ne može učitati.'); }
      render();
    };
    const avDel = el.querySelector('#avDel');
    if (avDel) avDel.onclick = () => { S.avatarImg = ''; if (S.avatar === 'img') S.avatar = 'e0'; save(); render(); };
    const nx = el.querySelector('#nextHand'); if (nx) nx.onclick = () => ctrl.next();
    const again = el.querySelector('#again'); if (again) again.onclick = () => { ctrl.rematch(); };
    const lobby = el.querySelector('#lobby'); if (lobby) lobby.onclick = () => ctrl.send({ type: 'toLobby' });
    const out = el.querySelector('#out'); if (out) out.onclick = leave;
    el.onclick = e => { if (e.target === el && modal) { modal = null; render(); } };
  }

  const isWinRow = (res, s) => !res.draw && s.players.every(p => res.winners.includes(p));
  const forfeitNote = (g, res) => `<p class="forfeit">⏱ ${res.forfeit === g.you ? 'Nisi odigrao/la na vrijeme' : esc(g.players[res.forfeit].name) + ' nije odigrao/la na vrijeme'}, pa je partija gotova.</p>`;
  function resultHtml() {
    const r = room, g = r.game, res = g.result, me = g.you;
    const myTeam = E.teamOf(g.mode, me);
    const won = !res.draw && res.winners.includes(me);
    const title = res.draw ? 'Neriješeno!' : won ? (g.mode === 4 ? 'Pobijedili ste!' : 'Pobijedio/la si!') : (g.mode === 4 ? 'Izgubili ste' : 'Izgubio/la si');
    const rows = res.scores.slice().sort((a, b) => g.low ? a.points - b.points : b.points - a.points).map(s => {
      const names = s.players.map(p => esc(g.players[p].name)).join(' & ');
      const mine = s.players.includes(me);
      return `<tr class="${isWinRow(res, s) ? 'win' : ''}"><td>${names}${mine ? ' (ti)' : ''}</td><td>${s.points}</td></tr>`;
    }).join('');
    const tally = g.mode === 4 ? `Ukupno partija: <b>${r.wins[myTeam]} : ${r.wins[1 - myTeam]}</b>` : 'Pobjede: ' + r.seats.map((s, i) => esc(s.name) + ' ' + r.wins[i]).join(' · ');
    const canRestart = r.local || r.host;
    const lowNote = res.forfeit != null ? forfeitNote(g, res) : !g.low ? '' : res.kapot
      ? `<p style="text-align:center"><b>Kapot!</b> ${esc(res.winners.map(p => g.players[p].name).join(' & '))} ${res.winners.length > 1 ? 'su pokupili' : 'je pokupio/la'} svih 120 bodova i pobjeđuje.</p>`
      : `<p class="muted" style="text-align:center">${LOW_NAME}: pobjeđuje tko ima manje bodova.</p>`;
    return `<div class="result-big">${title}</div>
      ${lowNote}
      <table class="scores">${rows}</table>
      ${r.tour ? '' : `<p class="muted" style="text-align:center">${tally}</p>`}
      ${tourTable(r)}${againHtml(r, canRestart)}
      <div class="row" style="margin-top:8px">${!r.local && r.host ? '<button class="ghost" id="lobby">Natrag u sobu</button>' : ''}<button class="ghost" id="out">Izlaz</button></div>`;
  }

  // ---------- trešeta: kraj ruke i kraj partije ----------
  function teamName(g, t, me) {
    const ps = E.teamOf(g.mode, me) === t;
    const names = (g.mode === 4 ? [t, t + 2] : [t]).map(p => esc(g.players[p].name)).join(' & ');
    return names + (ps ? (g.mode === 4 ? ' (vi)' : ' (ti)') : '');
  }
  function handEndHtml() {
    const r = room, g = r.game, me = g.you, hr = g.handResult;
    if (!hr) return '';
    const max = Math.max(...g.score), min = Math.min(...g.score);
    const tie = max >= g.target && g.score.filter(x => x === (g.low ? min : max)).length > 1;
    const ak = !g.low;
    const rows = hr.teams.map(t => `<tr>
        <td>${teamName(g, t.team, me)}${t.akuze.length ? `<div class="muted ak">${t.akuze.map(a => esc(a.text) + ' +' + a.pts).join(', ')}</div>` : ''}</td>
        <td>${T.fmt(t.cardBele)}</td><td>${t.last ? '+1' : ''}</td>${ak ? `<td>${t.akPts ? '+' + t.akPts : ''}</td>` : ''}<td><b>${t.points}</b>${t.kapot ? ' <span class="muted">kapot</span>' : ''}</td><td class="tot">${t.total}</td></tr>`).join('');
    const myReady = !r.local && (r.ready || []).includes(me);
    const humans = r.local ? 1 : r.seats.filter(s => s && !s.bot && s.connected).length;
    return `<h2>Kraj ${hr.handNo}. ruke</h2>
      <table class="scores hand-table"><tr class="th"><td></td><td>Karte</td><td>Zadnji</td>${ak ? '<td>Akuže</td>' : ''}<td>Ruka</td><td>Ukupno</td></tr>${rows}</table>
      <p class="muted" style="text-align:center">${hr.teams.some(t => t.kapot) ? '<b>Kapot!</b> Tko pokupi sve bodove dobije 0, a ostali po 11. ' : ''}${tie ? 'Izjednačeno – igra se još jedna ruka.' : g.low ? `${LOW_NAME}: kad netko dođe do ${g.target}, pobjeđuje tko ima najmanje.` : `Igra se do ${g.target} bodova.`} Bele (trećine) koje ne čine cijeli bod se ne broje.</p>
      ${!myReady ? '<button id="nextHand" style="width:100%">Sljedeća ruka</button>' : `<p class="muted" style="text-align:center">Čeka se ostale (${(r.ready || []).length}/${humans})… Sljedeća ruka počinje za nekoliko sekundi.</p>`}`;
  }
  function tresetaResultHtml() {
    const r = room, g = r.game, res = g.result, me = g.you;
    const myTeam = E.teamOf(g.mode, me);
    const won = res.winners.includes(me);
    const title = won ? (g.mode === 4 ? 'Pobijedili ste!' : 'Pobijedio/la si!') : (g.mode === 4 ? 'Izgubili ste' : 'Izgubio/la si');
    const rows = res.scores.slice().sort((a, b) => g.low ? a.points - b.points : b.points - a.points).map(s =>
      `<tr class="${isWinRow(res, s) ? 'win' : ''}"><td>${teamName(g, s.team, me)}</td><td>${s.points}</td></tr>`).join('');
    const n = res.scores.length;
    const head = res.scores.map(s => `<td>${g.mode === 4 ? (s.team === myTeam ? 'Mi' : 'Vi') : esc(g.players[s.team].name.replace(/^Bot /, ''))}</td>`).join('');
    const hist = res.hands.map(h => `<tr><td>${h.handNo}.</td>${h.points.map((p, t) => `<td>${p} <span class="muted">(${h.score[t]})</span></td>`).join('')}</tr>`).join('');
    const tally = g.mode === 4 ? `Ukupno partija: <b>${r.wins[myTeam]} : ${r.wins[1 - myTeam]}</b>` : 'Pobjede: ' + r.seats.map((s, i) => esc(s.name) + ' ' + r.wins[i]).join(' · ');
    const canRestart = r.local || r.host;
    return `<div class="result-big">${title}</div>
      ${res.forfeit != null ? forfeitNote(g, res) : g.low ? `<p class="muted" style="text-align:center">${LOW_NAME}: pobjeđuje tko ima manje bodova.</p>` : ''}
      <table class="scores">${rows}</table>
      <details class="hist"><summary class="muted">Bodovi po rukama</summary>
        <table class="scores small"><tr class="th"><td>Ruka</td>${head}</tr>${hist}</table></details>
      ${r.tour ? '' : `<p class="muted" style="text-align:center">${tally}</p>`}
      ${tourTable(r)}${againHtml(r, canRestart)}
      <div class="row" style="margin-top:8px">${!r.local && r.host ? '<button class="ghost" id="lobby">Natrag u sobu</button>' : ''}<button class="ghost" id="out">Izlaz</button></div>`;
  }

  function tresetaRulesHtml() {
    return `<div class="rules"><h2>Pravila trešete</h2>
      <p>Igra se s 40 karata (kupe, dinari, špade, bate). <b>Nema briškule</b> (aduta). Jačina karata od najjače: <b>trica, dvica, as, kralj, konj, fanat</b>, pa 7, 6, 5, 4.</p>
      <ul>
        <li><b>Mora se odgovoriti na boju.</b> Tko nema boju, baca bilo koju kartu. Štih nosi najjača karta boje koja je prva bačena.</li>
        <li><b>Bodovi:</b> as vrijedi 1 bod, a trica, dvica, kralj, konj i fanat po ⅓ boda (jedna „bela”). Zadnji štih nosi još 1 bod. Na kraju ruke bele koje ne čine cijeli bod se ne broje, pa ruka vrijedi 11 bodova.</li>
        <li><b>Akuže</b> se prijavljuju same na početku ruke: <b>napolitana</b> (trica, dvica i as iste boje) 3 boda, <b>tri trice / dvice / asa</b> 3 boda, <b>sve četiri</b> 4 boda. Te karte svi vide.</li>
        <li>Igra se u više ruku <b>do 41 boda</b> (može i do 21 ili 31). Pobjeđuje tko prvi dođe do cilja na kraju ruke; ako su dvije strane izjednačene, igra se još jedna ruka.</li>
        <li><b>U parovima</b> (2 na 2) suigrači sjede nasuprot, svatko dobije 10 karata. Smiju se reći znakovi „Kucam” (uzmi najjačom), „Strišo” (imam još te boje) i „Volo” (to mi je zadnja te boje).</li>
        <li><b>U dvoje</b> svatko dobije 10 karata, a ostalih 20 su špil: nakon svakog štiha svatko vuče jednu kartu (prvi tko je nosio štih) i <b>pokaže je</b>, pa se te karte vide licem prema gore.</li>
        <li><b>U troje</b> se izbacuje četvorka dinara (39 karata), svatko dobije 13 i igra za sebe.</li>
        <li><b>${LOW_NAME}</b> (trešeta „na manje”): iste karte i pravila, ali bez akuža, a cilj je skupiti što <b>manje</b> bodova. Tko u jednoj ruci pokupi sve bodove (<b>kapot</b>), dobije 0, a ostali po 11. Kad netko dođe do cilja (npr. 41), pobjeđuje tko ima najmanje bodova.</li>
      </ul>
      <button id="close" style="width:100%">Zatvori</button></div>`;
  }

  function rulesHtml() {
    const rk = room ? room.kind : S.kind;
    if (rk === 'treseta') return tresetaRulesHtml();
    if (rk === 'poker') return pokerRulesHtml();
    if (rk === 'turnir') return `<div class="rules"><h2>Turnir</h2><p>${KIND_DESC.turnir}</p>
      <p>Na kraju pobjeđuje tko ima najviše bodova; ako je izjednačeno, odlučuje bolji plasman u pokeru. U turniru blindovi u pokeru rastu svake ${TOUR_BLINDS} ruke.</p>
      <p class="muted">Pravila pojedine igre vidiš tijekom te igre (⚙ → Pravila) ili kad u izborniku odabereš tu igru.</p>
      <button id="close" style="width:100%">Zatvori</button></div>`;
    return `<div class="rules"><h2>Pravila briškule</h2>
      <p>Igra se s 40 karata u četiri boje: <b>kupe, dinari, špade i bate</b>. Jačina karata od najjače: <b>as, trica, kralj, konj, fanat</b>, pa 7, 6, 5, 4, 2.</p>
      <p>Bodovi: as 11, trica 10, kralj 4, konj 3, fanat 2, ostale 0. Ukupno ima 120 bodova, a pobjeđuje tko skupi više od 60 (60:60 je neriješeno).</p>
      <ul>
        <li>Svaki igrač dobije 3 karte, a sljedeća karta se okrene i njezina boja je <b>briškula</b> (adut). Ta karta se vuče zadnja.</li>
        <li>Ne mora se odgovarati na boju. Štih nosi najjača briškula, a ako je nema, najjača karta boje koja je prva bačena.</li>
        <li>Tko nosi štih, prvi vuče novu kartu iz špila i prvi igra sljedeći štih.</li>
        <li><b>U troje</b> se izbacuje dvica dinara, pa je u igri 39 karata.</li>
        <li><b>${LOW_NAME}</b> („tko napravi manje”): igra se po istim pravilima, ali pobjeđuje tko skupi <b>manje</b> bodova (u troje onaj s najmanje). Tko pokupi <b>svih 120 bodova</b> (kapot), odmah pobjeđuje. Kad netko drugi nosi štih, baci mu asa ili tricu!</li>
        <li><b>U parovima</b> suigrači sjede nasuprot i bodovi im se zbrajaju. Smiju si davati znakove (gumbi „Imam briškulu”, „Karikaj!”… vidi ih samo suigrač), a kad se špil potroši, vidiš karte svog suigrača.</li>
      </ul>
      <button id="close" style="width:100%">Zatvori</button></div>`;
  }

  // ---------- pokretanje ----------
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (!room) render(); });
  if (!window.BRK_OFFLINE && 'serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
  window.addEventListener('resize', () => { if (room && room.game) render(); });

  const params = new URLSearchParams(location.search);
  const joinCode = params.get('soba');
  render();
  if (window.BRK_OFFLINE) { /* samo botovi */ }
  else if (joinCode) {
    if (!S.name) { S.name = 'Igrač' + Math.floor(Math.random() * 900 + 100); save(); }
    ctrl = getNet(); ctrl.send(profileMsg()); ctrl.send({ type: 'join', code: joinCode.toUpperCase() });
  } else if (store.get('token', null)) {
    // ponovno spajanje u igru koja je u tijeku (npr. nakon osvježavanja)
    ctrl = getNet();
  }
  // prijavljeni igrač je odmah online (prijatelji vide da je tu)
  if (!window.BRK_OFFLINE && store.get('auth', null)) getNet();
  window.__brk = { get room() { return room; }, get ctrl() { return ctrl; }, acc };
})();
