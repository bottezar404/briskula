/* Karte po tršćanskom uzorku (Triestine), nacrtane kao SVG */
(function (root) {
  'use strict';
  const R = '#d42a2f', BL = '#1f4fa8', Y = '#f5c824', K = '#1a1a1a', W = '#ffffff', SKIN = '#f3cba4', BR = '#7b4a24';
  const SUITNAME = { dinari: 'DANARI', kupe: 'COPPE', bate: 'BASTONI', spade: 'SPADE' };
  const FIGNAME = { 11: 'FANTE', 12: 'CAVAL', 13: 'RE' };
  let uid = 0;

  // ---------- simboli boja ----------
  function coin(x, y, r) {
    let petals = '';
    for (let i = 0; i < 12; i++) {
      const a = i * 30 + 15, left = a > 180;
      petals += `<ellipse cx="0" cy="${-r * .5}" rx="${r * .17}" ry="${r * .36}" fill="${left ? BL : Y}" stroke="${K}" stroke-width="${r * .03}" transform="rotate(${a})"/>`;
    }
    return `<g transform="translate(${x},${y})">
      <circle r="${r}" fill="${W}" stroke="${K}" stroke-width="${r * .06}"/>
      <circle r="${r * .88}" fill="${Y}" stroke="${K}" stroke-width="${r * .04}"/>
      <circle r="${r * .84}" fill="${BL}"/>${petals}
      <circle r="${r * .26}" fill="${R}" stroke="${K}" stroke-width="${r * .04}"/>
      <path d="M0,${-r * .14} L${r * .04},${-r * .04} L${r * .14},0 L${r * .04},${r * .04} L0,${r * .14} L${-r * .04},${r * .04} L${-r * .14},0 L${-r * .04},${-r * .04} Z" fill="${K}"/>
    </g>`;
  }

  // pehar (kupa) – šesterokutni poklopac i podnožje, plavo tijelo
  function cup(x, y, s, rot) {
    const hex = (cy, top) => `<path d="M-12,${cy} L-9,${cy - 4} L9,${cy - 4} L12,${cy} L9,${cy + 4} L-9,${cy + 4} Z" fill="${top ? K : Y}" stroke="${K}" stroke-width=".7"/>
      <path d="M-12,${cy} L12,${cy} L9,${cy + 4} L-9,${cy + 4} Z" fill="${top ? Y : K}" stroke="${K}" stroke-width=".7"/>
      <path d="M-5,${cy + (top ? 2 : -2)} l2,-1.5 l2,1.5 l2,-1.5 l2,1.5 l2,-1.5" stroke="${top ? R : Y}" fill="none" stroke-width=".9"/>`;
    return `<g transform="translate(${x},${y}) scale(${s})${rot ? ' rotate(' + rot + ')' : ''}">
      ${hex(-13, true)}
      <path d="M-8,-8 Q-9,-3 -3,-2 Q-2,0 -3,2 Q-9,3 -8,8 L8,8 Q9,3 3,2 Q2,0 3,-2 Q9,-3 8,-8 Z" fill="${BL}" stroke="${K}" stroke-width=".8"/>
      <path d="M-6,-6 Q-3,-4 -2,-2 M6,-6 Q3,-4 2,-2 M-6,6 Q-3,4 -2,2 M6,6 Q3,4 2,2" stroke="#8fb2ec" stroke-width=".8" fill="none"/>
      <rect x="-5" y="-1.4" width="10" height="2.8" rx="1.2" fill="${R}" stroke="${K}" stroke-width=".6"/>
      ${hex(13, false)}
    </g>`;
  }

  // bata – štap s glavicom; crta se okomito duljine L, centriran
  function baton(x, y, L, ang, col, w) {
    w = w || 7;
    const h = L / 2;
    const dots = [];
    for (let t = -h + 14; t < h - 14; t += 9) dots.push(`<path d="M0,${t - 2} L1.6,${t} L0,${t + 2} L-1.6,${t} Z" fill="${K}"/>`);
    const other = col === R ? BL : R;
    return `<g transform="translate(${x},${y}) rotate(${ang})">
      <rect x="${-w / 2}" y="${-h + 9}" width="${w}" height="${L - 18}" fill="${col}" stroke="${K}" stroke-width=".8"/>
      <rect x="${-w / 2}" y="${-h + 9}" width="${w * .35}" height="${L - 18}" fill="#fff" opacity=".18"/>
      ${dots.join('')}
      <path d="M${-w / 2 - 1.5},${-h + 10} L${-w / 2 - 3},${-h + 5} L${w / 2 + 3},${-h + 5} L${w / 2 + 1.5},${-h + 10} Z" fill="${Y}" stroke="${K}" stroke-width=".7"/>
      <path d="M${-w / 2 - 3},${-h + 5} Q0,${-h - 6} ${w / 2 + 3},${-h + 5} Z" fill="${other}" stroke="${K}" stroke-width=".7"/>
      <circle cx="0" cy="${-h - 1.5}" r="1.6" fill="${Y}" stroke="${K}" stroke-width=".5"/>
      <path d="M${-w / 2},${h - 9} Q${-w / 2 - 5},${h - 3} 0,${h} Q${w / 2 + 5},${h - 3} ${w / 2},${h - 9} Z" fill="${Y}" stroke="${K}" stroke-width=".7"/>
      <path d="M-2,${h - 7} V${h - 1} M2,${h - 7} V${h - 1}" stroke="#b8860b" stroke-width=".6"/>
      <circle cx="0" cy="${h + 2}" r="2.2" fill="${other}" stroke="${K}" stroke-width=".6"/>
    </g>`;
  }

  // zakrivljena sablja (dio ovala) – lijeva ili desna
  function curvedSword(dx, side) {
    // side -1 = lijevo, 1 = desno; dx = koliko je luk udaljen od središta
    const sx = 50 - side * 14, ex = 50 - side * 14;
    const cx = 50 + side * dx;
    const d = `M${sx},24 Q${cx},80 ${ex},136`;
    const top = side < 0 ? R : BL, bot = side < 0 ? BL : R;
    const id = 'sw' + (++uid);
    return `<g>
      <path d="${d}" stroke="${K}" stroke-width="7.6" fill="none"/>
      <path d="${d}" pathLength="100" stroke="${top}" stroke-width="6" fill="none" stroke-dasharray="0 6 22 72"/>
      <path d="${d}" pathLength="100" stroke="${Y}" stroke-width="6" fill="none" stroke-dasharray="0 30 40 30"/>
      <path d="${d}" pathLength="100" stroke="${bot}" stroke-width="6" fill="none" stroke-dasharray="0 72 22 6"/>
      <path d="${d}" pathLength="100" stroke="${W}" stroke-width="6" fill="none" stroke-dasharray="0 28 2 40 2 28"/>
      <path d="${d}" pathLength="100" stroke="${K}" stroke-width="2.2" fill="none" stroke-dasharray="0 34 1.2 4.8 1.2 4.8 1.2 4.8 1.2 4.8 1.2 4.8 1.2 4.8 1.2 50" opacity=".85"/>
    </g>`;
  }
  function hilt(x, y, rot, col) {
    return `<g transform="translate(${x},${y}) rotate(${rot})">
      <path d="M-9,0 Q0,-5 9,0 Q0,3 -9,0 Z" fill="${BL}" stroke="${K}" stroke-width=".6"/>
      <rect x="-1.6" y="-8" width="3.2" height="7" fill="${Y}" stroke="${K}" stroke-width=".5"/>
      <circle cx="0" cy="-9.5" r="2.3" fill="${col}" stroke="${K}" stroke-width=".5"/>
    </g>`;
  }
  function straightSword(x, y1, y2) {
    return `<g>
      <path d="M${x - 1.6},${y1 + 8} L${x - 1.6},${y2 - 6} L${x},${y2} L${x + 1.6},${y2 - 6} L${x + 1.6},${y1 + 8} Z" fill="#e9eef3" stroke="${K}" stroke-width=".6"/>
      <path d="M${x},${y1 + 9} V${y2 - 6}" stroke="${K}" stroke-width=".4"/>
      <rect x="${x - 6}" y="${y1 + 5}" width="12" height="3" rx="1.4" fill="${Y}" stroke="${K}" stroke-width=".5"/>
      <rect x="${x - 1.6}" y="${y1}" width="3.2" height="5" fill="${R}" stroke="${K}" stroke-width=".5"/>
      <circle cx="${x}" cy="${y1 - 1.5}" r="2" fill="${Y}" stroke="${K}" stroke-width=".5"/>
    </g>`;
  }
  function diamond(x, y, n, rot) {
    return `<g transform="translate(${x},${y})${rot ? ' rotate(180)' : ''}">
      <path d="M0,-7 L7,0 L0,7 L-7,0 Z" fill="${Y}" stroke="${K}" stroke-width=".8"/>
      <text x="0" y="3.2" font-size="9" text-anchor="middle" font-family="Georgia,serif" font-weight="700" fill="${K}">${n}</text>
    </g>`;
  }

  // ---------- slaganje simbola po broju ----------
  const COIN_POS = {
    2: [[50, 46], [50, 114]], 3: [[50, 38], [50, 80], [50, 122]],
    4: [[32, 44], [68, 44], [32, 116], [68, 116]], 5: [[32, 42], [68, 42], [50, 80], [32, 118], [68, 118]],
    6: [[32, 38], [68, 38], [32, 80], [68, 80], [32, 122], [68, 122]],
    7: [[32, 36], [68, 36], [50, 58], [32, 80], [68, 80], [32, 124], [68, 124]],
  };
  const COIN_R = { 2: 17, 3: 14, 4: 13, 5: 12, 6: 11, 7: 10.5 };
  const CUP_POS = {
    2: [[50, 46], [50, 114]], 3: [[50, 40], [33, 116], [67, 116]],
    4: [[33, 46], [67, 46], [33, 114], [67, 114]], 5: [[33, 40], [67, 40], [50, 80], [33, 120], [67, 120]],
    6: [[33, 38], [67, 38], [33, 80], [67, 80], [33, 122], [67, 122]],
    7: [[33, 32], [67, 32], [50, 62], [33, 94], [67, 94], [33, 126], [67, 126]],
  };
  const CUP_S = { 2: 1.15, 3: 1.0, 4: 1.0, 5: .9, 6: .85, 7: .78 };

  function pipsBate(n) {
    const per = n <= 3 ? 1 : n <= 5 ? 2 : 3;
    const gap = per === 3 ? 10 : 12, ang = 24, L = 124;
    let g = '';
    for (let i = 0; i < per; i++) {
      const off = (i - (per - 1) / 2) * gap;
      g += baton(50 + off, 80, L, -ang, i % 2 ? R : BL, per === 1 ? 10 : per === 2 ? 8 : 7);
    }
    for (let i = 0; i < per; i++) {
      const off = (i - (per - 1) / 2) * gap;
      g += baton(50 + off, 80, L, ang, i % 2 ? BL : R, per === 1 ? 10 : per === 2 ? 8 : 7);
    }
    if (n % 2) g += baton(50, 80, 120, 0, '#e0b21b', 8);
    return g + diamond(50, 80, n);
  }

  function pipsSpade(n) {
    const per = n <= 3 ? 1 : n <= 5 ? 2 : 3;
    let g = '';
    for (let i = 0; i < per; i++) g += curvedSword(70 - i * 13, -1) + curvedSword(70 - i * 13, 1);
    g += hilt(64, 23, 35, R) + hilt(36, 23, -35, BL);
    if (n % 2) g += straightSword(50, 20, 142);
    g += diamond(50, 28, n) + diamond(50, 132, n, true);
    return g;
  }

  // ---------- figure (dvoglave, zrcaljene) ----------
  function halfFigure(s, r) {
    const coat = { dinari: [R, Y], kupe: [BL, R], bate: [R, BL], spade: [BL, Y] }[s];
    let hat;
    if (r === 13) hat = `<path d="M38,24 L39,14 L43,19 L46,12 L50,18 L54,12 L57,19 L61,14 L62,24 Z" fill="${Y}" stroke="${K}" stroke-width=".7"/>
      <circle cx="46" cy="14" r="1.3" fill="${R}"/><circle cx="54" cy="14" r="1.3" fill="${R}"/><rect x="38" y="22" width="24" height="3" fill="${R}" stroke="${K}" stroke-width=".5"/>`;
    else if (r === 12) hat = `<path d="M37,24 Q38,14 50,13 Q62,14 63,24 Z" fill="${BL}" stroke="${K}" stroke-width=".7"/><rect x="36" y="22" width="28" height="3.2" rx="1.5" fill="${Y}" stroke="${K}" stroke-width=".5"/>
      <path d="M60,15 Q68,4 70,10 Q66,12 62,18" fill="${R}" stroke="${K}" stroke-width=".5"/>`;
    else hat = `<rect x="39" y="15" width="22" height="9" rx="2" fill="${R}" stroke="${K}" stroke-width=".7"/><rect x="38" y="21" width="24" height="3.5" rx="1.5" fill="${BL}" stroke="${K}" stroke-width=".5"/>`;
    const beard = r === 13 ? `<path d="M44,37 Q50,46 56,37 Q53,40 50,40 Q47,40 44,37 Z" fill="#6b4a2b"/>` : '';
    const horse = r === 12 ? `<path d="M64,70 L66,52 Q64,44 70,38 Q76,32 82,36 L84,40 Q80,42 80,46 L78,52 L80,70 Z" fill="${BR}" stroke="${K}" stroke-width=".8"/>
      <path d="M70,38 Q66,46 67,56" stroke="${K}" stroke-width="1.6" fill="none"/><circle cx="78" cy="40" r="1" fill="${K}"/>` : '';
    const item = s === 'dinari' ? coin(24, 44, 8.5) : s === 'kupe' ? cup(24, 42, .62) : s === 'bate' ? baton(25, 44, 40, 0, R, 5) : straightSword(25, 26, 66);
    const spear = r === 13 ? `<path d="M75,70 L75,22" stroke="${BR}" stroke-width="1.6"/><path d="M75,14 L78,22 L72,22 Z" fill="#c9d2da" stroke="${K}" stroke-width=".5"/>` : '';
    return `${horse}
      <path d="M18,70 Q20,50 34,46 L66,46 Q80,50 82,70 Z" fill="${coat[0]}" stroke="${K}" stroke-width=".9"/>
      <path d="M42,46 L42,70 M58,46 L58,70" stroke="${coat[1]}" stroke-width="5"/>
      <path d="M42,46 L42,70 M58,46 L58,70" stroke="${K}" stroke-width=".4"/>
      <path d="M50,46 L50,70" stroke="${Y}" stroke-width="2.4"/>
      <path d="M36,46 Q50,54 64,46 L60,43 Q50,48 40,43 Z" fill="${W}" stroke="${K}" stroke-width=".6"/>
      <rect x="47" y="38" width="6" height="6" fill="${SKIN}"/>
      <path d="M40,30 Q40,20 50,20 Q60,20 60,30 Q60,38 50,40 Q40,38 40,30 Z" fill="${SKIN}" stroke="${K}" stroke-width=".7"/>
      <path d="M40,30 Q39,22 44,22 L42,38 Q39,36 40,30 Z M60,30 Q61,22 56,22 L58,38 Q61,36 60,30 Z" fill="#8a5a2b"/>
      <circle cx="46.5" cy="29.5" r=".9" fill="${K}"/><circle cx="53.5" cy="29.5" r=".9" fill="${K}"/>
      <path d="M50,30 L49,34 L50.5,34" stroke="${K}" stroke-width=".5" fill="none"/>
      <path d="M47.5,36 Q50,37.2 52.5,36" stroke="#a33" stroke-width=".8" fill="none"/>${beard}
      ${hat}${spear}
      <circle cx="30" cy="56" r="3" fill="${SKIN}" stroke="${K}" stroke-width=".5"/>
      ${item}`;
  }
  function figure(s, r) {
    const half = halfFigure(s, r);
    const label = `${FIGNAME[r]} DI ${SUITNAME[s]}`;
    return `<clipPath id="fc${++uid}"><rect x="8" y="8" width="84" height="144"/></clipPath>
      <g clip-path="url(#fc${uid})">
        <g>${half}</g><g transform="rotate(180 50 80)">${half}</g>
      </g>
      <rect x="8" y="73" width="84" height="14" fill="${W}" stroke="${K}" stroke-width=".8"/>
      <text x="50" y="83" font-size="${label.length > 15 ? 6.4 : 7.2}" text-anchor="middle" font-family="Georgia,serif" fill="${K}" letter-spacing=".3">${label}</text>`;
  }

  // ---------- asovi ----------
  function scroll(y, flip) {
    return `<g transform="translate(50,${y})${flip ? ' scale(1,-1)' : ''}">
      <path d="M0,0 Q-10,-12 -24,-6 Q-34,0 -28,10 Q-24,14 -20,9" fill="none" stroke="${R}" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M0,0 Q10,-12 24,-6 Q34,0 28,10 Q24,14 20,9" fill="none" stroke="${BL}" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M0,0 Q-10,-12 -24,-6 M0,0 Q10,-12 24,-6" fill="none" stroke="${Y}" stroke-width="1"/>
      <circle cx="0" cy="-3" r="2.5" fill="${Y}" stroke="${K}" stroke-width=".5"/>
    </g>`;
  }
  function ribbon(y, text, size) {
    return `<path d="M14,${y - 6} L86,${y - 6} L82,${y} L86,${y + 6} L14,${y + 6} L18,${y} Z" fill="${Y}" stroke="${K}" stroke-width=".7"/>
      <text x="50" y="${y + 2.6}" font-size="${size || 6.5}" text-anchor="middle" font-family="Georgia,serif" fill="${K}">${text}</text>`;
  }
  function ace(s) {
    if (s === 'dinari') {
      const id = 'ac' + (++uid);
      return `${scroll(30)}${scroll(130, true)}
        <path id="${id}t" d="M24,80 A26,26 0 0 1 76,80" fill="none"/><path id="${id}b" d="M22,80 A28,28 0 0 0 78,80" fill="none"/>
        <circle cx="50" cy="80" r="31" fill="${Y}" stroke="${K}" stroke-width=".8"/>
        <circle cx="50" cy="80" r="22" fill="${Y}" stroke="${K}" stroke-width="1.2"/>
        <circle cx="50" cy="80" r="19" fill="none" stroke="${K}" stroke-width=".5"/>
        <text font-size="5.6" font-family="Georgia,serif" fill="${K}"><textPath href="#${id}t" startOffset="50%" text-anchor="middle">NON VAL SAPER</textPath></text>
        <text font-size="5.6" font-family="Georgia,serif" fill="${K}"><textPath href="#${id}b" startOffset="50%" text-anchor="middle">FORTUNA CONTRA</textPath></text>`;
    }
    if (s === 'kupe') {
      return `<path d="M24,20 Q30,26 50,26 Q70,26 76,20" fill="none" stroke="${Y}" stroke-width="4"/>
        <path d="M30,30 L36,22 L64,22 L70,30 L64,38 L36,38 Z" fill="${R}" stroke="${K}" stroke-width=".8"/>
        <path d="M30,30 L70,30" stroke="${Y}" stroke-width="2"/>
        <circle cx="42" cy="34" r="1.5" fill="${W}"/><circle cx="50" cy="34" r="1.5" fill="${W}"/><circle cx="58" cy="34" r="1.5" fill="${W}"/>
        <path d="M22,44 L30,38 L70,38 L78,44 L70,58 L30,58 Z" fill="${BL}" stroke="${K}" stroke-width=".8"/>
        ${ribbon(50, 'COPPA DI BUON VIN', 5.8)}
        <path d="M36,58 Q24,74 32,88 Q20,96 24,112 L36,112 Q34,96 44,90 L44,62 Z M64,58 Q76,74 68,88 Q80,96 76,112 L64,112 Q66,96 56,90 L56,62 Z" fill="${BL}" stroke="${K}" stroke-width=".8"/>
        <path d="M44,60 L56,60 L58,112 L42,112 Z" fill="${Y}" stroke="${K}" stroke-width=".8"/>
        <path d="M50,62 V110" stroke="${R}" stroke-width="2.5"/>
        <path d="M28,112 Q22,118 30,124 M72,112 Q78,118 70,124" fill="none" stroke="${R}" stroke-width="4" stroke-linecap="round"/>
        <path d="M24,124 L30,116 L70,116 L76,124 L70,134 L30,134 Z" fill="${BL}" stroke="${K}" stroke-width=".8"/>
        <path d="M30,134 L70,134 L66,140 L34,140 Z" fill="${Y}" stroke="${K}" stroke-width=".7"/>
        <path d="M44,125 Q50,120 56,125 Q50,130 44,125 Z" fill="${R}"/>`;
    }
    if (s === 'bate') {
      const flowers = [30, 46, 62, 78, 94].map(y => `<path d="M20,${y} q-3,4 0,9 q3,-5 0,-9 Z M80,${y} q-3,4 0,9 q3,-5 0,-9 Z" fill="${R}" stroke="${K}" stroke-width=".4"/>`).join('');
      return `<path d="M16,22 Q30,30 44,22 M84,22 Q70,30 56,22" stroke="${Y}" stroke-width="2" fill="none"/>${flowers}
        ${baton(50, 78, 116, 0, R, 11)}
        ${ribbon(70, 'MOLTE VOLTE', 6)}${ribbon(86, 'LE BASTONATE', 5.6)}
        <path d="M60,118 Q70,112 82,116 L84,130 Q72,132 60,128 Z" fill="${BL}" stroke="${K}" stroke-width=".7"/>
        <path d="M50,114 Q60,112 62,120 Q62,128 50,128 Q44,126 44,120 Q44,114 50,114 Z" fill="${SKIN}" stroke="${K}" stroke-width=".7"/>
        <path d="M22,138 Q16,126 24,120 Q30,118 32,124 L28,126 L34,132 Q30,140 22,138 Z" fill="${R}" stroke="${K}" stroke-width=".6"/>
        <circle cx="27" cy="123" r=".8" fill="${K}"/><path d="M24,118 l2,-3 l2,3" fill="${R}"/>`;
    }
    // špade
    return `<path d="M16,16 a10,10 0 0 1 14,0 M84,16 a10,10 0 0 0 -14,0" fill="none" stroke="${R}" stroke-width="3"/>
      <path d="M46,20 L46,128 L50,138 L54,128 L54,20 Z" fill="${R}" stroke="${K}" stroke-width=".8"/>
      <path d="M48,24 Q50,20 52,24 L52,40 Q50,44 48,40 Z" fill="${Y}"/>
      <path d="M26,46 L32,38 L68,38 L74,46 Q50,56 26,46 Z" fill="${Y}" stroke="${K}" stroke-width=".8"/>
      <path d="M30,44 l4,-3 l4,3 l4,-3 l4,3 l4,-3 l4,3 l4,-3 l4,3 l4,-3" stroke="${BL}" stroke-width="1.6" fill="none"/>
      ${ribbon(66, 'IL GIOCO DELLA SPADA', 5.4)}
      <path d="M30,96 Q34,86 40,92 L40,120 Q32,122 28,116 Z" fill="${R}" stroke="${K}" stroke-width=".6"/>
      <path d="M70,96 Q66,86 60,92 L60,120 Q68,122 72,116 Z" fill="${R}" stroke="${K}" stroke-width=".6"/>
      <circle cx="33" cy="88" r="4" fill="${Y}" stroke="${K}" stroke-width=".6"/><circle cx="67" cy="88" r="4" fill="${Y}" stroke="${K}" stroke-width=".6"/>
      <path d="M44,100 L50,92 L56,100 L50,112 Z" fill="${Y}" stroke="${K}" stroke-width=".7"/>
      <rect x="20" y="136" width="60" height="4" fill="${Y}" stroke="${K}" stroke-width=".6"/>`;
  }

  // ---------- karta ----------
  function face(cardId) {
    const [s, rs] = cardId.split('-'); const r = +rs;
    let center;
    if (r === 1) center = ace(s);
    else if (r >= 11) center = figure(s, r);
    else if (s === 'dinari') center = COIN_POS[r].map(([x, y]) => coin(x, y, COIN_R[r])).join('');
    else if (s === 'kupe') center = CUP_POS[r].map(([x, y]) => cup(x, y, CUP_S[r])).join('');
    else if (s === 'bate') center = pipsBate(r);
    else center = pipsSpade(r);
    const idx = `<text x="10.5" y="18.4" font-size="${r > 9 ? 11 : 13}" font-weight="700" text-anchor="middle" font-family="Georgia,serif" fill="${K}">${r}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 160" class="card-svg">
      <rect x=".6" y=".6" width="98.8" height="158.8" rx="8" fill="${W}" stroke="#bdbdbd" stroke-width="1.2"/>
      <g>${center}</g>
      <rect x="6" y="6" width="88" height="148" rx="3" fill="none" stroke="${K}" stroke-width=".7"/>
      <rect x="3.2" y="7.2" width="14.6" height="14" fill="${W}"/>${idx}
      <g transform="rotate(180 50 80)"><rect x="3.2" y="7.2" width="14.6" height="14" fill="${W}"/>${idx}</g>
    </svg>`;
  }

  function back() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 160" class="card-svg">
      <defs><pattern id="bp" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="10" height="10" fill="${BL}"/><rect width="5" height="5" fill="#2d62c4"/><rect x="5" y="5" width="5" height="5" fill="#173d84"/></pattern></defs>
      <rect x=".6" y=".6" width="98.8" height="158.8" rx="8" fill="${W}" stroke="#bdbdbd" stroke-width="1.2"/>
      <rect x="6" y="6" width="88" height="148" rx="3" fill="url(#bp)" stroke="${K}" stroke-width=".7"/>
      <rect x="10" y="10" width="80" height="140" rx="2" fill="none" stroke="${Y}" stroke-width="1.2"/>
    </svg>`;
  }

  function suitIcon(s) {
    if (s === 'dinari') return coin(0, 0, 13);
    if (s === 'kupe') return cup(0, 0, .85);
    if (s === 'bate') return baton(0, 0, 30, 30, R, 5);
    return `<g transform="rotate(25)">${straightSword(0, -15, 15)}</g>`;
  }

  root.CardArt = {
    face, back,
    suit: s => `<svg viewBox="-16 -16 32 32" class="suit-svg">${suitIcon(s)}</svg>`,
  };
})(typeof self !== 'undefined' ? self : this);
