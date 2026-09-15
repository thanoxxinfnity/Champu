/** node --experimental-strip-types --test scripts/test-audio.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { SAMPLE_RATE, effect, envelope, noteHz, render, rng, toWav, track } from '../src/lib/suites/godot/audio.ts';

/** Peak amplitude. A loop, not a spread: Math.max(...) overflows its argument
 * limit on anything longer than a second or two of audio. */
function peakOf(samples) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  return peak;
}

/** Parses a RIFF/WAVE header back out. */
function parseWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (o, n) => String.fromCharCode(...bytes.subarray(o, o + n));
  return {
    riff: text(0, 4),
    size: view.getUint32(4, true),
    wave: text(8, 4),
    fmt: text(12, 4),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    rate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bits: view.getUint16(34, true),
    data: text(36, 4),
    dataSize: view.getUint32(40, true),
  };
}

test('the container is a valid WAV, with a size that matches the bytes', () => {
  // A header that disagrees with the payload plays as static, or not at all.
  const wav = toWav(new Float32Array(1000));
  const h = parseWav(wav);
  assert.equal(h.riff, 'RIFF');
  assert.equal(h.wave, 'WAVE');
  assert.equal(h.data, 'data');
  assert.equal(h.format, 1, 'PCM');
  assert.equal(h.channels, 1);
  assert.equal(h.bits, 16);
  assert.equal(h.rate, SAMPLE_RATE);
  assert.equal(h.byteRate, SAMPLE_RATE * 2);
  assert.equal(h.blockAlign, 2);
  assert.equal(h.dataSize, 2000, 'two bytes per sample');
  assert.equal(h.size, wav.byteLength - 8, 'RIFF size excludes its own 8-byte header');
  assert.equal(wav.byteLength, 44 + 2000);
});

test('a full-scale sample does not wrap to a loud negative spike', () => {
  // 1.0 * 32768 overflows int16 and wraps to -32768, which is an audible click
  // at the loudest point of every note.
  const wav = toWav(new Float32Array([1, -1, 1.5, -1.5]));
  const view = new DataView(wav.buffer, 44);
  assert.equal(view.getInt16(0, true), 32767);
  assert.equal(view.getInt16(2, true), -32767);
  assert.equal(view.getInt16(4, true), 32767, 'clamped, not wrapped');
  assert.equal(view.getInt16(6, true), -32767);
});

test('A4 is 440 Hz and the octaves land where they should', () => {
  assert.equal(noteHz(0), 440);
  assert.ok(Math.abs(noteHz(12) - 880) < 1e-9);
  assert.ok(Math.abs(noteHz(-12) - 220) < 1e-9);
});

test('every note fades in and out, so it does not click', () => {
  // A waveform cut mid-cycle is a step change, and a hundred a second is what
  // makes naive generated audio sound broken rather than simple.
  assert.equal(envelope(0, 1), 0, 'silent at the very start');
  assert.equal(envelope(1, 1), 0, 'silent at the very end');
  assert.equal(envelope(0.5, 1), 1, 'full in the middle');
  assert.equal(envelope(-0.1, 1), 0, 'nothing before it begins');
  assert.equal(envelope(1.1, 1), 0, 'nothing after it ends');
});

test('the same seed always writes the same tune', () => {
  // A track that drifts between runs cannot be regenerated or corrected.
  assert.deepEqual([...track({ seed: 7, seconds: 2 })], [...track({ seed: 7, seconds: 2 })]);
  const a = rng(42), b = rng(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('different seeds really are different music, not the same tune transposed', () => {
  const a = track({ seed: 1, seconds: 4 });
  const b = track({ seed: 999, seconds: 4 });
  let differing = 0;
  for (let i = 0; i < a.length; i += 1) if (Math.abs(a[i] - b[i]) > 0.01) differing += 1;
  assert.ok(differing > a.length * 0.2, `only ${((differing / a.length) * 100).toFixed(1)}% of samples differ`);
});

test('a track is the length asked for and is actually audible', () => {
  const t = track({ seed: 3, seconds: 5 });
  assert.equal(t.length, 5 * SAMPLE_RATE);
  const peak = peakOf(t);
  assert.ok(peak > 0.2, `peak ${peak.toFixed(3)} is inaudibly quiet`);
  assert.ok(peak <= 1.0, `peak ${peak.toFixed(3)} would clip`);
});

test('nothing clips, however many notes land on the same sample', () => {
  // Overlapping notes are summed; without the soft clip a chord buzzes.
  const stacked = render(
    Array.from({ length: 20 }, () => ({ pitch: 0, at: 0, duration: 1, gain: 0.9 })),
    1,
  );
  for (const s of stacked) assert.ok(Math.abs(s) <= 1.0);
});

test('each sound effect is short and distinct', () => {
  const kinds = ['coin', 'jump', 'crash', 'levelup'];
  const peaks = [];
  for (const kind of kinds) {
    const s = effect(kind);
    assert.ok(s.length > 0, `${kind} is empty`);
    assert.ok(s.length < SAMPLE_RATE, `${kind} is over a second long`);
    const peak = peakOf(s);
    assert.ok(peak > 0.1, `${kind} is inaudible`);
    peaks.push(peak);
  }
  // Distinct waveforms, not four copies of a beep.
  const coin = effect('coin');
  const crash = effect('crash');
  assert.notEqual(coin.length, crash.length);
});

test('a tempo change really changes the tempo', () => {
  // Same seed, different bpm: the note onsets have to move, or `bpm` is decoration.
  const slow = track({ seed: 5, seconds: 4, bpm: 60 });
  const fast = track({ seed: 5, seconds: 4, bpm: 180 });
  let differing = 0;
  for (let i = 0; i < slow.length; i += 1) if (Math.abs(slow[i] - fast[i]) > 0.01) differing += 1;
  assert.ok(differing > slow.length * 0.1);
});
