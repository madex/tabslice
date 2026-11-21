# TabSlice auf dem NAS2 hosten

Konkrete Anleitung für `https://tabslice.exposed-to-reality.de` auf dem bestehenden
NAS (Debian 13, Docker, Traefik v3, zentrale Compose-Datei unter `/srv/data/docker`).

Der Stack liegt bewusst **neben** der zentralen Compose-Datei: TabSlice wird aus dem
Repository gebaut und lässt sich mit einem Befehl starten, stoppen und wieder entfernen,
ohne die übrigen Dienste anzufassen. Traefik findet den Container über Labels im externen
Netz `docker_web`.

## 1. DNS bei IONOS

| Typ | Hostname | Wert |
|---|---|---|
| CNAME | `tabslice` | `nas2.bqmsk4l2qhgb39un.myfritz.net` |

Das `nas2.` ist wichtig – ohne es liefert myfritz.net die IPv6 der FritzBox, und
Let's Encrypt scheitert (siehe NAS-Doku `04-dns-und-ssl.md`). Port 80/443 sind bereits in
der FritzBox auf `192.168.178.58` freigegeben; daran ändert sich nichts.

Prüfen (dauert je nach TTL einige Minuten):

```bash
dig +short tabslice.exposed-to-reality.de
# erwartet: 91.35.118.133 (und/oder die IPv6 des NAS)
```

## 2. Repository auf dem NAS

```bash
mkdir -p /srv/data/rest
git clone https://github.com/madex/tabslice.git /srv/data/rest/tabslice
cd /srv/data/rest/tabslice
```

`/srv/data/rest` liegt auf der Datenplatte und wird vom täglichen Backup-Job
(`/srv/data` → `/srv/backup`) automatisch mitgesichert. Die Docker-Images bleiben auf
der SSD (`/srv/docker`).

## 3. Admin-Passwort setzen

```bash
cd /srv/data/rest/tabslice
cat > .env <<EOF
ADMIN_PASSWORD="$(openssl rand -hex 24)"
TRUST_PROXY=1
COOKIE_SECURE=1
EMBED_FRAME_ANCESTORS="*"
EOF
chmod 600 .env
cat .env   # Passwort notieren / in den Passwortmanager legen
```

Alternativ ein scrypt-Hash statt Klartext (dann steht das Passwort nicht in der Datei):

```bash
docker run --rm -v "$PWD":/app -w /app node:22-alpine \
  node scripts/hash-password.mjs 'dein-passwort'
# Ausgabe als ADMIN_PASSWORD_HASH="scrypt$..." in .env eintragen
```

`TRUST_PROXY=1` und `COOKIE_SECURE=1` stehen zusätzlich in der Compose-Datei; die
`.env`-Werte sind nur die dokumentierte Absicherung.

## 4. Datenordner anlegen

Der Container läuft als Benutzer `node` (UID 1000). Die Bind-Mounts müssen dieser UID
gehören, sonst kann die App keine Uploads, keinen Index und keinen SoundFont-Cache
schreiben:

```bash
cd /srv/data/rest/tabslice
mkdir -p data/slices data/soundfonts scores
chown -R 1000:1000 data scores
```

> Nicht pauschal `chown -R` auf `/srv/data` anwenden – andere Container haben eigene
> Owner (siehe NAS-Doku `06-probleme-und-loesungen.md`, Punkt 13).

## 5. Starten

```bash
cd /srv/data/rest/tabslice
docker compose -f deploy/nas/docker-compose.yml up -d --build
docker compose -f deploy/nas/docker-compose.yml ps
docker compose -f deploy/nas/docker-compose.yml logs -f tabslice
```

Der erste Build lädt `node:22-alpine` und installiert die npm-Pakete; das dauert auf dem
NAS einige Minuten. Danach:

- lokal: <http://192.168.178.58:3001>
- Healthcheck: <http://192.168.178.58:3001/api/health>
- extern: <https://tabslice.exposed-to-reality.de>
- Admin: <https://tabslice.exposed-to-reality.de/admin>

Der Host-Port **3001** ist nur für Tests im LAN gedacht (Gitea belegt bereits 3000).
Für den öffentlichen Zugriff ist er nicht nötig; er kann in der Compose-Datei entfernt
werden.

## 6. Zertifikat prüfen

Traefik fordert das Let's-Encrypt-Zertifikat beim ersten HTTPS-Aufruf automatisch an
(HTTP-Challenge auf Port 80):

```bash
docker logs -f traefik
curl -I https://tabslice.exposed-to-reality.de
```

Erwartet: `HTTP/2 200` und ein gültiges Let's-Encrypt-Zertifikat. Bei Problemen zuerst
DNS und Port 80 prüfen (`curl -I http://tabslice.exposed-to-reality.de`).

## 7. Updates

Watchtower aktualisiert nur Images aus Registries. Das lokal gebaute `tabslice:latest`
wird **nicht** automatisch neu gebaut, daher nach jedem `git pull` neu bauen:

```bash
cd /srv/data/rest/tabslice
git pull
docker compose -f deploy/nas/docker-compose.yml up -d --build
```

## 8. Stoppen und entfernen

```bash
cd /srv/data/rest/tabslice
docker compose -f deploy/nas/docker-compose.yml down
```

`data/` und `scores/` bleiben erhalten. Zum vollständigen Entfernen zusätzlich das
Verzeichnis `/srv/data/rest/tabslice` löschen und den CNAME bei IONOS entfernen.

## 9. Fehlersuche

| Symptom | Ursache / Lösung |
|---|---|
| Traefik liefert 404 | Labels oder Netzwerk passen nicht. `docker inspect tabslice --format '{{json .Config.Labels}}'` und `docker network inspect docker_web` prüfen. |
| 502 Bad Gateway | Container läuft nicht oder ist nicht im Netz `docker_web`. `docker compose ... ps` und Logs prüfen. |
| Kein Zertifikat | CNAME zeigt nicht auf `nas2.…myfritz.net`, Port 80 ist blockiert, oder der Router-Hairpin stört beim Test aus dem LAN. Von außen testen. |
| Admin-Login: „HTTPS erforderlich“ | `COOKIE_SECURE=1` ohne TLS oder `TRUST_PROXY` fehlt. Hinter Traefik beides auf `1`. |
| Upload bricht ab | App-Limit 25 MB. Traefik setzt kein eigenes Limit; bei Bedarf `client_max_body_size`-Äquivalent nicht nötig. |
| Datei im Drop-Ordner fehlt | Erlaubte Endung, `scores/` für UID 1000 lesbar, in der Bibliothek „Aktualisieren“ drücken. |
| SoundFont lädt nicht | Einmaliger Download braucht Internet; Schreibrechte auf `data/soundfonts/` prüfen. |
| Externe URL aus dem LAN nicht erreichbar | FritzBox-NAT-Hairpin. Lokal `http://192.168.178.58:3001` nutzen. |
