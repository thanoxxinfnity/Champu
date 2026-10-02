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
import { LIMITS, aboutUs, buildPrompt, clean, contentDeltas, makeScrubber, placeFrom, scrub } from '../js/agent-core.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

const UPSTREAM = 'https://text.pollinations.ai/openai';
const MODEL = 'openai-fast'; // the fastest model the free tier serves
const SITE = /^https:\/\/chomugiri\.vercel\.app$|^http:\/\/localhost(:\d+)?$/;
const allowed = (origin) => SITE.test(origin) || (process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`);

export { clean, placeFrom, scrub };

/** Answers to the same Chomugiri question (a first message, no place) are kept for a while: instant, and one less call upstream. */
const answers = new Map();
const TTL = 6 * 3600_000;


/** How long each try may stay silent before it is dropped and asked again; how long a whole answer may take; the least time between two requests to the service; the pause after it says "slow down". Exported so tests do not have to wait it out. */
export const timing = { tries: [4_000, 6_000, 6_000, 6_000], total: 25_000, gap: 2_500, retryDelay: 2_500, openBudget: 17_000 };

const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) hits.clear();
  return recent.length > LIMITS.perMinute;
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

  const system = buildPrompt({ messages, tz: typeof body?.tz === 'string' ? body.tz.slice(0, 64) : undefined, place: near ? placeFrom(request.headers) : null, nearAsked: near });

  const seen = [];
  const stream = await openStream({
    model: MODEL,
    stream: true,
    max_tokens: LIMITS.maxOutputTokens,
    reasoning_effort: 'low',
    temperature: 0.4,
    messages: [{ role: 'system', content: system }, ...messages],
  }, seen);
  // Only status codes and words like "silent" — a hint for whoever is looking at the logs, nothing about the service.
  response.setHeader('X-Agent-Tries', seen.join(',').slice(0, 80));
  if (!stream) return fail(response, 502, 'The agent is busy right now. Try again in a moment.');

  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, no-transform');
  response.setHeader('X-Accel-Buffering', 'no');
  response.status(200);

  const send = (obj) => { if (!response.writableEnded) try { response.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* the visitor left */ } };
  request.on?.('close', () => stream.cancel()); // visitor gone: stop reading and stop paying
  const total = setTimeout(() => stream.cancel(), timing.total);
  const scrubber = makeScrubber();
  let any = false;
  let whole = '';
  const take = (delta) => {
    const out = scrubber.push(delta);
    if (out) { send({ t: out }); any = true; whole += out; }
  };
  try {
    take(stream.first);
    for await (const delta of stream.rest) take(delta);
    const rest = scrubber.flush();
    if (rest) { send({ t: rest }); any = true; whole += rest; }
    if (key && whole.length > 20) {
      if (answers.size >= 100) answers.delete(answers.keys().next().value);
      answers.set(key, { at: Date.now(), text: whole });
    }
    if (!any) send({ t: 'Hmm, I did not get an answer out. Ask me again?' });
  } catch {
    const rest = scrubber.flush();
    if (rest) send({ t: rest });
    send({ t: any || rest ? '\n\n(The connection dropped — ask again to continue.)' : 'The agent is busy right now. Try again in a moment.' });
  } finally {
    clearTimeout(total);
    if (!response.writableEnded) { try { response.write('data: [DONE]\n\n'); response.end(); } catch { /* gone */ } }
  }
}

/**
 * Asks the service and waits for the first word of the answer. The free service now and then accepts a
 * request and then says nothing. Rather than leave the visitor staring at dots, a silent request is dropped
 * after a few seconds and asked again — one at a time (the free tier does not like two at once), each with
 * its own seed so a stuck cached attempt is not simply replayed. Returns null if no try speaks in time.
 */
let nextSlot = 0;
/** The free service allows only a request every few seconds per address, and every visitor to this site shares ours: so requests leave one after another, spaced out. */
async function paced() {
  const at = Math.max(Date.now(), nextSlot);
  nextSlot = at + timing.gap;
  if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
}

async function openStream(body, seen = []) {
  const t0 = Date.now();
  for (const wait of timing.tries) {
    if (Date.now() - t0 > timing.openBudget) break; // the function itself has a time limit
    await paced();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), wait);
    try {
      const res = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(process.env.POLLINATIONS_TOKEN ? { Authorization: `Bearer ${process.env.POLLINATIONS_TOKEN}` } : {}) },
        body: JSON.stringify({ ...body, seed: Math.floor(Math.random() * 1_000_000_000) }),
        signal: ac.signal,
      });
      seen.push(res.status);
      if (!res.ok || !res.body) {
        if (res.status === 429 || res.status === 402) await new Promise((r) => setTimeout(r, timing.retryDelay)); // told to slow down: do
        throw new Error('no stream');
      }
      const rest = contentDeltas(res.body.getReader());
      const first = await rest.next();
      clearTimeout(timer);
      if (first.done) throw new Error('empty');
      return { first: first.value, rest, cancel: () => ac.abort() };
    } catch (err) {
      seen.push(err?.name === 'AbortError' ? 'silent' : String(err?.message ?? 'error'));
      clearTimeout(timer);
      ac.abort();
    }
  }
  return null;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}
