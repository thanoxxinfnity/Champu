/** node --experimental-strip-types --test scripts/test-secrets.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { scanForSecrets } from '../src/lib/security/secrets.ts';

// Shaped like a real token, made of nothing real.
const fake = (prefix, n = 40) => `${prefix}_${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ'.repeat(3).slice(0, n)}`;

test('a bare prefixed Vercel token is recognised without a VERCEL_TOKEN label', () => {
  for (const prefix of ['vcp', 'vci', 'vca', 'vcr', 'vck']) {
    const token = fake(prefix);
    const hits = scanForSecrets(`here is my token ${token} please deploy`);
    assert.equal(hits.length, 1, prefix);
    assert.equal(hits[0].kind, 'vercel', prefix);
    assert.equal(hits[0].value, token, prefix);
    assert.equal(hits[0].confidence, 'certain', prefix);
  }
});

test('a labelled Vercel token is still one finding, not two', () => {
  const token = fake('vcp');
  const hits = scanForSecrets(`VERCEL_TOKEN=${token}`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'vercel');
  assert.equal(hits[0].value, token);
});

test('ordinary words that merely start with vc are left alone', () => {
  assert.deepEqual(scanForSecrets('the vcs_config value and vcp_ alone are not tokens'), []);
});

test('the provider keys the app activates are still told apart', () => {
  const kinds = (text) => scanForSecrets(text).map((m) => m.kind);
  assert.deepEqual(kinds(`sk-ant-${'a1B2c3D4e5F6g7H8i9J0k1L2'}`), ['anthropic']);
  assert.deepEqual(kinds(`sk-${'a1B2c3D4e5F6g7H8i9J0k1L2'}`), ['openai']);
  assert.deepEqual(kinds(`hf_${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6'}`), ['huggingface']);
});
