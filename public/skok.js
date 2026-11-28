/* Skakavac – igra skakanja po platformama prema nebu.
 * Zeleni skakavac skače s grančice na grančicu (pa po oblacima i zvijezdama), ekran se diže sve brže,
 * a skokovi preko više katova zaredom (kombo) nose dodatne bodove.
 * Dio "Engine" (newGame/step) je čist i radi i u Nodeu (test/skok.js); "Play" crta na canvas u pregledniku. */
(function () {
  'use strict';
  const W = 480;            // širina svijeta (logičke jedinice)
  const WALL = 26;          // debljina stabljike sa strane
  const FH = 74;            // razmak između katova
  const PW = 26, PH = 34;   // skakavac
  const G = 0.72, VY_MAX = 18;
  const VX_MAX = 10, ACC_G = 0.55, ACC_A = 0.4;
  const JUMP0 = 12.5, JUMP_K = 0.95; // brzina skoka = JUMP0 + |vx| * JUMP_K (zalet = viši skok)
  const COMBO_T = 180;      // kombo traje 3 s od zadnjeg dobrog skoka
  const START_FLOOR = 5;    // ekran se počne dizati kad dođeš do 5. kata
  const LEVEL_T = 30 * 60;  // svakih 30 s brže
  const MAX_LEVEL = 8;
  const speedOf = lv => lv <= 0 ? 0 : 1 + (lv - 1) * 0.3; // jedinica po sličici
  const ZONES = [
    { from: 0, name: 'Livada', sky: ['#bfe8ff', '#eafaff'], plat: 'grass' },
    { from: 50, name: 'Krošnje', sky: ['#7cc6e6', '#d4f2d0'], plat: 'wood' },
    { from: 100, name: 'Oblaci', sky: ['#4f8fd8', '#bcdcff'], plat: 'cloud' },
    { from: 150, name: 'Sumrak', sky: ['#3b2f6e', '#f29a6b'], plat: 'reed' },
    { from: 200, name: 'Zvijezde', sky: ['#0b0f2a', '#2a2f6a'], plat: 'star' },
    { from: 300, name: 'Svemir', sky: ['#000008', '#1a0b33'], plat: 'crystal' },
  ];
  const zoneOf = f => { let z = ZONES[0]; for (const x of ZONES) if (f >= x.from) z = x; return z; };

  // ---------- slučajni brojevi: platforme se računaju iz sjemena i broja kata (ne treba ih pamtiti) ----------
  function hash(a) {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  /** platforma na katu i: { i, y (vrh), x0, x1 } */
  function plat(g, i) {
    const L = WALL, R = W - WALL;
    let p = g.plats.get(i);
    if (p) return p.kind === 'move' ? movePlat(g, p) : p;
    if (i === 0 || i % 50 === 0) p = { i, x0: L, x1: R };
    else {
      const r1 = hash(g.seed * 7919 + i * 31), r2 = hash(g.seed * 104729 + i * 17 + 3);
      const wBase = Math.max(78, 230 - i * 0.55);
      const w = Math.min(R - L, wBase + (r1 - 0.5) * 70);
      const x0 = L + r2 * (R - L - w);
      p = { i, x0, x1: x0 + w, w, kind: 'n' };
      // prepreke: od 40. kata grančice koje se slome, od 60. pomične
      const r3 = hash(g.seed * 31337 + i * 13 + 7);
      const pm = i >= 60 ? Math.min(0.25, 0.08 + (i - 60) * 0.002) : 0, pc = i >= 40 ? Math.min(0.3, 0.1 + (i - 40) * 0.003) : 0;
      if (r3 < pm) { p.kind = 'move'; p.ph = r3 * 60; p.sp = 0.012 + hash(i * 3 + g.seed) * 0.012; }
      else if (r3 >= pm && r3 < pm + pc) p.kind = 'crumble';
      // dodaci: zvjezdica (+25) ili gljiva-opruga (super skok)
      const r4 = hash(g.seed * 4241 + i * 19 + 11);
      if (i >= 15 && r4 < 0.05) p.item = { t: 'spring', f: 0.2 + hash(i * 7 + 1) * 0.6 };
      else if (i >= 6 && r4 < 0.24) p.item = { t: 'star', f: 0.15 + hash(i * 5 + 2) * 0.7 };
      // neprijatelji: ose lete lijevo-desno između katova (od 25. kata, sve češće)
      const r5 = hash(g.seed * 977 + i * 23 + 5);
      if (i >= 25 && r5 < Math.min(0.3, 0.06 + i * 0.0012)) p.wasp = { ph: r5 * 80, sp: 0.018 + hash(i * 11 + 4) * 0.02 };
    }
    p.y = -i * FH;
    g.plats.set(i, p);
    if (g.plats.size > 400) for (const k of g.plats.keys()) { if (k < i - 60 || k > i + 60) g.plats.delete(k); if (g.plats.size < 200) break; }
    return p.kind === 'move' ? movePlat(g, p) : p;
  }
  function movePlat(g, p) {
    const L = WALL, R = W - WALL;
    if (p.tu !== g.t) {
      // pomična grančica: klizi po cijeloj širini; dx = pomak u ovoj sličici (nosi skakavca)
      const x0 = L + (R - L - p.w) * (0.5 + 0.5 * Math.sin(g.t * p.sp + p.ph));
      p.dx = p.tu == null ? 0 : x0 - p.x0; p.x0 = x0; p.x1 = x0 + p.w; p.tu = g.t;
    }
    return p;
  }
  /** položaj ose na katu i (između kata i i i+1) */
  function waspPos(g, p) {
    const L = WALL + 18, R = W - WALL - 18;
    return { x: L + (R - L) * (0.5 + 0.5 * Math.sin(g.t * p.wasp.sp + p.wasp.ph)), y: p.y - FH * 0.55, dir: Math.cos(g.t * p.wasp.sp + p.wasp.ph) >= 0 ? 1 : -1 };
  }
  const itemX = p => p.x0 + (p.x1 - p.x0) * p.item.f;
  const SPRING_V = 30;

  function newGame(seed, viewH) {
    return {
      seed: seed >>> 0 || 1, viewH: viewH || 760, plats: new Map(),
      x: W / 2, y: 0, vx: 0, vy: 0, ground: true, floor: 0, face: 1, rot: 0,
      cam: -(viewH || 760) + 90, // vrh pogleda (y prema gore je negativan)
      t: 0, startT: -1, level: 0, maxFloor: 0, bonus: 0,
      combo: { jumps: 0, floors: 0, timer: 0 }, bestCombo: 0, combos: 0,
      over: false, events: [], prevJ: false, stars: 0, inv: 0, hits: 0, springs: 0,
    };
  }
  const score = g => g.maxFloor * 10 + g.bonus;

  function endCombo(g) {
    const c = g.combo;
    if (c.jumps >= 2) {
      const b = c.floors * c.floors;
      g.bonus += b; g.combos++;
      if (c.floors > g.bestCombo) g.bestCombo = c.floors;
      g.events.push({ e: 'combo', jumps: c.jumps, floors: c.floors, bonus: b });
    }
    c.jumps = 0; c.floors = 0; c.timer = 0;
  }

  /** jedna sličica (1/60 s); inp = { l, r, j } (j = skok držan) */
  function step(g, inp) {
    if (g.over) return g;
    g.t++;
    // inp.ax (-1..1) = upravljanje prstom (jačina), inače tipke lijevo/desno
    const dir = typeof inp.ax === 'number' ? Math.max(-1, Math.min(1, inp.ax)) : (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    if (dir) { g.vx += dir * (g.ground ? ACC_G : ACC_A); g.face = dir > 0 ? 1 : -1; }
    else if (g.ground) { g.vx *= 0.8; if (Math.abs(g.vx) < 0.05) g.vx = 0; }
    else g.vx *= 0.995;
    if (g.vx > VX_MAX) g.vx = VX_MAX; else if (g.vx < -VX_MAX) g.vx = -VX_MAX;
    // skok (držanje tipke skače čim dotakne tlo)
    if (g.ground && inp.j) {
      g.vy = -(JUMP0 + Math.abs(g.vx) * JUMP_K);
      g.ground = false; g.jumpFrom = g.floor;
      g.events.push({ e: 'jump', big: Math.abs(g.vx) > 7 });
    }
    g.prevJ = !!inp.j;
    // vodoravno + odbijanje od stabljika
    g.x += g.vx;
    const L = WALL + PW / 2, R = W - WALL - PW / 2;
    if (g.x < L || g.x > R) {
      g.x = g.x < L ? L : R;
      if (Math.abs(g.vx) > 2.5) { g.vx = -g.vx * 0.92; g.events.push({ e: 'wall' }); } else g.vx = 0;
    }
    // okomito
    if (!g.ground) {
      g.vy = Math.min(VY_MAX, g.vy + G);
      const py = g.y;
      g.y += g.vy;
      if (g.vy > 0) {
        // je li prošao kroz vrh neke platforme (odozgo)? vy < FH pa je najviše jedna
        const i = Math.floor(-py / FH);
        if (i >= 0) {
          const p = plat(g, i);
          if (!p.gone && py <= p.y && g.y >= p.y && g.x + PW * 0.35 > p.x0 && g.x - PW * 0.35 < p.x1) land(g, p);
        }
      }
      if (g.combo.jumps && !g.ground) g.rot += g.vx >= 0 ? 0.28 : -0.28;
    } else {
      const p = plat(g, g.floor);
      if (p.kind === 'move') g.x = Math.max(L, Math.min(R, g.x + p.dx));
      if (p.gone || g.x + PW * 0.35 < p.x0 || g.x - PW * 0.35 > p.x1) { g.ground = false; g.vy = 0; g.jumpFrom = g.floor; }
    }
    // grančice koje se lome: 0,7 s nakon doskoka padnu
    for (let i = Math.max(1, g.floor - 2); i <= g.floor + 1; i++) {
      const p = plat(g, i);
      if (p.crumbleAt != null && !p.gone && g.t - p.crumbleAt > 42) { p.gone = true; g.events.push({ e: 'crumble', i }); }
    }
    // zvjezdice i ose u blizini
    if (g.inv > 0) g.inv--;
    const f0 = Math.max(0, Math.floor(-g.y / FH) - 2), f1 = f0 + 6;
    for (let i = f0; i <= f1; i++) {
      const p = plat(g, i);
      if (p.item && p.item.t === 'star' && !p.item.got) {
        const sx = itemX(p), sy = p.y - 24;
        if (Math.abs(sx - g.x) < 22 && sy > g.y - PH - 14 && sy < g.y + 10) { p.item.got = true; g.stars++; g.bonus += 25; g.events.push({ e: 'star', x: sx, y: sy }); }
      }
      if (p.wasp && !g.inv) {
        const w = waspPos(g, p);
        if (Math.abs(w.x - g.x) < PW * 0.5 + 10 && w.y > g.y - PH - 10 && w.y < g.y + 8) {
          // ubod: skakavca odbaci dolje i u stranu, kombo propada
          g.inv = 70; g.hits++;
          g.vx = (g.x < w.x ? -1 : 1) * 5; if (!g.ground) g.vy = Math.max(g.vy, 4);
          if (g.combo.jumps) { g.combo.jumps = 0; g.combo.floors = 0; g.combo.timer = 0; g.events.push({ e: 'comboLost' }); }
          g.events.push({ e: 'hit', x: w.x, y: w.y });
        }
      }
    }
    // kombo istječe
    if (g.combo.jumps && --g.combo.timer <= 0) endCombo(g);
    // kamera: diže se sama od 5. kata, sve brže; i prati skakavca kad je visoko
    if (g.startT < 0 && g.maxFloor >= START_FLOOR) { g.startT = g.t; g.level = 1; g.events.push({ e: 'start' }); }
    if (g.startT >= 0) {
      const lv = Math.min(MAX_LEVEL, 1 + Math.floor((g.t - g.startT) / LEVEL_T));
      if (lv > g.level) { g.level = lv; g.events.push({ e: 'faster', level: lv }); }
      g.cam -= speedOf(g.level);
    }
    const top = g.y - PH - g.viewH * 0.32;
    if (top < g.cam) g.cam += (top - g.cam) * 0.2;
    // prije nego se ekran počne sam dizati, kamera se može i spustiti (nema pada s ekrana)
    if (g.startT < 0 && g.y + 90 > g.cam + g.viewH) g.cam = g.y + 90 - g.viewH;
    // pad ispod dna ekrana = kraj
    if (g.y - PH > g.cam + g.viewH) {
      if (g.combo.jumps) endCombo(g);
      g.over = true; g.events.push({ e: 'over' });
    }
    return g;
  }
  function land(g, p) {
    g.y = p.y; g.vy = 0; g.ground = true; g.rot = 0;
    const diff = p.i - g.floor;
    g.floor = p.i;
    if (p.i > g.maxFloor) g.maxFloor = p.i;
    if (diff >= 2) {
      g.combo.jumps++; g.combo.floors += diff; g.combo.timer = COMBO_T;
    } else if (g.combo.jumps) endCombo(g);
    g.events.push({ e: 'land', diff, floor: p.i });
    if (p.kind === 'crumble' && p.crumbleAt == null) p.crumbleAt = g.t;
    // gljiva-opruga: odbaci jako visoko
    if (p.item && p.item.t === 'spring' && Math.abs(itemX(p) - g.x) < 22) {
      g.vy = -SPRING_V; g.ground = false; g.jumpFrom = p.i; g.springs++;
      g.events.push({ e: 'spring' });
    }
  }

  const Engine = { waspPos, itemX, SPRING_V, W, WALL, FH, PW, PH, COMBO_T, START_FLOOR, LEVEL_T, MAX_LEVEL, ZONES, zoneOf, speedOf, newGame, step, plat, score };

  // ================= crtanje i upravljanje (samo u pregledniku) =================
  function lerpHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = s => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }
  function skyAt(f) {
    // glatki prijelaz neba između zona (zadnjih 15 katova zone)
    let zi = 0; ZONES.forEach((z, i) => { if (f >= z.from) zi = i; });
    const z = ZONES[zi], n = ZONES[zi + 1];
    if (!n) return z.sky;
    const t = Math.max(0, Math.min(1, (f - (n.from - 15)) / 15));
    return [lerpHex(z.sky[0], n.sky[0], t), lerpHex(z.sky[1], n.sky[1], t)];
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawPlat(ctx, p, sy, t) {
    if (p.gone) return;
    const z = zoneOf(p.i);
    let x = p.x0;
    const w = p.x1 - p.x0, big = p.i % 50 === 0;
    ctx.save();
    if (p.crumbleAt != null) { const k = (t - p.crumbleAt) / 42; x += Math.sin(t * 1.7) * 2.5 * k; sy += k * k * 10; ctx.globalAlpha = Math.max(0.15, 1 - k * 0.8); }
    switch (z.plat) {
      case 'grass':
        ctx.fillStyle = '#8a5a2b'; rr(ctx, x, sy, w, 16, 6); ctx.fill();
        ctx.fillStyle = '#5fbf3a'; rr(ctx, x - 2, sy - 3, w + 4, 9, 5); ctx.fill();
        ctx.fillStyle = '#7fdc52'; for (let k = x + 6; k < x + w - 4; k += 14) { ctx.beginPath(); ctx.moveTo(k, sy - 2); ctx.lineTo(k + 3, sy - 8); ctx.lineTo(k + 6, sy - 2); ctx.fill(); }
        break;
      case 'wood':
        ctx.fillStyle = '#a0682f'; rr(ctx, x, sy, w, 14, 4); ctx.fill();
        ctx.strokeStyle = '#6e4218'; ctx.lineWidth = 2;
        for (let k = x + 30; k < x + w - 10; k += 34) { ctx.beginPath(); ctx.moveTo(k, sy + 2); ctx.lineTo(k, sy + 12); ctx.stroke(); }
        ctx.fillStyle = '#4fa84a'; ctx.beginPath(); ctx.ellipse(x + 8, sy - 2, 12, 6, -0.4, 0, 7); ctx.fill();
        break;
      case 'cloud':
        ctx.fillStyle = '#ffffff';
        for (let k = x + 10; k < x + w; k += 22) { ctx.beginPath(); ctx.arc(k, sy + 7, 12, 0, 7); ctx.fill(); }
        rr(ctx, x, sy, w, 16, 8); ctx.fill();
        ctx.fillStyle = 'rgba(120,160,220,.35)'; rr(ctx, x + 4, sy + 11, w - 8, 6, 3); ctx.fill();
        break;
      case 'reed':
        ctx.fillStyle = '#e0a458'; rr(ctx, x, sy, w, 12, 6); ctx.fill();
        ctx.fillStyle = '#b96f3a'; for (let k = x + 12; k < x + w - 6; k += 24) ctx.fillRect(k, sy + 1, 3, 10);
        break;
      case 'star':
        ctx.fillStyle = '#3d4aa8'; rr(ctx, x, sy, w, 12, 6); ctx.fill();
        ctx.fillStyle = '#ffe45c'; for (let k = x + 10; k < x + w - 6; k += 26) { ctx.beginPath(); ctx.arc(k, sy + 6, 2.5 + Math.sin(t / 12 + k) * 0.8, 0, 7); ctx.fill(); }
        break;
      default: {
        const hue = (p.i * 9) % 360;
        ctx.fillStyle = `hsl(${hue},80%,62%)`; rr(ctx, x, sy, w, 12, 3); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(x + 4, sy + 2, w - 8, 3);
      }
    }
    if (p.kind === 'crumble') { // pukotine: ova grančica se slomi
      ctx.strokeStyle = 'rgba(40,20,0,.75)'; ctx.lineWidth = 2;
      for (let k = x + w * 0.25; k < x + w - 8; k += w * 0.3) { ctx.beginPath(); ctx.moveTo(k, sy - 2); ctx.lineTo(k + 5, sy + 6); ctx.lineTo(k - 2, sy + 10); ctx.lineTo(k + 4, sy + 15); ctx.stroke(); }
    } else if (p.kind === 'move') { // strelice: pomična grančica
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('◀ ▶', x + w / 2, sy + 8);
    }
    ctx.restore();
    // oznaka kata (svaki deseti)
    if (p.i && p.i % 10 === 0) {
      const lab = String(p.i);
      ctx.font = 'bold 13px system-ui, sans-serif';
      const tw = ctx.measureText(lab).width + 12, lx = big ? W / 2 - tw / 2 : Math.max(WALL + 2, Math.min(W - WALL - tw - 2, x + w / 2 - tw / 2));
      ctx.fillStyle = big ? '#ffcf3f' : 'rgba(0,0,0,.45)'; rr(ctx, lx, sy + 18, tw, 18, 9); ctx.fill();
      ctx.fillStyle = big ? '#4a2c00' : '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(lab, lx + tw / 2, sy + 27.5);
    }
  }

  function drawStar(ctx, x, y, r, t) {
    ctx.save(); ctx.translate(x, y + Math.sin(t / 10 + x) * 3); ctx.rotate(Math.sin(t / 20) * 0.3);
    ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr2 = k % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function drawSpring(ctx, x, y, t, boing) {
    // gljiva-opruga: crveni klobuk s bijelim točkama (stisne se kad netko odskoči)
    const sq = boing > 0 ? 1 - boing / 30 : 1;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#f3e7c9'; rr(ctx, -6, -14 * sq, 12, 14 * sq, 4); ctx.fill();
    ctx.translate(0, -14 * sq);
    ctx.fillStyle = '#e2473b'; ctx.beginPath(); ctx.ellipse(0, 0, 18, 11 * sq, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; for (const [a, b, r2] of [[-8, -4, 2.6], [3, -7, 2.2], [10, -2, 2]]) { ctx.beginPath(); ctx.arc(a, b * sq, r2, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  function drawWasp(ctx, x, y, dir, t) {
    ctx.save(); ctx.translate(x, y + Math.sin(t / 6) * 3); ctx.scale(dir, 1);
    // krila (mašu)
    ctx.fillStyle = 'rgba(220,240,255,.8)';
    const fl = Math.sin(t * 0.9) * 0.5;
    ctx.beginPath(); ctx.ellipse(-2, -9, 6, 10, -0.6 + fl, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4, -9, 5, 9, 0.5 - fl, 0, 7); ctx.fill();
    // tijelo s prugama
    ctx.fillStyle = '#ffc61a'; ctx.beginPath(); ctx.ellipse(0, 0, 13, 8, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillRect(-6, -7, 3.5, 14); ctx.fillRect(0, -8, 3.5, 16);
    ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(-19, 2); ctx.lineTo(-12, 3); ctx.fill(); // žalac
    ctx.beginPath(); ctx.arc(11, -1, 5.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(13, -2.5, 2, 0, 7); ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(13, -6); ctx.lineTo(17, -11); ctx.stroke();
    ctx.restore();
  }

  function drawHopper(ctx, g, sx, sy) {
    ctx.save();
    ctx.translate(sx, sy - PH / 2);
    if (g.rot) ctx.rotate(g.rot);
    ctx.scale(g.face, 1);
    const air = !g.ground;
    // stražnja noga (velika, skakačka)
    ctx.strokeStyle = '#2f7d1f'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (air) { ctx.moveTo(-6, 6); ctx.lineTo(-14, 14); ctx.lineTo(-10, 20); }
    else { ctx.moveTo(-6, 4); ctx.lineTo(-15, -6); ctx.lineTo(-12, 17); }
    ctx.stroke();
    // tijelo
    ctx.fillStyle = '#58c43a'; ctx.beginPath(); ctx.ellipse(0, 4, 12, 13, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#9be36f'; ctx.beginPath(); ctx.ellipse(3, 8, 6, 8, 0, 0, 7); ctx.fill();
    // krilca
    ctx.fillStyle = '#3e9e2a'; ctx.beginPath(); ctx.ellipse(-6, 2, 5, 11, -0.5, 0, 7); ctx.fill();
    // prednje nožice
    ctx.lineWidth = 3; ctx.strokeStyle = '#2f7d1f';
    ctx.beginPath(); ctx.moveTo(6, 12); ctx.lineTo(air ? 12 : 8, 17); ctx.moveTo(1, 14); ctx.lineTo(air ? 4 : 1, 17); ctx.stroke();
    // glava
    ctx.fillStyle = '#58c43a'; ctx.beginPath(); ctx.arc(5, -12, 10, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(9, -14, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.arc(10.5, -14, 2.4, 0, 7); ctx.fill();
    ctx.strokeStyle = '#1f4f12'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(9, -8, 3, 0.2, 1.6); ctx.stroke();
    // ticala
    ctx.beginPath(); ctx.moveTo(3, -21); ctx.quadraticCurveTo(6, -32, 15, -31); ctx.moveTo(7, -21); ctx.quadraticCurveTo(14, -29, 20, -25); ctx.stroke();
    // šeširić (mali crveni) – znak raspoznavanja
    ctx.fillStyle = '#e2473b'; ctx.beginPath(); ctx.ellipse(1, -20, 8, 3, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(1, -21, 5, Math.PI, 0); ctx.fill();
    ctx.restore();
  }

  /**
   * Pokreni igru u elementu host. opts: { sound, best, onEnd(result), onExit(), beep(f, d, type) }
   * Vraća { stop() }.
   */
  function play(host, opts) {
    opts = opts || {};
    const isTouch = matchMedia('(pointer: coarse)').matches;
    // na mobitelu: 'prst' = povlačenje prstom po ekranu (zadano) ili 'gumbi'; auto = skače sam
    const drag = isTouch && opts.ctrl !== 'gumbi', auto = !!opts.auto;
    host.innerHTML = `<div class="sk-wrap">
      <canvas class="sk-cv" aria-label="Skakavac"></canvas>
      <div class="sk-top"><button class="sk-btn sk-x" data-sk="exit" aria-label="Izađi">✕</button><button class="sk-btn sk-p" data-sk="pause" aria-label="Pauza">❚❚</button></div>
      <div class="sk-joy hid"><span></span></div>
      <div class="sk-pad${isTouch && !drag ? '' : ' hid'}">
        <button class="sk-k" data-k="l" aria-label="Lijevo">◀</button><button class="sk-k" data-k="r" aria-label="Desno">▶</button>
        <button class="sk-k sk-j" data-k="j" aria-label="Skok">SKOK</button>
      </div>
      <div class="sk-ov hid"></div>
    </div>`;
    const wrap = host.querySelector('.sk-wrap'), cv = host.querySelector('canvas'), ctx = cv.getContext('2d');
    const ov = host.querySelector('.sk-ov'), pad = host.querySelector('.sk-pad');
    const inp = { l: false, r: false, j: false }, keys = new Set();
    let g = null, H = 760, scale = 1, raf = 0, last = 0, acc = 0, paused = false, dead = false, stopped = false;
    let fx = [], msgs = [], shake = 0, flash = 0;
    const beep = (f, d, ty) => { if (opts.sound && opts.beep) opts.beep(f, d, ty); };

    function fit() {
      const r = wrap.getBoundingClientRect();
      const cw = Math.max(200, r.width), ch = Math.max(300, r.height);
      // svijet je širok W; visina pogleda prema omjeru ekrana (između 620 i 1000)
      scale = Math.min(cw / W, ch / 620);
      H = Math.max(620, Math.min(1000, ch / scale));
      scale = Math.min(cw / W, ch / H);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.style.width = Math.round(W * scale) + 'px'; cv.style.height = Math.round(H * scale) + 'px';
      cv.width = Math.round(W * scale * dpr); cv.height = Math.round(H * scale * dpr);
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      if (g) { const d = H - g.viewH; g.viewH = H; g.cam -= d; }
    }
    function start() {
      g = newGame((Math.random() * 1e9) | 0, H);
      fx = []; msgs = []; dead = false; paused = false; ov.classList.add('hid');
      msgs.push({ t: '↑ Penji se što više!', y: H * 0.42, life: 120, size: 26, col: '#fff' });
      last = performance.now(); acc = 0;
      sync();
    }
    function say(t, col, size, life) { msgs.push({ t, y: H * 0.36, life: life || 90, size: size || 30, col: col || '#fff' }); }
    function handle(ev) {
      if (ev.e === 'jump') beep(ev.big ? 620 : 480, 0.06, 'square');
      else if (ev.e === 'wall') beep(300, 0.04, 'triangle');
      else if (ev.e === 'land') {
        for (let k = 0; k < (ev.diff >= 2 ? 8 : 3); k++) fx.push({ x: g.x + (Math.random() - 0.5) * 20, y: g.y, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 2, life: 20, c: 'rgba(255,255,255,.8)' });
        if (ev.diff >= 2 && g.combo.jumps >= 2) beep(500 + g.combo.jumps * 60, 0.05, 'sine');
        if (ev.floor && ev.floor % 50 === 0 && ev.floor === g.maxFloor) { say(`${ev.floor}. kat · ${zoneOf(ev.floor).name}!`, '#ffe45c', 28, 110); beep(880, 0.15, 'sine'); }
      } else if (ev.e === 'combo') {
        const word = ev.floors >= 60 ? 'NEVJEROJATNO!' : ev.floors >= 30 ? 'FANTASTIČNO!' : ev.floors >= 15 ? 'SUPER!' : 'KOMBO!';
        say(`${word} +${ev.bonus}`, '#ffcf3f', ev.floors >= 30 ? 36 : 30, 110);
        msgs.push({ t: `${ev.jumps} skokova · ${ev.floors} katova`, y: H * 0.36 + 34, life: 110, size: 17, col: '#fff' });
        for (let k = 0; k < 24; k++) fx.push({ x: g.x, y: g.y - 20, vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.8) * 8, life: 40, c: ['#ffe45c', '#ff7a59', '#7fdc52', '#6cc8ff'][k % 4], star: 1 });
        beep(660, 0.08, 'square'); setTimeout(() => beep(990, 0.12, 'square'), 90);
      } else if (ev.e === 'start') say('Kreće! Ne zaostaj', '#fff', 24, 100);
      else if (ev.e === 'faster') { say(ev.level >= MAX_LEVEL ? 'Najveća brzina!' : 'Brže!', '#ff8b6b', 34, 100); flash = 20; beep(330, 0.12, 'sawtooth'); setTimeout(() => beep(440, 0.12, 'sawtooth'), 130); }
      else if (ev.e === 'star') { beep(1200, 0.06, 'sine'); for (let k = 0; k < 8; k++) fx.push({ x: ev.x, y: ev.y, vx: (Math.random() - 0.5) * 5, vy: -Math.random() * 4, life: 25, c: '#ffd23f', star: 1 }); }
      else if (ev.e === 'spring') { const p = plat(g, g.floor); p.boing = 30; beep(300, 0.25, 'sine'); setTimeout(() => beep(700, 0.15, 'sine'), 80); say('Boing!', '#ff8bd0', 26, 60); }
      else if (ev.e === 'hit') { shake = 8; flash = 12; beep(160, 0.2, 'sawtooth'); say('Au! Osa!', '#ff6b4a', 26, 70); }
      else if (ev.e === 'comboLost') say('Kombo izgubljen', '#ffb199', 18, 70);
      else if (ev.e === 'crumble') beep(140, 0.12, 'triangle');
      else if (ev.e === 'over') { shake = 14; beep(200, 0.3, 'sawtooth'); }
    }
    function frame(now) {
      if (stopped) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(100, now - last); last = now;
      if (!paused && !dead) {
        acc += dt;
        while (acc >= 1000 / 60) {
          acc -= 1000 / 60;
          step(g, inp);
          for (const ev of g.events) handle(ev);
          g.events.length = 0;
          if (g.over) { dead = true; setTimeout(over, 700); break; }
        }
      }
      draw();
    }
    function draw() {
      const cam = g.cam, f = Math.max(0, Math.floor(-(cam + H / 2) / FH));
      const sky = skyAt(f);
      const gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, sky[0]); gr.addColorStop(1, sky[1]);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
      ctx.save();
      if (shake > 0) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.9; if (shake < 0.5) shake = 0; }
      // pozadina (sporija od prednjeg plana): oblačići, a visoko zvijezde
      const par = cam * 0.3;
      for (let k = Math.floor(par / 160) - 1; k < Math.floor((par + H) / 160) + 1; k++) {
        const r1 = hash(k * 13 + 5), y = k * 160 - par;
        if (f > 180) { ctx.fillStyle = `rgba(255,255,240,${0.4 + r1 * 0.5})`; for (let s = 0; s < 4; s++) { ctx.beginPath(); ctx.arc(hash(k * 7 + s) * W, y + hash(k * 3 + s) * 160, 1 + r1 * 1.5, 0, 7); ctx.fill(); } }
        else { ctx.fillStyle = 'rgba(255,255,255,.45)'; const cx = r1 * W; for (let s = 0; s < 3; s++) { ctx.beginPath(); ctx.arc(cx + s * 22, y + 40 + (s % 2) * -8, 18, 0, 7); ctx.fill(); } }
      }
      // brežuljci i more na dnu (samo na početku)
      const by = -cam;
      if (by > -40 && by < H + 200) {
        ctx.fillStyle = '#4aa3c9'; ctx.fillRect(0, by + 30, W, 400);
        ctx.fillStyle = '#6cc04a'; ctx.beginPath(); ctx.moveTo(0, by + 40); ctx.quadraticCurveTo(W * 0.25, by - 60, W * 0.5, by + 20); ctx.quadraticCurveTo(W * 0.75, by - 50, W, by + 30); ctx.lineTo(W, by + 400); ctx.lineTo(0, by + 400); ctx.fill();
      }
      // platforme
      const i0 = Math.max(0, Math.floor(-(cam + H) / FH) - 1), i1 = Math.floor(-cam / FH) + 1;
      for (let i = i0; i <= i1; i++) {
        const p = plat(g, i); drawPlat(ctx, p, p.y - cam, g.t);
        if (p.item && !p.gone) {
          if (p.item.t === 'star' && !p.item.got) drawStar(ctx, Engine.itemX(p), p.y - 24 - cam, 11, g.t);
          else if (p.item.t === 'spring') drawSpring(ctx, Engine.itemX(p), p.y - cam, g.t, p.boing ? p.boing-- : 0);
        }
      }
      for (let i = i0; i <= i1 + 1; i++) { const p = plat(g, i); if (p.wasp) { const w = Engine.waspPos(g, p); drawWasp(ctx, w.x, w.y - cam, w.dir, g.t); } }
      // stabljike sa strane
      for (const sx of [0, W - WALL]) {
        ctx.fillStyle = '#3f8f2c'; ctx.fillRect(sx, 0, WALL, H);
        ctx.fillStyle = '#2d6b1f'; ctx.fillRect(sx + (sx ? 0 : WALL - 5), 0, 5, H);
        ctx.fillStyle = '#5db544'; ctx.fillRect(sx + 6, 0, 4, H);
        const off = ((-cam) % 120 + 120) % 120;
        ctx.fillStyle = '#2d6b1f';
        for (let y = off - 120; y < H; y += 120) { ctx.fillRect(sx, y, WALL, 4); ctx.fillStyle = '#4fa84a'; ctx.beginPath(); ctx.ellipse(sx ? sx - 4 : WALL + 4, y + 10, 12, 5, sx ? 0.5 : -0.5, 0, 7); ctx.fill(); ctx.fillStyle = '#2d6b1f'; }
      }
      // čestice
      for (const p of fx) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.life--;
        ctx.globalAlpha = Math.max(0, p.life / 40); ctx.fillStyle = p.c;
        if (p.star) { ctx.save(); ctx.translate(p.x, p.y - cam); ctx.rotate(p.life / 5); ctx.fillRect(-3, -3, 6, 6); ctx.restore(); }
        else { ctx.beginPath(); ctx.arc(p.x, p.y - cam, 2.5, 0, 7); ctx.fill(); }
      }
      ctx.globalAlpha = 1; fx = fx.filter(p => p.life > 0);
      if (!(g.inv && Math.floor(g.inv / 5) % 2)) drawHopper(ctx, g, g.x, g.y - cam);
      ctx.restore();
      if (flash > 0) { ctx.fillStyle = `rgba(255,120,90,${flash / 60})`; ctx.fillRect(0, 0, W, H); flash--; }
      hud();
    }
    function hud() {
      ctx.textBaseline = 'alphabetic';
      // bodovi i kat
      ctx.fillStyle = 'rgba(0,0,0,.42)'; rr(ctx, WALL + 6, 8, 170, 52, 12); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
      ctx.font = 'bold 24px system-ui, sans-serif'; ctx.fillText(String(score(g)), WALL + 16, 34);
      ctx.font = '13px system-ui, sans-serif'; ctx.fillText(`Kat ${g.floor} · najviše ${g.maxFloor}`, WALL + 16, 52);
      // brzina (desno, ispod gumba)
      const lvTxt = g.level ? `Brzina ${g.level}/${MAX_LEVEL}` : `Brzina: kreće na ${START_FLOOR}. katu`;
      ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'right';
      const tw = ctx.measureText(lvTxt).width + 16;
      ctx.fillStyle = 'rgba(0,0,0,.42)'; rr(ctx, W - WALL - 6 - tw, 66, tw, 22, 11); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(lvTxt, W - WALL - 14, 81);
      if (g.level && g.level < MAX_LEVEL) {
        const p = ((g.t - g.startT) % LEVEL_T) / LEVEL_T;
        ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(W - WALL - 6 - tw + 8, 84, tw - 16, 2);
        ctx.fillStyle = '#ff8b6b'; ctx.fillRect(W - WALL - 6 - tw + 8, 84, (tw - 16) * p, 2);
      }
      // kombo: brojač i traka vremena (lijevo)
      const c = g.combo;
      if (c.jumps) {
        const x = WALL + 8, y = 72, h = 150;
        ctx.fillStyle = 'rgba(0,0,0,.42)'; rr(ctx, x, y, 22, h, 11); ctx.fill();
        const fr = c.timer / COMBO_T;
        ctx.fillStyle = fr > 0.35 ? '#ffcf3f' : '#ff6b4a'; rr(ctx, x + 4, y + 4 + (h - 8) * (1 - fr), 14, (h - 8) * fr, 7); ctx.fill();
        ctx.textAlign = 'left'; ctx.fillStyle = '#ffcf3f'; ctx.font = 'bold 20px system-ui, sans-serif';
        ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 3;
        const ct = `×${c.jumps}`, ct2 = `${c.floors} kat.`;
        ctx.strokeText(ct, x + 30, y + 22); ctx.fillText(ct, x + 30, y + 22);
        ctx.font = 'bold 12px system-ui, sans-serif'; ctx.strokeText(ct2, x + 30, y + 38); ctx.fillStyle = '#fff'; ctx.fillText(ct2, x + 30, y + 38);
      }
      // poruke
      ctx.textAlign = 'center';
      for (const m of msgs) {
        m.life--; m.y -= 0.35;
        ctx.globalAlpha = Math.min(1, m.life / 25);
        ctx.font = `900 ${m.size}px system-ui, sans-serif`; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.55)';
        ctx.strokeText(m.t, W / 2, m.y); ctx.fillStyle = m.col; ctx.fillText(m.t, W / 2, m.y);
      }
      ctx.globalAlpha = 1; msgs = msgs.filter(m => m.life > 0);
      if (isTouch && g.t < 360 && !g.maxFloor) {
        ctx.font = '15px system-ui, sans-serif'; ctx.fillStyle = 'rgba(0,0,0,.6)';
        ctx.fillText(drag ? 'Povuci prst lijevo-desno bilo gdje po ekranu' : 'Gumbi ◀ ▶ za trčanje', W / 2, H - 70);
        ctx.fillText(auto ? 'Skakavac skače sam · zaleti se za viši skok!' : drag ? 'Kratki dodir ili drugi prst = skok' : 'SKOK za skok', W / 2, H - 48);
      }
      if (!isTouch && g.t < 300 && !g.maxFloor) {
        ctx.font = '14px system-ui, sans-serif'; ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillText('← → hodanje · razmak ili ↑ skok · P pauza', W / 2, H - 60);
        ctx.fillText('Zaleti se: što brže trčiš, to više skočiš!', W / 2, H - 40);
      }
    }
    function over() {
      if (stopped) return;
      const res = { score: score(g), floor: g.maxFloor, ms: Math.round(g.t * 1000 / 60), combo: g.bestCombo, combos: g.combos };
      const best = opts.best || 0, rec = res.score > best && res.score > 0;
      ov.innerHTML = `<div class="sk-card">
        <h2>${rec ? '🏆 Novi rekord!' : 'Pao si!'}</h2>
        <div class="sk-res"><div><b>${res.score}</b><small>bodova</small></div><div><b>${res.floor}</b><small>kat</small></div><div><b>${res.combo || '–'}</b><small>najveći kombo</small></div></div>
        <p class="muted">${rec ? (best ? `Prijašnji rekord: ${best}` : 'Prvi rezultat je zapisan.') : `Tvoj rekord: ${best}`} · ${zoneOf(res.floor).name}</p>
        <div class="sk-extra"></div>
        <div class="row"><button data-sk="again">Igraj ponovno</button><button class="ghost" data-sk="exit">Izbornik</button></div>
        <p class="muted sk-hint">${isTouch ? (drag ? '' : 'Ili dodirni SKOK za novu igru') : 'Ili pritisni razmak za novu igru'}</p>
      </div>`;
      ov.classList.remove('hid');
      if (rec) opts.best = res.score;
      if (opts.onEnd) opts.onEnd(res, ov.querySelector('.sk-extra'));
      overAt = performance.now();
    }
    let overAt = 0;
    const canRestart = () => dead && !ov.classList.contains('hid') && performance.now() - overAt > 900;
    function setPause(p) {
      if (dead) return;
      paused = p;
      if (p) {
        ov.innerHTML = `<div class="sk-card"><h2>Pauza</h2><p class="muted">Bodovi: ${score(g)} · kat ${g.maxFloor}</p><div class="row"><button data-sk="resume">Nastavi</button><button class="ghost" data-sk="exit">Izađi</button></div></div>`;
        ov.classList.remove('hid');
      } else { ov.classList.add('hid'); last = performance.now(); acc = 0; }
    }
    // ---------- upravljanje ----------
    const KEYMAP = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'j', KeyW: 'j', Space: 'j' };
    const sync = () => {
      inp.l = keys.has('l') || padKeys.has('l'); inp.r = keys.has('r') || padKeys.has('r');
      inp.ax = dragId != null ? dragAx : undefined;
      inp.j = auto || keys.has('j') || padKeys.has('j') || tapJ > performance.now() || jumpPtrs.size > 0;
    };
    // povlačenje prstom: gdje god dodirneš ekran, to je sredina; pomak lijevo/desno = trčanje (jače što dalje)
    const joy = host.querySelector('.sk-joy'), knob = joy.querySelector('span');
    let dragId = null, dragX0 = 0, dragAx = 0, downAt = 0, downX = 0, moved = 0, tapJ = 0;
    const jumpPtrs = new Set();
    const JOY = 56;
    if (drag) {
      wrap.addEventListener('pointerdown', e => {
        if (e.target.closest('button') || !ov.classList.contains('hid')) return;
        e.preventDefault();
        if (dragId != null) { if (!auto) { jumpPtrs.add(e.pointerId); sync(); } return; } // drugi prst = skok
        dragId = e.pointerId; dragX0 = e.clientX; dragAx = 0; downAt = performance.now(); downX = e.clientX; moved = 0;
        try { wrap.setPointerCapture(e.pointerId); } catch { }
        const r = wrap.getBoundingClientRect();
        joy.style.left = (e.clientX - r.left) + 'px'; joy.style.top = (e.clientY - r.top) + 'px';
        knob.style.transform = 'translateX(0px)'; joy.classList.remove('hid');
        sync();
      });
      wrap.addEventListener('pointermove', e => {
        if (e.pointerId !== dragId) return;
        let dx = e.clientX - dragX0;
        moved = Math.max(moved, Math.abs(e.clientX - downX));
        // sredina ide za prstom kad odeš predaleko, pa je promjena smjera odmah
        if (Math.abs(dx) > JOY) { dragX0 += dx - Math.sign(dx) * JOY; dx = Math.sign(dx) * JOY; const r = wrap.getBoundingClientRect(); joy.style.left = (dragX0 - r.left) + 'px'; }
        dragAx = Math.abs(dx) < 6 ? 0 : Math.max(-1, Math.min(1, dx / 34));
        knob.style.transform = `translateX(${dx}px)`;
        sync();
      });
      const end = e => {
        if (jumpPtrs.delete(e.pointerId)) { sync(); return; }
        if (e.pointerId !== dragId) return;
        // kratki dodir bez pomicanja = skok (kad nije automatski)
        if (!auto && performance.now() - downAt < 220 && moved < 12) tapJ = performance.now() + 120;
        dragId = null; dragAx = 0; joy.classList.add('hid');
        sync();
      };
      wrap.addEventListener('pointerup', end); wrap.addEventListener('pointercancel', end);
    }
    const onKey = e => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const k = KEYMAP[e.code];
      if (e.type === 'keydown' && (e.code === 'KeyP' || e.code === 'Escape')) { e.preventDefault(); if (!dead) setPause(!paused); return; }
      if (!k) return;
      e.preventDefault();
      if (e.type === 'keydown') { if (k === 'j' && canRestart()) return start(); keys.add(k); } else keys.delete(k);
      sync();
    };
    const padKeys = new Set(), ptrs = new Map();
    pad.addEventListener('pointerdown', e => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      e.preventDefault();
      if (b.dataset.k === 'j' && canRestart()) { start(); return; }
      ptrs.set(e.pointerId, b.dataset.k); padKeys.add(b.dataset.k); b.classList.add('on');
      try { b.setPointerCapture(e.pointerId); } catch { }
      sync();
    });
    const up = e => {
      const k = ptrs.get(e.pointerId); if (!k) return;
      ptrs.delete(e.pointerId);
      if (![...ptrs.values()].includes(k)) { padKeys.delete(k); const b = pad.querySelector(`[data-k="${k}"]`); if (b) b.classList.remove('on'); }
      sync();
    };
    pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up); pad.addEventListener('lostpointercapture', up);
    pad.addEventListener('contextmenu', e => e.preventDefault());
    wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-sk]'); if (!b) return;
      const a = b.dataset.sk;
      if (a === 'exit') { api.stop(); if (opts.onExit) opts.onExit(); }
      else if (a === 'pause') setPause(!paused);
      else if (a === 'resume') setPause(false);
      else if (a === 'again') start();
    });
    const onVis = () => { if (document.hidden && !paused && !dead) setPause(true); };
    const onBlur = () => { keys.clear(); sync(); };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
    window.addEventListener('resize', fit); window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    fit(); start();
    raf = requestAnimationFrame(t => { last = t; frame(t); });
    const api = {
      stop() {
        if (stopped) return; stopped = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey);
        window.removeEventListener('resize', fit); window.removeEventListener('blur', onBlur);
        document.removeEventListener('visibilitychange', onVis);
      },
      get game() { return g; },
    };
    play.last = api; // za testove u pregledniku
    return api;
  }

  const api = Object.assign({ NAME: 'Skakavac' }, Engine, { play });
  if (typeof module !== 'undefined') module.exports = api;
  else window.Skakavac = api;
})();
