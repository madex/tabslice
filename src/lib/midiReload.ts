/**
 * Coordinates regeneration of the alphaTab MIDI file when playback-relevant
 * model data (for example a track's General MIDI program) changes.
 *
 * `AlphaTabApi.loadMidiForScore()` stops the player. When the MIDI is generated
 * inside the alphaTab worker, the new file is only ready once the asynchronous
 * `midiLoaded` event arrives. Restoring the tick position and calling `play()`
 * before that event leaves the player stuck at tick 0 – this is why changing
 * the bass instrument during playback used to freeze the whole player.
 *
 * The coordinator waits for `midiLoaded`, restores the previous position and
 * resumes playback only when it was running before the change. Changes that
 * arrive while a regeneration is in flight are coalesced into a second run so
 * that the final MIDI always reflects the latest program selection.
 */

export interface MidiReloadEvent {
  /** Registers a handler and returns an unregister function. */
  on(handler: () => void): () => void;
}

export interface MidiReloadHost {
  /** Current tick position; restored after the new MIDI was loaded. */
  tickPosition: number;
  /** Re-generates and loads the MIDI for the current score (stops playback). */
  loadMidiForScore(): void;
  play(): void;
  midiLoaded: MidiReloadEvent;
  midiLoadFailed?: MidiReloadEvent;
}

export interface MidiReloadRequest {
  /** Tick position to restore once the regenerated MIDI is ready. */
  tick: number;
  /** Whether playback should continue after the reload. */
  resumePlayback: boolean;
}

export class MidiReloadCoordinator {
  private readonly host: MidiReloadHost;
  private inFlight = false;
  private pending: MidiReloadRequest | null = null;
  private queued: MidiReloadRequest | null = null;
  private unsubscribeLoaded: (() => void) | null = null;
  private unsubscribeFailed: (() => void) | null = null;
  private disposed = false;
  private loadingSynchronously = false;
  private loadedSynchronously = false;

  constructor(host: MidiReloadHost) {
    this.host = host;
  }

  /** True while a MIDI regeneration is running and playback is not resumed yet. */
  get isReloading(): boolean {
    return this.inFlight;
  }

  /**
   * Requests a MIDI regeneration. Safe to call repeatedly (for example while
   * the user scrolls through the instrument list): only one regeneration runs
   * at a time and the latest request wins.
   */
  request(request: MidiReloadRequest): void {
    if (this.disposed) return;
    if (this.inFlight) {
      // The MIDI currently being generated was built before this change, so a
      // second regeneration is required after the first one finishes.
      this.queued = {...request};
      return;
    }
    this.start(request);
  }

  /**
   * Prevents an automatic resume. Call this when the user pauses or stops the
   * player while a regeneration is still in flight, so the pending reload does
   * not start playback again against the user's intent.
   */
  cancelResume(): void {
    if (this.pending) this.pending.resumePlayback = false;
    if (this.queued) this.queued.resumePlayback = false;
  }

  /**
   * Re-enables the automatic resume for a reload that is still in flight, for
   * example when the user presses play again before the new MIDI is ready.
   */
  resumeOnLoad(): void {
    if (this.pending) this.pending.resumePlayback = true;
    if (this.queued) this.queued.resumePlayback = true;
  }

  /** Aborts a pending reload (e.g. because a completely new score is loaded). */
  cancel(): void {
    this.inFlight = false;
    this.pending = null;
    this.queued = null;
    this.detach();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private start(request: MidiReloadRequest): void {
    this.inFlight = true;
    this.pending = {...request};
    this.detach();
    this.unsubscribeLoaded = this.host.midiLoaded.on(this.handleLoaded);
    if (this.host.midiLoadFailed) {
      this.unsubscribeFailed = this.host.midiLoadFailed.on(this.handleFailed);
    }

    this.loadingSynchronously = true;
    this.loadedSynchronously = false;
    try {
      this.host.loadMidiForScore();
    } catch {
      this.loadingSynchronously = false;
      this.handleFailed();
      return;
    }
    this.loadingSynchronously = false;

    // Without a worker alphaTab emits `midiLoaded` before it resets the tick
    // position to zero. Handle such a synchronous event only after
    // loadMidiForScore() returned, otherwise the reset would undo our seek.
    if (this.loadedSynchronously) {
      this.loadedSynchronously = false;
      this.handleLoaded();
    }
  }

  private handleLoaded = (): void => {
    if (!this.inFlight) return;
    if (this.loadingSynchronously) {
      this.loadedSynchronously = true;
      return;
    }
    this.inFlight = false;
    this.detach();

    const queued = this.queued;
    this.queued = null;
    if (queued) {
      this.start(queued);
      return;
    }

    const pending = this.pending;
    this.pending = null;
    if (!pending) return;

    this.host.tickPosition = pending.tick;
    if (pending.resumePlayback) this.host.play();
  };

  private handleFailed = (): void => {
    if (!this.inFlight) return;
    this.inFlight = false;
    this.pending = null;
    this.queued = null;
    this.detach();
  };

  private detach(): void {
    this.unsubscribeLoaded?.();
    this.unsubscribeLoaded = null;
    this.unsubscribeFailed?.();
    this.unsubscribeFailed = null;
  }
}
