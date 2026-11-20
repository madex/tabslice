import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {MidiReloadCoordinator, type MidiReloadHost} from './midiReload.ts';

class FakeEmitter {
  private handlers = new Set<() => void>();

  on = (handler: () => void): (() => void) => {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  };

  emit(): void {
    for (const handler of [...this.handlers]) handler();
  }

  get listenerCount(): number {
    return this.handlers.size;
  }
}

class FakeHost implements MidiReloadHost {
  midiLoaded = new FakeEmitter();
  midiLoadFailed = new FakeEmitter();
  loadCalls = 0;
  playCalls = 0;
  calls: string[] = [];
  emitLoadedSynchronously = false;
  private tick = 0;

  get tickPosition(): number {
    return this.tick;
  }

  set tickPosition(value: number) {
    this.tick = value;
    this.calls.push(`tick:${value}`);
  }

  /** Mimics `AlphaSynth.loadMidiFile()` resetting the position to zero. */
  resetPosition(): void {
    this.tick = 0;
  }

  loadMidiForScore(): void {
    this.loadCalls += 1;
    this.calls.push('load');
    if (this.emitLoadedSynchronously) this.midiLoaded.emit();
    this.resetPosition();
  }

  play(): void {
    this.playCalls += 1;
    this.calls.push('play');
  }
}

describe('MidiReloadCoordinator', () => {
  it('restores the position and resumes playback after the MIDI was loaded', () => {
    const host = new FakeHost();
    host.tickPosition = 480;
    host.calls.length = 0;
    const coordinator = new MidiReloadCoordinator(host);

    coordinator.request({tick: 480, resumePlayback: true});

    assert.equal(host.loadCalls, 1);
    assert.equal(host.tickPosition, 0, 'must not seek before the new MIDI exists');
    assert.equal(host.playCalls, 0, 'must not play before the new MIDI exists');
    assert.equal(coordinator.isReloading, true);

    host.midiLoaded.emit();

    assert.equal(host.tickPosition, 480);
    assert.equal(host.playCalls, 1);
    assert.deepEqual(host.calls, ['load', 'tick:480', 'play']);
    assert.equal(coordinator.isReloading, false);
    assert.equal(host.midiLoaded.listenerCount, 0, 'listeners must be detached');
    assert.equal(host.midiLoadFailed.listenerCount, 0);
  });

  it('restores the position when midiLoaded fires synchronously (main-thread synth)', () => {
    const host = new FakeHost();
    host.emitLoadedSynchronously = true;
    const coordinator = new MidiReloadCoordinator(host);

    coordinator.request({tick: 700, resumePlayback: true});

    assert.equal(host.tickPosition, 700, 'the position reset after the event must not win');
    assert.equal(host.playCalls, 1);
    assert.deepEqual(host.calls, ['load', 'tick:700', 'play']);
    assert.equal(coordinator.isReloading, false);
    assert.equal(host.midiLoaded.listenerCount, 0);
  });

  it('keeps the player paused when it was not playing before the change', () => {
    const host = new FakeHost();
    const coordinator = new MidiReloadCoordinator(host);

    coordinator.request({tick: 960, resumePlayback: false});
    host.midiLoaded.emit();

    assert.equal(host.tickPosition, 960);
    assert.equal(host.playCalls, 0);
    assert.deepEqual(host.calls, ['load', 'tick:960']);
  });

  it('regenerates again for changes made while a reload is in flight', () => {
    const host = new FakeHost();
    const coordinator = new MidiReloadCoordinator(host);

    coordinator.request({tick: 120, resumePlayback: true});
    coordinator.request({tick: 240, resumePlayback: true});
    coordinator.request({tick: 360, resumePlayback: true});

    assert.equal(host.loadCalls, 1, 'only one reload may run at a time');

    host.midiLoaded.emit();
    assert.equal(host.loadCalls, 2, 'the latest change needs a second regeneration');
    assert.equal(host.tickPosition, 0);
    assert.equal(host.playCalls, 0);

    host.midiLoaded.emit();
    assert.equal(host.tickPosition, 360);
    assert.equal(host.playCalls, 1);
    assert.deepEqual(host.calls, ['load', 'load', 'tick:360', 'play']);
  });

  it('ignores duplicate midiLoaded events after the reload completed', () => {
    const host = new FakeHost();
    const coordinator = new MidiReloadCoordinator(host);

    coordinator.request({tick: 200, resumePlayback: true});
    host.midiLoaded.emit();
    host.midiLoaded.emit();

    assert.equal(host.playCalls, 1);
    assert.equal(host.loadCalls, 1);
  });

  it('does not resume when the user paused during the reload', () => {
    const host = new FakeHost();
    const coordinator = new MidiReloadCoordinator(host);

    coordinator.request({tick: 300, resumePlayback: true});
    coordinator.cancelResume();
    host.midiLoaded.emit();

    assert.equal(host.tickPosition, 300);
    assert.equal(host.playCalls, 0);
  });

  it('resumes again when the user presses play during the reload', () => {
    const host = new FakeHost();
    const coordinator = new MidiReloadCoordinator(host);

    coordinator.request({tick: 300, resumePlayback: false});
    coordinator.resumeOnLoad();
    host.midiLoaded.emit();

    assert.equal(host.tickPosition, 300);
    assert.equal(host.playCalls, 1);
  });

  it('can abort a reload without disposing the coordinator', () => {
    const host = new FakeHost();
    const coordinator = new MidiReloadCoordinator(host);

    coordinator.request({tick: 150, resumePlayback: true});
    coordinator.cancel();
    host.midiLoaded.emit();

    assert.equal(coordinator.isReloading, false);
    assert.equal(host.tickPosition, 0);
    assert.equal(host.playCalls, 0);

    coordinator.request({tick: 250, resumePlayback: true});
    host.midiLoaded.emit();
    assert.equal(host.tickPosition, 250);
    assert.equal(host.playCalls, 1);
  });

  it('drops the pending resume on a failed MIDI load', () => {
    const host = new FakeHost();
    const coordinator = new MidiReloadCoordinator(host);

    coordinator.request({tick: 400, resumePlayback: true});
    host.midiLoadFailed.emit();

    assert.equal(coordinator.isReloading, false);
    assert.equal(host.playCalls, 0);
    assert.equal(host.midiLoaded.listenerCount, 0);
    assert.equal(host.midiLoadFailed.listenerCount, 0);

    // A later change still works after the failure.
    coordinator.request({tick: 420, resumePlayback: true});
    host.midiLoaded.emit();
    assert.equal(host.tickPosition, 420);
    assert.equal(host.playCalls, 1);
  });

  it('clears the pending reload when loadMidiForScore throws', () => {
    const host = new FakeHost();
    host.loadMidiForScore = () => {
      throw new Error('midi generation failed');
    };
    const coordinator = new MidiReloadCoordinator(host);

    coordinator.request({tick: 500, resumePlayback: true});

    assert.equal(coordinator.isReloading, false);
    assert.equal(host.playCalls, 0);
    assert.equal(host.midiLoaded.listenerCount, 0);
    assert.equal(host.midiLoadFailed.listenerCount, 0);
  });

  it('stops reacting to events after dispose', () => {
    const host = new FakeHost();
    const coordinator = new MidiReloadCoordinator(host);

    coordinator.request({tick: 100, resumePlayback: true});
    coordinator.dispose();
    host.midiLoaded.emit();

    assert.equal(host.tickPosition, 0);
    assert.equal(host.playCalls, 0);
    assert.equal(host.midiLoaded.listenerCount, 0);

    coordinator.request({tick: 500, resumePlayback: true});
    assert.equal(host.loadCalls, 1, 'requests after dispose are ignored');
  });
});
