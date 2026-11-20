import {Check, Copy, ExternalLink, Server} from 'lucide-react';
import React, {useState} from 'react';

interface CodeBlockProps {
  id: string;
  label: string;
  code: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}

const CodeBlock: React.FC<CodeBlockProps> = ({id, label, code, copiedKey, onCopy}) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-zinc-700">{label}</span>
      <button
        type="button"
        onClick={() => onCopy(id, code)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-md transition-colors whitespace-nowrap"
      >
        {copiedKey === id ? (
          <Check className="w-3.5 h-3.5 text-emerald-600" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
        {copiedKey === id ? 'Kopiert' : 'Kopieren'}
      </button>
    </div>
    <pre className="p-4 bg-[#14161A] text-zinc-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
      {code}
    </pre>
  </div>
);

export const HostingGuide: React.FC = () => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const installSnippet = `# 1. Node.js 22+ auf dem Server installieren & Projekt kopieren
npm install
npm run build

# 2. Admin-Passwort setzen (Pflicht für Uploads/Bibliothek)
export ADMIN_PASSWORD='ein-langes-zufaelliges-passwort'

# 3. Server starten (läuft auf Port 3000)
NODE_ENV=production PORT=3000 npm start

# Optional dauerhaft im Hintergrund mit pm2:
npm install -g pm2
ADMIN_PASSWORD='…' NODE_ENV=production PORT=3000 pm2 start npm --name "tabslice" -- start
pm2 save`;

  const nginxSnippet = `server {
    listen 443 ssl http2;
    server_name tabs.deine-domain.de;

    # Erlaubt Guitar-Pro- & Audio-Uploads bis 30 MB
    client_max_body_size 30M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # CSP/frame-ancestors setzt TabSlice selbst (EMBED_FRAME_ANCESTORS).
    }
}`;

  const iframeExample = `<iframe src="https://tabs.deine-domain.de/slices/8f14e45f-ceea-467a-9c1b-2f6d7f3a9b21/embed/?header=0&metronome=1&countin=always&fretboard=1" width="100%" height="500" frameborder="0" allowfullscreen=""></iframe>`;

  return (
    <div className="flex-1 overflow-y-auto bg-[#F4F5F7] score-scroll">
      <div className="max-w-[960px] mx-auto px-6 py-8 space-y-8">
        {/* Intro */}
        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-zinc-950">
            Hosting &amp; Einbindung in Andy&apos;s Basscamp
          </h1>
          <p className="text-sm text-zinc-600 max-w-2xl leading-relaxed">
            TabSlice ist ein leichter Node.js-Webserver (Express + alphaTab). Du kannst ihn auf einem eigenen kleinen VPS (z. B. Hetzner, Netcup, Strato) oder per One-Click auf Render, Railway oder Coolify betreiben – ohne externe Datenbank.
          </p>
          <p className="text-xs text-zinc-600 max-w-2xl leading-relaxed">
            Reines PHP-Shared-Hosting reicht nicht, weil die serverseitige Partituranalyse mit
            alphaTab in JavaScript läuft. Details und Alternativen stehen in der README.
          </p>
        </div>

        {/* Section 1: Folders */}
        <section className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <Server className="w-4 h-4 text-blue-600 shrink-0" />
            <h2 className="text-base font-semibold text-zinc-900">
              1. Wie die Dateien auf dem Server liegen
            </h2>
          </div>
          <div className="divide-y divide-zinc-100 text-xs">
            <div className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <code className="font-mono font-semibold text-zinc-900">scores/</code>
              <span className="text-zinc-600">
                Drop-Ordner: Jede per FTP/SFTP abgelegte <code className="font-mono">.gp / .gp5 / .gpx / .tex</code> Datei bekommt automatisch einen UUID-Link <code className="font-mono">/slices/&lt;uuid&gt;/embed/</code>. Die Zuordnung steht in <code className="font-mono">data/slices/folder-ids.json</code>.
              </span>
            </div>
            <div className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <code className="font-mono font-semibold text-zinc-900">data/slices/</code>
              <span className="text-zinc-600">
                Speichert alle über den Browser („Slice erstellen“) hochgeladenen Guitar-Pro-Dateien samt UUID-Index. Nur Admins sehen diese Bibliothek.
              </span>
            </div>
            <div className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <code className="font-mono font-semibold text-zinc-900">data/soundfonts/</code>
              <span className="text-zinc-600">
                Zwischenspeicher für <strong>GeneralUser GS 2.0.3</strong> (30,8 MB) – wird einmalig geladen und danach lokal ausgeliefert.
              </span>
            </div>
          </div>
        </section>

        {/* Section 1b: Admin & public links */}
        <section className="bg-white border border-zinc-200 rounded-xl p-6 space-y-3">
          <h2 className="text-base font-semibold text-zinc-900">
            Admin-Zugang &amp; öffentliche Slice-Links
          </h2>
          <div className="text-xs text-zinc-600 space-y-2 leading-relaxed">
            <p>
              <strong className="text-zinc-900">Admin:</strong> Anmeldung unter{' '}
              <code className="font-mono">/admin</code> mit dem Passwort aus{' '}
              <code className="font-mono">ADMIN_PASSWORD</code> (oder{' '}
              <code className="font-mono">ADMIN_PASSWORD_HASH</code>). Nur angemeldete Admins
              sehen die Bibliothek, können hochladen, bearbeiten und löschen.
            </p>
            <p>
              <strong className="text-zinc-900">Öffentlich:</strong> Jeder Slice hat eine
              zufällige UUID. Wer den Link <code className="font-mono">/slices/&lt;uuid&gt;</code>{' '}
              kennt, kann die Partitur ohne Login abspielen und einbetten. Es gibt keine
              öffentliche Liste und keine Suche – der Link selbst ist das Zugriffsgeheimnis.
            </p>
            <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Links sind wie Passwörter zu behandeln: nicht öffentlich posten, wenn der Inhalt
              nicht für alle bestimmt ist. Wer den Link hat, kommt nicht an der Anmeldung vorbei,
              weil es für Slice-Links bewusst keine Anmeldung gibt.
            </p>
          </div>
        </section>

        {/* Section 2: VPS / Node.js Start */}
        <section className="bg-white border border-zinc-200 rounded-xl p-6 space-y-5">
          <h2 className="text-base font-semibold text-zinc-900">
            2. Betrieb auf eigenem Webserver (VPS / Hetzner / Netcup)
          </h2>
          <CodeBlock
            id="install"
            label="Build & Serverstart (Node.js 22+)"
            code={installSnippet}
            copiedKey={copiedKey}
            onCopy={handleCopy}
          />
          <CodeBlock
            id="nginx"
            label="Nginx Reverse Proxy mit HTTPS (z. B. via Certbot / Let's Encrypt)"
            code={nginxSnippet}
            copiedKey={copiedKey}
            onCopy={handleCopy}
          />
          <p className="text-xs text-zinc-500 leading-relaxed">
            Alternativ bei <strong>Railway, Render oder Coolify</strong>: Repository verbinden, Build-Command{' '}
            <code className="font-mono text-zinc-700">npm run build</code>, Start-Command{' '}
            <code className="font-mono text-zinc-700">npm start</code> und ein permanentes Volume auf{' '}
            <code className="font-mono text-zinc-700">/app/data</code> sowie{' '}
            <code className="font-mono text-zinc-700">/app/scores</code> mounten.
          </p>
        </section>

        {/* Section 3: Iframe URL Parameters for Andy's Basscamp */}
        <section className="bg-white border border-zinc-200 rounded-xl p-6 space-y-4">
          <h2 className="text-base font-semibold text-zinc-900">
            3. Iframe-Parameter für Andy&apos;s Basscamp
          </h2>
          <p className="text-xs text-zinc-600 leading-relaxed">
            Alle Start-Optionen werden direkt als URL-Parameter an den Embed-Link angehängt – genau wie beim Generator unter <strong>„Forum-Code“</strong>:
          </p>
          <CodeBlock
            id="iframe-ex"
            label="Beispiel-Iframe für einen Forenbeitrag"
            code={iframeExample}
            copiedKey={copiedKey}
            onCopy={handleCopy}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200 text-[11px] text-zinc-500">
                  <th className="py-2 pr-4 font-medium">Parameter</th>
                  <th className="py-2 pr-4 font-medium">Werte</th>
                  <th className="py-2 font-medium">Wirkung im Embed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-zinc-700">
                <tr>
                  <td className="py-2 pr-4 font-mono text-zinc-900">header</td>
                  <td className="py-2 pr-4 font-mono">1 | 0</td>
                  <td className="py-2">Titel- &amp; Song-Kopfzeile im Player ein- oder ausblenden</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-zinc-900">metronome</td>
                  <td className="py-2 pr-4 font-mono">0 | 1</td>
                  <td className="py-2">Metronom direkt beim Öffnen aktivieren</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-zinc-900">countin</td>
                  <td className="py-2 pr-4 font-mono">off | first | always</td>
                  <td className="py-2">Einzähler: Aus, 1× am Start oder bei jeder Loop-Wiederholung</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-zinc-900">loop</td>
                  <td className="py-2 pr-4 font-mono">0 | 1</td>
                  <td className="py-2">Endlosschleife beim Start aktiv</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-zinc-900">fretboard</td>
                  <td className="py-2 pr-4 font-mono">0 | 1</td>
                  <td className="py-2">Live-Griffbrett standardmäßig aufgeklappt</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-zinc-900">stave</td>
                  <td className="py-2 pr-4 font-mono">default | scoretab | tab | score</td>
                  <td className="py-2">Noten + Tabulatur, nur Tabulatur oder nur Noten</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-zinc-900">layout</td>
                  <td className="py-2 pr-4 font-mono">page | horizontal</td>
                  <td className="py-2">Seitenansicht oder horizontaler Soundslice-Streifen</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-zinc-900">speed</td>
                  <td className="py-2 pr-4 font-mono">25 – 200</td>
                  <td className="py-2">Startgeschwindigkeit in Prozent (z. B. <code className="font-mono">speed=80</code>)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-zinc-900">sf</td>
                  <td className="py-2 pr-4 font-mono">generaluser | fluidr3 | musescore | sonivox</td>
                  <td className="py-2">SoundFont-Auswahl (Standard: GeneralUser GS 2.0.3)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 4: Attribution / Licenses */}
        <section className="bg-white border border-zinc-200 rounded-xl p-6 space-y-2 text-xs text-zinc-600">
          <h2 className="text-sm font-semibold text-zinc-900">Quellen &amp; Lizenzen</h2>
          <p>
            Notensatz, Tabulatur-Rendering (Guitar Pro &amp; <strong>alphaTex</strong>) und Web-Synthesizer basieren auf{' '}
            <a
              href="https://alphatab.net"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline inline-flex items-center gap-0.5 font-medium"
            >
              alphaTab (MPL-2.0)
              <ExternalLink className="w-3 h-3" />
            </a>
            . Standard-SoundFont:{' '}
            <a
              href="https://www.schristiancollins.com/generaluser.php"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline inline-flex items-center gap-0.5 font-medium"
            >
              GeneralUser GS 2.0.3 von S. Christian Collins
              <ExternalLink className="w-3 h-3" />
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
};
