import type { AssetRecord, EndpointRecord } from '@/lib/db/schema';
import { saveAsset } from '@/lib/db/history';

export type MediaCap = 'image' | 'video' | 'audio' | 'model3d';

/** Endpoints the user added that can do this kind of generation. Removing the endpoint removes the tab. */
export const endpointsFor = (endpoints: EndpointRecord[], cap: MediaCap) =>
  endpoints.filter((e) => e.enabled && e.capabilities.includes(cap));

export const modelsFor = (endpoint: EndpointRecord | undefined, cap: MediaCap) => {
  const all = endpoint?.models.filter((m) => m.enabled !== false) ?? [];
  const mine = all.filter((m) => m.capabilities.includes(cap));
  return (mine.length ? mine : all).map((m) => m.id);
};

export const apiBase = (e: EndpointRecord) => e.baseUrl.trim().replace(/\/+$/, '');

export const authHeaders = (e: EndpointRecord): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(e.apiKey ? { Authorization: `Bearer ${e.apiKey}` } : {}),
  ...(e.headers ?? {}),
});

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export const dataUrlToBlob = async (dataUrl: string) => (await fetch(dataUrl)).blob();

/** A request that fails on CORS looks like "Failed to fetch"; say what that means here. */
export function explainFetchError(err: unknown, host: string): string {
  const message = (err as Error)?.message ?? String(err);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return `Could not reach ${host}. The provider may block browser requests (CORS), or the address is wrong.`;
  }
  return message;
}

export async function httpJson(url: string, init: RequestInit, host: string) {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(explainFetchError(err, host));
  }
  if (!res.ok) throw new Error(`${host} answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 240)}`);
  return res;
}

/** Finds the media in the many shapes providers answer with: b64 or a URL, at the top or under data[0]. */
export function pickMedia(json: any): { b64?: string; url?: string } | null {
  const candidates = [json?.data?.[0], json?.output?.[0], json?.result, json?.video, json?.audio, json?.model, json];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === 'string' && /^https?:/.test(c)) return { url: c };
    if (typeof c.b64_json === 'string') return { b64: c.b64_json };
    if (typeof c.b64 === 'string') return { b64: c.b64 };
    for (const key of ['url', 'video_url', 'audio_url', 'model_url', 'glb_url', 'download_url']) {
      if (typeof c[key] === 'string') return { url: c[key] };
    }
  }
  return null;
}

/** Turns what the provider returned into a Blob, going to fetch the URL if that is all it gave. */
export async function mediaToBlob(found: { b64?: string; url?: string }, mime: string): Promise<{ blob?: Blob; url?: string }> {
  if (found.b64) {
    const bytes = Uint8Array.from(atob(found.b64), (c) => c.charCodeAt(0));
    return { blob: new Blob([bytes], { type: mime }) };
  }
  if (found.url) {
    try {
      const res = await fetch(found.url);
      if (res.ok) return { blob: await res.blob() };
    } catch {
      /* the file host does not allow us to read it; the URL itself is still playable */
    }
    return { url: found.url };
  }
  return {};
}

export async function saveMedia(args: {
  suite: AssetRecord['suite'];
  kind: AssetRecord['kind'];
  prompt: string;
  provider: string;
  model: string;
  blob?: Blob;
  url?: string;
  meta?: Record<string, unknown>;
}): Promise<AssetRecord> {
  const dataUrl = args.blob ? await blobToDataUrl(args.blob) : undefined;
  return saveAsset({
    suite: args.suite,
    kind: args.kind,
    prompt: args.prompt,
    provider: args.provider,
    model: args.model,
    dataUrl,
    url: args.url,
    bytes: args.blob?.size,
    meta: args.meta,
  });
}

export const srcOf = (a: Pick<AssetRecord, 'dataUrl' | 'url'>) => a.dataUrl ?? a.url ?? '';

export const fmtTime = (s: number) =>
  Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00';

export const fmtBytes = (n?: number) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export const ZOOM_MAX = 50;
