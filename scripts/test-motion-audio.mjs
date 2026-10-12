/** node --experimental-strip-types --test scripts/test-motion-audio.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mixChannelsDown, peaksFromSamples } from '../src/lib/suites/motion/audio.ts';

test('peaksFromSamples returns the requested number of buckets', () => {
  const samples = new Float32Array(1000).map((_, i) => Math.sin(i / 10));
  const peaks = peaksFromSamples(samples, 40);
  assert.equal(peaks.length, 40);
});

test('each bucket really does bound the samples inside it', () => {
  const samples = [0, 0.1, 0.9, -0.9, 0.2, 0.05, -0.3, 0.4];
  const peaks = peaksFromSamples(samples, 2);
  assert.equal(peaks[0].max, 0.9);
  assert.equal(peaks[0].min, -0.9);
});

test('an empty clip gives no buckets, not a crash', () => {
  assert.deepEqual(peaksFromSamples([], 10), []);
  assert.deepEqual(peaksFromSamples(new Float32Array(50), 0), []);
});

test('mixChannelsDown averages stereo into mono', () => {
  const l = new Float32Array([1, 1, -1]);
  const r = new Float32Array([-1, 0, 1]);
  const mono = mixChannelsDown([l, r]);
  assert.deepEqual(Array.from(mono), [0, 0.5, 0]);
});

test('mixChannelsDown with one channel returns it unchanged', () => {
  const l = new Float32Array([0.5, -0.5]);
  assert.equal(mixChannelsDown([l]), l);
});
