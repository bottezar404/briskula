/* Kviz „Znalac” – slike za odgovore (dijeli se između preglednika i servera)
 *
 * Sve slike su nacrtane ovdje kao jednostavan SVG (bez vanjskih datoteka): zastave
 * (pojednostavljene, bez sitnih detalja grbova), prometni znakovi, geometrijski likovi
 * i znakovi francuskih karata. U pitanjima se slika piše kao odgovor '#oznaka',
 * npr. 'Koja je zastava Francuske?|#fr|#it|#ie|#be'.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KvizSlike = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const W = 30, H = 20; // zastave: 3:2
  const svgWrap = (body, vb) => `<svg viewBox="${vb || `0 0 ${W} ${H}`}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;
  const rect = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
  // vodoravne pruge (w = težine pruga)
  const hs = (cs, w) => { w = w || cs.map(() => 1); const t = w.reduce((a, b) => a + b, 0); let y = 0; return cs.map((c, i) => { const h = H * w[i] / t, r = rect(0, y, W, h + 0.05, c); y += h; return r; }).join(''); };
  // okomite pruge
  const vs = cs => cs.map((c, i) => rect(W * i / cs.length, 0, W / cs.length + 0.05, H, c)).join('');
  // nordijski križ (inner = uži križ druge boje)
  const nordic = (bg, cr, inner) => rect(0, 0, W, H, bg) + rect(8, 0, 4, H, cr) + rect(0, 8, W, 4, cr) + (inner ? rect(9, 0, 2, H, inner) + rect(0, 9, W, 2, inner) : '');
  const star = (cx, cy, r, c, rot) => {
    const p = [];
    for (let i = 0; i < 10; i++) { const a = (rot || 0) + Math.PI / 5 * i - Math.PI / 2, rr = i % 2 ? r * 0.382 : r; p.push((cx + rr * Math.cos(a)).toFixed(2) + ',' + (cy + rr * Math.sin(a)).toFixed(2)); }
    return `<polygon points="${p.join(' ')}" fill="${c}"/>`;
  };
  // pojednostavljeni grbovi
  const hrShield = (x, y, s) => { // šahovnica 5×5, prvo polje crveno
    let o = '';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) o += rect(x + c * s, y + r * s, s + 0.02, s + 0.02, (r + c) % 2 ? '#fff' : '#FF0000');
    return o + `<path d="M${x} ${y + 5 * s} q${2.5 * s} ${1.6 * s} ${5 * s} 0" fill="#FF0000"/>`;
  };

  const RED = '#D52B1E', WHITE = '#fff';
  const FLAGS = {
    fr: ['Francuska', vs(['#0055A4', WHITE, '#EF4135'])],
    it: ['Italija', vs(['#009246', WHITE, '#CE2B37'])],
    ie: ['Irska', vs(['#169B62', WHITE, '#FF883E'])],
    ci: ['Obala Bjelokosti', vs(['#F77F00', WHITE, '#009E60'])],
    be: ['Belgija', vs(['#000', '#FDDA24', '#EF3340'])],
    ro: ['Rumunjska', vs(['#002B7F', '#FCD116', '#CE1126'])],
    ml: ['Mali', vs(['#14B53A', '#FCD116', '#CE1126'])],
    gn: ['Gvineja', vs(['#CE1126', '#FCD116', '#009460'])],
    ng: ['Nigerija', vs(['#008751', WHITE, '#008751'])],
    pe: ['Peru', vs(['#D91023', WHITE, '#D91023'])],
    de: ['Njemačka', hs(['#000', '#DD0000', '#FFCE00'])],
    nl: ['Nizozemska', hs(['#AE1C28', WHITE, '#21468B'])],
    lu: ['Luksemburg', hs(['#EF3340', WHITE, '#00A3E0'])],
    at: ['Austrija', hs(['#C8102E', WHITE, '#C8102E'])],
    lv: ['Latvija', hs(['#9E3039', WHITE, '#9E3039'], [2, 1, 2])],
    hu: ['Mađarska', hs(['#CE2939', WHITE, '#477050'])],
    bg: ['Bugarska', hs([WHITE, '#00966E', '#D62612'])],
    ru: ['Rusija', hs([WHITE, '#0039A6', RED])],
    pl: ['Poljska', hs([WHITE, '#DC143C'])],
    id: ['Indonezija', hs(['#CE1126', WHITE])],
    ua: ['Ukrajina', hs(['#0057B7', '#FFD700'])],
    ee: ['Estonija', hs(['#0072CE', '#000', WHITE])],
    lt: ['Litva', hs(['#FDB913', '#006A44', '#C1272D'])],
    co: ['Kolumbija', hs(['#FCD116', '#003893', '#CE1126'], [2, 1, 1])],
    ga: ['Gabon', hs(['#009E60', '#FCD116', '#3A75C4'])],
    sl: ['Sijera Leone', hs(['#1EB53A', WHITE, '#0072C6'])],
    ye: ['Jemen', hs(['#CE1126', WHITE, '#000'])],
    th: ['Tajland', hs(['#A51931', '#F4F5F8', '#2D2A4A', '#F4F5F8', '#A51931'], [1, 1, 2, 1, 1])],
    bo: ['Bolivija', hs(['#D52B1E', '#F9E300', '#007934'])],
    mu: ['Mauricijus', hs(['#EA2839', '#1A206D', '#FFD500', '#00A551'])],
    se: ['Švedska', nordic('#006AA7', '#FECC00')],
    dk: ['Danska', nordic('#C8102E', WHITE)],
    no: ['Norveška', nordic('#BA0C2F', WHITE, '#00205B')],
    fi: ['Finska', nordic(WHITE, '#002F6C')],
    is: ['Island', nordic('#02529C', WHITE, '#DC1E35')],
    jp: ['Japan', rect(0, 0, W, H, WHITE) + `<circle cx="15" cy="10" r="6" fill="#BC002D"/>`],
    bd: ['Bangladeš', rect(0, 0, W, H, '#006A4E') + `<circle cx="13.5" cy="10" r="6" fill="#F42A41"/>`],
    pw: ['Palau', rect(0, 0, W, H, '#4AADD6') + `<circle cx="13" cy="10" r="6" fill="#FFDE00"/>`],
    ch: ['Švicarska', rect(0, 0, W, H, '#DA291C') + rect(13, 4, 4, 12, WHITE) + rect(9, 8, 12, 4, WHITE)],
    gr: ['Grčka', [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => rect(0, i * H / 9, W, H / 9 + 0.05, i % 2 ? WHITE : '#0D5EAF')).join('') + rect(0, 0, 11.1, 11.1, '#0D5EAF') + rect(4.44, 0, 2.22, 11.1, WHITE) + rect(0, 4.44, 11.1, 2.22, WHITE)],
    cz: ['Češka', hs([WHITE, '#D7141A']) + `<polygon points="0,0 15,10 0,20" fill="#11457E"/>`],
    jm: ['Jamajka', rect(0, 0, W, H, '#009B3A') + `<polygon points="0,0 15,10 0,20" fill="#000"/><polygon points="30,0 15,10 30,20" fill="#000"/>` +
      `<path d="M0 0 L30 20 M30 0 L0 20" stroke="#FED100" stroke-width="3"/>`],
    gb: ['Ujedinjeno Kraljevstvo', rect(0, 0, W, H, '#012169') + `<path d="M0 0 L30 20 M30 0 L0 20" stroke="${WHITE}" stroke-width="4"/>` +
      `<path d="M0 0 L30 20 M30 0 L0 20" stroke="#C8102E" stroke-width="1.4"/>` + rect(12.5, 0, 5, H, WHITE) + rect(0, 7.5, W, 5, WHITE) + rect(13.5, 0, 3, H, '#C8102E') + rect(0, 8.5, W, 3, '#C8102E')],
    kw: ['Kuvajt', hs(['#007A3D', WHITE, '#CE1126']) + `<polygon points="0,0 7.5,6.67 7.5,13.33 0,20" fill="#000"/>`],
    ae: ['Ujedinjeni Arapski Emirati', hs(['#00732F', WHITE, '#000']) + rect(0, 0, 7.5, H, '#FF0000')],
    bs: ['Bahami', hs(['#00778B', '#FFC72C', '#00778B']) + `<polygon points="0,0 13,10 0,20" fill="#000"/>`],
    tr: ['Turska', rect(0, 0, W, H, '#E30A17') + `<circle cx="11" cy="10" r="5" fill="${WHITE}"/><circle cx="12.25" cy="10" r="4" fill="#E30A17"/>` + star(17, 10, 2.4, WHITE, -Math.PI / 2)],
    vn: ['Vijetnam', rect(0, 0, W, H, '#DA251D') + star(15, 10.4, 6, '#FFFF00')],
    cn: ['Kina', rect(0, 0, W, H, '#EE1C25') + star(5, 5, 3, '#FFFF00') + star(10, 2, 1, '#FFFF00') + star(12, 4, 1, '#FFFF00') + star(12, 7, 1, '#FFFF00') + star(10, 9, 1, '#FFFF00')],
    hr: ['Hrvatska', hs(['#FF0000', WHITE, '#171796']) + hrShield(12.5, 5.2, 1)],
    si: ['Slovenija', hs([WHITE, '#005DA4', '#ED1C24']) + `<path d="M6 3.5 h5 v4.2 q0 2.6 -2.5 3.6 q-2.5 -1 -2.5 -3.6 z" fill="#005DA4" stroke="#ED1C24" stroke-width="0.5"/><path d="M6.4 8.6 l1.2 -1.6 l0.9 1 l0.9 -1 l1.2 1.6 z" fill="${WHITE}"/>`],
    sk: ['Slovačka', hs([WHITE, '#0B4EA2', '#EE1C25']) + `<path d="M5.5 4 h6 v5 q0 3 -3 4.3 q-3 -1.3 -3 -4.3 z" fill="#EE1C25" stroke="${WHITE}" stroke-width="0.5"/>` +
      rect(8.1, 5.2, 0.8, 5.5, WHITE) + rect(7, 6.4, 3, 0.7, WHITE) + rect(6.6, 7.8, 3.8, 0.7, WHITE) + `<path d="M5.9 11.3 q1.3 -1.5 2.6 0 q1.3 -1.5 2.6 0 l-0.3 0.8 q-2.3 1.3 -4.6 0 z" fill="#0B4EA2"/>`],
  };

  // prometni znakovi (viewBox 0 0 40 40)
  const SV = '0 0 40 40';
  const oct = (r, cx, cy) => { const p = []; for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; p.push((cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2)); } return p.join(' '); };
  const SIGNS = {
    stop: ['Obvezno zaustavljanje (STOP)', `<polygon points="${oct(19, 20, 20)}" fill="${WHITE}"/><polygon points="${oct(17.5, 20, 20)}" fill="#C8102E"/><text x="20" y="24.5" font-size="11" font-weight="700" font-family="Arial,sans-serif" text-anchor="middle" fill="${WHITE}">STOP</text>`],
    prednost: ['Raskrižje s cestom s prednošću prolaska', `<polygon points="2,5 38,5 20,36" fill="#C8102E"/><polygon points="8.5,8.7 31.5,8.7 20,28.5" fill="${WHITE}"/>`],
    glavna: ['Cesta s prednošću prolaska', `<polygon points="20,1 39,20 20,39 1,20" fill="${WHITE}" stroke="#333" stroke-width="0.6"/><polygon points="20,8 32,20 20,32 8,20" fill="#FFC72C"/>`],
    zabrana: ['Zabrana prometa u oba smjera', `<circle cx="20" cy="20" r="18" fill="#C8102E"/><circle cx="20" cy="20" r="13.5" fill="${WHITE}"/>`],
    jedan: ['Zabrana prometa u jednom smjeru', `<circle cx="20" cy="20" r="18" fill="#C8102E"/>${rect(8, 17, 24, 6, WHITE)}`],
    parkzab: ['Zabrana parkiranja', `<circle cx="20" cy="20" r="18" fill="#C8102E"/><circle cx="20" cy="20" r="14" fill="#0050A0"/><path d="M10.1 10.1 L29.9 29.9" stroke="#C8102E" stroke-width="3.5"/>`],
    zaust: ['Zabrana zaustavljanja i parkiranja', `<circle cx="20" cy="20" r="18" fill="#C8102E"/><circle cx="20" cy="20" r="14" fill="#0050A0"/><path d="M10.1 10.1 L29.9 29.9 M29.9 10.1 L10.1 29.9" stroke="#C8102E" stroke-width="3.5"/>`],
    parking: ['Parkiralište', `${rect(2, 2, 36, 36, '#0050A0')}<text x="20" y="30" font-size="27" font-weight="700" font-family="Arial,sans-serif" text-anchor="middle" fill="${WHITE}">P</text>`],
    opasnost: ['Opasnost na cesti', `<polygon points="20,3 38,35 2,35" fill="#C8102E"/><polygon points="20,10 31.5,31 8.5,31" fill="${WHITE}"/>${rect(18.8, 15, 2.4, 9, '#000')}${rect(18.8, 26, 2.4, 2.4, '#000')}`],
    pjesaci: ['Obilježeni pješački prijelaz', `${rect(2, 2, 36, 36, '#0050A0')}<polygon points="20,6 35,33 5,33" fill="${WHITE}"/>${[0, 1, 2, 3].map(i => rect(10 + i * 5.4, 27, 3, 4, '#000')).join('')}<circle cx="21" cy="14" r="2" fill="#000"/><path d="M20.5 16.5 l-2 6 l-2.5 3.5 M20.5 16.5 l1.5 5.5 l2.5 3.5" stroke="#000" stroke-width="1.6" fill="none"/>`],
  };

  // geometrijski likovi (viewBox 0 0 40 40)
  const poly = (n, r, rot) => { const p = []; for (let i = 0; i < n; i++) { const a = (rot || -Math.PI / 2) + i * 2 * Math.PI / n; p.push((20 + r * Math.cos(a)).toFixed(2) + ',' + (21 + r * Math.sin(a)).toFixed(2)); } return `<polygon points="${p.join(' ')}" fill="#E5C77A" stroke="#7a5a1a" stroke-width="1"/>`; };
  const SHAPES = {
    trokut: ['Trokut', poly(3, 17)],
    kvadrat: ['Kvadrat', poly(4, 17, -Math.PI / 4)],
    peterokut: ['Peterokut', poly(5, 17)],
    sesterokut: ['Šesterokut', poly(6, 17)],
    sedmerokut: ['Sedmerokut', poly(7, 17)],
    osmerokut: ['Osmerokut', poly(8, 17, -Math.PI / 8)],
    romb: ['Romb', `<polygon points="20,3 31,21 20,39 9,21" fill="#E5C77A" stroke="#7a5a1a" stroke-width="1"/>`],
    trapez: ['Trapez', `<polygon points="12,10 28,10 37,32 3,32" fill="#E5C77A" stroke="#7a5a1a" stroke-width="1"/>`],
    paralelogram: ['Paralelogram', `<polygon points="12,10 38,10 28,32 2,32" fill="#E5C77A" stroke="#7a5a1a" stroke-width="1"/>`],
    pravokutnik: ['Pravokutnik', `<polygon points="3,11 37,11 37,31 3,31" fill="#E5C77A" stroke="#7a5a1a" stroke-width="1"/>`],
    elipsa: ['Elipsa', `<ellipse cx="20" cy="21" rx="18" ry="11" fill="#E5C77A" stroke="#7a5a1a" stroke-width="1"/>`],
    krug: ['Krug', `<circle cx="20" cy="21" r="17" fill="#E5C77A" stroke="#7a5a1a" stroke-width="1"/>`],
  };

  // znakovi francuskih karata (viewBox 0 0 40 40)
  const SUITS = {
    herc: ['Herc', `<path d="M20 35 C 6 24 3 17 3 12 C 3 6 8 3 12 3 C 16 3 19 6 20 9 C 21 6 24 3 28 3 C 32 3 37 6 37 12 C 37 17 34 24 20 35 Z" fill="#D21E2B"/>`],
    karo: ['Karo', `<path d="M20 2 L34 20 L20 38 L6 20 Z" fill="#D21E2B"/>`],
    pik: ['Pik', `<path d="M20 3 C 34 14 37 19 37 24 C 37 29 33 31 29.5 31 C 26 31 23 29 21.5 27 C 22 31 24 34 27 37 H13 C 16 34 18 31 18.5 27 C 17 29 14 31 10.5 31 C 7 31 3 29 3 24 C 3 19 6 14 20 3 Z" fill="#111"/>`],
    tref: ['Tref', `<circle cx="20" cy="11" r="7.5" fill="#111"/><circle cx="11" cy="23" r="7.5" fill="#111"/><circle cx="29" cy="23" r="7.5" fill="#111"/>${rect(18, 18, 4, 8, '#111')}<path d="M20 22 C 20 29 18 33 14 37 H26 C 22 33 20 29 20 22 Z" fill="#111"/>`],
  };

  const ALL = {};
  for (const [k, [name, body]] of Object.entries(FLAGS)) ALL[k] = { name, svg: svgWrap(rect(0, 0, W, H, '#ccc') + body), kind: 'flag' };
  for (const [k, [name, body]] of Object.entries(SIGNS)) ALL[k] = { name, svg: svgWrap(body, SV), kind: 'sign' };
  for (const [k, [name, body]] of Object.entries(SHAPES)) ALL[k] = { name, svg: svgWrap(body, SV), kind: 'shape' };
  for (const [k, [name, body]] of Object.entries(SUITS)) ALL[k] = { name, svg: svgWrap(body, SV), kind: 'suit' };

  const isImg = o => typeof o === 'string' && o[0] === '#' && !!ALL[o.slice(1)];
  return {
    ALL,
    isImg,
    has: id => !!ALL[id],
    svg: id => (ALL[id] ? ALL[id].svg : ''),
    kind: id => (ALL[id] ? ALL[id].kind : null),
    /** tekst odgovora: za sliku njezin naziv (npr. u povijesti partija) */
    label: o => (isImg(o) ? ALL[o.slice(1)].name : String(o)),
  };
});
