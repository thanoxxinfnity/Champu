#!/usr/bin/env node
/**
 * Chomugiri Terminal Bridge Agent
 * ================================
 * Runs on the DEVELOPER'S machine. Expose it with ngrok or a Cloudflare Tunnel
 * and paste the public URL + token into Chomugiri → Settings → Terminal Bridge.
 *
 *   node agent/chomugiri-agent.mjs --port 7717 --workspace ~/chomugiri-work
 *   ngrok http 7717
 *   # or: cloudflared tunnel --url http://localhost:7717
 *
 * Zero dependencies. Node >= 20.
 *
 * SECURITY MODEL — read this before exposing the port.
 *   * Every request needs the bearer token printed at startup. No token, no shell.
 *   * All filesystem operations are jailed to the workspace root; `..` escapes
 *     and absolute paths are rejected before any syscall.
 *   * Commands run through the shell by design — that is the product. Anyone
 *     holding the token has the same power as your terminal. Do not paste the
 *     token anywhere public, and stop the tunnel when you are done.
 *   * `--allow-cmd` restricts execution to a prefix allowlist if you want a
 *     narrower blast radius (e.g. --allow-cmd "./gradlew,npm,node,git").
 */

import { createServer } from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createZip } from './zip.mjs';

// ── CLI arguments ───────────────────────────────────────────────────────────

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  return fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const PORT = Number(arg('port', process.env.CHOMUGIRI_PORT ?? 7717));
const HOST = arg('host', process.env.CHOMUGIRI_HOST ?? '127.0.0.1');
const WORKSPACE = path.resolve(
  (arg('workspace', process.env.CHOMUGIRI_WORKSPACE ?? path.join(homedir(), 'chomugiri-workspace'))).replace(/^~/, homedir()),
);
const ARTIFACTS = path.join(WORKSPACE, '.artifacts');
const TOKEN = arg('token', process.env.CHOMUGIRI_TOKEN ?? randomBytes(24).toString('base64url'));
const ALLOW_CMD = (arg('allow-cmd', process.env.CHOMUGIRI_ALLOW_CMD ?? '') || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const MAX_EXEC_MS = Number(arg('max-exec-ms', 45 * 60_000));
const VERSION = '1.0.0';

// ── Execution registry ──────────────────────────────────────────────────────

/** @type {Map<string, {id:string, cmd:string, cwd:string, child:import('node:child_process').ChildProcess, buffer:Array<{stream:string,data:string,at:number}>, subscribers:Set<import('node:http').ServerResponse>, exitCode:number|null, signal:string|null, startedAt:number, endedAt:number|null, killed:boolean}>} */
const runs = new Map();
const MAX_BUFFER_LINES = 5000;
const RUN_TTL_MS = 60 * 60_000;

setInterval(() => {
  const cutoff = Date.now() - RUN_TTL_MS;
  for (const [id, run] of runs) if (run.endedAt && run.endedAt < cutoff) runs.delete(id);
}, 5 * 60_000).unref();

// ── Path jail ───────────────────────────────────────────────────────────────

function resolveInWorkspace(relative) {
  const rel = String(relative ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(WORKSPACE, rel);
  const root = WORKSPACE.endsWith(path.sep) ? WORKSPACE : WORKSPACE + path.sep;
  if (abs !== WORKSPACE && !abs.startsWith(root)) {
    const err = new Error(`Path escapes the workspace jail: ${relative}`);
    err.statusCode = 403;
    throw err;
  }
  return abs;
}

// ── Toolchain detection ─────────────────────────────────────────────────────

function probe(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 6000 }).toString().trim().split('\n')[0].slice(0, 160);
  } catch {
    return null;
  }
}

let toolchainCache = null;
let toolchainAt = 0;

function toolchains() {
  if (toolchainCache && Date.now() - toolchainAt < 60_000) return toolchainCache;
  const win = process.platform === 'win32';
  const nul = win ? 'NUL' : '/dev/null';
  toolchainCache = {
    node: probe('node --version'),
    npm: probe(`npm --version 2>${nul}`),
    git: probe('git --version'),
    java: probe(`java -version 2>&1`),
    gradle: probe(`gradle --version 2>${nul}`),
    python: probe(`python3 --version 2>${nul}`) ?? probe(`python --version 2>${nul}`),
    androidSdk: process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? null,
    adb: probe(`adb version 2>${nul}`),
    docker: probe(`docker --version 2>${nul}`),
    zip: probe(`zip -v 2>${nul}`),
  };
  toolchainAt = Date.now();
  return toolchainCache;
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Chomugiri-Token, ngrok-skip-browser-warning',
  'Access-Control-Max-Age': '86400',
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...CORS,
    ...headers,
  });
  res.end(payload);
}

function authorized(req) {
  const header = req.headers.authorization ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const custom = req.headers['x-chomugiri-token'];
  const supplied = bearer ?? (Array.isArray(custom) ? custom[0] : custom);
  if (!supplied || supplied.length !== TOKEN.length) return false;
  // Constant-time-ish compare; lengths already match.
  let diff = 0;
  for (let i = 0; i < TOKEN.length; i++) diff |= TOKEN.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}

async function readJson(req, limitBytes = 64 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      const err = new Error('Request body too large.');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const err = new Error('Body is not valid JSON.');
    err.statusCode = 400;
    throw err;
  }
}

function commandAllowed(cmd) {
  if (!ALLOW_CMD.length) return true;
  const head = cmd.trim();
  return ALLOW_CMD.some((prefix) => head === prefix || head.startsWith(prefix + ' '));
}

// ── Handlers ────────────────────────────────────────────────────────────────

function startRun({ cmd, cwd, env, timeoutMs }) {
  const id = randomUUID();
  const workdir = resolveInWorkspace(cwd ?? '.');
  if (!existsSync(workdir)) {
    const err = new Error(`cwd does not exist: ${cwd}`);
    err.statusCode = 400;
    throw err;
  }

  const shell = process.platform === 'win32' ? process.env.COMSPEC ?? 'cmd.exe' : '/bin/bash';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', cmd] : ['-lc', cmd];

  const child = spawn(shell, args, {
    cwd: workdir,
    env: { ...process.env, ...env, CHOMUGIRI: '1', CI: '1', FORCE_COLOR: '0', TERM: 'dumb' },
    windowsHide: true,
  });

  const run = {
    id, cmd, cwd: path.relative(WORKSPACE, workdir) || '.', child,
    buffer: [], subscribers: new Set(),
    exitCode: null, signal: null, startedAt: Date.now(), endedAt: null, killed: false,
  };
  runs.set(id, run);

  const push = (stream, data) => {
    const text = data.toString('utf8');
    const frame = { stream, data: text, at: Date.now() };
    run.buffer.push(frame);
    if (run.buffer.length > MAX_BUFFER_LINES) run.buffer.splice(0, run.buffer.length - MAX_BUFFER_LINES);
    broadcast(run, { type: stream, data: text });
  };

  child.stdout.on('data', (d) => push('stdout', d));
  child.stderr.on('data', (d) => push('stderr', d));

  const timer = setTimeout(() => {
    if (run.endedAt) return;
    run.killed = true;
    push('stderr', `\n[chomugiri] timeout after ${Math.round((timeoutMs ?? MAX_EXEC_MS) / 1000)}s — terminating\n`);
    child.kill('SIGKILL');
  }, Math.min(timeoutMs ?? MAX_EXEC_MS, MAX_EXEC_MS));

  child.on('error', (err) => {
    push('stderr', `[chomugiri] spawn failed: ${err.message}\n`);
  });

  child.on('close', (code, signal) => {
    clearTimeout(timer);
    run.exitCode = code;
    run.signal = signal;
    run.endedAt = Date.now();
    broadcast(run, {
      type: 'exit',
      exitCode: code,
      signal,
      durationMs: run.endedAt - run.startedAt,
      killed: run.killed,
    });
    for (const res of run.subscribers) res.end();
    run.subscribers.clear();
  });

  return run;
}

function broadcast(run, event) {
  const payload = `data: ${JSON.stringify({ execId: run.id, ...event })}\n\n`;
  for (const res of run.subscribers) {
    try { res.write(payload); } catch { run.subscribers.delete(res); }
  }
}

async function walk(dir, base = '', out = [], depth = 0) {
  if (depth > 12) return out;
  let items;
  try { items = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const item of items) {
    if (item.name === 'node_modules' || item.name === '.git' || item.name === '.gradle') continue;
    const rel = base ? `${base}/${item.name}` : item.name;
    if (item.isDirectory()) await walk(path.join(dir, item.name), rel, out, depth + 1);
    else if (item.isFile()) {
      const s = await stat(path.join(dir, item.name)).catch(() => null);
      if (s) out.push({ path: rel, bytes: s.size, modified: s.mtimeMs });
    }
  }
  return out;
}

const routes = {
  'GET /v1/health': async () => ({
    ok: true,
    agent: 'chomugiri-bridge',
    version: VERSION,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    workspace: WORKSPACE,
    uptimeSec: Math.round(process.uptime()),
    activeRuns: [...runs.values()].filter((r) => !r.endedAt).length,
    toolchains: toolchains(),
    allowList: ALLOW_CMD.length ? ALLOW_CMD : null,
    serverTime: Date.now(),
  }),

  'POST /v1/exec': async (req) => {
    const body = await readJson(req);
    const cmd = String(body.cmd ?? '').trim();
    if (!cmd) { const e = new Error('`cmd` is required.'); e.statusCode = 400; throw e; }
    if (!commandAllowed(cmd)) {
      const e = new Error(`Command rejected by --allow-cmd allowlist. Permitted prefixes: ${ALLOW_CMD.join(', ')}`);
      e.statusCode = 403;
      throw e;
    }
    const run = startRun({ cmd, cwd: body.cwd, env: body.env, timeoutMs: body.timeoutMs });
    return { execId: run.id, cmd: run.cmd, cwd: run.cwd, startedAt: run.startedAt };
  },

  'GET /v1/runs': async () => ({
    runs: [...runs.values()].map((r) => ({
      execId: r.id, cmd: r.cmd, cwd: r.cwd, exitCode: r.exitCode,
      startedAt: r.startedAt, endedAt: r.endedAt, running: !r.endedAt,
    })),
  }),

  'POST /v1/fs/write': async (req) => {
    const body = await readJson(req);
    const files = Array.isArray(body.files) ? body.files : [body];
    const written = [];
    for (const file of files) {
      if (!file?.path) continue;
      const abs = resolveInWorkspace(file.path);
      await mkdir(path.dirname(abs), { recursive: true });
      const data = file.base64 ? Buffer.from(file.base64, 'base64') : Buffer.from(String(file.content ?? ''), 'utf8');
      await writeFile(abs, data);
      written.push({ path: file.path, bytes: data.length });
    }
    return { written, count: written.length };
  },

  'GET /v1/fs/read': async (_req, url) => {
    const abs = resolveInWorkspace(url.searchParams.get('path') ?? '');
    const s = await stat(abs);
    if (s.size > 16 * 1024 * 1024) { const e = new Error('File exceeds the 16MB inline read limit — use /v1/artifact.'); e.statusCode = 413; throw e; }
    const buf = await readFile(abs);
    const binary = buf.subarray(0, 4096).includes(0);
    return binary
      ? { path: url.searchParams.get('path'), bytes: s.size, base64: buf.toString('base64'), binary: true }
      : { path: url.searchParams.get('path'), bytes: s.size, content: buf.toString('utf8'), binary: false };
  },

  'GET /v1/fs/list': async (_req, url) => {
    const rel = url.searchParams.get('path') ?? '.';
    const abs = resolveInWorkspace(rel);
    await mkdir(abs, { recursive: true });
    return { root: rel, files: await walk(abs) };
  },

  'POST /v1/fs/delete': async (req) => {
    const body = await readJson(req);
    const abs = resolveInWorkspace(body.path ?? '');
    if (abs === WORKSPACE) { const e = new Error('Refusing to delete the workspace root.'); e.statusCode = 400; throw e; }
    await rm(abs, { recursive: true, force: true });
    return { deleted: body.path };
  },

  'POST /v1/fs/zip': async (req) => {
    const body = await readJson(req);
    const srcRel = body.path ?? '.';
    const abs = resolveInWorkspace(srcRel);
    const name = String(body.name ?? 'bundle.zip').replace(/[^\w.-]/g, '_');
    const files = await walk(abs);
    if (!files.length) { const e = new Error(`Nothing to archive under "${srcRel}".`); e.statusCode = 400; throw e; }

    const entries = [];
    for (const f of files) entries.push({ name: f.path, data: await readFile(path.join(abs, f.path)) });

    await mkdir(ARTIFACTS, { recursive: true });
    const outPath = path.join(ARTIFACTS, name);
    const zip = createZip(entries);
    await writeFile(outPath, zip);
    return { artifact: name, bytes: zip.length, entries: entries.length, url: `/v1/artifact/${encodeURIComponent(name)}` };
  },

  'GET /v1/artifacts': async () => {
    await mkdir(ARTIFACTS, { recursive: true });
    const names = await readdir(ARTIFACTS);
    const out = [];
    for (const name of names) {
      const s = await stat(path.join(ARTIFACTS, name)).catch(() => null);
      if (s?.isFile()) out.push({ name, bytes: s.size, modified: s.mtimeMs, url: `/v1/artifact/${encodeURIComponent(name)}` });
    }
    return { artifacts: out.sort((a, b) => b.modified - a.modified) };
  },
};

/** Collect build outputs (APK/AAB/ZIP) from anywhere in the workspace. */
routes['POST /v1/collect'] = async (req) => {
  const body = await readJson(req);
  const patterns = body.patterns ?? ['.apk', '.aab', '.zip', '.mcpack', '.mcaddon', '.jar'];
  const files = await walk(WORKSPACE);
  const matches = files.filter((f) => patterns.some((p) => f.path.toLowerCase().endsWith(p.toLowerCase())));

  await mkdir(ARTIFACTS, { recursive: true });
  const collected = [];
  for (const m of matches.slice(0, 40)) {
    if (m.path.startsWith('.artifacts/')) continue;
    const name = path.basename(m.path);
    await writeFile(path.join(ARTIFACTS, name), await readFile(path.join(WORKSPACE, m.path)));
    collected.push({ name, source: m.path, bytes: m.bytes, url: `/v1/artifact/${encodeURIComponent(name)}` });
  }
  return { collected, count: collected.length };
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  // Unauthenticated liveness ping so the UI can distinguish "tunnel down" from
  // "bad token" without leaking anything about the host.
  if (url.pathname === '/v1/ping') {
    return send(res, 200, { ok: true, agent: 'chomugiri-bridge', version: VERSION, requiresAuth: true });
  }

  if (!authorized(req)) {
    return send(res, 401, { error: 'Unauthorized. Send the bridge token as `Authorization: Bearer <token>`.', code: 'bad_token' });
  }

  // SSE stream — handled outside the JSON route table.
  const streamMatch = /^\/v1\/stream\/([\w-]+)$/.exec(url.pathname);
  if (req.method === 'GET' && streamMatch) {
    const run = runs.get(streamMatch[1]);
    if (!run) return send(res, 404, { error: 'Unknown execId.', code: 'no_such_run' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...CORS,
    });
    res.write(`data: ${JSON.stringify({ execId: run.id, type: 'start', cmd: run.cmd, cwd: run.cwd })}\n\n`);
    for (const frame of run.buffer) res.write(`data: ${JSON.stringify({ execId: run.id, type: frame.stream, data: frame.data, replay: true })}\n\n`);

    if (run.endedAt) {
      res.write(`data: ${JSON.stringify({ execId: run.id, type: 'exit', exitCode: run.exitCode, signal: run.signal, durationMs: run.endedAt - run.startedAt, killed: run.killed })}\n\n`);
      return res.end();
    }

    run.subscribers.add(res);
    const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 15_000);
    req.on('close', () => { clearInterval(keepAlive); run.subscribers.delete(res); });
    return undefined;
  }

  // Artifact download.
  const artifactMatch = /^\/v1\/artifact\/(.+)$/.exec(url.pathname);
  if (req.method === 'GET' && artifactMatch) {
    const name = decodeURIComponent(artifactMatch[1]);
    if (name.includes('/') || name.includes('..')) return send(res, 400, { error: 'Bad artifact name.' });
    const abs = path.join(ARTIFACTS, name);
    if (!existsSync(abs)) return send(res, 404, { error: `No artifact named "${name}".` });
    const buf = await readFile(abs);
    return send(res, 200, buf, {
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(buf.length),
    });
  }

  // Kill a run.
  const killMatch = /^\/v1\/kill\/([\w-]+)$/.exec(url.pathname);
  if (req.method === 'POST' && killMatch) {
    const run = runs.get(killMatch[1]);
    if (!run) return send(res, 404, { error: 'Unknown execId.' });
    if (run.endedAt) return send(res, 200, { execId: run.id, alreadyExited: true, exitCode: run.exitCode });
    run.killed = true;
    run.child.kill('SIGTERM');
    setTimeout(() => { if (!run.endedAt) run.child.kill('SIGKILL'); }, 5000).unref();
    return send(res, 200, { execId: run.id, killing: true });
  }

  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) return send(res, 404, { error: `No route for ${req.method} ${url.pathname}`, code: 'no_route' });

  try {
    return send(res, 200, await handler(req, url));
  } catch (err) {
    const status = err.statusCode ?? 500;
    return send(res, status, { error: err.message, code: err.code ?? 'agent_error' });
  }
});

await mkdir(WORKSPACE, { recursive: true });
await mkdir(ARTIFACTS, { recursive: true });

server.listen(PORT, HOST, () => {
  const tools = toolchains();
  const line = (label, value) => `  ${label.padEnd(14)} ${value ?? '\x1b[2mnot found\x1b[0m'}`;
  process.stdout.write(`
\x1b[38;5;48m╔══════════════════════════════════════════════════════════════╗
║   CHOMUGIRI TERMINAL BRIDGE  ·  v${VERSION}                        ║
╚══════════════════════════════════════════════════════════════╝\x1b[0m

  \x1b[1mListening\x1b[0m      http://${HOST}:${PORT}
  \x1b[1mWorkspace\x1b[0m      ${WORKSPACE}
  \x1b[1mToken\x1b[0m          \x1b[38;5;99m${TOKEN}\x1b[0m
${ALLOW_CMD.length ? `  \x1b[1mAllowlist\x1b[0m      ${ALLOW_CMD.join(', ')}\n` : ''}
  \x1b[2m── toolchain ──────────────────────────────────────────────\x1b[0m
${line('node', tools.node)}
${line('java', tools.java)}
${line('gradle', tools.gradle)}
${line('android sdk', tools.androidSdk)}
${line('python', tools.python)}
${line('git', tools.git)}

  \x1b[2mExpose it:\x1b[0m
    ngrok http ${PORT}
    cloudflared tunnel --url http://localhost:${PORT}

  \x1b[2mThen paste the public URL + token into Chomugiri → Settings → Terminal Bridge.\x1b[0m
  \x1b[38;5;208mAnyone with this token can run shell commands as you. Do not share it.\x1b[0m

`);
});

const shutdown = () => {
  for (const run of runs.values()) if (!run.endedAt) run.child.kill('SIGTERM');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
