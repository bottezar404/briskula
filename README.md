# Briškula

Online briškula: protiv botova ili s drugim igračima, u dvoje, troje i u parovima (2 na 2).
Radi u pregledniku i može se instalirati na mobitel kao aplikacija (PWA).

## Pokretanje

```bash
npm install
npm start          # http://localhost:3000
npm test           # simulacija 8000 partija botova + provjera pravila
```

## Što ima

- **Protiv botova** (lako / srednje / teško) – radi i bez interneta, sve se vrti u pregledniku.
- **Online** – „Napravi sobu” daje kod od 5 slova i link (`?soba=KOD`) za prijatelje.
  Prazna mjesta domaćin popuni botovima. „Brza igra” spaja s bilo kim tko čeka.
- **Parovi** – suigrači nasuprot, tajni znakovi samo za suigrača, a kad se špil potroši vidiš karte suigrača.
- **Troje** – izbacuje se dvica dinara (39 karata).
- Ako igrač izgubi vezu, može se vratiti (osvježi stranicu); nakon 25 s bot odigra umjesto njega.
- Originalne karte nacrtane u SVG-u (`public/cards.js`).

## Struktura

- `public/engine.js` – pravila (dijeli ih preglednik i server)
- `public/bot.js` – botovi (teški bot u završnici u dvoje igra savršeno)
- `public/app.js`, `style.css`, `index.html` – sučelje
- `public/sw.js`, `manifest.webmanifest`, `icons/` – PWA
- `server/index.js` – Node server (statičke datoteke + WebSocket na `/ws`)

## Objava

Treba bilo koji hosting koji vrti Node i podržava WebSocket (npr. Render, Railway, Fly.io).
Naredba za pokretanje je `npm start`, port se čita iz `PORT`. Za instalaciju na mobitel stranica mora biti na HTTPS-u.
