/**
 * Maps positions between the alphaTab/synthesizer timeline and an external
 * audio file (Guitar Pro backing track).
 *
 * Guitar Pro stores synchronization points as automations on the master bars.
 * alphaTab turns them into {@link AudioSyncPoint}s where `synthTime` is the
 * position on the score timeline (at 100 % speed) and `syncTime` is the
 * position inside the audio file. Between two points the audio is interpolated
 * linearly, exactly like alphaTab's own `MidiFileSequencer` does for backing
 * track playback.
 */

export interface AudioSyncPoint {
  /** Position on the alphaTab/synth timeline in milliseconds (at 100 % speed). */
  synthTime: number;
  /** Position inside the audio file in milliseconds. */
  syncTime: number;
}

export interface AudioSyncOptions {
  /** Playback speed factor (1 = normal speed). */
  speed: number;
  /** Song end on the synth timeline in milliseconds at 100 % speed. */
  songEndTime: number;
  /** Duration of the audio file in milliseconds (0/NaN when unknown). */
  audioDuration: number;
}

/**
 * Converts a playback time from the alphaTab timeline to the position inside
 * the backing audio file.
 *
 * @param timeMs Playback time reported by alphaTab (wall-clock at the current speed).
 * @param syncPoints Sync points read from the score, sorted by `synthTime`.
 * @param options Playback speed and end positions for extrapolation.
 * @returns Position inside the audio file in milliseconds. Without sync points
 *          the input is returned unchanged (1:1 playback).
 */
export function synthTimeToAudioTime(
  timeMs: number,
  syncPoints: readonly AudioSyncPoint[],
  options: AudioSyncOptions,
): number {
  if (!Number.isFinite(timeMs) || timeMs < 0 || syncPoints.length === 0) {
    return timeMs;
  }

  const speed = Number.isFinite(options.speed) && options.speed > 0 ? options.speed : 1;
  const synthTime = timeMs * speed;

  // alphaTab reports wall-clock time, the sync points use the score timeline.
  let index = 0;
  for (let i = 1; i < syncPoints.length; i += 1) {
    if (syncPoints[i].synthTime <= synthTime) index = i;
    else break;
  }

  const current = syncPoints[index];
  const next = syncPoints[index + 1];

  if (next) {
    const span = next.synthTime - current.synthTime;
    if (span <= 0) return current.syncTime;
    const ratio = (synthTime - current.synthTime) / span;
    return current.syncTime + (next.syncTime - current.syncTime) * ratio;
  }

  // After the last sync point interpolate towards the end of the audio file.
  const songEnd = Number.isFinite(options.songEndTime) ? options.songEndTime : current.synthTime;
  if (songEnd <= current.synthTime) return current.syncTime;

  const audioEnd =
    Number.isFinite(options.audioDuration) && options.audioDuration > current.syncTime
      ? options.audioDuration
      : current.syncTime;
  const ratio = (synthTime - current.synthTime) / (songEnd - current.synthTime);
  return current.syncTime + (audioEnd - current.syncTime) * ratio;
}

/**
 * Extracts the sync points of a score for the embedded backing track.
 * Returns an empty list when the score has no backing track or no sync points.
 */
export function extractAudioSyncPoints<
  T extends {backingTrack?: {rawAudioFile?: Uint8Array} | undefined},
>(
  score: T,
  generateSyncPoints: (score: T) => ReadonlyArray<{synthTime: number; syncTime: number}>,
): AudioSyncPoint[] {
  const rawAudio = score.backingTrack?.rawAudioFile;
  if (!rawAudio || rawAudio.length === 0) return [];
  try {
    return generateSyncPoints(score)
      .map((point) => ({synthTime: point.synthTime, syncTime: point.syncTime}))
      .filter(
        (point) => Number.isFinite(point.synthTime) && Number.isFinite(point.syncTime),
      );
  } catch {
    return [];
  }
}
