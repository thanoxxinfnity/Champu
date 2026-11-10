/**
 * Chomugiri CLI — the engine: providers, the action protocol, the tools, and the agent loop. No dependencies, so it runs anywhere Node 18+
 * does (a laptop, a server, Termux on a phone).
 *
 * How the agent works. The model is never given "function calling" (many free endpoints do not support it). Instead a reply may contain
 * action blocks, and one reply can hold several, which keeps the number of model calls low on rate-limited free tiers:
 *
 *     ```run                      a shell command (one block = one command line or script)
 *     ```read                     files to read, one per line, optionally path:from-to
 *     ```search                   a regular expression, optionally `| glob`
 *     ```list                     a folder
 *     ```write path=src/a.js      a whole file
 *     ```edit path=src/a.js       one or more SEARCH/REPLACE hunks
 *
 * The loop runs the actions, hands the results back, and stops at the first reply with no action block (that reply is the answer).
 * Reads are free; writes and commands ask first unless the user allowed them. Files stay inside the project folder.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const VERSION = '1.0.0';

// ── providers ────────────────────────────────────────────────────────────────

/** OpenAI-compatible chat endpoints. `key` names the environment variable; null means no key is needed. */
export const PROVIDERS = {
  pollinations: { name: 'Pollinations (free, no key)', base: 'https://text.pollinations.ai/openai', key: null, model: 'openai', maxTokens: 4000, note: 'Free tier: about one reply every 45 seconds per network.' },
  openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', key: 'OPENROUTER_API_KEY', model: 'deepseek/deepseek-chat-v3-0324:free' },
  groq: { name: 'Groq', base: 'https://api.groq.com/openai/v1', key: 'GROQ_API_KEY', model: 'llama-3.3-70b-versatile' },
  gemini: { name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'GEMINI_API_KEY', model: 'gemini-2.5-flash' },
  nvidia: { name: 'NVIDIA NIM', base: 'https://integrate.api.nvidia.com/v1', key: 'NVIDIA_API_KEY', model: 'meta/llama-3.3-70b-instruct' },
  cerebras: { name: 'Cerebras', base: 'https://api.cerebras.ai/v1', key: 'CEREBRAS_API_KEY', model: 'llama-3.3-70b' },
  mistral: { name: 'Mistral', base: 'https://api.mistral.ai/v1', key: 'MISTRAL_API_KEY', model: 'mistral-large-latest' },
  openai: { name: 'OpenAI', base: 'https://api.openai.com/v1', key: 'OPENAI_API_KEY', model: 'gpt-4.1-mini' },
  ollama: { name: 'Ollama (this computer)', base: 'http://127.0.0.1:11434/v1', key: null, model: 'qwen2.5-coder' },
};

export const CONFIG_DIR = process.env.CHOMUGIRI_HOME || path.join(homedir(), '.chomugiri');
const CONFIG_FILE = () => path.join(CONFIG_DIR, 'config.json');

export function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_FILE(), 'utf8')); } catch { return {}; }
}
export function saveConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE(), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
}

/** Works out which endpoint, model and key to use from flags, then the saved config, then the environment. */
export function resolveProvider(opts = {}, cfg = loadConfig(), env = process.env) {
  const id = opts.provider || cfg.provider || (env.CHOMUGIRI_BASE_URL ? 'custom' : 'pollinations');
  const preset = PROVIDERS[id] ?? { name: 'Custom endpoint', base: '', key: 'CHOMUGIRI_API_KEY', model: '' };
  const base = (opts.baseUrl || (id === 'custom' ? cfg.baseUrl || env.CHOMUGIRI_BASE_URL : '') || preset.base || '').replace(/\/+$/, '');
  const model = opts.model || (cfg.models ?? {})[id] || (id === (cfg.provider ?? id) ? cfg.model : '') || env.CHOMUGIRI_MODEL || preset.model;
  const key = opts.apiKey || (cfg.keys ?? {})[id] || (preset.key ? env[preset.key] : '') || env.CHOMUGIRI_API_KEY || '';
  if (!base) throw new Error('No endpoint. Use --base-url https://host/v1 or pick a provider with --provider.');
  if (!model) throw new Error('No model. Use --model <name>.');
  return { id, name: preset.name, base, model, key, needsKey: Boolean(preset.key), keyEnv: preset.key, maxTokens: preset.maxTokens ?? 8000, note: preset.note };
}

/**
 * One streamed chat completion. `onText` gets the reply as it arrives. Returns { content, usage }.
 * A free-tier "wait N seconds" answer is retried after the wait the server names (up to twice).
 */
export async function chat(provider, messages, { onText, onWait, signal, fetchImpl = globalThis.fetch, temperature = 0.2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(`${provider.base}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', ...(provider.key ? { authorization: `Bearer ${provider.key}` } : {}) },
      body: JSON.stringify({ model: provider.model, messages, stream: true, temperature, max_tokens: provider.maxTokens, ...(provider.tools === false ? {} : { tools: TOOLS }) }),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 600);
      // An endpoint without tool calling: from now on actions are written as fenced blocks instead.
      if (provider.tools !== false && res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403 && res.status !== 429 && /tool|function/i.test(text)) { provider.tools = false; continue; }
      const wait = waitFrom(res, text);
      if (wait !== null && attempt < 2) { onWait?.(wait); await sleep(wait, signal); continue; }
      throw new Error(explainHttp(res.status, text, provider));
    }
    let content = '', usage = null, buffer = '';
    const calls = [];
    const takeCalls = (list) => {
      for (const t of list ?? []) {
        const at = calls[t.index ?? 0] ?? (calls[t.index ?? 0] = { id: '', name: '', args: '' });
        if (t.id) at.id = t.id;
        if (t.function?.name) at.name = t.function.name;
        if (typeof t.function?.arguments === 'string') at.args += t.function.arguments;
      }
    };
    const take = (line) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      try {
        const j = JSON.parse(data);
        const piece = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? '';
        if (piece) { content += piece; onText?.(piece); }
        takeCalls(j.choices?.[0]?.delta?.tool_calls ?? j.choices?.[0]?.message?.tool_calls);
        if (j.usage) usage = j.usage;
        if (j.error) throw new Error(typeof j.error === 'string' ? j.error : j.error.message ?? 'The model returned an error.');
      } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
    };
    if (res.body && (res.headers.get('content-type') ?? '').includes('event-stream')) {
      const dec = new TextDecoder();
      for await (const chunk of res.body) {
        buffer += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) { take(buffer.slice(0, i).trimEnd()); buffer = buffer.slice(i + 1); }
      }
      if (buffer.trim()) take(buffer.trim());
    } else {
      // An endpoint that ignored `stream`: one JSON body.
      const j = await res.json().catch(() => ({}));
      content = j.choices?.[0]?.message?.content ?? '';
      takeCalls((j.choices?.[0]?.message?.tool_calls ?? []).map((t, index) => ({ index, ...t })));
      usage = j.usage ?? null;
      if (content) onText?.(content);
    }
    const toolCalls = calls.filter((t) => t && t.name).map((t, i) => ({ id: t.id || `call_${Date.now().toString(36)}_${i}`, name: t.name, args: t.args }));
    if (!content.trim() && !toolCalls.length) {
      if (attempt < 1) continue;
      throw new Error('The model answered with nothing. Try again, or pick another model with /model.');
    }
    return { content, toolCalls, usage };
  }
}

function waitFrom(res, text) {
  const header = Number(res.headers.get('retry-after'));
  const named = /(?:retry after|try again in|every)\s*(\d+(?:\.\d+)?)\s*s/i.exec(text);
  if (res.status !== 429 && !/free limit|rate limit/i.test(text)) return null;
  const secs = Number.isFinite(header) && header > 0 ? header : named ? Number(named[1]) : 20;
  return Math.min(90, Math.ceil(secs) + 1) * 1000;
}
function explainHttp(status, text, provider) {
  const detail = text.replace(/\s+/g, ' ').slice(0, 240);
  if (status === 401 || status === 403) return `${provider.name} refused the key (${status}). ${provider.keyEnv ? `Set ${provider.keyEnv}, or run /key.` : ''} ${detail}`.trim();
  if (status === 404) return `${provider.name} does not know the model "${provider.model}" (404). Pick another with /model. ${detail}`.trim();
  if (status === 429) return `${provider.name} is rate limiting (429). Wait a little, or switch provider with /provider. ${detail}`.trim();
  return `${provider.name} answered ${status}. ${detail}`.trim();
}
export function sleep(ms, signal) {
  return new Promise((resolve) => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); });
}

// ── tools the model can call ────────────────────────────────────────────────

const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
export const TOOLS = [
  fn('run', 'Run a shell command in the project folder and get its output and exit code.', { command: { type: 'string' } }, ['command']),
  fn('read', 'Read files. Each item is a path, optionally with a line range like src/a.js:120-220.', { paths: { type: 'array', items: { type: 'string' } } }, ['paths']),
  fn('search', 'Search the project files for a regular expression. glob narrows the files, e.g. src/**/*.js.', { pattern: { type: 'string' }, glob: { type: 'string' } }, ['pattern']),
  fn('list', 'List the files under a folder of the project.', { path: { type: 'string' } }, []),
  fn('write', 'Create a file or replace its whole content.', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  fn('edit', 'Change part of a file: `search` must be text copied exactly from the file and found once; it is replaced by `replace`.', { path: { type: 'string' }, search: { type: 'string' }, replace: { type: 'string' } }, ['path', 'search', 'replace']),
];

/** A tool call as the same action a fenced block gives. A call with bad JSON becomes an action that reports the error. */
export function actionFromCall(call) {
  let a;
  try { a = JSON.parse(call.args || '{}'); } catch { return { kind: 'invalid', body: `The arguments of ${call.name} were not valid JSON. Call it again with valid JSON.` }; }
  const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  switch (call.name) {
    case 'run': return { kind: 'run', body: str(a.command ?? a.cmd) };
    case 'read': return { kind: 'read', body: (Array.isArray(a.paths) ? a.paths : [a.path ?? a.paths]).filter(Boolean).map(str).join('\n') };
    case 'search': return { kind: 'search', body: a.glob ? `${str(a.pattern)} | ${str(a.glob)}` : str(a.pattern) };
    case 'list': return { kind: 'list', body: str(a.path) || '.' };
    case 'write': return { kind: 'write', path: str(a.path), body: str(a.content) };
    case 'edit': return { kind: 'edit', path: str(a.path), body: '', hunks: [{ search: str(a.search), replace: str(a.replace) }] };
    default: return { kind: 'invalid', body: `There is no tool named "${call.name}". The tools are run, read, search, list, write, edit.` };
  }
}

// ── the action protocol ──────────────────────────────────────────────────────

const KINDS = new Set(['run', 'read', 'search', 'list', 'write', 'edit']);
const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\n]*)$/;

/** The action blocks in a reply, in order. A block still being written (no closing fence) is not an action yet. */
export function parseActions(reply) {
  const out = [];
  let open = null;
  for (const line of String(reply).split('\n')) {
    const m = FENCE.exec(line);
    if (open) {
      if (m && m[1][0] === open.fence[0] && m[1].length >= open.fence.length && !m[2].trim()) {
        const kind = open.info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
        if (KINDS.has(kind)) {
          const p = /(?:path|file)=("[^"]+"|'[^']+'|\S+)/.exec(open.info);
          out.push({ kind, path: p ? p[1].replace(/^["']|["']$/g, '') : undefined, body: open.body.join('\n') });
        }
        open = null;
      } else open.body.push(line);
      continue;
    }
    if (m) open = { fence: m[1], info: m[2], body: [] };
  }
  return out;
}

/** The reply without its action blocks: the words meant for the person. */
export function proseOf(reply) {
  const out = [];
  let open = null;
  for (const line of String(reply).split('\n')) {
    const m = FENCE.exec(line);
    if (open) {
      if (m && m[1][0] === open.fence[0] && m[1].length >= open.fence.length && !m[2].trim()) { if (!open.action) out.push(...open.held, line); open = null; }
      else open.held.push(line);
      continue;
    }
    if (m) { open = { fence: m[1], action: KINDS.has(m[2].trim().split(/\s+/)[0]?.toLowerCase() ?? ''), held: [line] }; continue; }
    out.push(line);
  }
  if (open && !open.action) out.push(...open.held);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** SEARCH/REPLACE hunks of an edit block. */
export function parseHunks(body) {
  const hunks = [];
  const re = /<{5,}\s*SEARCH\s*\n([\s\S]*?)\n?={5,}\s*\n([\s\S]*?)\n?>{5,}\s*REPLACE/g;
  let m;
  while ((m = re.exec(body))) hunks.push({ search: m[1], replace: m[2] });
  return hunks;
}

/** Applies hunks to text. Each SEARCH must be found exactly once (after an exact try, a try that ignores trailing spaces). */
export function applyHunks(text, hunks) {
  let out = text;
  for (const [i, h] of hunks.entries()) {
    if (!h.search.trim()) throw new Error(`hunk ${i + 1}: SEARCH is empty. To create a file use a write block.`);
    let count = out.split(h.search).length - 1;
    let search = h.search;
    if (count === 0) {
      // Models drop or add trailing spaces; match line by line without them.
      const norm = (s) => s.split('\n').map((l) => l.trimEnd()).join('\n');
      const lines = out.split('\n');
      const want = norm(h.search).split('\n');
      const hits = [];
      for (let at = 0; at + want.length <= lines.length; at++) if (want.every((w, k) => lines[at + k].trimEnd() === w)) hits.push(at);
      if (hits.length === 1) { search = lines.slice(hits[0], hits[0] + want.length).join('\n'); count = 1; }
      else count = hits.length;
    }
    if (count === 0) throw new Error(`hunk ${i + 1}: SEARCH text was not found. Read the file again and copy the lines exactly.`);
    if (count > 1) throw new Error(`hunk ${i + 1}: SEARCH text appears ${count} times. Add more surrounding lines so it is unique.`);
    out = out.replace(search, () => h.replace);
  }
  return out;
}

// ── tools ────────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', '.gradle', 'build', 'dist', '.next', '.venv', '__pycache__', 'target', '.cache']);
const MAX_OUT = 12_000;

/** A path the model named, kept inside the project folder. */
export function jail(root, given) {
  const abs = path.resolve(root, String(given ?? '').trim() || '.');
  const base = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(base)) throw new Error(`"${given}" is outside the project folder (${root}). Work inside it.`);
  return abs;
}

const clip = (s, max = MAX_OUT) => (s.length <= max ? s : `${s.slice(0, Math.floor(max * 0.6))}\n… (${s.length - max} characters cut) …\n${s.slice(-Math.floor(max * 0.4))}`);

/** Commands that are never run, whatever the permission mode. */
const CATASTROPHIC = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+(-[a-z]*\s+)*(\/|~|\$HOME|\/\*|~\/\*)(\s|$)/i,
  /\bmkfs(\.\w+)?\b/i, /\bdd\b[^\n]*\bof=\/dev\//i, /:\(\)\s*\{\s*:\|:&\s*\}\s*;/, /\b(shutdown|reboot|halt|poweroff)\b/i,
  />\s*\/dev\/(sd[a-z]|nvme|mmcblk)/i, /\bchmod\s+(-R\s+)?[0-7]*777\s+\/(\s|$)/i,
];
/** Commands that always ask, even when the user said "allow everything". */
const RISKY = [/\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i, /\bsudo\b/i, /\bgit\s+push\b[^\n]*(--force|-f)\b/i, /\bgit\s+reset\s+--hard\b/i, /\brm\s+-[a-z]*r/i, /\bnpm\s+publish\b/i, /\bdrop\s+(table|database)\b/i];

export function commandRisk(cmd) {
  if (CATASTROPHIC.some((r) => r.test(cmd))) return 'refuse';
  if (RISKY.some((r) => r.test(cmd))) return 'risky';
  return 'normal';
}

export function runShell(cmd, { cwd, timeoutMs = 120_000, signal, onData } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, env: { ...process.env, CI: '1', FORCE_COLOR: '0', TERM: 'dumb' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', done = false;
    const add = (d) => { const s = d.toString(); out += s; onData?.(s); if (out.length > 400_000) out = out.slice(-200_000); };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const finish = (code, why) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, output: out, why }); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(null, `stopped after ${Math.round(timeoutMs / 1000)} s`); }, timeoutMs);
    signal?.addEventListener('abort', () => { child.kill('SIGKILL'); finish(null, 'stopped by you'); }, { once: true });
    child.on('error', (e) => finish(127, e.message));
    child.on('close', (code) => finish(code));
  });
}

function walk(root, dir, out, limit) {
  let items = [];
  try { items = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= limit) return;
    if (it.name.startsWith('.') && it.name !== '.env.example' && it.name !== '.github') continue;
    const abs = path.join(dir, it.name);
    if (it.isDirectory()) { if (!SKIP_DIRS.has(it.name)) walk(root, abs, out, limit); }
    else if (it.isFile()) out.push(path.relative(root, abs));
  }
}
export function listFiles(root, sub = '.', limit = 400) {
  const out = [];
  walk(root, jail(root, sub), out, limit);
  return out;
}
const globToRe = (glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*')}$`);

/**
 * Carries out one action. `ask(kind, title, detail)` resolves true when the person allows it.
 * Returns { ok, title, result } where `result` is what the model is told and `title` is the one line shown on screen.
 */
export async function execute(action, { root, ask, signal, onData, timeoutMs }) {
  const { kind } = action;
  if (kind === 'invalid') return { ok: false, title: 'Tool call', summary: 'error', result: `ERROR: ${action.body}` };
  try {
    if (kind === 'read') {
      const parts = [];
      for (const raw of action.body.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12)) {
        const m = /^(.*?)(?::(\d+)(?:-(\d+))?)?$/.exec(raw);
        const file = jail(root, m[1]);
        if (!existsSync(file)) { parts.push(`--- ${m[1]}\n(not found)`); continue; }
        if (statSync(file).isDirectory()) { parts.push(`--- ${m[1]}/\n${listFiles(root, m[1], 200).join('\n')}`); continue; }
        if (statSync(file).size > 2_000_000) { parts.push(`--- ${m[1]}\n(too large to read whole: ${statSync(file).size} bytes; read a line range or search it)`); continue; }
        const lines = readFileSync(file, 'utf8').split('\n');
        const from = m[2] ? Math.max(1, Number(m[2])) : 1;
        const to = m[3] ? Math.min(lines.length, Number(m[3])) : Math.min(lines.length, from + 399);
        parts.push(`--- ${m[1]} (lines ${from}-${to} of ${lines.length})\n${lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(4)}  ${l}`).join('\n')}`);
      }
      const names = action.body.split('\n').map((l) => l.trim()).filter(Boolean);
      return { ok: true, title: `Read(${names.slice(0, 3).join(', ')}${names.length > 3 ? `, +${names.length - 3}` : ''})`, result: clip(parts.join('\n\n'), 30_000) };
    }
    if (kind === 'list') {
      const sub = action.body.trim().split('\n')[0] || action.path || '.';
      const files = listFiles(root, sub, 400);
      return { ok: true, title: `List(${sub})`, summary: `${files.length} files`, result: files.join('\n') || '(empty)' };
    }
    if (kind === 'search') {
      const [pat, glob] = action.body.trim().split('\n')[0].split('|').map((s) => s.trim());
      if (!pat) throw new Error('search needs a pattern');
      let re; try { re = new RegExp(pat, 'i'); } catch { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
      const only = glob ? globToRe(glob.replace(/^\.\//, '')) : null;
      const hits = [];
      for (const f of listFiles(root, '.', 4000)) {
        if (only && !only.test(f) && !only.test(path.basename(f))) continue;
        let text; try { if (statSync(path.join(root, f)).size > 1_000_000) continue; text = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
        if (text.includes('\u0000')) continue;
        text.split('\n').forEach((l, i) => { if (hits.length < 80 && re.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 200)}`); });
        if (hits.length >= 80) break;
      }
      return { ok: true, title: `Search(${pat}${glob ? ` in ${glob}` : ''})`, summary: `${hits.length} match${hits.length === 1 ? '' : 'es'}`, result: hits.join('\n') || 'No matches.' };
    }
    if (kind === 'write') {
      if (!action.path) throw new Error('write needs path=<file> after the word write');
      const file = jail(root, action.path);
      const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
      const content = action.body.endsWith('\n') ? action.body : `${action.body}\n`;
      if (before === content) return { ok: true, title: `Write(${action.path})`, summary: 'unchanged', result: `${action.path} already has exactly this content.` };
      if (!(await ask('write', `${before === null ? 'Create' : 'Overwrite'} ${action.path}`, diffText(before ?? '', content)))) return denied(`Write(${action.path})`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
      return { ok: true, title: `Write(${action.path})`, summary: `${content.split('\n').length - 1} lines${before === null ? ', new file' : ''}`, result: `Wrote ${action.path}.` };
    }
    if (kind === 'edit') {
      if (!action.path) throw new Error('edit needs path=<file> after the word edit');
      const file = jail(root, action.path);
      if (!existsSync(file)) throw new Error(`${action.path} does not exist. Use a write block to create it.`);
      const hunks = action.hunks ?? parseHunks(action.body);
      if (!hunks.length) throw new Error('edit needs at least one <<<<<<< SEARCH / ======= / >>>>>>> REPLACE hunk');
      const before = readFileSync(file, 'utf8');
      const after = applyHunks(before, hunks);
      if (!(await ask('edit', `Edit ${action.path}`, diffText(before, after)))) return denied(`Edit(${action.path})`);
      writeFileSync(file, after);
      return { ok: true, title: `Edit(${action.path})`, summary: `${hunks.length} change${hunks.length === 1 ? '' : 's'}`, result: `Edited ${action.path} (${hunks.length} change${hunks.length === 1 ? '' : 's'}).` };
    }
    if (kind === 'run') {
      const cmd = action.body.trim();
      if (!cmd) throw new Error('run needs a command');
      const short = cmd.split('\n')[0].slice(0, 70) + (cmd.length > 70 || cmd.includes('\n') ? '…' : '');
      const risk = commandRisk(cmd);
      if (risk === 'refuse') return { ok: false, title: `Run(${short})`, summary: 'refused', result: 'REFUSED: this command can destroy the system or the home folder, so Chomugiri never runs it. Find a narrower command.' };
      if (!(await ask(risk === 'risky' ? 'risky' : 'run', `Run: ${short}`, cmd))) return denied(`Run(${short})`);
      const r = await runShell(cmd, { cwd: root, signal, onData, timeoutMs });
      const ok = r.code === 0;
      const verdict = r.why ? r.why : `exit ${r.code}`;
      return { ok, title: `Run(${short})`, summary: `${verdict}${r.output.trim() ? ` · ${r.output.trim().split('\n').length} lines` : ''}`, result: `$ ${cmd}\n${clip(r.output.trimEnd()) || '(no output)'}\n[${verdict}]` };
    }
    throw new Error(`unknown action "${kind}"`);
  } catch (err) {
    return { ok: false, title: `${kind[0].toUpperCase()}${kind.slice(1)}(${action.path ?? action.body.trim().split('\n')[0].slice(0, 50)})`, summary: 'error', result: `ERROR: ${err.message}` };
  }
}
const denied = (title) => ({ ok: false, title, summary: 'not allowed', denied: true, result: 'NOT DONE: the user did not allow this. Do not retry it; ask what they want instead, or continue without it.' });

/** A small line diff for the permission prompt (changed region with a little context). */
export function diffText(before, after, context = 2) {
  const a = before.split('\n'), b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let ea = a.length - 1, eb = b.length - 1;
  while (ea >= start && eb >= start && a[ea] === b[eb]) { ea--; eb--; }
  const out = [];
  for (let i = Math.max(0, start - context); i < start; i++) out.push(`  ${a[i]}`);
  for (let i = start; i <= ea; i++) out.push(`- ${a[i]}`);
  for (let i = start; i <= eb; i++) out.push(`+ ${b[i]}`);
  for (let i = ea + 1; i < Math.min(a.length, ea + 1 + context); i++) out.push(`  ${a[i]}`);
  if (out.length > 60) return [...out.slice(0, 40), `  … ${out.length - 55} more lines …`, ...out.slice(-15)].join('\n');
  return out.join('\n');
}

// ── the system prompt ────────────────────────────────────────────────────────

const MEMORY_FILES = ['CHOMUGIRI.md', 'AGENTS.md', 'CLAUDE.md'];

export function projectNotes(root) {
  for (const n of MEMORY_FILES) {
    const f = path.join(root, n);
    if (existsSync(f)) { try { return { name: n, text: readFileSync(f, 'utf8').slice(0, 12_000) }; } catch { /* unreadable */ } }
  }
  return null;
}

export function systemPrompt({ root, platform = process.platform, notes = projectNotes(root), files = listFiles(root, '.', 120), now = new Date() }) {
  return `You are Chomugiri, a coding agent working in a terminal on the user's computer, in the project folder below. You get things done by acting, not by describing: read the code, change it, run it, check the result.

# How you act
You have six tools: run, read, search, list, write, edit. Call them (several in one reply is fine); you get the results back and continue. A reply with no tool call is your final answer.
If your tools are not available as function calls, write the same actions as fenced blocks instead, exactly like this:

\`\`\`read
src/app.js
src/big.js:120-220
\`\`\`
\`\`\`search
handleLogin | src/**/*.js
\`\`\`
\`\`\`list
src
\`\`\`
\`\`\`run
npm test
\`\`\`
\`\`\`write path=src/new.js
(the whole file)
\`\`\`
\`\`\`edit path=src/app.js
<<<<<<< SEARCH
(lines copied exactly from the file)
=======
(the new lines)
>>>>>>> REPLACE
\`\`\`

# Rules
1. Look before you change: read a file before editing it, and search instead of guessing where something is. Prefer edit over write for a file that exists.
2. SEARCH text must be copied exactly from the file and be unique in it. On "not found", read the file again; do not repeat the same hunk.
3. After changing code, run what proves it (the test, the build, the script) when there is one, and read the output. Report failures with the real output; never claim something works that you did not run.
4. Keep changes small and in the style of the surrounding code. Do not rewrite what was not asked for.
5. Stay inside the project folder. Never run a command that destroys data or reaches outside what the task needs. If an action comes back "NOT DONE: the user did not allow this", do not retry it.
6. To show code in your answer without it being an action, use an ordinary language fence (\`\`\`js, \`\`\`bash). Only run/read/search/list/write/edit fences are actions.
8. Never answer from memory about this project: the files are right here, look at them.
7. Answer in the user's language, briefly: what you did, what the checks showed, what is left. No preamble.

# Where you are
Folder: ${root}
System: ${platform}, ${now.toISOString().slice(0, 10)}
Files (first ${files.length}):
${files.join('\n') || '(empty folder)'}${notes ? `\n\n# Project notes (${notes.name})\n${notes.text}` : ''}`;
}

// ── the loop ─────────────────────────────────────────────────────────────────

/**
 * One user turn: model reply → actions → results → … until a reply with no action. `ui` receives events:
 * text(piece), replyEnd(reply), action(result), wait(ms), note(text). Mutates and returns `messages`.
 */
export async function runTurn({ provider, messages, root, ask, ui = {}, signal, maxSteps = 25, fetchImpl, timeoutMs }) {
  let usage = { prompt: 0, completion: 0 };
  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) break;
    ui.thinking?.(true);
    let reply;
    try {
      reply = await chat(provider, messages, { signal, fetchImpl, onText: (t) => { ui.thinking?.(false); ui.text?.(t); }, onWait: (ms) => ui.wait?.(ms) });
    } finally { ui.thinking?.(false); }
    usage = { prompt: usage.prompt + (reply.usage?.prompt_tokens ?? 0), completion: usage.completion + (reply.usage?.completion_tokens ?? 0) };
    const native = reply.toolCalls.length > 0;
    messages.push(native
      ? { role: 'assistant', content: reply.content || '', tool_calls: reply.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.args || '{}' } })) }
      : { role: 'assistant', content: reply.content });
    ui.replyEnd?.(reply.content);
    const actions = native ? reply.toolCalls.map(actionFromCall) : parseActions(reply.content);
    if (!actions.length) return { messages, usage, steps: step + 1, done: true };
    const results = [];
    let stopped = false;
    for (const [i, action] of actions.entries()) {
      let r;
      if (stopped || signal?.aborted) r = { ok: false, title: 'Skipped', summary: 'skipped', result: 'SKIPPED: an earlier action of this reply was not allowed or the work was stopped.' };
      else {
        ui.actionStart?.(action);
        r = await execute(action, { root, ask, signal, onData: ui.output, timeoutMs });
        ui.action?.(r);
        if (r.denied) stopped = true;
      }
      if (native) messages.push({ role: 'tool', tool_call_id: reply.toolCalls[i].id, content: r.result });
      else results.push(`## ${r.title}\n${r.result}`);
    }
    if (!native) messages.push({ role: 'user', content: `ACTION RESULTS\n\n${results.join('\n\n')}\n\nContinue. If the task is finished, answer without any action block.` });
  }
  ui.note?.(`Stopped after ${maxSteps} steps. Say "continue" to go on.`);
  return { messages, usage, steps: maxSteps, done: false };
}

/** Keeps a long conversation inside the model's window: old action results are shortened, the first and recent messages kept. */
export function compact(messages, keepRecent = 8, budget = 90_000) {
  const len = (m) => (m.content ?? '').length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
  const size = (ms) => ms.reduce((n, m) => n + len(m), 0);
  if (size(messages) <= budget) return messages;
  const head = messages.slice(0, 1), tail = messages.slice(-keepRecent);
  const brief = (m) => {
    if (m.role === 'tool') return m.content.length > 1500 ? { ...m, content: `${m.content.slice(0, 900)}\n… (shortened) …\n${m.content.slice(-400)}` } : m;
    if (m.role === 'user' && m.content.startsWith('ACTION RESULTS')) return { ...m, content: `ACTION RESULTS (shortened)\n${m.content.split('\n').filter((l) => l.startsWith('## ') || l.startsWith('[') || l.startsWith('ERROR')).join('\n').slice(0, 1200)}` };
    return (m.content ?? '').length > 4000 ? { ...m, content: `${m.content.slice(0, 2500)}\n… (shortened) …` } : m;
  };
  const out = [...head, ...messages.slice(1, -keepRecent).map(brief), ...tail];
  // Drop the oldest messages; a tool result never stays without the call it answers.
  while (size(out) > budget && out.length > keepRecent + 2) {
    out.splice(1, 1);
    while (out[1]?.role === 'tool') out.splice(1, 1);
  }
  while (out[1]?.role === 'tool') out.splice(1, 1);
  return out;
}

// ── sessions ─────────────────────────────────────────────────────────────────

const SESS_DIR = () => path.join(CONFIG_DIR, 'sessions');
export function saveSession(session) {
  mkdirSync(SESS_DIR(), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(SESS_DIR(), `${session.id}.json`), JSON.stringify(session), { mode: 0o600 });
}
export function listSessions(root) {
  let names = [];
  try { names = readdirSync(SESS_DIR()).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    try { const s = JSON.parse(readFileSync(path.join(SESS_DIR(), n), 'utf8')); if (!root || s.root === root) out.push(s); } catch { /* a broken file */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
export const newSessionId = () => `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
