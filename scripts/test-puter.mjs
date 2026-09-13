/** node --experimental-strip-types --test scripts/test-puter.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PUTER_MODELS,
  puterChunkError,
  puterChunkReasoning,
  puterChunkText,
  puterErrorText,
  puterMessages,
} from '../src/lib/providers/puter-models.ts';

test('every advertised model is one Puter actually serves', () => {
  // Checked against the live catalogue at api.puter.com/puterai/chat/models.
  // A model in the switcher that the provider does not serve is the exact
  // failure the kie.ai rounds were about.
  const served = new Set([
    'claude-fable-5.1',
    'gpt-6-astra',
    'gpt-5.6-sol',
    'gemini-3.1-pro-preview',
    'claude-opus-5',
    'gemini-3.8-flash',
    'deepseek-v4-pro',
    'qwen3.8-max',
  ]);
  for (const model of PUTER_MODELS) {
    assert.ok(served.has(model.id), `${model.id} is not in the verified set`);
    assert.equal(model.provider, 'puter');
    assert.ok(model.capabilities.includes('chat'));
  }
  // The four the user asked for, by name.
  for (const id of ['claude-fable-5.1', 'gpt-6-astra', 'gpt-5.6-sol', 'gemini-3.1-pro-preview']) {
    assert.ok(PUTER_MODELS.some((m) => m.id === id), `${id} missing from the switcher`);
  }
});

test('text is read out of every chunk shape Puter emits', () => {
  assert.equal(puterChunkText({ type: 'text', text: 'hello' }), 'hello');
  assert.equal(puterChunkText({ text: ' world' }), ' world');
  assert.equal(puterChunkText({ delta: { content: 'x' } }), 'x');
  assert.equal(puterChunkText({ message: { content: 'whole' } }), 'whole');
  // Anthropic models can still hand back content blocks.
  assert.equal(puterChunkText({ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }), 'ab');
  assert.equal(puterChunkText('bare string'), 'bare string');
});

test('a reasoning chunk is thinking, not the answer', () => {
  const chunk = { type: 'reasoning', text: 'let me think' };
  assert.equal(puterChunkReasoning(chunk), 'let me think');
  // It must not also be appended to the reply, or the thinking is printed twice.
  assert.equal(puterChunkText(chunk), '');
});

test('a stream error is surfaced instead of ending silently', () => {
  // Puter sends provider failures as a chunk, not a throw: a reader that only
  // looks at text finishes cleanly with an empty reply and no explanation.
  assert.equal(puterChunkError({ type: 'error', message: 'rate limited' }), 'rate limited');
  assert.equal(puterChunkError({ type: 'error' }), 'The Puter stream failed without saying why.');
  assert.equal(puterChunkError({ type: 'text', text: 'not an error' }), null);
});

test('a compaction chunk is neither reply nor error', () => {
  const chunk = { type: 'compaction', id: 'c1', encrypted_content: 'xx' };
  assert.equal(puterChunkText(chunk), '');
  assert.equal(puterChunkError(chunk), null);
});

test('thrown failures are explained in terms the user can act on', () => {
  assert.match(puterErrorText({ error: { message: 'insufficient funds', code: 'insufficient_funds' } }), /your Puter account/);
  assert.match(puterErrorText({ message: 'not authenticated' }), /Settings → API Keys → Puter/);
  assert.equal(puterErrorText({ message: 'something else' }), 'something else');
  assert.equal(puterErrorText('plain string'), 'plain string');
});

test('multi-part messages are flattened, and a dropped image is said out loud', () => {
  const flat = puterMessages([
    { role: 'system', content: 'be brief' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      ],
    },
  ]);
  assert.equal(flat[0].content, 'be brief');
  assert.match(flat[1].content, /^what is this\?/);
  assert.match(flat[1].content, /an image was attached/);
  // The base64 must not be smuggled into a text field — it would blow the
  // context window and still not be seen.
  assert.ok(!flat[1].content.includes('base64'));
});
