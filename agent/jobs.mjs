/**
 * Background jobs: model calls that keep running on the bridge while the app is closed.
 *
 * The app (a phone, which kills tabs to free memory) resolves everything about one model call — the URL, the headers with the key, the body —
 * and hands it over as a "recipe", with fallbacks to try in order. The bridge makes the call, streams the answer into a file as it arrives
 * and, when it ends, optionally tells the phone with a push message (ntfy). When the app opens again it lists the jobs, takes the finished
 * ones into their conversations, and acknowledges them so they are deleted here.
 *
 * Nothing here knows about conversations: a job is `{ id, meta, recipes }` in and `{ status, content, reasoning, usage, error }` out.
 * `meta` is opaque to the bridge (the app puts its session and message ids there).
 *
 * Storage: one JSON file per job under ~/.chomugiri/jobs (CHOMUGIRI_JOBS_DIR), next to the key store and outside the workspace. The recipe's
 * headers hold the API key while the job runs and are never written to disk; a job that was running when the bridge stopped comes back
 * as "interrupted" so the app can offer to resend it.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const ID = /^[\w-]{4,80}$/;
const MAX_RECIPES = 6;
const MAX_BODY = 6 * 1024 * 1024;
const KEEP_MS = 7 * 24 * 3600 * 1000;
const USER_AGENT = 'chomugiri-bridge/1 (+background job)';

export function jobsDir() {
  return process.env.CHOMUGIRI_JOBS_DIR || path.join(homedir(), '.chomugiri', 'jobs');
}

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

// ── Reading a reply ──────────────────────────────────────────────────────────

/** Text out of one parsed reply or stream chunk, in any of the three wire shapes the app speaks. */
// ── agent jobs: the terminal carries the work on by itself ───────────────────
//
// A plain job is one model answer. An agent job (`agent: {}` in the spec, bridge 5.2) goes on from there the way the app does when
// it is open: files the reply writes are saved into the workspace, its terminal blocks are run here one after another, their
// output goes back to the model, and that repeats until a reply has no command left (or the step limit). The phone can be
// closed the whole time; the app takes the finished transcript and the record of every command when it comes back.

const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\n]*)$/;
const MAX_STEPS = 16;
const MAX_OUTPUT = 8000;

/** What a reply asks for, in order: `{kind:'run', command, cwd}` for a terminal block, `{kind:'file', path, body}` for a path= block. */
export function actionsOf(reply) {
  const out = [];
  let open = null;
  let edit = null;
  for (const line of String(reply).split('\n')) {
    const m = FENCE.exec(line);
    if (open) {
      if (m && m[1][0] === open.fence[0] && m[1].length >= open.fence.length && !m[2].trim()) {
        const p = /(?:^|\s)path=("[^"]+"|'[^']+'|\S+)/.exec(open.info);
        const target = p ? p[1].replace(/^["']|["']$/g, '') : '';
        const body = open.body.join('\n');
        if (target === '@terminal') {
          const c = /(?:^|\s)cwd=("[^"]+"|'[^']+'|\S+)/.exec(open.info);
          if (body.trim()) out.push({ kind: 'run', command: body.trim(), cwd: c ? c[1].replace(/^["']|["']$/g, '') : '.' });
        } else if (target && !target.startsWith('@')) out.push({ kind: 'file', path: target, body });
        open = null;
      } else open.body.push(line);
      continue;
    }
    if (m) { open = { fence: m[1], info: m[2], body: [] }; continue; }
    // The app's edit form, written outside a fence: <<<<<<< SEARCH path=file / old lines / ======= / new lines / >>>>>>> REPLACE
    const e = /^[ \t]*<{5,9}[ \t]*SEARCH\b[ \t]*(?:path=)?("[^"]+"|'[^']+'|\S+)?/.exec(line);
    if (e && !edit) { edit = { path: (e[1] ?? '').replace(/^["']|["']$/g, ''), search: [], replace: [], half: 0 }; continue; }
    if (edit) {
      if (edit.half === 0 && /^[ \t]*={5,9}[ \t]*$/.test(line)) { edit.half = 1; continue; }
      if (edit.half === 1 && /^[ \t]*>{5,9}[ \t]*REPLACE\b/.test(line)) {
        if (edit.path) out.push({ kind: 'edit', path: edit.path, search: edit.search.join('\n'), replace: edit.replace.join('\n') });
        edit = null;
        continue;
      }
      (edit.half ? edit.replace : edit.search).push(line);
    }
  }
  return out;
}

/** SEARCH/REPLACE hunks applied to text; each SEARCH must be found exactly once. Returns null when the body has no hunks. */
export function applyEdits(text, body) {
  const hunks = [...body.matchAll(/<{5,9}[ \t]*SEARCH[^\n]*\n([\s\S]*?)\n?={5,9}[ \t]*\n([\s\S]*?)\n?>{5,9}[ \t]*REPLACE/g)];
  if (!hunks.length) return null;
  let out = text;
  for (const [i, h] of hunks.entries()) {
    const n = h[1] ? out.split(h[1]).length - 1 : 0;
    if (n !== 1) throw new Error(`edit ${i + 1}: the SEARCH text ${n ? `appears ${n} times` : 'was not found'}`);
    out = out.replace(h[1], () => h[2]);
  }
  return out;
}

/** Commands an unattended run never executes, whatever the model says. */
const NEVER = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+(-[a-z]*\s+)*(\/|~|\$HOME|\/\*|~\/\*)(\s|$)/i,
  /\bmkfs(\.\w+)?\b/i, /\bdd\b[^\n]*\bof=\/dev\//i, /:\(\)\s*\{\s*:\|:&\s*\}\s*;/, /\b(shutdown|reboot|halt|poweroff)\b/i, />\s*\/dev\/(sd[a-z]|nvme|mmcblk)/i,
];
export const neverRun = (cmd) => NEVER.some((r) => r.test(cmd));

function inWorkspace(root, rel) {
  const abs = path.resolve(root, String(rel || '.').replace(/^\/+/, ''));
  const base = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(base)) throw new Error(`"${rel}" is outside the workspace`);
  return abs;
}

function shellOnce(cmd, { cwd, env, signal, timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const win = process.platform === 'win32';
    const child = spawn(win ? process.env.COMSPEC ?? 'cmd.exe' : '/bin/bash', win ? ['/d', '/s', '/c', cmd] : ['-o', 'pipefail', '-lc', cmd], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', done = false;
    const add = (d) => { out += d.toString('utf8'); if (out.length > 400_000) out = out.slice(-200_000); };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const finish = (code, why) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, output: out, why, ms: Date.now() - started }); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(null, `stopped after ${Math.round(timeoutMs / 1000)} s`); }, timeoutMs);
    signal?.addEventListener('abort', () => { child.kill('SIGKILL'); finish(null, 'cancelled'); }, { once: true });
    child.on('error', (e) => finish(127, e.message));
    child.on('close', (code) => finish(code));
  });
}
const clipOut = (s) => (s.length <= MAX_OUTPUT ? s : `${s.slice(0, MAX_OUTPUT * 0.4)}\n… (${s.length - MAX_OUTPUT} characters cut) …\n${s.slice(-MAX_OUTPUT * 0.6)}`);

export function piecesOf(payload) {
  const out = { text: '', reasoning: '', usage: null, finish: null };
  if (!payload || typeof payload !== 'object') return out;
  const choice = payload.choices?.[0];
  if (choice) {
    const d = choice.delta ?? choice.message ?? {};
    if (typeof d.content === 'string') out.text += d.content;
    else if (Array.isArray(d.content)) out.text += d.content.map((p) => p?.text ?? '').join('');
    const r = d.reasoning_content ?? d.reasoning;
    if (typeof r === 'string') out.reasoning += r;
    if (choice.finish_reason) out.finish = choice.finish_reason;
  }
  // Anthropic: streamed content_block_delta / whole `content` array.
  if (payload.type === 'content_block_delta' && payload.delta) {
    if (typeof payload.delta.text === 'string') out.text += payload.delta.text;
    if (typeof payload.delta.thinking === 'string') out.reasoning += payload.delta.thinking;
  }
  if (Array.isArray(payload.content) && payload.type === 'message') {
    for (const b of payload.content) {
      if (b?.type === 'text' && typeof b.text === 'string') out.text += b.text;
      if (b?.type === 'thinking' && typeof b.thinking === 'string') out.reasoning += b.thinking;
    }
  }
  if (payload.type === 'message_delta' && payload.delta?.stop_reason) out.finish = payload.delta.stop_reason;
  // Gemini: candidates[].content.parts[].text
  const cand = payload.candidates?.[0];
  if (cand?.content?.parts) {
    for (const p of cand.content.parts) {
      if (typeof p?.text === 'string') (p.thought ? (out.reasoning += p.text) : (out.text += p.text));
    }
    if (cand.finishReason) out.finish = cand.finishReason;
  }
  const u = payload.usage ?? payload.usageMetadata;
  if (u && typeof u === 'object') {
    out.usage = {
      promptTokens: u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount,
      completionTokens: u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount,
      totalTokens: u.total_tokens ?? u.totalTokenCount,
    };
  }
  return out;
}

/** Why a reply is an error even though the HTTP status was 200 (some free gateways do this). */
function envelopeError(text) {
  try {
    const j = JSON.parse(text);
    const e = j?.error;
    if (e && !j.choices && !j.candidates && !j.content) return typeof e === 'string' ? e : e.message ?? JSON.stringify(e).slice(0, 300);
  } catch { /* not JSON */ }
  return null;
}

// ── The runner ───────────────────────────────────────────────────────────────

/**
 * `workspace` is the folder agent jobs work in; without it a job is always one answer. `env()` gives the variables commands get,
 * `allowed(cmd)` is the bridge's own command allow-list.
 */
export function createJobs({ dir = jobsDir(), fetchImpl = fetch, now = () => Date.now(), notify = defaultNotify, workspace = null, env = () => process.env, allowed = () => true, commandTimeoutMs = 15 * 60 * 1000 } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const live = new Map(); // id -> { job, controller }

  const file = (id) => path.join(dir, `${id}.json`);

  function save(job) {
    const tmp = file(job.id) + '.tmp';
    writeFileSync(tmp, JSON.stringify(job), { mode: 0o600 });
    renameSync(tmp, file(job.id));
  }

  function load(id) {
    if (!ID.test(id)) return null;
    try {
      return JSON.parse(readFileSync(file(id), 'utf8'));
    } catch {
      return null;
    }
  }

  // A bridge that stopped while a job ran cannot finish it; say so instead of leaving it "running" forever. Old finished jobs go too.
  function sweep() {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      const job = load(id);
      if (!job) { rmSync(path.join(dir, name), { force: true }); continue; }
      if (job.status === 'running' && !live.has(id)) {
        job.status = 'interrupted';
        job.error = 'The terminal bridge was restarted while this was running.';
        job.endedAt = now();
        save(job);
      } else if (job.endedAt && now() - job.endedAt > KEEP_MS) rmSync(file(id), { force: true });
    }
  }
  sweep();

  function summary(job) {
    return { id: job.id, status: job.status, meta: job.meta, startedAt: job.startedAt, endedAt: job.endedAt ?? null, chars: job.content.length, label: job.label ?? null, error: job.error ?? null, steps: job.steps ?? 0, commands: job.runs?.length ?? 0, doing: job.doing ?? null };
  }

  function validate(spec) {
    if (!spec || typeof spec !== 'object') throw fail('A job needs a body.');
    if (!ID.test(String(spec.id ?? ''))) throw fail('`id` must be 4–80 letters, digits, _ or -.');
    if (!Array.isArray(spec.recipes) || !spec.recipes.length) throw fail('`recipes` must list at least one model call to try.');
    if (spec.recipes.length > MAX_RECIPES) throw fail(`At most ${MAX_RECIPES} fallbacks.`);
    for (const r of spec.recipes) {
      let u;
      try { u = new URL(r.url); } catch { throw fail(`"${r.url}" is not a URL.`); }
      if (!/^https?:$/.test(u.protocol)) throw fail('Only http(s) endpoints.');
      if (u.hostname === '169.254.169.254' || u.hostname === 'metadata.google.internal') throw fail('That host is blocked.', 403);
      if (typeof r.body !== 'object' || r.body === null) throw fail('Each recipe needs a JSON `body`.');
      if (JSON.stringify(r.body).length > MAX_BODY) throw fail('The request is too large.', 413);
    }
  }

  async function callOnce(job, recipe, controller) {
    const stream = recipe.stream !== false;
    let res;
    try {
      res = await fetchImpl(recipe.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json', 'User-Agent': USER_AGENT, ...(recipe.headers ?? {}) },
        body: JSON.stringify(recipe.body),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(recipe.timeoutMs ?? 20 * 60 * 1000)]),
      });
    } catch (err) {
      if (controller.signal.aborted) throw Object.assign(new Error('Cancelled.'), { cancelled: true });
      return { ok: false, error: `Network failure: ${err.message}`, retry: true };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `${res.status} ${text.slice(0, 400) || res.statusText}`, retry: res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500 || res.status === 401 || res.status === 403 };
    }
    const ctype = res.headers.get('content-type') ?? '';
    let lastSave = 0;
    const progress = () => {
      const t = now();
      if (t - lastSave > 1000) { lastSave = t; save(job); }
    };
    if (!stream || !ctype.includes('text/event-stream')) {
      const text = await res.text();
      const masked = envelopeError(text);
      if (masked) return { ok: false, error: masked, retry: true };
      let got;
      try { got = piecesOf(JSON.parse(text)); } catch { got = { text, reasoning: '', usage: null, finish: 'stop' }; }
      if (!got.text && !got.reasoning) got.text = text;
      job.content += got.text;
      job.reasoning += got.reasoning;
      if (got.usage) job.usage = got.usage;
      return { ok: true, finish: got.finish ?? 'stop' };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finish = null;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const m = /\r?\n\r?\n/.exec(buffer);
          if (!m) break;
          const raw = buffer.slice(0, m.index);
          buffer = buffer.slice(m.index + m[0].length);
          for (const line of raw.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let payload;
            try { payload = JSON.parse(data); } catch { continue; }
            const p = piecesOf(payload);
            if (payload?.error && !p.text) return { ok: false, error: typeof payload.error === 'string' ? payload.error : payload.error.message ?? 'The model returned an error.', retry: !job.content, partial: !!job.content };
            job.content += p.text;
            job.reasoning += p.reasoning;
            if (p.usage) job.usage = p.usage;
            if (p.finish) finish = p.finish;
            progress();
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) throw Object.assign(new Error('Cancelled.'), { cancelled: true });
      return { ok: false, error: `Stream interrupted: ${err.message}`, retry: !job.content, partial: !!job.content };
    }
    return { ok: true, finish: finish ?? 'stop' };
  }

  /** After the first answer of an agent job: do what it asks, hand the results back, ask again, until a reply runs nothing. */
  async function carryOn(job, recipe, controller, opts) {
    const maxSteps = Math.max(1, Math.min(MAX_STEPS, Number(opts?.maxSteps) || 12));
    let messages = recipe.body.messages.slice();
    let from = 0;
    for (let step = 1; step <= maxSteps && !controller.signal.aborted; step++) {
      job.steps = step;
      const reply = job.content.slice(from);
      const results = [];
      let ran = 0;
      for (const a of actionsOf(reply)) {
        if (controller.signal.aborted) break;
        if (a.kind === 'edit') {
          try {
            const file = inWorkspace(workspace, a.path);
            const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
            let after;
            if (!a.search.trim()) after = a.replace.endsWith('\n') ? a.replace : `${a.replace}\n`; // an empty SEARCH creates the file
            else {
              if (before === null) throw new Error('the file does not exist');
              const count = before.split(a.search).length - 1;
              if (count !== 1) throw new Error(count ? `the SEARCH text appears ${count} times` : 'the SEARCH text was not found');
              after = before.replace(a.search, () => a.replace);
            }
            mkdirSync(path.dirname(file), { recursive: true });
            writeFileSync(file, after);
            (job.files ??= []).includes(a.path) || job.files.push(a.path);
          } catch (err) {
            results.push(`EDIT ${a.path}: NOT APPLIED (${err.message}). Read the file and copy the lines exactly.`);
          }
          continue;
        }
        if (a.kind === 'file') {
          try {
            const file = inWorkspace(workspace, a.path);
            const edited = existsSync(file) ? applyEdits(readFileSync(file, 'utf8'), a.body) : null;
            mkdirSync(path.dirname(file), { recursive: true });
            writeFileSync(file, edited ?? (a.body.endsWith('\n') ? a.body : `${a.body}\n`));
            (job.files ??= []).includes(a.path) || job.files.push(a.path);
          } catch (err) {
            results.push(`FILE ${a.path}: NOT WRITTEN (${err.message})`);
          }
          continue;
        }
        ran++;
        const startedAt = now();
        let r;
        if (neverRun(a.command)) r = { code: null, output: 'REFUSED: this command can destroy the system, so the terminal never runs it unattended.', ms: 0 };
        else if (!allowed(a.command)) r = { code: null, output: 'REFUSED: this terminal only runs the commands on its allow-list.', ms: 0 };
        else {
          let cwd;
          try { cwd = inWorkspace(workspace, a.cwd); if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true }); } catch (err) { cwd = null; r = { code: null, output: `NOT RUN: ${err.message}`, ms: 0 }; }
          if (cwd) {
            job.doing = a.command.split('\n')[0].slice(0, 120);
            save(job);
            r = await shellOnce(a.command, { cwd, env: { ...env(), CHOMUGIRI: '1', CI: '1', FORCE_COLOR: '0', TERM: 'dumb' }, signal: controller.signal, timeoutMs: commandTimeoutMs });
            job.doing = null;
          }
        }
        const verdict = r.why ? r.why : r.code === null ? 'not run' : `exit ${r.code}`;
        (job.runs ??= []).push({ command: a.command, cwd: a.cwd, exitCode: r.code, output: clipOut(r.output.trimEnd()), startedAt, durationMs: r.ms });
        results.push(`$ ${a.command}\n${clipOut(r.output.trimEnd()) || '(no output)'}\n[${verdict}]`);
        save(job);
      }
      if ((!ran && !results.length) || controller.signal.aborted) return; // a reply that runs nothing (and failed at nothing) is the answer
      if (step === maxSteps) { job.content += `\n\n(Stopped after ${maxSteps} rounds of commands. Say "continue" to go on.)`; return; }
      messages = [...messages, { role: 'assistant', content: reply.trim() || '(commands only)' }, { role: 'user', content: `COMMAND RESULTS (run on the terminal just now)\n\n${results.join('\n\n')}\n\nContinue the task from these results. Do not repeat a command that already succeeded. When the task is finished, give the final answer with no terminal block.` }];
      job.content += '\n\n';
      from = job.content.length;
      const r = await callOnce(job, { ...recipe, body: { ...recipe.body, messages } }, controller);
      if (!r.ok) { job.content += `(The model stopped answering after the commands: ${r.error})`; return; }
      job.finishReason = r.finish;
    }
  }

  async function run(job, recipes, controller, agent) {
    let lastError = 'No model answered.';
    try {
      for (let i = 0; i < recipes.length; i++) {
        job.content = '';
        job.reasoning = '';
        job.attempt = i + 1;
        job.label = recipes[i].label ?? null;
        save(job);
        const r = await callOnce(job, recipes[i], controller);
        if (r.ok && (job.content || job.reasoning)) {
          job.finishReason = r.finish;
          job.error = null;
          if (agent && workspace && Array.isArray(recipes[i].body.messages)) await carryOn(job, recipes[i], controller, agent);
          if (controller.signal.aborted) throw Object.assign(new Error('Cancelled.'), { cancelled: true });
          job.status = 'done';
          return;
        }
        lastError = r.ok ? 'The model returned an empty completion.' : r.error;
        if (r.partial) { // it started answering and then broke: keep what arrived instead of throwing it away for a fresh start elsewhere
          job.status = 'failed';
          job.error = lastError;
          return;
        }
      }
      job.status = 'failed';
      job.error = lastError;
    } catch (err) {
      job.status = err.cancelled ? 'cancelled' : 'failed';
      job.error = err.message;
    } finally {
      job.endedAt = now();
      save(job);
      live.delete(job.id);
      Promise.resolve(notify(job)).catch(() => {});
    }
  }

  return {
    dir,
    /** Starts a job, or returns the existing one when the same id is sent again (a retried request must not run twice). */
    start(spec) {
      validate(spec);
      const existing = load(spec.id);
      if (existing) return summary(existing);
      const job = {
        id: spec.id,
        status: 'running',
        meta: spec.meta ?? null,
        startedAt: now(),
        endedAt: null,
        content: '',
        reasoning: '',
        usage: null,
        error: null,
        label: spec.recipes[0].label ?? null,
        attempt: 1,
        notify: typeof spec.ntfy === 'string' && /^[\w.-]{6,64}$/.test(spec.ntfy) ? { ntfy: spec.ntfy, title: String(spec.meta?.title ?? 'Chomugiri').slice(0, 80) } : null,
      };
      save(job);
      const controller = new AbortController();
      live.set(job.id, { job, controller });
      // The recipes (with their keys) stay in memory only.
      void run(job, spec.recipes, controller, spec.agent && typeof spec.agent === 'object' ? spec.agent : null);
      return summary(job);
    },
    list() {
      return readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => load(n.slice(0, -5))).filter(Boolean).map((j) => summary(live.get(j.id)?.job ?? j)).sort((a, b) => b.startedAt - a.startedAt);
    },
    get(id) {
      const job = live.get(id)?.job ?? load(id);
      if (!job) throw fail('Unknown job.', 404);
      return { ...summary(job), content: job.content, reasoning: job.reasoning, usage: job.usage, finishReason: job.finishReason ?? null, runs: job.runs ?? [], files: job.files ?? [] };
    },
    cancel(id) {
      const l = live.get(id);
      if (!l) return { cancelled: false };
      l.controller.abort();
      return { cancelled: true };
    },
    /** The app has taken these into its conversations: delete them here. */
    ack(ids) {
      let n = 0;
      for (const id of Array.isArray(ids) ? ids : []) {
        if (!ID.test(String(id)) || live.has(id)) continue;
        rmSync(file(id), { force: true });
        n++;
      }
      return { removed: n };
    },
    running: () => live.size,
  };
}

/** A push message to the phone through ntfy.sh (a free service; the topic name is the secret), when the job asked for one. */
async function defaultNotify(job) {
  if (!job.notify?.ntfy) return;
  const ok = job.status === 'done';
  const text = ok ? 'Your reply is ready. Open Chomugiri to read it.' : job.status === 'cancelled' ? 'The job was cancelled.' : `The job failed: ${String(job.error ?? '').slice(0, 120)}`;
  await fetch(`https://ntfy.sh/${job.notify.ntfy}`, {
    method: 'POST',
    headers: { Title: job.notify.title.replace(/[^\x20-\x7e]/g, '?'), Tags: ok ? 'white_check_mark' : 'warning', Priority: '3' },
    body: text,
    signal: AbortSignal.timeout(10_000),
  });
}
