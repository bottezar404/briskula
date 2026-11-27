// Trgovina i dukati: popis predmeta (isti na serveru i u pregledniku).
// Dukati se zarađuju igranjem (pobjede nose najviše), a troše na ukrase:
//   fr – okvir oko avatara, bd – značka uz avatar, ti – titula ispod imena (to vide svi),
//   tb – boja stola, kb – poleđina karata (to vidiš samo ti).
// Cijene i zarada su samo ovdje: server provjerava kupnju prema ovom popisu.
(function () {
  const SLOTS = [
    { id: 'fr', name: 'Okviri', icon: '⭕', desc: 'Okvir oko tvog avatara. Vide ga svi igrači.' },
    { id: 'bd', name: 'Značke', icon: '🏅', desc: 'Sličica uz tvoj avatar u igri, sobi i chatu. Vide je svi.' },
    { id: 'ti', name: 'Titule', icon: '📜', desc: 'Titula uz tvoje ime u sobi, chatu i kod prijatelja.' },
    { id: 'tb', name: 'Stolovi', icon: '🟩', desc: 'Boja stola i pozadine. Vidiš je samo ti.' },
    { id: 'kb', name: 'Karte', icon: '🂠', desc: 'Izgled poleđine karata. Vidiš ga samo ti.' },
  ];
  // id je jedinstven na cijelom popisu; v = što se prikazuje (emoji za značku, tekst za titulu)
  const ITEMS = [
    { id: 'fr_srebro', slot: 'fr', name: 'Srebrni', price: 80 },
    { id: 'fr_zlato', slot: 'fr', name: 'Zlatni', price: 150 },
    { id: 'fr_more', slot: 'fr', name: 'Jadransko more', price: 200 },
    { id: 'fr_maslina', slot: 'fr', name: 'Maslinov vijenac', price: 250 },
    { id: 'fr_neon', slot: 'fr', name: 'Neon', price: 300 },
    { id: 'fr_vatra', slot: 'fr', name: 'Vatreni', price: 400 },
    { id: 'fr_duga', slot: 'fr', name: 'Duga', price: 600 },
    { id: 'fr_kralj', slot: 'fr', name: 'Kraljevski', price: 800 },
    { id: 'fr_dijamant', slot: 'fr', name: 'Dijamantni', price: 1200 },

    { id: 'bd_sidro', slot: 'bd', name: 'Sidro', v: '⚓', price: 50 },
    { id: 'bd_riba', slot: 'bd', name: 'Riba', v: '🐟', price: 50 },
    { id: 'bd_maslina', slot: 'bd', name: 'Maslina', v: '🫒', price: 70 },
    { id: 'bd_bevanda', slot: 'bd', name: 'Bevanda', v: '🍷', price: 100 },
    { id: 'bd_joker', slot: 'bd', name: 'Joker', v: '🃏', price: 100 },
    { id: 'bd_zvijezda', slot: 'bd', name: 'Zvijezda', v: '⭐', price: 120 },
    { id: 'bd_sunce', slot: 'bd', name: 'Sunce', v: '☀️', price: 120 },
    { id: 'bd_vatra', slot: 'bd', name: 'Vatra', v: '🔥', price: 150 },
    { id: 'bd_sesir', slot: 'bd', name: 'Šešir', v: '🎩', price: 150 },
    { id: 'bd_galeb', slot: 'bd', name: 'Galeb', v: '🕊️', price: 150 },
    { id: 'bd_hobotnica', slot: 'bd', name: 'Hobotnica', v: '🐙', price: 200 },
    { id: 'bd_lav', slot: 'bd', name: 'Lav', v: '🦁', price: 250 },
    { id: 'bd_dijamant', slot: 'bd', name: 'Dijamant', v: '💎', price: 400 },
    { id: 'bd_kruna', slot: 'bd', name: 'Kruna', v: '👑', price: 600 },
    { id: 'bd_pehar', slot: 'bd', name: 'Pehar', v: '🏆', price: 1000 },

    { id: 'ti_sjor', slot: 'ti', name: 'Šjor', price: 100 },
    { id: 'ti_barba', slot: 'ti', name: 'Barba', price: 150 },
    { id: 'ti_ribar', slot: 'ti', name: 'Ribar', price: 150 },
    { id: 'ti_kapetan', slot: 'ti', name: 'Kapetan', price: 300 },
    { id: 'ti_pokeras', slot: 'ti', name: 'Pokeraš', price: 300 },
    { id: 'ti_znalac', slot: 'ti', name: 'Znalac', price: 300 },
    { id: 'ti_briskula', slot: 'ti', name: 'Majstor briškule', price: 400 },
    { id: 'ti_treseta', slot: 'ti', name: 'Kralj trešete', price: 400 },
    { id: 'ti_legenda', slot: 'ti', name: 'Legenda', price: 1000 },
    { id: 'ti_car', slot: 'ti', name: 'Car Dalmacije', price: 1500 },

    { id: 'tb_more', slot: 'tb', name: 'Plavi', price: 150 },
    { id: 'tb_bordo', slot: 'tb', name: 'Bordo', price: 150 },
    { id: 'tb_drvo', slot: 'tb', name: 'Drveni', price: 250 },
    { id: 'tb_ljubicasti', slot: 'tb', name: 'Ljubičasti', price: 250 },
    { id: 'tb_noc', slot: 'tb', name: 'Ponoć', price: 300 },

    { id: 'kb_crvena', slot: 'kb', name: 'Crvena', price: 150 },
    { id: 'kb_zelena', slot: 'kb', name: 'Zelena', price: 150 },
    { id: 'kb_crna', slot: 'kb', name: 'Crno-zlatna', price: 400 },
  ];
  const BY_ID = {};
  for (const it of ITEMS) BY_ID[it.id] = it;

  // koliko dukata nosi što (server dodjeljuje, preglednik samo prikazuje)
  const EARN = {
    start: 100,       // novi račun (stari računi dobiju i 5 po dosadašnjoj pobjedi, najviše 1000)
    perOldWin: 5, oldMax: 1000,
    daily: 40,        // prva prijava u danu
    onlineWin: 50, onlineDraw: 25, onlineLoss: 15, // online partija (barem dva čovjeka za stolom)
    tourWin: 80,      // dodatno za pobjedu u turniru
    kvizWin: 30, kvizPlay: 10,                    // online kviz (krug u stalnoj sobi)
    kvizDay: 200,     // prvo mjesto na dnevnoj ljestvici kviza (dodjela u ponoć)
    botWin: { easy: 5, normal: 10, hard: 15 }, botLoss: 3, botDay: 250, // protiv botova: najviše botDay na dan
  };

  const api = { CUR: 'Dukati', cur: n => n % 10 === 1 && n % 100 !== 11 ? 'dukat' : 'dukata', SLOTS, ITEMS, BY_ID, EARN };
  if (typeof module !== 'undefined') module.exports = api;
  else window.Shop = api;
})();
