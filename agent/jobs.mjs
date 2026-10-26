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
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

export function createJobs({ dir = jobsDir(), fetchImpl = fetch, now = () => Date.now(), notify = defaultNotify } = {}) {
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
    return { id: job.id, status: job.status, meta: job.meta, startedAt: job.startedAt, endedAt: job.endedAt ?? null, chars: job.content.length, label: job.label ?? null, error: job.error ?? null };
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

  async function run(job, recipes, controller) {
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
          job.status = 'done';
          job.finishReason = r.finish;
          job.error = null;
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
      void run(job, spec.recipes, controller);
      return summary(job);
    },
    list() {
      return readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => load(n.slice(0, -5))).filter(Boolean).map((j) => summary(live.get(j.id)?.job ?? j)).sort((a, b) => b.startedAt - a.startedAt);
    },
    get(id) {
      const job = live.get(id)?.job ?? load(id);
      if (!job) throw fail('Unknown job.', 404);
      return { ...summary(job), content: job.content, reasoning: job.reasoning, usage: job.usage, finishReason: job.finishReason ?? null };
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
