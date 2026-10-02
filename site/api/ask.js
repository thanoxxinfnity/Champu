/**
 * "Ask Chomu agent" — the site's helper, behind our own door.
 *
 *   POST /api/ask   { messages: [{ role: 'user' | 'assistant', content }] }
 *   → text/event-stream:  data: {"t":"…"}  …  data: [DONE]
 *
 * The page never talks to the AI service itself. This function adds the instructions, today's date
 * and (only if the visitor asked for it) a rough place, and the Chomugiri facts when the talk is about us, asks the service, and streams back only the answer text — never the
 * model's private reasoning, and never a word about what runs behind it.
 *
 * It is a narrow door: same-site callers only, a handful of short messages, a capped answer,
 * a per-visitor throttle. The caller cannot choose the model, the instructions or the URL.
 */
import { LIMITS, aboutUs, buildPrompt } from './_agent-knowledge.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

const UPSTREAM = 'https://text.pollinations.ai/openai';
const MODEL = 'openai-fast'; // the fastest model the free tier serves
const SITE = /^https:\/\/chomugiri\.vercel\.app$|^http:\/\/localhost(:\d+)?$/;
const allowed = (origin) => SITE.test(origin) || (process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`);

/** What the answer must never say about itself. */
const SECRETS = /pollinations|gpt[-\s]?oss/gi;
export const scrub = (text) => text.replace(SECRETS, 'Chomu agent');

/** Answers to the same Chomugiri question (a first message, no place) are kept for a while: instant, and one less call upstream. */
const answers = new Map();
const TTL = 6 * 3600_000;

/** City, region and country from the host's own geo headers — the visitor's connection, rough on purpose. */
export function placeFrom(headers) {
  const dec = (v) => { try { return decodeURIComponent(String(v ?? '')).trim(); } catch { return ''; } };
  const parts = [dec(headers['x-vercel-ip-city']), dec(headers['x-vercel-ip-country-region']), dec(headers['x-vercel-ip-country'])].filter(Boolean);
  return parts.join(', ') || null;
}

/** How long each try may stay silent before it is dropped and asked again, and how long a whole answer may take. Exported so tests do not have to wait it out. */
export const timing = { tries: [4_000, 6_000, 6_000], total: 25_000 };

const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) hits.clear();
  return recent.length > LIMITS.perMinute;
}

/** Keeps only the last few plain user/assistant turns, trimmed. Returns null if there is nothing to answer. */
export function clean(messages) {
  if (!Array.isArray(messages)) return null;
  const out = [];
  for (const m of messages.slice(-LIMITS.maxMessages)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = m.content.trim().slice(0, LIMITS.maxChars);
    if (content) out.push({ role: m.role, content });
  }
  return out.length && out[out.length - 1].role === 'user' ? out : null;
}

const fail = (response, status, message) => {
  response.setHeader('Cache-Control', 'no-store');
  response.status(status).json({ error: message });
};

export default async function handler(request, response) {
  if (request.method !== 'POST') return fail(response, 405, 'POST only.');

  // A browser always sends Origin on a fetch POST; a request without one is not the page.
  if (!allowed(String(request.headers.origin ?? ''))) return fail(response, 403, 'Not from here.');

  const ip = String(request.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
  if (throttled(ip)) return fail(response, 429, 'Slow down a little — try again in a minute.');

  const body = typeof request.body === 'string' ? safeParse(request.body) : request.body;
  const messages = clean(body?.messages);
  if (!messages) return fail(response, 400, 'Send a question.');

  const near = body?.near === true;
  const key = messages.length === 1 && !near && aboutUs(messages) ? messages[0].content.toLowerCase().replace(/\s+/g, ' ') : null;
  const hit = key && answers.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, no-transform');
    response.status(200);
    for (let i = 0; i < hit.text.length; i += 24) response.write(`data: ${JSON.stringify({ t: hit.text.slice(i, i + 24) })}\n\n`);
    response.write('data: [DONE]\n\n');
    response.end();
    return;
  }

  const system = buildPrompt({ messages, tz: typeof body?.tz === 'string' ? body.tz.slice(0, 64) : undefined, place: near ? placeFrom(request.headers) : null });

  const stream = await openStream({
    model: MODEL,
    stream: true,
    max_tokens: LIMITS.maxOutputTokens,
    reasoning_effort: 'low',
    temperature: 0.4,
    messages: [{ role: 'system', content: system }, ...messages],
  });
  if (!stream) return fail(response, 502, 'The agent is busy right now. Try again in a moment.');

  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, no-transform');
  response.setHeader('X-Accel-Buffering', 'no');
  response.status(200);

  const send = (obj) => { if (!response.writableEnded) try { response.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* the visitor left */ } };
  request.on?.('close', () => stream.cancel()); // visitor gone: stop reading and stop paying
  const total = setTimeout(() => stream.cancel(), timing.total);
  let pending = ''; // held back so a word cannot be caught half-way across two chunks by scrub()
  let any = false;
  let whole = '';
  const HOLD = 14;
  const take = (delta) => {
    pending = scrub(pending + delta); // whole words in the held-back text are already caught; a half word stays held back
    if (pending.length > HOLD) {
      const out = pending.slice(0, -HOLD);
      pending = pending.slice(-HOLD);
      if (out) { send({ t: out }); any = true; whole += out; }
    }
  };
  try {
    take(stream.first);
    for await (const delta of stream.rest) take(delta);
    const rest = scrub(pending);
    if (rest) { send({ t: rest }); any = true; whole += rest; }
    if (key && whole.length > 20) {
      if (answers.size >= 100) answers.delete(answers.keys().next().value);
      answers.set(key, { at: Date.now(), text: whole });
    }
    if (!any) send({ t: 'Hmm, I did not get an answer out. Ask me again?' });
  } catch {
    const rest = scrub(pending);
    if (rest) send({ t: rest });
    send({ t: any || rest ? '\n\n(The connection dropped — ask again to continue.)' : 'The agent is busy right now. Try again in a moment.' });
  } finally {
    clearTimeout(total);
    if (!response.writableEnded) { try { response.write('data: [DONE]\n\n'); response.end(); } catch { /* gone */ } }
  }
}

/** Only the answer text out of the service's event stream — its private reasoning frames carry no `content` and are dropped. */
async function* contentDeltas(reader) {
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let at;
    while ((at = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let delta;
        try { delta = JSON.parse(raw)?.choices?.[0]?.delta?.content; } catch { continue; }
        if (typeof delta === 'string' && delta) yield delta;
      }
    }
  }
}

/**
 * Asks the service and waits for the first word of the answer. The free service now and then accepts a
 * request and then says nothing. Rather than leave the visitor staring at dots, a silent request is dropped
 * after a few seconds and asked again — one at a time (the free tier does not like two at once), each with
 * its own seed so a stuck cached attempt is not simply replayed. Returns null if no try speaks in time.
 */
async function openStream(body) {
  for (const wait of timing.tries) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), wait);
    try {
      const res = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ ...body, seed: Math.floor(Math.random() * 1_000_000_000) }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error('no stream');
      const rest = contentDeltas(res.body.getReader());
      const first = await rest.next();
      clearTimeout(timer);
      if (first.done) throw new Error('empty');
      return { first: first.value, rest, cancel: () => ac.abort() };
    } catch {
      clearTimeout(timer);
      ac.abort();
    }
  }
  return null;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}
