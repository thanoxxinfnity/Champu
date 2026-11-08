/** node --experimental-strip-types --test scripts/test-pollinations-limit.mjs — Pollinations' free tier: one reply per ~45 s, and max_tokens above 4096 fails. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describePollinationsError, pollinationsChatConfig, POLLINATIONS_MAX_TOKENS } from '../src/lib/providers/pollinations.ts';
import { freeLimitWait } from '../src/lib/providers/free-limit.ts';

test('the free-limit answer keeps its wait, and the app reads it', () => {
  const body = JSON.stringify({ status: 402, success: false, error: { code: 'FREE_LIMIT', message: 'Free limit reached: 1 reply every 45 seconds per IP. Retry after 39s, or get unlimited replies with a pollen key at https://enter.pollinations.ai/?ref=classic' } });
  const e = describePollinationsError(402, body);
  assert.equal(e.code, 'FREE_LIMIT');
  assert.equal(e.retryable, true);
  assert.match(e.message, /Retry after 39s/);
  assert.equal(freeLimitWait(e.message), 40_000);
  assert.equal(freeLimitWait('Gateway returned 500.'), null);
  assert.equal(freeLimitWait(undefined), null);
  assert.equal(freeLimitWait('Free limit reached: 1 reply every 45 seconds per IP.'), 46_000);
  assert.equal(freeLimitWait('Free limit reached. Retry after 500s'), 91_000, 'a long wait is capped');
});

test('the request keeps max_tokens at 4096 or less, because 8192 fails every time upstream', () => {
  const cfg = pollinationsChatConfig();
  assert.equal(POLLINATIONS_MAX_TOKENS, 4096);
  assert.equal(cfg.shapeBody({ model: 'openai-fast', max_tokens: 8192, stream_options: { include_usage: true } }).max_tokens, 4096);
  assert.equal(cfg.shapeBody({ model: 'openai-fast', max_tokens: 1200 }).max_tokens, 1200);
  assert.equal('stream_options' in cfg.shapeBody({ stream_options: {} }), false);
  assert.equal(cfg.shapeBody({}).referrer, 'chomugiri');
});
