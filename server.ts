import 'dotenv/config';
import * as alphaTab from '@coderline/alphatab';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import type {NextFunction, Request, Response} from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const IS_PROD = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
const FRAME_ANCESTORS = process.env.EMBED_FRAME_ANCESTORS || '*';

// Set COOKIE_SECURE=0 if you run production over plain HTTP (e.g. behind a
// reverse proxy that terminates TLS). Default: secure cookies in production.
const COOKIE_SECURE =
  process.env.COOKIE_SECURE === undefined ? IS_PROD : process.env.COOKIE_SECURE === '1';

const DATA_DIR = path.resolve(__dirname, 'data', 'slices');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const FOLDER_ID_FILE = path.join(DATA_DIR, 'folder-ids.json');
const SCORES_DIR = path.resolve(__dirname, 'scores');
const SOUNDFONTS_DIR = path.resolve(__dirname, 'data', 'soundfonts');
const EXAMPLES_DIR = path.resolve(__dirname, 'examples');

const ADMIN_COOKIE = 'tabslice_admin';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

interface SoundFontPreset {
  id: string;
  name: string;
  description: string;
  fileName: string;
  sizeLabel: string;
  localPath?: string;
  remoteUrl?: string;
}

const SOUNDFONT_PRESETS: SoundFontPreset[] = [
  {
    id: 'generaluser',
    name: 'GeneralUser GS 2.0.3',
    description: 'Standard · Warmer Fingerstyle-Bass, ausgewogene Gitarren & Drums',
    fileName: 'GeneralUser-GS-2.0.3.sf2',
    sizeLabel: '30,8 MB',
    remoteUrl:
      'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2',
  },
  {
    id: 'fluidr3',
    name: 'FluidR3 GM (Studio)',
    description: 'Alternative GM-Bank · komprimiertes SF3',
    fileName: 'FluidR3Mono_GM.sf3',
    sizeLabel: '22 MB',
    remoteUrl:
      'https://raw.githubusercontent.com/musescore/MuseScore/v3.6.2/share/sound/FluidR3Mono_GM.sf3',
  },
  {
    id: 'musescore',
    name: 'MuseScore General HD',
    description: 'Große Studio-Samplebank',
    fileName: 'MuseScore_General.sf3',
    sizeLabel: '38 MB',
    remoteUrl:
      'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3',
  },
  {
    id: 'sonivox',
    name: 'Sonivox Kompakt',
    description: 'Ultra-schnell bei langsamer Verbindung',
    fileName: 'sonivox.sf2',
    sizeLabel: '1,3 MB',
    localPath: path.resolve(__dirname, 'public', 'soundfont', 'sonivox.sf2'),
  },
];

// Deduplicate concurrent SoundFont downloads on the server
const activeSoundFontDownloads = new Map<string, Promise<string>>();

const ALLOWED_EXTENSIONS = new Set([
  'gp',
  'gp3',
  'gp4',
  'gp5',
  'gpx',
  'gp7',
  'gp8',
  'xml',
  'musicxml',
  'mxl',
  'cap',
  'tex',
]);

const ALLOWED_EXTENSIONS_LABEL =
  '.gp, .gp3–.gp8, .gpx, .xml, .musicxml, .mxl, .cap, .tex';

export interface SliceRecord {
  id: string;
  title: string;
  artist: string;
  fileName: string;
  ext: string;
  sizeBytes: number;
  tempo: number;
  trackCount: number;
  trackNames: string[];
  barCount: number;
  defaultLayout: 'page' | 'horizontal';
  showFretboard: boolean;
  source: 'upload' | 'folder';
  createdAt: string;
}

interface ParsedMeta {
  title: string;
  artist: string;
  tempo: number;
  trackCount: number;
  trackNames: string[];
  barCount: number;
}

type AdminSecret =
  | {kind: 'plain'; value: string}
  | {kind: 'scrypt'; salt: Buffer; hash: Buffer};

// Cache parsed metadata for files in scores/ keyed by filename:mtimeMs:size
const folderMetaCache = new Map<string, ParsedMeta>();

// --- Admin authentication -------------------------------------------------

function loadAdminSecret(): AdminSecret | null {
  const hashValue = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (hashValue) {
    const match = /^scrypt\$([0-9a-f]+)\$([0-9a-f]+)$/i.exec(hashValue);
    if (match) {
      return {
        kind: 'scrypt',
        salt: Buffer.from(match[1], 'hex'),
        hash: Buffer.from(match[2], 'hex'),
      };
    }
    console.warn(
      '[TabSlice] ADMIN_PASSWORD_HASH ist ungültig. Erwartet: scrypt$<salt-hex>$<hash-hex>.',
    );
  }

  const plain = process.env.ADMIN_PASSWORD;
  if (plain) {
    return {kind: 'plain', value: plain};
  }
  return null;
}

let adminSecret = loadAdminSecret();
let generatedPassword: string | null = null;
if (!adminSecret) {
  // Everyone with the URL could administer the instance otherwise. Generate
  // a one-off password so local development stays usable and print it once.
  generatedPassword = crypto.randomBytes(9).toString('base64url');
  adminSecret = {kind: 'plain', value: generatedPassword};
}

const adminSessions = new Map<string, number>();
const loginFailures = new Map<string, {count: number; resetAt: number}>();

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function verifyAdminPassword(input: string): boolean {
  if (!adminSecret || input.length === 0) return false;
  if (adminSecret.kind === 'plain') {
    return safeEqual(input, adminSecret.value);
  }
  const derived = crypto.scryptSync(input, adminSecret.salt, adminSecret.hash.length, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return (
    derived.length === adminSecret.hash.length && crypto.timingSafeEqual(derived, adminSecret.hash)
  );
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

function sessionTokenFrom(req: Request): string | null {
  const token = parseCookies(req.headers.cookie)[ADMIN_COOKIE];
  return token && token.length > 0 ? token : null;
}

function isAdminRequest(req: Request): boolean {
  const token = sessionTokenFrom(req);
  if (!token) return false;
  const expiresAt = adminSessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function createAdminSession(): string {
  const token = crypto.randomBytes(32).toString('base64url');
  adminSessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function setAdminCookie(res: Response, token: string) {
  const parts = [
    `${ADMIN_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAdminCookie(res: Response) {
  const parts = [`${ADMIN_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of adminSessions) {
    if (expiresAt <= now) adminSessions.delete(token);
  }
  for (const [key, entry] of loginFailures) {
    if (entry.resetAt <= now) loginFailures.delete(key);
  }
}
const cleanupTimer = setInterval(cleanupSessions, 10 * 60 * 1000);
cleanupTimer.unref();

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function isLoginRateLimited(req: Request): boolean {
  const entry = loginFailures.get(clientKey(req));
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    loginFailures.delete(clientKey(req));
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function registerLoginFailure(req: Request) {
  const key = clientKey(req);
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || entry.resetAt <= now) {
    loginFailures.set(key, {count: 1, resetAt: now + LOGIN_WINDOW_MS});
    return;
  }
  entry.count += 1;
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!isAdminRequest(req)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).json({error: 'Admin-Anmeldung erforderlich.'});
    return;
  }
  next();
}

// In addition to the session cookie (SameSite=Lax) every state-changing
// admin request must carry this header. Cross-site forms cannot set it.
function requireAdminMutation(req: Request, res: Response, next: NextFunction) {
  if (!isAdminRequest(req)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).json({error: 'Admin-Anmeldung erforderlich.'});
    return;
  }
  if (req.get('X-TabSlice-Admin') !== '1') {
    res.status(403).json({error: 'Ungültige Anfrage (CSRF-Schutz).'});
    return;
  }
  next();
}

// --- Filesystem helpers ---------------------------------------------------

function ensureDirectories() {
  fs.mkdirSync(DATA_DIR, {recursive: true});
  fs.mkdirSync(SCORES_DIR, {recursive: true});
  fs.mkdirSync(SOUNDFONTS_DIR, {recursive: true});
  if (!fs.existsSync(INDEX_FILE)) {
    fs.writeFileSync(INDEX_FILE, '[]', 'utf-8');
  }
}

function writeJsonAtomic(filePath: string, value: unknown) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function readUploadedIndex(): SliceRecord[] {
  try {
    const raw = fs.readFileSync(INDEX_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SliceRecord[]) : [];
  } catch {
    return [];
  }
}

function writeUploadedIndex(records: SliceRecord[]) {
  writeJsonAtomic(INDEX_FILE, records);
}

// Persisted mapping for files dropped into scores/. UUIDs stay stable when
// the metadata is rescanned and are not derivable from the file name.
let folderIdMap: Record<string, string> | null = null;
let folderIdMapDirty = false;

function readFolderIdMap(): Record<string, string> {
  if (folderIdMap) return folderIdMap;
  try {
    const raw = fs.readFileSync(FOLDER_ID_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    folderIdMap =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {};
  } catch {
    folderIdMap = {};
  }
  return folderIdMap;
}

function writeFolderIdMapIfDirty() {
  if (!folderIdMapDirty || !folderIdMap) return;
  writeJsonAtomic(FOLDER_ID_FILE, folderIdMap);
  folderIdMapDirty = false;
}

function isSafeId(id: string): boolean {
  // New IDs are UUIDs. The lower bound keeps legacy short IDs working.
  return /^[A-Za-z0-9_-]{3,64}$/.test(id);
}

function generateSliceId(existingIds: Set<string>): string {
  let id = crypto.randomUUID();
  while (existingIds.has(id)) id = crypto.randomUUID();
  return id;
}

function folderIdFor(fileName: string): string {
  const map = readFolderIdMap();
  const existing = map[fileName];
  if (existing && isSafeId(existing)) return existing;

  const used = new Set(Object.values(map));
  let id = crypto.randomUUID();
  while (used.has(id)) id = crypto.randomUUID();
  map[fileName] = id;
  folderIdMapDirty = true;
  return id;
}

async function ensureSoundFontCached(preset: SoundFontPreset): Promise<string> {
  if (preset.localPath && fs.existsSync(preset.localPath)) {
    return preset.localPath;
  }

  const cachedPath = path.join(SOUNDFONTS_DIR, preset.fileName);
  if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 100_000) {
    return cachedPath;
  }

  if (!preset.remoteUrl) {
    throw new Error('SoundFont-Quelle nicht konfiguriert.');
  }

  const inflight = activeSoundFontDownloads.get(preset.id);
  if (inflight) return inflight;

  const downloadPromise = (async () => {
    const tmpPath = `${cachedPath}.tmp`;
    const response = await fetch(preset.remoteUrl!);
    if (!response.ok || !response.body) {
      throw new Error(`SoundFont-Download fehlgeschlagen (HTTP ${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(tmpPath, Buffer.from(arrayBuffer));
    fs.renameSync(tmpPath, cachedPath);
    return cachedPath;
  })().finally(() => {
    activeSoundFontDownloads.delete(preset.id);
  });

  activeSoundFontDownloads.set(preset.id, downloadPromise);
  return downloadPromise;
}

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx === -1) return '';
  return fileName.slice(idx + 1).toLowerCase();
}

function formatNameFallback(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function loadScoreForExt(bytes: Uint8Array, ext: string): alphaTab.model.Score {
  if (ext === 'tex') {
    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.initFromString(Buffer.from(bytes).toString('utf-8'), new alphaTab.Settings());
    return importer.readScore();
  }
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes);
}

function parseScoreMetadata(bytes: Uint8Array, fileName: string): ParsedMeta {
  const fallbackTitle = formatNameFallback(fileName) || 'Unbenannte Partitur';
  const ext = getExtension(fileName);
  try {
    const score = loadScoreForExt(bytes, ext);
    return {
      title: score.title?.trim() || fallbackTitle,
      artist: score.artist?.trim() || '',
      tempo: score.tempo || 120,
      trackCount: score.tracks.length,
      trackNames: score.tracks.map((t) => t.name || `Spur ${t.index + 1}`).slice(0, 12),
      barCount: score.masterBars.length,
    };
  } catch {
    return {
      title: fallbackTitle,
      artist: '',
      tempo: 120,
      trackCount: 1,
      trackNames: [],
      barCount: 0,
    };
  }
}

function scanScoresFolder(): SliceRecord[] {
  if (!fs.existsSync(SCORES_DIR)) return [];
  const entries = fs.readdirSync(SCORES_DIR, {withFileTypes: true});
  const records: SliceRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = getExtension(entry.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;

    const fullPath = path.join(SCORES_DIR, entry.name);
    const stat = fs.statSync(fullPath);
    const id = folderIdFor(entry.name);

    const cacheKey = `${entry.name}:${stat.mtimeMs}:${stat.size}`;
    let meta = folderMetaCache.get(cacheKey);
    if (!meta) {
      const buf = fs.readFileSync(fullPath);
      meta = parseScoreMetadata(new Uint8Array(buf), entry.name);
      folderMetaCache.set(cacheKey, meta);
    }

    records.push({
      id,
      title: meta.title,
      artist: meta.artist,
      fileName: entry.name,
      ext,
      sizeBytes: stat.size,
      tempo: meta.tempo,
      trackCount: meta.trackCount,
      trackNames: meta.trackNames,
      barCount: meta.barCount,
      defaultLayout: 'page',
      showFretboard: false,
      source: 'folder',
      createdAt: stat.mtime.toISOString(),
    });
  }

  writeFolderIdMapIfDirty();
  return records.sort((a, b) => a.title.localeCompare(b.title, 'de'));
}

function getAllSlices(): SliceRecord[] {
  const uploaded = readUploadedIndex().filter((item) => {
    const filePath = path.join(DATA_DIR, `${item.id}.${item.ext}`);
    return fs.existsSync(filePath);
  });
  const folderSlices = scanScoresFolder();
  const uploadedIds = new Set(uploaded.map((u) => u.id));
  const merged = [
    ...uploaded.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    ...folderSlices.filter((f) => !uploadedIds.has(f.id)),
  ];
  return merged;
}

function findSliceAndPath(id: string): {record: SliceRecord; filePath: string} | null {
  if (!isSafeId(id)) return null;

  const uploaded = readUploadedIndex();
  const foundUploaded = uploaded.find((u) => u.id === id);
  if (foundUploaded) {
    const filePath = path.join(DATA_DIR, `${foundUploaded.id}.${foundUploaded.ext}`);
    if (fs.existsSync(filePath)) {
      return {record: foundUploaded, filePath};
    }
  }

  const foundFolder = scanScoresFolder().find((f) => f.id === id);
  if (foundFolder) {
    const filePath = path.join(SCORES_DIR, foundFolder.fileName);
    if (fs.existsSync(filePath)) {
      return {record: foundFolder, filePath};
    }
  }

  return null;
}

function decodeHeaderValue(val: string | string[] | undefined): string {
  if (!val) return '';
  const raw = Array.isArray(val) ? val[0] : val;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function cleanTextHeader(val: string | string[] | undefined, maxLength = 200): string {
  return decodeHeaderValue(val)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeContentDispositionName(fileName: string): string {
  return fileName.replace(/["\\\r\n]/g, '_');
}

// --- HTTP server ----------------------------------------------------------

async function startServer() {
  ensureDirectories();

  const app = express();
  app.disable('x-powered-by');
  if (TRUST_PROXY) app.set('trust proxy', 1);

  // Security headers. frame-ancestors is intentionally permissive so that
  // forum embeds keep working; tighten it via EMBED_FRAME_ANCESTORS.
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Only the explicit embed view may be framed. Admin and normal pages are
    // protected against clickjacking.
    const embeddable =
      req.path.includes('/embed') ||
      req.query.embed === '1' ||
      req.query.embed === 'true';
    res.setHeader(
      'Content-Security-Policy',
      `frame-ancestors ${embeddable ? FRAME_ANCESTORS : "'none'"}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/slices/') ||
      req.path.startsWith('/examples/') ||
      req.path === '/admin'
    ) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    next();
  });

  // Reject cross-site state-changing requests early. The admin mutations also
  // require a custom header, which is the primary CSRF defence.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    const origin = req.get('origin');
    if (!origin) {
      next();
      return;
    }
    try {
      if (new URL(origin).host !== req.get('host')) {
        res.status(403).json({error: 'Cross-Origin-Anfrage abgelehnt.'});
        return;
      }
    } catch {
      res.status(403).json({error: 'Ungültiger Origin-Header.'});
      return;
    }
    next();
  });

  app.get('/robots.txt', (_req: Request, res: Response) => {
    res
      .type('text/plain')
      .send(
        'User-agent: *\nDisallow: /slices/\nDisallow: /api/\nDisallow: /admin\nDisallow: /examples/\n',
      );
  });

  // Small static helpers (e.g. the iframe test page). They only reference
  // public slice URLs and belong to the app, so they cannot live in scores/.
  app.use(
    '/examples',
    express.static(EXAMPLES_DIR, {index: false, dotfiles: 'deny', maxAge: '1h'}),
  );

  app.get('/api/health', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ok: true, adminConfigured: !generatedPassword});
  });

  // --- Admin session endpoints (public, rate limited) ---
  app.get('/api/admin/session', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({authenticated: isAdminRequest(req)});
  });

  app.post('/api/admin/login', express.json({limit: '4kb'}), (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (COOKIE_SECURE && !req.secure) {
      res.status(400).json({
        error:
          'Admin-Login erfordert HTTPS. Für lokale Tests ohne TLS: COOKIE_SECURE=0 setzen ' +
          '(hinter einem Proxy zusätzlich TRUST_PROXY=1).',
      });
      return;
    }
    if (isLoginRateLimited(req)) {
      res.setHeader('Retry-After', String(Math.ceil(LOGIN_WINDOW_MS / 1000)));
      res.status(429).json({error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.'});
      return;
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!verifyAdminPassword(password)) {
      registerLoginFailure(req);
      res.status(401).json({error: 'Passwort falsch.'});
      return;
    }

    loginFailures.delete(clientKey(req));
    const token = createAdminSession();
    setAdminCookie(res, token);
    res.json({ok: true});
  });

  app.post('/api/admin/logout', (req: Request, res: Response) => {
    const token = sessionTokenFrom(req);
    if (token) adminSessions.delete(token);
    clearAdminCookie(res);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ok: true});
  });

  // --- SoundFont catalog & caching proxy (public) ---
  app.get('/api/soundfonts', (_req: Request, res: Response) => {
    const list = SOUNDFONT_PRESETS.map((p) => {
      const target = p.localPath || path.join(SOUNDFONTS_DIR, p.fileName);
      const cached = fs.existsSync(target) && fs.statSync(target).size > 100_000;
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        sizeLabel: p.sizeLabel,
        cached,
      };
    });
    res.json({soundFonts: list});
  });

  app.get('/api/soundfonts/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const preset = SOUNDFONT_PRESETS.find((p) => p.id === id);
    if (!preset) {
      res.status(404).json({error: 'Unbekannter SoundFont.'});
      return;
    }

    try {
      const filePath = await ensureSoundFontCached(preset);
      const stat = fs.statSync(filePath);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${sanitizeContentDispositionName(preset.fileName)}"`,
      );
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'SoundFont konnte nicht geladen werden.';
      res.status(502).json({error: msg});
    }
  });

  // --- Slice API ---
  // The full library is admin-only. Public visitors need the exact UUID link.
  app.get('/api/slices', requireAdmin, (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({slices: getAllSlices()});
  });

  app.get('/api/slices/:id', (req: Request, res: Response) => {
    const found = findSliceAndPath(String(req.params.id || ''));
    if (!found) {
      res.status(404).json({error: 'Slice nicht gefunden.'});
      return;
    }
    res.json({slice: found.record});
  });

  app.get('/api/slices/:id/file', (req: Request, res: Response) => {
    const found = findSliceAndPath(String(req.params.id || ''));
    if (!found) {
      res.status(404).json({error: 'Datei nicht gefunden.'});
      return;
    }
    const {record, filePath} = found;
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Slice-Ext', record.ext);
    res.setHeader(
      'Content-Type',
      record.ext === 'tex' ? 'text/plain; charset=utf-8' : 'application/octet-stream',
    );
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${sanitizeContentDispositionName(record.fileName)}"`,
    );
    fs.createReadStream(filePath).pipe(res);
  });

  // Upload a binary Guitar Pro / MusicXML / Capella / alphaTex file
  app.post(
    '/api/slices/upload',
    requireAdminMutation,
    express.raw({type: '*/*', limit: '25mb'}),
    (req: Request, res: Response) => {
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({error: 'Keine Dateidaten empfangen.'});
        return;
      }

      const providedName = cleanTextHeader(req.headers['x-file-name'], 255);
      const fileName = path.basename(providedName || 'score.gp');
      const ext = getExtension(fileName);
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        res.status(400).json({
          error: `Dateiformat .${ext || '?'} wird nicht unterstützt. Erlaubt: ${ALLOWED_EXTENSIONS_LABEL}`,
        });
        return;
      }

      const customTitle = cleanTextHeader(req.headers['x-title']);
      const customArtist = cleanTextHeader(req.headers['x-artist']);
      const defaultLayout =
        decodeHeaderValue(req.headers['x-layout']) === 'horizontal' ? 'horizontal' : 'page';
      const showFretboard = decodeHeaderValue(req.headers['x-fretboard']) === '1';

      const existingIds = new Set(getAllSlices().map((s) => s.id));
      const id = generateSliceId(existingIds);

      const parsed = parseScoreMetadata(new Uint8Array(body), fileName);
      const targetPath = path.join(DATA_DIR, `${id}.${ext}`);
      fs.writeFileSync(targetPath, body);

      const record: SliceRecord = {
        id,
        title: customTitle || parsed.title,
        artist: customArtist || parsed.artist,
        fileName,
        ext,
        sizeBytes: body.length,
        tempo: parsed.tempo,
        trackCount: parsed.trackCount,
        trackNames: parsed.trackNames,
        barCount: parsed.barCount,
        defaultLayout,
        showFretboard,
        source: 'upload',
        createdAt: new Date().toISOString(),
      };

      const uploaded = readUploadedIndex();
      uploaded.unshift(record);
      writeUploadedIndex(uploaded);

      res.status(201).json({slice: record});
    },
  );

  // Create a new slice directly from alphaTex text
  app.post(
    '/api/slices/tex',
    requireAdminMutation,
    express.json({limit: '2mb'}),
    (req: Request, res: Response) => {
      const tex = typeof req.body?.tex === 'string' ? req.body.tex.trim() : '';
      if (!tex) {
        res.status(400).json({error: 'Bitte alphaTex-Code eingeben.'});
        return;
      }

      const customTitle = cleanTextHeader(req.body?.title);
      const customArtist = cleanTextHeader(req.body?.artist);
      const defaultLayout = req.body?.defaultLayout === 'horizontal' ? 'horizontal' : 'page';
      const showFretboard = Boolean(req.body?.showFretboard);

      const bytes = Buffer.from(tex, 'utf-8');
      // Validate alphaTex parses cleanly before saving
      try {
        loadScoreForExt(new Uint8Array(bytes), 'tex');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ungültige alphaTex-Syntax.';
        res.status(400).json({error: `alphaTex konnte nicht geparst werden: ${msg}`});
        return;
      }

      const existingIds = new Set(getAllSlices().map((s) => s.id));
      const id = generateSliceId(existingIds);

      const fileName = `${id}.tex`;
      const parsed = parseScoreMetadata(new Uint8Array(bytes), fileName);
      const targetPath = path.join(DATA_DIR, fileName);
      fs.writeFileSync(targetPath, bytes);

      const record: SliceRecord = {
        id,
        title: customTitle || parsed.title || 'Neuer alphaTex-Slice',
        artist: customArtist || parsed.artist,
        fileName,
        ext: 'tex',
        sizeBytes: bytes.length,
        tempo: parsed.tempo,
        trackCount: parsed.trackCount,
        trackNames: parsed.trackNames,
        barCount: parsed.barCount,
        defaultLayout,
        showFretboard,
        source: 'upload',
        createdAt: new Date().toISOString(),
      };

      const uploaded = readUploadedIndex();
      uploaded.unshift(record);
      writeUploadedIndex(uploaded);

      res.status(201).json({slice: record});
    },
  );

  // Update metadata for an uploaded slice
  app.patch(
    '/api/slices/:id',
    requireAdminMutation,
    express.json(),
    (req: Request, res: Response) => {
      const id = String(req.params.id || '');
      const uploaded = readUploadedIndex();
      const idx = uploaded.findIndex((item) => item.id === id);
      if (idx === -1) {
        res.status(404).json({error: 'Nur hochgeladene Slices können bearbeitet werden.'});
        return;
      }

      const current = uploaded[idx];
      const updated: SliceRecord = {
        ...current,
        title:
          typeof req.body?.title === 'string' && req.body.title.trim()
            ? cleanTextHeader(req.body.title)
            : current.title,
        artist:
          typeof req.body?.artist === 'string'
            ? cleanTextHeader(req.body.artist)
            : current.artist,
        defaultLayout:
          req.body?.defaultLayout === 'horizontal'
            ? 'horizontal'
            : req.body?.defaultLayout === 'page'
              ? 'page'
              : current.defaultLayout,
        showFretboard:
          typeof req.body?.showFretboard === 'boolean'
            ? req.body.showFretboard
            : current.showFretboard,
      };

      uploaded[idx] = updated;
      writeUploadedIndex(uploaded);
      res.json({slice: updated});
    },
  );

  // Delete an uploaded slice
  app.delete('/api/slices/:id', requireAdminMutation, (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const uploaded = readUploadedIndex();
    const idx = uploaded.findIndex((item) => item.id === id);
    if (idx === -1) {
      res.status(404).json({error: 'Slice nicht gefunden oder schreibgeschützte Ordnerdatei.'});
      return;
    }

    const [removed] = uploaded.splice(idx, 1);
    writeUploadedIndex(uploaded);

    const filePath = path.join(DATA_DIR, `${removed.id}.${removed.ext}`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({deleted: id});
  });

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({error: 'API-Route nicht gefunden.'});
  });

  // --- Frontend serving (Vite dev middleware or production static dist) ---
  if (!IS_PROD) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
      throw new Error(
        'Frontend-Build fehlt: dist/index.html nicht gefunden. Bitte zuerst "npm run build" ausführen.',
      );
    }
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? Number((err as {status?: number}).status) || 500
        : 500;
    if (req.path.startsWith('/api/')) {
      const message =
        status === 413
          ? 'Datei zu groß (maximal 25 MB).'
          : status === 400
            ? 'Ungültige Anfrage.'
            : 'Interner Serverfehler.';
      res.status(status).json({error: message});
      return;
    }
    res.status(status).type('text/plain').send('Interner Serverfehler.');
  });

  const server = app.listen(PORT, HOST, () => {
    console.log(`[TabSlice] Server läuft auf http://${HOST}:${PORT}`);
    if (generatedPassword) {
      console.warn(
        '[TabSlice] ADMIN_PASSWORD/ADMIN_PASSWORD_HASH nicht gesetzt. ' +
          `Temporäres Admin-Passwort: ${generatedPassword} (nur bis zum Neustart gültig)`,
      );
    }
    console.log('[TabSlice] Admin-Anmeldung: /admin · Öffentliche Links: /slices/<uuid>');
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start TabSlice server:', err);
  process.exit(1);
});
