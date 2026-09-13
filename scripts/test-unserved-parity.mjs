/** node --experimental-strip-types --test scripts/test-unserved-parity.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

/**
 * The APK builds its own model catalogue natively, so the web build's filter
 * does not protect it. These two lists have to say the same thing, or dead ids
 * reach the switcher on the phone while the browser looks fine — which is
 * exactly how `meta/llama2-70b` came back.
 */

const ts = fs.readFileSync('src/lib/providers/unserved.ts', 'utf8');
const kt = fs.readFileSync('android/app/src/main/java/com/chomugiri/workspace/providers/Unserved.kt', 'utf8');

function tsIds() {
  const start = ts.indexOf('UNSERVED_IDS');
  const block = ts.slice(start, ts.indexOf(']);', start));
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

function ktIds() {
  const start = kt.indexOf('val IDS');
  const block = kt.slice(start, kt.indexOf(')', kt.indexOf('setOf(', start)));
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

test('the web and native unserved lists are identical', () => {
  assert.deepEqual(ktIds(), tsIds());
  assert.ok(tsIds().length >= 43, 'the list should not shrink silently');
});

test('the ids that came back on the phone are in both', () => {
  for (const id of ['meta/llama2-70b', 'bigcode/starcoder2-15b']) {
    assert.ok(tsIds().includes(id), `${id} missing from the web list`);
    assert.ok(ktIds().includes(id), `${id} missing from the native list`);
  }
});

test('the non-chat pattern is the same on both sides', () => {
  const tsPattern = /NON_CHAT = \/([^/]+)\//.exec(ts)[1];
  const ktPattern = /val NON_CHAT = Regex\("([^"]+)"/.exec(kt)[1];
  assert.equal(ktPattern, tsPattern);
});

test("NVIDIA's entitlement 404 is recognised by both", () => {
  // The body that identifies an unserved id, verbatim from a live call.
  const body = `{"detail":"Function '2fddadfb-7e76-4c8a-9b82-f7d3fab94471': Not found for account 'guYZkUDlhH0vxHCgXmcnJcEPh2-xf_4FGYCGN9a18RQ'"}`;
  assert.ok(/Function\s+'\[0-9a-f-\]\{8,\}'/.test(ts) || ts.includes('Not found for account'));
  assert.ok(kt.includes('Not found for account'));
  // And the web implementation actually matches it.
  return import('../src/lib/providers/unserved.ts').then((m) => {
    assert.equal(m.isUnservedError(404, body), true);
    assert.equal(m.isUnservedError(404, 'plain 404 page'), false);
    assert.equal(m.isUnservedError(200, body), false);
  });
});
