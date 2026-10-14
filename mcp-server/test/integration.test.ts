/**
 * Full-stack integration test: a real Express app (the same createApp() used in production),
 * a mock upstream image provider, and real HTTP requests driving a real MCP JSON-RPC handshake —
 * no handler is called directly, every assertion goes through the actual wire protocol.
 *
 * Run: npx tsx --test test/integration.test.ts  (or `npm test`, which runs this + unit tests)
 */
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer, type Server } from 'node:http';
import { writeFile, rm } from 'node:fs/promises';
import { hashApiKey } from '../src/tenants/apiKey.ts';

const TENANTS_FILE = './test/.tmp-tenants.json';
const MOCK_PORT = 8991;
const SERVER_PORT = 8992;

const RAW_KEY_FULL_ACCESS = 'cmk_test_full_access_key';
const RAW_KEY_IMAGE_ONLY = 'cmk_test_image_only_key';
const RAW_KEY_RATE_LIMITED = 'cmk_test_rate_limited_key';
const RAW_KEY_DISABLED_TENANT = 'cmk_test_disabled_tenant_key';

let mockProvider: Server;
let mcpServer: { close: () => Promise<void> };
let mockCallCount = 0;

before(async () => {
  // A fake image-generation provider: answers inline b64 immediately, no job polling needed.
  mockProvider = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/images/generations') {
      mockCallCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: Buffer.from('fake-png-bytes').toString('base64') }] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => mockProvider.listen(MOCK_PORT, resolve));

  await writeFile(TENANTS_FILE, JSON.stringify([
    {
      id: 'full-access-tenant',
      name: 'Full Access',
      enabled: true,
      apiKeyHash: hashApiKey(RAW_KEY_FULL_ACCESS),
      scopes: ['tools:image', 'tools:video', 'tools:model3d'],
      rateLimit: { points: 1000, windowSeconds: 60 },
      providers: { image: { baseUrl: `http://127.0.0.1:${MOCK_PORT}`, apiKey: 'k', model: 'test-model' } },
    },
    {
      id: 'image-only-tenant',
      name: 'Image Only',
      enabled: true,
      apiKeyHash: hashApiKey(RAW_KEY_IMAGE_ONLY),
      scopes: ['tools:image'],
      rateLimit: { points: 1000, windowSeconds: 60 },
      providers: { image: { baseUrl: `http://127.0.0.1:${MOCK_PORT}`, apiKey: 'k', model: 'test-model' } },
    },
    {
      id: 'rate-limited-tenant',
      name: 'Rate Limited',
      enabled: true,
      apiKeyHash: hashApiKey(RAW_KEY_RATE_LIMITED),
      scopes: ['tools:image'],
      // Budget: 1 for the initialize call this test makes below, +2 tool calls that should succeed.
      rateLimit: { points: 3, windowSeconds: 60 },
      providers: { image: { baseUrl: `http://127.0.0.1:${MOCK_PORT}`, apiKey: 'k', model: 'test-model' } },
    },
    {
      id: 'disabled-tenant',
      name: 'Disabled',
      enabled: false,
      apiKeyHash: hashApiKey(RAW_KEY_DISABLED_TENANT),
      scopes: ['tools:image'],
      providers: {},
    },
  ], null, 2));

  process.env.PUBLIC_URL = `http://127.0.0.1:${SERVER_PORT}`;
  process.env.TENANTS_FILE = TENANTS_FILE;
  process.env.PORT = String(SERVER_PORT);
  process.env.ALLOWED_HOSTS = 'any';
  process.env.RATE_LIMIT_POINTS = '1000';
  process.env.LOG_LEVEL = 'silent';
  // JWT intentionally left unconfigured: this run exercises the API-key path.

  const { tenantStore } = await import('../src/tenants/store.ts');
  await tenantStore.load();
  const { createApp } = await import('../src/transport/http.ts');
  const { app } = createApp();
  const httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(SERVER_PORT, resolve));
  mcpServer = { close: () => new Promise((resolve) => httpServer.close(() => resolve())) };
});

after(async () => {
  await mcpServer.close();
  await new Promise<void>((resolve) => mockProvider.close(() => resolve()));
  await rm(TENANTS_FILE, { force: true });
});

const base = () => `http://127.0.0.1:${SERVER_PORT}`;

async function rpc(path: string, body: unknown, opts: { token?: string; sessionId?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.sessionId) headers['mcp-session-id'] = opts.sessionId;
  const res = await fetch(`${base()}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  const sessionId = res.headers.get('mcp-session-id') ?? undefined;
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  return { status: res.status, json, sessionId, headers: res.headers };
}

const initBody = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0' } } };

test('no bearer token at all -> 401', async () => {
  const res = await fetch(`${base()}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(initBody) });
  assert.equal(res.status, 401);
});

test('garbage bearer token -> 401, never reaches a tenant or a tool', async () => {
  const { status } = await rpc('/mcp', initBody, { token: 'not-a-real-key' });
  assert.equal(status, 401);
});

test('a disabled tenant\'s otherwise-valid key is still refused', async () => {
  const { status } = await rpc('/mcp', initBody, { token: RAW_KEY_DISABLED_TENANT });
  assert.equal(status, 401);
});

test('valid key: initialize succeeds and hands back a session id', async () => {
  const { status, json, sessionId } = await rpc('/mcp', initBody, { token: RAW_KEY_FULL_ACCESS });
  assert.equal(status, 200);
  assert.equal(json.result.serverInfo.name, 'chomugiri-mcp-server');
  assert.ok(sessionId, 'expected an mcp-session-id response header');
});

test('tools/list is gated by auth too (no session id reuse across tenants assumed)', async () => {
  const { sessionId } = await rpc('/mcp', initBody, { token: RAW_KEY_FULL_ACCESS });
  const { status, json } = await rpc('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { token: RAW_KEY_FULL_ACCESS, sessionId });
  assert.equal(status, 200);
  const names = json.result.tools.map((t: { name: string }) => t.name).sort();
  assert.deepEqual(names, ['generate_3d_model', 'generate_image', 'generate_video']);
});

test('full-access tenant can call generate_image and gets real content back from the mock provider', async () => {
  const before = mockCallCount;
  const { sessionId } = await rpc('/mcp', initBody, { token: RAW_KEY_FULL_ACCESS });
  const { status, json } = await rpc('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'generate_image', arguments: { prompt: 'a red fox in snow' } } }, { token: RAW_KEY_FULL_ACCESS, sessionId });
  assert.equal(status, 200);
  assert.equal(json.result.isError, undefined, JSON.stringify(json.result));
  assert.equal(mockCallCount, before + 1, 'the mock provider should have been hit exactly once');
  const payload = JSON.parse(json.result.content[0].text);
  assert.ok(payload.dataUri?.startsWith('data:image/png;base64,'), 'expected an inline data URI from the mock\'s b64 response');
  assert.equal(Buffer.from(payload.dataUri.split(',')[1], 'base64').toString(), 'fake-png-bytes');
});

test('RBAC: a tenant without tools:video scope gets a tool-level error, not a crash, calling generate_video', async () => {
  const { sessionId } = await rpc('/mcp', initBody, { token: RAW_KEY_IMAGE_ONLY });
  const { status, json } = await rpc('/mcp', { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'generate_video', arguments: { prompt: 'a car driving' } } }, { token: RAW_KEY_IMAGE_ONLY, sessionId });
  assert.equal(status, 200, 'RBAC failures are tool-level errors (isError: true), not an HTTP/RPC-level rejection');
  assert.equal(json.result.isError, true);
  assert.match(json.result.content[0].text, /does not have the "tools:video" scope/);
});

test('RBAC: that same tenant CAN call generate_image (the scope it does have)', async () => {
  const { sessionId } = await rpc('/mcp', initBody, { token: RAW_KEY_IMAGE_ONLY });
  const { json } = await rpc('/mcp', { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'generate_image', arguments: { prompt: 'ok' } } }, { token: RAW_KEY_IMAGE_ONLY, sessionId });
  assert.equal(json.result.isError, undefined, JSON.stringify(json.result));
});

test('input validation: an empty prompt is rejected before the tool ever runs', async () => {
  const { sessionId } = await rpc('/mcp', initBody, { token: RAW_KEY_FULL_ACCESS });
  const before = mockCallCount;
  const { json } = await rpc('/mcp', { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'generate_image', arguments: { prompt: '' } } }, { token: RAW_KEY_FULL_ACCESS, sessionId });
  assert.ok(json.error || json.result?.isError, 'expected a validation rejection for an empty prompt');
  assert.equal(mockCallCount, before, 'the provider must never be called for invalid input');
});

test('per-tenant rate limiting: the 3rd request within the window is refused with 429', async () => {
  const { sessionId } = await rpc('/mcp', initBody, { token: RAW_KEY_RATE_LIMITED });
  const call = () => rpc('/mcp', { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'generate_image', arguments: { prompt: 'x' } } }, { token: RAW_KEY_RATE_LIMITED, sessionId });
  const first = await call();
  const second = await call();
  const third = await call();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 429, 'the per-tenant bucket (3 points: 1 for initialize + 2 tool calls) should be exhausted by the 3rd tool call');
  assert.ok(third.headers.get('retry-after'), 'a 429 should carry a Retry-After header');
});

test('a different tenant is not affected by another tenant\'s exhausted rate limit', async () => {
  const { sessionId } = await rpc('/mcp', initBody, { token: RAW_KEY_FULL_ACCESS });
  const { status } = await rpc('/mcp', { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'generate_image', arguments: { prompt: 'still fine' } } }, { token: RAW_KEY_FULL_ACCESS, sessionId });
  assert.equal(status, 200);
});

test('unknown session id on a follow-up request -> 404, not silently treated as a new session', async () => {
  const { status } = await rpc('/mcp', { jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} }, { token: RAW_KEY_FULL_ACCESS, sessionId: 'not-a-real-session' });
  assert.equal(status, 404);
});

test('healthz needs no auth', async () => {
  const res = await fetch(`${base()}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});
