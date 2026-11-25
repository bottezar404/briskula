# Briškula

Online briškula, trešeta i poker: protiv botova ili s drugim igračima, u dvoje, troje i u parovima (2 na 2),
te turnir (briškula → trešeta → poker).
Radi u pregledniku i može se instalirati na mobitel kao aplikacija (PWA).

## Pokretanje

```bash
npm install
npm start          # http://localhost:3000
npm test           # simulacija partija botova (briškula, chi fa meno, trešeta, poker), online testovi, turnir
```

## Što ima

- **Protiv botova** (lako / srednje / teško) – radi i bez interneta, sve se vrti u pregledniku.
- **Online** – „Napravi sobu” daje kod od 5 slova i link (`?soba=KOD`) za prijatelje.
  Prazna mjesta domaćin popuni botovima. „Brza igra” spaja s bilo kim tko čeka.
- **Parovi** – suigrači nasuprot, tajni znakovi samo za suigrača, a kad se špil potroši vidiš karte suigrača.
- **Troje** – izbacuje se dvica dinara (39 karata).
- **Chi fa meno** („tko napravi manje”) – prekidač za **obje igre**. U briškuli: iste karte i pravila, ali pobjeđuje tko skupi **manje** bodova.
  Tko pokupi svih 120 bodova (kapot), odmah pobjeđuje. Radi u dvoje, troje i parovima, s botovima i online;
  botovi tada igraju da izbjegnu bodove i „utovare” ih protivniku.
- **Trešeta** – bez briškule, mora se odgovoriti na boju; jačina 3-2-as-kralj-konj-fanat-7-6-5-4.
  As 1 bod, figure/trica/dvica po ⅓ (bela), zadnji štih 1 bod (11 bodova po ruci). Akuže (napolitana,
  tri/četiri trice, dvice ili asa) se prijavljuju same. Igra se u više ruku do 41 (ili 21/31).
  Parovi (10 karata), dvoje (10 karata + vučenje iz špila, izvučene karte se pokazuju) i troje (bez četvorke dinara, 13 karata).
  **Trešeta Chi fa meno**: bez akuža, pobjeđuje tko ima manje; kapot (svi bodovi u ruci) = 0 za njega, 11 ostalima;
  kad netko dođe do cilja, partija završava.
  Botovi na 3 razine (teški bot simulira moguće rasporede karata, a u završnici u dvoje igra savršeno).
- **Poker** (Texas Hold'em) s kartama briškule, 2–4 igrača, svatko za sebe. Redoslijed 2-3-4-5-6-7-fanat-konj-kralj-as
  (as i kao jedinica u skali A-2-3-4-5). Jer nema 8, 9 i 10, skala je češća od trisa i ful češći od boje, pa je ovdje
  **tris jači od skale, a boja jača od fula** (kao „short deck”). Svi počinju s 1000 žetona, blindovi rastu svakih 6 ruku,
  „no limit” ulaganje, sporedni lonci kod all-ina. Botovi procjenjuju snagu ruke simulacijom (3 razine).
  Online: tko ne odigra na vrijeme provjeri ili odustane od ruke; kad svi ljudi ispadnu, botovi odigraju ostatak odmah.
- **Turnir** – tri igre zaredom: briškula, trešeta (do odabranog cilja), poker (blindovi rastu svake 4 ruke).
  U svakoj igri bod za svakog nadigranog protivnika (izjednačeno ½; u parovima pobjednički par po 2),
  pobjeđuje tko ima najviše bodova, a kod izjednačenja bolji u pokeru. Protiv botova i online.
- Ako igrač izgubi vezu, može se vratiti (osvježi stranicu); nakon 25 s bot odigra umjesto njega.
- Originalne karte nacrtane u SVG-u (`public/cards.js`).

## Struktura

- `public/engine.js` – pravila (dijeli ih preglednik i server)
- `public/bot.js` – botovi (teški bot u završnici u dvoje igra savršeno)
- `public/treseta.js`, `public/treseta-bot.js` – pravila i botovi za trešetu
- `public/poker.js`, `public/poker-bot.js` – pravila i botovi za poker
- `public/turnir.js` – bodovanje turnira
- `public/app.js`, `style.css`, `index.html` – sučelje
- `public/sw.js`, `manifest.webmanifest`, `icons/` – PWA
- `server/index.js` – Node server (statičke datoteke + WebSocket na `/ws`)

## Objava

Treba bilo koji hosting koji vrti Node i podržava WebSocket (npr. Render, Railway, Fly.io).
Naredba za pokretanje je `npm start`, port se čita iz `PORT`. Za instalaciju na mobitel stranica mora biti na HTTPS-u.
