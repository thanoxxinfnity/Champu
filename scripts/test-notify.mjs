/** node --experimental-strip-types --test scripts/test-notify.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { noticeTopic, shouldNotify } from '../src/lib/agent/notify.ts';

const base = { currentSessionId: 's1', runSessionId: 's1', hidden: false, aborted: false };

test('no notice while the user is watching that very run', () => {
  assert.equal(shouldNotify(base), false);
});

test('a notice once the user has moved to another session', () => {
  assert.equal(shouldNotify({ ...base, currentSessionId: 's2' }), true);
});

test('a notice when the tab is in the background, same session or not', () => {
  assert.equal(shouldNotify({ ...base, hidden: true }), true);
  assert.equal(shouldNotify({ ...base, currentSessionId: 's2', hidden: true }), true);
});

test('a run the user cancelled never announces itself', () => {
  assert.equal(shouldNotify({ ...base, aborted: true }), false);
  assert.equal(shouldNotify({ ...base, currentSessionId: 's2', hidden: true, aborted: true }), false);
});

test('a fresh session that has not been saved yet still notifies', () => {
  assert.equal(shouldNotify({ ...base, currentSessionId: null }), true);
});

test('the topic is collapsed, trimmed and never empty', () => {
  assert.equal(noticeTopic('  build   me\n an addon '), 'build me an addon');
  assert.equal(noticeTopic('   '), 'Untitled run');
  assert.equal(noticeTopic(''), 'Untitled run');
});

test('a long topic is cut to length with an ellipsis', () => {
  const out = noticeTopic('x'.repeat(200));
  assert.equal(out.length, 70);
  assert.ok(out.endsWith('…'));
});

test('a topic exactly at the limit is left alone', () => {
  const exact = 'y'.repeat(70);
  assert.equal(noticeTopic(exact), exact);
});
