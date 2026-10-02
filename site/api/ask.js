/**
 * "Ask Chomu agent" — the site's helper, behind our own door.
 *
 *   POST /api/ask   { messages: [{ role: 'user' | 'assistant', content }] }
 *   → text/event-stream:  data: {"t":"…"}  …  data: [DONE]
 *
 * The page never talks to the AI service itself. This function adds the instructions and the
 * facts the agent may use, asks the service, and streams back only the answer text — never the
 * model's private reasoning, and never a word about what runs behind it.
 *
 * It is a narrow door: same-site callers only, a handful of short messages, a capped answer,
 * a per-visitor throttle. The caller cannot choose the model, the instructions or the URL.
 */
import { LIMITS, SYSTEM_PROMPT } from './_agent-knowledge.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

const UPSTREAM = 'https://text.pollinations.ai/openai';
const MODEL = 'openai-fast'; // the fastest model the free tier serves
const SITE = /^https:\/\/chomugiri\.vercel\.app$|^http:\/\/localhost(:\d+)?$/;
const allowed = (origin) => SITE.test(origin) || (process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`);

/** What the answer must never say about itself. */
const SECRETS = /pollinations|gpt[-\s]?oss/gi;
export const scrub = (text) => text.replace(SECRETS, 'Chomu agent');

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

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        max_tokens: LIMITS.maxOutputTokens,
        reasoning_effort: 'low',
        temperature: 0.4,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return fail(response, 502, 'The agent is busy right now. Try again in a moment.');
  }
  if (!upstream.ok || !upstream.body) return fail(response, 502, 'The agent is busy right now. Try again in a moment.');

  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, no-transform');
  response.setHeader('X-Accel-Buffering', 'no');
  response.status(200);

  const send = (obj) => { if (!response.writableEnded) try { response.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* the visitor left */ } };
  const reader = upstream.body.getReader();
  request.on?.('close', () => { reader.cancel().catch(() => undefined); }); // visitor gone: stop reading and stop paying
  const decoder = new TextDecoder();
  let buffer = '';
  let pending = ''; // held back so a word cannot be caught half-way across two chunks by scrub()
  let any = false;
  const HOLD = 14;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
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
          if (typeof delta !== 'string' || !delta) continue; // reasoning deltas have no `content` and are dropped here
          pending = scrub(pending + delta); // whole words in the held-back text are already caught; a half word stays held back
          if (pending.length > HOLD) {
            const out = pending.slice(0, -HOLD);
            pending = pending.slice(-HOLD);
            if (out) { send({ t: out }); any = true; }
          }
        }
      }
    }
    const rest = scrub(pending);
    if (rest) { send({ t: rest }); any = true; }
    if (!any) send({ t: 'Hmm, I did not get an answer out. Ask me again?' });
  } catch {
    const rest = scrub(pending);
    if (rest) send({ t: rest });
    send({ t: any || rest ? '\n\n(The connection dropped — ask again to continue.)' : 'The agent is busy right now. Try again in a moment.' });
  } finally {
    if (!response.writableEnded) { try { response.write('data: [DONE]\n\n'); response.end(); } catch { /* gone */ } }
  }
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}
