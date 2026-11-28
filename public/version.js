// Broj verzije i "Što je novo" (patch notes).
// Svaki PR koji mijenja igru: podigni verziju ovdje I u package.json (isti broj)
// i dodaj NOVI unos NA VRH popisa: { v, d (datum), t (kratko, jedna rečenica) }.
//   x.Y.0 – nova mogućnost (nova igra, računi, poruke...)
//   x.y.Z – popravak ili sitna promjena
//   X.0.0 – velika promjena
// test/version.js provjerava da se broj slaže s package.json.
(function () {
  const NOTES = [
    { v: '1.28.1', d: '2026-11-28', t: 'Pravednije dijeljenje: u online sobi prvi potez se sada izmjenjuje i nakon povratka u sobu, a karte se miješaju sigurnijim generatorom.' },
    { v: '1.28.0', d: '2026-11-28', t: 'Skakavac: upravljanje povlačenjem prsta i automatski skok, ose, grančice koje se lome i pomiču, zvjezdice i gljiva-opruga.' },
    { v: '1.27.0', d: '2026-11-28', t: 'Nova igra: Skakavac – skači po grančicama sve više prema nebu, slaži kombo skokove i obori rekord na ljestvici (mobitel i PC).' },
    { v: '1.26.0', d: '2026-11-27', t: 'Dnevna nagrada u kvizu: tko je u ponoć prvi na novoj ljestvici "Danas", dobiva 200 dukata za trgovinu.' },
    { v: '1.25.1', d: '2026-11-27', t: 'Statistika kviza: umjesto točnih odgovora po kategoriji sad piše broj odigranih partija (krugova) u svakoj kategoriji, plus Miješano.' },
    { v: '1.25.0', d: '2026-11-27', t: 'Više dukata: online pobjeda 50, protiv botova 5/10/15 i do 250 na dan, kviz 30/10, dnevni bonus 40.' },
    { v: '1.24.1', d: '2026-11-27', t: 'Sati igranja vide se i kod drugih igrača (u igri i među online prijateljima), kviz sam u sobi sad se broji u statistiku i daje dukate.' },
    { v: '1.24.0', d: '2026-11-27', t: 'Kviz: gotovo 5000 novih pitanja u svim kategorijama (sad ih je oko 7000), s ponuđenim odgovorima i na pisanje.' },
    { v: '1.23.0', d: '2026-11-26', t: 'Kutija za prijedloge: na dnu izbornika prijavljeni igrači mogu napisati što bi se još moglo napraviti.' },
    { v: '1.22.0', d: '2026-11-26', t: 'Profil igrača: klik na prijatelja ili igrača otvara njegovu statistiku; u prijateljima se vide pobjede, partije i sati.' },
    { v: '1.21.0', d: '2026-11-26', t: 'Dukati i trgovina: pobjedama zarađuješ dukate i kupuješ okvire za avatar, značke, titule, boje stola i poleđine karata.' },
    { v: '1.20.0', d: '2026-11-26', t: 'Umjesto „Dužine pišulinca” statistika: pobjede, partije i sati igranja (izbornik, Statistika, ispod avatara).' },
    { v: '1.19.0', d: '2026-11-26', t: 'Kviz: nova pitanja gdje su odgovori slike: zastave država, prometni znakovi, geometrijski likovi i boje karata.' },
    { v: '1.18.2', d: '2026-11-26', t: 'Grupni chat je samo za prijavljene, a gosti na ljestvici kviza umjesto imena vide „Igrač 1”, „Igrač 2”…' },
    { v: '1.18.1', d: '2026-11-26', t: 'Kviz: na mobitelu se tipkovnica više ne zatvara dok upisuješ odgovor (kad netko drugi odgovori ili pošalje emoji).' },
    { v: '1.18.0', d: '2026-11-26', t: 'Kviz: oko 1500 novih pitanja (sad ih je preko 2000), a u sobi se pitanje ne ponavlja dok ne prođu gotovo sva ostala.' },
    { v: '1.17.0', d: '2026-11-26', t: 'Kviz: bodovi iz online kvizova skupljaju se na računu (i po kategorijama), uz ljestvicu najboljih.' },
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
