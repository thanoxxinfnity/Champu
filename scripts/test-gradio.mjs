/**
 * node --experimental-strip-types --test scripts/test-gradio.mjs
 *
 * These run against a real Gradio if one is listening, because the protocol is
 * the thing under test and a mock of it would only prove I can mock it.
 * Start one with scripts/dummy-gradio.py.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateOnServer, isShareUrl, serverIsUp } from '../src/lib/suites/godot/gradio.ts';

const LIVE = process.env.GRADIO_URL;

test('only an https gradio.live tunnel counts as a share URL', () => {
  // This address gets handed to something that then posts images to it, so it
  // is checked rather than trusted.
  assert.ok(isShareUrl('https://abc123.gradio.live'));
  assert.ok(isShareUrl('https://a-b-c.gradio.live/'));
  assert.ok(!isShareUrl('http://abc123.gradio.live'), 'plain http is not a tunnel worth trusting');
  assert.ok(!isShareUrl('https://gradio.live.evil.example'), 'suffix must be the host, not a prefix of it');
  assert.ok(!isShareUrl('https://evilgradio.live'), 'the dot matters');
  assert.ok(!isShareUrl('http://127.0.0.1:7861'));
  assert.ok(!isShareUrl('not a url'));
});

test('an unreachable server is reported, not thrown', async () => {
  const { up, why } = await serverIsUp('http://127.0.0.1:1', '/to_glb');
  assert.equal(up, false);
  assert.ok(why);
});

test('a server that is not Gradio does not pass for one', async (t) => {
  if (!LIVE) return t.skip('set GRADIO_URL to run this');
  const { up, why } = await serverIsUp(LIVE, '/not_a_real_endpoint');
  assert.equal(up, false);
  assert.match(why, /no \/not_a_real_endpoint/);
});

test('a live Gradio answers with a real glTF', async (t) => {
  if (!LIVE) return t.skip('set GRADIO_URL to run this');

  const ready = await serverIsUp(LIVE, '/to_glb');
  assert.ok(ready.up, ready.why);

  // A real PNG, because the upload step is multipart and the app opens it.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  const stages = [];
  const out = await generateOnServer(LIVE, new Uint8Array(png), {
    seed: 7,
    timeoutMs: 60_000,
    onStage: (m) => stages.push(m),
  });

  assert.equal(out.error, undefined, out.error);
  assert.ok(out.bytes, 'no bytes came back');
  assert.equal(String.fromCharCode(...out.bytes.subarray(0, 4)), 'glTF');
  assert.ok(stages.length >= 3, `expected progress, got ${stages.length} stages`);
});

test('an error from the app comes back as a message, not a hang', async (t) => {
  if (!LIVE) return t.skip('set GRADIO_URL to run this');
  // Zero bytes is not a PNG: the upload succeeds and the app rejects it, which
  // is the path where Gradio sends `event: error` rather than `complete`.
  const out = await generateOnServer(LIVE, new Uint8Array(0), { timeoutMs: 30_000 });
  assert.ok(out.error, 'an empty image should not look like success');
  assert.equal(out.bytes, undefined);
});
