import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { makeContext } from '../src/context.mjs';
import { indexProject } from '../src/indexer.mjs';
import { TOOL_MAP } from '../src/tools.mjs';
import { invalidate } from '../src/search.mjs';
import { redact, shouldIndex, assertLoopback, safeJoin } from '../src/privacy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let dir, ctx;
const run = (name, args = {}) => TOOL_MAP.get(name).run(ctx, args);
const reindex = async () => { const s = await indexProject(ctx); invalidate(ctx.db); return s; };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chomu-test-'));
  cpSync(join(here, 'fixture'), dir, { recursive: true });
  writeFileSync(join(dir, '.env'), 'API_KEY=sk-abcdefghijklmnopqrstuv123456\n');
  mkdirSync(join(dir, 'keys'), { recursive: true });
  writeFileSync(join(dir, 'keys', 'server.pem'), '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n');
  ctx = makeContext({ root: dir });
  await reindex();
});
after(() => { ctx.db.close(); rmSync(dir, { recursive: true, force: true }); });

test('1. indexing: reads code, skips secrets, never stores them', async () => {
  const files = ctx.db.prepare('SELECT path FROM files').all().map((r) => r.path);
  assert.ok(files.includes('src/auth.ts') && files.includes('py/shop.py') && files.includes('gd/enemy.gd'));
  assert.ok(!files.includes('.env') && !files.includes('keys/server.pem'), '.env and keys must not be indexed');
  assert.ok(!JSON.stringify(ctx.db.prepare('SELECT text FROM chunks').all()).includes('abcdefghijklmnopqrstuv123456'));
  const all = JSON.stringify(ctx.db.prepare('SELECT text FROM chunks').all());
  assert.ok(!all.includes('nvapi-ABCDEFGH'), 'a token in code is blanked in the cards');
  assert.ok(all.includes('[REDACTED]'));
  assert.equal(shouldIndex('.env', 10), false);
  assert.equal(shouldIndex('keys/server.pem', 10), false);
  assert.equal(shouldIndex('node_modules/x/index.js', 10), false);
  assert.equal(redact('token = "ghp_abcdefghijklmnopqrstuvwxyz0123"'), 'token = "[REDACTED]"');
});

test('1b. incremental: unchanged files are not read again, a changed one is', async () => {
  const s0 = await reindex();
  assert.equal(s0.changed, 0);
  writeFileSync(join(dir, 'src/crypto.ts'), readFileSync(join(dir, 'src/crypto.ts'), 'utf8') + '\nexport function extra() { return 1; }\n');
  const s1 = await reindex();
  assert.equal(s1.changed, 1);
  assert.ok(ctx.db.prepare("SELECT 1 FROM symbols WHERE name = 'extra'").get());
});

test('2. semantic search: describes behaviour, not names', async () => {
  const r = await run('search_code', { query: 'check the password and create a session token for a user signing in' });
  assert.match(r.split('\n')[0], /login|makeToken|auth/i, r);
  const r2 = await run('search_code', { query: 'creature goes towards a noise' });
  assert.match(r2, /enemy\.gd/, r2);
  const r3 = await run('search_code', { query: 'add sales tax to a price' });
  assert.match(r3.split('\n')[0], /price_with_tax/, r3);
});

test('3. symbol graph: definitions, real callers, callees, paths, impact', async () => {
  assert.match(await run('find_symbol', { name: 'hashPassword', exact: true }), /src\/crypto\.ts/);
  const callers = await run('find_callers', { symbol: 'hashPassword', depth: 3 });
  assert.match(callers, /login/);
  assert.match(callers, /makeToken/);
  assert.match(callers, /main/, 'transitive caller through login');
  assert.match(await run('find_callees', { symbol: 'login' }), /hashPassword/);
  assert.match(await run('call_path', { from: 'main', to: 'hashPassword' }), /main[\s\S]*login[\s\S]*hashPassword/);
  assert.match(await run('impact_analysis', { symbol: 'hashPassword' }), /src\/auth\.ts/);
  assert.match(await run('file_dependencies', { file: 'src/auth.ts' }), /src\/crypto\.ts/);
  assert.match(await run('find_symbol', { name: 'Cart.total', exact: true }), /py\/shop\.py/);
  assert.match(await run('find_callers', { symbol: 'price_with_tax' }), /Cart\.total/);
  assert.match(await run('find_callers', { symbol: '_go' }), /hear/);
});

test('3b. dead code and dead ends', async () => {
  const dead = await run('dead_code', { mode: 'unreferenced', strict: true, path: 'src' });
  assert.match(dead, /unusedHelper/, 'an exported function nothing uses (strict mode)');
  assert.doesNotMatch(dead, /orphanTwo/, 'it is called by unusedHelper, so something still references it');
  assert.doesNotMatch(dead, /hashPassword/, 'used code is not listed');
  const unreachable = await run('dead_code', { mode: 'unreachable', strict: true, path: 'src' });
  assert.match(unreachable, /orphanTwo/, 'but nothing reachable from an entry point ever gets to it');
  assert.match(unreachable, /unusedHelper/);
  assert.doesNotMatch(unreachable, /hashPassword|login/, 'reachable code is not listed');
  assert.match(await run('dead_code', { mode: 'dead_ends', path: 'src' }), /hashPassword|findUser/);
});

test('4. verified facts: refused without evidence, proven, recalled, stale when the code changes', async () => {
  await assert.rejects(run('remember_fact', { text: 'Tokens last an hour', evidence: [] }), /needs evidence/);
  await assert.rejects(run('remember_fact', { text: 'x', evidence: [{ file: 'src/crypto.ts', snippet: 'this text is not in the file' }] }), /no longer contains|could not verify/);
  const saved = await run('remember_fact', { text: 'Session tokens expire after one hour', evidence: [{ file: 'src/crypto.ts', snippet: 'const expires = Date.now() + 3600_000;' }], tags: ['auth'] });
  assert.match(saved, /saved fact #/);
  const rec = await run('recall_facts', { query: 'how long does a login token last' });
  assert.match(rec, /expire after one hour/);
  assert.match(rec, /evidence: src\/crypto\.ts:\d+/);
  // the code moves: the fact follows it
  const p = join(dir, 'src/crypto.ts');
  writeFileSync(p, '// a new comment at the top\n// and another\n' + readFileSync(p, 'utf8'));
  assert.match(await run('verify_facts'), /1 verified, 0 stale/);
  assert.match(await run('recall_facts', { query: 'token expiry' }), /expire after one hour/);
  // the code changes: the fact goes stale and is NOT injected
  writeFileSync(p, readFileSync(p, 'utf8').replace('3600_000', '60_000'));
  const after = await run('recall_facts', { query: 'token expiry' });
  assert.doesNotMatch(after, /expire after one hour/);
  assert.match(after, /stale/);
  assert.match(await run('list_facts', {}), /\[stale\]/);
  await reindex();
});

test('5. bug tracing: stack trace to ranked candidates, upward and downward, then a value through the calls', async () => {
  const stack = `Error: wrong password\n    at login (${join(dir, 'src/auth.ts')}:8:11)\n    at main (${join(dir, 'src/index.ts')}:4:17)`;
  const r = await run('trace_bug', { symptom: 'login fails with wrong password for a valid user', stack });
  assert.match(r, /STACK/);
  assert.match(r, /ROOT-CAUSE CANDIDATES/);
  assert.match(r, /1\. login/);
  assert.match(r, /hashPassword/);
  assert.match(r, /upward: .*main/);
  assert.match(r, /NEXT:/);
  const v = await run('trace_value', { symbol: 'login', variable: 'password' });
  assert.match(v, /passes it as argument 1 to hashPassword/);
  assert.match(v, /parameter "pw"/);
  const sym = await run('trace_bug', { symbol: 'Cart.total' });
  assert.match(sym, /Cart\.total/);
});

test('5b. godot and python stacks are understood', async () => {
  const g = await run('trace_bug', { stack: 'SCRIPT ERROR: Invalid access\n          at: hear (res://gd/enemy.gd:9)' });
  assert.match(g, /gd\/enemy\.gd:9/);
  const py = await run('trace_bug', { stack: `Traceback (most recent call last):\n  File "${join(dir, 'py/shop.py')}", line 14, in total\n    ...` });
  assert.match(py, /Cart\.total/);
});

test('6. checkpoints: snapshot, diff files and symbols, read an old version, search the history', async () => {
  await reindex();
  const a = await run('checkpoint_create', { name: 'before-refactor', note: 'auth works, tokens expire in an hour' });
  assert.match(a, /saved/);
  writeFileSync(join(dir, 'src/auth.ts'), readFileSync(join(dir, 'src/auth.ts'), 'utf8').replace('unknown user', 'no such user') + '\nexport function newThing() { return 1; }\n');
  writeFileSync(join(dir, 'src/fresh.ts'), 'export function fresh() { return 2; }\n');
  await reindex();
  const d = await run('checkpoint_diff', { a: 'before-refactor', path: 'src/auth.ts' });
  assert.match(d, /added: .*newThing/);
  assert.match(d, /~\d+/);
  assert.match(d, /\+.*no such user/);
  assert.match(d, /-.*unknown user/);
  assert.match(await run('checkpoint_file', { checkpoint: 'before-refactor', path: 'src/auth.ts' }), /unknown user/);
  await run('checkpoint_create', { name: 'after-refactor' });
  assert.match(await run('checkpoint_diff', { a: 'before-refactor', b: 'after-refactor' }), /fresh/);
  assert.match(await run('history_search', { query: 'login' }), /symbol-history|checkpoint/);
  assert.match(await run('history_search', { query: 'auth works tokens' }), /before-refactor/);
  assert.match(await run('checkpoint_list'), /after-refactor[\s\S]*before-refactor/);
  // blobs are compressed files on disk, inside the archive only
  const blobs = readdirSync(join(dir, '.chomu-memory', 'blobs'));
  assert.ok(blobs.length > 0);
});

test('6b. compaction: save, then resume in a "new chat"', async () => {
  await run('save_compaction', { summary: 'Refactored auth; tokens now expire in a minute', decisions: ['keep sha256 for now'], open_questions: ['rotate keys?'], next_steps: ['write tests for logout'], files_touched: ['src/auth.ts'] });
  const r = await run('resume_context', { query: 'auth tokens' });
  assert.match(r, /LAST COMPACTION/);
  assert.match(r, /keep sha256 for now/);
  assert.match(r, /rotate keys\?/);
  const inj = await run('inject_context', { task: 'change how login tokens work' });
  assert.match(inj, /RELEVANT CODE/);
});

test('7. privacy: archive stays inside the project, paths cannot escape, the network is loopback only', async () => {
  assert.ok(existsSync(join(dir, '.chomu-memory', 'chomu.db')));
  assert.equal(readFileSync(join(dir, '.chomu-memory', '.gitignore'), 'utf8').trim(), '*');
  assert.throws(() => safeJoin(dir, '../../etc/passwd'), /escapes/);
  assert.throws(() => assertLoopback('https://example.com/api'), /refusing a non-local/);
  assert.doesNotThrow(() => assertLoopback('http://127.0.0.1:11434'));
  const info = await run('archive_info');
  assert.match(info, /network: none/);
  // static check: the only network call in the source is the Ollama embedder, guarded by assertLoopback
  const src = readdirSync(join(here, '..', 'src'), { recursive: true }).filter((f) => f.endsWith('.mjs'));
  for (const f of src) {
    const text = readFileSync(join(here, '..', 'src', f), 'utf8');
    if (/\bfetch\(|node:https?|node:net|XMLHttpRequest|WebSocket/.test(text)) assert.equal(f, 'embed.mjs', `${f} must not touch the network`);
  }
  assert.match(readFileSync(join(here, '..', 'src', 'embed.mjs'), 'utf8'), /assertLoopback\(base\)/);
});

test('8. MCP protocol over stdio: initialize, list tools, call a tool, error handling', async () => {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(here, '..', 'bin', 'chomu-mcp.mjs'), 'serve', '--root', dir], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const rpc = (id, method, params) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  const reply = async (id) => { for (let i = 0; i < 200; i++) { const m = lines.find((l) => l.id === id); if (m) return m; await new Promise((r) => setTimeout(r, 50)); } throw new Error(`no reply to ${id}`); };
  rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const init = await reply(1);
  assert.equal(init.result.serverInfo.name, 'chomu-memory');
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.match(init.result.instructions, /resume_context/);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  rpc(2, 'tools/list', {});
  const list = await reply(2);
  const names = list.result.tools.map((t) => t.name);
  for (const n of ['search_code', 'find_callers', 'remember_fact', 'recall_facts', 'trace_bug', 'checkpoint_create', 'history_search', 'archive_info', 'resume_context', 'dead_code']) assert.ok(names.includes(n), n);
  assert.ok(list.result.tools.every((t) => t.inputSchema.type === 'object'));
  rpc(3, 'tools/call', { name: 'find_symbol', arguments: { name: 'login', exact: true } });
  assert.match((await reply(3)).result.content[0].text, /src\/auth\.ts/);
  rpc(4, 'tools/call', { name: 'get_symbol', arguments: { symbol: 'doesNotExist' } });
  const bad = await reply(4);
  assert.equal(bad.result.isError, true);
  rpc(5, 'nope/nothing', {});
  assert.equal((await reply(5)).error.code, -32601);
  child.stdin.end();
  await new Promise((r) => child.on('close', r));
});
