/** node --experimental-strip-types --test scripts/test-search.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeAttempts, looksRelevant, search } from '../src/lib/search/index.ts';

// The exact shape a real, live request against Bing returned for a query
// about Godot's latest version: a real b_algo-classed results page, seven
// hits, all of them unrelated news homepages. Bing's markup and its own
// "this succeeded" signals gave no indication anything was wrong — only the
// content did.
const BING_DECOY = [
  { url: 'https://www.foxnews.com/', title: 'Fox News - Breaking News Updates | Latest News Headlines', snippet: '' },
  { url: 'https://www.nytimes.com/', title: 'The New York Times - Breaking News, US News, World News', snippet: '' },
  { url: 'https://www.cnn.com/', title: 'Breaking News, Latest News and Videos | CNN', snippet: '' },
  { url: 'https://apnews.com/', title: 'Associated Press News: Breaking News, Latest Headlines', snippet: '' },
  { url: 'https://www.yahoo.com/news/', title: 'Yahoo News: Latest and Breaking News, Headlines', snippet: '' },
];

test('a decoy page of unrelated news homepages is rejected, not accepted as a real answer', () => {
  assert.equal(looksRelevant('what is the latest stable Godot version', BING_DECOY), false);
});

test('real results that actually mention the subject pass', () => {
  const real = [
    { url: 'https://godotengine.org/download/', title: 'Download - Godot Engine', snippet: 'Get the latest stable release.' },
  ];
  assert.equal(looksRelevant('what is the latest stable Godot version', real), true);
});

test('freshness filler words in the query do not count as "meaningful" on their own', () => {
  // If "latest"/"current"/"version" themselves counted, almost any junk page
  // that happens to say "Latest News" would pass — which is exactly the
  // decoy shape above. The gate must be judging the *subject*, not the
  // freshness vocabulary the query and the junk both happen to share.
  const newsJunk = [{ url: 'https://example.com/', title: 'Latest News Updates - Current Version 2.0', snippet: '' }];
  assert.equal(looksRelevant('what is the latest current version', newsJunk), true, 'sanity: no subject word at all, nothing to fail on');
  assert.equal(looksRelevant('what is the latest version of Godot', newsJunk), false, 'the actual subject, "godot", is what must be checked for');
});

test('a query with nothing distinctive to check is let through rather than blocked forever', () => {
  // Every word here is a stopword or under the length floor — there is no
  // subject to demand a match on, so this must not silently return zero
  // results for every short or generic query.
  assert.equal(looksRelevant('is it', [{ url: 'https://x.com', title: 'x', snippet: '' }]), true);
});

test('the live chain actually answers a real freshness question end to end', async () => {
  // Real network call, no mocks — this is the thing that broke in production:
  // Bing's decoy is intermittent (a second real run answered honestly), so
  // the invariant that must always hold is not "which provider answered" but
  // that whatever came back is actually about the query — the exact property
  // the decoy violated and nothing about Bing's own success signals caught.
  const outcome = await search('what is the latest stable Godot version', 5);
  if (!outcome.hits.length) {
    console.log(`    (no network reachable — attempts: ${describeAttempts(outcome.attempts)})`);
    return;
  }
  const mentionsGodot = outcome.hits.some((h) => `${h.title} ${h.snippet}`.toLowerCase().includes('godot'));
  assert.ok(mentionsGodot, `no hit mentioned Godot (via ${outcome.provider}) — attempts: ${describeAttempts(outcome.attempts)}`);
});
