/* Briškula – klijent */
(function () {
  'use strict';
  const E = window.BriskulaEngine, B = window.BriskulaBot, Art = window.CardArt;
  const $app = document.getElementById('app');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MODE_NAMES = { 2: 'Dvoje', 3: 'Troje', 4: 'Parovi (2 na 2)' };
  const LEVEL_NAMES = { easy: 'Lako', normal: 'Srednje', hard: 'Teško' };
  const LOW_NAME = 'Chi fa meno';

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
    low: store.get('low', false), // "Chi fa meno": pobjeđuje tko ima manje bodova
  };
  function save() { for (const k in S) store.set(k, S[k]); }

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
  const sfx = { play: () => beep(420, .08), win: () => { beep(660, .12); setTimeout(() => beep(880, .18), 110); }, turn: () => beep(520, .1, 'sine') };

  // ---------- lokalna igra protiv botova ----------
  class LocalGame {
    constructor(mode, level, name, low) {
      this.mode = mode; this.level = level; this.local = true; this.low = !!low;
      const botNames = ['Jure', 'Mare', 'Ante', 'Luce', 'Frane', 'Tonka'].sort(() => Math.random() - .5);
      this.names = [name || 'Ti'].concat(botNames.slice(0, mode - 1).map(n => 'Bot ' + n));
      this.wins = Array(mode === 4 ? 2 : mode).fill(0);
      this.signals = []; this.dealer = Math.floor(Math.random() * mode) - 1;
      this.start();
    }
    start() {
      this.dealer = (this.dealer + 1) % this.mode;
      this.st = E.newGame(this.mode, { names: this.names, bots: this.names.map((_, i) => i > 0), dealer: this.dealer, low: this.low });
      this.signals = [];
      this.emit(); this.schedule();
    }
    view() {
      return {
        type: 'room', local: true, code: null, mode: this.mode, level: this.level, low: this.low, host: true, you: 0, wins: this.wins,
        seats: this.names.map((n, i) => ({ name: n, bot: i > 0, connected: true })),
        game: E.viewFor(this.st, 0), signals: this.signals.slice(-6),
      };
    }
    emit() { onRoom(this.view()); }
    schedule() {
      clearTimeout(this.timer);
      const st = this.st;
      if (st.phase === 'collect') this.timer = setTimeout(() => {
        E.collect(st);
        if (st.phase === 'over' && !st.result.draw) this.wins[E.teamOf(this.mode, st.result.winners[0])]++;
        this.emit(); this.schedule();
      }, 1350);
      else if (st.phase === 'play' && st.turn !== 0) this.timer = setTimeout(() => {
        const c = B.choose(E.viewFor(st, st.turn), this.level);
        E.play(st, st.turn, c); this.emit(); this.schedule();
      }, 650 + Math.random() * 450);
    }
    play(c) { if (E.play(this.st, 0, c)) { this.emit(); this.schedule(); } }
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
        ws.send(JSON.stringify({ type: 'hello', token: this.token, name: S.name }));
        const q = this.q; this.q = []; q.forEach(m => ws.send(JSON.stringify(m)));
        render();
      };
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.type === 'welcome') { this.token = m.token; store.set('token', m.token); }
        else if (m.type === 'room') { if (ctrl === this) onRoom(m); }
        else if (m.type === 'left') { if (ctrl === this) { room = null; render(); } }
        else if (m.type === 'error') toast(m.msg);
      };
      ws.onclose = () => { this.ok = false; if (ctrl === this && room) render(); this.later(); };
    }
    later() { if (!this.alive) return; this.retry++; setTimeout(() => this.connect(), Math.min(8000, 500 * this.retry)); }
    send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); else this.q.push(m); }
    play(c) { this.send({ type: 'play', card: c }); }
    signal(text, team) { this.send({ type: 'signal', text, team }); }
    rematch() { this.send({ type: 'start' }); }
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
    render();
  }

  // ---------- prikaz ----------
  function render() {
    if (!room) renderMenu();
    else if (!room.game) renderLobby();
    else renderGame();
    renderModal();
  }

  function seg(name, opts, val) {
    return `<div class="seg" data-seg="${name}">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  }

  function renderMenu() {
    const fan = ['kupe-1', 'spade-13', 'dinari-3', 'bate-12'].map((c, i) => `<div style="transform: rotate(${(i - 1.5) * 12}deg) translateY(${Math.abs(i - 1.5) * 6}px)">${Art.face(c)}</div>`).join('');
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
    $app.innerHTML = `<div class="menu home">
      <div class="logo"><div class="fan">${fan}</div><h1>Briškula</h1></div>
      <div class="panel"><h2 class="desk-only">Tvoje ime</h2><input id="name" maxlength="20" placeholder="Tvoje ime" value="${esc(S.name)}"></div>
      <div class="panel">
        <h2>Vrsta igre</h2>
        ${seg('low', [[0, 'Briškula'], [1, LOW_NAME]], S.low ? 1 : 0)}
        <p class="muted" style="margin:0">${S.low ? LOW_NAME + ': pobjeđuje tko skupi <b>manje</b> bodova.' : 'Klasična briškula: pobjeđuje tko skupi više bodova.'}</p>
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
    bindSegs();
    const needName = () => { if (!S.name) { S.name = 'Igrač' + Math.floor(Math.random() * 900 + 100); save(); } };
    $app.querySelector('#playBots').onclick = () => { needName(); ctrl = new LocalGame(+S.botMode, S.botLevel, S.name, S.low); };
    if (!window.BRK_OFFLINE) {
    $app.querySelector('#create').onclick = () => { needName(); ctrl = getNet(); ctrl.send({ type: 'setName', name: S.name }); ctrl.send({ type: 'create', mode: +S.onMode, level: 'normal', low: S.low }); };
    $app.querySelector('#quick').onclick = () => { needName(); ctrl = getNet(); ctrl.send({ type: 'setName', name: S.name }); ctrl.send({ type: 'quick', mode: +S.onMode, low: S.low }); };
    const join = () => {
      const c = $app.querySelector('#code').value.trim().toUpperCase();
      if (c.length < 4) return toast('Upiši kod sobe');
      needName(); ctrl = getNet(); ctrl.send({ type: 'setName', name: S.name }); ctrl.send({ type: 'join', code: c });
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
        S[k] = k === 'low' ? v === '1' : /^\d+$/.test(v) ? +v : v; save(); render();
      });
    });
  }

  function link() { return location.origin + location.pathname + '?soba=' + room.code; }

  function renderLobby() {
    const r = room;
    const full = r.seats.every(Boolean);
    const conn = net && net.ok;
    $app.innerHTML = `<div class="menu">
      <div class="topbar"><button class="ghost small" id="leave">← Izlaz</button><div class="mid">${MODE_NAMES[r.mode]}${r.low ? ' · ' + LOW_NAME : ''}${r.isPublic ? ' · javna igra' : ''}</div></div>
      <div class="panel" style="text-align:center">
        <div class="muted">Kod sobe</div>
        <div class="code">${esc(r.code)}</div>
        ${r.isPublic ? '' : '<button id="share" class="ghost small">Pošalji poziv</button>'}
        ${conn ? '' : '<p class="muted">Spajanje na server…</p>'}
      </div>
      <div class="panel">
        <h2>Igrači</h2>
        <ul class="seats">${r.seats.map((s, i) => `<li>
          ${r.mode === 4 ? `<span class="tag team${i % 2}">${i % 2 ? 'Par B' : 'Par A'}</span>` : ''}
          <span class="n">${s ? esc(s.name) + (i === r.you ? ' (ti)' : '') : '<span class="muted">čeka se igrač…</span>'}</span>
          ${s && s.bot ? '<span class="tag">bot</span>' : ''}
          ${s && !s.bot && !s.connected ? '<span class="tag">odspojen</span>' : ''}
          ${(!s || s.bot) && i !== r.you ? `<button class="ghost small" data-seat="${i}">Sjedni ovdje</button>` : ''}
          ${r.host && s && s.bot ? `<button class="ghost small" data-kick="${i}">✕</button>` : ''}
        </li>`).join('')}</ul>
        ${r.mode === 4 ? '<p class="muted">Par A (1. i 3. mjesto) igra protiv para B (2. i 4.). Klikni „Sjedni ovdje” da promijeniš mjesto.</p>' : ''}
        ${r.host && !r.isPublic ? `
          <div class="muted" style="margin-bottom:6px">Vrsta igre</div>
          ${seg('roomLow', [[0, 'Briškula'], [1, LOW_NAME]], r.low ? 1 : 0)}` : r.low ? `<p class="muted">Igra se <b>${LOW_NAME}</b>: pobjeđuje tko skupi manje bodova.</p>` : ''}
        ${r.host ? `
          <div class="muted" style="margin-bottom:6px">Jačina botova</div>
          ${seg('roomLevel', [['easy', 'Lako'], ['normal', 'Srednje'], ['hard', 'Teško']], r.level)}
          <div class="row"><button class="ghost" id="addBot" ${full ? 'disabled' : ''}>+ Dodaj bota</button>
          <button id="start">${full ? 'Započni igru' : 'Započni (botovi popune)'}</button></div>`
        : `<p class="muted" style="text-align:center">Čekamo da domaćin pokrene igru…</p>`}
      </div>
    </div>`;
    $app.querySelector('#leave').onclick = leave;
    const sh = $app.querySelector('#share');
    if (sh) sh.onclick = async () => {
      const url = link();
      if (navigator.share) { try { await navigator.share({ title: 'Briškula', text: 'Dođi na partiju briškule! Kod: ' + r.code, url }); return; } catch { } }
      try { await navigator.clipboard.writeText(url); toast('Link kopiran'); } catch { toast(url); }
    };
    $app.querySelectorAll('[data-seat]').forEach(b => b.onclick = () => ctrl.send({ type: 'seat', seat: +b.dataset.seat }));
    if (r.host) {
      $app.querySelector('#addBot').onclick = () => ctrl.send({ type: 'addBot' });
      $app.querySelector('#start').onclick = () => ctrl.send({ type: 'start', fillBots: true });
      $app.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => ctrl.send({ type: 'kick', seat: +b.dataset.kick }));
      $app.querySelectorAll('[data-seg="roomLow"] button').forEach(b => b.onclick = () => ctrl.send({ type: 'variant', low: b.dataset.v === '1' }));
      $app.querySelectorAll('[data-seg="roomLevel"] button').forEach(b => b.onclick = () => ctrl.send({ type: 'level', level: b.dataset.v }));
    }
  }

  function leave() {
    if (ctrl) ctrl.leave();
    ctrl = null; room = null; modal = null;
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

  function suitOrder(T) { return s => (s === T ? 10 : 0) + E.SUITS.indexOf(s); }
  function sortHand(h, T) {
    const so = suitOrder(T);
    return h.slice().sort((a, b) => so(E.suitOf(a)) - so(E.suitOf(b)) || E.strength(a) - E.strength(b));
  }

  let flyTimer = null, enterKeys = new Set();
  function renderGame() {
    const r = room, g = r.game, me = g.you;
    const myTurn = g.phase === 'play' && g.turn === me;
    const now = Date.now();
    const bubbles = {};
    for (const s of r.signals || []) {
      const t = seenSignals.get(s.id) || 0;
      if (now - t < 4000 && s.from >= 0) bubbles[s.from] = s;
    }
    const sysMsg = (r.signals || []).filter(s => s.from < 0 && now - (seenSignals.get(s.id) || 0) < 5000).pop();

    const plate = (p) => {
      const pl = g.players[p];
      const seat = r.seats[p];
      const off = seat && !seat.bot && !seat.connected;
      const pts = S.showPoints ? `<span class="pts">${pl.points}</span>` : `<span class="muted">${pl.wonCount}</span>`;
      return `<div class="nameplate ${g.phase === 'play' && g.turn === p ? 'turn' : ''}">
        ${g.mode === 4 ? `<span class="dot t${p % 2}"></span>` : ''}${esc(pl.name)}${off ? ' <span class="off">⚠</span>' : ''} ${pts}</div>`;
    };
    const bubble = p => bubbles[p] ? `<div class="bubble ${bubbles[p].team != null ? 'team' : ''}">${esc(bubbles[p].text)}</div>` : '';

    let seats = '';
    for (let p = 0; p < g.mode; p++) {
      if (p === me) continue;
      const pos = posOf(p, g);
      const isPartner = g.mode === 4 && (p - me + 4) % 4 === 2;
      let cards;
      if (isPartner && g.partnerHand) cards = `<div class="partner-hand">${sortHand(g.partnerHand, g.trumpSuit).map(c => `<div class="card sm">${Art.face(c)}</div>`).join('')}</div>`;
      else cards = `<div class="backs">${Array.from({ length: g.players[p].handCount }, () => `<div class="card sm">${Art.back()}</div>`).join('')}</div>`;
      seats += `<div class="seat ${pos}">${pos === 'top' ? cards + plate(p) : plate(p) + cards}${bubble(p)}</div>`;
    }

    // špil + briškula
    let deck;
    if (g.deckCount > 0) {
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
    if (g.phase === 'collect') winIdx = E.trickWinnerIndex(g.trick, g.trumpSuit);
    const newKeys = new Set();
    const trickHtml = showTrick.map((t, i) => {
      const key = g.trickNo + ':' + t.p;
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
      const pts = g.trick.reduce((s, t) => s + E.points(t.card), 0);
      status = (w === me ? 'Tvoj štih' : (g.mode === 4 && w % 2 === me % 2 ? 'Štih za vaš par' : 'Štih nosi ' + esc(g.players[w].name))) + (pts ? ` (+${pts})` : '');
    }
    if (sysMsg) status = esc(sysMsg.text);

    const hand = sortHand(g.hand, g.trumpSuit);
    const handHtml = hand.map(c => `<div class="card ${myTurn ? 'playable' : ''} ${E.suitOf(c) === g.trumpSuit ? 'trumpcard' : ''}" data-card="${c}">${Art.face(c)}</div>`).join('');

    const sigs = g.phase === 'over' ? '' : `<div class="signals">
      ${g.mode === 4 ? ['Imam briškulu', 'Nemam briškulu', 'Imam asa', 'Imam tricu'].concat(g.low ? ['Nosim ja', 'Ne mogu pustiti'] : ['Karikaj!', 'Ne karikaj']).map(t => `<button class="team" data-sig="${t}" data-team="1">${t}</button>`).join('') : ''}
      ${['👍', '😂', '😮', '🙈', '😤'].map(t => `<button class="ghost" data-sig="${t}">${t}</button>`).join('')}
    </div>`;

    let tally = '';
    if (r.wins && r.wins.some(x => x)) tally = g.mode === 4 ? ` · ${r.wins[me % 2]}:${r.wins[1 - me % 2]}` : ` · pobjede ${r.wins[me]}`;

    $app.innerHTML = `
      <div class="topbar">
        <button class="ghost small" id="leave">←</button>
        <div class="mid">${MODE_NAMES[g.mode]}${g.low ? ' · ' + LOW_NAME : ''}${r.code ? ' · ' + esc(r.code) : ' · ' + LEVEL_NAMES[r.level]}${tally}</div>
        <button class="ghost small" id="last" ${g.lastTrick ? '' : 'disabled'}>Zadnji štih</button>
        <button class="ghost small" id="menuBtn">⚙</button>
      </div>
      <div class="table mode${g.mode} ${g.mode >= 3 ? 'has-left' : ''}">
        ${seats}${deck}
        <div class="trick" id="trick">${trickHtml}</div>
        <div class="status">${status}</div>
      </div>
      <div class="me">${bubble(me)}
        <div class="hand ${myTurn ? 'myturn' : ''}">${handHtml}</div>
        <div>${plate(me)}</div>
        ${sigs}
      </div>`;

    $app.querySelector('#leave').onclick = () => { if (g.phase === 'over' || confirmLeave()) leave(); };
    $app.querySelector('#last').onclick = () => { modal = 'last'; render(); };
    $app.querySelector('#menuBtn').onclick = () => { modal = 'settings'; render(); };
    $app.querySelectorAll('.hand .card.playable').forEach(el => el.onclick = () => {
      el.style.transform = 'translateY(-30px)';
      ctrl.play(el.dataset.card);
    });
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
    else if (modal === 'last' && g && g.lastTrick) html = `<h2>Zadnji štih</h2>
      <div class="lasttrick">${g.lastTrick.cards.map(t => `<div style="text-align:center"><div class="card">${Art.face(t.card)}</div><div class="muted">${esc(g.players[t.p].name)}</div></div>`).join('')}</div>
      <p style="text-align:center">Nosi: <b>${esc(g.players[g.lastTrick.winner].name)}</b> (+${g.lastTrick.points})</p>
      <button id="close" style="width:100%">Zatvori</button>`;
    else if (g && g.phase === 'over') html = resultHtml();
    if (!html) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'overlay'; el.className = 'overlay'; document.body.appendChild(el); }
    el.innerHTML = `<div class="modal">${html}</div>`;
    const c = el.querySelector('#close'); if (c) c.onclick = () => { modal = null; render(); };
    const sp = el.querySelector('#sp'); if (sp) sp.onchange = () => { S.showPoints = sp.checked; save(); render(); };
    const snd = el.querySelector('#snd'); if (snd) snd.onchange = () => { S.sound = snd.checked; save(); };
    const rb = el.querySelector('#rulesB'); if (rb) rb.onclick = () => { modal = 'rules'; render(); };
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

  function rulesHtml() {
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
    ctrl = getNet(); ctrl.send({ type: 'setName', name: S.name }); ctrl.send({ type: 'join', code: joinCode.toUpperCase() });
  } else if (store.get('token', null)) {
    // ponovno spajanje u igru koja je u tijeku (npr. nakon osvježavanja)
    ctrl = getNet();
  }
  window.__brk = { get room() { return room; }, get ctrl() { return ctrl; } };
})();
