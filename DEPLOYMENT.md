# Hosting-Anleitung (Deployment)

So bringst du die NABS-Racing-Website dauerhaft auf einen eigenen Server. Das
**Node-Backend liefert alles selbst aus** — die Website, die API und die
Downloads, als **ein einziges Programm**. Davor sitzt nur eine dünne
HTTPS-Schicht (Caddy) für die verschlüsselte Verbindung.

```
Besucher ──► Caddy (Domain, HTTPS)  ──►  Node-Backend (Port 4000)
                                          ├─ Website  (frontend/dist)
                                          ├─ API      (/api/*)
                                          └─ Downloads
```

> Warum so? Website und `/api` liegen dadurch automatisch unter **derselben
> Adresse** — genau das braucht der Login und der mitglieder-geschützte Download.
> Und du musst nur **einen** Dienst am Laufen halten.

---

## Voraussetzungen

- Ein Server (VPS oder Heim-Server) mit **Node.js 18+** und **git**.
- Eine **Domain**, die auf die Server-IP zeigt (z. B. `nabs.example.com`).
- **Caddy** (empfohlen, macht HTTPS von allein): <https://caddyserver.com/docs/install>
- Genug **Speicherplatz** für die Download-Dateien (Strecken, F1 2007, …).

---

## Schritt 1 — Code auf den Server holen

```bash
git clone <REPO-URL> nabs-racing
cd nabs-racing
```

## Schritt 2 — Backend einrichten

```bash
cd backend
npm install
cp .env.example .env
```

Jetzt `backend/.env` bearbeiten:

```ini
DATABASE_URL="file:./dev.db"
JWT_SECRET="<hier eine lange, zufällige Zeichenkette einsetzen>"
PORT=4000
CORS_ORIGIN="https://nabs.example.com"

# Discord-Login (nötig, weil Downloads mitglieder-geschützt sind):
DISCORD_CLIENT_ID="<deine Client-ID>"
DISCORD_CLIENT_SECRET="<dein Client-Secret>"
DISCORD_REDIRECT_URI="https://nabs.example.com/auth/discord/callback"
```

**Datenbank** — zwei Wege:

- **Am einfachsten (empfohlen):** die bestehende, funktionierende Datenbank­datei
  vom Entwicklungs-Rechner kopieren nach `backend/prisma/dev.db`. Sie enthält
  bereits alle Tabellen (auch die für Downloads) und die aktuellen Daten.
  Dann **nicht** seeden.
- **Oder frisch aufsetzen:**
  ```bash
  npx prisma migrate deploy   # erstellt alle Tabellen (inkl. Downloads)
  npm run seed                # füllt Teams, Fahrer und Ergebnisse
  ```

**Download-Dateien** in den Ordner legen (der Ordner ist bewusst nicht im Repo):

```bash
mkdir -p downloads
# die großen AC-Dateien (Strecken, Safety Car, CSP, Real Penalty, F1 2007 …)
# per SFTP/Kopie hierher legen: nabs-racing/backend/downloads/
```

## Schritt 3 — Website bauen

```bash
cd ../frontend
npm install
npm run build      # erzeugt frontend/dist/
```

> Wichtig: `VITE_API_BASE` **leer lassen** (nicht setzen). Dann sprechen Website
> und API dieselbe Adresse an — passt zum Setup unten.

Sobald `frontend/dist` existiert, **liefert das Backend die Website automatisch
mit aus** (unter derselben Adresse wie die API). Es braucht davor also nur noch
HTTPS.

## Schritt 4 — HTTPS davor (Caddy)

Weil das Backend schon alles ausliefert, reicht ein **einzeiliger** Reverse-Proxy,
der nur die verschlüsselte Verbindung übernimmt. Eine Datei `Caddyfile` anlegen:

```caddy
nabs.example.com {
    reverse_proxy localhost:4000
}
```

Starten:

```bash
caddy start --config ./Caddyfile
```

Caddy holt sich **automatisch ein HTTPS-Zertifikat** für die Domain und leitet
alles ans Backend weiter — Website, API, große Downloads (inkl. Wiederaufnahme)
und das Live-Timing (WebSocket unter `/api/live/ws`).

> **Noch einfacher, ganz ohne eigenen Webserver:** die Domain über **Cloudflare**
> (kostenlos) leiten. Cloudflare übernimmt das HTTPS, das Backend läuft dahinter —
> dann brauchst du gar kein Caddy/nginx.
>
> Lieber nginx? Auch möglich: `location / { proxy_pass http://localhost:4000; }`
> mit `proxy_http_version 1.1` + Upgrade-Headern für den WebSocket, HTTPS per certbot.

## Schritt 5 — Discord-Login für die Domain freischalten

1. <https://discord.com/developers/applications> → deine App → **OAuth2**.
2. Unter **Redirects** exakt eintragen:
   `https://nabs.example.com/auth/discord/callback`
3. Dieselbe URL steht schon in `backend/.env` als `DISCORD_REDIRECT_URI`. Fertig.

Ohne diesen Schritt kann sich niemand einloggen — und damit auch niemand die
Downloads sehen.

## Schritt 6 — Backend als Dauerdienst laufen lassen

Nicht `npm run dev` (Entwickler-Modus), sondern dauerhaft mit einem
Prozess-Manager, damit es nach Neustart/Absturz automatisch wieder hochkommt:

```bash
cd nabs-racing/backend
npm install -g pm2
pm2 start npm --name nabs-api -- start
pm2 save
pm2 startup        # zeigt einen Befehl an -> einmal ausführen (Autostart)
```

---

## Downloads befüllen (der laufende Betrieb)

1. Datei per SFTP/Kopie nach `backend/downloads/` auf den Server legen.
2. Auf der Website: **Admin** (PIN) → Tab **Downloads** → die Datei erscheint dort
   automatisch → **Register** klicken und Titel/Kategorie/Hinweis ergänzen.
3. Mitglieder sehen und laden sie sofort unter **Downloads**.

## Später aktualisieren

```bash
cd nabs-racing
git pull
cd backend  && npm install
cd ../frontend && npm install && npm run build
pm2 restart nabs-api      # Caddy liefert das neue dist/ automatisch aus
```

---

## Kurz-Checkliste

- [ ] Domain zeigt auf den Server
- [ ] `backend/.env` ausgefüllt (JWT_SECRET, Discord-Werte, `https`-Redirect, CORS)
- [ ] Datenbank kopiert **oder** `migrate deploy` + `seed`
- [ ] Download-Dateien in `backend/downloads/`
- [ ] `frontend` gebaut (`npm run build`), `VITE_API_BASE` leer
- [ ] HTTPS davor (Caddy `reverse_proxy localhost:4000` **oder** Cloudflare)
- [ ] Discord-Redirect-URL im Entwickler-Portal eingetragen
- [ ] Backend via pm2 als Dauerdienst + Autostart
- [ ] Link-Vorschau: in `frontend/index.html` bei den beiden `og:image` /
      `twitter:image`-Zeilen `https://nabs-racing.example` durch die echte
      Domain ersetzen (sonst zeigt Discord kein Vorschaubild)

> **Nur 3 Dinge liegen bewusst außerhalb von git** und müssen auf dem Server
> selbst angelegt werden: `backend/.env`, die Datenbankdatei `backend/prisma/dev.db`
> und der Ordner `backend/downloads/` mit den großen Dateien.
