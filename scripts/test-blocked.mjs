/** node --experimental-strip-types --test scripts/test-blocked.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { wafBlock } from '../src/lib/providers/blocked.ts';

// The real page tabitoken.com answers with, trimmed.
const CLOUDFLARE = `<!DOCTYPE html>
<html class="no-js" lang="en-US"><head><title>Attention Required! | Cloudflare</title></head>
<body><h1>Sorry, you have been blocked</h1><h2>You are unable to access tabitoken.com</h2>
<p>This website is using a security service to protect itself from online attacks.</p>
<span>Cloudflare Ray ID: a3acf1728b172d28</span></body></html>`;

test('a Cloudflare block page is not an API key problem', () => {
  const info = wafBlock(403, { 'content-type': 'text/html; charset=UTF-8', server: 'cloudflare', 'cf-ray': 'a3acf1728b172d28' }, CLOUDFLARE);
  assert.ok(info);
  assert.equal(info.service, 'Cloudflare');
  assert.equal(info.reference, 'a3acf1728b172d28');
  assert.match(info.message, /not your API key/);
  // The reference is what the endpoint's support actually needs.
  assert.match(info.message, /a3acf1728b172d28/);
});

test('the Ray ID is recovered from the page when the header is absent', () => {
  const info = wafBlock(403, { 'content-type': 'text/html' }, CLOUDFLARE);
  assert.equal(info.reference, 'a3acf1728b172d28');
});

test('a JSON error is the API speaking, and is left alone', () => {
  // Anthropic's real 401 body. Reporting this as a firewall block would be just
  // as wrong in the other direction.
  assert.equal(
    wafBlock(401, { 'content-type': 'application/json' }, '{"type":"error","error":{"type":"authentication_error","message":"x-api-key header is required"}}'),
    null,
  );
  assert.equal(wafBlock(403, { 'content-type': 'application/json' }, '{"error":{"message":"forbidden"}}'), null);
});

test('only refusing statuses are considered', () => {
  assert.equal(wafBlock(200, { 'content-type': 'text/html' }, CLOUDFLARE), null);
  assert.equal(wafBlock(500, { 'content-type': 'text/html' }, '<html>oops</html>'), null);
});

test('a Headers object works as well as a plain map', () => {
  const headers = new Headers({ 'content-type': 'text/html', server: 'cloudflare', 'cf-ray': 'abc12345' });
  assert.equal(wafBlock(403, headers, CLOUDFLARE)?.reference, 'abc12345');
});
