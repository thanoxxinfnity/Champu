/** node --experimental-strip-types --test scripts/test-terminal-keys.mjs — API keys held by the terminal bridge. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { keyEnvFrom } from '../src/lib/bridge/key-env.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'chomu-keys-'));
process.env.CHOMUGIRI_KEYS_FILE = path.join(dir, 'sub', 'keys.json');
const store = await import('../agent/keystore.mjs');

test('app keys and free-provider keys become the variables a command looks for', () => {
  const env = keyEnvFrom(
    { nim: 'nvapi-1', huggingface: 'hf_x', tripo: '' },
    [
      { id: 'free-groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'g1', apiKeys: ['g2'], freeId: 'groq' },
      { id: 'free-ovh', label: 'OVH', baseUrl: 'https://x', freeId: 'ovhcloud-ai-endpoints' },
      { id: 'mine', label: 'My server', baseUrl: 'https://me', apiKey: 'm1' },
      { id: 'off', label: 'Off', baseUrl: 'https://o', apiKey: 'o1', enabled: false },
    ],
  );
  assert.deepEqual(env, {
    NVIDIA_API_KEY: 'nvapi-1',
    HF_TOKEN: 'hf_x',
    GROQ_API_KEY: 'g1',
    GROQ_API_KEYS: 'g1,g2',
    GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
    ENDPOINT_MY_SERVER_API_KEY: 'm1',
    ENDPOINT_MY_SERVER_BASE_URL: 'https://me',
  });
});

test('the terminal stores keys owner-only, lists names with a masked tail, and a push replaces everything', () => {
  assert.deepEqual(store.describeKeystore(), { count: 0, savedAt: 0, keys: [] });
  store.writeKeystore({ GROQ_API_KEY: 'gsk_abcdefghijkl', OLD_KEY: 'zzzzzzzzzz' }, 5);
  assert.equal(statSync(process.env.CHOMUGIRI_KEYS_FILE).mode & 0o777, 0o600);
  store.writeKeystore({ GROQ_API_KEY: 'gsk_abcdefghijkl', NVIDIA_API_KEY: 'nvapi-12345678' }, 6);
  const d = store.describeKeystore();
  assert.deepEqual(d.keys.map((k) => k.name).sort(), ['GROQ_API_KEY', 'NVIDIA_API_KEY']);
  assert.equal(d.keys.find((k) => k.name === 'GROQ_API_KEY').hint, '••••ijkl');
  assert.ok(!JSON.stringify(d).includes('gsk_abcdefghijkl'), 'a key is never listed');
  assert.equal(store.readKeystore().env.NVIDIA_API_KEY, 'nvapi-12345678');
});

test('bad names and multi-line values are refused; blanks are skipped', () => {
  assert.throws(() => store.writeKeystore({ 'bad name': 'x' }), /not a valid variable name/);
  assert.throws(() => store.writeKeystore({ OK_NAME: 'a\nb' }), /single-line/);
  assert.deepEqual(store.writeKeystore({ A_KEY: '  ', B_KEY: ' v ' }), ['B_KEY']);
  assert.equal(store.readKeystore().env.B_KEY, 'v');
});

test('delete removes some or all, and the file goes when nothing is left', () => {
  store.writeKeystore({ A_KEY: 'a1', B_KEY: 'b1', C_KEY: 'c1' });
  assert.equal(store.deleteKeystore(['A_KEY', 'NOPE']), 1);
  assert.deepEqual(Object.keys(store.readKeystore().env).sort(), ['B_KEY', 'C_KEY']);
  assert.equal(store.deleteKeystore(), 2);
  assert.equal(existsSync(process.env.CHOMUGIRI_KEYS_FILE), false);
  assert.equal(store.describeKeystore().count, 0);
});

test('the bridge injects the stored keys into every command, and serves the three routes', () => {
  const src = readFileSync(new URL('../agent/chomugiri-agent.mjs', import.meta.url), 'utf8');
  assert.match(src, /\.\.\.readKeystore\(\)\.env, \.\.\.env, CHOMUGIRI_BRIDGE_URL/);
  assert.match(src, /routes\['GET \/v1\/keys'\]/);
  assert.match(src, /routes\['POST \/v1\/keys'\]/);
  assert.match(src, /routes\['POST \/v1\/keys\/delete'\]/);
  assert.match(src, /process\.argv\[2\] === 'keys'/);
});
