/** node --experimental-strip-types --test scripts/test-audio-history.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { detectBeats, lipSyncEnvelope, newAudioTrack } from '../src/lib/suites/motion/audio.ts';
import { newHistory, pushHistory, canUndo, canRedo, undo, redo } from '../src/lib/suites/motion/historyStack.ts';

// ── beat detection ──────────────────────────────────────────────────────

function makeClickTrack(sampleRate, durationSec, beatTimes, clickLenSamples = 200) {
  const n = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(n);
  for (const t of beatTimes) {
    const start = Math.floor(t * sampleRate);
    for (let i = 0; i < clickLenSamples && start + i < n; i++) samples[start + i] = 1;
  }
  return samples;
}

test('detectBeats: silence produces no beats', () => {
  const samples = new Float32Array(44100 * 2);
  assert.deepEqual(detectBeats(samples, 44100), []);
});

test('detectBeats: empty input or zero sample rate never throws', () => {
  assert.deepEqual(detectBeats([], 44100), []);
  assert.deepEqual(detectBeats(new Float32Array(1000), 0), []);
});

test('detectBeats: finds loud clicks dropped into an otherwise quiet track, near their true times', () => {
  const sampleRate = 44100;
  const beatTimes = [0.5, 1.0, 1.5, 2.0];
  const samples = makeClickTrack(sampleRate, 2.5, beatTimes);
  const found = detectBeats(samples, sampleRate);
  assert.ok(found.length > 0, 'should find at least one beat');
  for (const bt of beatTimes) {
    assert.ok(found.some((f) => Math.abs(f - bt) < 0.1), `expected a detected beat near ${bt}s, got ${JSON.stringify(found)}`);
  }
});

test('detectBeats: never reports two beats closer together than ~120ms (the min-gap rule)', () => {
  const sampleRate = 44100;
  const samples = makeClickTrack(sampleRate, 1, [0.3, 0.32, 0.34]); // three clicks crammed close together
  const found = detectBeats(samples, sampleRate);
  for (let i = 1; i < found.length; i++) assert.ok(found[i] - found[i - 1] >= 0.1, `beats ${found[i - 1]} and ${found[i]} are too close`);
});

// ── lip sync envelope ────────────────────────────────────────────────────

test('lipSyncEnvelope: silence gives an envelope of all (near-)zero values', () => {
  const samples = new Float32Array(44100);
  const env = lipSyncEnvelope(samples, 44100, 24);
  assert.ok(env.length > 0);
  for (const v of env) assert.ok(v < 0.05);
});

test('lipSyncEnvelope: a loud passage produces higher values than a quiet one', () => {
  const sampleRate = 44100;
  const n = sampleRate * 2;
  const samples = new Float32Array(n);
  // first half quiet, second half loud
  for (let i = 0; i < n; i++) samples[i] = i < n / 2 ? 0.02 * Math.sin(i * 0.1) : 0.9 * Math.sin(i * 0.1);
  const env = lipSyncEnvelope(samples, sampleRate, 24);
  const firstHalf = env.slice(0, Math.floor(env.length / 2));
  const secondHalf = env.slice(Math.floor(env.length / 2));
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  assert.ok(avg(secondHalf) > avg(firstHalf) * 2, `expected the loud half's average (${avg(secondHalf)}) to clearly exceed the quiet half's (${avg(firstHalf)})`);
});

test('lipSyncEnvelope: every value stays within [0, 1]', () => {
  const sampleRate = 44100;
  const n = sampleRate;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = Math.sin(i * 0.3) * 5; // deliberately "clipping"-loud input
  const env = lipSyncEnvelope(samples, sampleRate, 24);
  for (const v of env) assert.ok(v >= 0 && v <= 1);
});

test('lipSyncEnvelope: produces roughly fps * duration frames', () => {
  const sampleRate = 44100;
  const env = lipSyncEnvelope(new Float32Array(sampleRate * 2), sampleRate, 12); // 2s @ 12fps
  assert.ok(Math.abs(env.length - 24) <= 1);
});

// ── audio track helper ───────────────────────────────────────────────────

test('newAudioTrack: sensible defaults', () => {
  const t = newAudioTrack('voice', 'line1.mp3', 'data:audio/mp3;base64,AAAA', 3.2);
  assert.equal(t.role, 'voice');
  assert.equal(t.offset, 0);
  assert.equal(t.volume, 1);
  assert.equal(t.muted, false);
});

// ── history stack ─────────────────────────────────────────────────────────

test('newHistory: starts with exactly one entry, pointing at it', () => {
  const h = newHistory('a');
  assert.deepEqual(h.entries, ['a']);
  assert.equal(h.index, 0);
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
});

test('pushHistory/undo/redo: a basic linear sequence', () => {
  let h = newHistory('a');
  h = pushHistory(h, 'b');
  h = pushHistory(h, 'c');
  assert.deepEqual(h.entries, ['a', 'b', 'c']);
  assert.equal(h.index, 2);

  const u1 = undo(h);
  assert.notEqual(u1, null);
  h = u1.state; assert.equal(u1.value, 'b');

  const u2 = undo(h);
  h = u2.state; assert.equal(u2.value, 'a');
  assert.equal(canUndo(h), false);
  assert.equal(undo(h), null);

  const r1 = redo(h);
  h = r1.state; assert.equal(r1.value, 'b');
  const r2 = redo(h);
  h = r2.state; assert.equal(r2.value, 'c');
  assert.equal(canRedo(h), false);
  assert.equal(redo(h), null);
});

test('pushHistory: pushing after an undo drops the redo-able future', () => {
  let h = newHistory('a');
  h = pushHistory(h, 'b');
  h = pushHistory(h, 'c');
  h = undo(h).state; // back to 'b'
  h = pushHistory(h, 'd'); // a new branch
  assert.deepEqual(h.entries, ['a', 'b', 'd']);
  assert.equal(canRedo(h), false);
});

test('pushHistory: caps the stack length, dropping the oldest entries, without losing the ability to undo recent changes', () => {
  let h = newHistory(0);
  for (let i = 1; i <= 150; i++) h = pushHistory(h, i, 100);
  assert.equal(h.entries.length, 100);
  assert.equal(h.entries[h.entries.length - 1], 150);
  assert.equal(h.entries[0], 51); // the oldest 50 entries (0..50) got dropped
  const u = undo(h);
  assert.equal(u.value, 149);
});
