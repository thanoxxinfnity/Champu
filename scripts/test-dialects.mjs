/** node --experimental-strip-types --test scripts/test-dialects.mjs */
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {
  authHeaders,
  chatUrl,
  dialectFromUrl,
  framesFromResponse,
  framesFromStreamChunk,
  modelIdsFromList,
  normalizeBase,
  requestBody,
} from '../src/lib/providers/dialects.ts';
import { streamChat } from '../src/lib/providers/openai-compat.ts';

// ── Detection and routing ───────────────────────────────────────────────────

test('the pasted URL announces the protocol', () => {
  // The one from the screenshot: tabitoken is an Anthropic gateway, and asking
  // it in OpenAI's dialect is what produced "nothing answered".
  assert.equal(dialectFromUrl('https://tabitoken.com/v1/messages'), 'anthropic');
  assert.equal(dialectFromUrl('https://api.anthropic.com/v1'), 'anthropic');
  assert.equal(dialectFromUrl('https://generativelanguage.googleapis.com/v1beta'), 'gemini');
  assert.equal(dialectFromUrl('https://x.com/v1beta/models/gemini-3-pro:generateContent'), 'gemini');
  assert.equal(dialectFromUrl('https://api.kie.ai/v1'), 'openai');
  assert.equal(dialectFromUrl('https://api.example.com/v1/chat/completions'), 'openai');
  assert.equal(dialectFromUrl('https://example.com/'), null);
});

test('a pasted endpoint is reduced to the base its dialect builds from', () => {
  assert.equal(normalizeBase('https://tabitoken.com/v1/messages', 'anthropic'), 'https://tabitoken.com/v1');
  // A bare origin needs the version segment Anthropic routes under.
  assert.equal(normalizeBase('https://tabitoken.com', 'anthropic'), 'https://tabitoken.com/v1');
  assert.equal(normalizeBase('https://tabitoken.com/v1', 'anthropic'), 'https://tabitoken.com/v1');
  assert.equal(
    normalizeBase('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent', 'gemini'),
    'https://generativelanguage.googleapis.com/v1beta',
  );
  assert.equal(normalizeBase('https://api.kie.ai/v1/chat/completions', 'openai'), 'https://api.kie.ai/v1');
});

test('each dialect gets its own route', () => {
  assert.equal(chatUrl('openai', 'https://a/v1', 'm', true), 'https://a/v1/chat/completions');
  assert.equal(chatUrl('anthropic', 'https://a/v1', 'm', true), 'https://a/v1/messages');
  assert.equal(chatUrl('gemini', 'https://a/v1beta', 'gemini-3-pro', false), 'https://a/v1beta/models/gemini-3-pro:generateContent');
  assert.equal(chatUrl('gemini', 'https://a/v1beta', 'gemini-3-pro', true), 'https://a/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse');
  // Gemini lists ids as "models/x"; the path must not double the prefix.
  assert.equal(chatUrl('gemini', 'https://a/v1beta', 'models/gemini-3-pro', false), 'https://a/v1beta/models/gemini-3-pro:generateContent');
});

test('each dialect gets its own auth header', () => {
  // A Bearer token is a 401 on both of the others — half of why a working key
  // looked like a broken endpoint.
  assert.deepEqual(authHeaders('openai', 'k'), { Authorization: 'Bearer k' });
  assert.deepEqual(authHeaders('anthropic', 'k'), { 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
  assert.deepEqual(authHeaders('gemini', 'k'), { 'x-goog-api-key': 'k' });
});

// ── Request translation ─────────────────────────────────────────────────────

const req = {
  provider: 'custom',
  model: 'm',
  messages: [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'again' },
  ],
  temperature: 0.4,
  maxTokens: 100,
};

test('Anthropic takes system separately and requires max_tokens', () => {
  const body = requestBody('anthropic', req, 'claude-opus-5', true);
  assert.equal(body.system, 'be brief');
  assert.equal(body.max_tokens, 100);
  assert.deepEqual(body.messages, [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'again' },
  ]);
  // Omitting max_tokens is a 400 on Anthropic, so there must always be one.
  assert.ok(requestBody('anthropic', { ...req, maxTokens: undefined }, 'm', false).max_tokens > 0);
});

test('Gemini renames everything: contents, parts, and the model role', () => {
  const body = requestBody('gemini', req, 'gemini-3-pro', true);
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'be brief' }] });
  assert.deepEqual(body.contents, [
    { role: 'user', parts: [{ text: 'hi' }] },
    { role: 'model', parts: [{ text: 'hello' }] },
    { role: 'user', parts: [{ text: 'again' }] },
  ]);
  assert.equal(body.generationConfig.maxOutputTokens, 100);
  assert.equal(body.generationConfig.temperature, 0.4);
  assert.equal(body.model, undefined, 'the model goes in the path, not the body');
});

// ── Response translation ────────────────────────────────────────────────────

test("Anthropic's content blocks become deltas", () => {
  const frames = framesFromResponse('anthropic', {
    content: [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' there' },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 3 },
  });
  assert.deepEqual(frames.filter((f) => f.type === 'delta').map((f) => f.delta), ['Hello there']);
  assert.deepEqual(frames.filter((f) => f.type === 'reasoning').map((f) => f.delta), ['hmm']);
  assert.equal(frames.find((f) => f.type === 'usage').promptTokens, 10);
});

test("Anthropic's SSE events carry their meaning in the event type", () => {
  assert.deepEqual(
    framesFromStreamChunk('anthropic', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }),
    [{ type: 'delta', delta: 'Hi' }],
  );
  assert.deepEqual(
    framesFromStreamChunk('anthropic', { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x' } }),
    [{ type: 'reasoning', delta: 'x' }],
  );
  assert.deepEqual(framesFromStreamChunk('anthropic', { type: 'message_stop' }), [{ type: 'done', finishReason: 'stop' }]);
  // message_start and ping carry nothing to show.
  assert.deepEqual(framesFromStreamChunk('anthropic', { type: 'message_start', message: {} }), []);
  assert.deepEqual(framesFromStreamChunk('anthropic', { type: 'ping' }), []);
  assert.equal(framesFromStreamChunk('anthropic', { type: 'error', error: { message: 'overloaded' } })[0].message, 'overloaded');
});

test("Gemini's candidates become deltas", () => {
  const frames = framesFromResponse('gemini', {
    candidates: [{ content: { parts: [{ text: 'Hi' }, { text: ' there' }], role: 'model' }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
  });
  assert.equal(frames.find((f) => f.type === 'delta').delta, 'Hi there');
  assert.equal(frames.find((f) => f.type === 'usage').totalTokens, 7);
});

test('each dialect publishes its model list in its own shape', () => {
  assert.deepEqual(modelIdsFromList('anthropic', { data: [{ id: 'claude-opus-5' }] }), ['claude-opus-5']);
  assert.deepEqual(modelIdsFromList('gemini', { models: [{ name: 'models/gemini-3-pro' }] }), ['gemini-3-pro']);
  assert.deepEqual(modelIdsFromList('openai', { data: [{ id: 'gpt-5-2' }] }), ['gpt-5-2']);
});

// ── End to end, against servers that speak the real protocols ───────────────

/** Collects what a run actually produced, the way the runtime does. */
async function run(cfg, model) {
  let content = '';
  let error;
  for await (const frame of streamChat(cfg, { provider: 'custom', model, messages: [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: 'hi' },
  ], maxTokens: 32 }, model)) {
    if (frame.type === 'delta') content += frame.delta;
    if (frame.type === 'error') error = frame.message;
  }
  return { content, error };
}

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

test('an Anthropic endpoint answers, streaming, end to end', async () => {
  const seen = {};
  const { server, port } = await serve((req, res) => {
    seen.url = req.url;
    seen.apiKey = req.headers['x-api-key'];
    seen.version = req.headers['anthropic-version'];
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.body = JSON.parse(body);
      if (req.url !== '/v1/messages') {
        res.writeHead(404).end('{"type":"error","error":{"type":"not_found_error","message":"no route"}}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n');
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Namaste"}}\n\n');
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" bro"}}\n\n');
      res.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n');
      res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
      res.end();
    });
  });

  try {
    const { customChatConfig } = await import('../src/lib/providers/custom.ts');
    const cfg = customChatConfig({ baseUrl: `http://127.0.0.1:${port}/v1/messages`, apiKey: 'secret', dialect: 'anthropic' }, 'claude-opus-5');
    const { content, error } = await run(cfg, 'claude-opus-5');

    assert.equal(error, undefined);
    assert.equal(content, 'Namaste bro');
    assert.equal(seen.url, '/v1/messages', 'the pasted /v1/messages URL is not doubled');
    assert.equal(seen.apiKey, 'secret', 'authenticates with x-api-key, not Bearer');
    assert.equal(seen.version, '2023-06-01');
    assert.equal(seen.body.system, 'be brief', 'system is its own field');
    assert.ok(seen.body.max_tokens > 0, 'max_tokens is always sent — Anthropic 400s without it');
  } finally {
    server.close();
  }
});

test('a Gemini endpoint answers, streaming, end to end', async () => {
  const seen = {};
  const { server, port } = await serve((req, res) => {
    seen.url = req.url;
    seen.key = req.headers['x-goog-api-key'];
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.body = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"candidates":[{"content":{"parts":[{"text":"Kaise"}],"role":"model"}}]}\n\n');
      res.write('data: {"candidates":[{"content":{"parts":[{"text":" ho"}],"role":"model"},"finishReason":"STOP"}],"usageMetadata":{"totalTokenCount":4}}\n\n');
      res.end();
    });
  });

  try {
    const { customChatConfig } = await import('../src/lib/providers/custom.ts');
    const cfg = customChatConfig({ baseUrl: `http://127.0.0.1:${port}/v1beta`, apiKey: 'g-key', dialect: 'gemini' }, 'gemini-3-pro');
    const { content, error } = await run(cfg, 'gemini-3-pro');

    assert.equal(error, undefined);
    assert.equal(content, 'Kaise ho');
    assert.equal(seen.url, '/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse');
    assert.equal(seen.key, 'g-key', 'authenticates with x-goog-api-key');
    assert.ok(seen.body.contents, 'messages are translated to contents');
  } finally {
    server.close();
  }
});

test("an Anthropic error envelope is reported, not swallowed", async () => {
  const { server, port } = await serve((req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end('{"type":"error","error":{"type":"invalid_request_error","message":"model: claude-opus-9 not found"}}');
  });
  try {
    const { customChatConfig } = await import('../src/lib/providers/custom.ts');
    const cfg = customChatConfig({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k', dialect: 'anthropic' }, 'claude-opus-9');
    const { error } = await run(cfg, 'claude-opus-9');
    assert.match(error, /claude-opus-9 not found/);
  } finally {
    server.close();
  }
});

test('the probe finds an Anthropic endpoint that only serves /v1/messages', async () => {
  const { server, port } = await serve((req, res) => {
    if (req.url === '/v1/messages' && req.method === 'POST') {
      // The real refusal for a bad model id: the route exists, the model does not.
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"type":"error","error":{"type":"invalid_request_error","message":"unknown model"}}');
      return;
    }
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"data":[{"id":"claude-opus-5","display_name":"Claude Opus 5"}]}');
      return;
    }
    res.writeHead(404).end('not found');
  });

  try {
    const { probeEndpoint } = await import('../src/lib/providers/custom.ts');
    const probe = await probeEndpoint({ baseUrl: `http://127.0.0.1:${port}/v1/messages`, apiKey: 'k' });

    assert.equal(probe.ok, true, `probe failed: ${probe.error}`);
    assert.equal(probe.dialect, 'anthropic');
    assert.deepEqual(probe.models.map((m) => m.id), ['claude-opus-5']);
    assert.equal(probe.baseUrl, `http://127.0.0.1:${port}/v1`);
  } finally {
    server.close();
  }
});

test('a refused key is reported as a refused key, not as a missing route', async () => {
  const { server, port } = await serve((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}');
  });
  try {
    const { probeEndpoint } = await import('../src/lib/providers/custom.ts');
    const probe = await probeEndpoint({ baseUrl: `http://127.0.0.1:${port}/v1/messages`, apiKey: 'wrong' });
    assert.equal(probe.ok, false);
    assert.match(probe.error, /rejected the credentials \(401\)/);
  } finally {
    server.close();
  }
});
