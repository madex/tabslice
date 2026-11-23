/**
 * iOS audio session handling.
 *
 * Web Audio (and therefore alphaTab's synthesizer) runs in Safari's "ambient"
 * audio session by default. The hardware silent switch mutes that session, so
 * playback looks healthy (AudioContext.state === "running") but stays silent.
 * HTML media elements and the "playback" session are not affected.
 *
 * Safari 16.4+ exposes `navigator.audioSession`; setting its type to
 * "playback" fixes the silent switch. Older Safari versions are promoted to
 * the playback category by keeping a silent <audio> element playing, which is
 * the long-standing workaround for this WebKit behaviour.
 *
 * Call `enableIosPlaybackAudio()` from a user gesture (tap/click/keydown)
 * before starting playback.
 */

type AudioSessionLike = {type: string};

let silentAudio: HTMLAudioElement | null = null;
let silentAudioUrl: string | null = null;

export function isIosLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports itself as a Mac; touch points reveal the tablet.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export function enableIosPlaybackAudio(): void {
  if (!isIosLike()) return;

  const session = (navigator as Navigator & {audioSession?: AudioSessionLike}).audioSession;
  if (session) {
    try {
      session.type = 'playback';
      return;
    } catch {
      // Fall through to the silent-audio workaround.
    }
  }

  startSilentAudioLoop();
}

/** Stops the silent audio helper and releases the playback session. */
export function disableIosPlaybackAudio(): void {
  if (silentAudio) {
    silentAudio.pause();
    silentAudio.remove();
    silentAudio = null;
  }
  if (silentAudioUrl) {
    URL.revokeObjectURL(silentAudioUrl);
    silentAudioUrl = null;
  }
  const session = (navigator as Navigator & {audioSession?: AudioSessionLike}).audioSession;
  if (session) {
    try {
      session.type = 'auto';
    } catch {
      // Ignore; some browsers expose the property read-only.
    }
  }
}

function startSilentAudioLoop(): void {
  if (typeof document === 'undefined') return;

  if (!silentAudio) {
    const audio = document.createElement('audio');
    audio.setAttribute('playsinline', '');
    audio.setAttribute('aria-hidden', 'true');
    audio.loop = true;
    audio.preload = 'auto';
    silentAudioUrl = createSilentWavUrl();
    audio.src = silentAudioUrl;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    silentAudio = audio;
  }

  // Must run inside a user gesture. If it is blocked, the next call retries.
  void silentAudio.play().catch(() => {
    // Ignore: playback will be retried on the next user gesture.
  });
}

/** Builds a one-second, 8 kHz mono WAV file filled with silence. */
function createSilentWavUrl(): string {
  const sampleRate = 8000;
  const sampleCount = sampleRate;
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);
  // Sample bytes stay zero (ArrayBuffer is zero-initialized) => silence.

  return URL.createObjectURL(new Blob([buffer], {type: 'audio/wav'}));
}
