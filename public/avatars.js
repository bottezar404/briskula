/* Avatari: generički likovi (SVG) + vlastita slika igrača */
(function (root) {
  'use strict';
  const SK = ['#f6d3b3', '#eebf98', '#d9a06f', '#b87a4b', '#8a5633'];
  // [pozadina, koža, kosa, boja kose, brada, naočale, majica]
  const P = [
    ['#2a5596', 1, 'short', '#3b2414', 'moust', 0, '#e5c77a'],
    ['#b8322a', 0, 'long', '#7a3b12', '', 0, '#1f4fa8'],
    ['#1d7a6a', 2, 'sailor', '#222', 'beard', 0, '#f2f2f2'],
    ['#c58a1e', 0, 'bun', '#c9a04a', '', 1, '#b8322a'],
    ['#5b3f8f', 3, 'curly', '#1b1b1b', '', 0, '#e5c77a'],
    ['#2f6b3a', 1, 'bald', '#8a8a8a', 'beard', 1, '#7a4a24'],
    ['#9b2f62', 2, 'long', '#1b1b1b', '', 0, '#f5c824'],
    ['#33658a', 0, 'cap', '#b8322a', '', 0, '#b8322a'],
    ['#7a4a24', 4, 'short', '#111', '', 1, '#2a5596'],
    ['#4a7a1d', 1, 'curly', '#a0522d', '', 0, '#1d5c3a'],
    ['#24435f', 2, 'bald', '#5a3a22', 'moust', 0, '#e5c77a'],
    ['#b05a2a', 0, 'sailor', '#e0c070', '', 0, '#1f4fa8'],
  ];
  const N = P.length;
  const cache = {};

  function face(i) {
    i = ((i % N) + N) % N;
    if (cache[i]) return cache[i];
    const [bg, sk, hair, hc, fh, gl, shirt] = P[i];
    const skin = SK[sk];
    let back = '', top = '';
    if (hair === 'long') back = `<path d="M15 32 Q14 11 32 11 Q50 11 49 32 L50 50 Q43 47 41 40 L23 40 Q21 47 14 50 Z" fill="${hc}"/>`;
    if (hair === 'bun') back = `<circle cx="32" cy="10" r="6.5" fill="${hc}"/>`;
    if (hair === 'short' || hair === 'long' || hair === 'bun') top = `<path d="M18.5 29 Q17 13 32 13 Q47 13 45.5 29 Q44 20 36 18.5 Q30 22 21 21 Q19 24 18.5 29 Z" fill="${hc}"/>`;
    if (hair === 'curly') top = [[21, 20], [26, 15.5], [32, 14], [38, 15.5], [43, 20], [19, 26], [45, 26]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.2" fill="${hc}"/>`).join('');
    if (hair === 'bald') top = `<path d="M18.6 33 Q18 25 21 23 L21.5 31 Z M45.4 33 Q46 25 43 23 L42.5 31 Z" fill="${hc}"/>`;
    if (hair === 'cap') top = `<path d="M18.5 26 Q18 12 32 12 Q46 12 45.5 26 Z" fill="${hc}"/><path d="M30 25 L52 25 Q52 28.5 46 28.5 L30 28.5 Z" fill="${hc}" opacity=".85"/><circle cx="32" cy="12.5" r="1.6" fill="#fff" opacity=".7"/>`;
    if (hair === 'sailor') top = `<path d="M19 24 Q19 14 32 14 Q45 14 45 24 Z" fill="#fbfbfb"/><rect x="18" y="21.5" width="28" height="4.5" rx="1.5" fill="#1f4fa8"/><path d="M19 26 Q18 18 21 16" stroke="${hc}" stroke-width="0" fill="none"/>`;
    const beard = fh === 'beard' ? `<path d="M18.8 31 Q19 49 32 49 Q45 49 45.2 31 Q43 41 37 40 Q32 38 27 40 Q21 41 18.8 31 Z" fill="${hc}"/>` : '';
    const moust = fh === 'moust' || fh === 'beard' ? `<path d="M25.5 37 Q29 33.6 32 35.6 Q35 33.6 38.5 37 Q35 36.4 32 37.6 Q29 36.4 25.5 37 Z" fill="${fh === 'beard' ? shade(hc) : hc}"/>` : '';
    const glasses = gl ? `<g fill="none" stroke="#1d1d1d" stroke-width="1.5"><circle cx="26.8" cy="30" r="4.3"/><circle cx="37.2" cy="30" r="4.3"/><path d="M31.1 29.6 Q32 28.8 32.9 29.6"/></g>` : '';
    const svg = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="${bg}"/>
      ${back}
      <path d="M9 64 Q11 47 32 46 Q53 47 55 64 Z" fill="${shirt}"/>
      <rect x="27.5" y="40" width="9" height="8" rx="3" fill="${skin}"/>
      <path d="M27 46.5 Q32 51 37 46.5" stroke="rgba(0,0,0,.18)" stroke-width="1.4" fill="none"/>
      <circle cx="18.6" cy="31" r="3" fill="${skin}"/><circle cx="45.4" cy="31" r="3" fill="${skin}"/>
      <ellipse cx="32" cy="29.5" rx="13.5" ry="15" fill="${skin}"/>
      ${beard}${top}
      <circle cx="26.8" cy="30" r="1.9" fill="#2b1d14"/><circle cx="37.2" cy="30" r="1.9" fill="#2b1d14"/>
      <circle cx="23.5" cy="35" r="2.3" fill="#e46a5a" opacity=".22"/><circle cx="40.5" cy="35" r="2.3" fill="#e46a5a" opacity=".22"/>
      ${moust}
      <path d="M27.5 38.6 Q32 42.4 36.5 38.6" stroke="#5a2a1a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      ${glasses}
    </svg>`;
    return (cache[i] = svg);
  }
  function shade(c) { return c === '#8a8a8a' ? '#6c6c6c' : c; }

  // stalni (ali nasumični izgledom) avatar za bota prema imenu
  function forName(name) {
    let h = 7;
    for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return 'e' + (h % N);
  }

  // av: 'eN' (generički) ili 'i:ID' (slika iz imgs mape); vraća HTML sadržaj kruga
  function inner(av, imgs, name) {
    if (typeof av === 'string' && av.startsWith('i:') && imgs && imgs[av.slice(2)]) {
      const src = String(imgs[av.slice(2)]).replace(/[^A-Za-z0-9+/=:;,.-]/g, '');
      return `<img src="${src}" alt="" draggable="false">`;
    }
    const m = /^e(\d{1,2})$/.exec(av || '');
    return face(m ? +m[1] : +forName(name).slice(1));
  }

  // smanji i izreži sliku na kvadrat (JPEG ~96 px), da bude mala za online
  const MAX_FILE = 25 * 1024 * 1024, OUT = 112, MAX_LEN = 14000;
  function fromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('Nije odabrana slika.'));
      const typeOk = /^image\//.test(file.type) || (!file.type && /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(file.name || ''));
      if (!typeOk) return reject(new Error('To nije slika. Odaberi JPG, PNG ili sličnu sliku.'));
      if (file.size > MAX_FILE) return reject(new Error('Slika je prevelika (najviše 25 MB).'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth, h = img.naturalHeight, s = Math.min(w, h);
          if (!s || w < 16 || h < 16) throw new Error('Slika je premala.');
          const c = document.createElement('canvas'); c.width = c.height = OUT;
          const x = c.getContext('2d');
          x.fillStyle = '#fff'; x.fillRect(0, 0, OUT, OUT);
          x.imageSmoothingQuality = 'high';
          // izrez po sredini, malo više prema vrhu (lica su obično gore)
          x.drawImage(img, (w - s) / 2, h > w ? (h - s) * .3 : 0, s, s, 0, 0, OUT, OUT);
          let q = .86, d = c.toDataURL('image/jpeg', q);
          while (d.length > MAX_LEN && q > .35) { q -= .1; d = c.toDataURL('image/jpeg', q); }
          if (!/^data:image\/jpeg;base64,/.test(d) || d.length > MAX_LEN) throw new Error('Sliku nije moguće smanjiti.');
          resolve(d);
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Ta se slika ne može otvoriti. Probaj drugu (JPG ili PNG).')); };
      img.src = url;
    });
  }

  const api = { N, face, forName, inner, fromFile, MAX_LEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Avatars = api;
})(typeof window !== 'undefined' ? window : globalThis);
