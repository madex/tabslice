import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  type AudioSyncPoint,
  extractAudioSyncPoints,
  synthTimeToAudioTime,
} from './audioSync.ts';

const options = {speed: 1, songEndTime: 20_000, audioDuration: 20_000};

function map(timeMs: number, points: AudioSyncPoint[], overrides: Partial<typeof options> = {}) {
  return synthTimeToAudioTime(timeMs, points, {...options, ...overrides});
}

describe('synthTimeToAudioTime', () => {
  it('returns the input unchanged without sync points', () => {
    assert.equal(map(12_345, []), 12_345);
  });

  it('returns the input unchanged for invalid times', () => {
    const points = [{synthTime: 0, syncTime: 0}];
    assert.equal(map(Number.NaN, points), Number.NaN);
    assert.equal(map(-5, points), -5);
  });

  it('maps linearly with 1:1 sync points', () => {
    const points = [
      {synthTime: 0, syncTime: 0},
      {synthTime: 10_000, syncTime: 10_000},
    ];
    assert.equal(map(5_000, points), 5_000);
    assert.equal(map(12_500, points), 12_500);
  });

  it('applies a constant audio offset', () => {
    const points = [
      {synthTime: 0, syncTime: 1_500},
      {synthTime: 10_000, syncTime: 11_500},
    ];
    assert.equal(map(5_000, points), 6_500);
  });

  it('applies Guitar Pro frame padding (audio starts before the song)', () => {
    // Real values from a GP7 file: FramePadding -117300 @ 44.1 kHz.
    const points = [
      {synthTime: 0, syncTime: 2_659.8639455782313},
      {synthTime: 144_000, syncTime: 146_659.86394557822},
    ];
    assert.ok(Math.abs(map(0, points) - 2_659.8639455782313) < 1e-6);
    assert.ok(Math.abs(map(72_000, points) - 74_659.86394557822) < 1e-6);
  });

  it('interpolates between segments with different tempos', () => {
    const points = [
      {synthTime: 0, syncTime: 0},
      {synthTime: 10_000, syncTime: 5_000},
      {synthTime: 20_000, syncTime: 15_000},
    ];
    assert.equal(map(5_000, points), 2_500);
    assert.equal(map(15_000, points), 10_000);
  });

  it('accounts for the playback speed', () => {
    const points = [
      {synthTime: 0, syncTime: 0},
      {synthTime: 10_000, syncTime: 10_000},
    ];
    // 30 s wall-clock at 0.5x equals 15 s on the score timeline.
    assert.equal(map(30_000, points, {speed: 0.5}), 15_000);
    // 15 s wall-clock at 2x equals 30 s on the score timeline.
    assert.equal(map(15_000, points, {speed: 2}), 30_000);
  });

  it('uses the audio duration for the last segment', () => {
    const points = [
      {synthTime: 0, syncTime: 0},
      {synthTime: 10_000, syncTime: 10_000},
    ];
    // Song ends at 20 s, audio is 30 s long -> 15 s becomes 20 s.
    assert.equal(map(15_000, points, {songEndTime: 20_000, audioDuration: 30_000}), 20_000);
  });

  it('clamps at the last sync point when the song end is not known', () => {
    const points = [
      {synthTime: 0, syncTime: 0},
      {synthTime: 10_000, syncTime: 10_000},
    ];
    assert.equal(map(15_000, points, {songEndTime: 10_000, audioDuration: 0}), 10_000);
  });

  it('extrapolates before the first sync point like alphaTab does', () => {
    const points = [
      {synthTime: 5_000, syncTime: 1_000},
      {synthTime: 10_000, syncTime: 6_000},
    ];
    assert.equal(map(0, points), -4_000);
  });
});

describe('extractAudioSyncPoints', () => {
  it('returns no points when the score has no backing track', () => {
    const score = {};
    assert.deepEqual(
      extractAudioSyncPoints(score, () => [{synthTime: 0, syncTime: 0}]),
      [],
    );
  });

  it('reads the generated sync points for an embedded audio file', () => {
    const score = {backingTrack: {rawAudioFile: new Uint8Array([1, 2, 3])}};
    const points = extractAudioSyncPoints(score, () => [
      {synthTime: 0, syncTime: 250},
      {synthTime: 5_000, syncTime: 5_250},
    ]);
    assert.deepEqual(points, [
      {synthTime: 0, syncTime: 250},
      {synthTime: 5_000, syncTime: 5_250},
    ]);
  });

  it('ignores invalid generated points and generator errors', () => {
    const score = {backingTrack: {rawAudioFile: new Uint8Array([1])}};
    assert.deepEqual(
      extractAudioSyncPoints(score, () => [
        {synthTime: 0, syncTime: 0},
        {synthTime: Number.NaN, syncTime: 10},
      ]),
      [{synthTime: 0, syncTime: 0}],
    );
    assert.deepEqual(
      extractAudioSyncPoints(score, () => {
        throw new Error('cannot generate');
      }),
      [],
    );
  });
});
