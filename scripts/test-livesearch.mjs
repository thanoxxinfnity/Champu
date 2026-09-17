/** node --experimental-strip-types --test scripts/test-livesearch.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLiveSearch, liveSearchContext, needsLiveSearch } from '../src/lib/agent/livesearch.ts';
import { buildSystemPrompt } from '../src/lib/agent/system-prompt.ts';

test('freshness and lookup language triggers a search; ordinary code requests do not', () => {
  const yes = [
    'what is the latest version of Godot',
    'what is the current Godot download size',
    'search the web for Pixal3D',
    'look up the newest Kaggle GPU quota',
    'any updates on TRELLIS this week',
    'aaj kal Godot ka size kitna hai',
    'abhi ka latest wala Kaggle plan kya hai',
  ];
  for (const text of yes) {
    assert.equal(needsLiveSearch(text).needed, true, `expected a trigger for: ${text}`);
  }

  const no = [
    'write me a for loop in python',
    'explain how recursion works',
    'build a zombie survival game',
    'fix this typescript error',
    'what is a linked list',
  ];
  for (const text of no) {
    assert.equal(needsLiveSearch(text).needed, false, `did not expect a trigger for: ${text}`);
  }
});

test('a version question without a recent year still triggers on the question shape', () => {
  // "which version of X" / "what version" reads as wanting a current answer
  // even with no year mentioned at all.
  assert.equal(needsLiveSearch('which version of Godot should I use').needed, true);
  assert.equal(needsLiveSearch('what version of Node does this need').needed, true);
});

test('liveSearchContext never throws, and returns null rather than empty hits', async () => {
  // No network mock — search() already has its own free-chain fallback all
  // the way down to Wikipedia, so this either gets real hits or null, never
  // an unhandled rejection reaching the chat turn.
  const result = await liveSearchContext('Godot game engine', { limit: 3 });
  if (result) {
    assert.ok(result.hits.length > 0, 'a non-null result must carry at least one hit');
    assert.ok(result.query.length > 0);
    assert.ok(result.provider.length > 0);
    for (const hit of result.hits) {
      assert.ok(hit.url.startsWith('http'), `hit url should be absolute: ${hit.url}`);
    }
  }
});

test('a very short or empty message produces no query to search', async () => {
  const result = await liveSearchContext('  ', { limit: 3 });
  assert.equal(result, null);
});

test('formatLiveSearch numbers every hit and names the query and provider', () => {
  const block = formatLiveSearch({
    query: 'godot 4 latest release',
    provider: 'duckduckgo-html',
    attempts: 'duckduckgo-html: 2 hits',
    hits: [
      { title: 'Godot 4.5 released', url: 'https://godotengine.org/article/godot-4-5', snippet: 'The latest stable release.' },
      { title: 'Download Godot', url: 'https://godotengine.org/download', snippet: '' },
    ],
  });
  assert.match(block, /LIVE SEARCH RESULTS for "godot 4 latest release"/);
  assert.match(block, /via duckduckgo-html/);
  assert.match(block, /1\. Godot 4\.5 released — https:\/\/godotengine\.org\/article\/godot-4-5/);
  assert.match(block, /2\. Download Godot — https:\/\/godotengine\.org\/download/);
  // A hit with no snippet still reads as a real line, not a blank one nobody
  // can tell apart from a formatting bug.
  assert.match(block, /\(no summary given\)/);
});

test('buildSystemPrompt includes the live search block only when one is passed', () => {
  const without = buildSystemPrompt({ lane: 'A' });
  assert.ok(!without.includes('LIVE SEARCH RESULTS'));

  const withIt = buildSystemPrompt({
    lane: 'A',
    liveSearch: {
      query: 'latest Godot version',
      provider: 'wikipedia',
      attempts: 'wikipedia: 1 hits',
      hits: [{ title: 'Godot (game engine)', url: 'https://en.wikipedia.org/wiki/Godot_(game_engine)', snippet: 'An open source engine.' }],
    },
  });
  assert.match(withIt, /LIVE SEARCH RESULTS for "latest Godot version"/);
  assert.match(withIt, /Godot \(game engine\)/);
});

test('the chat runtime actually calls the live search step before building the prompt', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/lib/agent/runtime.ts', import.meta.url), 'utf8');

  assert.match(src, /import \{ liveSearchContext, needsLiveSearch, type LiveSearchResult \} from '\.\/livesearch';/);
  assert.match(src, /needsLiveSearch\(input\)\.needed/);
  assert.match(src, /liveSearch = await liveSearchContext\(input,/);

  // The result actually reaches buildSystemPrompt, not just a local variable
  // that gets computed and then forgotten.
  const call = /const systemPrompt = buildSystemPrompt\(\{[\s\S]*?\n {4}\}\);/.exec(src)[0];
  assert.match(call, /\.\.\.\(liveSearch \? \{ liveSearch \} : \{\}\)/);

  // The search runs *before* the prompt is built, not after — a search result
  // computed after the prompt was assembled would never reach the model.
  assert.ok(src.indexOf('needsLiveSearch(input).needed') < src.indexOf('const systemPrompt = buildSystemPrompt'));

  // A search that actually found something is shown to the user, not applied
  // silently — the same transparency the game-design plan note already gets.
  const searchBlock = src.slice(src.indexOf('needsLiveSearch(input).needed'), src.indexOf('const systemPrompt = buildSystemPrompt'));
  assert.match(searchBlock, /Searched the web for/);
});
