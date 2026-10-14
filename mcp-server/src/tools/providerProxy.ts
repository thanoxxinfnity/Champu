import type { Tenant } from '../tenants/store.ts';
import { McpHttpError, RpcErrorCode } from '../errors.ts';

export type Capability = 'image' | 'video' | 'model3d';

const DEFAULT_ROUTE: Record<Capability, string> = {
  image: '/images/generations',
  video: '/videos/generations',
  model3d: '/3d/generations',
};

/** Finds generated media in the shapes real providers answer with: b64 at various nesting depths, or a URL. */
function pickMedia(json: unknown): { b64?: string; url?: string } | null {
  const j = json as Record<string, unknown> | null;
  const candidates: unknown[] = [
    Array.isArray(j?.data) ? j!.data[0] : undefined,
    Array.isArray(j?.output) ? (j!.output as unknown[])[0] : undefined,
    j?.result,
    j?.video,
    j?.audio,
    j?.model,
    j,
  ];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    if (typeof o.b64_json === 'string') return { b64: o.b64_json };
    if (typeof o.b64 === 'string') return { b64: o.b64 };
    for (const key of ['url', 'video_url', 'audio_url', 'model_url', 'glb_url', 'download_url']) {
      if (typeof o[key] === 'string') return { url: o[key] as string };
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GenerateResult {
  /** data: URI when the provider returned bytes directly; otherwise the remote URL. */
  dataUri?: string;
  url?: string;
  bytes?: number;
  mimeType: string;
}

/**
 * Calls the tenant's configured provider for one capability, polling a job endpoint if the
 * provider answers asynchronously (the same "maybe a job, maybe inline" shape Chomugiri's own
 * client-side media suites already handle — mirrored here since this server talks to the same
 * class of OpenAI-compatible-ish generation APIs, just from a trusted server context instead of a
 * browser, so there is no CORS constraint to route around).
 */
export async function callProvider(tenant: Tenant, cap: Capability, args: { prompt: string; mimeType: string; extra?: Record<string, unknown> }): Promise<GenerateResult> {
  const provider = tenant.providers[cap];
  if (!provider) {
    throw new McpHttpError(409, RpcErrorCode.UpstreamProviderError, `Tenant "${tenant.id}" has no ${cap} provider configured.`);
  }
  const base = provider.baseUrl.replace(/\/+$/, '');
  const route = DEFAULT_ROUTE[cap];
  const url = `${base}${route}`;
  const body = { model: provider.model, prompt: args.prompt, response_format: 'b64_json', ...args.extra };

  let json: unknown;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new McpHttpError(502, RpcErrorCode.UpstreamProviderError, `Provider answered ${res.status}: ${text.slice(0, 300)}`);
    }
    json = await res.json();
  } catch (err) {
    if (err instanceof McpHttpError) throw err;
    throw new McpHttpError(502, RpcErrorCode.UpstreamProviderError, `Could not reach the ${cap} provider: ${(err as Error).message}`);
  }

  const jobId = (json as Record<string, unknown>)?.id ?? (json as Record<string, unknown>)?.task_id;
  let found = pickMedia(json);
  for (let i = 0; i < 60 && jobId && !found; i++) {
    const status = String((json as Record<string, unknown>)?.status ?? '');
    if (/fail|error|cancel/i.test(status)) {
      throw new McpHttpError(502, RpcErrorCode.UpstreamProviderError, `Provider job failed: ${status}`);
    }
    await sleep(3000);
    const pollRes = await fetch(`${url}/${jobId}`, { headers: { Authorization: `Bearer ${provider.apiKey}` }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!pollRes?.ok) continue;
    json = await pollRes.json();
    found = pickMedia(json);
  }
  if (!found) throw new McpHttpError(504, RpcErrorCode.UpstreamProviderError, 'The provider did not finish in time.');

  if (found.b64) {
    const bytes = Buffer.from(found.b64, 'base64');
    return { dataUri: `data:${args.mimeType};base64,${found.b64}`, bytes: bytes.length, mimeType: args.mimeType };
  }
  return { url: found.url, mimeType: args.mimeType };
}
