/* Originalni dizajn karata – crta se kao SVG */
(function (root) {
  'use strict';
  const COLORS = { kupe: '#b8322a', dinari: '#c8920e', spade: '#2a5596', bate: '#2f7a3a' };
  const DARK = { kupe: '#6e1a14', dinari: '#7a5604', spade: '#15305c', bate: '#1a4a22' };
  const LABEL = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 11: 'F', 12: 'Ko', 13: 'Kr' };
  const FIG = { 11: 'FANAT', 12: 'KONJ', 13: 'KRALJ' };

  // simbol boje, centriran na 0,0, veličina ~ 24
  function suit(s, x, y, k, rot) {
    const c = COLORS[s], d = DARK[s];
    let g = '';
    if (s === 'kupe') {
      g = `<path d="M-10,-11 H10 Q11,2 2,5 L2,8 Q2,10 6,11 L6,13 H-6 L-6,11 Q-2,10 -2,8 L-2,5 Q-11,2 -10,-11 Z" fill="${c}" stroke="${d}" stroke-width="1.2"/>
        <path d="M-8,-8 H8" stroke="#f7d9a0" stroke-width="1.4" stroke-linecap="round"/>
        <circle cx="0" cy="-2" r="2.2" fill="#f7d9a0"/>`;
    } else if (s === 'dinari') {
      g = `<circle r="12" fill="${c}" stroke="${d}" stroke-width="1.4"/>
        <circle r="8" fill="none" stroke="#fff3c4" stroke-width="1.2"/>
        <path d="M0,-5 L1.5,-1.5 L5,0 L1.5,1.5 L0,5 L-1.5,1.5 L-5,0 L-1.5,-1.5 Z" fill="#fff3c4"/>`;
    } else if (s === 'spade') {
      g = `<path d="M0,-14 L2.6,-11 L2.6,5 L-2.6,5 L-2.6,-11 Z" fill="#dfe6ef" stroke="${d}" stroke-width="1"/>
        <path d="M0,-12 V4" stroke="${d}" stroke-width=".6"/>
        <rect x="-8" y="5" width="16" height="3" rx="1.5" fill="${c}" stroke="${d}" stroke-width=".8"/>
        <rect x="-1.8" y="8" width="3.6" height="5" fill="${d}"/>
        <circle cx="0" cy="14.5" r="2.3" fill="${c}" stroke="${d}" stroke-width=".8"/>`;
    } else {
      g = `<g transform="rotate(-25)"><path d="M-2.5,13 L-3.8,-6 Q-4.5,-13 0,-14 Q4.5,-13 3.8,-6 L2.5,13 Q0,14.5 -2.5,13 Z" fill="${c}" stroke="${d}" stroke-width="1.2"/>
        <circle cx="-3.6" cy="-4" r="1.6" fill="${d}"/><circle cx="3.4" cy="0" r="1.5" fill="${d}"/><circle cx="-3" cy="5" r="1.3" fill="${d}"/>
        <path d="M-1,-10 Q0,-12 1,-10" stroke="#cfe8c4" stroke-width="1" fill="none"/></g>`;
    }
    return `<g transform="translate(${x},${y}) scale(${k || 1})${rot ? ' rotate(' + rot + ')' : ''}">${g}</g>`;
  }

  const PIPS = {
    2: [[50, 48], [50, 112]],
    3: [[50, 42], [50, 80], [50, 118]],
    4: [[33, 48], [67, 48], [33, 112], [67, 112]],
    5: [[33, 46], [67, 46], [50, 80], [33, 114], [67, 114]],
    6: [[33, 44], [67, 44], [33, 80], [67, 80], [33, 116], [67, 116]],
    7: [[33, 42], [67, 42], [24, 80], [50, 80], [76, 80], [33, 118], [67, 118]],
  };

  function figure(s, r) {
    const c = COLORS[s], d = DARK[s];
    let fig = '';
    if (r === 13) { // kralj: kruna, plašt
      fig = `<path d="M38,52 L40,40 L45,47 L50,37 L55,47 L60,40 L62,52 Z" fill="#e8b923" stroke="#7a5604" stroke-width="1"/>
        <circle cx="50" cy="60" r="9" fill="#f3d2b3" stroke="#6b4a33" stroke-width="1"/>
        <path d="M45,64 Q50,72 55,64" fill="#8a8a8a"/>
        <path d="M30,112 Q32,74 50,70 Q68,74 70,112 Z" fill="${c}" stroke="${d}" stroke-width="1.2"/>
        <path d="M50,72 V112" stroke="#f2e6c8" stroke-width="3"/>
        <path d="M33,92 H67" stroke="#e8b923" stroke-width="2"/>`;
    } else if (r === 12) { // konj: glava konja
      fig = `<path d="M36,112 L38,86 Q34,78 38,66 Q42,52 54,46 L56,38 L60,46 Q70,50 70,62 L66,66 Q60,64 58,70 L62,84 L64,112 Z" fill="#8b5a2b" stroke="#4a2c12" stroke-width="1.2"/>
        <path d="M54,46 Q46,50 42,62 Q40,70 42,80" stroke="${c}" stroke-width="4" fill="none" stroke-linecap="round"/>
        <circle cx="60" cy="54" r="1.6" fill="#1c1c1c"/>
        <path d="M40,96 H62" stroke="${c}" stroke-width="5"/>`;
    } else { // fanat: kapa s perom
      fig = `<path d="M39,52 Q50,38 61,52 Z" fill="${c}" stroke="${d}" stroke-width="1"/>
        <path d="M58,46 Q70,34 66,30" stroke="#e8b923" stroke-width="2" fill="none"/>
        <circle cx="50" cy="60" r="8.5" fill="#f3d2b3" stroke="#6b4a33" stroke-width="1"/>
        <path d="M34,112 L38,74 Q50,68 62,74 L66,112 Z" fill="#f2e6c8" stroke="${d}" stroke-width="1.2"/>
        <path d="M38,74 L50,92 L62,74" fill="${c}"/>
        <path d="M36,100 H64" stroke="${d}" stroke-width="2"/>`;
    }
    return `<rect x="22" y="30" width="56" height="100" rx="5" fill="#fffaf0" stroke="${c}" stroke-width="1.4"/>
      ${fig}
      ${suit(s, 66, 104, 0.62)}
      <text x="50" y="125" font-size="8" text-anchor="middle" fill="${d}" font-family="Georgia,serif" letter-spacing="1">${FIG[r]}</text>`;
  }

  function face(cardId) {
    const [s, rs] = cardId.split('-'); const r = +rs;
    const c = COLORS[s], d = DARK[s];
    let center = '';
    if (r === 1) {
      center = `<circle cx="50" cy="80" r="30" fill="none" stroke="${c}" stroke-width="1" stroke-dasharray="2 3"/>
        <circle cx="50" cy="80" r="35" fill="none" stroke="${c}" stroke-width=".6"/>
        ${suit(s, 50, 80, 2.1)}`;
    } else if (PIPS[r]) {
      center = PIPS[r].map(([x, y], i) => suit(s, x, y, r === 7 ? 0.82 : 0.95, y > 80 && s !== 'dinari' ? 180 : 0)).join('');
    } else center = figure(s, r);
    const idx = `<text x="9" y="20" font-size="${LABEL[r].length > 1 ? 13 : 16}" font-weight="700" fill="${d}" font-family="Georgia,serif">${LABEL[r]}</text>${suit(s, 15, 30, 0.38)}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 160" class="card-svg">
      <rect x="1" y="1" width="98" height="158" rx="9" fill="#fbf5e6" stroke="#9c8a6a" stroke-width="1.2"/>
      <rect x="5" y="5" width="90" height="150" rx="6" fill="none" stroke="${c}" stroke-width=".8" opacity=".6"/>
      ${idx}<g transform="rotate(180 50 80)">${idx}</g>
      ${center}
    </svg>`;
  }

  function back() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 160" class="card-svg">
      <defs><pattern id="bp" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="12" height="12" fill="#7d1d2b"/><rect width="6" height="6" fill="#962636"/></pattern></defs>
      <rect x="1" y="1" width="98" height="158" rx="9" fill="#f4ead2" stroke="#5a1420" stroke-width="1.2"/>
      <rect x="6" y="6" width="88" height="148" rx="6" fill="url(#bp)" stroke="#e5c77a" stroke-width="1.5"/>
      <circle cx="50" cy="80" r="17" fill="#f4ead2" stroke="#e5c77a" stroke-width="2"/>
      <text x="50" y="88" font-size="22" text-anchor="middle" font-family="Georgia,serif" font-weight="700" fill="#7d1d2b">B</text>
    </svg>`;
  }

  root.CardArt = { face, back, suit: (s, k) => `<svg viewBox="-16 -16 32 32" class="suit-svg">${suit(s, 0, 0, k || 1)}</svg>`, COLORS };
})(typeof self !== 'undefined' ? self : this);
