import {
  Check,
  Code2,
  Copy,
  FileAudio2,
  Link2,
  Play,
  Upload,
  X,
} from 'lucide-react';
import React, {useRef, useState} from 'react';
import {
  SliceRecord,
  buildSliceEmbedUrl,
  buildSliceIframeCode,
  buildSliceShareUrl,
  createTexSlice,
  formatBytes,
  uploadSliceFile,
} from '../types/slice';

interface CreateSliceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSliceCreated: (slice: SliceRecord) => void;
  onOpenSliceInPlayer: (slice: SliceRecord) => void;
  /** Optional pre-selected local file (e.g. when user dropped a file on the player and wants to publish it) */
  initialFile?: File | null;
}

const ACCEPTED_EXTENSIONS = '.gp,.gp3,.gp4,.gp5,.gpx,.gp7,.gp8,.xml,.musicxml,.mxl,.cap,.tex';

const STARTER_TEX = `\\title "Neues Riff"
\\artist "Dein Name"
\\tempo 110

\\track ("Gitarre" "Gtr")
  \\staff {score tabs}
  \\instrument 29
  \\tuning (E4 B3 G3 D3 A2 E2)
  \\ts (4 4)
  :8 0.6 3.6 5.6 0.6 3.6 6.6 5.6 r |
  :8 0.6 3.6 5.6 3.6 :2 0.6{v}
`;

export const CreateSliceModal: React.FC<CreateSliceModalProps> = ({
  isOpen,
  onClose,
  onSliceCreated,
  onOpenSliceInPlayer,
  initialFile = null,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<'file' | 'tex'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile);
  const [texContent, setTexContent] = useState<string>(STARTER_TEX);
  const [title, setTitle] = useState<string>('');
  const [artist, setArtist] = useState<string>('');
  const [customSlug, setCustomSlug] = useState<string>('');
  const [defaultLayout, setDefaultLayout] = useState<'page' | 'horizontal'>('page');
  const [showFretboard, setShowFretboard] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [createdSlice, setCreatedSlice] = useState<SliceRecord | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setSelectedFile(initialFile);
      setCreatedSlice(null);
      setError(null);
      setTitle('');
      setArtist('');
      setCustomSlug('');
      setMode('file');
    }
  }, [isOpen, initialFile]);

  if (!isOpen) return null;

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      let slice: SliceRecord;
      if (mode === 'file') {
        if (!selectedFile) {
          throw new Error('Bitte wähle eine Guitar-Pro-, MusicXML- oder alphaTex-Datei aus.');
        }
        slice = await uploadSliceFile({
          file: selectedFile,
          title,
          artist,
          defaultLayout,
          showFretboard,
          customId: customSlug,
        });
      } else {
        slice = await createTexSlice({
          tex: texContent,
          title,
          artist,
          defaultLayout,
          showFretboard,
          customId: customSlug,
        });
      }

      setCreatedSlice(slice);
      onSliceCreated(slice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
      setMode('file');
      setError(null);
    }
  };

  const iframeCode = createdSlice
    ? buildSliceIframeCode(createdSlice.id, {
        layout: createdSlice.defaultLayout,
        fretboard: createdSlice.showFretboard,
      })
    : '';
  const embedUrl = createdSlice
    ? buildSliceEmbedUrl(createdSlice.id, {
        layout: createdSlice.defaultLayout,
        fretboard: createdSlice.showFretboard,
      })
    : '';
  const shareUrl = createdSlice ? buildSliceShareUrl(createdSlice.id) : '';
  const bbcodeIframe = createdSlice ? `[iframe]${embedUrl}[/iframe]` : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-slice-title"
    >
      <div
        className="w-full max-w-2xl bg-white rounded-xl border border-zinc-200 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <h2 id="create-slice-title" className="text-base font-semibold text-zinc-900">
              {createdSlice ? 'Slice erstellt — bereit fürs Forum' : 'Neuen Slice auf dem Server anlegen'}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {createdSlice
                ? 'Deine Datei ist sofort unter einem kurzen Embed-Link erreichbar.'
                : 'Guitar-Pro-Datei ablegen oder alphaTex schreiben — du erhältst direkt deinen Forum-Embed-Link.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
            aria-label="Schließen"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Success View: Ready-to-paste Forum Links */}
        {createdSlice ? (
          <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-200">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">{createdSlice.title}</h3>
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 mt-0.5 font-mono tabular-nums">
                  {createdSlice.artist && (
                    <>
                      <span className="font-sans">{createdSlice.artist}</span>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  <span>/slices/{createdSlice.id}/embed/</span>
                  <span aria-hidden="true">·</span>
                  <span>{createdSlice.trackCount} Spuren</span>
                  <span aria-hidden="true">·</span>
                  <span>{createdSlice.tempo} BPM</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onOpenSliceInPlayer(createdSlice);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Im Player öffnen
              </button>
            </div>

            {/* 1. HTML Iframe (like Soundslice) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700">
                  <Code2 className="w-3.5 h-3.5 text-zinc-500" />
                  HTML Iframe (wie Soundslice)
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy('iframe', iframeCode)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors whitespace-nowrap"
                >
                  {copiedKey === 'iframe' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'iframe' ? 'Kopiert' : 'Kopieren'}
                </button>
              </div>
              <pre className="p-3.5 bg-[#14161A] text-zinc-100 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {iframeCode}
              </pre>
            </div>

            {/* 2. Forum BBCode */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-700">Forum BBCode</span>
                <button
                  type="button"
                  onClick={() => handleCopy('bbcode', bbcodeIframe)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-md transition-colors whitespace-nowrap"
                >
                  {copiedKey === 'bbcode' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'bbcode' ? 'Kopiert' : 'BBCode kopieren'}
                </button>
              </div>
              <pre className="p-3 bg-zinc-50 border border-zinc-200 text-zinc-800 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {bbcodeIframe}
              </pre>
            </div>

            {/* 3. Direct Link */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700">
                  <Link2 className="w-3.5 h-3.5 text-zinc-500" />
                  Direktlink zum Teilen
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy('link', shareUrl)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-md transition-colors whitespace-nowrap"
                >
                  {copiedKey === 'link' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'link' ? 'Kopiert' : 'Link kopieren'}
                </button>
              </div>
              <div className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-xs font-mono text-zinc-700 break-all">
                {shareUrl}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setCreatedSlice(null);
                  setSelectedFile(null);
                  setTitle('');
                  setArtist('');
                  setCustomSlug('');
                }}
                className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
              >
                Weitere Datei hochladen
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"
              >
                Fertig
              </button>
            </div>
          </div>
        ) : (
          /* Creation Form */
          <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
            {/* Mode Switch */}
            <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg w-fit">
              <button
                type="button"
                onClick={() => setMode('file')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'file'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Guitar-Pro-Datei hochladen
              </button>
              <button
                type="button"
                onClick={() => setMode('tex')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'tex'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Neues alphaTex schreiben
              </button>
            </div>

            {error && (
              <div className="px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                {error}
              </div>
            )}

            {mode === 'file' ? (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_EXTENSIONS}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setSelectedFile(f);
                      setError(null);
                    }
                    e.target.value = '';
                  }}
                />
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-blue-600 bg-blue-50/70'
                      : selectedFile
                        ? 'border-blue-300 bg-blue-50/30'
                        : 'border-zinc-200 hover:border-zinc-300 bg-zinc-50/70'
                  }`}
                >
                  {selectedFile ? (
                    <div className="flex flex-col items-center gap-1.5">
                      <FileAudio2 className="w-7 h-7 text-blue-600" />
                      <p className="text-sm font-semibold text-zinc-900">{selectedFile.name}</p>
                      <p className="text-xs text-zinc-500 font-mono tabular-nums">
                        {formatBytes(selectedFile.size)} · Klicke zum Ändern
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5">
                      <Upload className="w-7 h-7 text-zinc-400" />
                      <p className="text-sm font-medium text-zinc-800">
                        Guitar-Pro-Datei hier ablegen oder auswählen
                      </p>
                      <p className="text-xs text-zinc-500">
                        Unterstützt .gp, .gp3, .gp4, .gp5, .gpx, .gp7, .gp8, MusicXML &amp; alphaTex
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  alphaTex Notation
                </label>
                <textarea
                  value={texContent}
                  onChange={(e) => setTexContent(e.target.value)}
                  rows={8}
                  spellCheck={false}
                  className="w-full p-3 bg-[#14161A] text-zinc-100 rounded-lg font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                />
              </div>
            )}

            {/* Optional Metadata Overrides */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Titel <span className="text-zinc-400 font-normal">(optional – sonst aus Datei)</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Wird automatisch aus der Datei gelesen"
                  className="w-full px-3 py-2 text-xs bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Interpret <span className="text-zinc-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="z. B. Bandname oder Übung"
                  className="w-full px-3 py-2 text-xs bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Wunsch-Kurzlink <span className="text-zinc-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value)}
                  placeholder="z. B. blues-lick-1"
                  className="w-full px-3 py-2 text-xs font-mono bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Standard-Layout
                </label>
                <select
                  value={defaultLayout}
                  onChange={(e) => setDefaultLayout(e.target.value as 'page' | 'horizontal')}
                  className="w-full px-3 py-2 text-xs bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-blue-600"
                >
                  <option value="page">Seitenansicht</option>
                  <option value="horizontal">Horizontal (Streifen)</option>
                </select>
              </div>
              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-800 bg-zinc-50 border border-zinc-200 rounded-lg cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showFretboard}
                    onChange={(e) => setShowFretboard(e.target.checked)}
                    className="accent-blue-600"
                  />
                  Griffbrett standardmäßig an
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-zinc-600 hover:text-zinc-900 rounded-lg"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={isSubmitting || (mode === 'file' && !selectedFile)}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap"
              >
                {isSubmitting ? 'Wird gespeichert…' : 'Speichern & Forum-Link erzeugen'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
