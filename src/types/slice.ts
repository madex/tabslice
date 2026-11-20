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

const ADMIN_MUTATION_HEADERS: Record<string, string> = {
  'X-TabSlice-Admin': '1',
};

export async function fetchAdminSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/session', {credentials: 'same-origin'});
    if (!res.ok) return false;
    const data = (await res.json()) as {authenticated?: boolean};
    return Boolean(data.authenticated);
  } catch {
    return false;
  }
}

export async function loginAdmin(password: string): Promise<void> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', ...ADMIN_MUTATION_HEADERS},
    body: JSON.stringify({password}),
  });
  const payload = (await res.json().catch(() => ({}))) as {error?: string};
  if (!res.ok) {
    throw new Error(payload.error || 'Anmeldung fehlgeschlagen.');
  }
}

export async function logoutAdmin(): Promise<void> {
  await fetch('/api/admin/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: ADMIN_MUTATION_HEADERS,
  });
}

export async function fetchSlices(): Promise<SliceRecord[]> {
  const res = await fetch('/api/slices', {credentials: 'same-origin'});
  if (res.status === 401) return [];
  if (!res.ok) throw new Error('Slices konnten nicht geladen werden.');
  const data = (await res.json()) as {slices: SliceRecord[]};
  return data.slices || [];
}

export async function fetchSliceById(id: string): Promise<SliceRecord | null> {
  const res = await fetch(`/api/slices/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Slice konnte nicht geladen werden.');
  const data = (await res.json()) as {slice: SliceRecord};
  return data.slice;
}

export async function uploadSliceFile(params: {
  file: File;
  title?: string;
  artist?: string;
  defaultLayout?: 'page' | 'horizontal';
  showFretboard?: boolean;
}): Promise<SliceRecord> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'X-File-Name': encodeURIComponent(params.file.name),
    'X-Layout': params.defaultLayout || 'page',
    'X-Fretboard': params.showFretboard ? '1' : '0',
    ...ADMIN_MUTATION_HEADERS,
  };
  if (params.title?.trim()) {
    headers['X-Title'] = encodeURIComponent(params.title.trim());
  }
  if (params.artist?.trim()) {
    headers['X-Artist'] = encodeURIComponent(params.artist.trim());
  }

  const res = await fetch('/api/slices/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: params.file,
  });

  const payload = (await res.json()) as {slice?: SliceRecord; error?: string};
  if (!res.ok || !payload.slice) {
    throw new Error(payload.error || 'Upload fehlgeschlagen.');
  }
  return payload.slice;
}

export async function createTexSlice(params: {
  tex: string;
  title?: string;
  artist?: string;
  defaultLayout?: 'page' | 'horizontal';
  showFretboard?: boolean;
}): Promise<SliceRecord> {
  const res = await fetch('/api/slices/tex', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', ...ADMIN_MUTATION_HEADERS},
    body: JSON.stringify(params),
  });
  const payload = (await res.json()) as {slice?: SliceRecord; error?: string};
  if (!res.ok || !payload.slice) {
    throw new Error(payload.error || 'alphaTex-Slice konnte nicht erstellt werden.');
  }
  return payload.slice;
}

export async function deleteSliceById(id: string): Promise<void> {
  const res = await fetch(`/api/slices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: ADMIN_MUTATION_HEADERS,
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {error?: string};
    throw new Error(payload.error || 'Löschen fehlgeschlagen.');
  }
}

export type SoundFontPresetId = 'generaluser' | 'fluidr3' | 'musescore' | 'sonivox';
export type CountInModeParam = 'off' | 'first' | 'always';
export type StaveModeParam = 'default' | 'scoretab' | 'tab' | 'score';

export interface EmbedUrlOptions {
  width?: string;
  height?: string;
  layout?: 'page' | 'horizontal';
  stave?: StaveModeParam;
  showHeader?: boolean;
  metronome?: boolean;
  countIn?: CountInModeParam;
  loop?: boolean;
  fretboard?: boolean;
  speed?: number;
  soundFont?: SoundFontPresetId;
  dark?: boolean;
}

export function buildSliceEmbedUrl(sliceId: string, options?: EmbedUrlOptions): string {
  const base = `${window.location.origin}/slices/${encodeURIComponent(sliceId)}/embed/`;
  const params = new URLSearchParams();
  if (options?.showHeader === false) params.set('header', '0');
  if (options?.layout === 'horizontal') params.set('layout', 'horizontal');
  if (options?.stave && options.stave !== 'default') params.set('stave', options.stave);
  if (options?.metronome) params.set('metronome', '1');
  if (options?.countIn && options.countIn !== 'first') params.set('countin', options.countIn);
  if (options?.loop) params.set('loop', '1');
  if (options?.fretboard) params.set('fretboard', '1');
  if (options?.speed && options.speed !== 100) params.set('speed', String(options.speed));
  if (options?.soundFont && options.soundFont !== 'generaluser') {
    params.set('sf', options.soundFont);
  }
  if (options?.dark) params.set('dark', '1');
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function buildSliceShareUrl(sliceId: string): string {
  return `${window.location.origin}/slices/${encodeURIComponent(sliceId)}`;
}

export function buildSliceIframeCode(sliceId: string, options?: EmbedUrlOptions): string {
  const url = buildSliceEmbedUrl(sliceId, options);
  const w = options?.width || '100%';
  const h = options?.height || '500';
  return `<iframe src="${url}" width="${w}" height="${h}" frameborder="0" allowfullscreen=""></iframe>`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
