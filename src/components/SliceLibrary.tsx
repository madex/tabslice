import {
  Check,
  Code2,
  Copy,
  FolderUp,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import React, {useMemo, useRef, useState} from 'react';
import {
  SliceRecord,
  buildSliceIframeCode,
  deleteSliceById,
  formatBytes,
  uploadSliceFile,
} from '../types/slice';

interface SliceLibraryProps {
  slices: SliceRecord[];
  activeSliceId: string | null;
  isLoading: boolean;
  onRefresh: () => void;
  onSelectSlice: (slice: SliceRecord) => void;
  onEmbedSlice: (slice: SliceRecord) => void;
  onOpenCreateModal: () => void;
  onSliceUploaded: (slice: SliceRecord) => void;
  onSliceDeleted: (id: string) => void;
}

const ACCEPTED_EXTENSIONS = '.gp,.gp3,.gp4,.gp5,.gpx,.gp7,.gp8,.xml,.musicxml,.mxl,.cap,.tex';

export const SliceLibrary: React.FC<SliceLibraryProps> = ({
  slices,
  activeSliceId,
  isLoading,
  onRefresh,
  onSelectSlice,
  onEmbedSlice,
  onOpenCreateModal,
  onSliceUploaded,
  onSliceDeleted,
}) => {
  const quickInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [quickUploading, setQuickUploading] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredSlices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return slices;
    return slices.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        s.fileName.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q),
    );
  }, [slices, search]);

  const handleQuickUpload = async (file: File) => {
    setQuickError(null);
    setQuickUploading(true);
    try {
      const created = await uploadSliceFile({file});
      onSliceUploaded(created);
      onEmbedSlice(created);
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : 'Upload fehlgeschlagen.');
    } finally {
      setQuickUploading(false);
    }
  };

  const handleCopyIframe = async (slice: SliceRecord) => {
    const code = buildSliceIframeCode(slice.id, {
      layout: slice.defaultLayout,
      fretboard: slice.showFretboard,
    });
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(slice.id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore
    }
  };

  const handleDelete = async (slice: SliceRecord) => {
    setDeletingId(slice.id);
    setQuickError(null);
    try {
      await deleteSliceById(slice.id);
      onSliceDeleted(slice.id);
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#F4F5F7] score-scroll">
      <div className="max-w-[1180px] mx-auto px-6 py-8 space-y-6">
        {/* Page Heading & Quick Actions */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-950">
              Webserver-Bibliothek
            </h1>
            <p className="text-sm text-zinc-600 mt-1">
              Lade Guitar-Pro-Dateien direkt hier hoch oder lege sie in den Server-Ordner{' '}
              <code className="font-mono text-xs text-zinc-800">scores/</code> – jede Datei erhält
              automatisch einen nicht erratbaren UUID-Link. Die Bibliothek ist nur für
              Administratoren sichtbar.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-lg transition-colors whitespace-nowrap"
              title="Server-Ordner scores/ neu einlesen"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Ordner aktualisieren
            </button>
            <button
              type="button"
              onClick={onOpenCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Slice erstellen
            </button>
          </div>
        </div>

        {/* Instant 1-Drop Publish Strip */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleQuickUpload(file);
          }}
          onClick={() => quickInputRef.current?.click()}
          className={`flex flex-col sm:flex-row items-center justify-between gap-4 px-5 py-4 rounded-xl border border-dashed cursor-pointer transition-colors ${
            isDragging
              ? 'bg-blue-50 border-blue-600'
              : 'bg-white border-zinc-300 hover:border-blue-400'
          }`}
        >
          <input
            ref={quickInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleQuickUpload(f);
              e.target.value = '';
            }}
          />
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <FolderUp className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900">
                {quickUploading
                  ? 'Datei wird gespeichert & analysiert…'
                  : 'Schnell-Upload: Guitar-Pro-Datei hier ablegen'}
              </p>
              <p className="text-xs text-zinc-500">
                Liest Titel, Spuren &amp; Tempo automatisch aus (.gp, .gp3–.gp8, .gpx, MusicXML, .tex) und öffnet direkt den Forum-Embed-Code.
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold text-blue-600 whitespace-nowrap shrink-0">
            Datei auswählen
          </span>
        </div>

        {quickError && (
          <div className="px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {quickError}
          </div>
        )}

        {/* Filter & Table Container */}
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-200">
            <div className="relative w-full sm:w-80">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Suchen nach Titel, Datei oder UUID…"
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="text-xs text-zinc-500 font-mono tabular-nums">
              {filteredSlices.length} {filteredSlices.length === 1 ? 'Slice' : 'Slices'} auf dem Server
            </div>
          </div>

          {filteredSlices.length === 0 ? (
            <div className="px-6 py-12 text-center space-y-2">
              <p className="text-sm font-medium text-zinc-800">
                {search ? 'Keine passenden Slices gefunden.' : 'Noch keine Slices vorhanden.'}
              </p>
              <p className="text-xs text-zinc-500">
                Lade oben eine Guitar-Pro-Datei hoch oder lege sie in den Ordner <code className="font-mono">scores/</code>.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 text-[11px] font-medium text-zinc-500 bg-zinc-50/70">
                    <th className="py-2.5 pl-4 pr-3">Partitur</th>
                    <th className="py-2.5 px-3">Embed-Pfad</th>
                    <th className="py-2.5 px-3 text-right">Details</th>
                    <th className="py-2.5 pl-3 pr-4 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-xs">
                  {filteredSlices.map((slice) => {
                    const isActive = slice.id === activeSliceId;
                    const isCopied = copiedId === slice.id;
                    return (
                      <tr
                        key={slice.id}
                        className={`transition-colors ${
                          isActive ? 'bg-blue-50/45' : 'hover:bg-zinc-50'
                        }`}
                      >
                        <td className="py-3 pl-4 pr-3">
                          <button
                            type="button"
                            onClick={() => onSelectSlice(slice)}
                            className="text-left group block"
                          >
                            <div className="font-semibold text-zinc-900 group-hover:text-blue-600 transition-colors">
                              {slice.title}
                            </div>
                            <div className="text-[11px] text-zinc-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                              {slice.artist && (
                                <>
                                  <span>{slice.artist}</span>
                                  <span aria-hidden="true">·</span>
                                </>
                              )}
                              <span className="font-mono">{slice.fileName}</span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {slice.source === 'folder' ? 'Ordner scores/' : 'Upload'}
                              </span>
                            </div>
                          </button>
                        </td>

                        <td className="py-3 px-3 font-mono text-[11px] text-zinc-600 whitespace-nowrap">
                          <span title={`/slices/${slice.id}/embed/`}>
                            /slices/{slice.id.slice(0, 8)}…/embed/
                          </span>
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums text-[11px] text-zinc-500 whitespace-nowrap">
                          {slice.trackCount} {slice.trackCount === 1 ? 'Spur' : 'Spuren'} · {slice.tempo} BPM · {formatBytes(slice.sizeBytes)}
                        </td>

                        <td className="py-3 pl-3 pr-4">
                          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => onSelectSlice(slice)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 rounded-md transition-colors"
                            >
                              <Play className="w-3 h-3" />
                              Öffnen
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCopyIframe(slice)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                                isCopied
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-blue-600 hover:bg-blue-700 text-white'
                              }`}
                              title="Fertigen HTML-Iframe-Code kopieren"
                            >
                              {isCopied ? (
                                <Check className="w-3 h-3" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              {isCopied ? 'Kopiert' : 'Iframe kopieren'}
                            </button>

                            <button
                              type="button"
                              onClick={() => onEmbedSlice(slice)}
                              className="p-1.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors"
                              title="Alle Forum-Codes (HTML, BBCode, Link)"
                              aria-label="Forum-Codes anzeigen"
                            >
                              <Code2 className="w-3.5 h-3.5" />
                            </button>

                            {slice.source === 'upload' && (
                              <button
                                type="button"
                                disabled={deletingId === slice.id}
                                onClick={() => handleDelete(slice)}
                                className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                                title="Hochgeladenen Slice löschen"
                                aria-label="Slice löschen"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
