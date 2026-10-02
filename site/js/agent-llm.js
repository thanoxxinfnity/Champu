/**
 * Gets an answer for the Ask Chomu agent panel.
 *
 * Primary path: the visitor's own browser asks the text service directly. Every visitor then has their own
 * connection and their own allowance, instead of everyone sharing the one address our server has — which is
 * what ran dry when this went through the server. If that does not work (blocked, offline, rate-limited),
 * the same question goes through our server, which has its own safeguards (see api/ask.js).
 *
 * The instructions and facts are built here from agent-core.js. They are public on purpose: nothing in them
 * is secret, and a visitor who talks the agent out of its manners only affects their own conversation.
 */
import { LIMITS, buildPrompt, contentDeltas, makeScrubber } from './agent-core.js';

const SERVICE = 'https://text.pollinations.ai/openai';
const TRIES = [5000, 7000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Opens the service's stream and waits for the first word. Null if it does not speak, errors, or says "slow down" twice. */
async function openDirect(body) {
  for (const wait of TRIES) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), wait);
    try {
      const res = await fetch(SERVICE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, seed: Math.floor(Math.random() * 1e9) }), signal: ac.signal });
      if (!res.ok || !res.body) {
        if (res.status === 429 || res.status === 402) await sleep(2200);
        throw new Error('no stream');
      }
      const rest = contentDeltas(res.body.getReader());
      const first = await rest.next();
      clearTimeout(timer);
      if (first.done) throw new Error('empty');
      const overall = setTimeout(() => ac.abort(), 30_000);
      return { first: first.value, rest, done: () => clearTimeout(overall) };
    } catch (err) {
      clearTimeout(timer);
      ac.abort();
      if (err instanceof TypeError) return null; // blocked or offline: no point trying again
    }
  }
  return null;
}

async function place() {
  try {
    const j = await (await fetch('/api/near', { cache: 'no-store' })).json();
    return typeof j.place === 'string' ? j.place : null;
  } catch { return null; }
}

/** Async generator of answer text. Throws an Error with a plain-words message if nobody can answer. */
export async function* answer({ messages, near, tz }) {
  const turns = messages.slice(-LIMITS.maxMessages).map((m) => ({ role: m.role, content: m.content.slice(0, LIMITS.maxChars) }));
  const system = buildPrompt({ messages: turns, tz, place: near ? await place() : null, nearAsked: near });
  const direct = await openDirect({
    model: 'openai-fast', // the fastest model the free tier serves
    stream: true,
    max_tokens: LIMITS.maxOutputTokens,
    reasoning_effort: 'low',
    temperature: 0.4,
    messages: [{ role: 'system', content: system }, ...turns],
  });

  const scrubber = makeScrubber();
  if (direct) {
    try {
      const a = scrubber.push(direct.first); if (a) yield a;
      for await (const d of direct.rest) { const out = scrubber.push(d); if (out) yield out; }
      const tail = scrubber.flush(); if (tail) yield tail;
    } finally { direct.done(); }
    return;
  }

  // Fallback: our own server.
  const res = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: turns, near, tz }) });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error || 'The agent is busy right now. Try again in a moment.');
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let at;
    while ((at = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, at); buf = buf.slice(at + 2);
      const m = /^data: (.*)$/m.exec(frame);
      if (!m || m[1] === '[DONE]') continue;
      try { const t = JSON.parse(m[1]).t; if (t) yield t; } catch { /* a torn frame */ }
    }
  }
}
