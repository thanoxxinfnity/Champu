import { ProviderError, type ChatRequest, type StreamFrame } from './types';

/**
 * One OpenAI-compatible transport shared by NIM, Pollinations and any custom
 * endpoint. Emits normalised {@link StreamFrame}s so the agent core is
 * vendor-agnostic.
 */

export interface UpstreamConfig {
  url: string;
  headers: Record<string, string>;
  /** Body transform applied after the standard OpenAI payload is assembled. */
  shapeBody?: (body: Record<string, unknown>, req: ChatRequest) => Record<string, unknown>;
  /** Upstreams that reject `stream: true` fall back to a single-shot request. */
  supportsStreaming?: boolean;
  timeoutMs?: number;
  /**
   * Maps a raw upstream failure to an actionable message. Providers wrap their
   * real error in odd envelopes — Pollinations returns `402 Payment Required`
   * inside an HTTP 500 body — and the default "500 …" text tells the user
   * nothing they can act on.
   */
  describeError?: (status: number, body: string) => { message: string; code?: string; retryable?: boolean } | null;
}

export function buildBody(req: ChatRequest, modelId: string, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: modelId,
    messages: req.messages,
    stream,
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.stop?.length) body.stop = req.stop;
  if (req.json) body.response_format = { type: 'json_object' };
  return body;
}

interface DescribedError {
  message: string;
  code: string;
  retryable: boolean;
}

async function readError(res: Response, cfg: UpstreamConfig): Promise<DescribedError> {
  const text = await res.text().catch(() => '');

  const described = cfg.describeError?.(res.status, text);
  if (described) {
    return {
      message: described.message,
      code: described.code ?? `http_${res.status}`,
      retryable: described.retryable ?? isRetryable(res.status),
    };
  }

  const fallback: DescribedError = {
    message: text ? `${res.status} ${text}`.slice(0, 600) : `${res.status} ${res.statusText}`,
    code: `http_${res.status}`,
    retryable: isRetryable(res.status),
  };
  if (!text) return fallback;

  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string; detail?: string };
    const err = json.error;
    const msg = (typeof err === 'string' ? err : err?.message) ?? json.message ?? json.detail ?? text;
    return { ...fallback, message: `${res.status} ${msg}`.slice(0, 600) };
  } catch {
    return fallback;
  }
}

/** HTTP statuses worth a backoff retry; everything else is a hard failure. */
function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status === 425 || status >= 500;
}

interface Delta {
  content?: string | null;
  reasoning_content?: string | null;
  /** Some upstreams (Pollinations reasoning, certain NIM builds) use `reasoning`. */
  reasoning?: string | null;
}

interface ChunkChoice {
  delta?: Delta;
  message?: Delta;
  text?: string;
  finish_reason?: string | null;
}

interface ChunkPayload {
  choices?: ChunkChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string } | string;
}

function framesFromChunk(payload: ChunkPayload): StreamFrame[] {
  const out: StreamFrame[] = [];

  if (payload.error) {
    const msg = typeof payload.error === 'string' ? payload.error : payload.error.message;
    out.push({ type: 'error', message: msg ?? 'upstream error', code: 'upstream_stream_error' });
    return out;
  }

  const choice = payload.choices?.[0];
  const d = choice?.delta ?? choice?.message;
  if (d) {
    const reasoning = d.reasoning_content ?? d.reasoning;
    if (reasoning) out.push({ type: 'reasoning', delta: reasoning });
    if (d.content) out.push({ type: 'delta', delta: d.content });
  } else if (choice?.text) {
    out.push({ type: 'delta', delta: choice.text });
  }

  if (payload.usage) {
    out.push({
      type: 'usage',
      promptTokens: payload.usage.prompt_tokens,
      completionTokens: payload.usage.completion_tokens,
      totalTokens: payload.usage.total_tokens,
    });
  }
  if (choice?.finish_reason) out.push({ type: 'done', finishReason: choice.finish_reason });
  return out;
}

/**
 * Stream a chat completion, yielding normalised frames.
 * Never throws mid-stream — transport failures arrive as an `error` frame so the
 * UI can degrade instead of unmounting.
 */
export async function* streamChat(
  cfg: UpstreamConfig,
  req: ChatRequest,
  modelId: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamFrame> {
  const wantStream = req.stream !== false && cfg.supportsStreaming !== false;
  let body = buildBody(req, modelId, wantStream);
  if (cfg.shapeBody) body = cfg.shapeBody(body, req);

  const timeout = AbortSignal.timeout(cfg.timeoutMs ?? 300_000);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: wantStream ? 'text/event-stream' : 'application/json', ...cfg.headers },
      body: JSON.stringify(body),
      signal: composed,
    });
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    yield {
      type: 'error',
      message: aborted
        ? 'Upstream request aborted or timed out.'
        : `Network failure reaching ${new URL(cfg.url).host}: ${(err as Error).message}`,
      code: aborted ? 'aborted' : 'network_error',
      retryable: !aborted,
    };
    return;
  }

  if (!res.ok) {
    yield { type: 'error', ...(await readError(res, cfg)) };
    return;
  }

  // Non-streaming path (upstream ignored `stream` or we never asked).
  const contentType = res.headers.get('content-type') ?? '';
  if (!wantStream || !contentType.includes('text/event-stream')) {
    const text = await res.text();

    // Some upstreams answer 200 with an error envelope in the body.
    const masked = cfg.describeError?.(res.status, text);
    if (masked) {
      yield { type: 'error', message: masked.message, code: masked.code ?? 'upstream_error', retryable: masked.retryable ?? false };
      yield { type: 'done', finishReason: 'error' };
      return;
    }

    try {
      const payload = JSON.parse(text) as ChunkPayload;
      const frames = framesFromChunk(payload);
      if (!frames.some((f) => f.type === 'delta' || f.type === 'reasoning')) {
        // Some zero-key endpoints answer with a bare string body.
        yield { type: 'delta', delta: text };
      } else {
        for (const f of frames) yield f;
      }
    } catch {
      yield { type: 'delta', delta: text };
    }
    yield { type: 'done', finishReason: 'stop' };
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    yield { type: 'error', message: 'Upstream returned an empty body.', code: 'empty_body' };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;
  // A `finish_reason` chunk and a trailing `[DONE]` both mean "finished".
  // Emitting `done` for each would close the run twice downstream.
  let emittedDone = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line; tolerate CRLF.
      const SEP = /\r?\n\r?\n/g;
      for (;;) {
        SEP.lastIndex = 0;
        const match = SEP.exec(buffer);
        if (!match) break;
        const raw = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);

        for (const line of raw.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === '[DONE]') {
            sawDone = true;
            continue;
          }
          try {
            for (const f of framesFromChunk(JSON.parse(data) as ChunkPayload)) {
              if (f.type === 'done') {
                if (emittedDone) continue;
                emittedDone = true;
              }
              yield f;
            }
          } catch {
            /* keep-alive comment or partial frame — ignore */
          }
        }
      }
    }
  } catch (err) {
    yield {
      type: 'error',
      message: `Stream interrupted: ${(err as Error).message}`,
      code: 'stream_interrupted',
      retryable: true,
    };
    return;
  } finally {
    reader.releaseLock();
  }

  if (!emittedDone) yield { type: 'done', finishReason: sawDone ? 'stop' : undefined };
}

/** Collect a full completion. Throws {@link ProviderError} on failure. */
export async function completeChat(
  cfg: UpstreamConfig,
  req: ChatRequest,
  modelId: string,
  signal?: AbortSignal,
): Promise<{ content: string; reasoning: string }> {
  let content = '';
  let reasoning = '';
  for await (const frame of streamChat(cfg, { ...req, stream: false }, modelId, signal)) {
    if (frame.type === 'delta') content += frame.delta;
    else if (frame.type === 'reasoning') reasoning += frame.delta;
    else if (frame.type === 'error') {
      throw new ProviderError(frame.message, { code: frame.code, retryable: frame.retryable });
    }
  }
  return { content, reasoning };
}
