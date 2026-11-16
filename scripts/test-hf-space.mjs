/** node --experimental-strip-types --test scripts/test-hf-space.mjs — the one-tap update of a Hugging Face Space terminal, and its start-up script. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SPACE_DOCKERFILE, spaceSubdomain, subdomainOf, updateSpace } from '../src/lib/bridge/hf-space.ts';
import { DEFAULT_SOURCE, fetchBridge } from '../agent/docker/boot.mjs';

const root = new URL('..', import.meta.url).pathname;

test('the Dockerfile the app commits is the one in the repository, and points at the bridge source the boot script uses', () => {
  assert.equal(SPACE_DOCKERFILE, readFileSync(path.join(root, 'agent/docker/Dockerfile.space'), 'utf8'));
  assert.ok(SPACE_DOCKERFILE.includes(`CHOMUGIRI_SOURCE=${DEFAULT_SOURCE}`));
  assert.ok(SPACE_DOCKERFILE.includes('CMD ["node", "boot.mjs"]') && SPACE_DOCKERFILE.includes('USER 1000'));
});

test('agent/manifest.json is current: the version and every bridge file, with their hash', () => {
  const m = JSON.parse(readFileSync(path.join(root, 'agent/manifest.json'), 'utf8'));
  const files = readdirSync(path.join(root, 'agent')).filter((n) => n.endsWith('.mjs')).sort();
  assert.deepEqual(m.files, files);
  assert.equal(m.version, /const VERSION = '([^']+)'/.exec(readFileSync(path.join(root, 'agent/chomugiri-agent.mjs'), 'utf8'))[1]);
  const sha = createHash('sha256');
  for (const n of files) sha.update(readFileSync(path.join(root, 'agent', n)));
  assert.equal(m.sha256, sha.digest('hex').slice(0, 16), 'run: node scripts/sync-agent-assets.mjs');
});

test('a Space is recognised from its address', () => {
  assert.equal(spaceSubdomain('https://tertrxcuvuvjvj-voicer.hf.space'), 'tertrxcuvuvjvj-voicer');
  assert.equal(spaceSubdomain('http://127.0.0.1:7717'), null);
  assert.equal(subdomainOf('Some_User/My.Space'), 'some-user-my-space');
});

const hub = (over = {}) => {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.endsWith('/api/whoami-v2')) return over.whoami ?? json(200, { name: 'tejas', orgs: [{ name: 'chomu-org' }] });
    if (u.includes('/api/spaces?author=tejas')) return json(200, [{ id: 'tejas/other' }, { id: 'tejas/my-term' }]);
    if (u.includes('/api/spaces?author=')) return json(200, []);
    if (u.endsWith('/secrets')) return over.secret ?? json(200, {});
    if (u.endsWith('/commit/main')) return over.commit ?? json(200, { commitUrl: 'x' });
    return json(404, {});
  };
  return { f, calls };
};

test('one tap: the account, the Space, the token kept as a secret, the Dockerfile committed', async () => {
  const { f, calls } = hub();
  const steps = [];
  const r = await updateSpace({ hfToken: 'hf_write', bridgeUrl: 'https://tejas-my-term.hf.space', bridgeToken: 'bridge-secret', fetchImpl: f, onStep: (s) => steps.push(s) });
  assert.equal(r.repo, 'tejas/my-term');
  assert.deepEqual(steps, ['account', 'space', 'secret', 'commit']);
  const secret = calls.find((c) => c.url.endsWith('/api/spaces/tejas/my-term/secrets'));
  assert.deepEqual(JSON.parse(secret.init.body).key, 'CHOMUGIRI_TOKEN');
  assert.equal(JSON.parse(secret.init.body).value, 'bridge-secret');
  const commit = calls.find((c) => c.url.endsWith('/api/spaces/tejas/my-term/commit/main'));
  assert.equal(commit.init.headers['Content-Type'], 'application/x-ndjson');
  const lines = commit.init.body.split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].key, 'header');
  assert.equal(lines[1].value.path, 'Dockerfile');
  assert.equal(Buffer.from(lines[1].value.content, 'base64').toString('utf8'), SPACE_DOCKERFILE);
  for (const c of calls) assert.equal(c.init.headers?.Authorization, 'Bearer hf_write');
});

test('plain words when it cannot be done, and nothing is committed', async () => {
  await assert.rejects(updateSpace({ hfToken: 'x', bridgeUrl: 'http://localhost:7717', bridgeToken: 't', fetchImpl: hub().f }), /not a Hugging Face Space/);
  await assert.rejects(updateSpace({ hfToken: '', bridgeUrl: 'https://tejas-my-term.hf.space', bridgeToken: 't', fetchImpl: hub().f }), /Add your Hugging Face token/);
  await assert.rejects(updateSpace({ hfToken: 'bad', bridgeUrl: 'https://tejas-my-term.hf.space', bridgeToken: 't', fetchImpl: hub({ whoami: new Response('{}', { status: 401 }) }).f }), /did not accept the token/);
  const other = hub();
  await assert.rejects(updateSpace({ hfToken: 'x', bridgeUrl: 'https://someone-else.hf.space', bridgeToken: 't', fetchImpl: other.f }), /None of the Spaces/);
  assert.ok(!other.calls.some((c) => c.url.endsWith('/commit/main')));
  const ro = hub({ secret: new Response('{}', { status: 403 }) });
  await assert.rejects(updateSpace({ hfToken: 'read', bridgeUrl: 'https://tejas-my-term.hf.space', bridgeToken: 't', fetchImpl: ro.f }), /write access/);
  assert.ok(!ro.calls.some((c) => c.url.endsWith('/commit/main')));
});

test('the boot script fetches the bridge files, keeps the old copy when a download breaks, and skips when nothing changed', async () => {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'boot-')), 'agent');
  const files = { 'chomugiri-agent.mjs': `// bridge\n${'x'.repeat(300)}`, 'jobs.mjs': `// jobs\n${'y'.repeat(300)}` };
  let manifest = { version: '9.9.9', files: Object.keys(files), sha256: 'aaaa' };
  let broken = false, n = 0;
  const f = async (url) => {
    n++;
    const name = String(url).split('/').pop();
    if (name === 'manifest.json') return new Response(JSON.stringify(manifest), { status: 200 });
    if (broken && name === 'jobs.mjs') return new Response('gone', { status: 404 });
    return files[name] ? new Response(files[name], { status: 200 }) : new Response('', { status: 404 });
  };
  const quiet = () => {};
  const a = await fetchBridge({ source: 'https://src.example/agent/', dir, fetchImpl: f, log: quiet });
  assert.deepEqual(a, { version: '9.9.9', changed: true });
  assert.equal(readFileSync(path.join(dir, 'jobs.mjs'), 'utf8'), files['jobs.mjs']);
  n = 0;
  assert.equal((await fetchBridge({ source: 'https://src.example/agent', dir, fetchImpl: f, log: quiet })).changed, false);
  assert.equal(n, 1, 'only the manifest is read when nothing changed');
  manifest = { ...manifest, version: '10.0.0', sha256: 'bbbb' }; broken = true;
  await assert.rejects(fetchBridge({ source: 'https://src.example/agent', dir, fetchImpl: f, log: quiet }), /jobs\.mjs: 404/);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version, '9.9.9', 'the working copy is untouched');
  manifest = { version: '1', files: ['../evil.mjs', 'chomugiri-agent.mjs'], sha256: 'cc' };
  await assert.rejects(fetchBridge({ source: 'https://src.example/agent', dir, fetchImpl: f, log: quiet }), /unexpected file name/);
  assert.ok(!existsSync(path.join(dir, '..', 'evil.mjs')));
  rmSync(path.dirname(dir), { recursive: true, force: true });
});
