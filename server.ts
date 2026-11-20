import * as alphaTab from '@coderline/alphatab';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import type {Request, Response} from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

const DATA_DIR = path.resolve(__dirname, 'data', 'slices');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');
const SCORES_DIR = path.resolve(__dirname, 'scores');

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

// Cache parsed metadata for files in scores/ keyed by filename:mtimeMs
const folderMetaCache = new Map<string, ParsedMeta>();

function ensureDirectories() {
  fs.mkdirSync(DATA_DIR, {recursive: true});
  fs.mkdirSync(SCORES_DIR, {recursive: true});
  if (!fs.existsSync(INDEX_FILE)) {
    fs.writeFileSync(INDEX_FILE, '[]', 'utf-8');
  }
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
  fs.writeFileSync(INDEX_FILE, JSON.stringify(records, null, 2), 'utf-8');
}

function sanitizeSlug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function generateShortId(length = 6): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx === -1) return '';
  return fileName.slice(idx + 1).toLowerCase();
}

function formatNameFallback(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const usedIds = new Set<string>();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = getExtension(entry.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;

    const fullPath = path.join(SCORES_DIR, entry.name);
    const stat = fs.statSync(fullPath);
    const baseName = entry.name.replace(/\.[^.]+$/, '');
    let id = sanitizeSlug(baseName) || 'score';
    if (usedIds.has(id)) {
      id = `${id}-${ext}`;
    }
    usedIds.add(id);

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
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId || safeId !== id) return null;

  const uploaded = readUploadedIndex();
  const foundUploaded = uploaded.find((u) => u.id === safeId);
  if (foundUploaded) {
    const fp = path.join(DATA_DIR, `${foundUploaded.id}.${foundUploaded.ext}`);
    if (fs.existsSync(fp)) {
      return {record: foundUploaded, filePath: fp};
    }
  }

  const folderSlices = scanScoresFolder();
  const foundFolder = folderSlices.find((f) => f.id === safeId);
  if (foundFolder) {
    const fp = path.join(SCORES_DIR, foundFolder.fileName);
    if (fs.existsSync(fp)) {
      return {record: foundFolder, filePath: fp};
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

async function startServer() {
  ensureDirectories();

  const app = express();

  // Allow embedding in external forums via <iframe>
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', 'frame-ancestors *');
    next();
  });

  // --- REST API Routes ---

  // List all slices (uploaded + scores/ folder)
  app.get('/api/slices', (_req: Request, res: Response) => {
    const slices = getAllSlices();
    res.json({slices});
  });

  // Get metadata for a single slice
  app.get('/api/slices/:id', (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const found = findSliceAndPath(id);
    if (!found) {
      res.status(404).json({error: 'Slice nicht gefunden.'});
      return;
    }
    res.json({slice: found.record});
  });

  // Download / stream raw Guitar Pro, MusicXML or alphaTex file
  app.get('/api/slices/:id/file', (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const found = findSliceAndPath(id);
    if (!found) {
      res.status(404).json({error: 'Datei nicht gefunden.'});
      return;
    }
    const {record, filePath} = found;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('X-Slice-Ext', record.ext);
    res.setHeader(
      'Content-Type',
      record.ext === 'tex' ? 'text/plain; charset=utf-8' : 'application/octet-stream',
    );
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${record.fileName.replace(/"/g, '')}"`,
    );
    fs.createReadStream(filePath).pipe(res);
  });

  // Upload a binary Guitar Pro / MusicXML / Capella / alphaTex file
  app.post(
    '/api/slices/upload',
    express.raw({type: '*/*', limit: '25mb'}),
    (req: Request, res: Response) => {
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({error: 'Keine Dateidaten empfangen.'});
        return;
      }

      const fileName = decodeHeaderValue(req.headers['x-file-name']) || 'score.gp';
      const ext = getExtension(fileName);
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        res.status(400).json({
          error: `Dateiformat .${ext || '?'} wird nicht unterstützt. Erlaubt: .gp, .gp3–.gp8, .gpx, .xml, .musicxml, .mxl, .cap, .tex`,
        });
        return;
      }

      const customTitle = decodeHeaderValue(req.headers['x-title']).trim();
      const customArtist = decodeHeaderValue(req.headers['x-artist']).trim();
      const defaultLayout =
        decodeHeaderValue(req.headers['x-layout']) === 'horizontal' ? 'horizontal' : 'page';
      const showFretboard = decodeHeaderValue(req.headers['x-fretboard']) === '1';
      const requestedSlug = sanitizeSlug(decodeHeaderValue(req.headers['x-custom-id']));

      const existingIds = new Set(getAllSlices().map((s) => s.id));
      let id = requestedSlug && !existingIds.has(requestedSlug) ? requestedSlug : '';
      while (!id || existingIds.has(id)) {
        id = generateShortId(6);
      }

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
  app.post('/api/slices/tex', express.json({limit: '2mb'}), (req: Request, res: Response) => {
    const tex = typeof req.body?.tex === 'string' ? req.body.tex.trim() : '';
    if (!tex) {
      res.status(400).json({error: 'Bitte alphaTex-Code eingeben.'});
      return;
    }

    const customTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const customArtist = typeof req.body?.artist === 'string' ? req.body.artist.trim() : '';
    const defaultLayout = req.body?.defaultLayout === 'horizontal' ? 'horizontal' : 'page';
    const showFretboard = Boolean(req.body?.showFretboard);
    const requestedSlug =
      typeof req.body?.customId === 'string' ? sanitizeSlug(req.body.customId) : '';

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
    let id = requestedSlug && !existingIds.has(requestedSlug) ? requestedSlug : '';
    while (!id || existingIds.has(id)) {
      id = generateShortId(6);
    }

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
  });

  // Update metadata for an uploaded slice
  app.patch('/api/slices/:id', express.json(), (req: Request, res: Response) => {
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
      title: typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : current.title,
      artist: typeof req.body?.artist === 'string' ? req.body.artist.trim() : current.artist,
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
  });

  // Delete an uploaded slice
  app.delete('/api/slices/:id', (req: Request, res: Response) => {
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

  // --- Frontend Serving (Vite Dev Middleware or Production Static Dist) ---
  if (!IS_PROD) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TabSlice server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start TabSlice server:', err);
  process.exit(1);
});
