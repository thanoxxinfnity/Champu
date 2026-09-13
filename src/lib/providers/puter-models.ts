/**
 * Puter.js as a model source.
 *
 * Puter is the one provider here that needs no key at all: the SDK runs in the
 * browser and Puter bills the *user's* own Puter account ("user pays"), so
 * Chomugiri never holds a credential for it. That also means it cannot be
 * proxied through /api/chat like NIM or Pollinations — the call has to be made
 * from the page. This file holds the parts that are pure, so they can be tested
 * without a browser: the catalogue, the chunk reader, and the error reader.
 */

import type { ChatMessage, ModelCapability, ModelDescriptor } from './types';

const CHAT: ModelCapability[] = ['chat', 'tools'];
const REASON: ModelCapability[] = ['chat', 'tools', 'reasoning'];

/**
 * The models offered under Puter.
 *
 * Every id below was checked against Puter's live catalogue
 * (`GET https://api.puter.com/puterai/chat/models`) rather than taken from
 * documentation. Puter serves over a thousand ids; this is the short list worth
 * putting in a switcher, led by the four the workspace is set up around.
 */
export const PUTER_MODELS: ModelDescriptor[] = [
  {
    id: 'claude-fable-5.1',
    provider: 'puter',
    label: 'Claude Fable 5.1',
    vendor: 'Anthropic',
    capabilities: REASON,
    contextWindow: 200_000,
    emitsReasoning: true,
    origin: 'catalogue',
    note: 'Anthropic’s Fable 5.1 through Puter — no API key, billed to your own Puter account.',
  },
  {
    id: 'gpt-6-astra',
    provider: 'puter',
    label: 'GPT-6 Astra',
    vendor: 'OpenAI',
    capabilities: REASON,
    contextWindow: 400_000,
    emitsReasoning: true,
    origin: 'catalogue',
    note: 'OpenAI’s Astra through Puter — no API key.',
  },
  {
    id: 'gpt-5.6-sol',
    provider: 'puter',
    label: 'GPT-5.6 Sol',
    vendor: 'OpenAI',
    capabilities: REASON,
    contextWindow: 400_000,
    emitsReasoning: true,
    origin: 'catalogue',
    note: 'OpenAI’s Sol through Puter — no API key.',
  },
  {
    id: 'gemini-3.1-pro-preview',
    provider: 'puter',
    label: 'Gemini 3.1 Pro',
    vendor: 'Google',
    capabilities: REASON,
    contextWindow: 1_000_000,
    emitsReasoning: true,
    origin: 'catalogue',
    note: 'Google’s newest Pro through Puter — no API key.',
  },
  {
    id: 'claude-opus-5',
    provider: 'puter',
    label: 'Claude Opus 5',
    vendor: 'Anthropic',
    capabilities: REASON,
    contextWindow: 200_000,
    emitsReasoning: true,
    origin: 'catalogue',
  },
  {
    id: 'gemini-3.8-flash',
    provider: 'puter',
    label: 'Gemini 3.8 Flash',
    vendor: 'Google',
    capabilities: CHAT,
    contextWindow: 1_000_000,
    origin: 'catalogue',
    note: 'Fast and cheap — a good default for ordinary chat.',
  },
  {
    id: 'deepseek-v4-pro',
    provider: 'puter',
    label: 'DeepSeek V4 Pro',
    vendor: 'DeepSeek',
    capabilities: REASON,
    contextWindow: 256_000,
    emitsReasoning: true,
    origin: 'catalogue',
  },
  {
    id: 'qwen3.8-max',
    provider: 'puter',
    label: 'Qwen 3.8 Max',
    vendor: 'Alibaba',
    capabilities: REASON,
    contextWindow: 256_000,
    emitsReasoning: true,
    origin: 'catalogue',
  },
];

/** The model used for Puter's own internal steps (planning, classification). */
export const PUTER_PLANNER_MODEL = 'gemini-3.8-flash';

interface PuterChunk {
  type?: string;
  text?: string;
  message?: { content?: unknown; reasoning?: unknown };
  reasoning?: unknown;
  delta?: { content?: string };
  error?: { message?: string } | string;
}

/**
 * The text carried by one streamed chunk.
 *
 * Puter's own docs use `part.text` in one place and `part.type === 'text'` in
 * another, and Anthropic models can still hand back a content-block array. All
 * three are the same thing to a reader, so all three are accepted.
 */
export function puterChunkText(part: unknown): string {
  if (typeof part === 'string') return part;
  if (!part || typeof part !== 'object') return '';
  const chunk = part as PuterChunk;

  if (chunk.type === 'reasoning' || chunk.type === 'error' || chunk.type === 'compaction') return '';
  if (typeof chunk.text === 'string') return chunk.text;
  if (typeof chunk.delta?.content === 'string') return chunk.delta.content;

  const content = chunk.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === 'string' ? block : ((block as { text?: string })?.text ?? '')))
      .join('');
  }
  return '';
}

/** The thinking carried by one streamed chunk, if any. */
export function puterChunkReasoning(part: unknown): string {
  if (!part || typeof part !== 'object') return '';
  const chunk = part as PuterChunk;

  if (chunk.type === 'reasoning' && typeof chunk.text === 'string') return chunk.text;
  if (typeof chunk.reasoning === 'string') return chunk.reasoning;
  if (typeof chunk.message?.reasoning === 'string') return chunk.message.reasoning;
  return '';
}

/**
 * A provider error inside a chunk.
 *
 * Streaming failures arrive as an `error` chunk rather than a thrown exception,
 * so a reader that only looks at `text` finishes cleanly with an empty reply and
 * nothing anywhere explaining why.
 */
export function puterChunkError(part: unknown): string | null {
  if (!part || typeof part !== 'object') return null;
  const chunk = part as PuterChunk & { message?: unknown };

  if (chunk.type !== 'error') return null;
  if (typeof chunk.message === 'string' && chunk.message) return chunk.message;
  if (typeof chunk.error === 'string') return chunk.error;
  if (chunk.error && typeof chunk.error === 'object' && typeof chunk.error.message === 'string') {
    return chunk.error.message;
  }
  return 'The Puter stream failed without saying why.';
}

/** A thrown Puter failure, in words a user can act on. */
export function puterErrorText(err: unknown): string {
  if (!err) return 'Puter failed without an error.';
  if (typeof err === 'string') return err;

  const shape = err as {
    message?: string;
    error?: { message?: string; code?: string; delegate?: string } | string;
    code?: string;
  };

  const inner = typeof shape.error === 'string' ? shape.error : shape.error?.message;
  const code = (typeof shape.error === 'object' ? shape.error?.code : undefined) ?? shape.code;
  const message = inner ?? shape.message ?? 'Puter failed without an error.';

  if (code === 'insufficient_funds' || /insufficient|quota|credit/i.test(message)) {
    return `${message} — this is your Puter account's own allowance, not Chomugiri's. Top it up at puter.com, or switch to Pollinations, which is free without an account.`;
  }
  if (/not authenticated|sign ?in|unauthorized|401/i.test(message)) {
    return 'Puter needs you signed in before it will answer. Open Settings → API Keys → Puter and press Sign in.';
  }
  return message;
}

/**
 * Our messages in the shape Puter takes.
 *
 * Puter is wired up here for text only, which is what it is good for without a
 * key. Image parts are named rather than dropped silently, so a user who
 * attaches a screenshot is told it did not go rather than wondering why the
 * answer ignores it.
 */
export function puterMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages.map((message) => {
    if (typeof message.content === 'string') return { role: message.role, content: message.content };

    const text = message.content
      .map((part) =>
        part.type === 'text'
          ? (part.text ?? '')
          : '\n[an image was attached — Puter models are wired up for text here; switch to an NVIDIA vision model to send it]',
      )
      .join('');
    return { role: message.role, content: text };
  });
}
