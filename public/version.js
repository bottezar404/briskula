// Broj verzije i "Što je novo" (patch notes).
// Svaki PR koji mijenja igru: podigni verziju ovdje I u package.json (isti broj)
// i dodaj NOVI unos NA VRH popisa: { v, d (datum), t (kratko, jedna rečenica) }.
//   x.Y.0 – nova mogućnost (nova igra, računi, poruke...)
//   x.y.Z – popravak ili sitna promjena
//   X.0.0 – velika promjena
// test/version.js provjerava da se broj slaže s package.json.
(function () {
  const NOTES = [
    { v: '1.16.0', d: '2026-11-26', t: 'Povijest zadnjih 20 online partija, potez po potez. Admin može dati privremenu lozinku igraču koji je zaboravi.' },
    { v: '1.15.0', d: '2026-11-26', t: 'Kviz: stalne sobe (Miješano i po kategorijama) u koje se ulazi bilo kad, i pitanja na pisanje.' },
    { v: '1.14.0', d: '2026-11-26', t: 'Nova igra: kviz Znalac (414 pitanja, 3 runde, brži točan odgovor nosi više bodova), s botovima ili online.' },
    { v: '1.13.0', d: '2026-11-26', t: 'Nova igra: Čovječe ne ljuti se (2–4 igrača, s botovima ili online s prijateljima).' },
    { v: '1.12.0', d: '2026-11-26', t: 'Grupni chat za sve koji su online: piši svima, pozovi ih u svoju sobu ili dodaj za prijatelja klikom na ime.' },
    { v: '1.11.3', d: '2026-11-26', t: 'Bolja sigurnost stranice (sigurnosna zaglavlja, CSP, HSTS) i server se više ne može srušiti neispravnim linkom.' },
    { v: '1.11.2', d: '2026-11-26', t: 'Popravljena preklapanja tekstova u igri na mobitelu i PC-u.' },
    { v: '1.11.1', d: '2026-11-26', t: 'Kod online prijatelja piše u kojoj su igri (i kad igraju protiv botova).' },
    { v: '1.11.0', d: '2026-11-26', t: 'Broj verzije na dnu stranice i popis promjena („Što je novo”).' },
    { v: '1.10.0', d: '2026-11-26', t: 'Poker s običnim kartama (52) po standardnim pravilima i žetoni na računu.' },
    { v: '1.9.0', d: '2026-11-26', t: 'Početni ekran: popis online prijatelja i gumb Pozovi.' },
    { v: '1.8.0', d: '2026-11-26', t: 'Poruke među prijateljima, s oznakom nepročitanih i „viđeno”.' },
    { v: '1.7.0', d: '2026-11-26', t: 'Korisnički računi: registracija, prijava, statistika i prijatelji.' },
    { v: '1.6.1', d: '2026-11-25', t: 'Pametniji botovi u briškuli i trešeti.' },
    { v: '1.6.0', d: '2026-11-25', t: 'Poker (Texas Hold’em) i Turnir: briškula → trešeta → poker.' },
    { v: '1.5.2', d: '2026-11-25', t: 'Online se tijekom ruke ne prikazuju bodovi, brojite ih sami.' },
    { v: '1.5.1', d: '2026-11-25', t: 'Kompaktniji stol na mobitelu.' },
    { v: '1.5.0', d: '2026-11-25', t: 'Zbrojeni bodovi para i dužina pišulinca ispod avatara.' },
    { v: '1.4.1', d: '2026-11-25', t: 'Brža trešeta: brži botovi i kraće pauze.' },
    { v: '1.4.0', d: '2026-11-25', t: 'Timer za potez u online igri (15/30/60 s).' },
    { v: '1.3.0', d: '2026-11-25', t: 'Avatari, vlastita slika i „Dužina pišulinca”.' },
    { v: '1.2.0', d: '2026-11-25', t: 'Chi fa meno i za briškulu i za trešetu.' },
    { v: '1.1.0', d: '2026-11-25', t: 'Nova igra: trešeta.' },
    { v: '1.0.0', d: '2026-11-25', t: 'Briškula protiv botova i online, u dvoje, troje i parovima, s chatom.' },
  ];
  const api = { VERSION: NOTES[0].v, NOTES };
  if (typeof module !== 'undefined') module.exports = api;
  else window.BRK_VER = api;
})();
