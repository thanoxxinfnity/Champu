/**
 * node --experimental-strip-types --test scripts/test-bridge-input.mjs
 *
 * Settings → Terminal Bridge used to be two boxes: a Tunnel URL field and a
 * separate Bridge token field. Live feedback: "sirf mera terminal url tunnel
 * se ho jana chahiye" (pasting just the tunnel should be enough) — the ask
 * was one field, not a redesigned trust model. The agent's startup banner
 * already prints "<tunnel-url>#<token>" as one copyable line, so the fix is
 * parsing that single paste back into the url/token pair the client needs,
 * not weakening the token requirement itself.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBridgeInput } from '../src/lib/bridge/parse.ts';

test('splits a url#token paste into url and token', () => {
  const { url, token } = parseBridgeInput('https://abc123.ngrok-free.app#Zx9-abcDEF_token');
  assert.equal(url, 'https://abc123.ngrok-free.app');
  assert.equal(token, 'Zx9-abcDEF_token');
});

test('also accepts a ?token= query param', () => {
  const { url, token } = parseBridgeInput('https://abc123.ngrok-free.app?token=hello');
  assert.equal(url, 'https://abc123.ngrok-free.app');
  assert.equal(token, 'hello');
});

test('a bare url with no token yields an empty token, not a guess', () => {
  const { url, token } = parseBridgeInput('https://abc123.ngrok-free.app');
  assert.equal(url, 'https://abc123.ngrok-free.app');
  assert.equal(token, '');
});

test('trims whitespace around the whole paste', () => {
  const { url, token } = parseBridgeInput('  https://abc123.ngrok-free.app#tok  ');
  assert.equal(url, 'https://abc123.ngrok-free.app');
  assert.equal(token, 'tok');
});

test('empty input yields empty url and token', () => {
  const { url, token } = parseBridgeInput('');
  assert.equal(url, '');
  assert.equal(token, '');
});
