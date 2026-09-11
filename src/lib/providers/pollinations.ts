import type { UpstreamConfig } from './openai-compat';
import { POLLINATIONS_MODELS } from './registry';
import { ProviderError, type ModelDescriptor } from './types';

/**
 * Pollinations.ai adapter — zero-key generation hub.
 *
 * Text: `https://text.pollinations.ai/openai` is OpenAI-compatible.
 * Image: `https://image.pollinations.ai/prompt/<encoded>` returns the image bytes
 * directly, so it can be used as a plain <img src>. We still proxy it to keep the
 * referrer/token server-side and to normalise error handling.
 */

export const TEXT_BASE = process.env.POLLINATIONS_TEXT_BASE_URL?.replace(/\/+$/, '') ?? 'https://text.pollinations.ai';
export const IMAGE_BASE = process.env.POLLINATIONS_IMAGE_BASE_URL?.replace(/\/+$/, '') ?? 'https://image.pollinations.ai';
const REFERRER = process.env.POLLINATIONS_REFERRER ?? 'chomugiri';

function headers(): Record<string, string> {
  const h: Record<string, string> = { Referer: REFERRER };
  const token = process.env.POLLINATIONS_TOKEN?.trim();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * Pollinations wraps its real failure inside an HTTP 500 whose body carries the
 * actual status — `{"error":"402 Payment Required","status":500,...}`. Reporting
 * that verbatim ("500 402 Payment Required") tells the user nothing, so the real
 * cause and the way out are surfaced instead.
 */
export function describePollinationsError(
  status: number,
  body: string,
): { message: string; code?: string; retryable?: boolean } | null {
  if (!body) return null;

  let inner: string | undefined;
  let notice: string | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: string | { message?: string }; deprecation_notice?: string };
    inner = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
    notice = parsed.deprecation_notice;
  } catch {
    inner = body.slice(0, 300);
  }

  if (!inner && status < 400) return null;
  const text = `${inner ?? ''}`;

  if (/402|payment required|quota|insufficient/i.test(text)) {
    return {
      message:
        'Pollinations refused the request with 402 — the keyless anonymous tier is out of quota or rate limiting this IP. ' +
        'Wait a minute and retry, set POLLINATIONS_TOKEN in .env.local to raise the limit, or switch the model ' +
        'to a Duck.ai model (free, no key, opens in the browser), NVIDIA NIM, or a custom endpoint.' +
        (notice ? ` Upstream notice: ${notice.slice(0, 200)}` : ''),
      code: 'pollinations_quota',
      retryable: true,
    };
  }

  if (/429|rate limit|too many/i.test(text)) {
    return {
      message: 'Pollinations is rate limiting this IP. Back off for a few seconds, or switch provider.',
      code: 'pollinations_rate_limited',
      retryable: true,
    };
  }

  if (status >= 400 && text) {
    return { message: `Pollinations: ${text.slice(0, 400)}`, code: 'pollinations_error', retryable: status >= 500 };
  }

  return null;
}

export function pollinationsChatConfig(): UpstreamConfig {
  return {
    url: `${TEXT_BASE}/openai`,
    headers: headers(),
    supportsStreaming: true,
    timeoutMs: 180_000,
    describeError: describePollinationsError,
    shapeBody: (body) => {
      body.referrer = REFERRER;
      // The free tier rejects `stream_options`; keep the payload minimal.
      delete body.stream_options;
      return body;
    },
  };
}

/** Live model list. Falls back to the bundled set when the endpoint is down. */
let cache: { at: number; models: ModelDescriptor[] } | null = null;
const TTL_MS = 15 * 60_000;

export async function listModels(): Promise<ModelDescriptor[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.models;

  try {
    const res = await fetch(`${TEXT_BASE}/models`, {
      headers: headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return POLLINATIONS_MODELS;

    interface RawModel {
      name?: string;
      description?: string;
      reasoning?: boolean;
      vision?: boolean;
      tools?: boolean;
    }

    const json = (await res.json()) as RawModel[] | { models?: RawModel[] };
    const raw: RawModel[] = Array.isArray(json) ? json : (json.models ?? []);

    const models: ModelDescriptor[] = raw
      .filter((m) => typeof m?.name === 'string' && m.name.length > 0)
      .map((m) => {
        const id = m.name as string;
        const known = POLLINATIONS_MODELS.find((k) => k.id === id);
        const caps: ModelDescriptor['capabilities'] = ['chat'];
        if (m.vision) caps.push('vision');
        if (m.tools) caps.push('tools');
        if (m.reasoning) caps.push('reasoning');
        if (/search/i.test(id)) caps.push('search');
        return {
          id,
          provider: 'pollinations' as const,
          label: known?.label ?? `Pollinations · ${id}`,
          vendor: 'Pollinations',
          capabilities: caps.length > 1 ? caps : (known?.capabilities ?? caps),
          emitsReasoning: caps.includes('reasoning'),
          origin: 'catalogue' as const,
          note: typeof m.description === 'string' ? m.description : undefined,
        };
      });

    // Image models are served by a separate host and are not in /models.
    const imageModels = POLLINATIONS_MODELS.filter((m) => m.capabilities.includes('image'));
    const merged = [...models, ...imageModels.filter((im) => !models.some((m) => m.id === im.id))];

    cache = { at: Date.now(), models: merged.length ? merged : POLLINATIONS_MODELS };
    return cache.models;
  } catch {
    return POLLINATIONS_MODELS;
  }
}

export interface PollinationsImageOptions {
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
  seed?: number;
  /** Strip the Pollinations watermark where the tier allows it. */
  nologo?: boolean;
  enhance?: boolean;
}

export function imageUrl(opts: PollinationsImageOptions): string {
  const params = new URLSearchParams({
    model: opts.model ?? 'flux',
    width: String(opts.width ?? 1024),
    height: String(opts.height ?? 1024),
    nologo: String(opts.nologo ?? true),
    referrer: REFERRER,
  });
  if (opts.seed !== undefined) params.set('seed', String(opts.seed));
  if (opts.enhance) params.set('enhance', 'true');
  return `${IMAGE_BASE}/prompt/${encodeURIComponent(opts.prompt)}?${params}`;
}

/** Fetch and inline as a data URL so generated assets survive in local history. */
export async function generateImage(opts: PollinationsImageOptions): Promise<{ dataUrl: string; model: string }> {
  const url = imageUrl(opts);
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(180_000) });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const described = describePollinationsError(res.status, body);
    throw new ProviderError(
      described?.message ?? `Pollinations image generation failed: ${res.status} ${res.statusText}`,
      {
        status: res.status,
        code: described?.code ?? 'pollinations_image_failed',
        retryable: described?.retryable ?? (res.status >= 500 || res.status === 429),
      },
    );
  }

  const type = res.headers.get('content-type') ?? 'image/jpeg';
  if (!type.startsWith('image/')) {
    throw new ProviderError(
      `Pollinations returned ${type} instead of an image — the free tier is likely rate limiting.`,
      { code: 'pollinations_image_not_image', retryable: true },
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return { dataUrl: `data:${type};base64,${buf.toString('base64')}`, model: opts.model ?? 'flux' };
}
