import * as alphaTab from '@coderline/alphatab';
import {
  AudioLines,
  ChevronDown,
  CloudUpload,
  Code2,
  FolderOpen,
  Gauge,
  Guitar,
  Layers,
  Maximize2,
  Minimize2,
  Moon,
  Pause,
  Play,
  Printer,
  Repeat,
  RotateCcw,
  SlidersHorizontal,
  Sun,
  TrendingUp,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {DEMO_SCORES} from '../data/demoScores';
import {SliceRecord} from '../types/slice';
import {AlphaTexDrawer} from './AlphaTexDrawer';
import {ActiveFretNote, FretboardVisualizer} from './FretboardVisualizer';
import {MetronomeIcon} from './MetronomeIcon';

export type SoundFontId = 'sonivox' | 'fluidr3' | 'musescore' | 'custom';
export type CountInMode = 'off' | 'first' | 'always';

export interface TabSlicePlayerProps {
  /** True when rendered via /slices/:id/embed/ or ?embed=1 inside an iframe */
  isEmbedMode: boolean;
  /** Optional server-hosted slice to load from /api/slices/:id/file */
  activeSlice?: SliceRecord | null;
  /** Optional remote Guitar Pro / MusicXML / alphaTex file URL (?file=...) */
  initialFileUrl?: string | null;
  /** Built-in fallback demo id */
  demoId: string;
  /** External trigger to open file picker */
  openFileTrigger: number;
  /** External toggle for alphaTex drawer */
  texDrawerOpen: boolean;
  onTexDrawerOpenChange: (open: boolean) => void;
  /** Callback when user wants to publish a locally dropped file to the server */
  onPublishLocalFile?: (file: File) => void;
  /** Initial layout, fretboard, speed & soundfont options from query params */
  initialLayout?: 'page' | 'horizontal';
  initialFretboard?: boolean;
  initialSpeed?: number;
  initialSoundFont?: SoundFontId;
  /** Notify parent when a file/score is loaded */
  onScoreMetaChange?: (meta: {title: string; artist: string; sourceLabel: string}) => void;
}

interface TrackMixerState {
  volume: number; // 0..2 (alphaTab volume ratio, 1 = 100%)
  muted: boolean;
  solo: boolean;
  transpose: number; // -12..+12 semitones
  program: number; // General MIDI program 0..127
}

interface TempoTrainerConfig {
  enabled: boolean;
  startBpm: number;
  targetBpm: number;
  stepBpm: number;
  repeatEvery: number;
  completedLoops: number;
}

type PopoverType = 'tracks' | 'speed' | 'view' | null;

const ACCEPTED_EXTENSIONS = '.gp,.gp3,.gp4,.gp5,.gpx,.gp7,.gp8,.xml,.musicxml,.mxl,.cap,.tex';
const SPEED_PRESETS = [0.5, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5];
const SOUNDFONT_STORAGE_KEY = 'tabslice:soundfont';

const SOUNDFONT_OPTIONS: Array<{
  id: Exclude<SoundFontId, 'custom'>;
  name: string;
  hint: string;
  url: string;
}> = [
  {
    id: 'sonivox',
    name: 'Sonivox Standard',
    hint: 'Schnell · 1,3 MB',
    url: `${import.meta.env.BASE_URL}soundfont/sonivox.sf2`,
  },
  {
    id: 'fluidr3',
    name: 'FluidR3 GM (Studio)',
    hint: 'Empfohlen · 22 MB',
    url: '/api/soundfonts/fluidr3',
  },
  {
    id: 'musescore',
    name: 'MuseScore General HD',
    hint: 'Konzert · 38 MB',
    url: '/api/soundfonts/musescore',
  },
];

const INSTRUMENT_PRESETS: Array<{program: number; label: string; group: string}> = [
  {program: 33, label: 'E-Bass (Fingerstyle)', group: 'Bass'},
  {program: 34, label: 'E-Bass (Plektrum / Pick)', group: 'Bass'},
  {program: 35, label: 'Fretless Bass', group: 'Bass'},
  {program: 36, label: 'Slap Bass', group: 'Bass'},
  {program: 32, label: 'Akustik- / Kontrabass', group: 'Bass'},
  {program: 25, label: 'Akustikgitarre (Stahl)', group: 'Gitarre'},
  {program: 24, label: 'Akustikgitarre (Nylon)', group: 'Gitarre'},
  {program: 26, label: 'E-Gitarre (Jazz)', group: 'Gitarre'},
  {program: 27, label: 'E-Gitarre (Clean)', group: 'Gitarre'},
  {program: 28, label: 'E-Gitarre (Muted)', group: 'Gitarre'},
  {program: 29, label: 'E-Gitarre (Overdrive)', group: 'Gitarre'},
  {program: 30, label: 'E-Gitarre (Distortion)', group: 'Gitarre'},
  {program: 0, label: 'Klavier (Acoustic Grand)', group: 'Tasten'},
];

function getInitialSoundFont(paramSf?: SoundFontId): SoundFontId {
  if (paramSf === 'sonivox' || paramSf === 'fluidr3' || paramSf === 'musescore') {
    return paramSf;
  }
  try {
    const saved = window.localStorage.getItem(SOUNDFONT_STORAGE_KEY);
    if (saved === 'sonivox' || saved === 'fluidr3' || saved === 'musescore') {
      return saved;
    }
  } catch {
    // Ignore storage errors inside restricted iframes
  }
  return 'sonivox';
}

function getSoundFontUrl(id: SoundFontId): string {
  const found = SOUNDFONT_OPTIONS.find((opt) => opt.id === id);
  return found ? found.url : SOUNDFONT_OPTIONS[0].url;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function getFileExtensionLabel(fileName: string): string {
  const ext = fileName.split('.').pop()?.toUpperCase();
  if (!ext) return 'Partitur';
  if (ext.startsWith('GP')) return `Guitar Pro (${ext})`;
  if (ext === 'XML' || ext === 'MUSICXML' || ext === 'MXL') return 'MusicXML';
  if (ext === 'TEX') return 'alphaTex';
  return ext;
}

function applySheetColors(settings: alphaTab.Settings, darkSheet: boolean) {
  const Color = alphaTab.model.Color;
  const res = settings.display.resources;
  if (darkSheet) {
    res.mainGlyphColor = Color.fromJson('#F4F4F5')!;
    res.secondaryGlyphColor = Color.fromJson('#A1A1AA')!;
    res.scoreInfoColor = Color.fromJson('#E4E4E7')!;
    res.staffLineColor = Color.fromJson('#3F3F46')!;
    res.barSeparatorColor = Color.fromJson('#71717A')!;
    res.barNumberColor = Color.fromJson('#60A5FA')!;
  } else {
    res.mainGlyphColor = Color.fromJson('#18181B')!;
    res.secondaryGlyphColor = Color.fromJson('#52525B')!;
    res.scoreInfoColor = Color.fromJson('#18181B')!;
    res.staffLineColor = Color.fromJson('#A1A1AA')!;
    res.barSeparatorColor = Color.fromJson('#3F3F46')!;
    res.barNumberColor = Color.fromJson('#2563EB')!;
  }
}

export const TabSlicePlayer: React.FC<TabSlicePlayerProps> = ({
  isEmbedMode,
  activeSlice = null,
  initialFileUrl,
  demoId,
  openFileTrigger,
  texDrawerOpen,
  onTexDrawerOpenChange,
  onPublishLocalFile,
  initialLayout = 'page',
  initialFretboard = false,
  initialSpeed = 1,
  initialSoundFont,
  onScoreMetaChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const soundFontInputRef = useRef<HTMLInputElement>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const selectedTrackIndexesRef = useRef<number[]>([0]);
  const repeatRestartTimerRef = useRef<number | null>(null);

  // Score & track state
  const [score, setScore] = useState<alphaTab.model.Score | null>(null);
  const [selectedTrackIndexes, setSelectedTrackIndexes] = useState<number[]>([0]);
  const [mixerState, setMixerState] = useState<Record<number, TrackMixerState>>({});
  const [sourceLabel, setSourceLabel] = useState<string>('alphaTex Demo');
  const [isLoadingScore, setIsLoadingScore] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Audio / SoundFont / playback state
  const [activeSoundFont, setActiveSoundFont] = useState<SoundFontId>(() =>
    getInitialSoundFont(initialSoundFont),
  );
  const [customSoundFontName, setCustomSoundFontName] = useState<string | null>(null);
  const [soundFontProgress, setSoundFontProgress] = useState<number>(0);
  const [isSwitchingSoundFont, setIsSwitchingSoundFont] = useState<boolean>(false);
  const [isPlayerReady, setIsPlayerReady] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [endTimeMs, setEndTimeMs] = useState<number>(0);
  const [endTick, setEndTick] = useState<number>(0);
  const [playbackRange, setPlaybackRange] = useState<{startTick: number; endTick: number} | null>(
    null,
  );

  // Practice controls: Speed, BPM, Tempo-Trainer, Metronome, Count-in (off | first | always)
  const [speed, setSpeed] = useState<number>(
    Math.min(2, Math.max(0.25, Number.isFinite(initialSpeed) ? initialSpeed : 1)),
  );
  const [bpmInputText, setBpmInputText] = useState<string>('112');
  const [tempoTab, setTempoTab] = useState<'tempo' | 'trainer'>('tempo');
  const [trainer, setTrainer] = useState<TempoTrainerConfig>({
    enabled: false,
    startBpm: 80,
    targetBpm: 112,
    stepBpm: 5,
    repeatEvery: 1,
    completedLoops: 0,
  });

  const [isLooping, setIsLooping] = useState<boolean>(false);
  const [metronomeOn, setMetronomeOn] = useState<boolean>(false);
  const [metronomeVolume, setMetronomeVolume] = useState<number>(0.85);
  const [metronomeTickRight, setMetronomeTickRight] = useState<boolean>(true);
  const [countInMode, setCountInMode] = useState<CountInMode>('first');
  const [masterVolume, setMasterVolume] = useState<number>(1);
  const [isMasterMuted, setIsMasterMuted] = useState<boolean>(false);

  // View settings
  const [layoutMode, setLayoutMode] = useState<'page' | 'horizontal'>(initialLayout);
  const [staveProfile, setStaveProfile] = useState<'default' | 'scoretab' | 'tab' | 'score'>(
    'default',
  );
  const [zoom, setZoom] = useState<number>(1.0);
  const [scrollMode, setScrollMode] = useState<'continuous' | 'offscreen' | 'off'>('continuous');
  const [darkSheet, setDarkSheet] = useState<boolean>(false);
  const [showFretboard, setShowFretboard] = useState<boolean>(initialFretboard);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [activePopover, setActivePopover] = useState<PopoverType>(null);

  // Drag & drop + alphaTex editor state
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [localDraftFile, setLocalDraftFile] = useState<File | null>(null);
  const [texCode, setTexCode] = useState<string>(() => {
    const found = DEMO_SCORES.find((d) => d.id === demoId) ?? DEMO_SCORES[0];
    return found.tex;
  });
  const [texError, setTexError] = useState<string | null>(null);

  // Active fretboard notes synced from alphaTab activeBeatsChanged
  const [activeFretNotes, setActiveFretNotes] = useState<ActiveFretNote[]>([]);

  // Live refs for alphaTab event callbacks (avoids stale closures)
  const scoreRef = useRef<alphaTab.model.Score | null>(null);
  const speedRef = useRef<number>(speed);
  const isLoopingRef = useRef<boolean>(isLooping);
  const countInModeRef = useRef<CountInMode>(countInMode);
  const trainerRef = useRef<TempoTrainerConfig>(trainer);
  const playbackRangeRef = useRef<{startTick: number; endTick: number} | null>(playbackRange);
  const manualStopRef = useRef<boolean>(false);

  useEffect(() => {
    selectedTrackIndexesRef.current = selectedTrackIndexes;
  }, [selectedTrackIndexes]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    isLoopingRef.current = isLooping;
  }, [isLooping]);

  useEffect(() => {
    countInModeRef.current = countInMode;
  }, [countInMode]);

  useEffect(() => {
    trainerRef.current = trainer;
  }, [trainer]);

  useEffect(() => {
    playbackRangeRef.current = playbackRange;
  }, [playbackRange]);

  const baseTempo = score?.tempo || 120;
  const effectiveBpm = Math.max(15, Math.round(baseTempo * speed));

  // Keep numeric BPM input text synced whenever score tempo or speed changes
  useEffect(() => {
    setBpmInputText(String(effectiveBpm));
  }, [effectiveBpm]);

  // Sync native synth looping vs managed repeat-with-count-in mode:
  // When user enables Loop + Count-in "Bei jeder Wiederholung" ('always'),
  // we disable internal seamless synth looping so playerFinished fires at loop end,
  // allowing us to bump Tempo-Trainer BPM and invoke alphaTab's native Count-In cleanly!
  const syncSynthLoopAndCountIn = useCallback(
    (loopEnabled: boolean, mode: CountInMode) => {
      const api = apiRef.current;
      if (!api) return;
      api.countInVolume = mode === 'off' ? 0 : 1;
      api.isLooping = loopEnabled && mode !== 'always';
    },
    [],
  );

  useEffect(() => {
    syncSynthLoopAndCountIn(isLooping, countInMode);
  }, [isLooping, countInMode, syncSynthLoopAndCountIn]);

  const clearPendingRepeatRestart = useCallback(() => {
    if (repeatRestartTimerRef.current !== null) {
      window.clearTimeout(repeatRestartTimerRef.current);
      repeatRestartTimerRef.current = null;
    }
  }, []);

  // Trigger file input from parent studio bar
  useEffect(() => {
    if (openFileTrigger > 0) {
      fileInputRef.current?.click();
    }
  }, [openFileTrigger]);

  // Load binary or text Guitar Pro / MusicXML / alphaTex file
  const loadLocalFile = useCallback(
    (file: File) => {
      const api = apiRef.current;
      if (!api) return;
      clearPendingRepeatRestart();
      setErrorBanner(null);
      setTexError(null);
      setIsLoadingScore(true);
      setLocalDraftFile(file);

      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'tex') {
        const reader = new FileReader();
        reader.onload = () => {
          const text = typeof reader.result === 'string' ? reader.result : '';
          setTexCode(text);
          setSourceLabel(`${file.name} · alphaTex`);
          api.tex(text);
        };
        reader.onerror = () => {
          setIsLoadingScore(false);
          setErrorBanner(`Datei „${file.name}“ konnte nicht gelesen werden.`);
        };
        reader.readAsText(file);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          setSourceLabel(`${file.name} · ${getFileExtensionLabel(file.name)}`);
          const ok = api.load(new Uint8Array(reader.result));
          if (!ok) {
            setIsLoadingScore(false);
            setErrorBanner(
              `Format von „${file.name}“ wurde nicht erkannt. Unterstützt: .gp, .gp3–.gp8, .gpx, .xml, .musicxml, .tex`,
            );
          }
        }
      };
      reader.onerror = () => {
        setIsLoadingScore(false);
        setErrorBanner(`Datei „${file.name}“ konnte nicht gelesen werden.`);
      };
      reader.readAsArrayBuffer(file);
    },
    [clearPendingRepeatRestart],
  );

  // Load remote file URL (for ?file=... embed parameter, /api/slices/:id/file, or postMessage)
  const loadRemoteUrl = useCallback(
    async (url: string, labelOverride?: string, extHint?: string) => {
      const api = apiRef.current;
      if (!api) return;
      clearPendingRepeatRestart();
      setErrorBanner(null);
      setTexError(null);
      setIsLoadingScore(true);
      setLocalDraftFile(null);
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        const headerExt = response.headers.get('X-Slice-Ext')?.toLowerCase();
        const fileName = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'Partitur.gp');
        const isTex =
          extHint === 'tex' || headerExt === 'tex' || fileName.toLowerCase().endsWith('.tex');

        if (isTex) {
          const text = new TextDecoder().decode(buffer);
          setTexCode(text);
          setSourceLabel(labelOverride || `${fileName} · alphaTex`);
          api.tex(text);
        } else {
          setSourceLabel(labelOverride || `${fileName} · ${getFileExtensionLabel(fileName)}`);
          const ok = api.load(new Uint8Array(buffer));
          if (!ok) {
            throw new Error('Nicht unterstütztes Dateiformat');
          }
        }
      } catch (err) {
        setIsLoadingScore(false);
        const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
        setErrorBanner(
          `Datei konnte nicht geladen werden (${msg}). Prüfe URL/Server oder ziehe eine Guitar-Pro-Datei direkt in den Player.`,
        );
      }
    },
    [clearPendingRepeatRestart],
  );

  // Initialize alphaTab API once on mount
  useEffect(() => {
    const mountEl = mountRef.current;
    const scrollEl = viewportRef.current;
    if (!mountEl || !scrollEl) return;

    const initialSfId = getInitialSoundFont(initialSoundFont);
    const settings = new alphaTab.Settings();
    settings.core.fontDirectory = `${import.meta.env.BASE_URL}font/`;
    settings.core.engine = 'svg';
    settings.core.useWorkers = true;
    settings.display.layoutMode =
      initialLayout === 'horizontal'
        ? alphaTab.LayoutMode.Horizontal
        : alphaTab.LayoutMode.Page;
    settings.display.staveProfile = alphaTab.StaveProfile.Default;
    settings.display.scale = 1.0;
    applySheetColors(settings, false);

    settings.player.enablePlayer = true;
    settings.player.enableCursor = true;
    settings.player.enableUserInteraction = true;
    settings.player.soundFont = getSoundFontUrl(initialSfId);
    settings.player.scrollElement = scrollEl;
    settings.player.scrollMode = alphaTab.ScrollMode.Continuous;
    settings.player.scrollOffsetY = -28;

    const api = new alphaTab.AlphaTabApi(mountEl, settings);
    apiRef.current = api;

    api.soundFontLoad.on((e) => {
      if (e.total > 0) {
        setSoundFontProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    api.soundFontLoaded.on(() => {
      setSoundFontProgress(100);
      setIsSwitchingSoundFont(false);
    });

    api.playerReady.on(() => {
      setIsPlayerReady(true);
      api.playbackSpeed = Math.min(2, Math.max(0.25, initialSpeed));
      api.countInVolume = countInModeRef.current === 'off' ? 0 : 1;
      api.isLooping = isLoopingRef.current && countInModeRef.current !== 'always';
    });

    api.scoreLoaded.on((loadedScore) => {
      setScore(loadedScore);
      setIsLoadingScore(false);
      setErrorBanner(null);
      setTexError(null);
      setPlaybackRange(null);
      setActiveFretNotes([]);

      // Update Tempo-Trainer defaults to match the loaded song's natural BPM (70% -> 100%)
      const songBpm = loadedScore.tempo || 120;
      setTrainer((prev) => ({
        ...prev,
        startBpm: Math.max(30, Math.round(songBpm * 0.7)),
        targetBpm: songBpm,
        completedLoops: 0,
      }));

      const initialIndexes = loadedScore.tracks.length > 0 ? [0] : [];
      setSelectedTrackIndexes(initialIndexes);
      selectedTrackIndexesRef.current = initialIndexes;

      const freshMixer: Record<number, TrackMixerState> = {};
      loadedScore.tracks.forEach((t) => {
        freshMixer[t.index] = {
          volume: 1,
          muted: t.playbackInfo.isMute,
          solo: t.playbackInfo.isSolo,
          transpose: 0,
          program: t.playbackInfo.program,
        };
      });
      setMixerState(freshMixer);

      if (onScoreMetaChange) {
        onScoreMetaChange({
          title: loadedScore.title || 'Unbenannte Partitur',
          artist: loadedScore.artist || '',
          sourceLabel:
            loadedScore.tracks.length > 1 ? `${loadedScore.tracks.length} Spuren` : '1 Spur',
        });
      }
    });

    api.renderFinished.on(() => {
      setIsLoadingScore(false);
    });

    api.playerStateChanged.on((e) => {
      const playing = e.state === 1;
      setIsPlaying(playing);
      if (playing) {
        manualStopRef.current = false;
      }
    });

    api.playerPositionChanged.on((e) => {
      setCurrentTimeMs(e.currentTime);
      setEndTimeMs(e.endTime);
      setEndTick(e.endTick);
    });

    api.playbackRangeChanged.on((e) => {
      if (e.playbackRange) {
        const range = {
          startTick: e.playbackRange.startTick,
          endTick: e.playbackRange.endTick,
        };
        setPlaybackRange(range);
        setIsLooping(true);
        api.isLooping = countInModeRef.current !== 'always';
      } else {
        setPlaybackRange(null);
      }
    });

    // Handles BOTH Tempo-Trainer progressive speedup AND Count-in on every repeat!
    api.playerFinished.on(() => {
      if (manualStopRef.current) return;

      const looping = isLoopingRef.current;
      const mode = countInModeRef.current;
      const currentTrainer = trainerRef.current;
      const songBpm = scoreRef.current?.tempo || 120;

      // 1. Advance Tempo-Trainer if enabled & looping
      if (looping && currentTrainer.enabled) {
        const nextLoops = currentTrainer.completedLoops + 1;
        const currentBpm = Math.round(songBpm * speedRef.current);
        let nextBpm = currentBpm;

        if (nextLoops % Math.max(1, currentTrainer.repeatEvery) === 0) {
          if (currentTrainer.startBpm <= currentTrainer.targetBpm) {
            nextBpm = Math.min(currentTrainer.targetBpm, currentBpm + currentTrainer.stepBpm);
          } else {
            nextBpm = Math.max(currentTrainer.targetBpm, currentBpm - currentTrainer.stepBpm);
          }
        }

        const nextSpeed = Math.min(2.5, Math.max(0.2, nextBpm / songBpm));
        if (Math.abs(nextSpeed - speedRef.current) > 0.002) {
          api.playbackSpeed = nextSpeed;
          setSpeed(nextSpeed);
        }

        setTrainer((prev) => ({...prev, completedLoops: nextLoops}));
      }

      // 2. If Count-in on every repeat is enabled alongside Loop, restart cleanly from loop start
      //    so alphaTab plays its native Count-In at the (potentially newly incremented) tempo!
      if (looping && mode === 'always') {
        clearPendingRepeatRestart();
        repeatRestartTimerRef.current = window.setTimeout(() => {
          repeatRestartTimerRef.current = null;
          if (manualStopRef.current || !apiRef.current) return;
          const range = playbackRangeRef.current;
          apiRef.current.countInVolume = 1;
          apiRef.current.tickPosition = range ? range.startTick : 0;
          apiRef.current.play();
        }, 70);
      }
    });

    api.activeBeatsChanged.on((args) => {
      // Gently alternate metronome icon pendulum on each beat change
      setMetronomeTickRight((prev) => !prev);

      const preferredTrackIndex = selectedTrackIndexesRef.current[0] ?? 0;
      const notes: ActiveFretNote[] = [];

      for (const beat of args.activeBeats) {
        const beatTrackIndex = beat.voice?.bar?.staff?.track?.index;
        if (beatTrackIndex !== preferredTrackIndex) continue;
        for (const note of beat.notes) {
          if (note.isStringed && note.fret >= 0) {
            notes.push({
              stringNumber: note.string,
              fret: note.fret,
              isDead: note.isDead,
              isGhost: note.isGhost,
            });
          }
        }
      }
      setActiveFretNotes(notes);
    });

    api.error.on((err) => {
      setIsLoadingScore(false);
      setIsSwitchingSoundFont(false);
      const message = err?.message || 'Fehler beim Parsen oder Rendern der Partitur.';
      setErrorBanner(message);
      setTexError(message);
    });

    // Load initial score (active server slice, remote URL, or built-in demo)
    if (activeSlice) {
      loadRemoteUrl(
        `/api/slices/${encodeURIComponent(activeSlice.id)}/file`,
        `${activeSlice.fileName} · /slices/${activeSlice.id}/embed/`,
        activeSlice.ext,
      );
    } else if (initialFileUrl) {
      loadRemoteUrl(initialFileUrl);
    } else {
      const initialDemo = DEMO_SCORES.find((d) => d.id === demoId) ?? DEMO_SCORES[0];
      setTexCode(initialDemo.tex);
      setSourceLabel(`Demo · ${initialDemo.label}`);
      api.tex(initialDemo.tex);
    }

    return () => {
      clearPendingRepeatRestart();
      api.destroy();
      apiRef.current = null;
    };
    // Intentionally initialize alphaTab once; slice/demo switches handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load new server slice whenever activeSlice changes
  const prevSliceIdRef = useRef<string | null>(activeSlice?.id ?? null);
  useEffect(() => {
    const nextId = activeSlice?.id ?? null;
    if (!nextId || prevSliceIdRef.current === nextId) return;
    prevSliceIdRef.current = nextId;
    const api = apiRef.current;
    if (!api || !activeSlice) return;
    manualStopRef.current = true;
    clearPendingRepeatRestart();
    api.pause();
    loadRemoteUrl(
      `/api/slices/${encodeURIComponent(activeSlice.id)}/file`,
      `${activeSlice.fileName} · /slices/${activeSlice.id}/embed/`,
      activeSlice.ext,
    );
  }, [activeSlice, loadRemoteUrl, clearPendingRepeatRestart]);

  // Switch demo when user clicks another demo
  const prevDemoIdRef = useRef<string>(demoId);
  useEffect(() => {
    if (activeSlice || prevDemoIdRef.current === demoId) return;
    prevDemoIdRef.current = demoId;
    const api = apiRef.current;
    if (!api) return;
    const found = DEMO_SCORES.find((d) => d.id === demoId);
    if (!found) return;
    manualStopRef.current = true;
    clearPendingRepeatRestart();
    api.pause();
    setErrorBanner(null);
    setTexError(null);
    setIsLoadingScore(true);
    setLocalDraftFile(null);
    setTexCode(found.tex);
    setSourceLabel(`Demo · ${found.label}`);
    api.tex(found.tex);
  }, [demoId, activeSlice, clearPendingRepeatRestart]);

  // PostMessage API bridge for parent websites embedding the iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      const api = apiRef.current;
      if (!api) return;

      if (msg.type === 'tabslice:loadFile' && msg.data) {
        const bytes =
          msg.data instanceof Uint8Array
            ? msg.data
            : msg.data instanceof ArrayBuffer
              ? new Uint8Array(msg.data)
              : null;
        if (bytes) {
          const name = typeof msg.fileName === 'string' ? msg.fileName : 'GuitarPro.gp';
          setErrorBanner(null);
          setIsLoadingScore(true);
          setSourceLabel(`${name} · ${getFileExtensionLabel(name)}`);
          api.load(bytes);
        }
      } else if (msg.type === 'tabslice:loadUrl' && typeof msg.url === 'string') {
        loadRemoteUrl(msg.url);
      } else if (msg.type === 'tabslice:loadTex' && typeof msg.tex === 'string') {
        setErrorBanner(null);
        setIsLoadingScore(true);
        setTexCode(msg.tex);
        setSourceLabel('Externes alphaTex');
        api.tex(msg.tex);
      } else if (msg.type === 'tabslice:playPause') {
        api.playPause();
      } else if (msg.type === 'tabslice:setSpeed' && typeof msg.speed === 'number') {
        const clamped = Math.min(2.5, Math.max(0.2, msg.speed));
        api.playbackSpeed = clamped;
        setSpeed(clamped);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [loadRemoteUrl]);

  // Track Fullscreen API state
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleSpeedChange = useCallback((newSpeed: number) => {
    const clamped = Math.min(2.5, Math.max(0.2, newSpeed));
    setSpeed(clamped);
    if (apiRef.current) {
      apiRef.current.playbackSpeed = clamped;
    }
  }, []);

  const handleBpmChange = useCallback(
    (targetBpm: number) => {
      const clampedBpm = Math.min(320, Math.max(20, Math.round(targetBpm)));
      const nextSpeed = clampedBpm / Math.max(1, baseTempo);
      handleSpeedChange(nextSpeed);
    },
    [baseTempo, handleSpeedChange],
  );

  // Keyboard shortcuts (Space, L, M, C, Escape, Up/Down BPM ±5)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const api = apiRef.current;
      if (!api) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (isPlayerReady) {
          if (isPlaying) {
            manualStopRef.current = true;
            clearPendingRepeatRestart();
            api.pause();
          } else {
            manualStopRef.current = false;
            api.play();
          }
        }
      } else if (e.key === 'Escape') {
        if (activePopover) {
          setActivePopover(null);
        } else if (playbackRange) {
          api.playbackRange = null;
          setPlaybackRange(null);
        }
      } else if (e.key === 'l' || e.key === 'L') {
        setIsLooping((prev) => !prev);
      } else if (e.key === 'm' || e.key === 'M') {
        setMetronomeOn((prev) => {
          const next = !prev;
          api.metronomeVolume = next ? metronomeVolume : 0;
          return next;
        });
      } else if (e.key === 'c' || e.key === 'C') {
        setCountInMode((prev) =>
          prev === 'off' ? 'first' : prev === 'first' ? 'always' : 'off',
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleBpmChange(effectiveBpm + 5);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleBpmChange(effectiveBpm - 5);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isPlayerReady,
    isPlaying,
    metronomeVolume,
    activePopover,
    playbackRange,
    effectiveBpm,
    handleBpmChange,
    clearPendingRepeatRestart,
  ]);

  // Handlers
  const handlePlayPause = () => {
    const api = apiRef.current;
    if (!api || !isPlayerReady) return;
    if (isPlaying) {
      manualStopRef.current = true;
      clearPendingRepeatRestart();
      api.pause();
    } else {
      manualStopRef.current = false;
      api.countInVolume = countInMode === 'off' ? 0 : 1;
      api.play();
    }
  };

  const handleStop = () => {
    manualStopRef.current = true;
    clearPendingRepeatRestart();
    if (!apiRef.current) return;
    apiRef.current.stop();
    setActiveFretNotes([]);
    setTrainer((prev) => ({...prev, completedLoops: 0}));
  };

  const handleToggleLoop = () => {
    setIsLooping((prev) => !prev);
  };

  const handleClearRange = () => {
    if (!apiRef.current) return;
    apiRef.current.playbackRange = null;
    setPlaybackRange(null);
  };

  const handleToggleMetronome = () => {
    if (!apiRef.current) return;
    const next = !metronomeOn;
    apiRef.current.metronomeVolume = next ? metronomeVolume : 0;
    setMetronomeOn(next);
  };

  const handleMetronomeVolumeChange = (val: number) => {
    setMetronomeVolume(val);
    if (apiRef.current && metronomeOn) {
      apiRef.current.metronomeVolume = val;
    }
  };

  const handleCycleCountIn = () => {
    setCountInMode((prev) => (prev === 'off' ? 'first' : prev === 'first' ? 'always' : 'off'));
  };

  const handleStartTempoTrainer = () => {
    const api = apiRef.current;
    if (!api || !isPlayerReady) return;
    clearPendingRepeatRestart();
    manualStopRef.current = false;

    const startSpeed = Math.min(2.5, Math.max(0.2, trainer.startBpm / Math.max(1, baseTempo)));
    setTrainer((prev) => ({...prev, enabled: true, completedLoops: 0}));
    setSpeed(startSpeed);
    api.playbackSpeed = startSpeed;
    setIsLooping(true);

    // Ensure count-in is active at least on repeat if user had it off
    const effectiveMode: CountInMode = countInMode === 'off' ? 'always' : countInMode;
    if (countInMode === 'off') {
      setCountInMode('always');
    }
    api.countInVolume = 1;
    api.isLooping = effectiveMode !== 'always';
    api.tickPosition = playbackRange ? playbackRange.startTick : 0;
    api.play();
  };

  const handleResetTempoTrainer = () => {
    const songBpm = score?.tempo || 120;
    setTrainer({
      enabled: false,
      startBpm: Math.max(30, Math.round(songBpm * 0.7)),
      targetBpm: songBpm,
      stepBpm: 5,
      repeatEvery: 1,
      completedLoops: 0,
    });
    handleSpeedChange(1);
  };

  // Switch SoundFont (Sonivox | FluidR3 GM Studio | MuseScore HD)
  const handleSelectSoundFont = (sfId: Exclude<SoundFontId, 'custom'>) => {
    const api = apiRef.current;
    if (!api) return;
    setActiveSoundFont(sfId);
    setCustomSoundFontName(null);
    setIsSwitchingSoundFont(true);
    setSoundFontProgress(0);
    setErrorBanner(null);
    try {
      window.localStorage.setItem(SOUNDFONT_STORAGE_KEY, sfId);
    } catch {
      // Ignore storage errors
    }
    api.loadSoundFont(getSoundFontUrl(sfId), false);
  };

  const handleUploadCustomSoundFont = (file: File) => {
    const api = apiRef.current;
    if (!api) return;
    setIsSwitchingSoundFont(true);
    setSoundFontProgress(0);
    setErrorBanner(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        setActiveSoundFont('custom');
        setCustomSoundFontName(file.name);
        api.loadSoundFont(new Uint8Array(reader.result), false);
      }
    };
    reader.onerror = () => {
      setIsSwitchingSoundFont(false);
      setErrorBanner(`SoundFont „${file.name}“ konnte nicht gelesen werden.`);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleMasterVolumeChange = (val: number) => {
    setMasterVolume(val);
    setIsMasterMuted(val === 0);
    if (apiRef.current) {
      apiRef.current.masterVolume = val;
    }
  };

  const handleToggleMasterMute = () => {
    if (!apiRef.current) return;
    if (isMasterMuted) {
      const restored = masterVolume > 0 ? masterVolume : 1;
      setIsMasterMuted(false);
      setMasterVolume(restored);
      apiRef.current.masterVolume = restored;
    } else {
      setIsMasterMuted(true);
      apiRef.current.masterVolume = 0;
    }
  };

  // Track selection & mixer handlers
  const handleSelectSingleTrack = (trackIndex: number) => {
    if (!apiRef.current || !score) return;
    const target = score.tracks[trackIndex];
    if (!target) return;
    setSelectedTrackIndexes([trackIndex]);
    setActiveFretNotes([]);
    apiRef.current.renderTracks([target]);
  };

  const handleToggleTrackVisibility = (trackIndex: number) => {
    if (!apiRef.current || !score) return;
    const exists = selectedTrackIndexes.includes(trackIndex);
    let next: number[];
    if (exists) {
      if (selectedTrackIndexes.length <= 1) return;
      next = selectedTrackIndexes.filter((idx) => idx !== trackIndex);
    } else {
      next = [...selectedTrackIndexes, trackIndex].sort((a, b) => a - b);
    }
    setSelectedTrackIndexes(next);
    setActiveFretNotes([]);
    apiRef.current.renderTracks(next.map((idx) => score.tracks[idx]).filter(Boolean));
  };

  const handleShowAllTracks = () => {
    if (!apiRef.current || !score) return;
    const all = score.tracks.map((t) => t.index);
    setSelectedTrackIndexes(all);
    apiRef.current.renderTracks(score.tracks);
  };

  const handleToggleTrackMute = (track: alphaTab.model.Track) => {
    if (!apiRef.current) return;
    const current = mixerState[track.index]?.muted ?? false;
    const next = !current;
    apiRef.current.changeTrackMute([track], next);
    setMixerState((prev) => ({
      ...prev,
      [track.index]: {
        ...(prev[track.index] ?? {
          volume: 1,
          muted: false,
          solo: false,
          transpose: 0,
          program: track.playbackInfo.program,
        }),
        muted: next,
      },
    }));
  };

  const handleToggleTrackSolo = (track: alphaTab.model.Track) => {
    if (!apiRef.current) return;
    const current = mixerState[track.index]?.solo ?? false;
    const next = !current;
    apiRef.current.changeTrackSolo([track], next);
    setMixerState((prev) => ({
      ...prev,
      [track.index]: {
        ...(prev[track.index] ?? {
          volume: 1,
          muted: false,
          solo: false,
          transpose: 0,
          program: track.playbackInfo.program,
        }),
        solo: next,
      },
    }));
  };

  const handleTrackVolumeChange = (track: alphaTab.model.Track, vol: number) => {
    if (!apiRef.current) return;
    apiRef.current.changeTrackVolume([track], vol);
    setMixerState((prev) => ({
      ...prev,
      [track.index]: {
        ...(prev[track.index] ?? {
          volume: 1,
          muted: false,
          solo: false,
          transpose: 0,
          program: track.playbackInfo.program,
        }),
        volume: vol,
      },
    }));
  };

  const handleTrackTranspose = (track: alphaTab.model.Track, semitones: number) => {
    if (!apiRef.current) return;
    const clamped = Math.max(-12, Math.min(12, semitones));
    apiRef.current.changeTrackTranspositionPitch([track], clamped);
    setMixerState((prev) => ({
      ...prev,
      [track.index]: {
        ...(prev[track.index] ?? {
          volume: 1,
          muted: false,
          solo: false,
          transpose: 0,
          program: track.playbackInfo.program,
        }),
        transpose: clamped,
      },
    }));
  };

  // Switch track instrument sound (e.g. Electric Bass Fingerstyle GM 33) live!
  const handleTrackProgramChange = (track: alphaTab.model.Track, newProgram: number) => {
    const api = apiRef.current;
    if (!api) return;
    const wasPlaying = isPlaying;
    const savedTick = api.tickPosition;
    track.playbackInfo.program = newProgram;
    api.loadMidiForScore();
    api.tickPosition = savedTick;
    if (wasPlaying) {
      api.play();
    }
    setMixerState((prev) => ({
      ...prev,
      [track.index]: {
        ...(prev[track.index] ?? {
          volume: 1,
          muted: false,
          solo: false,
          transpose: 0,
          program: newProgram,
        }),
        program: newProgram,
      },
    }));
  };

  // Display / view setting updaters
  const handleLayoutChange = (mode: 'page' | 'horizontal') => {
    setLayoutMode(mode);
    const api = apiRef.current;
    if (!api) return;
    api.settings.display.layoutMode =
      mode === 'horizontal' ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page;
    api.updateSettings();
    api.render();
  };

  const handleStaveProfileChange = (profile: 'default' | 'scoretab' | 'tab' | 'score') => {
    setStaveProfile(profile);
    const api = apiRef.current;
    if (!api) return;
    const map = {
      default: alphaTab.StaveProfile.Default,
      scoretab: alphaTab.StaveProfile.ScoreTab,
      tab: alphaTab.StaveProfile.Tab,
      score: alphaTab.StaveProfile.Score,
    };
    api.settings.display.staveProfile = map[profile];
    api.updateSettings();
    api.render();
  };

  const handleZoomChange = (newZoom: number) => {
    const clamped = Math.max(0.6, Math.min(1.5, newZoom));
    setZoom(clamped);
    const api = apiRef.current;
    if (!api) return;
    api.settings.display.scale = clamped;
    api.updateSettings();
    api.render();
  };

  const handleScrollModeChange = (mode: 'continuous' | 'offscreen' | 'off') => {
    setScrollMode(mode);
    const api = apiRef.current;
    if (!api) return;
    const map = {
      continuous: alphaTab.ScrollMode.Continuous,
      offscreen: alphaTab.ScrollMode.OffScreen,
      off: alphaTab.ScrollMode.Off,
    };
    api.settings.player.scrollMode = map[mode];
    api.updateSettings();
  };

  const handleToggleDarkSheet = () => {
    const next = !darkSheet;
    setDarkSheet(next);
    const api = apiRef.current;
    if (!api) return;
    applySheetColors(api.settings, next);
    api.updateSettings();
    api.render();
  };

  const handleToggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen may be restricted by parent iframe permissions
    }
  };

  const handleSeekBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const api = apiRef.current;
    if (!api || endTimeMs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    api.timePosition = Math.round(ratio * endTimeMs);
  };

  // Drag and drop handlers for Guitar Pro files
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingFile) setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDraggingFile(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      loadLocalFile(file);
    }
  };

  const handleApplyTex = () => {
    const api = apiRef.current;
    if (!api) return;
    setTexError(null);
    setErrorBanner(null);
    setIsLoadingScore(true);
    setSourceLabel('alphaTex Editor');
    api.tex(texCode);
  };

  const handleResetTex = () => {
    const demo = DEMO_SCORES.find((d) => d.id === demoId) ?? DEMO_SCORES[0];
    setTexCode(demo.tex);
    setTexError(null);
    setErrorBanner(null);
    setSourceLabel(`Demo · ${demo.label}`);
    apiRef.current?.tex(demo.tex);
  };

  // Active track details for Fretboard & Header
  const primaryTrack = useMemo(() => {
    if (!score || score.tracks.length === 0) return null;
    return score.tracks[selectedTrackIndexes[0] ?? 0] ?? score.tracks[0];
  }, [score, selectedTrackIndexes]);

  const primaryTrackTuning = useMemo(() => {
    if (!primaryTrack || !primaryTrack.staves[0]) return [64, 59, 55, 50, 45, 40];
    const staff = primaryTrack.staves[0];
    if (staff.isPercussion) return [];
    const tuning = staff.stringTuning?.tunings ?? staff.tuning ?? [];
    return tuning.length > 0 ? tuning : [64, 59, 55, 50, 45, 40];
  }, [primaryTrack]);

  const progressPercent = endTimeMs > 0 ? Math.min(100, (currentTimeMs / endTimeMs) * 100) : 0;
  const rangeStartPct =
    playbackRange && endTick > 0 ? Math.max(0, (playbackRange.startTick / endTick) * 100) : 0;
  const rangeWidthPct =
    playbackRange && endTick > 0
      ? Math.max(0.5, ((playbackRange.endTick - playbackRange.startTick) / endTick) * 100)
      : 0;

  const countInLabel =
    countInMode === 'off' ? 'Aus' : countInMode === 'first' ? '1× Start' : 'Jeder Loop';

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-col w-full h-full overflow-hidden ${
        darkSheet ? 'bg-[#111317] text-zinc-100' : 'bg-white text-zinc-900'
      }`}
    >
      {/* Hidden File Input for Guitar Pro / MusicXML / alphaTex */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            loadLocalFile(file);
          }
          e.target.value = '';
        }}
      />

      {/* Hidden File Input for Custom SoundFont (.sf2 / .sf3) */}
      <input
        ref={soundFontInputRef}
        type="file"
        accept=".sf2,.sf3"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleUploadCustomSoundFont(file);
          }
          e.target.value = '';
        }}
      />

      {/* Slim Soundslice-style Player Top Bar */}
      <div
        className={`flex items-center justify-between gap-4 px-4 h-11 border-b shrink-0 ${
          darkSheet
            ? 'bg-[#16181D] border-white/10 text-zinc-100'
            : 'bg-[#FAFAFB] border-zinc-200 text-zinc-900'
        }`}
      >
        {/* Left: Score Title & Metadata (clean unboxed separators) */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">
            {score?.title || 'Partitur wird geladen…'}
          </span>
          {score?.artist && (
            <>
              <span aria-hidden="true" className="text-zinc-400 hidden sm:inline">
                ·
              </span>
              <span
                className={`text-xs truncate hidden sm:inline ${
                  darkSheet ? 'text-zinc-400' : 'text-zinc-500'
                }`}
              >
                {score.artist}
              </span>
            </>
          )}
          <span aria-hidden="true" className="text-zinc-400 hidden lg:inline">
            ·
          </span>
          <span
            className={`text-xs truncate hidden lg:inline ${
              darkSheet ? 'text-zinc-400' : 'text-zinc-500'
            }`}
          >
            {sourceLabel}
          </span>
        </div>

        {/* Right: Quick Track Switcher + Load Guitar Pro File + alphaTex toggle */}
        <div className="flex items-center gap-2 shrink-0">
          {score && score.tracks.length > 0 && (
            <button
              type="button"
              onClick={() => setActivePopover((prev) => (prev === 'tracks' ? null : 'tracks'))}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                darkSheet
                  ? 'bg-white/5 border-white/10 text-zinc-200 hover:bg-white/10'
                  : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
              }`}
              title="Spuren auswählen, Bass-Sound wählen & mischen"
            >
              <Layers className="w-3.5 h-3.5 text-blue-600" />
              <span className="max-w-[140px] truncate">
                {selectedTrackIndexes.length > 1
                  ? `${selectedTrackIndexes.length} / ${score.tracks.length} Spuren`
                  : primaryTrack?.name || 'Spur 1'}
              </span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
          )}

          {isEmbedMode && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                darkSheet
                  ? 'bg-white/5 border-white/10 text-zinc-200 hover:bg-white/10'
                  : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
              }`}
              title="Guitar-Pro-Datei öffnen (.gp, .gp3–.gp8, .gpx, .xml, .tex)"
            >
              <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
              <span className="hidden sm:inline">Guitar Pro laden</span>
            </button>
          )}

          {!isEmbedMode && localDraftFile && onPublishLocalFile && (
            <button
              type="button"
              onClick={() => onPublishLocalFile(localDraftFile)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors whitespace-nowrap shrink-0"
              title="Diese Guitar-Pro-Datei auf dem Server speichern und Forum-Embed-Link erhalten"
            >
              <CloudUpload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Als Forum-Link speichern</span>
            </button>
          )}

          {!isEmbedMode && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                darkSheet
                  ? 'bg-white/5 border-white/10 text-zinc-200 hover:bg-white/10'
                  : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
              }`}
              title="Lokale Guitar-Pro-Datei schnell testen"
            >
              <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
              <span className="hidden md:inline">Datei testen</span>
            </button>
          )}

          {!isEmbedMode && (
            <button
              type="button"
              onClick={() => onTexDrawerOpenChange(!texDrawerOpen)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                texDrawerOpen
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : darkSheet
                    ? 'bg-white/5 border-white/10 text-zinc-200 hover:bg-white/10'
                    : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
              }`}
              title="alphaTex Live-Editor ein-/ausblenden"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">alphaTex</span>
            </button>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {errorBanner && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-800 shrink-0">
          <span className="truncate">{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="p-1 text-red-600 hover:text-red-900 rounded"
            aria-label="Fehlermeldung schließen"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Content Area: Score Canvas + Optional alphaTex Side Drawer */}
      <div className="relative flex-1 min-h-0 flex overflow-hidden">
        {/* Scrollable Score Viewport */}
        <div
          ref={viewportRef}
          onClick={() => {
            if (activePopover) setActivePopover(null);
          }}
          className={`relative flex-1 min-w-0 h-full overflow-auto score-scroll ${
            darkSheet ? 'bg-[#111317] at-surface-dark' : 'bg-white'
          }`}
        >
          {/* Loading Indicator */}
          {isLoadingScore && (
            <div
              className={`absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 ${
                darkSheet ? 'bg-[#111317]/80' : 'bg-white/85'
              } backdrop-blur-[1px]`}
            >
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className={`text-xs font-medium ${darkSheet ? 'text-zinc-300' : 'text-zinc-600'}`}>
                Notenbild &amp; Tabulatur werden gerendert…
              </p>
            </div>
          )}

          {/* Subtle practice hint & score tempo readout */}
          {!isLoadingScore && score && (
            <div
              className={`px-6 pt-3 pb-1 flex items-center justify-between text-[11px] ${
                darkSheet ? 'text-zinc-500' : 'text-zinc-400'
              }`}
            >
              <span>Klicke eine Note zum Springen · Ziehe über Takte für A–B-Loop</span>
              <span className="hidden sm:inline font-mono tabular-nums">
                {score.masterBars.length} Takte · {effectiveBpm} BPM
                {effectiveBpm !== baseTempo ? ` (Original ${baseTempo} BPM)` : ''}
                {trainer.enabled
                  ? ` · Trainer ${trainer.startBpm}→${trainer.targetBpm} BPM`
                  : ''}
              </span>
            </div>
          )}

          {/* alphaTab SVG Mount Element */}
          <div
            ref={mountRef}
            className={`px-4 sm:px-8 pb-12 ${layoutMode === 'horizontal' ? 'min-h-[260px]' : ''}`}
          />
        </div>

        {/* Collapsible alphaTex Live Editor Drawer */}
        <AlphaTexDrawer
          isOpen={texDrawerOpen && !isEmbedMode}
          value={texCode}
          onChange={setTexCode}
          onApply={handleApplyTex}
          onReset={handleResetTex}
          onClose={() => onTexDrawerOpenChange(false)}
          errorMessage={texError}
        />

        {/* Drag & Drop Guitar Pro Overlay */}
        {isDraggingFile && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-blue-600/12 backdrop-blur-[2px] border-2 border-dashed border-blue-600 m-2 rounded-xl pointer-events-none">
            <div className="bg-white/95 text-zinc-900 px-6 py-5 rounded-xl shadow-lg border border-zinc-200 flex flex-col items-center gap-2 text-center">
              <Upload className="w-6 h-6 text-blue-600" />
              <p className="text-sm font-semibold">Guitar-Pro-Datei hier ablegen</p>
              <p className="text-xs text-zinc-500">
                Unterstützt .gp, .gp3, .gp4, .gp5, .gpx, .gp7, .gp8, MusicXML &amp; alphaTex
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Collapsible Live Fretboard Visualizer (above the dark transport dock) */}
      {showFretboard && primaryTrack && (
        <FretboardVisualizer
          tuning={primaryTrackTuning}
          trackName={primaryTrack.name}
          isPercussion={Boolean(primaryTrack.staves[0]?.isPercussion)}
          activeNotes={activeFretNotes}
          capo={primaryTrack.staves[0]?.capo ?? 0}
        />
      )}

      {/* Soundslice-Inspired Dark Bottom Transport & Practice Dock */}
      <div className="relative bg-[#14161A] text-zinc-100 border-t border-white/10 shrink-0 select-none">
        {/* Popover: Tracks, Mixer & Instrument Sound (incl. Electric Bass Fingerstyle) */}
        {activePopover === 'tracks' && score && (
          <div
            className="absolute bottom-full right-3 mb-2 w-[360px] max-w-[calc(100vw-24px)] bg-[#1A1D23] border border-white/12 rounded-xl shadow-2xl overflow-hidden z-30"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
              <span className="text-xs font-semibold text-zinc-100">
                Spuren, Mixer &amp; Instrumente ({score.tracks.length})
              </span>
              <div className="flex items-center gap-2">
                {score.tracks.length > 1 && (
                  <button
                    type="button"
                    onClick={handleShowAllTracks}
                    className="text-[11px] text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap"
                  >
                    Alle anzeigen
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActivePopover(null)}
                  className="p-1 text-zinc-400 hover:text-white rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-white/8 score-scroll">
              {score.tracks.map((track) => {
                const isVisible = selectedTrackIndexes.includes(track.index);
                const isPerc = Boolean(track.staves[0]?.isPercussion);
                const state = mixerState[track.index] ?? {
                  volume: 1,
                  muted: false,
                  solo: false,
                  transpose: 0,
                  program: track.playbackInfo.program,
                };
                const hasKnownPreset = INSTRUMENT_PRESETS.some(
                  (p) => p.program === state.program,
                );

                return (
                  <div
                    key={track.index}
                    className={`px-4 py-2.5 space-y-2 transition-colors ${
                      isVisible ? 'bg-blue-600/10' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isVisible}
                          onChange={() => handleToggleTrackVisibility(track.index)}
                          className="accent-blue-500 rounded cursor-pointer shrink-0"
                          title="Spur in der Partitur ein-/ausblenden"
                        />
                        <button
                          type="button"
                          onClick={() => handleSelectSingleTrack(track.index)}
                          className="text-left min-w-0 group"
                          title="Nur diese Spur anzeigen"
                        >
                          <div className="text-xs font-medium text-zinc-100 group-hover:text-blue-400 truncate">
                            {track.name}
                          </div>
                        </button>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleTrackSolo(track)}
                          className={`w-6 h-6 text-[11px] font-mono font-semibold rounded transition-colors ${
                            state.solo
                              ? 'bg-amber-500 text-zinc-950'
                              : 'bg-white/8 text-zinc-300 hover:bg-white/15'
                          }`}
                          title="Solo"
                        >
                          S
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleTrackMute(track)}
                          className={`w-6 h-6 text-[11px] font-mono font-semibold rounded transition-colors ${
                            state.muted
                              ? 'bg-red-500 text-white'
                              : 'bg-white/8 text-zinc-300 hover:bg-white/15'
                          }`}
                          title="Stumm"
                        >
                          M
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pl-5">
                      <div className="flex items-center gap-2 flex-1">
                        <Volume2 className="w-3 h-3 text-zinc-500 shrink-0" />
                        <input
                          type="range"
                          min={0}
                          max={2}
                          step={0.05}
                          value={state.volume}
                          onChange={(e) =>
                            handleTrackVolumeChange(track, parseFloat(e.target.value))
                          }
                          className="dock-range flex-1"
                          aria-label={`Lautstärke ${track.name}`}
                        />
                        <span className="text-[10px] font-mono tabular-nums text-zinc-400 w-8 text-right">
                          {Math.round(state.volume * 100)}%
                        </span>
                      </div>

                      {!isPerc && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleTrackTranspose(track, state.transpose - 1)}
                            className="w-5 h-5 rounded bg-white/8 hover:bg-white/15 text-xs text-zinc-200 flex items-center justify-center"
                            title="1 Halbton tiefer"
                          >
                            -
                          </button>
                          <span
                            className="text-[10px] font-mono tabular-nums text-zinc-300 w-7 text-center"
                            title="Transposition in Halbtönen"
                          >
                            {state.transpose > 0 ? `+${state.transpose}` : state.transpose}st
                          </span>
                          <button
                            type="button"
                            onClick={() => handleTrackTranspose(track, state.transpose + 1)}
                            className="w-5 h-5 rounded bg-white/8 hover:bg-white/15 text-xs text-zinc-200 flex items-center justify-center"
                            title="1 Halbton höher"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Per-Track Sound / Bass Fingerstyle Selector */}
                    {!isPerc && (
                      <div className="pl-5 pt-0.5">
                        <select
                          value={state.program}
                          onChange={(e) =>
                            handleTrackProgramChange(track, parseInt(e.target.value, 10))
                          }
                          className="w-full px-2 py-1 text-[11px] bg-black/35 border border-white/10 rounded-md text-zinc-200 focus:outline-none focus:border-blue-500"
                          aria-label={`Instrumentensound für ${track.name}`}
                        >
                          {!hasKnownPreset && (
                            <option value={state.program}>
                              Original-Instrument (GM #{state.program})
                            </option>
                          )}
                          {INSTRUMENT_PRESETS.map((preset) => (
                            <option key={preset.program} value={preset.program}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Popover: Direct BPM Input, Tempo, Count-In Mode & Tempo-Trainer */}
        {activePopover === 'speed' && (
          <div
            className="absolute bottom-full left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-24 mb-2 w-[330px] max-w-[calc(100vw-24px)] bg-[#1A1D23] border border-white/12 rounded-xl shadow-2xl p-4 space-y-4 z-30"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header + Segmented Tabs */}
            <div className="flex items-center justify-between gap-2">
              <div className="grid grid-cols-2 gap-1 p-1 bg-black/35 rounded-lg flex-1">
                <button
                  type="button"
                  onClick={() => setTempoTab('tempo')}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    tempoTab === 'tempo'
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Tempo &amp; BPM
                </button>
                <button
                  type="button"
                  onClick={() => setTempoTab('trainer')}
                  className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap inline-flex items-center justify-center gap-1 ${
                    tempoTab === 'trainer'
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  Tempo-Trainer
                </button>
              </div>
              <button
                type="button"
                onClick={() => setActivePopover(null)}
                className="p-1 text-zinc-400 hover:text-white rounded shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {tempoTab === 'tempo' ? (
              <div className="space-y-4">
                {/* Direct Numeric BPM Input + +/-5 Steppers */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-400">Tempo (BPM)</span>
                    <button
                      type="button"
                      onClick={() => handleSpeedChange(1)}
                      className="text-blue-400 hover:text-blue-300 font-mono tabular-nums"
                    >
                      Original: {baseTempo} BPM (100%)
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleBpmChange(effectiveBpm - 5)}
                      className="px-2.5 h-9 rounded-lg bg-white/8 hover:bg-white/15 text-xs font-mono tabular-nums text-zinc-200 shrink-0"
                      title="5 BPM langsamer"
                    >
                      -5
                    </button>
                    <div className="relative flex-1">
                      <input
                        type="number"
                        min={20}
                        max={320}
                        value={bpmInputText}
                        onChange={(e) => {
                          setBpmInputText(e.target.value);
                          const parsed = parseInt(e.target.value, 10);
                          if (Number.isFinite(parsed) && parsed >= 20 && parsed <= 320) {
                            handleBpmChange(parsed);
                          }
                        }}
                        onBlur={() => setBpmInputText(String(effectiveBpm))}
                        className="w-full h-9 pl-3 pr-12 rounded-lg bg-black/40 border border-white/15 text-sm font-mono font-semibold tabular-nums text-white focus:outline-none focus:border-blue-500"
                        aria-label="Tempo in BPM"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-zinc-400 pointer-events-none">
                        BPM
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleBpmChange(effectiveBpm + 5)}
                      className="px-2.5 h-9 rounded-lg bg-white/8 hover:bg-white/15 text-xs font-mono tabular-nums text-zinc-200 shrink-0"
                      title="5 BPM schneller"
                    >
                      +5
                    </button>
                  </div>
                </div>

                {/* Percentage Slider & Presets */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-400">Geschwindigkeit</span>
                    <span className="font-mono tabular-nums text-blue-400">
                      {Math.round(speed * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.25}
                    max={2}
                    step={0.05}
                    value={Math.min(2, Math.max(0.25, speed))}
                    onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                    className="dock-range w-full"
                    aria-label="Wiedergabegeschwindigkeit"
                  />
                  <div className="grid grid-cols-4 gap-1.5">
                    {SPEED_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleSpeedChange(preset)}
                        className={`py-1 text-[11px] font-mono tabular-nums rounded-md transition-colors ${
                          Math.abs(speed - preset) < 0.015
                            ? 'bg-blue-600 text-white font-semibold'
                            : 'bg-white/8 text-zinc-300 hover:bg-white/15'
                        }`}
                      >
                        {Math.round(preset * 100)}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Count-In Mode Selector (Off / First / Every Repeat) */}
                <div className="space-y-1.5 pt-2 border-t border-white/10">
                  <span className="block text-[11px] text-zinc-400">Einzähler (Count-in)</span>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-black/35 rounded-lg">
                    {(
                      [
                        ['off', 'Aus'],
                        ['first', '1× Start'],
                        ['always', 'Jeder Loop'],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setCountInMode(key)}
                        className={`py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                          countInMode === key
                            ? 'bg-blue-600 text-white'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Metronome Volume */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-400">Metronom-Lautstärke</span>
                    <span className="font-mono tabular-nums text-zinc-300">
                      {Math.round(metronomeVolume * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={metronomeVolume}
                    onChange={(e) => handleMetronomeVolumeChange(parseFloat(e.target.value))}
                    className="dock-range w-full"
                    aria-label="Metronom-Lautstärke"
                  />
                </div>
              </div>
            ) : (
              /* Tempo-Trainer Panel */
              <div className="space-y-3.5">
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Steigert das Tempo automatisch nach jeder Loop-Wiederholung. Ziehe im Notenblatt einen A–B-Bereich auf oder trainiere das ganze Stück.
                </p>

                {/* Start BPM & Target BPM */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Start-BPM ({Math.round((trainer.startBpm / baseTempo) * 100)}%)
                    </label>
                    <input
                      type="number"
                      min={20}
                      max={300}
                      value={trainer.startBpm}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (Number.isFinite(val)) {
                          setTrainer((prev) => ({
                            ...prev,
                            startBpm: Math.max(20, Math.min(300, val)),
                          }));
                        }
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/15 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Ziel-BPM ({Math.round((trainer.targetBpm / baseTempo) * 100)}%)
                    </label>
                    <input
                      type="number"
                      min={20}
                      max={320}
                      value={trainer.targetBpm}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (Number.isFinite(val)) {
                          setTrainer((prev) => ({
                            ...prev,
                            targetBpm: Math.max(20, Math.min(320, val)),
                          }));
                        }
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/15 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Step BPM & Repeat Every N Loops */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Steigerung (+BPM)
                    </label>
                    <div className="grid grid-cols-3 gap-1">
                      {[2, 5, 10].map((step) => (
                        <button
                          key={step}
                          type="button"
                          onClick={() => setTrainer((prev) => ({...prev, stepBpm: step}))}
                          className={`py-1.5 text-[11px] font-mono tabular-nums rounded-md transition-colors ${
                            trainer.stepBpm === step
                              ? 'bg-blue-600 text-white font-semibold'
                              : 'bg-white/8 text-zinc-300 hover:bg-white/15'
                          }`}
                        >
                          +{step}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Alle N Loops
                    </label>
                    <div className="grid grid-cols-3 gap-1">
                      {[1, 2, 4].map((rep) => (
                        <button
                          key={rep}
                          type="button"
                          onClick={() => setTrainer((prev) => ({...prev, repeatEvery: rep}))}
                          className={`py-1.5 text-[11px] font-mono tabular-nums rounded-md transition-colors ${
                            trainer.repeatEvery === rep
                              ? 'bg-blue-600 text-white font-semibold'
                              : 'bg-white/8 text-zinc-300 hover:bg-white/15'
                          }`}
                        >
                          {rep}×
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Repeat Count-in checkbox inside Trainer */}
                <label className="flex items-center gap-2 text-xs text-zinc-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={countInMode === 'always'}
                    onChange={(e) => setCountInMode(e.target.checked ? 'always' : 'first')}
                    className="accent-blue-500 rounded"
                  />
                  Einzähler vor jeder Wiederholung (neues Tempo vorhören)
                </label>

                {trainer.enabled && (
                  <div className="px-3 py-2 rounded-lg bg-blue-600/15 border border-blue-500/30 text-[11px] font-mono tabular-nums text-blue-200 flex items-center justify-between">
                    <span>Aktiv · Durchlauf {trainer.completedLoops + 1}</span>
                    <span>
                      {effectiveBpm} / {trainer.targetBpm} BPM
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={!isPlayerReady}
                    onClick={handleStartTempoTrainer}
                    className="flex-1 py-2 px-3 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-white/10 disabled:text-zinc-500 rounded-lg transition-colors whitespace-nowrap"
                  >
                    {trainer.enabled ? 'Neu starten' : 'Trainer starten'}
                  </button>
                  <button
                    type="button"
                    onClick={handleResetTempoTrainer}
                    className="py-2 px-3 text-xs font-medium text-zinc-300 bg-white/8 hover:bg-white/15 rounded-lg transition-colors whitespace-nowrap"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Popover: View Settings & Studio SoundFont Selector */}
        {activePopover === 'view' && (
          <div
            className="absolute bottom-full right-3 mb-2 w-80 max-w-[calc(100vw-24px)] bg-[#1A1D23] border border-white/12 rounded-xl shadow-2xl p-4 space-y-4 z-30 max-h-[75vh] overflow-y-auto score-scroll"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-100">
                SoundFont &amp; Ansicht
              </span>
              <button
                type="button"
                onClick={() => setActivePopover(null)}
                className="p-1 text-zinc-400 hover:text-white rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Studio SoundFont Selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-zinc-300 font-medium">
                  <AudioLines className="w-3.5 h-3.5 text-blue-400" />
                  SoundFont (Audio-Qualität)
                </span>
                {isSwitchingSoundFont && (
                  <span className="font-mono tabular-nums text-blue-400">
                    Lädt {soundFontProgress}%
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {SOUNDFONT_OPTIONS.map((sf) => {
                  const isSelected = activeSoundFont === sf.id;
                  return (
                    <button
                      key={sf.id}
                      type="button"
                      onClick={() => handleSelectSoundFont(sf.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left transition-colors ${
                        isSelected
                          ? 'bg-blue-600/25 border border-blue-500/50 text-white'
                          : 'bg-white/5 border border-transparent text-zinc-300 hover:bg-white/10'
                      }`}
                    >
                      <span className="text-xs font-medium">{sf.name}</span>
                      <span className="text-[10px] font-mono tabular-nums text-zinc-400">
                        {sf.hint}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => soundFontInputRef.current?.click()}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-[11px] transition-colors ${
                    activeSoundFont === 'custom'
                      ? 'bg-blue-600/25 border border-blue-500/50 text-white'
                      : 'bg-white/5 border border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
                  }`}
                >
                  <span className="truncate">
                    {customSoundFontName
                      ? `Eigener: ${customSoundFontName}`
                      : 'Eigene .sf2 / .sf3 Datei laden…'}
                  </span>
                  <Upload className="w-3 h-3 shrink-0 ml-2" />
                </button>
              </div>
            </div>

            <div className="border-t border-white/10 pt-3 space-y-3">
              {/* Layout */}
              <div className="space-y-1.5">
                <span className="block text-[11px] text-zinc-400">Layout</span>
                <div className="grid grid-cols-2 gap-1 p-1 bg-black/30 rounded-lg">
                  <button
                    type="button"
                    onClick={() => handleLayoutChange('page')}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                      layoutMode === 'page'
                        ? 'bg-blue-600 text-white'
                        : 'text-zinc-300 hover:text-white'
                    }`}
                  >
                    Seite
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLayoutChange('horizontal')}
                    className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                      layoutMode === 'horizontal'
                        ? 'bg-blue-600 text-white'
                        : 'text-zinc-300 hover:text-white'
                    }`}
                  >
                    Horizontal
                  </button>
                </div>
              </div>

              {/* Stave Profile */}
              <div className="space-y-1.5">
                <span className="block text-[11px] text-zinc-400">Notation</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ['default', 'Automatisch'],
                      ['scoretab', 'Noten + Tab'],
                      ['tab', 'Nur Tabulatur'],
                      ['score', 'Nur Noten'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleStaveProfileChange(key)}
                      className={`py-1.5 px-2 text-xs rounded-md transition-colors ${
                        staveProfile === key
                          ? 'bg-blue-600 text-white font-medium'
                          : 'bg-white/8 text-zinc-300 hover:bg-white/15'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Zoom */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-400">Zoom</span>
                  <span className="font-mono tabular-nums text-zinc-200">
                    {Math.round(zoom * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={1.5}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                  className="dock-range w-full"
                  aria-label="Zoomfaktor"
                />
              </div>

              {/* Auto-scroll */}
              <div className="space-y-1.5">
                <span className="block text-[11px] text-zinc-400">Auto-Scroll</span>
                <div className="grid grid-cols-3 gap-1 p-1 bg-black/30 rounded-lg">
                  {(
                    [
                      ['continuous', 'Fließend'],
                      ['offscreen', 'Seite'],
                      ['off', 'Aus'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleScrollModeChange(key)}
                      className={`py-1 text-[11px] font-medium rounded-md transition-colors ${
                        scrollMode === key
                          ? 'bg-white/15 text-white'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dark sheet + Print */}
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={handleToggleDarkSheet}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-200 bg-white/8 hover:bg-white/15 rounded-md transition-colors"
                >
                  {darkSheet ? (
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <Moon className="w-3.5 h-3.5" />
                  )}
                  {darkSheet ? 'Helles Papier' : 'Nachtmodus'}
                </button>
                <button
                  type="button"
                  onClick={() => apiRef.current?.print()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-200 bg-white/8 hover:bg-white/15 rounded-md transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Drucken
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Full-Width Interactive Progress Scrubber along the top edge of the dock */}
        <div
          onClick={handleSeekBarClick}
          className="relative h-2 w-full bg-white/10 cursor-pointer group hover:h-2.5 transition-[height]"
          role="slider"
          aria-label="Wiedergabeposition"
          aria-valuemin={0}
          aria-valuemax={Math.round(endTimeMs / 1000)}
          aria-valuenow={Math.round(currentTimeMs / 1000)}
        >
          {/* A-B Loop Range Highlight */}
          {playbackRange && (
            <div
              className="absolute top-0 bottom-0 bg-amber-400/45 border-x border-amber-300"
              style={{left: `${rangeStartPct}%`, width: `${rangeWidthPct}%`}}
            />
          )}
          {/* Playhead Fill */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-blue-500 transition-[width] duration-75"
            style={{width: `${progressPercent}%`}}
          />
        </div>

        {/* Main Transport Controls Row */}
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 h-14">
          {/* Left: Play/Pause, Stop, Loop, Timecode */}
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <button
              type="button"
              onClick={handlePlayPause}
              disabled={!isPlayerReady}
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                isPlayerReady
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-white/10 text-zinc-500 cursor-wait'
              }`}
              title={
                isPlayerReady
                  ? isPlaying
                    ? 'Pause (Leertaste)'
                    : 'Abspielen (Leertaste)'
                  : `SoundFont lädt (${soundFontProgress}%)`
              }
              aria-label={isPlaying ? 'Pause' : 'Abspielen'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={handleStop}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              title="An den Anfang"
              aria-label="An den Anfang"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleToggleLoop}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                isLooping
                  ? 'bg-blue-600/25 text-blue-400 hover:bg-blue-600/35'
                  : 'text-zinc-300 hover:text-white hover:bg-white/10'
              }`}
              title="Schleife ein/aus (L)"
              aria-label="Schleife umschalten"
            >
              <Repeat className="w-4 h-4" />
            </button>

            {playbackRange && (
              <button
                type="button"
                onClick={handleClearRange}
                className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-amber-300 hover:text-amber-200 bg-amber-500/15 rounded-md whitespace-nowrap shrink-0"
                title="A–B-Auswahl aufheben (Esc)"
              >
                A–B
                <X className="w-3 h-3" />
              </button>
            )}

            <div className="pl-1 flex items-center gap-1.5 text-xs font-mono tabular-nums text-zinc-300 whitespace-nowrap shrink-0">
              <span>{formatTime(currentTimeMs)}</span>
              <span className="text-zinc-600">/</span>
              <span className="text-zinc-400">{formatTime(endTimeMs)}</span>
            </div>

            {(!isPlayerReady || isSwitchingSoundFont) && (
              <span className="hidden md:inline text-[11px] text-blue-300 font-mono tabular-nums whitespace-nowrap">
                · SoundFont {soundFontProgress}%
              </span>
            )}
          </div>

          {/* Center / Right: BPM & Tempo-Trainer, Metronome (custom icon!), Count-In (1x / Jeder Loop), Volume, Fretboard, Mixer, SoundFont/View, Fullscreen */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {/* BPM + Tempo-Trainer Button */}
            <button
              type="button"
              onClick={() => setActivePopover((prev) => (prev === 'speed' ? null : 'speed'))}
              className={`h-9 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-xs font-mono tabular-nums transition-colors whitespace-nowrap shrink-0 ${
                activePopover === 'speed' || trainer.enabled || Math.abs(speed - 1) > 0.01
                  ? 'bg-blue-600/25 text-blue-300 hover:bg-blue-600/35'
                  : 'text-zinc-200 hover:bg-white/10'
              }`}
              title="BPM als Zahl eingeben & Tempo-Trainer öffnen (Pfeil hoch/runter ±5 BPM)"
            >
              {trainer.enabled ? (
                <TrendingUp className="w-3.5 h-3.5 shrink-0 text-blue-400" />
              ) : (
                <Gauge className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="font-semibold">{effectiveBpm} BPM</span>
              <span className="hidden sm:inline text-zinc-400">
                {trainer.enabled
                  ? `→ ${trainer.targetBpm}`
                  : `(${Math.round(speed * 100)}%)`}
              </span>
            </button>

            {/* Custom Pyramid Metronome Button */}
            <button
              type="button"
              onClick={handleToggleMetronome}
              className={`h-9 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                metronomeOn
                  ? 'bg-blue-600/25 text-blue-300 hover:bg-blue-600/35'
                  : 'text-zinc-300 hover:text-white hover:bg-white/10'
              }`}
              title="Metronom ein/aus (M)"
              aria-label="Metronom"
            >
              <MetronomeIcon
                className="w-4 h-4 shrink-0"
                tickRight={metronomeOn && isPlaying ? metronomeTickRight : true}
              />
              <span className="hidden xl:inline">Metronom</span>
            </button>

            {/* 3-State Count-In Button (Aus / 1× Start / Jeder Loop) */}
            <button
              type="button"
              onClick={handleCycleCountIn}
              className={`h-9 px-2.5 rounded-lg hidden md:inline-flex items-center gap-1.5 text-xs font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
                countInMode !== 'off'
                  ? 'bg-blue-600/25 text-blue-300 hover:bg-blue-600/35'
                  : 'text-zinc-400 hover:text-white hover:bg-white/10'
              }`}
              title={`Einzähler (C): ${countInLabel} — Klicken zum Wechseln (Aus / 1× am Anfang / Bei jeder Wiederholung)`}
            >
              <span>1-2-3-4</span>
              <span className="text-[10px] font-sans opacity-80">
                {countInMode === 'always' ? '∞' : countInMode === 'first' ? '1×' : ''}
              </span>
            </button>

            {/* Master Volume */}
            <div className="hidden 2xl:flex items-center gap-1.5 px-1.5">
              <button
                type="button"
                onClick={handleToggleMasterMute}
                className="p-1.5 text-zinc-300 hover:text-white rounded"
                aria-label={isMasterMuted ? 'Ton einschalten' : 'Stummschalten'}
              >
                {isMasterMuted || masterVolume === 0 ? (
                  <VolumeX className="w-4 h-4 text-zinc-500" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMasterMuted ? 0 : masterVolume}
                onChange={(e) => handleMasterVolumeChange(parseFloat(e.target.value))}
                className="dock-range w-16"
                aria-label="Gesamtlautstärke"
              />
            </div>

            <div className="w-px h-5 bg-white/10 mx-0.5 hidden sm:block" />

            {/* Live Fretboard Toggle */}
            <button
              type="button"
              onClick={() => setShowFretboard((prev) => !prev)}
              className={`h-9 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                showFretboard
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-300 hover:text-white hover:bg-white/10'
              }`}
              title="Live-Griffbrett ein-/ausblenden"
            >
              <Guitar className="w-4 h-4 shrink-0" />
              <span className="hidden lg:inline">Griffbrett</span>
            </button>

            {/* Track Mixer & Bass Sound Button */}
            <button
              type="button"
              onClick={() => setActivePopover((prev) => (prev === 'tracks' ? null : 'tracks'))}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                activePopover === 'tracks'
                  ? 'bg-white/15 text-white'
                  : 'text-zinc-300 hover:text-white hover:bg-white/10'
              }`}
              title="Spuren, Mixer & Instrumentensound (inkl. Bass Fingerstyle)"
              aria-label="Spuren und Mixer"
            >
              <Layers className="w-4 h-4" />
            </button>

            {/* SoundFont & View Settings Button */}
            <button
              type="button"
              onClick={() => setActivePopover((prev) => (prev === 'view' ? null : 'view'))}
              className={`h-9 px-2 rounded-lg inline-flex items-center gap-1.5 text-xs transition-colors shrink-0 ${
                activePopover === 'view' || activeSoundFont !== 'sonivox'
                  ? 'bg-white/15 text-white'
                  : 'text-zinc-300 hover:text-white hover:bg-white/10'
              }`}
              title="SoundFont (FluidR3 Studio / MuseScore HD) & Ansicht"
              aria-label="SoundFont und Ansicht"
            >
              <SlidersHorizontal className="w-4 h-4 shrink-0" />
              {activeSoundFont !== 'sonivox' && (
                <span className="hidden xl:inline text-[11px] text-blue-300 font-medium">
                  {activeSoundFont === 'fluidr3'
                    ? 'FluidR3'
                    : activeSoundFont === 'musescore'
                      ? 'HD'
                      : 'SF'}
                </span>
              )}
            </button>

            {/* Fullscreen Button */}
            <button
              type="button"
              onClick={handleToggleFullscreen}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              title={isFullscreen ? 'Vollbild verlassen' : 'Vollbild'}
              aria-label="Vollbild umschalten"
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
