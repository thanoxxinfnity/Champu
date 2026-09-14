/**
 * Microsoft TRELLIS, through an NVIDIA NIM endpoint.
 *
 * ── Read this before wiring it into a default path ──────────────────────────
 *
 * NVIDIA's *hosted* TRELLIS at ai.api.nvidia.com is a demo, not a generator. It
 * accepts only NVIDIA's own sample images by id. Tested against the live API
 * with a valid NIM key:
 *
 *   { "prompt": "a small stone golem", ... }   HTTP 500, after 91 seconds
 *   { "image": "data:image/png;base64,..." }   HTTP 422
 *                                              "Expected: example_id, got: base64"
 *   NVCF asset upload, then the asset id       HTTP 422
 *                                              "Expected: example_id, got: asset_id"
 *   { }                                        HTTP 422
 *                                              "Input needs to be either image or prompt"
 *
 * So the route exists, authenticates, and refuses every input a user could
 * actually supply. It is not a key problem and not a payload problem — the
 * hosted deployment is wired to a fixed set of examples.
 *
 * That is why TRELLIS is NOT in the default chain in `model-source.ts`: putting
 * it there costs ninety seconds of a run and then fails, every time.
 *
 * The client below is still real and still worth having, because TRELLIS itself
 * is. Point `baseUrl` at a self-hosted NIM container
 * (`nvcr.io/nim/microsoft/trellis:latest`, which needs an NVIDIA GPU) and the
 * same code generates properly. `hostedRefusal()` turns the demo endpoint's
 * answer into an explanation rather than a bare 500.
 */

export const HOSTED_TRELLIS = 'https://ai.api.nvidia.com/v1/genai/microsoft/trellis';

export interface TrellisOptions {
  /** Defaults to NVIDIA's hosted endpoint, which only serves its own examples. */
  baseUrl?: string;
  /** How closely the mesh follows the prompt. */
  cfgScale?: number;
  /** More steps, more detail, more time. */
  samplingSteps?: number;
  seed?: number;
  signal?: AbortSignal;
}

export interface TrellisResult {
  /** The .glb bytes, when it worked. */
  model?: Uint8Array;
  error?: string;
  /** True when the failure is the hosted demo refusing real input, not a bug. */
  demoEndpoint?: boolean;
}

/**
 * Recognises the hosted demo refusing a real input.
 *
 * Worth separating from a generic failure: a user who sees "TRELLIS returned
 * 500" will retry, re-enter their key, and file a bug. A user told the hosted
 * endpoint only serves NVIDIA's samples knows to stop.
 */
export function hostedRefusal(status: number, body: string): string | null {
  if (/Expected:\s*example_id/i.test(body)) {
    return 'NVIDIA\'s hosted TRELLIS only accepts its own sample images — it will not take a prompt or an uploaded image. Self-host the NIM container, or use Meshy or Tripo instead.';
  }
  // The text route answers 500 rather than 422, but it is the same deployment
  // and the same dead end.
  if (status >= 500) {
    return 'NVIDIA\'s hosted TRELLIS failed on a text prompt (it answers 500 for any prompt). It is a demo deployment; use Meshy or Tripo, or self-host the NIM container.';
  }
  return null;
}

/** A NIM error body in words worth showing. */
export function trellisError(status: number, body: string): string {
  const refusal = hostedRefusal(status, body);
  if (refusal) return refusal;

  if (status === 401 || status === 403) {
    return 'NVIDIA rejected the NIM key for TRELLIS. Check it in Settings → API Keys.';
  }
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; message?: string };
    const detail = typeof parsed.detail === 'string' ? parsed.detail : parsed.message;
    if (detail) return `TRELLIS: ${detail}.`;
  } catch {
    // Not JSON.
  }
  return `TRELLIS returned ${status}.`;
}

/**
 * Generates a mesh from a prompt.
 *
 * Returns bytes rather than a URL: a NIM container answers with the .glb
 * inline, which is the one thing it does more conveniently than a job queue.
 */
export async function generateModel(prompt: string, apiKey: string, options: TrellisOptions = {}): Promise<TrellisResult> {
  const url = options.baseUrl ?? HOSTED_TRELLIS;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt.slice(0, 600),
        slat_cfg_scale: options.cfgScale ?? 3,
        ss_cfg_scale: 7.5,
        slat_sampling_steps: options.samplingSteps ?? 12,
        ss_sampling_steps: options.samplingSteps ?? 12,
        seed: options.seed ?? 0,
      }),
      // Generation is slow even when it works; the hosted one burns 90s before
      // failing, which is most of this budget.
      signal: options.signal ?? AbortSignal.timeout(180_000),
    });

    if (!res.ok) {
      const text = await res.text();
      return { error: trellisError(res.status, text), demoEndpoint: hostedRefusal(res.status, text) !== null };
    }

    const type = res.headers.get('content-type') ?? '';
    if (type.includes('model/gltf-binary') || type.includes('octet-stream')) {
      return { model: new Uint8Array(await res.arrayBuffer()) };
    }

    // Some NIM builds answer JSON with the asset base64-encoded instead.
    const json = (await res.json()) as Record<string, unknown>;
    const encoded = typeof json.artifact === 'string' ? json.artifact : typeof json.model === 'string' ? json.model : null;
    if (!encoded) return { error: 'TRELLIS answered without a model in it.' };

    const binary = atob(encoded.replace(/^data:[^,]+,/, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { model: bytes };
  } catch (err) {
    return { error: `Could not reach TRELLIS: ${(err as Error).message}` };
  }
}
