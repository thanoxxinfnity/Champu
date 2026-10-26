/** node --test scripts/test-bridge-jobs.mjs — background jobs on the bridge, against a mock model server. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJobs, piecesOf } from '../agent/jobs.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function mockModel(handler) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => handler(req, res, body ? JSON.parse(body) : {}));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/v1/chat/completions` })));
}

const sse = (res, parts) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const t of parts) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } })}\n\n`);
  res.end('data: [DONE]\n\n');
};

async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await wait(25);
  }
}

test('piecesOf reads the three wire shapes', () => {
  assert.equal(piecesOf({ choices: [{ delta: { content: 'hi' } }] }).text, 'hi');
  assert.equal(piecesOf({ choices: [{ message: { content: 'yo', reasoning_content: 'hm' } }] }).reasoning, 'hm');
  assert.equal(piecesOf({ type: 'content_block_delta', delta: { text: 'a' } }).text, 'a');
  assert.equal(piecesOf({ type: 'message', content: [{ type: 'text', text: 'b' }] }).text, 'b');
  assert.equal(piecesOf({ candidates: [{ content: { parts: [{ text: 'c' }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 9 } }).usage.totalTokens, 9);
});

test('a streamed reply is stored, listed, read back and acknowledged', async () => {
  const m = await mockModel((_req, res) => sse(res, ['Hel', 'lo ', 'there']));
  const jobs = createJobs({ dir: mkdtempSync(path.join(tmpdir(), 'jobs-')), notify: () => {} });
  const started = jobs.start({ id: 'job-one', meta: { sessionId: 's1' }, recipes: [{ url: m.url, headers: { Authorization: 'Bearer SECRET' }, body: { model: 'x', messages: [], stream: true } }] });
  assert.equal(started.status, 'running');
  await until(() => jobs.get('job-one').status !== 'running');
  const j = jobs.get('job-one');
  assert.equal(j.status, 'done');
  assert.equal(j.content, 'Hello there');
  assert.equal(j.usage.totalTokens, 8);
  assert.deepEqual(jobs.list().map((x) => x.id), ['job-one']);
  assert.equal(jobs.ack(['job-one']).removed, 1);
  assert.equal(jobs.list().length, 0);
  m.server.close();
});

test('the key is never written to disk', async () => {
  const m = await mockModel((_req, res) => sse(res, ['ok']));
  const dir = mkdtempSync(path.join(tmpdir(), 'jobs-'));
  const jobs = createJobs({ dir, notify: () => {} });
  jobs.start({ id: 'job-key', recipes: [{ url: m.url, headers: { Authorization: 'Bearer SUPERSECRET' }, body: { model: 'x', messages: [] } }] });
  await until(() => jobs.get('job-key').status === 'done');
  const { readFileSync, readdirSync } = await import('node:fs');
  for (const f of readdirSync(dir)) assert.ok(!readFileSync(path.join(dir, f), 'utf8').includes('SUPERSECRET'));
  m.server.close();
});

test('a failing first model falls through to the next recipe', async () => {
  const bad = await mockModel((_req, res) => { res.writeHead(429); res.end('slow down'); });
  const good = await mockModel((_req, res) => sse(res, ['second']));
  const jobs = createJobs({ dir: mkdtempSync(path.join(tmpdir(), 'jobs-')), notify: () => {} });
  jobs.start({ id: 'job-fall', recipes: [{ url: bad.url, body: { m: 1 }, label: 'bad' }, { url: good.url, body: { m: 1 }, label: 'good' }] });
  await until(() => jobs.get('job-fall').status === 'done');
  const j = jobs.get('job-fall');
  assert.equal(j.content, 'second');
  assert.equal(j.label, 'good');
  bad.server.close();
  good.server.close();
});

test('all recipes failing ends as failed with the reason', async () => {
  const bad = await mockModel((_req, res) => { res.writeHead(500); res.end('boom'); });
  const jobs = createJobs({ dir: mkdtempSync(path.join(tmpdir(), 'jobs-')), notify: () => {} });
  jobs.start({ id: 'job-bad', recipes: [{ url: bad.url, body: { m: 1 } }] });
  await until(() => jobs.get('job-bad').status === 'failed');
  assert.match(jobs.get('job-bad').error, /500/);
  bad.server.close();
});

test('a non-streaming JSON reply (Anthropic shape) works', async () => {
  const m = await mockModel((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ type: 'message', content: [{ type: 'text', text: 'claude says hi' }], usage: { input_tokens: 1, output_tokens: 2 } })); });
  const jobs = createJobs({ dir: mkdtempSync(path.join(tmpdir(), 'jobs-')), notify: () => {} });
  jobs.start({ id: 'job-json', recipes: [{ url: m.url, body: { m: 1 }, stream: false }] });
  await until(() => jobs.get('job-json').status === 'done');
  assert.equal(jobs.get('job-json').content, 'claude says hi');
  m.server.close();
});

test('sending the same id twice runs one job, and cancel stops it', async () => {
  let hits = 0;
  const slow = await mockModel((_req, res) => { hits++; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`); });
  const dir = mkdtempSync(path.join(tmpdir(), 'jobs-'));
  const jobs = createJobs({ dir, notify: () => {} });
  const spec = { id: 'job-slow', recipes: [{ url: slow.url, body: { m: 1 } }] };
  jobs.start(spec);
  jobs.start(spec);
  await until(() => jobs.get('job-slow').content === 'partial');
  assert.equal(hits, 1);
  assert.deepEqual(jobs.cancel('job-slow'), { cancelled: true });
  await until(() => jobs.get('job-slow').status === 'cancelled');
  slow.server.closeAllConnections?.();
  slow.server.close();
});

test('a job found "running" on disk at start-up comes back as interrupted', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jobs-'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path.join(dir, 'job-old1.json'), JSON.stringify({ id: 'job-old1', status: 'running', startedAt: Date.now(), content: 'half', reasoning: '', meta: { sessionId: 's' } }));
  const jobs = createJobs({ dir, notify: () => {} });
  const j = jobs.get('job-old1');
  assert.equal(j.status, 'interrupted');
  assert.equal(j.content, 'half');
  assert.match(j.error, /restarted/);
});

test('bad specs are refused', () => {
  const jobs = createJobs({ dir: mkdtempSync(path.join(tmpdir(), 'jobs-')), notify: () => {} });
  assert.throws(() => jobs.start({ id: 'x', recipes: [] }), /id|recipes/);
  assert.throws(() => jobs.start({ id: 'job-bad-url', recipes: [{ url: 'ftp://x', body: {} }] }), /http/);
  assert.throws(() => jobs.start({ id: 'job-meta', recipes: [{ url: 'http://169.254.169.254/x', body: {} }] }), /blocked/);
});

test('over HTTP: the bridge reports the jobs feature and runs a job end to end', async () => {
  const m = await mockModel((_req, res) => sse(res, ['over ', 'http']));
  const PORT = 7900 + Math.floor(Math.random() * 90);
  const dir = mkdtempSync(path.join(tmpdir(), 'jobs-'));
  const child = spawn('node', ['agent/chomugiri-agent.mjs', '--port', String(PORT), '--workspace', dir, '--token', 'tok-12345678'], { stdio: 'ignore', env: { ...process.env, CHOMUGIRI_JOBS_DIR: path.join(dir, 'j') } });
  const h = { Authorization: 'Bearer tok-12345678', 'Content-Type': 'application/json' };
  const call = async (p, body) => (await fetch(`http://127.0.0.1:${PORT}${p}`, body ? { method: 'POST', headers: h, body: JSON.stringify(body) } : { headers: h })).json();
  try {
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/v1/ping`)).ok) break; } catch { /* starting */ } await wait(150); }
    const health = await call('/v1/health');
    assert.ok(health.features.includes('jobs'));
    assert.equal(health.version, '1.3.0');
    await call('/v1/jobs', { id: 'http-job-1', meta: { sessionId: 's' }, recipes: [{ url: m.url, body: { m: 1 } }] });
    await until(() => false, 0).catch(() => {});
    let got;
    for (let i = 0; i < 60; i++) { got = await call('/v1/job?id=http-job-1'); if (got.status === 'done') break; await wait(100); }
    assert.equal(got.content, 'over http');
    assert.equal((await call('/v1/jobs')).jobs.length, 1);
    assert.equal((await call('/v1/job/ack', { ids: ['http-job-1'] })).removed, 1);
    assert.equal((await call('/v1/jobs')).jobs.length, 0);
  } finally { child.kill(); m.server.close(); }
});
