import {Check, Code2, Copy, Link2, X} from 'lucide-react';
import React, {useEffect, useMemo, useState} from 'react';
import {
  SliceRecord,
  buildSliceEmbedUrl,
  buildSliceIframeCode,
  buildSliceShareUrl,
} from '../types/slice';

interface EmbedModalProps {
  isOpen: boolean;
  onClose: () => void;
  slices: SliceRecord[];
  activeSlice: SliceRecord | null;
}

export const EmbedModal: React.FC<EmbedModalProps> = ({
  isOpen,
  onClose,
  slices,
  activeSlice,
}) => {
  const [selectedSliceId, setSelectedSliceId] = useState<string>(
    activeSlice?.id || slices[0]?.id || '',
  );
  const [activeTab, setActiveTab] = useState<'iframe' | 'bbcode' | 'link' | 'external'>('iframe');
  const [externalUrl, setExternalUrl] = useState('https://example.com/tabs/mein-song.gp');
  const [width, setWidth] = useState('100%');
  const [height, setHeight] = useState('500');
  const [layout, setLayout] = useState<'page' | 'horizontal'>(
    activeSlice?.defaultLayout || 'page',
  );
  const [showFretboard, setShowFretboard] = useState<boolean>(
    activeSlice?.showFretboard || false,
  );
  const [soundFont, setSoundFont] = useState<'sonivox' | 'fluidr3' | 'musescore'>('fluidr3');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && activeSlice) {
      setSelectedSliceId(activeSlice.id);
      setLayout(activeSlice.defaultLayout);
      setShowFretboard(activeSlice.showFretboard);
    } else if (isOpen && !selectedSliceId && slices.length > 0) {
      setSelectedSliceId(slices[0].id);
    }
  }, [isOpen, activeSlice, slices, selectedSliceId]);

  const currentSlice = useMemo(
    () => slices.find((s) => s.id === selectedSliceId) || activeSlice || slices[0] || null,
    [slices, selectedSliceId, activeSlice],
  );

  const sliceEmbedUrl = useMemo(() => {
    if (!currentSlice) return '';
    return buildSliceEmbedUrl(currentSlice.id, {layout, fretboard: showFretboard, soundFont});
  }, [currentSlice, layout, showFretboard, soundFont]);

  const sliceShareUrl = useMemo(() => {
    if (!currentSlice) return '';
    return buildSliceShareUrl(currentSlice.id);
  }, [currentSlice]);

  const iframeSnippet = useMemo(() => {
    if (!currentSlice) return '';
    return buildSliceIframeCode(currentSlice.id, {
      width: width || '100%',
      height: height || '500',
      layout,
      fretboard: showFretboard,
      soundFont,
    });
  }, [currentSlice, width, height, layout, showFretboard, soundFont]);

  const bbcodeIframe = useMemo(
    () => `[iframe]${sliceEmbedUrl}[/iframe]`,
    [sliceEmbedUrl],
  );

  const bbcodeLink = useMemo(
    () =>
      `[url=${sliceShareUrl}]${currentSlice?.title || 'Interaktive Tabulatur'} – im Player öffnen[/url]`,
    [sliceShareUrl, currentSlice],
  );

  const markdownLink = useMemo(
    () => `[${currentSlice?.title || 'Interaktive Tabulatur'} (TabSlice)](${sliceShareUrl})`,
    [sliceShareUrl, currentSlice],
  );

  const externalIframeSnippet = useMemo(() => {
    const params = new URLSearchParams({embed: '1', file: externalUrl.trim()});
    if (layout === 'horizontal') params.set('layout', 'horizontal');
    if (showFretboard) params.set('fretboard', '1');
    if (soundFont !== 'sonivox') params.set('sf', soundFont);
    const url = `${window.location.origin}/?${params.toString()}`;
    return `<iframe src="${url}" width="${width || '100%'}" height="${height || '500'}" frameborder="0" allowfullscreen=""></iframe>`;
  }, [externalUrl, width, height, layout, showFretboard, soundFont]);

  if (!isOpen) return null;

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="embed-modal-title"
    >
      <div
        className="w-full max-w-2xl bg-white rounded-xl border border-zinc-200 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <div>
            <h2 id="embed-modal-title" className="text-base font-semibold text-zinc-900">
              Im Forum einbetten &amp; teilen
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Soundslice-kompatible Embed-Links unter <code className="font-mono">/slices/&lt;id&gt;/embed/</code>.
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

        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Slice Selector */}
          {slices.length > 0 && activeTab !== 'external' && (
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                Gespeicherter Slice auf dem Webserver
              </label>
              <select
                value={selectedSliceId}
                onChange={(e) => setSelectedSliceId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-blue-600"
              >
                {slices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                    {s.artist ? ` – ${s.artist}` : ''} (/slices/{s.id}/embed/)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Format Tabs */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 rounded-lg w-fit">
            {(
              [
                ['iframe', 'HTML Iframe'],
                ['bbcode', 'Forum BBCode'],
                ['link', 'Direktlink & Markdown'],
                ['external', 'Externe Datei-URL'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === key
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Display & Audio Options */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Breite</label>
              <input
                type="text"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono tabular-nums bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Höhe (px)</label>
              <input
                type="text"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono tabular-nums bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">Layout</label>
              <select
                value={layout}
                onChange={(e) => setLayout(e.target.value as 'page' | 'horizontal')}
                className="w-full px-2.5 py-2 text-xs bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-blue-600"
              >
                <option value="page">Seite</option>
                <option value="horizontal">Horizontal</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">SoundFont</label>
              <select
                value={soundFont}
                onChange={(e) =>
                  setSoundFont(e.target.value as 'sonivox' | 'fluidr3' | 'musescore')
                }
                className="w-full px-2.5 py-2 text-xs bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-blue-600"
              >
                <option value="fluidr3">FluidR3 Studio</option>
                <option value="sonivox">Sonivox Schnell</option>
                <option value="musescore">MuseScore HD</option>
              </select>
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 px-2.5 py-2 text-xs text-zinc-800 bg-zinc-50 border border-zinc-200 rounded-lg cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={showFretboard}
                  onChange={(e) => setShowFretboard(e.target.checked)}
                  className="accent-blue-600"
                />
                Griffbrett
              </label>
            </div>
          </div>

          {activeTab === 'iframe' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700">
                  <Code2 className="w-3.5 h-3.5 text-zinc-500" />
                  HTML Iframe-Code (wie Soundslice)
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy('iframe', iframeSnippet)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
                >
                  {copiedKey === 'iframe' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'iframe' ? 'Kopiert' : 'Code kopieren'}
                </button>
              </div>
              <pre className="p-4 bg-[#14161A] text-zinc-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
                {iframeSnippet}
              </pre>
            </div>
          )}

          {activeTab === 'bbcode' && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-700">
                    BBCode Embed (Foren mit [iframe]-Tag)
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('bb-iframe', bbcodeIframe)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors whitespace-nowrap"
                  >
                    {copiedKey === 'bb-iframe' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'bb-iframe' ? 'Kopiert' : 'Kopieren'}
                  </button>
                </div>
                <pre className="p-3.5 bg-[#14161A] text-zinc-100 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                  {bbcodeIframe}
                </pre>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-700">
                    BBCode Textlink (funktioniert in jedem Forum)
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('bb-link', bbcodeLink)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-md transition-colors whitespace-nowrap"
                  >
                    {copiedKey === 'bb-link' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'bb-link' ? 'Kopiert' : 'Kopieren'}
                  </button>
                </div>
                <pre className="p-3 bg-zinc-50 border border-zinc-200 text-zinc-800 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                  {bbcodeLink}
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'link' && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700">
                    <Link2 className="w-3.5 h-3.5 text-zinc-500" />
                    Embed-URL (nur Player)
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy('embed-url', sliceEmbedUrl)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors whitespace-nowrap"
                  >
                    {copiedKey === 'embed-url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'embed-url' ? 'Kopiert' : 'Kopieren'}
                  </button>
                </div>
                <div className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-xs font-mono text-zinc-800 break-all">
                  {sliceEmbedUrl}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-700">Direktlink (Vollansicht)</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('share-url', sliceShareUrl)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-md transition-colors whitespace-nowrap"
                  >
                    {copiedKey === 'share-url' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'share-url' ? 'Kopiert' : 'Kopieren'}
                  </button>
                </div>
                <div className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-xs font-mono text-zinc-800 break-all">
                  {sliceShareUrl}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-700">Markdown (Discourse / Reddit / Discord)</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('md', markdownLink)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-md transition-colors whitespace-nowrap"
                  >
                    {copiedKey === 'md' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey === 'md' ? 'Kopiert' : 'Kopieren'}
                  </button>
                </div>
                <div className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-xs font-mono text-zinc-800 break-all">
                  {markdownLink}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'external' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Externe Guitar-Pro-Datei-URL (mit CORS)
                </label>
                <input
                  type="url"
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-blue-600"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-700">HTML Iframe-Code</span>
                <button
                  type="button"
                  onClick={() => handleCopy('ext', externalIframeSnippet)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
                >
                  {copiedKey === 'ext' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey === 'ext' ? 'Kopiert' : 'Code kopieren'}
                </button>
              </div>
              <pre className="p-4 bg-[#14161A] text-zinc-100 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {externalIframeSnippet}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
