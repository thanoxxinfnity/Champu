/** node --experimental-strip-types --test scripts/test-bridge-update.mjs — updating an old terminal bridge. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compareVersions, lacksKeyStore, portOf, pushAgentFiles, restartCommand, UPDATE_DIR } from '../src/lib/bridge/update.ts';

test('versions compare numerically', () => {
  assert.equal(compareVersions('1.1.0', '1.2.0'), -1);
  assert.equal(compareVersions('1.10.0', '1.2.0'), 1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
});

test('a bridge without the key store is recognised, from its features or its version', () => {
  assert.equal(lacksKeyStore({ version: '1.1.0' }), true);
  assert.equal(lacksKeyStore({ version: '1.2.0' }), false);
  assert.equal(lacksKeyStore({ version: '1.1.0', features: ['keys'] }), false);
  assert.equal(lacksKeyStore({}), true);
  assert.equal(lacksKeyStore(null), false, 'no bridge, nothing to update');
});

test('the restart command keeps the workspace, port and token', () => {
  const c = restartCommand({ workspace: '/home/u/chomugiri-work/', token: 'T0KEN', url: 'http://127.0.0.1:7718' });
  assert.equal(c, `node "/home/u/chomugiri-work/${UPDATE_DIR}/chomugiri-agent.mjs" --workspace "/home/u/chomugiri-work" --port 7718 --token T0KEN`);
  assert.equal(portOf('https://x.ngrok-free.app'), 7717);
  assert.equal(portOf('http://localhost:9000'), 9000);
});

test('the agent files are read from the app and written into the bridge workspace', async () => {
  const served = { '/agent/manifest.json': JSON.stringify({ version: '1.2.0', files: ['chomugiri-agent.mjs', 'keystore.mjs'] }), '/agent/chomugiri-agent.mjs': 'A', '/agent/keystore.mjs': 'K' };
  let written;
  const r = await pushAgentFiles({ fetchText: async (p) => served[p], writeFiles: async (f) => { written = f; } });
  assert.equal(r.version, '1.2.0');
  assert.deepEqual(written, [{ path: `${UPDATE_DIR}/chomugiri-agent.mjs`, content: 'A' }, { path: `${UPDATE_DIR}/keystore.mjs`, content: 'K' }]);
  await assert.rejects(pushAgentFiles({ fetchText: async () => JSON.stringify({ version: '1', files: ['x.mjs'] }), writeFiles: async () => {} }), /no bridge files/);
  await assert.rejects(pushAgentFiles({ fetchText: async () => JSON.stringify({ version: '1', files: ['chomugiri-agent.mjs', '../evil.mjs'] }), writeFiles: async () => {} }), /Unexpected file name/);
});

test('the copies the app carries match the agent, and the agent says it can hold keys', () => {
  execFileSync('node', ['scripts/sync-agent-assets.mjs'], { stdio: 'pipe' });
  const m = JSON.parse(readFileSync('public/agent/manifest.json', 'utf8'));
  const agent = readFileSync('agent/chomugiri-agent.mjs', 'utf8');
  assert.equal(m.version, /const VERSION = '([^']+)'/.exec(agent)[1]);
  assert.ok(m.files.includes('keystore.mjs') && m.files.includes('chomugiri-agent.mjs'));
  assert.equal(readFileSync('public/agent/keystore.mjs', 'utf8'), readFileSync('agent/keystore.mjs', 'utf8'));
  assert.match(agent, /features: \['keys'\]/);
  assert.equal(lacksKeyStore({ version: m.version, features: ['keys'] }), false);
});

test('Settings shows the update offer for an old bridge and keeps Pull/Delete off until it is new', () => {
  const ui = readFileSync('src/components/TerminalKeys.tsx', 'utf8');
  assert.match(ui, /lacksKeyStore\(heartbeat\.health\)/);
  assert.match(ui, /data-testid="bridge-old"/);
  assert.match(ui, /Update the terminal bridge/);
  assert.match(ui, /disabled=\{!online \|\| old \|\|/);
  const pkg = readFileSync('package.json', 'utf8');
  assert.match(pkg, /"prebuild": "node scripts\/sync-agent-assets\.mjs"/);
  assert.match(readFileSync('scripts/export-static.mjs', 'utf8'), /sync-agent-assets\.mjs/);
});
