/** node --experimental-strip-types --test scripts/test-store-shots.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { composeStoreFrame, defaultHeadline, STORE_SPECS, storeFrameEntries, storeReadme } from '../src/lib/suites/canvas/store.ts';

const screen = (over = {}) => ({
  id: 's1', name: 'Home feed', device: 'phone', brief: 'the home feed',
  html: '<!doctype html><html><body style="background:#111"><h1>Hi</h1></body></html>',
  x: 0, y: 0, ...over,
});

test('every target has a positive upload size and a board device it comes from', () => {
  for (const key of ['iphone', 'ipad', 'android']) {
    const spec = STORE_SPECS[key];
    assert.ok(spec.w > 0 && spec.h > 0, key);
    assert.ok(spec.device === 'phone' || spec.device === 'tablet', key);
    // Portrait: taller than wide, like every real store upload.
    assert.ok(spec.h > spec.w, key);
  }
});

test('a composed frame is sized to the target canvas and carries the headline and the screen', () => {
  const html = composeStoreFrame(screen(), { target: 'iphone', headline: 'Track every rupee', background: '#111', ink: '#fff', headlineOnTop: true });
  assert.match(html, /width:1290px;height:2796px/);
  assert.match(html, /Track every rupee/);
  assert.match(html, /<iframe srcdoc="/);
  // The embedded screen's own markup survives, escaped into the attribute.
  assert.match(html, /&lt;h1&gt;Hi&lt;\/h1&gt;/);
});

test('a headline and screen name are escaped, never broken out of their attribute or tag', () => {
  const html = composeStoreFrame(screen({ name: '"><script>x</script>' }), { target: 'android', headline: '<b>bold</b>', background: '#000', ink: '#fff', headlineOnTop: true });
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(!html.includes('<b>bold</b>'));
});

test('the android bezel has no notch or island cutout; the iPhone frame does', () => {
  const android = composeStoreFrame(screen(), { target: 'android', headline: 'h', background: '#000', ink: '#fff', headlineOnTop: true });
  const iphone = composeStoreFrame(screen(), { target: 'iphone', headline: 'h', background: '#000', ink: '#fff', headlineOnTop: true });
  assert.ok(!/border-radius:16px;background:#000;z-index:2/.test(android));
  assert.match(iphone, /border-radius:16px;background:#000;z-index:2/);
});

test('a default headline comes from the screen name even when the name is empty', () => {
  assert.equal(defaultHeadline(screen({ name: 'settings' })), 'Settings');
  assert.ok(defaultHeadline(screen({ name: '' })).length > 0);
});

test('exporting only frames screens whose device matches the target, and never collides two file names', () => {
  const board = {
    title: 't',
    screens: [
      screen({ id: 'a', name: 'Home', device: 'phone' }),
      screen({ id: 'b', name: 'Home', device: 'phone' }), // same name as a — must not collide
      screen({ id: 'c', name: 'Dashboard', device: 'tablet' }),
    ],
  };
  const phone = storeFrameEntries(board, { target: 'android' });
  assert.equal(phone.length, 2);
  assert.equal(new Set(phone.map((e) => e.path)).size, 2);
  assert.ok(phone.every((e) => e.path.startsWith('store/android/')));

  const tablet = storeFrameEntries(board, { target: 'ipad' });
  assert.equal(tablet.length, 1);
  assert.match(tablet[0].path, /^store\/ipad\//);
});

test('per-screen overrides win over the shared background and the default headline', () => {
  const board = { title: 't', screens: [screen({ id: 'a' })] };
  const entries = storeFrameEntries(board, {
    target: 'android',
    background: '#222',
    perScreen: { a: { headline: 'Custom line', background: '#fff' } },
  });
  assert.match(entries[0].content, /Custom line/);
  assert.match(entries[0].content, /#fff/);
});

test('the readme names the target and the count', () => {
  const r = storeReadme('ipad', 3);
  assert.match(r, /3 screens framed/);
  assert.match(r, /2064×2752/);
});
