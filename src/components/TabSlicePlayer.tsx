import * as alphaTab from '@coderline/alphatab';
import {
  AudioLines,
  ChevronDown,
  CloudUpload,
  Columns2,
  FileAudio,
  FolderOpen,
  Gauge,
  Guitar,
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  Printer,
  Repeat,
  RotateCcw,
  Rows3,
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
import {AudioSyncPoint, extractAudioSyncPoints, synthTimeToAudioTime} from '../lib/audioSync';
import {disableIosPlaybackAudio, enableIosPlaybackAudio, isIosLike} from '../lib/iosAudio';
import {MidiReloadCoordinator} from '../lib/midiReload';
import {
  CountInModeParam,
  SliceRecord,
  SoundFontPresetId,
  StaveModeParam,
} from '../types/slice';
import {ActiveFretNote, FretboardVisualizer} from './FretboardVisualizer';
import {MetronomeIcon} from './MetronomeIcon';

export type SoundFontId = SoundFontPresetId | 'custom';
export type CountInMode = CountInModeParam;

export interface TabSlicePlayerProps {
  /** True when rendered via /slices/:id/embed/ or ?embed=1 inside an iframe */
  isEmbedMode: boolean;
  /** Optional server-hosted slice to load from /api/slices/:id/file */
  activeSlice?: SliceRecord | null;
  /** Optional remote Guitar Pro / MusicXML / alphaTex file URL (?file=...) */
  initialFileUrl?: string | null;
  /** Built-in fallback demo id */
  demoId: string;
  /** Callback when user wants to publish a locally dropped file to the server */
  onPublishLocalFile?: (file: File) => void;
  /** Initial iframe / player options */
  initialShowHeader?: boolean;
  initialLayout?: 'page' | 'horizontal';
  initialStaveProfile?: StaveModeParam;
  initialFretboard?: boolean;
  initialMetronome?: boolean;
  initialCountIn?: CountInMode;
  initialLoop?: boolean;
  initialSpeed?: number;
  initialSoundFont?: SoundFontPresetId;
  initialDark?: boolean;
  /** Studio preview toggle (500px iframe frame) */
  embedPreviewMode?: boolean;
  onToggleEmbedPreview?: () => void;
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

interface AudioTrackState {
  url: string | null;
  name: string;
  source: 'embedded' | 'custom' | null;
  volume: number; // 0..1
  muted: boolean;
  solo: boolean;
  offsetMs: number;
}

type PopoverType = 'tracks' | 'speed' | 'view' | null;

const ACCEPTED_EXTENSIONS = '.gp,.gp3,.gp4,.gp5,.gpx,.gp7,.gp8,.xml,.musicxml,.mxl,.cap,.tex';
const SPEED_PRESETS = [0.5, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5];
const SOUNDFONT_STORAGE_KEY = 'tabslice:soundfont:v2';

const SOUNDFONT_OPTIONS: Array<{
  id: SoundFontPresetId;
  name: string;
  hint: string;
  url: string;
  fallbackUrl?: string;
}> = [
  {
    id: 'generaluser',
    name: 'GeneralUser GS 2.0.3',
    hint: 'Standard · 30,8 MB · CDN',
    // Fastly-backed GitHub raw; CORS enabled, so the browser loads it directly
    // instead of streaming 30 MB through the NAS.
    url: 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2',
    fallbackUrl: '/api/soundfonts/generaluser',
  },
  {
    id: 'fluidr3',
    name: 'FluidR3 GM (Studio)',
    hint: 'Alternative · 22 MB · CDN',
    url: 'https://raw.githubusercontent.com/musescore/MuseScore/v3.6.2/share/sound/FluidR3Mono_GM.sf3',
    fallbackUrl: '/api/soundfonts/fluidr3',
  },
  {
    id: 'musescore',
    name: 'MuseScore General HD',
    hint: 'Konzert · 38 MB · CDN',
    url: 'https://huggingface.co/MuScriptor/assets/resolve/main/MuseScore_General.sf3',
    fallbackUrl: '/api/soundfonts/musescore',
  },
  {
    id: 'sonivox',
    name: 'Sonivox Kompakt',
    hint: 'Schnell · 1,3 MB · CDN',
    url: 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.9.0/dist/soundfont/sonivox.sf2',
    fallbackUrl: `${import.meta.env.BASE_URL}soundfont/sonivox.sf2`,
  },
];

const INSTRUMENT_PRESETS: Array<{program: number; label: string}> = [
  {program: 33, label: 'E-Bass (Fingerstyle)'},
  {program: 34, label: 'E-Bass (Plektrum / Pick)'},
  {program: 35, label: 'Fretless Bass'},
  {program: 36, label: 'Slap Bass'},
  {program: 32, label: 'Akustik- / Kontrabass'},
  {program: 25, label: 'Akustikgitarre (Stahl)'},
  {program: 24, label: 'Akustikgitarre (Nylon)'},
  {program: 26, label: 'E-Gitarre (Jazz)'},
  {program: 27, label: 'E-Gitarre (Clean)'},
  {program: 28, label: 'E-Gitarre (Muted)'},
  {program: 29, label: 'E-Gitarre (Overdrive)'},
  {program: 30, label: 'E-Gitarre (Distortion)'},
  {program: 0, label: 'Klavier (Acoustic Grand)'},
];

function getInitialSoundFont(paramSf?: SoundFontPresetId): SoundFontId {
  if (
    paramSf === 'generaluser' ||
    paramSf === 'fluidr3' ||
    paramSf === 'musescore' ||
    paramSf === 'sonivox'
  ) {
    return paramSf;
  }
  try {
    const saved = window.localStorage.getItem(SOUNDFONT_STORAGE_KEY);
    if (
      saved === 'generaluser' ||
      saved === 'fluidr3' ||
      saved === 'musescore' ||
      saved === 'sonivox'
    ) {
      return saved;
    }
  } catch {
    // Ignore restricted iframe storage
  }
  // iPhones/iPads have less memory and slower networks; the compact 1.3 MB
  // Sonivox bank starts playing almost instantly there.
  return isIosLike() ? 'sonivox' : 'generaluser';
}

function getSoundFontUrl(id: SoundFontId): string {
  const found = SOUNDFONT_OPTIONS.find((opt) => opt.id === id);
  return found ? found.url : SOUNDFONT_OPTIONS[0].url;
}

function getSoundFontFallbackUrl(id: SoundFontId): string | null {
  if (id === 'custom') return null;
  return SOUNDFONT_OPTIONS.find((opt) => opt.id === id)?.fallbackUrl ?? null;
}

function getSoundFontLabel(id: SoundFontId, customName: string | null): string {
  if (id === 'custom' && customName) return customName;
  return SOUNDFONT_OPTIONS.find((opt) => opt.id === id)?.name || 'GeneralUser GS 2.0.3';
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

function applyScoreHeaderVisibility(settings: alphaTab.Settings, visible: boolean) {
  settings.notation.elements.set(alphaTab.NotationElement.ScoreTitle, visible);
  settings.notation.elements.set(alphaTab.NotationElement.ScoreSubTitle, visible);
  settings.notation.elements.set(alphaTab.NotationElement.ScoreArtist, visible);
  settings.notation.elements.set(alphaTab.NotationElement.ScoreAlbum, visible);
}

function mapStaveProfile(profile: StaveModeParam): alphaTab.StaveProfile {
  switch (profile) {
    case 'scoretab':
      return alphaTab.StaveProfile.ScoreTab;
    case 'tab':
      return alphaTab.StaveProfile.Tab;
    case 'score':
      return alphaTab.StaveProfile.Score;
    default:
      return alphaTab.StaveProfile.Default;
  }
}

export const TabSlicePlayer: React.FC<TabSlicePlayerProps> = ({
  isEmbedMode,
  activeSlice = null,
  initialFileUrl,
  demoId,
  onPublishLocalFile,
  initialShowHeader = true,
  initialLayout = 'page',
  initialStaveProfile = 'default',
  initialFretboard = false,
  initialMetronome = false,
  initialCountIn = 'first',
  initialLoop = false,
  initialSpeed = 1,
  initialSoundFont,
  initialDark = false,
  embedPreviewMode = false,
  onToggleEmbedPreview,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const soundFontInputRef = useRef<HTMLInputElement>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const midiReloadRef = useRef<MidiReloadCoordinator | null>(null);
  const selectedTrackIndexesRef = useRef<number[]>([0]);
  const repeatRestartTimerRef = useRef<number | null>(null);

  // Score & track state
  const [score, setScore] = useState<alphaTab.model.Score | null>(null);
  const [selectedTrackIndexes, setSelectedTrackIndexes] = useState<number[]>([0]);
  const [mixerState, setMixerState] = useState<Record<number, TrackMixerState>>({});
  const [sourceLabel, setSourceLabel] = useState<string>('alphaTab');
  const [isLoadingScore, setIsLoadingScore] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Dedicated Audio-Spur / Backing Track state (embedded GP7/8 audio OR user MP3/WAV/OGG)
  const [audioTrack, setAudioTrack] = useState<AudioTrackState>({
    url: null,
    name: '',
    source: null,
    volume: 0.85,
    muted: false,
    solo: false,
    offsetMs: 0,
  });
  const [embeddedSyncPointCount, setEmbeddedSyncPointCount] = useState<number>(0);
  const audioSyncPointsRef = useRef<AudioSyncPoint[]>([]);

  // SoundFont & playback state
  const [activeSoundFont, setActiveSoundFont] = useState<SoundFontId>(() =>
    getInitialSoundFont(initialSoundFont),
  );
  const [customSoundFontName, setCustomSoundFontName] = useState<string | null>(null);
  const [soundFontProgress, setSoundFontProgress] = useState<number>(0);
  const [isSwitchingSoundFont, setIsSwitchingSoundFont] = useState<boolean>(false);
  const activeSoundFontRef = useRef<SoundFontId>(activeSoundFont);
  const soundFontFallbackTriedRef = useRef<boolean>(false);
  const [isPlayerReady, setIsPlayerReady] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [endTimeMs, setEndTimeMs] = useState<number>(0);
  const [endTick, setEndTick] = useState<number>(0);
  const [playbackRange, setPlaybackRange] = useState<{startTick: number; endTick: number} | null>(
    null,
  );

  // Practice controls: Speed, BPM, Tempo-Trainer, Metronome, Count-in
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

  const [isLooping, setIsLooping] = useState<boolean>(initialLoop);
  const [metronomeOn, setMetronomeOn] = useState<boolean>(initialMetronome);
  const [metronomeVolume, setMetronomeVolume] = useState<number>(0.85);
  const [metronomeTickRight, setMetronomeTickRight] = useState<boolean>(true);
  const [countInMode, setCountInMode] = useState<CountInMode>(initialCountIn);
  const [masterVolume, setMasterVolume] = useState<number>(1);
  const [isMasterMuted, setIsMasterMuted] = useState<boolean>(false);

  // Display / View settings
  const [showHeader, setShowHeader] = useState<boolean>(initialShowHeader);
  const [layoutMode, setLayoutMode] = useState<'page' | 'horizontal'>(initialLayout);
  const [staveProfile, setStaveProfile] = useState<StaveModeParam>(initialStaveProfile);
  const [zoom, setZoom] = useState<number>(1.0);
  const [scrollMode, setScrollMode] = useState<'continuous' | 'offscreen' | 'off'>('continuous');
  const [darkSheet, setDarkSheet] = useState<boolean>(initialDark);
  const [showFretboard, setShowFretboard] = useState<boolean>(initialFretboard);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [activePopover, setActivePopover] = useState<PopoverType>(null);

  // Drag & drop Guitar Pro local draft
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [localDraftFile, setLocalDraftFile] = useState<File | null>(null);

  // Active fretboard notes synced from alphaTab activeBeatsChanged
  const [activeFretNotes, setActiveFretNotes] = useState<ActiveFretNote[]>([]);

  // Live refs for event callbacks
  const scoreRef = useRef<alphaTab.model.Score | null>(null);
  const speedRef = useRef<number>(speed);
  const isLoopingRef = useRef<boolean>(isLooping);
  const countInModeRef = useRef<CountInMode>(countInMode);
  const metronomeOnRef = useRef<boolean>(metronomeOn);
  const metronomeVolRef = useRef<number>(metronomeVolume);
  const trainerRef = useRef<TempoTrainerConfig>(trainer);
  const playbackRangeRef = useRef<{startTick: number; endTick: number} | null>(playbackRange);
  const audioTrackRef = useRef<AudioTrackState>(audioTrack);
  const masterVolumeRef = useRef<number>(masterVolume);
  const isMasterMutedRef = useRef<boolean>(isMasterMuted);
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
    metronomeOnRef.current = metronomeOn;
  }, [metronomeOn]);
  useEffect(() => {
    metronomeVolRef.current = metronomeVolume;
  }, [metronomeVolume]);
  useEffect(() => {
    trainerRef.current = trainer;
  }, [trainer]);
  useEffect(() => {
    playbackRangeRef.current = playbackRange;
  }, [playbackRange]);
  useEffect(() => {
    audioTrackRef.current = audioTrack;
  }, [audioTrack]);
  useEffect(() => {
    masterVolumeRef.current = masterVolume;
  }, [masterVolume]);
  useEffect(() => {
    isMasterMutedRef.current = isMasterMuted;
  }, [isMasterMuted]);

  const baseTempo = score?.tempo || 120;
  const effectiveBpm = Math.max(15, Math.round(baseTempo * speed));

  useEffect(() => {
    setBpmInputText(String(effectiveBpm));
  }, [effectiveBpm]);

  // Sync HTMLAudioElement backing track volume, mute, playbackRate
  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio) return;
    const effectiveMaster = isMasterMuted ? 0 : masterVolume;
    audio.volume = Math.max(0, Math.min(1, audioTrack.volume * effectiveMaster));
    audio.muted = audioTrack.muted || isMasterMuted;
    audio.playbackRate = Math.min(2, Math.max(0.25, speed));
    const audioAny = audio as HTMLAudioElement & {
      preservesPitch?: boolean;
      webkitPreservesPitch?: boolean;
    };
    if (typeof audioAny.preservesPitch === 'boolean') audioAny.preservesPitch = true;
    if (typeof audioAny.webkitPreservesPitch === 'boolean') audioAny.webkitPreservesPitch = true;
  }, [audioTrack.volume, audioTrack.muted, masterVolume, isMasterMuted, speed]);

  // Revoke previous Blob URLs when audioTrack changes or component unmounts
  useEffect(() => {
    const currentUrl = audioTrack.url;
    return () => {
      if (currentUrl && currentUrl.startsWith('blob:')) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [audioTrack.url]);

  const syncAudioTrackToTime = useCallback(
    (timeMs: number, shouldPlay: boolean, songEndMs: number) => {
      const audio = audioElRef.current;
      const track = audioTrackRef.current;
      if (!audio || !track.url) return;

      // Embedded Guitar Pro backing tracks carry sync points that map the score
      // timeline to the audio file. Custom audio tracks play 1:1.
      let audioTimeMs = timeMs;
      if (track.source === 'embedded' && audioSyncPointsRef.current.length > 0) {
        audioTimeMs = synthTimeToAudioTime(timeMs, audioSyncPointsRef.current, {
          speed: speedRef.current,
          songEndTime: songEndMs * speedRef.current,
          audioDuration: Number.isFinite(audio.duration) ? audio.duration * 1000 : 0,
        });
      }

      const targetSec = Math.max(0, (audioTimeMs + track.offsetMs) / 1000);
      if (Math.abs(audio.currentTime - targetSec) > 0.14) {
        try {
          audio.currentTime = targetSec;
        } catch {
          // Ignore seek before metadata loaded
        }
      }
      if (shouldPlay && audio.paused) {
        audio.play().catch(() => {});
      } else if (!shouldPlay && !audio.paused) {
        audio.pause();
      }
    },
    [],
  );

  const syncSynthLoopAndCountIn = useCallback((loopEnabled: boolean, mode: CountInMode) => {
    const api = apiRef.current;
    if (!api) return;
    api.countInVolume = mode === 'off' ? 0 : 1;
    api.isLooping = loopEnabled && mode !== 'always';
  }, []);

  useEffect(() => {
    syncSynthLoopAndCountIn(isLooping, countInMode);
  }, [isLooping, countInMode, syncSynthLoopAndCountIn]);

  const clearPendingRepeatRestart = useCallback(() => {
    if (repeatRestartTimerRef.current !== null) {
      window.clearTimeout(repeatRestartTimerRef.current);
      repeatRestartTimerRef.current = null;
    }
  }, []);

  // Load binary or text Guitar Pro / MusicXML / alphaTex file
  const loadLocalFile = useCallback(
    (file: File) => {
      const api = apiRef.current;
      if (!api) return;
      clearPendingRepeatRestart();
      midiReloadRef.current?.cancel();
      audioElRef.current?.pause();
      setErrorBanner(null);
      setIsLoadingScore(true);
      setLocalDraftFile(file);

      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'tex') {
        const reader = new FileReader();
        reader.onload = () => {
          const text = typeof reader.result === 'string' ? reader.result : '';
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

  // Load remote file URL (/api/slices/:id/file or ?file=...)
  const loadRemoteUrl = useCallback(
    async (url: string, labelOverride?: string, extHint?: string) => {
      const api = apiRef.current;
      if (!api) return;
      clearPendingRepeatRestart();
      midiReloadRef.current?.cancel();
      audioElRef.current?.pause();
      setErrorBanner(null);
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
          `Datei konnte nicht geladen werden (${msg}). Prüfe URL/Server oder lade eine Guitar-Pro-Datei hoch.`,
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
    settings.display.staveProfile = mapStaveProfile(initialStaveProfile);
    settings.display.scale = 1.0;
    applySheetColors(settings, initialDark);
    applyScoreHeaderVisibility(settings, initialShowHeader);

    // Use Synthesizer mode so MIDI tracks remain individually mixable alongside our synchronized Audio-Spur!
    settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
    settings.player.enableCursor = true;
    settings.player.enableUserInteraction = true;
    settings.player.soundFont = getSoundFontUrl(initialSfId);
    settings.player.scrollElement = scrollEl;
    settings.player.scrollMode = alphaTab.ScrollMode.Continuous;
    settings.player.scrollOffsetY = -28;

    const api = new alphaTab.AlphaTabApi(mountEl, settings);
    apiRef.current = api;
    const midiReload = new MidiReloadCoordinator(api);
    midiReloadRef.current = midiReload;

    api.soundFontLoad.on((e) => {
      if (e.total > 0) {
        setSoundFontProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    api.soundFontLoaded.on(() => {
      setSoundFontProgress(100);
      setIsSwitchingSoundFont(false);
    });

    api.player?.soundFontLoadFailed.on((err: Error) => {
      // A CDN can be blocked (corporate network, outage, CORS proxy). Retry the
      // same bank from the local server cache once before giving up.
      const sfId = activeSoundFontRef.current;
      const fallbackUrl = getSoundFontFallbackUrl(sfId);
      if (fallbackUrl && !soundFontFallbackTriedRef.current) {
        soundFontFallbackTriedRef.current = true;
        setSoundFontProgress(0);
        setIsSwitchingSoundFont(true);
        setErrorBanner(null);
        api.loadSoundFont(fallbackUrl, false);
        return;
      }
      setIsSwitchingSoundFont(false);
      setErrorBanner(
        `SoundFont konnte nicht geladen werden${err?.message ? ` (${err.message})` : ''}.`,
      );
    });

    api.playerReady.on(() => {
      setIsPlayerReady(true);
      api.playbackSpeed = Math.min(2, Math.max(0.25, initialSpeed));
      api.countInVolume = countInModeRef.current === 'off' ? 0 : 1;
      api.metronomeVolume = metronomeOnRef.current ? metronomeVolRef.current : 0;
      api.isLooping = isLoopingRef.current && countInModeRef.current !== 'always';
    });

    api.scoreLoaded.on((loadedScore) => {
      setScore(loadedScore);
      setIsLoadingScore(false);
      setErrorBanner(null);
      setPlaybackRange(null);
      setActiveFretNotes([]);

      // Detect embedded Guitar Pro 7/8 audio backing track and expose it as its own Audio-Spur!
      // The sync points stored in the GP file map the score timeline to the audio file.
      const syncPoints = extractAudioSyncPoints(loadedScore, (s) =>
        alphaTab.midi.MidiFileGenerator.generateSyncPoints(s),
      );
      audioSyncPointsRef.current = syncPoints;
      setEmbeddedSyncPointCount(syncPoints.length);

      const rawAudio = loadedScore.backingTrack?.rawAudioFile;
      if (rawAudio && rawAudio.length > 0) {
        const copy = new Uint8Array(rawAudio.byteLength);
        copy.set(rawAudio);
        const blobUrl = URL.createObjectURL(new Blob([copy.buffer], {type: 'audio/mpeg'}));
        setAudioTrack({
          url: blobUrl,
          name: 'Eingebettete Audio-Spur (Guitar Pro)',
          source: 'embedded',
          volume: 0.9,
          muted: false,
          solo: false,
          offsetMs: 0,
        });
      } else {
        setAudioTrack((prev) =>
          prev.source === 'embedded'
            ? {url: null, name: '', source: null, volume: 0.85, muted: false, solo: false, offsetMs: 0}
            : prev,
        );
      }

      // Initialize Tempo-Trainer defaults to song's natural BPM (70% -> 100%)
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
    });

    api.renderFinished.on(() => {
      setIsLoadingScore(false);
    });

    api.playerStateChanged.on((e) => {
      const playing = e.state === 1;
      setIsPlaying(playing);
      if (playing) {
        manualStopRef.current = false;
      } else {
        audioElRef.current?.pause();
      }
    });

    api.playerPositionChanged.on((e) => {
      setCurrentTimeMs(e.currentTime);
      setEndTimeMs(e.endTime);
      setEndTick(e.endTick);

      // Keep synchronized Audio-Spur tightly locked to alphaTab playback timeline!
      const playing = apiRef.current?.playerState === 1;
      syncAudioTrackToTime(e.currentTime, playing, e.endTime);
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

    // Handles Tempo-Trainer progressive speedup AND Count-in on every repeat
    api.playerFinished.on(() => {
      audioElRef.current?.pause();
      if (manualStopRef.current) return;

      const looping = isLoopingRef.current;
      const mode = countInModeRef.current;
      const currentTrainer = trainerRef.current;
      const songBpm = scoreRef.current?.tempo || 120;

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
      setErrorBanner(err?.message || 'Fehler beim Parsen oder Rendern der Partitur.');
    });

    // Load initial score
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
      setSourceLabel(`Demo · ${initialDemo.label}`);
      api.tex(initialDemo.tex);
    }

    return () => {
      clearPendingRepeatRestart();
      audioElRef.current?.pause();
      midiReloadRef.current?.dispose();
      midiReloadRef.current = null;
      api.destroy();
      apiRef.current = null;
      disableIosPlaybackAudio();
    };
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
    audioElRef.current?.pause();
    api.pause();
    loadRemoteUrl(
      `/api/slices/${encodeURIComponent(activeSlice.id)}/file`,
      `${activeSlice.fileName} · /slices/${activeSlice.id}/embed/`,
      activeSlice.ext,
    );
  }, [activeSlice, loadRemoteUrl, clearPendingRepeatRestart]);

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

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
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
      handleSpeedChange(clampedBpm / Math.max(1, baseTempo));
    },
    [baseTempo, handleSpeedChange],
  );

  // Keyboard shortcuts
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
            midiReloadRef.current?.cancelResume();
            audioElRef.current?.pause();
            api.pause();
          } else {
            manualStopRef.current = false;
            if (midiReloadRef.current?.isReloading) {
              midiReloadRef.current.resumeOnLoad();
            } else {
              enableIosPlaybackAudio();
              api.play();
            }
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

  // Playback handlers
  const handlePlayPause = () => {
    const api = apiRef.current;
    if (!api || !isPlayerReady) return;
    if (isPlaying) {
      manualStopRef.current = true;
      clearPendingRepeatRestart();
      midiReloadRef.current?.cancelResume();
      audioElRef.current?.pause();
      api.pause();
    } else {
      manualStopRef.current = false;
      if (midiReloadRef.current?.isReloading) {
        midiReloadRef.current.resumeOnLoad();
        return;
      }
      // Safari/iOS mutes Web Audio with the hardware silent switch unless the
      // page claims the "playback" audio session. Do it inside the tap gesture.
      enableIosPlaybackAudio();
      api.countInVolume = countInMode === 'off' ? 0 : 1;
      api.play();
    }
  };

  const handleStop = () => {
    manualStopRef.current = true;
    clearPendingRepeatRestart();
    if (midiReloadRef.current?.isReloading) {
      midiReloadRef.current.cancelResume();
      midiReloadRef.current.request({tick: 0, resumePlayback: false});
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.currentTime = 0;
    }
    if (!apiRef.current) return;
    apiRef.current.stop();
    setActiveFretNotes([]);
    setTrainer((prev) => ({...prev, completedLoops: 0}));
  };

  const handleToggleLoop = () => setIsLooping((prev) => !prev);

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

  // SoundFont switching
  const handleSelectSoundFont = (sfId: SoundFontPresetId) => {
    const api = apiRef.current;
    if (!api) return;
    setActiveSoundFont(sfId);
    activeSoundFontRef.current = sfId;
    soundFontFallbackTriedRef.current = false;
    setCustomSoundFontName(null);
    setIsSwitchingSoundFont(true);
    setSoundFontProgress(0);
    setErrorBanner(null);
    try {
      window.localStorage.setItem(SOUNDFONT_STORAGE_KEY, sfId);
    } catch {
      // Ignore
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
        activeSoundFontRef.current = 'custom';
        soundFontFallbackTriedRef.current = true;
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

  // Dedicated Audio-Spur / Backing Track handlers
  const handleLoadCustomAudioTrack = (file: File) => {
    const blobUrl = URL.createObjectURL(file);
    setAudioTrack({
      url: blobUrl,
      name: file.name,
      source: 'custom',
      volume: 0.85,
      muted: false,
      solo: false,
      offsetMs: 0,
    });
  };

  const handleToggleAudioTrackMute = () => {
    setAudioTrack((prev) => ({...prev, muted: !prev.muted, solo: false}));
  };

  const handleToggleAudioTrackSolo = () => {
    const api = apiRef.current;
    const nextSolo = !audioTrack.solo;
    setAudioTrack((prev) => ({
      ...prev,
      solo: nextSolo,
      muted: nextSolo ? false : prev.muted,
    }));

    // When soloing the Audio-Spur, mute all MIDI notation tracks; restore when un-soloing!
    if (api && score) {
      api.changeTrackMute(score.tracks, nextSolo);
      setMixerState((prev) => {
        const next: Record<number, TrackMixerState> = {...prev};
        for (const t of score.tracks) {
          const cur = prev[t.index] ?? {
            volume: 1,
            muted: false,
            solo: false,
            transpose: 0,
            program: t.playbackInfo.program,
          };
          next[t.index] = {...cur, muted: nextSolo, solo: nextSolo ? false : cur.solo};
        }
        return next;
      });
    }
  };

  const handleRemoveAudioTrack = () => {
    audioElRef.current?.pause();
    if (audioTrack.solo && apiRef.current && score) {
      apiRef.current.changeTrackMute(score.tracks, false);
    }
    setAudioTrack({
      url: null,
      name: '',
      source: null,
      volume: 0.85,
      muted: false,
      solo: false,
      offsetMs: 0,
    });
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

  const handleTrackProgramChange = (track: alphaTab.model.Track, newProgram: number) => {
    const api = apiRef.current;
    if (!api) return;

    track.playbackInfo.program = newProgram;
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

    // Changing the program requires a new MIDI file. Reloading it stops the
    // player, so let the coordinator wait for `midiLoaded` before seeking back
    // and resuming – calling play() immediately would leave playback stuck.
    midiReloadRef.current?.request({
      tick: api.tickPosition,
      resumePlayback: api.playerState === 1,
    });
  };

  // Display settings handlers
  const handleLayoutChange = (mode: 'page' | 'horizontal') => {
    setLayoutMode(mode);
    const api = apiRef.current;
    if (!api) return;
    api.settings.display.layoutMode =
      mode === 'horizontal' ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page;
    api.updateSettings();
    api.render();
  };

  const handleStaveProfileChange = (profile: StaveModeParam) => {
    setStaveProfile(profile);
    const api = apiRef.current;
    if (!api) return;
    api.settings.display.staveProfile = mapStaveProfile(profile);
    api.updateSettings();
    api.render();
  };

  const handleZoomChange = (newZoom: number) => {
    const clamped = Math.round(Math.max(0.6, Math.min(1.5, newZoom)) * 100) / 100;
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

  const handleToggleHeader = () => {
    const next = !showHeader;
    setShowHeader(next);
    const api = apiRef.current;
    if (!api) return;
    applyScoreHeaderVisibility(api.settings, next);
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
      // Restricted by iframe permissions
    }
  };

  const handleSeekBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const api = apiRef.current;
    if (!api || endTimeMs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const nextMs = Math.round(ratio * endTimeMs);
    api.timePosition = nextMs;
    syncAudioTrackToTime(nextMs, isPlaying, endTimeMs);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingFile) setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'mp3' || ext === 'wav' || ext === 'ogg' || ext === 'm4a') {
      handleLoadCustomAudioTrack(file);
    } else {
      loadLocalFile(file);
    }
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
      {/* Hidden synchronized HTMLAudioElement for Audio-Spur / Backing Track */}
      {audioTrack.url && <audio ref={audioElRef} src={audioTrack.url} preload="auto" />}

      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) loadLocalFile(file);
          e.target.value = '';
        }}
      />
      <input
        ref={soundFontInputRef}
        type="file"
        accept=".sf2,.sf3"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUploadCustomSoundFont(file);
          e.target.value = '';
        }}
      />
      <input
        ref={audioFileInputRef}
        type="file"
        accept=".mp3,.wav,.ogg,.m4a,audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleLoadCustomAudioTrack(file);
          e.target.value = '';
        }}
      />

      {/* Slim Player Top Bar — Direct Settings & Song Title (hidden in embed when header=0) */}
      {(showHeader || !isEmbedMode) && (
        <div
          className={`flex items-center justify-between gap-3 px-4 h-11 border-b shrink-0 ${
            darkSheet
              ? 'bg-[#16181D] border-white/10 text-zinc-100'
              : 'bg-[#FAFAFB] border-zinc-200 text-zinc-900'
          }`}
        >
          {/* Left: Song Title & Artist (respects showHeader cleanly) */}
          <div className="flex items-center gap-2 min-w-0">
            {showHeader ? (
              <>
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
                {!isEmbedMode && (
                  <>
                    <span aria-hidden="true" className="text-zinc-400 hidden xl:inline">
                      ·
                    </span>
                    <span
                      className={`text-xs truncate hidden xl:inline ${
                        darkSheet ? 'text-zinc-400' : 'text-zinc-500'
                      }`}
                    >
                      {sourceLabel}
                    </span>
                  </>
                )}
              </>
            ) : (
              <span className="text-xs text-zinc-400">Kompaktansicht (Titel ausgeblendet)</span>
            )}
          </div>

          {/* Right: Direct Practice & Display Settings (no Datei testen / alphaTex clutter!) */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Quick Track Selector */}
            {score && score.tracks.length > 0 && (
              <button
                type="button"
                onClick={() => setActivePopover((prev) => (prev === 'tracks' ? null : 'tracks'))}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  darkSheet
                    ? 'bg-white/5 border-white/10 text-zinc-200 hover:bg-white/10'
                    : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                }`}
                title="Spuren, Bass-Sound & Audio-Spur mischen"
              >
                <Layers className="w-3.5 h-3.5 text-blue-600" />
                <span className="max-w-[130px] truncate">
                  {selectedTrackIndexes.length > 1
                    ? `${selectedTrackIndexes.length} / ${score.tracks.length} Spuren`
                    : primaryTrack?.name || 'Spur 1'}
                </span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
            )}

            {/* Quick Notation Stave Switch (Noten+Tab / Tab / Noten) */}
            <div
              className={`hidden md:flex items-center p-0.5 rounded-md border text-[11px] font-medium ${
                darkSheet
                  ? 'bg-black/25 border-white/10'
                  : 'bg-zinc-100 border-zinc-200/80'
              }`}
            >
              {(
                [
                  ['scoretab', 'Noten+Tab'],
                  ['tab', 'Nur Tab'],
                  ['score', 'Nur Noten'],
                ] as const
              ).map(([key, label]) => {
                const isActive =
                  staveProfile === key || (staveProfile === 'default' && key === 'scoretab');
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleStaveProfileChange(key)}
                    className={`px-2 py-0.5 rounded transition-colors whitespace-nowrap ${
                      isActive
                        ? darkSheet
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-zinc-900 shadow-xs'
                        : darkSheet
                          ? 'text-zinc-400 hover:text-zinc-200'
                          : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Quick Layout Switch (Page vs Horizontal) */}
            <button
              type="button"
              onClick={() => handleLayoutChange(layoutMode === 'page' ? 'horizontal' : 'page')}
              className={`hidden sm:inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                darkSheet
                  ? 'bg-white/5 border-white/10 text-zinc-200 hover:bg-white/10'
                  : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
              }`}
              title={
                layoutMode === 'page'
                  ? 'Zu Horizontal-Streifen wechseln'
                  : 'Zu Seitenansicht wechseln'
              }
            >
              {layoutMode === 'page' ? (
                <Rows3 className="w-3.5 h-3.5 text-zinc-500" />
              ) : (
                <Columns2 className="w-3.5 h-3.5 text-blue-600" />
              )}
              <span className="hidden lg:inline">
                {layoutMode === 'page' ? 'Seite' : 'Horizontal'}
              </span>
            </button>

            {/* Quick Zoom Controls */}
            <div
              className={`hidden lg:flex items-center rounded-md border ${
                darkSheet
                  ? 'bg-white/5 border-white/10 text-zinc-200'
                  : 'bg-white border-zinc-200 text-zinc-700'
              }`}
            >
              <button
                type="button"
                onClick={() => handleZoomChange(zoom - 0.1)}
                className="p-1 hover:bg-black/5 rounded-l-md"
                title="Verkleinern"
                aria-label="Verkleinern"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="px-1.5 text-[11px] font-mono tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => handleZoomChange(zoom + 0.1)}
                className="p-1 hover:bg-black/5 rounded-r-md"
                title="Vergrößern"
                aria-label="Vergrößern"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {/* Publish locally dropped file to Server */}
            {!isEmbedMode && localDraftFile && onPublishLocalFile && (
              <button
                type="button"
                onClick={() => onPublishLocalFile(localDraftFile)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <CloudUpload className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Als Forum-Link speichern</span>
              </button>
            )}

            {/* Studio 500px Embed Preview Toggle */}
            {!isEmbedMode && onToggleEmbedPreview && (
              <button
                type="button"
                onClick={onToggleEmbedPreview}
                className={`hidden xl:inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  embedPreviewMode
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : darkSheet
                      ? 'bg-white/5 border-white/10 text-zinc-200 hover:bg-white/10'
                      : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                }`}
                title="500px Forum-Iframe-Vorschau ein-/ausschalten"
              >
                500px Vorschau
              </button>
            )}

            {/* In embed mode, allow opening a local file directly if desired */}
            {isEmbedMode && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  darkSheet
                    ? 'bg-white/5 border-white/10 text-zinc-200 hover:bg-white/10'
                    : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'
                }`}
                title="Eigene Guitar-Pro-Datei laden"
              >
                <FolderOpen className="w-3.5 h-3.5 text-blue-600" />
              </button>
            )}
          </div>
        </div>
      )}

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

      {/* Main Scrollable Score Canvas */}
      <div className="relative flex-1 min-h-0 flex overflow-hidden">
        <div
          ref={viewportRef}
          onClick={() => {
            if (activePopover) setActivePopover(null);
          }}
          className={`relative flex-1 min-w-0 h-full overflow-auto score-scroll ${
            darkSheet ? 'bg-[#111317] at-surface-dark' : 'bg-white'
          }`}
        >
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

          {/* Subtle practice hint & tempo info */}
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
                {trainer.enabled ? ` · Trainer ${trainer.startBpm}→${trainer.targetBpm} BPM` : ''}
              </span>
            </div>
          )}

          {/* alphaTab SVG Mount Element */}
          <div
            ref={mountRef}
            className={`px-4 sm:px-8 pb-6 ${layoutMode === 'horizontal' ? 'min-h-[240px]' : ''}`}
          />

          {/* Quiet alphaTab / alphaTex & SoundFont Attribution inside sheet scroll area */}
          {!isLoadingScore && (
            <div
              className={`px-6 pb-5 pt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] border-t ${
                darkSheet
                  ? 'border-white/5 text-zinc-500'
                  : 'border-zinc-100 text-zinc-400'
              }`}
            >
              <span>
                Powered by{' '}
                <a
                  href="https://alphatab.net"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline font-medium"
                >
                  alphaTab
                </a>{' '}
                (Guitar Pro &amp; alphaTex)
              </span>
              <span>SoundFont: {getSoundFontLabel(activeSoundFont, customSoundFontName)}</span>
            </div>
          )}
        </div>

        {/* Drag & Drop Overlay (Guitar Pro OR MP3/WAV Audio-Spur) */}
        {isDraggingFile && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-blue-600/12 backdrop-blur-[2px] border-2 border-dashed border-blue-600 m-2 rounded-xl pointer-events-none">
            <div className="bg-white/95 text-zinc-900 px-6 py-5 rounded-xl shadow-lg border border-zinc-200 flex flex-col items-center gap-2 text-center">
              <Upload className="w-6 h-6 text-blue-600" />
              <p className="text-sm font-semibold">Guitar-Pro-Datei oder Audio-Spur ablegen</p>
              <p className="text-xs text-zinc-500">
                .gp, .gp3–.gp8, .gpx, MusicXML, .tex — oder MP3/WAV/OGG als Backing-Track
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Collapsible Live Fretboard Visualizer */}
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
      <div className="relative bg-[#14161A] text-zinc-100 border-t border-white/10 shrink-0 select-none pb-[env(safe-area-inset-bottom)]">
        {/* Popover: Tracks, Mixer, Dedicated Audio-Spur & Metronome Channel */}
        {activePopover === 'tracks' && score && (
          <div
            className="absolute bottom-full right-3 mb-2 w-[370px] max-w-[calc(100vw-24px)] bg-[#1A1D23] border border-white/12 rounded-xl shadow-2xl overflow-hidden z-30"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
              <span className="text-xs font-semibold text-zinc-100">
                Spuren, Audio-Track &amp; Mixer
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

            <div className="max-h-96 overflow-y-auto divide-y divide-white/8 score-scroll">
              {/* Dedicated Audio-Spur / Backing-Track Row */}
              <div className="px-4 py-3 bg-white/[0.025] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileAudio className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="text-xs font-semibold text-zinc-100 truncate">
                      {audioTrack.url ? audioTrack.name : 'Audio-Spur (Backing-Track)'}
                    </span>
                    {audioTrack.source === 'embedded' && embeddedSyncPointCount > 0 && (
                      <span
                        className="text-[9px] font-mono px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300 shrink-0"
                        title={`${embeddedSyncPointCount} Synchronpunkte aus der Guitar-Pro-Datei werden zur Ausrichtung verwendet`}
                      >
                        GP-Sync
                      </span>
                    )}
                  </div>
                  {audioTrack.url ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={handleToggleAudioTrackSolo}
                        className={`w-6 h-6 text-[11px] font-mono font-semibold rounded transition-colors ${
                          audioTrack.solo
                            ? 'bg-amber-500 text-zinc-950'
                            : 'bg-white/8 text-zinc-300 hover:bg-white/15'
                        }`}
                        title="Audio-Spur Solo (schaltet MIDI-Spuren stumm)"
                      >
                        S
                      </button>
                      <button
                        type="button"
                        onClick={handleToggleAudioTrackMute}
                        className={`w-6 h-6 text-[11px] font-mono font-semibold rounded transition-colors ${
                          audioTrack.muted
                            ? 'bg-red-500 text-white'
                            : 'bg-white/8 text-zinc-300 hover:bg-white/15'
                        }`}
                        title="Audio-Spur stummschalten"
                      >
                        M
                      </button>
                      <button
                        type="button"
                        onClick={handleRemoveAudioTrack}
                        className="w-6 h-6 rounded bg-white/8 text-zinc-400 hover:text-white hover:bg-white/15 flex items-center justify-center"
                        title="Audio-Spur entfernen"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => audioFileInputRef.current?.click()}
                      className="px-2.5 py-1 text-[11px] font-medium text-blue-300 bg-blue-600/20 hover:bg-blue-600/30 rounded-md transition-colors whitespace-nowrap"
                    >
                      + MP3/WAV laden
                    </button>
                  )}
                </div>

                {audioTrack.url ? (
                  <div className="space-y-1.5 pl-5">
                    <div className="flex items-center gap-2">
                      <Volume2 className="w-3 h-3 text-zinc-500 shrink-0" />
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={audioTrack.volume}
                        onChange={(e) =>
                          setAudioTrack((prev) => ({
                            ...prev,
                            volume: parseFloat(e.target.value),
                            muted: false,
                          }))
                        }
                        className="dock-range flex-1"
                        aria-label="Lautstärke Audio-Spur"
                      />
                      <span className="text-[10px] font-mono tabular-nums text-zinc-300 w-8 text-right">
                        {Math.round(audioTrack.volume * 100)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-zinc-400">
                      <span>Sync-Versatz</span>
                      <div className="flex items-center gap-1 font-mono tabular-nums">
                        <button
                          type="button"
                          onClick={() =>
                            setAudioTrack((prev) => ({
                              ...prev,
                              offsetMs: prev.offsetMs - 50,
                            }))
                          }
                          className="px-1.5 py-0.5 rounded bg-white/8 hover:bg-white/15 text-zinc-200"
                        >
                          -50ms
                        </button>
                        <span className="w-14 text-center text-zinc-300">
                          {audioTrack.offsetMs >= 0
                            ? `+${audioTrack.offsetMs}ms`
                            : `${audioTrack.offsetMs}ms`}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setAudioTrack((prev) => ({
                              ...prev,
                              offsetMs: prev.offsetMs + 50,
                            }))
                          }
                          className="px-1.5 py-0.5 rounded bg-white/8 hover:bg-white/15 text-zinc-200"
                        >
                          +50ms
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-zinc-500 pl-5">
                    GP7/8-Backing-Tracks erscheinen hier automatisch, oder lade eine eigene MP3/WAV-Spur mit eigener Lautstärke &amp; Mute.
                  </p>
                )}
              </div>

              {/* Notation / MIDI Instrument Tracks */}
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
                          <span className="text-[10px] font-mono tabular-nums text-zinc-300 w-7 text-center">
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

              {/* Metronome Channel Row in Mixer */}
              <div className="px-4 py-2.5 space-y-2 bg-white/[0.015]">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <MetronomeIcon className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="text-xs font-medium text-zinc-200">Metronom</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleMetronome}
                    className={`w-6 h-6 text-[11px] font-mono font-semibold rounded transition-colors ${
                      !metronomeOn
                        ? 'bg-red-500 text-white'
                        : 'bg-white/8 text-zinc-300 hover:bg-white/15'
                    }`}
                    title={metronomeOn ? 'Metronom stummschalten' : 'Metronom aktivieren'}
                  >
                    M
                  </button>
                </div>
                <div className="flex items-center gap-2 pl-5">
                  <Volume2 className="w-3 h-3 text-zinc-500 shrink-0" />
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={metronomeVolume}
                    onChange={(e) => handleMetronomeVolumeChange(parseFloat(e.target.value))}
                    className="dock-range flex-1"
                    aria-label="Metronom-Lautstärke"
                  />
                  <span className="text-[10px] font-mono tabular-nums text-zinc-400 w-8 text-right">
                    {Math.round(metronomeVolume * 100)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Popover: Direct BPM Input, Tempo, Count-In Mode & Tempo-Trainer */}
        {activePopover === 'speed' && (
          <div
            className="absolute bottom-full left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-24 mb-2 w-[330px] max-w-[calc(100vw-24px)] bg-[#1A1D23] border border-white/12 rounded-xl shadow-2xl p-4 space-y-4 z-30"
            onClick={(e) => e.stopPropagation()}
          >
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
                    >
                      +5
                    </button>
                  </div>
                </div>

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
              </div>
            ) : (
              <div className="space-y-3.5">
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Steigert das Tempo automatisch nach jeder Loop-Wiederholung. Ziehe im Notenblatt einen A–B-Bereich auf oder trainiere das ganze Stück.
                </p>

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
                    <label className="block text-[11px] text-zinc-400 mb-1">Alle N Loops</label>
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

        {/* Popover: SoundFont (GeneralUser GS 2.0.3 Default) & Display Settings */}
        {activePopover === 'view' && (
          <div
            className="absolute bottom-full right-3 mb-2 w-80 max-w-[calc(100vw-24px)] bg-[#1A1D23] border border-white/12 rounded-xl shadow-2xl p-4 space-y-4 z-30 max-h-[76vh] overflow-y-auto score-scroll"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-100">
                SoundFont &amp; Einstellungen
              </span>
              <button
                type="button"
                onClick={() => setActivePopover(null)}
                className="p-1 text-zinc-400 hover:text-white rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* SoundFont Selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-zinc-300 font-medium">
                  <AudioLines className="w-3.5 h-3.5 text-blue-400" />
                  SoundFont
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
              {/* Show/Hide Song Title Header */}
              <label className="flex items-center justify-between text-xs text-zinc-200 cursor-pointer select-none">
                <span>Songtitel &amp; Kopfzeile anzeigen</span>
                <input
                  type="checkbox"
                  checked={showHeader}
                  onChange={handleToggleHeader}
                  className="accent-blue-500 rounded"
                />
              </label>

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

        {/* Full-Width Interactive Progress Scrubber */}
        <div
          onClick={handleSeekBarClick}
          className="relative h-2 w-full bg-white/10 cursor-pointer group hover:h-2.5 transition-[height]"
          role="slider"
          aria-label="Wiedergabeposition"
          aria-valuemin={0}
          aria-valuemax={Math.round(endTimeMs / 1000)}
          aria-valuenow={Math.round(currentTimeMs / 1000)}
        >
          {playbackRange && (
            <div
              className="absolute top-0 bottom-0 bg-amber-400/45 border-x border-amber-300"
              style={{left: `${rangeStartPct}%`, width: `${rangeWidthPct}%`}}
            />
          )}
          <div
            className="absolute top-0 bottom-0 left-0 bg-blue-500 transition-[width] duration-75"
            style={{width: `${progressPercent}%`}}
          />
        </div>

        {/* Main Transport Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-2 sm:px-4 py-1.5 min-h-14">
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

          {/* Right: BPM & Tempo-Trainer, Metronome, Count-In, Volume, Fretboard, Mixer, Settings, Fullscreen */}
          <div className="flex items-center gap-0.5 sm:gap-1.5 shrink-0">
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
                {trainer.enabled ? `→ ${trainer.targetBpm}` : `(${Math.round(speed * 100)}%)`}
              </span>
            </button>

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

            <button
              type="button"
              onClick={handleCycleCountIn}
              className={`h-9 px-2.5 rounded-lg hidden md:inline-flex items-center gap-1.5 text-xs font-mono font-medium transition-colors whitespace-nowrap shrink-0 ${
                countInMode !== 'off'
                  ? 'bg-blue-600/25 text-blue-300 hover:bg-blue-600/35'
                  : 'text-zinc-400 hover:text-white hover:bg-white/10'
              }`}
              title={`Einzähler (C): ${countInLabel} — Klicken zum Wechseln`}
            >
              <span>1-2-3-4</span>
              <span className="text-[10px] font-sans opacity-80">
                {countInMode === 'always' ? '∞' : countInMode === 'first' ? '1×' : ''}
              </span>
            </button>

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

            <button
              type="button"
              onClick={() => setActivePopover((prev) => (prev === 'tracks' ? null : 'tracks'))}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
                activePopover === 'tracks' || audioTrack.url
                  ? 'bg-white/15 text-white'
                  : 'text-zinc-300 hover:text-white hover:bg-white/10'
              }`}
              title="Spuren, Audio-Track & Mixer"
              aria-label="Spuren, Audio-Track und Mixer"
            >
              <Layers className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setActivePopover((prev) => (prev === 'view' ? null : 'view'))}
              className={`h-9 px-2 rounded-lg inline-flex items-center gap-1.5 text-xs transition-colors shrink-0 ${
                activePopover === 'view'
                  ? 'bg-white/15 text-white'
                  : 'text-zinc-300 hover:text-white hover:bg-white/10'
              }`}
              title="SoundFont (GeneralUser GS 2.0.3) & Einstellungen"
              aria-label="SoundFont und Einstellungen"
            >
              <SlidersHorizontal className="w-4 h-4 shrink-0" />
            </button>

            <button
              type="button"
              onClick={handleToggleFullscreen}
              className="w-9 h-9 rounded-lg hidden sm:flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/10 transition-colors shrink-0"
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
