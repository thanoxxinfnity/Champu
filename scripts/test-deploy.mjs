/** node --experimental-strip-types --test scripts/test-deploy.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { deployMode, hasEntryPoint, liveSite, nextRelease, preflight, recordAfter, targetProject } from '../src/lib/deploy/state.ts';

const LIVE = { url: 'https://demo.vercel.app', inspectorUrl: 'https://vercel.com/i', readyState: 'READY', project: 'demo', at: 1, releases: 2 };

test('nothing deployed yet means launch', () => {
  assert.equal(deployMode(null), 'launch');
  assert.equal(deployMode({ ...LIVE, url: null }), 'launch', 'a deploy with no URL is not a live site');
});

test('a live site means update', () => {
  assert.equal(deployMode(LIVE), 'update');
  assert.equal(liveSite(LIVE)?.project, 'demo');
});

test('an update ignores the typed name so the address survives', () => {
  assert.equal(targetProject(LIVE, 'something-else'), 'demo');
});

test('launching a separate site deliberately does use the typed name', () => {
  assert.equal(targetProject(LIVE, 'second-site', true), 'second-site');
  assert.equal(deployMode(LIVE, true), 'launch');
});

test('the first deployment is release 1', () => {
  assert.equal(nextRelease(null), 1);
  assert.equal(nextRelease(LIVE), 3);
});

test('preflight reports the first real blocker, in a useful order', () => {
  assert.deepEqual(preflight({ paths: [], token: 't', projectName: 'x' }), { ready: false, reason: 'no-files' });
  assert.deepEqual(preflight({ paths: ['index.html'], token: '', projectName: 'x' }), { ready: false, reason: 'no-token' });
  assert.deepEqual(preflight({ paths: ['index.html'], token: 't', projectName: '  ' }), { ready: false, reason: 'no-name' });
  assert.deepEqual(preflight({ paths: ['notes.md'], token: 't', projectName: 'x' }), { ready: false, reason: 'no-entry' });
  assert.deepEqual(preflight({ paths: ['index.html'], token: 't', projectName: 'x' }), { ready: true });
});

test('an entry point is recognised in each supported shape', () => {
  for (const p of ['index.html', 'package.json', 'src/app/page.tsx', 'pages/index.jsx', 'public/index.html']) {
    assert.ok(hasEntryPoint([p, 'other.txt']), p);
  }
  assert.ok(!hasEntryPoint(['README.md', 'src/util.ts']));
});

test('a failed update keeps the live site and does not count a release', () => {
  const after = recordAfter(LIVE, { ok: false, project: 'demo', error: 'build failed' }, 99);
  assert.equal(after.url, LIVE.url, 'the running site must survive a bad build');
  assert.equal(after.releases, 2, 'a failure is not a release');
  assert.equal(after.error, 'build failed');
  // And the next deployment still targets the same project rather than launching anew.
  assert.equal(deployMode(after), 'update');
});

test('a successful update advances the release count and the URL', () => {
  const after = recordAfter(LIVE, { ok: true, url: 'https://demo-v2.vercel.app', inspectorUrl: null, readyState: 'READY', project: 'demo' }, 99);
  assert.equal(after.releases, 3);
  assert.equal(after.url, 'https://demo-v2.vercel.app');
});

test('a first successful launch starts the count at 1', () => {
  const after = recordAfter(null, { ok: true, url: 'https://new.vercel.app', inspectorUrl: null, readyState: 'READY', project: 'new' });
  assert.equal(after.releases, 1);
});
