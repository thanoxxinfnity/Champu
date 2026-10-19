// node --experimental-strip-types --test scripts/test-antigravity.mjs
// The Antigravity connector against a stand-in hub: bridge discovery, the framed security header, the model list, a full chat turn
// over Connect streaming, and `chatFetch` returning the same SSE the server route would. The stand-in follows AntiGem's protocol
// sources; it is not a live Antigravity daemon, and this test says nothing about one.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { connect, listModels, chatStream, chatOnce, framedHeader, flattenMessages, startLogin } from '../src/lib/antigravity/client.ts';
import { chatFetch, setAg } from '../src/lib/antigravity/state.ts';

const TOKEN = 'abc123def456';
const CSRF = 'csrf-xyz';
const HEADER = framedHeader(TOKEN).toLowerCase();

function env(obj, flags = 0) {
  const p = Buffer.from(JSON.stringify(obj));
  const b = Buffer.alloc(5 + p.length);
  b[0] = flags;
  b.writeUInt32BE(p.length, 1);
  p.copy(b, 5);
  return b;
}

function startHub() {
  const seen = { calls: [], prompt: '', model: '' };
  const server = http.createServer((req, res) => {
    let body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
      body = Buffer.concat(body);
      const method = req.url.split('/').pop();
      seen.calls.push(method);
      if (req.headers[HEADER] !== CSRF) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end('{"code":"unauthenticated"}');
      }
      if (method === 'GetAvailableModels') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          response: {
            models: {
              'gemini-3-pro': { displayName: 'Gemini 3 Pro', supportsThinking: true, supportsImages: true, model: 'MODEL_PLACEHOLDER_M7', maxTokens: 1000000 },
              'claude-sonnet': { displayName: 'Claude Sonnet', model: 'MODEL_CLAUDE_X' },
              'old-one': { displayName: 'Retired', disabled: true },
            },
          },
        }));
      }
      if (method === 'StartCascade') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{}');
      }
      if (method === 'SendUserCascadeMessage') {
        const j = JSON.parse(body.toString());
        seen.prompt = j.items[0].text;
        seen.model = j.cascadeConfig.plannerConfig.requestedModel.model;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{}');
      }
      if (method === 'StreamAgentStateUpdates') {
        res.writeHead(200, { 'Content-Type': 'application/connect+json' });
        const step = (resp, thinking = '') => ({ update: { status: 'CASCADE_RUN_STATUS_RUNNING', mainTrajectoryUpdate: { stepsUpdate: { indices: [3], steps: [{ plannerResponse: { response: resp, thinking } }] } } } });
        setTimeout(() => res.write(env(step('Hel', 'hmm'))), 10);
        setTimeout(() => res.write(env(step('Hello wor', 'hmm, ok'))), 30);
        setTimeout(() => res.write(env(step('Hello world!', 'hmm, ok'))), 50);
        setTimeout(() => { res.write(env({ update: { status: 'CASCADE_RUN_STATUS_IDLE', fullyIdle: true } })); res.write(env({}, 2)); res.end(); }, 80);
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen })));
}

// A WebSocket stand-in that greets like the Go bridge does.
function fakeWS(port) {
  return class {
    constructor(url) {
      this.url = url;
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'hub_status', status: 'running', port, csrf_token: CSRF }) }), 5);
    }
    close() {}
  };
}

test('framed header is x-ag + 12 chars + _9qx', () => {
  assert.equal(framedHeader('abc'), 'x-agabc         _9qx');
  assert.equal(framedHeader(TOKEN), 'x-agabc123def456_9qx');
});

test('connect, list models, chat and chatFetch against the stand-in hub', async () => {
  const { server, port, seen } = await startHub();
  try {
    const cfg = await connect({ bridgeUrl: 'http://127.0.0.1:8080', token: TOKEN }, undefined, fakeWS(port));
    assert.equal(cfg.hubUrl, `http://127.0.0.1:${port}`);
    assert.equal(cfg.csrf, CSRF);

    const { descriptors, map } = await listModels(cfg);
    assert.deepEqual(descriptors.map((d) => d.id), ['gemini-3-pro', 'claude-sonnet']);
    assert.equal(descriptors[0].provider, 'antigravity');
    assert.ok(descriptors[0].capabilities.includes('reasoning') && descriptors[0].capabilities.includes('vision'));
    assert.equal(map['gemini-3-pro'].enumName, 'MODEL_PLACEHOLDER_M7');

    const frames = [];
    for await (const f of chatStream(cfg, map['gemini-3-pro'], [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'say hello' }])) frames.push(f);
    assert.equal(frames[0].type, 'meta');
    assert.equal(frames.filter((f) => f.type === 'delta').map((f) => f.delta).join(''), 'Hello world!');
    assert.equal(frames.filter((f) => f.type === 'reasoning').map((f) => f.delta).join(''), 'hmm, ok');
    assert.equal(frames.at(-1).type, 'done');
    assert.equal(seen.model, 'MODEL_PLACEHOLDER_M7');
    assert.ok(seen.prompt.includes('Be brief.') && seen.prompt.includes('say hello'));
    assert.deepEqual(seen.calls.filter((c) => c !== 'GetAvailableModels'), ['StartCascade', 'StreamAgentStateUpdates', 'SendUserCascadeMessage']);

    assert.equal(await chatOnce(cfg, map['claude-sonnet'], [{ role: 'user', content: 'hi' }]), 'Hello world!');

    // chatFetch: an Antigravity request is answered locally, in the route's own SSE shape.
    setAg({ config: cfg, enabled: true, models: map });
    const res = await chatFetch('/api/chat', { method: 'POST', body: JSON.stringify({ provider: 'antigravity', model: 'gemini-3-pro', stream: true, messages: [{ role: 'user', content: 'yo' }] }) });
    const text = await res.text();
    const parsed = text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
    assert.equal(parsed.filter((f) => f.type === 'delta').map((f) => f.delta).join(''), 'Hello world!');
    const once = await chatFetch('/api/chat', { method: 'POST', body: JSON.stringify({ provider: 'antigravity', model: 'gemini-3-pro', stream: false, messages: [{ role: 'user', content: 'yo' }] }) });
    assert.deepEqual(await once.json(), { content: 'Hello world!' });
  } finally {
    server.close();
  }
});

test('a wrong token is reported plainly, and a disconnected request says how to connect', async () => {
  const { server, port } = await startHub();
  try {
    const cfg = await connect({ bridgeUrl: 'http://127.0.0.1:8080', token: TOKEN }, undefined, fakeWS(port));
    await assert.rejects(() => listModels({ ...cfg, token: 'wrongtoken000' }), /refused the security token/);
    setAg({ config: null, enabled: false, models: {} });
    const res = await chatFetch('/api/chat', { method: 'POST', body: JSON.stringify({ provider: 'antigravity', model: 'x', messages: [] }) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Settings → Connectors/);
  } finally {
    server.close();
  }
});

test('history is flattened into one prompt, system first', () => {
  const t = flattenMessages([
    { role: 'system', content: 'S' },
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
  ]);
  assert.ok(t.indexOf('S') < t.indexOf('u1') && t.indexOf('a1') < t.indexOf('u2') && t.trim().endsWith('u2'));
});

test('sign-in: start-login, then the login address appears and is returned (with the framed header)', async () => {
  let started = 0;
  let polls = 0;
  const server = http.createServer((req, res) => {
    const ok = req.headers[HEADER] !== undefined;
    if (!ok) { res.writeHead(401); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/api/auth/start-login') { started++; return res.end('{"success":true}'); }
    if (req.url === '/api/auth/login-url') { polls++; return res.end(JSON.stringify({ loginUrl: polls < 3 ? '' : 'https://accounts.google.com/o/oauth2/auth?x=1', active: polls >= 3 })); }
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = await startLogin({ bridgeUrl: `http://127.0.0.1:${server.address().port}`, token: TOKEN }, { pollMs: 5, waitMs: 3000 });
    assert.equal(url, 'https://accounts.google.com/o/oauth2/auth?x=1');
    assert.equal(started, 1);
    assert.ok(polls >= 3);
    await assert.rejects(() => startLogin({ bridgeUrl: `http://127.0.0.1:${server.address().port}`, token: TOKEN }, { pollMs: 5, waitMs: 20 }).then(() => { throw new Error('should not resolve'); }), (e) => true);
  } finally {
    server.close();
  }
});
