/**
 * The three wire protocols a "custom endpoint" can actually speak.
 *
 * Chomugiri only ever spoke OpenAI's: `POST {base}/chat/completions` with a
 * Bearer token, `{choices:[{delta:{content}}]}` coming back. That is one of
 * three shapes people paste in, and the other two fail in a way that reads as
 * the app being broken:
 *
 *   - Anthropic-compatible gateways serve `POST {base}/v1/messages`, want
 *     `x-api-key` and `anthropic-version`, require `max_tokens`, take `system`
 *     as its own field, and answer with `content:[{type:"text"}]` blocks.
 *   - Google's Gemini API serves `POST {base}/models/{model}:generateContent`,
 *     wants `x-goog-api-key`, calls messages `contents` with `parts`, names the
 *     assistant role `model`, and answers with `candidates`.
 *
 * Asking any of them in OpenAI's dialect gets a 404 on the route, or a 401 on
 * the header, or silence. So the dialect is detected, and every request and
 * response is translated.
 *
 * Pure — no network, no state — so each translation can be tested directly.
 */

import type { ChatMessage, ChatRequest, StreamFrame } from './types.ts';

export type Dialect = 'openai' | 'anthropic' | 'gemini';

export const DIALECTS: Dialect[] = ['openai', 'anthropic', 'gemini'];

export const DIALECT_LABELS: Record<Dialect, string> = {
  openai: 'OpenAI-compatible (/chat/completions)',
  anthropic: 'Anthropic (/v1/messages)',
  gemini: 'Google Gemini (:generateContent)',
};

/** The Anthropic API version header. Required; requests without it are rejected. */
const ANTHROPIC_VERSION = '2023-06-01';

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * The dialect a URL is announcing.
 *
 * Guessed from what the user pasted, which in practice is the endpoint from the
 * provider's docs — and that URL names the protocol. Returns null when nothing
 * in it is decisive, so the caller can probe instead of assuming.
 */
export function dialectFromUrl(url: string): Dialect | null {
  const u = url.toLowerCase();

  if (/\/messages(\/|$|\?)/.test(u) || u.includes('anthropic')) return 'anthropic';
  if (
    u.includes('generativelanguage.googleapis.com') ||
    u.includes(':generatecontent') ||
    u.includes(':streamgeneratecontent') ||
    /\/v1beta(\/|$)/.test(u)
  ) {
    return 'gemini';
  }
  if (/\/chat\/completions(\/|$|\?)/.test(u) || /\/v1(\/|$)/.test(u)) return 'openai';
  return null;
}

/**
 * A pasted endpoint, reduced to the base the dialect builds paths from.
 *
 * People paste the URL from the docs, which is an endpoint rather than a base.
 * Taken literally it produces `/v1/messages/chat/completions`, which of course
 * answers nothing — and the error then blames the endpoint for the paste.
 */
export function normalizeBase(input: string, dialect?: Dialect): string {
  let base = input.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');

  // Gemini names the model inside the path: /models/gemini-3-pro:generateContent
  base = base.replace(/\/models\/[^/]*:(stream)?generate[Cc]ontent$/i, '');

  // Longest first, so /chat/completions never leaves a stray /chat.
  for (const suffix of ['/chat/completions', '/completions', '/messages', '/models', '/chat']) {
    if (base.toLowerCase().endsWith(suffix)) {
      base = base.slice(0, -suffix.length);
      break;
    }
  }
  // An Anthropic base is the /v1 above /messages; a bare origin needs it added.
  if (dialect === 'anthropic' && !/\/v\d[^/]*$/.test(base)) base = `${base}/v1`;

  return base.replace(/\/+$/, '');
}

// ── Auth ────────────────────────────────────────────────────────────────────

/**
 * The header each dialect authenticates with.
 *
 * Sending `Authorization: Bearer` to Anthropic or Gemini is a 401 every time —
 * they read `x-api-key` and `x-goog-api-key`. This was half of why a working
 * key looked like a broken endpoint.
 */
export function authHeaders(dialect: Dialect, apiKey?: string): Record<string, string> {
  if (dialect === 'anthropic') {
    return {
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }
  if (dialect === 'gemini') return apiKey ? { 'x-goog-api-key': apiKey } : {};
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/** Whether the caller already supplied the dialect's auth header themselves. */
export function hasAuthHeader(dialect: Dialect, headers: Record<string, string>): boolean {
  const names = Object.keys(headers).map((k) => k.toLowerCase());
  if (dialect === 'anthropic') return names.includes('x-api-key');
  if (dialect === 'gemini') return names.includes('x-goog-api-key');
  return names.includes('authorization');
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function chatUrl(dialect: Dialect, base: string, model: string, stream: boolean): string {
  const trimmed = base.replace(/\/+$/, '');
  if (dialect === 'anthropic') return `${trimmed}/messages`;
  if (dialect === 'gemini') {
    const method = stream ? 'streamGenerateContent' : 'generateContent';
    // Gemini prefixes ids with "models/" in its own listing; it must not be
    // doubled in the path.
    const id = model.replace(/^models\//, '');
    return `${trimmed}/models/${id}:${method}${stream ? '?alt=sse' : ''}`;
  }
  return `${trimmed}/chat/completions`;
}

/** Where each dialect publishes its model list. */
export function modelListUrl(dialect: Dialect, base: string): string {
  return `${base.replace(/\/+$/, '')}/models`;
}

// ── Requests ────────────────────────────────────────────────────────────────

/** Flattens our multi-part content down to text; images are dialect-specific. */
function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('');
}

export function requestBody(
  dialect: Dialect,
  req: ChatRequest,
  model: string,
  stream: boolean,
): Record<string, unknown> {
  if (dialect === 'anthropic') {
    // Anthropic takes the system prompt as its own field, accepts only user and
    // assistant turns, and *requires* max_tokens — omitting it is a 400, which
    // is not obvious from an OpenAI-shaped caller.
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => textOf(m.content))
      .join('\n\n');

    const messages = req.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: textOf(m.content) }));

    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? 8192,
      messages: messages.length ? messages : [{ role: 'user', content: '' }],
      stream,
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.stop?.length) body.stop_sequences = req.stop;
    return body;
  }

  if (dialect === 'gemini') {
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => textOf(m.content))
      .join('\n\n');

    const contents = req.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      // Gemini calls the assistant "model"; "assistant" is rejected.
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: textOf(m.content) }] }));

    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.topP !== undefined) generationConfig.topP = req.topP;
    if (req.maxTokens !== undefined) generationConfig.maxOutputTokens = req.maxTokens;
    if (req.stop?.length) generationConfig.stopSequences = req.stop;
    if (req.json) generationConfig.responseMimeType = 'application/json';

    const body: Record<string, unknown> = {
      contents: contents.length ? contents : [{ role: 'user', parts: [{ text: '' }] }],
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
    return body;
  }

  const body: Record<string, unknown> = { model, messages: req.messages, stream };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.stop?.length) body.stop = req.stop;
  if (req.json) body.response_format = { type: 'json_object' };
  return body;
}

// ── Responses ───────────────────────────────────────────────────────────────

interface AnthropicBlock {
  type?: string;
  text?: string;
  thinking?: string;
}

/** Frames from one non-streaming response body. */
export function framesFromResponse(dialect: Dialect, json: unknown): StreamFrame[] {
  if (!json || typeof json !== 'object') return [];
  const body = json as Record<string, unknown>;
  const out: StreamFrame[] = [];

  if (dialect === 'anthropic') {
    const blocks = Array.isArray(body.content) ? (body.content as AnthropicBlock[]) : [];
    const thinking = blocks
      .filter((b) => b.type === 'thinking' && b.thinking)
      .map((b) => b.thinking as string)
      .join('');
    const text = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');

    if (thinking) out.push({ type: 'reasoning', delta: thinking });
    if (text) out.push({ type: 'delta', delta: text });

    const usage = body.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (usage) {
      out.push({
        type: 'usage',
        promptTokens: usage.input_tokens,
        completionTokens: usage.output_tokens,
        totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) || undefined,
      });
    }
    if (typeof body.stop_reason === 'string') out.push({ type: 'done', finishReason: body.stop_reason });
    return out;
  }

  if (dialect === 'gemini') {
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const first = candidates[0] as
      | { content?: { parts?: Array<{ text?: string }> }; finishReason?: string }
      | undefined;
    const text = (first?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (text) out.push({ type: 'delta', delta: text });

    const usage = body.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
      | undefined;
    if (usage) {
      out.push({
        type: 'usage',
        promptTokens: usage.promptTokenCount,
        completionTokens: usage.candidatesTokenCount,
        totalTokens: usage.totalTokenCount,
      });
    }
    if (first?.finishReason) out.push({ type: 'done', finishReason: first.finishReason });
    return out;
  }

  const choice = (body.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = (choice?.message ?? choice?.delta) as
    | { content?: string | null; reasoning_content?: string | null; reasoning?: string | null }
    | undefined;
  const reasoning = message?.reasoning_content ?? message?.reasoning;
  if (reasoning) out.push({ type: 'reasoning', delta: reasoning });
  if (message?.content) out.push({ type: 'delta', delta: message.content });
  else if (typeof choice?.text === 'string' && choice.text) out.push({ type: 'delta', delta: choice.text as string });

  const usage = body.usage as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined;
  if (usage) {
    out.push({
      type: 'usage',
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });
  }
  if (typeof choice?.finish_reason === 'string') out.push({ type: 'done', finishReason: choice.finish_reason });
  return out;
}

/**
 * Frames from one streamed SSE payload.
 *
 * Anthropic's stream is a sequence of typed events rather than repeated
 * completion objects, so the event type carries the meaning: `content_block_delta`
 * holds the text, `message_delta` the usage, `message_stop` the end.
 */
export function framesFromStreamChunk(dialect: Dialect, json: unknown): StreamFrame[] {
  if (!json || typeof json !== 'object') return [];
  const body = json as Record<string, unknown>;

  if (dialect === 'anthropic') {
    const out: StreamFrame[] = [];
    const type = body.type as string | undefined;

    if (type === 'error') {
      const err = body.error as { message?: string; type?: string } | undefined;
      return [{ type: 'error', message: err?.message ?? 'Anthropic stream error', code: err?.type ?? 'anthropic_stream_error' }];
    }
    if (type === 'content_block_delta') {
      const delta = body.delta as { type?: string; text?: string; thinking?: string } | undefined;
      if (delta?.type === 'thinking_delta' && delta.thinking) out.push({ type: 'reasoning', delta: delta.thinking });
      else if (delta?.text) out.push({ type: 'delta', delta: delta.text });
      return out;
    }
    if (type === 'message_delta') {
      const usage = body.usage as { output_tokens?: number } | undefined;
      if (usage?.output_tokens) out.push({ type: 'usage', completionTokens: usage.output_tokens });
      const delta = body.delta as { stop_reason?: string } | undefined;
      if (delta?.stop_reason) out.push({ type: 'done', finishReason: delta.stop_reason });
      return out;
    }
    if (type === 'message_stop') return [{ type: 'done', finishReason: 'stop' }];
    // message_start, content_block_start/stop and ping carry nothing to show.
    return [];
  }

  // Gemini streams the same object it returns non-streaming, once per chunk,
  // and OpenAI streams deltas — both of which the response reader handles.
  return framesFromResponse(dialect, json);
}

// ── Model lists ─────────────────────────────────────────────────────────────

/** Model ids out of each dialect's listing shape. */
export function modelIdsFromList(dialect: Dialect, json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const body = json as Record<string, unknown>;

  if (dialect === 'gemini') {
    const models = Array.isArray(body.models) ? body.models : [];
    return models
      .map((m) => (m as { name?: string }).name ?? '')
      // "models/gemini-3-pro" is the id as Gemini reports it; the bare name is
      // what goes in a path and in the switcher.
      .map((name) => name.replace(/^models\//, ''))
      .filter(Boolean);
  }

  // OpenAI and Anthropic both answer { data: [{ id }] }.
  const data = Array.isArray(body.data) ? body.data : [];
  return data.map((m) => (m as { id?: string }).id ?? '').filter(Boolean);
}

/** A dialect's error envelope, in words worth showing. */
export function errorFromBody(dialect: Dialect, status: number, text: string): { message: string; code: string } | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (dialect === 'anthropic' && body.type === 'error') {
    const err = body.error as { type?: string; message?: string } | undefined;
    return { message: `${status} ${err?.message ?? 'Anthropic error'}`, code: err?.type ?? `http_${status}` };
  }
  if (dialect === 'gemini' && body.error && typeof body.error === 'object') {
    const err = body.error as { status?: string; message?: string; code?: number };
    return { message: `${err.code ?? status} ${err.message ?? 'Gemini error'}`, code: err.status ?? `http_${status}` };
  }
  return null;
}

/**
 * Per-endpoint limits, applied to a body that is already in the right dialect.
 *
 * A gateway is not obliged to accept the caller's idea of a sensible ceiling:
 * plenty of smaller models 400 on `max_tokens: 8192` because their own cap is
 * 2048 or 4096, and the run dies on a number the user never chose. An endpoint
 * can now carry its own cap and default temperature, and the request is clamped
 * to them rather than rejected by them.
 *
 * Clamps, never raises — a caller asking for less than the endpoint's ceiling
 * meant it.
 */
export function applyEndpointLimits(
  body: Record<string, unknown>,
  dialect: Dialect,
  limits: { maxTokens?: number; temperature?: number },
): Record<string, unknown> {
  const { maxTokens, temperature } = limits;

  if (maxTokens !== undefined && maxTokens > 0) {
    if (dialect === 'gemini') {
      const config = (body.generationConfig ?? {}) as Record<string, unknown>;
      const asked = typeof config.maxOutputTokens === 'number' ? config.maxOutputTokens : undefined;
      config.maxOutputTokens = asked === undefined ? maxTokens : Math.min(asked, maxTokens);
      body.generationConfig = config;
    } else {
      const asked = typeof body.max_tokens === 'number' ? body.max_tokens : undefined;
      body.max_tokens = asked === undefined ? maxTokens : Math.min(asked, maxTokens);
    }
  }

  // Temperature is a default, not a clamp: the run asks for 0.25 on a build and
  // 0.5 on a chat, and overriding that would break the lanes.
  if (temperature !== undefined) {
    if (dialect === 'gemini') {
      const config = (body.generationConfig ?? {}) as Record<string, unknown>;
      if (config.temperature === undefined) config.temperature = temperature;
      body.generationConfig = config;
    } else if (body.temperature === undefined) {
      body.temperature = temperature;
    }
  }

  return body;
}
