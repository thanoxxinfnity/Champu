/** node --experimental-strip-types --test scripts/test-envelope.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { envelopeError } from '../src/lib/providers/envelope-error.ts';

test("kie.ai's 200-with-an-error is recognised as a failure", () => {
  // Without this the raw JSON was emitted as the assistant's reply.
  const out = envelopeError('{"code":422,"msg":"The model is not supported","data":null}');
  assert.ok(out);
  assert.equal(out.code, 'model_unsupported');
  assert.ok(/does not serve that model id/.test(out.message), out.message);
});

test('an unsupported model is explained, not just repeated', () => {
  const out = envelopeError('{"code":422,"msg":"unknown model"}');
  assert.ok(/\/models list does not guarantee/.test(out.message), out.message);
});

test('a real completion is never mistaken for an error', () => {
  const answer = '{"choices":[{"message":{"content":"pong"}}],"code":200}';
  assert.equal(envelopeError(answer), null);
});

test('an answer that merely talks about errors is left alone', () => {
  const answer = '{"choices":[{"message":{"content":"The error is not supported in this context"}}]}';
  assert.equal(envelopeError(answer), null);
});

test('other envelope shapes are read too', () => {
  assert.equal(envelopeError('{"error":"quota exceeded"}').message, 'quota exceeded');
  assert.equal(envelopeError('{"error":{"message":"bad key"}}').message, 'bad key');
  assert.equal(envelopeError('{"code":500,"msg":"upstream down"}').retryable, true);
  assert.equal(envelopeError('{"code":422,"msg":"nope"}').retryable, false);
});

test('non-JSON, empty and oversized bodies are not errors', () => {
  assert.equal(envelopeError('hello there'), null);
  assert.equal(envelopeError(''), null);
  assert.equal(envelopeError('[1,2,3]'), null);
  assert.equal(envelopeError(`{"code":422,"msg":"${'x'.repeat(9000)}"}`), null);
});

test('a success envelope with no message is not an error', () => {
  assert.equal(envelopeError('{"code":200,"data":{}}'), null);
  assert.equal(envelopeError('{"id":"chatcmpl-1","object":"chat.completion"}'), null);
});
