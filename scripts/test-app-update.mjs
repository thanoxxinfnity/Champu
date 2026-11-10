/** node --experimental-strip-types --test scripts/test-app-update.mjs — the app's own update check, and the NVIDIA model list. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { channelFor, checkForUpdate, isNewer, versionFromTitle } from '../src/lib/app-update.ts';

test('each build follows its own release', () => {
  assert.deepEqual(channelFor('com.chomugiri.workspace'), { tag: 'chomugiri-latest', asset: 'Chomugiri.apk' });
  assert.deepEqual(channelFor('com.chomugiri.workspace.next'), { tag: 'chomugiri-test-apk', asset: 'Chomugiri-Next.apk' });
  assert.deepEqual(channelFor('com.chomugiri.workspace.v2'), { tag: 'chomugiri-latest', asset: 'Chomugiri-alt.apk' });
});

test('the version is read from the release title', () => {
  assert.equal(versionFromTitle('Chomugiri v3.71 (latest)'), '3.71');
  assert.equal(versionFromTitle('Chomugiri Next v3.70-next.12'), '3.70-next.12');
  assert.equal(versionFromTitle('Chomugiri test build'), null);
});

test('newer means a higher number, then a higher build', () => {
  assert.equal(isNewer('3.71', '3.70'), true);
  assert.equal(isNewer('3.70', '3.70'), false);
  assert.equal(isNewer('3.9', '3.10'), false);
  assert.equal(isNewer('4.0', '3.99'), true);
  assert.equal(isNewer('3.70-next.12', '3.70-next.3'), true);
  assert.equal(isNewer('3.70-next.3', '3.70-next.3'), false);
  assert.equal(isNewer('3.70-next.2', '3.70-next1'), true);
  assert.equal(isNewer('3.71-next.1', '3.70-next.40'), true);
  assert.equal(isNewer('3.70', '3.70-next.4'), true);
});

const release = (name, asset) => ({ ok: true, status: 200, json: async () => ({ name, html_url: 'https://github.com/x/releases/tag/t', published_at: '2026-11-10T00:00:00Z', assets: [{ name: asset, browser_download_url: `https://github.com/x/releases/download/t/${asset}` }] }) });
globalThis.localStorage = { m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, v); } };

test('an update is offered only when the release is newer, and only inside the Android app', async () => {
  let calls = 0, url = '';
  const f = (name, asset) => async (u) => { calls++; url = u; return release(name, asset); };
  const sh = { platform: 'android', version: '3.70', appId: 'com.chomugiri.workspace' };
  const u = await checkForUpdate({ sh, force: true, fetchImpl: f('Chomugiri v3.71 (latest)', 'Chomugiri.apk') });
  assert.equal(u.latest, '3.71'); assert.equal(u.current, '3.70'); assert.match(u.url, /Chomugiri\.apk$/);
  assert.match(url, /releases\/tags\/chomugiri-latest$/);
  assert.equal(await checkForUpdate({ sh, force: true, fetchImpl: f('Chomugiri v3.70 (latest)', 'Chomugiri.apk') }), null);
  assert.equal(await checkForUpdate({ sh, force: true, fetchImpl: f('Chomugiri v3.71 (latest)', 'Other.apk') }), null, 'no file for this build, no offer');
  calls = 0;
  assert.equal(await checkForUpdate({ sh: null, fetchImpl: f('x', 'y') }), null);
  assert.equal(await checkForUpdate({ sh: { platform: 'android' }, fetchImpl: f('x', 'y') }), null, 'an old shell that does not say its version');
  assert.equal(calls, 0);
  const next = { platform: 'android', version: '3.70-next.2', appId: 'com.chomugiri.workspace.next' };
  const n = await checkForUpdate({ sh: next, force: true, fetchImpl: f('Chomugiri Next v3.70-next.5', 'Chomugiri-Next.apk') });
  assert.equal(n.latest, '3.70-next.5'); assert.match(url, /chomugiri-test-apk$/);
});

test('the answer is remembered for six hours', async () => {
  let calls = 0;
  const f = async () => { calls++; return release('Chomugiri v9.0 (latest)', 'Chomugiri.apk'); };
  const sh = { platform: 'android', version: '8.0', appId: 'com.chomugiri.workspace' };
  await checkForUpdate({ sh, force: true, fetchImpl: f, now: 1000 });
  const again = await checkForUpdate({ sh, fetchImpl: f, now: 1000 + 60_000 });
  assert.equal(calls, 1); assert.equal(again.latest, '9.0');
  await checkForUpdate({ sh, fetchImpl: f, now: 1000 + 7 * 3600_000 });
  assert.equal(calls, 2);
});

test('a GitHub error is said plainly', async () => {
  await assert.rejects(checkForUpdate({ sh: { platform: 'android', version: '1.0' }, force: true, fetchImpl: async () => ({ ok: false, status: 403 }) }), /busy/);
});

test('NVIDIA: both platforms can list every model on request, and the shell says its version', () => {
  assert.match(readFileSync(new URL('../src/app/api/models/route.ts', import.meta.url), 'utf8'), /searchParams\.get\('all'\)/);
  assert.match(readFileSync(new URL('../android/app/src/main/java/com/chomugiri/workspace/server/ApiRouter.kt', import.meta.url), 'utf8'), /"origin", "unverified"/);
  assert.match(readFileSync(new URL('../android/app/src/main/java/com/chomugiri/workspace/MainActivity.kt', import.meta.url), 'utf8'), /version: '\$\{appVersion\(\)\}', appId: '\$\{packageName\}'/);
});
