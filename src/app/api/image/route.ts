import { NextRequest } from 'next/server';
import { keysFromRequest, withRequestKeys } from '@/lib/providers/request-keys';
import { generateImage as nimImage, hasNimKey } from '@/lib/providers/nim';
import { generateImage as pollinationsImage } from '@/lib/providers/pollinations';
import { customHeaders, assertSafeEndpoint } from '@/lib/providers/custom';
import { ProviderError, type CustomEndpointConfig } from '@/lib/providers/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ImageRequest {
  provider: 'nim' | 'pollinations' | 'custom';
  model?: string;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfgScale?: number;
  count?: number;
  custom?: CustomEndpointConfig;
}

async function customImage(cfg: CustomEndpointConfig, req: ImageRequest): Promise<{ dataUrl: string; model: string }> {
  const base = assertSafeEndpoint(cfg.baseUrl).toString().replace(/\/+$/, '');
  const res = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...customHeaders(cfg) },
    body: JSON.stringify({
      model: req.model,
      prompt: req.prompt,
      n: 1,
      size: `${req.width ?? 1024}x${req.height ?? 1024}`,
      response_format: 'b64_json',
    }),
    signal: AbortSignal.timeout(240_000),
  });

  if (!res.ok) {
    throw new ProviderError(`Custom image endpoint failed: ${res.status} ${await res.text().catch(() => '')}`.slice(0, 400), {
      status: res.status,
      code: 'custom_image_failed',
    });
  }

  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = json.data?.[0];
  if (item?.b64_json) return { dataUrl: `data:image/png;base64,${item.b64_json}`, model: req.model ?? 'custom' };
  if (item?.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(120_000) });
    const buf = Buffer.from(await img.arrayBuffer());
    return {
      dataUrl: `data:${img.headers.get('content-type') ?? 'image/png'};base64,${buf.toString('base64')}`,
      model: req.model ?? 'custom',
    };
  }
  throw new ProviderError('Custom image endpoint returned no image data.', { code: 'custom_image_empty' });
}

/**
 * Multi-provider image suite.
 * Requests run in parallel for `count > 1`; a partial failure returns the images
 * that did succeed alongside the errors rather than discarding the whole batch.
 */
async function handlePOST(req: NextRequest) {
  let body: ImageRequest;
  try {
    body = (await req.json()) as ImageRequest;
  } catch {
    return Response.json({ error: 'Request body is not valid JSON.' }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) return Response.json({ error: '`prompt` is required.' }, { status: 400 });

  const provider = body.provider ?? 'pollinations';
  if (provider === 'nim' && !hasNimKey()) {
    return Response.json(
      { error: 'NVIDIA_NIM_API_KEY is not configured. Switch the image provider to Pollinations — it needs no key.', code: 'nim_key_missing' },
      { status: 503 },
    );
  }

  const count = Math.min(Math.max(body.count ?? 1, 1), 4);
  const baseSeed = body.seed ?? Math.floor(Math.random() * 2 ** 31);

  const jobs = Array.from({ length: count }, (_, i) => {
    const seed = baseSeed + i;
    switch (provider) {
      case 'nim':
        return nimImage({
          model: body.model ?? 'black-forest-labs/flux.1-dev',
          prompt,
          negativePrompt: body.negativePrompt,
          width: body.width,
          height: body.height,
          steps: body.steps,
          seed,
          cfgScale: body.cfgScale,
        }).then((r) => ({ ...r, seed }));
      case 'custom': {
        if (!body.custom?.baseUrl) throw new ProviderError('`custom.baseUrl` is required.', { status: 400 });
        return customImage(body.custom, body).then((r) => ({ ...r, seed }));
      }
      default:
        return pollinationsImage({
          prompt,
          model: body.model ?? 'flux',
          width: body.width,
          height: body.height,
          seed,
        }).then((r) => ({ ...r, seed }));
    }
  });

  const settled = await Promise.allSettled(jobs);
  const images = settled
    .filter((s): s is PromiseFulfilledResult<{ dataUrl: string; model: string; seed: number }> => s.status === 'fulfilled')
    .map((s) => s.value);
  const errors = settled
    .filter((s): s is PromiseRejectedResult => s.status === 'rejected')
    .map((s) => (s.reason as Error).message);

  if (!images.length) {
    return Response.json(
      { error: errors[0] ?? 'Image generation failed.', errors, provider, code: 'image_generation_failed' },
      { status: 502 },
    );
  }

  return Response.json({ images, errors, provider, prompt });
}

/**
 * Credentials the user saved in the app travel on the request, so the web build
 * works without anyone editing .env.local. The server's own environment is still
 * the fallback, so a self-hosted instance is unaffected.
 */
export async function POST(req: NextRequest) {
  return withRequestKeys(keysFromRequest(req), () => handlePOST(req));
}
