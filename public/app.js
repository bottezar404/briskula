/* Briškula – klijent */
(function () {
  'use strict';
  const E = window.BriskulaEngine, B = window.BriskulaBot, Art = window.CardArt;
  const T = window.TresetaEngine, TB = window.TresetaBot, AV = window.Avatars;
  const engOf = k => k === 'treseta' ? T : E;
  const botOf = k => k === 'treseta' ? TB : B;
  const $app = document.getElementById('app');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MODE_NAMES = { 2: 'Dvoje', 3: 'Troje', 4: 'Parovi (2 na 2)' };
  const MODE_SHORT = { 2: 'Dvoje', 3: 'Troje', 4: 'Parovi' };
  const LEVEL_NAMES = { easy: 'Lako', normal: 'Srednje', hard: 'Teško' };
  const LOW_NAME = 'Chi fa meno';
  const KIND_NAMES = { briskula: 'Briškula', treseta: 'Trešeta' };
  const KINDS = [['briskula', 'Briškula'], ['treseta', 'Trešeta']];
  const LOWS = [[0, 'Obično'], [1, LOW_NAME]];
  const kindLabel = (k, low) => (k === 'treseta' ? ' · Trešeta' : '') + (low ? ' · ' + LOW_NAME : '');

  // ---------- postavke ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('brk_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('brk_' + k, JSON.stringify(v)); } catch { } },
  };
  const S = {
    name: store.get('name', ''),
    showPoints: store.get('showPoints', true),
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
  };
  if (!/^e\d{1,2}$/.test(S.avatar) && !(S.avatar === 'img' && S.avatarImg)) S.avatar = 'e0';
  S.cm = Math.max(0, Math.min(50, Math.round(+S.cm) || 0));
  if (!KIND_NAMES[S.kind]) S.kind = 'briskula'; // stari 'meno' = briškula na manje
  S.naManje = S.naManje ? 1 : 0;
  if (![21, 31, 41].includes(S.target)) S.target = 41;
  function save() { for (const k in S) store.set(k, S[k]); }

  // ---------- avatari ----------
  const CM_MAX = 50;
  const imgCache = {}; // id -> data URL (slike igrača koje je poslao server)
  const myAv = () => S.avatar === 'img' && S.avatarImg ? (imgCache.me = S.avatarImg, 'i:me') : S.avatar;
  const profileMsg = () => Object.assign({ type: 'profile', name: S.name, cm: S.cm }, S.avatar === 'img' && S.avatarImg ? { av: 'img', img: S.avatarImg } : { av: S.avatar });
  const cmText = cm => cm ? cm + ' cm' : 'tajna 🤫';
  function avatar(seat, cls, extra) {
    if (!seat) return `<span class="av ${cls || ''} empty"></span>`;
    return `<span class="av ${cls || ''}">${AV.inner(seat.av, imgCache, seat.name)}${seat.cm ? `<span class="cmb" title="Dužina pišulinca">${seat.cm}<small>cm</small></span>` : ''}${extra || ''}</span>`;
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
      this.E = engOf(this.kind); this.B = botOf(this.kind);
      const botNames = ['Jure', 'Mare', 'Ante', 'Luce', 'Frane', 'Tonka'].sort(() => Math.random() - .5);
      this.names = [name || 'Ti'].concat(botNames.slice(0, mode - 1).map(n => 'Bot ' + n));
      this.avs = this.names.map((n, i) => i ? AV.forName(n) : null);
      this.wins = Array(mode === 4 ? 2 : mode).fill(0);
      this.signals = []; this.dealer = Math.floor(Math.random() * mode) - 1;
      this.start();
    }
    start() {
      this.dealer = (this.dealer + 1) % this.mode;
      this.st = this.E.newGame(this.mode, { names: this.names, bots: this.names.map((_, i) => i > 0), dealer: this.dealer, low: this.low, target: this.target });
      this.signals = [];
      this.emit(); this.schedule();
    }
    view() {
      return {
        type: 'room', local: true, code: null, mode: this.mode, level: this.level, low: this.low, kind: this.kind, target: this.target, host: true, you: 0, wins: this.wins,
        seats: this.names.map((n, i) => ({ name: n, bot: i > 0, connected: true, av: i ? this.avs[i] : myAv(), cm: i ? 0 : S.cm })),
        game: this.E.viewFor(this.st, 0), signals: this.signals.slice(-6),
      };
    }
    emit() { onRoom(this.view()); }
    schedule() {
      clearTimeout(this.timer);
      const st = this.st;
      if (st.phase === 'collect') this.timer = setTimeout(() => {
        this.E.collect(st);
        if (st.phase === 'over' && !st.result.draw) this.wins[E.teamOf(this.mode, st.result.winners[0])]++;
        this.emit(); this.schedule();
      }, 1350);
      else if (st.phase === 'play' && st.turn !== 0) this.timer = setTimeout(() => {
        const c = this.B.choose(this.E.viewFor(st, st.turn), this.level);
        this.E.play(st, st.turn, c); this.emit(); this.schedule();
      }, 650 + Math.random() * 450);
    }
    play(c) { if (this.E.play(this.st, 0, c)) { this.emit(); this.schedule(); } }
    next() { if (this.st.phase === 'hand') { T.nextHand(this.st); this.signals = []; this.emit(); this.schedule(); } }
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
        ws.send(JSON.stringify(Object.assign(profileMsg(), { type: 'hello', token: this.token })));
        const q = this.q; this.q = []; q.forEach(m => ws.send(JSON.stringify(m)));
        render();
      };
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.type === 'welcome') { this.token = m.token; store.set('token', m.token); }
        else if (m.type === 'room') { if (m.imgs) Object.assign(imgCache, m.imgs); if (ctrl === this) onRoom(m); }
        else if (m.type === 'left') { if (ctrl === this) { room = null; chat.open = false; render(); } }
        else if (m.type === 'error') toast(m.msg);
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
    const old = room; room = r;
    const g = r.game, og = old && old.game;
    if (g && og) {
      if (g.trick.length > og.trick.length) sfx.play();
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

  // ---------- prikaz ----------
  function render() {
    if (!room) renderMenu();
    else if (!room.game) renderLobby();
    else renderGame();
    renderModal();
    renderChat();
  }

  function seg(name, opts, val) {
    return `<div class="seg" data-seg="${name}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  }

  const KIND_DESC = {
    briskula: 'Klasična briškula: pobjeđuje tko skupi više bodova.',
    treseta: 'Trešeta: bez briškule, mora se odgovoriti na boju. Igra se u više ruku, do zadanog broja bodova.',
  };
  function kindDesc(kind, low) {
    if (!low) return KIND_DESC[kind];
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
      </div>
      <div class="panel">
        <h2>Vrsta igre</h2>
        ${seg('kind', KINDS, S.kind)}
        ${seg('naManje', LOWS, S.naManje)}
        ${S.kind === 'treseta' ? seg('target', [[21, 'Do 21'], [31, 'Do 31'], [41, 'Do 41']], S.target) : ''}
        <p class="muted" style="margin:0">${kindDesc(S.kind, S.naManje)}</p>
      </div>
      <div class="panel">
        <h2>Igraj protiv botova</h2>
        ${seg('botMode', [[2, 'Dvoje'], [3, 'Troje'], [4, 'Parovi']], S.botMode)}
        ${seg('botLevel', [['easy', 'Lako'], ['normal', 'Srednje'], ['hard', 'Teško']], S.botLevel)}
        <button id="playBots" style="width:100%">Igraj</button>
      </div>
      ${window.BRK_OFFLINE ? '<p class="muted" style="text-align:center">Ovo je probna verzija samo s botovima. Online igra radi kad se aplikacija postavi na server.</p>' : `<div class="panel">
        <h2>Online s drugim igračima</h2>
        ${seg('onMode', [[2, 'Dvoje'], [3, 'Troje'], [4, 'Parovi']], S.onMode)}
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
    $app.querySelector('#playBots').onclick = () => { needName(); ctrl = new LocalGame(+S.botMode, S.botLevel, S.name, S.kind, S.target, !!S.naManje); };
    if (!window.BRK_OFFLINE) {
    $app.querySelector('#create').onclick = () => { needName(); ctrl = getNet(); ctrl.send(profileMsg()); ctrl.send({ type: 'create', mode: +S.onMode, level: 'normal', kind: S.kind, low: !!S.naManje, target: S.target }); };
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
      <div class="topbar"><button class="ghost small" id="leave">← Izlaz</button><div class="mid">${MODE_NAMES[r.mode]}${kindLabel(r.kind, r.low)}${r.isPublic ? ' · javna igra' : ''}</div>${chatBtn()}</div>
      <div class="panel" style="text-align:center">
        <div class="muted">Kod sobe</div>
        <div class="code">${esc(r.code)}</div>
        ${r.isPublic ? '' : '<button id="share" class="ghost small">Pošalji poziv</button>'}
        ${conn ? '' : '<p class="muted">Spajanje na server…</p>'}
      </div>
      <div class="panel">
        <h2>Igrači</h2>
        <ul class="seats">${r.seats.map((s, i) => `<li>
          ${avatar(s, 'md')}
          <span class="n">${s ? esc(s.name) + (i === r.you ? ' (ti)' : '') : '<span class="muted">čeka se igrač…</span>'}${s && s.cm ? `<span class="cmt">Dužina pišulinca: ${s.cm} cm</span>` : ''}</span>
          ${r.mode === 4 ? `<span class="tag team${i % 2}">${i % 2 ? 'Par B' : 'Par A'}</span>` : ''}
          ${s && s.bot ? '<span class="tag">bot</span>' : ''}
          ${s && !s.bot && !s.connected ? '<span class="tag">odspojen</span>' : ''}
          ${(!s || s.bot) && i !== r.you ? `<button class="ghost small" data-seat="${i}">Sjedni ovdje</button>` : ''}
          ${r.host && s && s.bot ? `<button class="ghost small" data-kick="${i}">✕</button>` : ''}
        </li>`).join('')}</ul>
        ${r.mode === 4 ? '<p class="muted">Par A (1. i 3. mjesto) igra protiv para B (2. i 4.). Klikni „Sjedni ovdje” da promijeniš mjesto.</p>' : ''}
        ${r.host && !r.isPublic ? `
          <div class="muted" style="margin-bottom:6px">Vrsta igre</div>
          ${seg('roomKind', KINDS, r.kind || 'briskula')}
          ${seg('roomLow', LOWS, r.low ? 1 : 0)}
          ${r.kind === 'treseta' ? seg('roomTarget', [[21, 'Do 21'], [31, 'Do 31'], [41, 'Do 41']], r.target) : ''}`
        : r.kind === 'treseta' ? `<p class="muted">Igra se <b>trešeta</b>${r.low ? ' ' + LOW_NAME + ' (pobjeđuje tko ima manje)' : ''} do ${r.target} bodova.</p>`
        : r.low ? `<p class="muted">Igra se <b>${LOW_NAME}</b>: pobjeđuje tko skupi manje bodova.</p>` : ''}
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
      if (navigator.share) { try { await navigator.share({ title: 'Briškula', text: 'Dođi na partiju ' + (r.kind === 'treseta' ? 'trešete' : 'briškule') + '! Kod: ' + r.code, url }); return; } catch { } }
      try { await navigator.clipboard.writeText(url); toast('Link kopiran'); } catch { toast(url); }
    };
    $app.querySelectorAll('[data-seat]').forEach(b => b.onclick = () => ctrl.send({ type: 'seat', seat: +b.dataset.seat }));
    if (r.host) {
      $app.querySelector('#addBot').onclick = () => ctrl.send({ type: 'addBot' });
      $app.querySelector('#start').onclick = () => ctrl.send({ type: 'start', fillBots: true });
      $app.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => ctrl.send({ type: 'kick', seat: +b.dataset.kick }));
      $app.querySelectorAll('[data-seg="roomKind"] button').forEach(b => b.onclick = () => ctrl.send({ type: 'variant', kind: b.dataset.v, low: !!r.low }));
      $app.querySelectorAll('[data-seg="roomLow"] button').forEach(b => b.onclick = () => ctrl.send({ type: 'variant', kind: r.kind || 'briskula', low: b.dataset.v === '1' }));
      $app.querySelectorAll('[data-seg="roomTarget"] button').forEach(b => b.onclick = () => ctrl.send({ type: 'target', target: +b.dataset.v }));
      $app.querySelectorAll('[data-seg="roomLevel"] button').forEach(b => b.onclick = () => ctrl.send({ type: 'level', level: b.dataset.v }));
    }
  }

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

  let flyTimer = null, enterKeys = new Set();
  function renderGame() {
    const r = room, g = r.game, me = g.you;
    const tre = g.kind === 'treseta';
    const G = engOf(g.kind);
    const myTurn = g.phase === 'play' && g.turn === me;
    const now = Date.now();
    const bubbles = {};
    for (const s of r.signals || []) {
      const t = seenSignals.get(s.id) || 0;
      if (now - t < 4000 && s.from >= 0) bubbles[s.from] = s;
    }
    for (const m of r.chat || []) {
      const t = seenSignals.get(chatKey(r, m)) || 0;
      if (now - t < 4000 && !(bubbles[m.from] && (seenSignals.get(bubbles[m.from].id) || 0) > t)) bubbles[m.from] = { text: m.text.length > 40 ? m.text.slice(0, 40) + '…' : m.text, team: null, chat: true };
    }
    // trešeta: akuže se vide tijekom prvog štiha
    if (tre && g.trickNo <= 1 && g.phase === 'play' && g.akuze && g.akuze.length) {
      for (let p = 0; p < g.mode; p++) {
        const a = g.akuze.filter(x => x.p === p);
        if (a.length && !bubbles[p]) bubbles[p] = { text: 'Akuža: ' + a.map(x => x.text + ' (' + x.pts + ')').join(', '), team: null, akuza: true };
      }
    }
    const sysMsg = (r.signals || []).filter(s => s.from < 0 && now - (seenSignals.get(s.id) || 0) < 5000).pop();

    const plate = (p) => {
      const pl = g.players[p];
      const seat = r.seats[p];
      const off = seat && !seat.bot && !seat.connected;
      const pts = S.showPoints ? `<span class="pts">${ptsText(g, pl.points)}</span>` : `<span class="muted">${pl.wonCount}</span>`;
      const turn = g.phase === 'play' && g.turn === p;
      // avatar s oblačićem poruke iznad njega, pa pločica s imenom i bodovima
      return `<div class="pl pl-${p === me ? 'me' : posOf(p, g)}">${avatar(seat || { name: pl.name }, turn ? 'turn' : '', bubble(p))}<div class="nameplate ${turn ? 'turn' : ''}">
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

    // špil + briškula (u trešeti nema briškule; u dvoje se vuče iz špila)
    let deck;
    if (tre) {
      const myT = E.teamOf(g.mode, me);
      const names = g.mode === 4 ? ['Mi', 'Vi'] : g.players.map((pl, i) => i === me ? 'Ti' : pl.name.replace(/^Bot /, ''));
      const order = g.mode === 4 ? [myT, 1 - myT] : g.players.map((_, i) => (me + i) % g.mode);
      deck = `<div class="tinfo">
        ${g.deckCount > 0 ? `<div class="tdeck"><div class="card sm">${Art.back()}</div><div class="count">${g.deckCount}</div></div>` : ''}
        <div class="tscore"><div class="muted">Ruka ${g.handNo} · do ${g.target}</div>
          ${order.map(t => `<div class="ts"><span>${esc(g.mode === 4 ? names[t === myT ? 0 : 1] : names[t])}</span><b>${g.score[t]}</b></div>`).join('')}
        </div></div>`;
    } else if (g.deckCount > 0) {
      deck = `<div class="deck">
        <div class="card sm trump">${Art.face(g.trump)}</div>
        ${g.deckCount > 1 ? `<div class="card sm pile">${Art.back()}</div>` : ''}
        <div class="count">${g.deckCount}</div></div>`;
    } else {
      deck = `<div class="trumpinfo">${Art.suit(g.trumpSuit, .85)}<span>briškula</span></div>`;
    }

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
    if (g.phase === 'play') status = myTurn ? 'Na potezu si' : 'Igra ' + esc(g.players[g.turn].name) + '…';
    else if (g.phase === 'collect') {
      const w = g.trick[winIdx].p;
      let pts = g.trick.reduce((s, t) => s + G.points(t.card), 0);
      const lastOne = tre && g.deckCount === 0 && g.players.every(pl => pl.handCount === 0);
      if (lastOne) pts += T.LAST_BELE;
      status = (w === me ? 'Tvoj štih' : (g.mode === 4 && w % 2 === me % 2 ? 'Štih za vaš par' : 'Štih nosi ' + esc(g.players[w].name))) + (pts ? ` (+${ptsText(g, pts)})` : '') + (lastOne ? ' · zadnji štih' : '');
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
    if (r.wins && r.wins.some(x => x)) tally = g.mode === 4 ? ` · ${r.wins[me % 2]}:${r.wins[1 - me % 2]}` : ` · pobjede ${r.wins[me]}`;

    $app.innerHTML = `
      <div class="topbar">
        <button class="ghost small" id="leave">←</button>
        <div class="mid">${(g.kind === 'treseta' || g.low ? MODE_SHORT : MODE_NAMES)[g.mode]}${kindLabel(g.kind || 'briskula', g.low)}${r.code ? ' · ' + esc(r.code) : (g.kind === 'treseta' && g.low ? '' : ' · ' + LEVEL_NAMES[r.level])}${tally}</div>
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
      flyTimer = setTimeout(() => { const t = document.getElementById('trick'); if (t) t.className = 'trick fly-' + posOf(w, g); }, 850);
    }
    // osvježi kad mjehurići isteknu
    clearTimeout(renderGame.bt);
    if (Object.keys(bubbles).length || sysMsg) renderGame.bt = setTimeout(() => render(), 4100);
  }

  function confirmLeave() {
    if (window.BRK_OFFLINE) return true;
    return window.confirm(room.local ? 'Prekinuti partiju?' : 'Napustiti igru? Bot će igrati umjesto tebe.');
  }

  function renderModal() {
    let el = document.getElementById('overlay');
    let html = '';
    const g = room && room.game;
    if (modal === 'rules') html = rulesHtml();
    else if (modal === 'settings') html = `<h2>Postavke</h2>
      <label class="chk"><input type="checkbox" id="sp" ${S.showPoints ? 'checked' : ''}> Prikaži bodove tijekom igre</label>
      <label class="chk"><input type="checkbox" id="snd" ${S.sound ? 'checked' : ''}> Zvukovi</label>
      <div class="row" style="margin-top:12px"><button class="ghost" id="rulesB">Pravila</button><button id="close">Zatvori</button></div>`;
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
      <p style="text-align:center">Nosi: <b>${esc(g.players[g.lastTrick.winner].name)}</b> (+${ptsText(g, g.lastTrick.points)})${g.lastTrick.last ? ' · zadnji štih' : ''}</p>
      <button id="close" style="width:100%">Zatvori</button>`;
    else if (g && g.phase === 'over') html = g.kind === 'treseta' ? tresetaResultHtml() : resultHtml();
    else if (g && g.phase === 'hand') html = handEndHtml();
    if (!html) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'overlay'; el.className = 'overlay'; document.body.appendChild(el); }
    el.innerHTML = `<div class="modal">${html}</div>`;
    const c = el.querySelector('#close'); if (c) c.onclick = () => { modal = null; render(); };
    const sp = el.querySelector('#sp'); if (sp) sp.onchange = () => { S.showPoints = sp.checked; save(); render(); };
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

  function resultHtml() {
    const r = room, g = r.game, res = g.result, me = g.you;
    const myTeam = E.teamOf(g.mode, me);
    const won = !res.draw && res.winners.includes(me);
    const title = res.draw ? 'Neriješeno!' : won ? (g.mode === 4 ? 'Pobijedili ste!' : 'Pobijedio/la si!') : (g.mode === 4 ? 'Izgubili ste' : 'Izgubio/la si');
    const rows = res.scores.slice().sort((a, b) => g.low ? a.points - b.points : b.points - a.points).map(s => {
      const names = s.players.map(p => esc(g.players[p].name)).join(' & ');
      const mine = s.players.includes(me);
      return `<tr class="${!res.draw && res.winners.join() === s.players.join() ? 'win' : ''}"><td>${names}${mine ? ' (ti)' : ''}</td><td>${s.points}</td></tr>`;
    }).join('');
    const tally = g.mode === 4 ? `Ukupno partija: <b>${r.wins[myTeam]} : ${r.wins[1 - myTeam]}</b>` : 'Pobjede: ' + r.seats.map((s, i) => esc(s.name) + ' ' + r.wins[i]).join(' · ');
    const canRestart = r.local || r.host;
    const lowNote = !g.low ? '' : res.kapot
      ? `<p style="text-align:center"><b>Kapot!</b> ${esc(res.winners.map(p => g.players[p].name).join(' & '))} ${res.winners.length > 1 ? 'su pokupili' : 'je pokupio/la'} svih 120 bodova i pobjeđuje.</p>`
      : `<p class="muted" style="text-align:center">${LOW_NAME}: pobjeđuje tko ima manje bodova.</p>`;
    return `<div class="result-big">${title}</div>
      ${lowNote}
      <table class="scores">${rows}</table>
      <p class="muted" style="text-align:center">${tally}</p>
      ${canRestart ? '<button id="again" style="width:100%">Nova partija</button>' : '<p class="muted" style="text-align:center">Čeka se domaćin za novu partiju…</p>'}
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
    const canGo = r.local || r.host;
    return `<h2>Kraj ${hr.handNo}. ruke</h2>
      <table class="scores hand-table"><tr class="th"><td></td><td>Karte</td><td>Zadnji</td>${ak ? '<td>Akuže</td>' : ''}<td>Ruka</td><td>Ukupno</td></tr>${rows}</table>
      <p class="muted" style="text-align:center">${hr.teams.some(t => t.kapot) ? '<b>Kapot!</b> Tko pokupi sve bodove dobije 0, a ostali po 11. ' : ''}${tie ? 'Izjednačeno – igra se još jedna ruka.' : g.low ? `${LOW_NAME}: kad netko dođe do ${g.target}, pobjeđuje tko ima najmanje.` : `Igra se do ${g.target} bodova.`} Bele (trećine) koje ne čine cijeli bod se ne broje.</p>
      ${canGo ? '<button id="nextHand" style="width:100%">Sljedeća ruka</button>' : '<p class="muted" style="text-align:center">Sljedeća ruka počinje za nekoliko sekundi…</p>'}`;
  }
  function tresetaResultHtml() {
    const r = room, g = r.game, res = g.result, me = g.you;
    const myTeam = E.teamOf(g.mode, me);
    const won = res.winners.includes(me);
    const title = won ? (g.mode === 4 ? 'Pobijedili ste!' : 'Pobijedio/la si!') : (g.mode === 4 ? 'Izgubili ste' : 'Izgubio/la si');
    const rows = res.scores.slice().sort((a, b) => g.low ? a.points - b.points : b.points - a.points).map(s =>
      `<tr class="${res.winners.join() === s.players.join() ? 'win' : ''}"><td>${teamName(g, s.team, me)}</td><td>${s.points}</td></tr>`).join('');
    const n = res.scores.length;
    const head = res.scores.map(s => `<td>${g.mode === 4 ? (s.team === myTeam ? 'Mi' : 'Vi') : esc(g.players[s.team].name.replace(/^Bot /, ''))}</td>`).join('');
    const hist = res.hands.map(h => `<tr><td>${h.handNo}.</td>${h.points.map((p, t) => `<td>${p} <span class="muted">(${h.score[t]})</span></td>`).join('')}</tr>`).join('');
    const tally = g.mode === 4 ? `Ukupno partija: <b>${r.wins[myTeam]} : ${r.wins[1 - myTeam]}</b>` : 'Pobjede: ' + r.seats.map((s, i) => esc(s.name) + ' ' + r.wins[i]).join(' · ');
    const canRestart = r.local || r.host;
    return `<div class="result-big">${title}</div>
      ${g.low ? `<p class="muted" style="text-align:center">${LOW_NAME}: pobjeđuje tko ima manje bodova.</p>` : ''}
      <table class="scores">${rows}</table>
      <details class="hist"><summary class="muted">Bodovi po rukama</summary>
        <table class="scores small"><tr class="th"><td>Ruka</td>${head}</tr>${hist}</table></details>
      <p class="muted" style="text-align:center">${tally}</p>
      ${canRestart ? '<button id="again" style="width:100%">Nova partija</button>' : '<p class="muted" style="text-align:center">Čeka se domaćin za novu partiju…</p>'}
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
    if ((room ? room.kind : S.kind) === 'treseta') return tresetaRulesHtml();
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
  window.__brk = { get room() { return room; }, get ctrl() { return ctrl; } };
})();
