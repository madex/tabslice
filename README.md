# TabSlice

Interaktiver Notenplayer für **Guitar Pro**, **MusicXML**, **Capella** und **alphaTex** im
Soundslice-Stil: Live-Griffbrett, Spurmixer, Tempo-Trainer, A-B-Loop, Metronom,
umschaltbare SoundFonts und Iframe-Einbettung für Foren.

TabSlice ist eine kleine, dateibasierte Web-App ohne Datenbank. Das Frontend ist eine
React/Vite-SPA, der Server ist ein Express-Prozess in TypeScript. Die Partituren werden
serverseitig mit [alphaTab](https://alphatab.net) eingelesen (Titel, Interpret, Tempo,
Spuren, Takte) und im Browser gerendert und abgespielt.

---

## Inhalt

- [Funktionen](#funktionen)
- [Schnellstart](#schnellstart)
- [Admin und öffentliche Slice-Links](#admin-und-öffentliche-slice-links)
- [Konfiguration](#konfiguration)
- [Datenablage](#datenablage)
- [API](#api)
- [Sicherheit](#sicherheit)
- [Betrieb auf einem Webserver](#betrieb-auf-einem-webserver)
- [Kann man TabSlice mit PHP betreiben?](#kann-man-tabslice-mit-php-betreiben)
- [Projektstruktur](#projektstruktur)
- [Entwicklung](#entwicklung)
- [Fehlerbehebung](#fehlerbehebung)
- [Lizenzen](#lizenzen)

---

## Funktionen

- **Formate:** `.gp`, `.gp3`–`.gp8`, `.gpx`, MusicXML (`.xml`, `.musicxml`, `.mxl`),
  Capella (`.cap`) und alphaTex (`.tex`).
- **Player:** Noten/TAB, horizontale oder Seitenansicht, Spur-Solo/Mute, Lautstärke,
  Tempo-Regler (25–200 %), Metronom, Einzähler, A-B-Loop, Live-Griffbrett.
- **Backing-Audio:** Eingebettete GP7/8-Audio-Spuren werden über die in der Datei
  gespeicherten Sync-Punkte (inkl. Frame-Padding) an der Partitur ausgerichtet.
- **SoundFonts:** GeneralUser GS, FluidR3, MuseScore General, Sonivox (werden einmalig
  serverseitig zwischengespeichert).
- **Zwei Wege zum Slice:**
  - Upload über die Admin-Bibliothek,
  - Datei per FTP/SFTP in `scores/` legen (Drop-Ordner).
- **Öffentliche UUID-Links:** `/slices/<uuid>` und `/slices/<uuid>/embed/` – ohne Login.
- **Admin-Bereich:** Bibliothek, Upload, Bearbeiten und Löschen nur nach Anmeldung.
- **Embed-Parameter:** `header`, `layout`, `stave`, `fretboard`, `metronome`, `countin`,
  `loop`, `speed`, `sf`, `dark`.
- **Keine Datenbank:** Index und Dateien liegen im Dateisystem, damit einfach zu sichern
  und zu deployen.

---

## Schnellstart

**Voraussetzungen:** Node.js 22 oder neuer, npm.

```bash
npm install
cp .env.example .env
# In .env ein sicheres ADMIN_PASSWORD setzen
npm run dev
```

Danach:

- App: <http://localhost:3000>
- Admin-Anmeldung: <http://localhost:3000/admin>
- Healthcheck: <http://localhost:3000/api/health>

`npm run dev` startet den Express-Server mit Vite-Middleware (HMR). Ein separates
Frontend-Dev-Server-Setup gibt es nicht.

### Produktion

```bash
npm install
npm run build
ADMIN_PASSWORD='langes-zufälliges-passwort' NODE_ENV=production PORT=3000 npm start
```

Alternativ ein scrypt-Hash statt Klartext:

```bash
npm run hash-password -- 'dein-passwort'
# Ausgabe z. B.: ADMIN_PASSWORD_HASH=scrypt$<salt>$<hash>
```

Den Hash in `.env` eintragen. `ADMIN_PASSWORD_HASH` hat Vorrang vor `ADMIN_PASSWORD`.

> Wird weder `ADMIN_PASSWORD` noch `ADMIN_PASSWORD_HASH` gesetzt, erzeugt der Server beim
> Start ein **temporäres Zufallspasswort** und schreibt es einmal in die Konsole. Das ist
> nur für lokale Tests gedacht und nach einem Neustart ungültig.

### Embed lokal testen

Eine kleine Testseite mit Iframe bringt der Server mit:

```text
http://localhost:3000/examples/embed-test.html?id=<uuid>
```

Ohne `id` wird die Demo-Partitur geladen. Die Seite wird **vom Server** ausgeliefert und
funktioniert deshalb ohne Zusatz-Setup.

> **Nicht per Doppelklick (`file://`) öffnen.** Eine lokale HTML-Datei kann den Slice
> nicht einbetten: Der Browser blockiert das Iframe wegen `frame-ancestors`
> (`file://` ist eine undurchsichtige Origin, `*` deckt nur Netzwerk-Schemata ab), und
> relative URLs wie `/slices/…` haben ohne Server kein Ziel. Immer über
> `http://localhost:3000/...` testen.

---

## Admin und öffentliche Slice-Links

TabSlice trennt strikt zwischen Verwaltung und Abspielen:

| Bereich | Zugriff |
| --- | --- |
| Bibliothek, Upload, Bearbeiten, Löschen | nur Admin-Session |
| `GET /api/slices` (komplette Liste) | nur Admin |
| `/slices/<uuid>` (Player-Seite) | öffentlich, ohne Login |
| `/slices/<uuid>/embed/` (Iframe) | öffentlich, ohne Login |
| `GET /api/slices/<uuid>` und `/file` | öffentlich, ohne Login |

Jeder Slice bekommt eine **zufällige UUID v4** (`crypto.randomUUID()`). Die UUID ist nicht
aus Dateiname, Titel oder Reihenfolge ableitbar. Es gibt bewusst keine öffentliche Liste,
Suche oder Sitemap – der Link selbst ist das Zugriffsgeheimnis („unlisted link“).

- Uploads erhalten ihre UUID beim Anlegen.
- Dateien im Drop-Ordner `scores/` bekommen eine UUID, die einmalig in
  `data/slices/folder-ids.json` gespeichert wird. Sie bleibt bei Neustarts und Rescans
  stabil.
- Alte, dateinamenbasierte Links (`/slices/mein-riff`) werden nicht mehr erzeugt.

> **Wichtig:** Ein öffentlicher Slice-Link ist wie ein Passwort zu behandeln. Wer ihn hat,
> kann den Slice ansehen und einbetten. Einzelne Links lassen sich nicht „widerrufen“,
> außer den Slice zu löschen. Für vertrauliche Inhalte ist das Modell daher nicht geeignet.

---

## Konfiguration

Alle Variablen können über `.env` oder echte Umgebungsvariablen gesetzt werden.

| Variable | Default | Bedeutung |
| --- | --- | --- |
| `PORT` | `3000` | HTTP-Port |
| `HOST` | `0.0.0.0` | Bind-Adresse |
| `ADMIN_PASSWORD` | – | Admin-Passwort im Klartext |
| `ADMIN_PASSWORD_HASH` | – | scrypt-Hash, erzeugt mit `npm run hash-password` |
| `TRUST_PROXY` | `0` | `1`, wenn hinter nginx/Caddy; nötig für echte Client-IP und Rate-Limits |
| `COOKIE_SECURE` | in Produktion `1` | `0` nur bei reinem HTTP ohne TLS |
| `EMBED_FRAME_ANCESTORS` | `*` | CSP-Wert für erlaubte Iframe-Einbetter, z. B. `'self' https://forum.example.com` |

Beispiel für eine engere Einbettung:

```env
EMBED_FRAME_ANCESTORS="'self' https://www.andys-basscamp.de https://forum.example.com"
```

---

## Datenablage

```text
scores/                        Drop-Ordner (per FTP/SFTP), schreibgeschützt für die App
data/
  slices/
    index.json                 Metadaten der Uploads
    folder-ids.json            Dateiname -> UUID für den Drop-Ordner (automatisch)
    <uuid>.<ext>               hochgeladene Partituren
  soundfonts/                  SoundFont-Cache (wird bei Bedarf geladen)
dist/                          Produktions-Build des Frontends
```

- `scores/` wird bei jedem Bibliotheksaufruf neu gescannt. Änderungen per FTP sind sofort
  sichtbar (Refresh-Button in der Bibliothek).
- `data/slices/index.json` und `data/slices/folder-ids.json` sind die einzige „Datenbank“.
  Beide Dateien werden atomar (temp + rename) geschrieben und beim ersten Start
  automatisch angelegt. Sie gehören zu den Laufzeitdaten und sind nicht im Repository.
- **Backup:** `data/` und `scores/` gemeinsam sichern. Der Rest ist aus dem Repository
  reproduzierbar.

---

## API

Alle Antworten sind JSON (außer Datei-/SoundFont-Streams). Admin-Mutationen benötigen
zusätzlich den Header `X-TabSlice-Admin: 1` (CSRF-Schutz).

| Methode | Pfad | Auth | Zweck |
| --- | --- | --- | --- |
| `GET` | `/api/health` | – | Status |
| `GET` | `/api/admin/session` | – | Prüft, ob die Session gültig ist |
| `POST` | `/api/admin/login` | – | Login (rate-limited) |
| `POST` | `/api/admin/logout` | – | Session beenden |
| `GET` | `/api/slices` | Admin | Komplette Bibliothek |
| `GET` | `/api/slices/:id` | öffentlich | Metadaten eines Slices |
| `GET` | `/api/slices/:id/file` | öffentlich | Partiturdatei streamen |
| `POST` | `/api/slices/upload` | Admin | Binärdatei hochladen (max. 25 MB) |
| `POST` | `/api/slices/tex` | Admin | alphaTex anlegen (max. 2 MB) |
| `PATCH` | `/api/slices/:id` | Admin | Metadaten eines Uploads ändern |
| `DELETE` | `/api/slices/:id` | Admin | Upload löschen |
| `GET` | `/api/soundfonts` | – | SoundFont-Katalog |
| `GET` | `/api/soundfonts/:id` | – | SoundFont herunterladen/streamen |

Beispiel:

```bash
# Login (Cookie wird in cookies.txt gespeichert)
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"password":"…"}' http://localhost:3000/api/admin/login

# Bibliothek
curl -b cookies.txt http://localhost:3000/api/slices

# Upload
curl -b cookies.txt -X POST \
  -H 'X-TabSlice-Admin: 1' \
  -H 'X-File-Name: riff.gp5' \
  -H 'X-Title: Mein%20Riff' \
  --data-binary @riff.gp5 \
  http://localhost:3000/api/slices/upload
```

---

## Sicherheit

### Was umgesetzt ist

- **Admin-Authentifizierung**
  - Passwort wahlweise im Klartext oder als scrypt-Hash.
  - Vergleich mit `timingSafeEqual`, kein Klartext-Logging.
  - Session-Token: 32 Byte Zufall, `HttpOnly`, `SameSite=Lax`, in Produktion `Secure`,
    7 Tage gültig, serverseitig im Speicher.
  - Brute-Force-Bremse: maximal 8 Fehlversuche pro IP in 15 Minuten.
- **CSRF**
  - `SameSite=Lax`-Cookie,
  - zusätzlicher Pflicht-Header `X-TabSlice-Admin: 1` bei allen schreibenden
    Admin-Anfragen,
  - Origin-Prüfung bei POST/PATCH/DELETE.
- **Zugriffstrennung**
  - Die Bibliothek ist nicht öffentlich. Öffentlich sind nur exakte UUID-Links.
  - `X-Robots-Tag: noindex` für `/slices/`, `/api/` und `/admin`, `robots.txt` sperrt sie.
  - Kein Directory Listing, keine Suche, keine Sitemap.
- **Uploads**
  - Endungs-Whitelist (`.gp`, `.gp3`–`.gp8`, `.gpx`, `.xml`, `.musicxml`, `.mxl`,
    `.cap`, `.tex`), Größenlimit 25 MB.
  - Dateiname wird auf `path.basename()` reduziert; gespeichert wird ausschließlich unter
    der serverseitig erzeugten UUID. Kein nutzergesteuerter Pfad.
  - alphaTex wird vor dem Speichern geparst; fehlerhafte Syntax wird abgelehnt.
  - Titel/Interpret werden von Steuerzeichen befreit und längenbegrenzt.
- **Transport/Header**
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`.
  - Nur explizite Embed-Ansichten (`/slices/<uuid>/embed/` oder `?embed=1`) dürfen per
    Iframe eingebettet werden; Admin- und normale Seiten setzen `frame-ancestors 'none'`.
    Die erlaubten Einbetter steuert `EMBED_FRAME_ANCESTORS`.
  - `X-Powered-By` deaktiviert.

### Betriebshinweise

- **Immer HTTPS** verwenden. Der Admin-Login und die Session-Cookies gehören hinter TLS.
- `TRUST_PROXY=1` nur setzen, wenn tatsächlich ein vertrauenswürdiger Reverse Proxy davor
  steht. Sonst lassen sich IP-basierte Limits über `X-Forwarded-For` umgehen.
- `ADMIN_PASSWORD` lang und zufällig wählen (≥ 16 Zeichen) oder den Hash verwenden.
- **Sessions sind in-memory:** Ein Neustart meldet alle Admins ab. Das ist gewollt und
  verhindert persistente Session-Dateien. Betreibe die App deshalb als **einen** Prozess;
  bei mehreren Instanzen bräuchte es Sticky Sessions oder einen gemeinsamen Session-Store.
- **Links sind Bearer-Token:** Wer einen Slice-Link kennt, kommt ohne Login an den Inhalt.
  Nicht als Geheimhaltung für vertrauliche Daten missverstehen.
- **Kein Virenscan:** alphaTab interpretiert Notendateien, führt aber keinen Code aus.
  Für öffentliche Uploads trotzdem nur Admins zulassen (ist so umgesetzt).
- **Backups** von `data/` und `scores/` regelmäßig erstellen.
- Zusätzlich empfehlenswert: Rate-Limits und Verbindungslimits im Reverse Proxy,
  fail2ban für `/api/admin/login`, regelmäßige Updates von Node und npm-Paketen.

---

## Betrieb auf einem Webserver

TabSlice braucht einen **Node.js-Prozess**. Ein reiner Apache/PHP-Webspace reicht nicht,
weil die serverseitige Partituranalyse (alphaTab) in JavaScript läuft.

### Variante A: VPS oder Root-Server (empfohlen)

Node installieren, Projekt kopieren, bauen und mit systemd oder pm2 dauerhaft starten.
Beispiel für systemd:

```ini
[Unit]
Description=TabSlice
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/tabslice
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=TRUST_PROXY=1
EnvironmentFile=/opt/tabslice/.env
ExecStart=/usr/bin/npm start
Restart=always
User=tabslice

[Install]
WantedBy=multi-user.target
```

### Variante B: Managed Hosting mit Node-Unterstützung

Viele Panels (Plesk, cPanel mit Node.js-Selector, Railway, Render, Coolify) bieten Node
an. Build-Command `npm run build`, Start-Command `npm start`, persistente Volumes für
`data/` und `scores/` mounten.

### Variante C: Docker / Docker Compose

Voraussetzungen: Docker mit Compose-Plugin. Im Projektverzeichnis:

```bash
cp .env.example .env
# ADMIN_PASSWORD in .env setzen (oder ADMIN_PASSWORD_HASH verwenden)
# Wichtig: nicht das Beispiel-Passwort "change-me..." stehen lassen!

mkdir -p data scores
# Nur unter Linux nötig, wenn die Ordner dem Host-User gehören:
sudo chown -R 1000:1000 data scores

docker compose up -d --build
docker compose logs -f
```

Der Player läuft danach auf `http://<server>:3000`. Ein anderer Host-Port lässt sich
ohne Änderung der Compose-Datei setzen:

```bash
TABSLICE_PORT=8080 docker compose up -d
```

Ohne Compose geht es auch direkt:

```bash
docker build -t tabslice .
docker run -d --name tabslice --restart unless-stopped \
  -p 3000:3000 --env-file .env \
  -v "$PWD/data:/app/data" \
  -v "$PWD/scores:/app/scores" \
  tabslice
```

Wichtig:

- `data/` (Uploads, Index, SoundFont-Cache) und `scores/` (Drop-Ordner) sind
  Bind-Mounts und bleiben beim Neustart/Update erhalten.
- Der Container läuft als Benutzer `node` (UID 1000). Unter Linux müssen `data/` und
  `scores/` für diese UID schreibbar sein (siehe `chown` oben).
- Hinter nginx/Caddy `TRUST_PROXY=1` und `COOKIE_SECURE=1` setzen. Bei direktem
  HTTP-Zugriff ohne TLS `COOKIE_SECURE=0` setzen, sonst schlägt der Admin-Login fehl.
- Update:

  ```bash
  git pull
  docker compose up -d --build
  ```

- Stoppen:

  ```bash
  docker compose down
  ```

- Backup: einfach `data/` und `scores/` sichern. Die Container selbst sind zustandslos.

### Variante D: NAS mit Traefik

Für den Betrieb auf einem NAS mit vorhandenem Traefik (z. B. `exposed-to-reality.de`)
liegt ein eigener Compose-Stack bei, der den Container per Labels in ein externes
Docker-Netz einhängt:

```bash
git clone https://github.com/madex/tabslice.git /srv/data/rest/tabslice
cd /srv/data/rest/tabslice
# .env mit ADMIN_PASSWORD anlegen, data/ und scores/ auf UID 1000 setzen
docker compose -f deploy/nas/docker-compose.yml up -d --build
```

Voraussetzungen: Traefik läuft mit dem externen Netz `docker_web`, ein CNAME zeigt auf
das NAS, und Port 80/443 sind freigeschaltet. Schritt-für-Schritt-Anleitung inklusive
DNS, Rechten, Updates und Fehlersuche:
[`deploy/nas/README.md`](./deploy/nas/README.md).

### nginx davor

```nginx
server {
    listen 443 ssl http2;
    server_name tabs.example.com;

    client_max_body_size 30M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`TRUST_PROXY=1` setzen, damit Rate-Limits und `Secure`-Cookies korrekt funktionieren.
Die App setzt bewusst kein `X-Frame-Options`; die Einbettung wird über
`EMBED_FRAME_ANCESTORS` gesteuert.

---

## Kann man TabSlice mit PHP betreiben?

**Kurz:** Auf einem Webserver ja – aber nicht als reine PHP-Anwendung, solange die
serverseitige alphaTab-Analyse genutzt wird. Für reines PHP-Shared-Hosting ist ein Port
nötig.

Warum: Der Node-Server macht mehr als Dateien ausliefern. Er liest mit der
JavaScript-Bibliothek `@coderline/alphatab` jede Guitar-Pro-/MusicXML-Datei, um Titel,
Interpret, Tempo, Spuren und Taktzahl für die Bibliothek zu ermitteln. PHP hat keinen
offiziellen alphaTab-Parser. Zusätzlich laufen Admin-Session, UUID-Vergabe und
SoundFont-Cache im selben Prozess.

Die Optionen im Überblick:

1. **Node auf dem Webserver (empfohlen).** Viele Server erlauben neben PHP auch Node
   (Plesk, cPanel-Node-Selector, eigener VPS). nginx/Apache leitet an den Node-Port weiter.
   PHP wird nicht benötigt.
2. **Hybrid: PHP-Webspace + Node im Hintergrund.** Wenn der Hoster einen Node-Prozess
   erlaubt, kann die bestehende App unverändert laufen; ein PHP-Frontcontroller ist nicht
   nötig und bringt keinen Sicherheitsgewinn. Ein PHP-Reverse-Proxy hilft nur, wenn PHP
   ausgehende Verbindungen zu einem internen Node-Port weiterleiten darf.
3. **Reiner PHP-Port.** Machbar, aber mit Umbau verbunden:
   - `api.php` übernimmt Upload, UUID-Vergabe, Admin-Login (PHP-Session), Datei-Streaming.
   - Die Metadaten (Titel, Spuren, Tempo, Takte) müssten im Browser mit alphaTab.js
     ermittelt und beim Upload mitgeschickt werden – oder in der Bibliothek entfallen.
   - `.htaccess`/nginx-Rewrites für `/slices/<uuid>` und `/api/...`.
   - Kein serverseitiges Validierungs-Parsing von alphaTex mehr.
   - Aufwand realistisch: ein bis zwei Tage plus Tests; die Player-Oberfläche bleibt
     unverändert.
4. **Nur statisches Hosting.** Reicht nicht: Uploads, Admin-Login und UUID-Zuordnung
   brauchen einen Server.

**Fazit:** Wenn auf dem Webserver Node läuft, ist TabSlice sofort einsatzfähig. Wenn dort
ausschließlich PHP verfügbar ist, ist die aktuelle Version nicht direkt lauffähig; ein
schlanker PHP-Port ist möglich, verliert aber die serverseitige Metadatenanalyse. Sag
Bescheid, wenn der PHP-Port gewünscht ist – dann kann er als separate Variante ergänzt
werden, ohne den Node-Betrieb zu verändern.

---

## Projektstruktur

```text
server.ts                      Express-API, Auth, UUIDs, alphaTab-Metadaten
Dockerfile                     Multi-Stage-Build für den Produktionsbetrieb
docker-compose.yml             Container mit Port, Env und persistenten Volumes
.dockerignore                  Hält node_modules, data/ und scores/ aus dem Image
deploy/nas/                    Compose-Stack und Anleitung für NAS + Traefik
src/
  App.tsx                      Routing, Admin-Session, Ansichten
  components/
    TabSlicePlayer.tsx         alphaTab-Player (Rendering, Audio, Loop, Mixer)
    SliceLibrary.tsx           Admin-Bibliothek
    CreateSliceModal.tsx       Upload / alphaTex-Editor
    EmbedModal.tsx             Iframe-/BBCode-/Link-Generator
    AdminLoginModal.tsx        Admin-Anmeldung
    FretboardVisualizer.tsx    Live-Griffbrett
    HostingGuide.tsx           In-App-Hostinghilfe
  types/slice.ts               API-Client und Typen
  lib/midiReload.ts            Koordiniert MIDI-Neuladen ohne Playback-Hänger
  lib/audioSync.ts             GP-Sync-Punkte: Score-Zeit → Audio-Zeit
  data/demoScores.ts           eingebaute Demo-Partituren
scores/                        Drop-Ordner
data/                          Uploads, Index, SoundFont-Cache
examples/embed-test.html       Iframe-Testseite (/examples/embed-test.html)
scripts/hash-password.mjs      scrypt-Hash erzeugen
LICENSE                        Projektlizenz (MPL-2.0)
THIRD_PARTY_NOTICES.md         Drittanbieter- und SoundFont-Lizenzen
licenses/alphaTab.txt          alphaTab-Lizenztext (MPL-2.0)
licenses/Apache-2.0.txt        Apache-2.0-Lizenztext (Sonivox, TypeScript)
licenses/sonivox.txt           Sonivox-Copyright-Hinweis
```

---

## Entwicklung

```bash
npm run dev          # Server + Vite mit HMR
npm run lint         # TypeScript-Prüfung
npm test             # Unit-Tests (Node Test Runner + tsx)
npm run build        # Frontend nach dist/
npm run start        # Produktionsserver (nutzt dist/)
```

Nützliche URLs:

- `/` – Player mit Demo-Partitur (für Gäste)
- `/slices/<uuid>` – öffentlicher Slice
- `/slices/<uuid>/embed/?header=0&metronome=1` – Iframe
- `/admin` – Admin-Login

---

## Fehlerbehebung

| Problem | Ursache / Lösung |
| --- | --- |
| „Admin-Anmeldung erforderlich“ | Kein/abgelaufenes Cookie. Unter `/admin` neu anmelden. Nach Serverneustart ist die Session weg. |
| Login klappt nicht, obwohl das Passwort stimmt | `ADMIN_PASSWORD_HASH` gesetzt und veraltet? Hash neu erzeugen. Bei Produktion über HTTP: `COOKIE_SECURE=0` setzen. |
| Datei im Drop-Ordner erscheint nicht | Nur erlaubte Endungen, Bibliothek aktualisieren. Bei fehlenden Rechten: `scores/` muss lesbar sein. |
| SoundFont lädt nicht | Einmaliger Download benötigt Internet. Prüfe Schreibrechte auf `data/soundfonts/`. |
| Download/Upload bricht bei großen Dateien ab | Reverse-Proxy-Limit erhöhen (`client_max_body_size 30M`) und 25-MB-Limit der App beachten. |
| Iframe bleibt leer | `EMBED_FRAME_ANCESTORS` prüfen, HTTPS-Mischinhalte vermeiden. Die Testseite über `http://localhost:3000/examples/embed-test.html?id=<uuid>` aufrufen, nicht per `file://`. |

---

## Lizenzen

TabSlice steht unter der **Mozilla Public License 2.0**. Der vollständige Lizenztext
liegt in [`LICENSE`](./LICENSE).

- [alphaTab](https://alphatab.net) – MPL-2.0 (Lizenztext:
  [`licenses/alphaTab.txt`](./licenses/alphaTab.txt)); die alphaTab-Attribution in der
  gerenderten Notation muss sichtbar bleiben.
- [GeneralUser GS](https://www.schristiancollins.com/generaluser.php) – SoundFont von
  S. Christian Collins
- Weitere SoundFonts unter den Bedingungen der jeweiligen Projekte (FluidR3, MuseScore
  General, Sonivox)

Alle Drittanbieter-Komponenten und ihre Lizenzen sind in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) aufgeführt.

Dieses Projekt wurde ursprünglich aus Google AI Studio exportiert. Die AI-Studio-Metadaten
(`metadata.json`), der Gemini-API-Key und die zugehörigen Hinweise wurden entfernt; die App
benötigt keine KI-API.
