import {Code2, Plus} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {CreateSliceModal} from './components/CreateSliceModal';
import {EmbedModal} from './components/EmbedModal';
import {SliceLibrary} from './components/SliceLibrary';
import {TabSlicePlayer} from './components/TabSlicePlayer';
import {DEMO_SCORES} from './data/demoScores';
import {SliceRecord, fetchSliceById, fetchSlices} from './types/slice';

interface RouteConfig {
  embed: boolean;
  routeSliceId: string | null;
  fileUrl: string | null;
  demo: string;
  layout: 'page' | 'horizontal';
  fretboard: boolean;
  speed: number;
}

function parseRouteConfig(): RouteConfig {
  const pathname = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  // Match Soundslice-style routes: /slices/:id/embed/ or /slices/:id
  const embedMatch = pathname.match(/^\/slices\/([^/]+)\/embed\/?$/);
  const sliceMatch = pathname.match(/^\/slices\/([^/]+)\/?$/);

  const routeSliceId = embedMatch
    ? decodeURIComponent(embedMatch[1])
    : sliceMatch
      ? decodeURIComponent(sliceMatch[1])
      : null;

  const embed = Boolean(embedMatch) || params.get('embed') === '1' || params.get('embed') === 'true';
  const fileUrl = params.get('file');
  const demoParam = params.get('demo');
  const demo = DEMO_SCORES.some((d) => d.id === demoParam) ? demoParam! : 'ensemble';
  const layout = params.get('layout') === 'horizontal' ? 'horizontal' : 'page';
  const fretboard = params.get('fretboard') === '1' || params.get('fretboard') === 'true';
  const speedParam = Number(params.get('speed'));
  const speed =
    Number.isFinite(speedParam) && speedParam >= 25 && speedParam <= 200 ? speedParam / 100 : 1;

  return {embed, routeSliceId, fileUrl, demo, layout, fretboard, speed};
}

export default function App() {
  const routeConfig = useMemo(() => parseRouteConfig(), []);

  const [slices, setSlices] = useState<SliceRecord[]>([]);
  const [isLoadingSlices, setIsLoadingSlices] = useState<boolean>(true);
  const [activeSlice, setActiveSlice] = useState<SliceRecord | null>(null);
  const [sliceNotFound, setSliceNotFound] = useState<boolean>(false);

  const [activeView, setActiveView] = useState<'player' | 'library'>('player');
  const [embedPreviewMode, setEmbedPreviewMode] = useState<boolean>(false);
  const [embedModalOpen, setEmbedModalOpen] = useState<boolean>(false);
  const [embedTargetSlice, setEmbedTargetSlice] = useState<SliceRecord | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [pendingPublishFile, setPendingPublishFile] = useState<File | null>(null);
  const [texDrawerOpen, setTexDrawerOpen] = useState<boolean>(false);
  const [openFileTrigger] = useState<number>(0);

  // Load slices from webserver (both uploads & scores/ drop folder)
  const refreshSlices = useCallback(async () => {
    setIsLoadingSlices(true);
    try {
      const list = await fetchSlices();
      setSlices(list);
      return list;
    } catch {
      return [];
    } finally {
      setIsLoadingSlices(false);
    }
  }, []);

  // Initial load: resolve /slices/:id(/embed/) or load default server slice
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (routeConfig.embed && routeConfig.routeSliceId) {
        try {
          const found = await fetchSliceById(routeConfig.routeSliceId);
          if (!cancelled) {
            if (found) {
              setActiveSlice(found);
              setSliceNotFound(false);
            } else {
              setSliceNotFound(true);
            }
          }
        } catch {
          if (!cancelled) setSliceNotFound(true);
        } finally {
          if (!cancelled) setIsLoadingSlices(false);
        }
        return;
      }

      const list = await refreshSlices();
      if (cancelled) return;

      if (routeConfig.routeSliceId) {
        const match = list.find((s) => s.id === routeConfig.routeSliceId);
        if (match) {
          setActiveSlice(match);
        } else {
          setSliceNotFound(true);
        }
      } else if (!routeConfig.fileUrl && list.length > 0) {
        setActiveSlice(list[0]);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [routeConfig, refreshSlices]);

  const handleSelectSlice = useCallback((slice: SliceRecord) => {
    setActiveSlice(slice);
    setSliceNotFound(false);
    setActiveView('player');
    if (window.location.pathname !== `/slices/${slice.id}`) {
      window.history.replaceState(null, '', `/slices/${slice.id}`);
    }
  }, []);

  const handleSliceCreated = useCallback((slice: SliceRecord) => {
    setSlices((prev) => [slice, ...prev.filter((s) => s.id !== slice.id)]);
  }, []);

  const handleSliceDeleted = useCallback(
    (deletedId: string) => {
      setSlices((prev) => {
        const next = prev.filter((s) => s.id !== deletedId);
        if (activeSlice?.id === deletedId) {
          setActiveSlice(next[0] ?? null);
          window.history.replaceState(null, '', '/');
        }
        return next;
      });
    },
    [activeSlice],
  );

  // Pure frameless iframe embed mode (/slices/:id/embed/ or ?embed=1)
  if (routeConfig.embed) {
    if (routeConfig.routeSliceId && isLoadingSlices && !activeSlice) {
      return (
        <main className="w-screen h-screen flex items-center justify-center bg-white text-zinc-600 text-xs">
          <div className="flex flex-col items-center gap-2.5">
            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span>Slice wird geladen…</span>
          </div>
        </main>
      );
    }

    if (sliceNotFound) {
      return (
        <main className="w-screen h-screen flex items-center justify-center bg-white text-zinc-700 p-6 text-center">
          <div className="space-y-1.5 max-w-md">
            <p className="text-sm font-semibold text-zinc-900">Slice nicht gefunden</p>
            <p className="text-xs text-zinc-500">
              Der angeforderte Slice <code className="font-mono">/slices/{routeConfig.routeSliceId}</code> existiert auf diesem Server nicht.
            </p>
          </div>
        </main>
      );
    }

    const embedLayout =
      new URLSearchParams(window.location.search).has('layout')
        ? routeConfig.layout
        : activeSlice?.defaultLayout || routeConfig.layout;

    const embedFretboard =
      new URLSearchParams(window.location.search).has('fretboard')
        ? routeConfig.fretboard
        : activeSlice?.showFretboard || routeConfig.fretboard;

    return (
      <main className="w-screen h-screen overflow-hidden bg-white">
        <TabSlicePlayer
          isEmbedMode
          activeSlice={activeSlice}
          initialFileUrl={routeConfig.fileUrl}
          demoId={routeConfig.demo}
          openFileTrigger={openFileTrigger}
          texDrawerOpen={false}
          onTexDrawerOpenChange={() => {}}
          initialLayout={embedLayout}
          initialFretboard={embedFretboard}
          initialSpeed={routeConfig.speed}
        />
      </main>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#F4F5F7] text-zinc-900 overflow-hidden">
      {/* Strict 3-Zone Top Bar: [Brand wordmark] — [4 concise nav links] — [1 Primary CTA] */}
      <header className="h-14 px-6 bg-white border-b border-zinc-200 flex items-center justify-between gap-8 shrink-0">
        {/* Zone 1: Single-element Brand Wordmark */}
        <a
          href="/"
          className="text-base font-bold tracking-tight text-zinc-950 whitespace-nowrap shrink-0"
        >
          TabSlice
        </a>

        {/* Zone 2: Concise single-line navigation links */}
        <nav className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm font-medium text-zinc-600">
          <button
            type="button"
            onClick={() => setActiveView('player')}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 border-b-2 ${
              activeView === 'player' && !embedPreviewMode
                ? 'text-zinc-950 border-blue-600'
                : 'border-transparent hover:text-zinc-950'
            }`}
          >
            Player
          </button>

          <button
            type="button"
            onClick={() => setActiveView('library')}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 border-b-2 ${
              activeView === 'library'
                ? 'text-zinc-950 border-blue-600'
                : 'border-transparent hover:text-zinc-950'
            }`}
          >
            Bibliothek ({slices.length})
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveView('player');
              setEmbedPreviewMode((prev) => !prev);
            }}
            className={`hidden lg:inline-block transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 border-b-2 ${
              activeView === 'player' && embedPreviewMode
                ? 'text-blue-700 border-blue-600'
                : 'border-transparent hover:text-zinc-950'
            }`}
          >
            500px Vorschau
          </button>

          <button
            type="button"
            onClick={() => {
              setEmbedTargetSlice(activeSlice);
              setEmbedModalOpen(true);
            }}
            className="hidden sm:inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 border-b-2 border-transparent hover:text-zinc-950"
          >
            <Code2 className="w-3.5 h-3.5" />
            Forum-Code
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              setPendingPublishFile(null);
              setCreateModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Slice erstellen
          </button>
        </div>
      </header>

      {/* Main Content Stage */}
      {activeView === 'library' ? (
        <SliceLibrary
          slices={slices}
          activeSliceId={activeSlice?.id ?? null}
          isLoading={isLoadingSlices}
          onRefresh={refreshSlices}
          onSelectSlice={handleSelectSlice}
          onEmbedSlice={(slice) => {
            setEmbedTargetSlice(slice);
            setEmbedModalOpen(true);
          }}
          onOpenCreateModal={() => {
            setPendingPublishFile(null);
            setCreateModalOpen(true);
          }}
          onSliceUploaded={handleSliceCreated}
          onSliceDeleted={handleSliceDeleted}
        />
      ) : (
        <main
          className={`flex-1 min-h-0 flex flex-col ${
            embedPreviewMode ? 'items-center justify-start overflow-y-auto p-6 sm:p-10' : ''
          }`}
        >
          {embedPreviewMode && (
            <div className="w-full max-w-[1100px] mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-zinc-600 flex flex-wrap items-center gap-2">
                <span className="font-semibold text-zinc-900">Forum-Iframe-Vorschau</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {activeSlice ? `/slices/${activeSlice.id}/embed/` : '/?embed=1'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">width=&quot;100%&quot; height=&quot;500&quot;</span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setEmbedTargetSlice(activeSlice);
                    setEmbedModalOpen(true);
                  }}
                  className="font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
                >
                  Forum-Code kopieren
                </button>
                <button
                  type="button"
                  onClick={() => setEmbedPreviewMode(false)}
                  className="font-medium text-zinc-600 hover:text-zinc-900 whitespace-nowrap"
                >
                  Vollansicht
                </button>
              </div>
            </div>
          )}

          <div
            className={
              embedPreviewMode
                ? 'w-full max-w-[1100px] h-[500px] shrink-0 rounded-xl border border-zinc-200 shadow-sm overflow-hidden bg-white'
                : 'flex-1 min-h-0 w-full'
            }
          >
            <TabSlicePlayer
              isEmbedMode={false}
              activeSlice={activeSlice}
              initialFileUrl={routeConfig.fileUrl}
              demoId={routeConfig.demo}
              openFileTrigger={openFileTrigger}
              texDrawerOpen={texDrawerOpen}
              onTexDrawerOpenChange={setTexDrawerOpen}
              onPublishLocalFile={(file) => {
                setPendingPublishFile(file);
                setCreateModalOpen(true);
              }}
              initialLayout={routeConfig.layout}
              initialFretboard={routeConfig.fretboard}
              initialSpeed={routeConfig.speed}
            />
          </div>
        </main>
      )}

      {/* Create / Upload Slice Modal */}
      <CreateSliceModal
        isOpen={createModalOpen}
        onClose={() => {
          setCreateModalOpen(false);
          setPendingPublishFile(null);
        }}
        initialFile={pendingPublishFile}
        onSliceCreated={handleSliceCreated}
        onOpenSliceInPlayer={handleSelectSlice}
      />

      {/* Forum Embed Modal */}
      <EmbedModal
        isOpen={embedModalOpen}
        onClose={() => setEmbedModalOpen(false)}
        slices={slices}
        activeSlice={embedTargetSlice || activeSlice}
      />
    </div>
  );
}
