/**
 * Microsoft TRELLIS, through NVIDIA.
 *
 * TRELLIS turns a prompt or a photo into a textured mesh, and it is the model
 * to want: it is the only 3D generator NVIDIA hosts, so an NVIDIA key that
 * already works for chat would cover assets too.
 *
 * ── Two very different endpoints, and only one of them is real ──────────────
 *
 * `ai.api.nvidia.com/v1/genai/microsoft/trellis` is the *demo* behind the
 * build.nvidia.com playground. It only accepts NVIDIA's own sample pictures by
 * id, and says so: an uploaded image answers
 * `422 {"detail":"Expected: example_id, got: base64"}`, an NVCF asset id
 * answers `Expected: example_id, got: asset_id`, and a text prompt answers
 * `500` after ninety seconds. It is not a generator and nothing can make it one.
 *
 * The real deployment is the NIM container, and NVIDIA runs one: an NVCF
 * function named `ai-trellis`, status ACTIVE, health `/v1/health/ready` — which
 * matches the published NIM OpenAPI exactly. It is invoked at
 * `api.nvcf.nvidia.com/v2/nvcf/pexec/functions/{id}` and takes the documented
 * `Object3DRequest`: a `mode` of "text" or "image", a `prompt` or a
 * `data:image/png;base64,…`, and an `output_format` of glb or stl. It answers
 * `202 Accepted` with an `nvcf-reqid` to poll, and returns the model as
 * `{ artifacts: [{ base64, finishReason, seed }] }`.
 *
 * So this speaks the real protocol, which is what a self-hosted container wants
 * too — point `baseUrl` at your own `nvcr.io/nim/microsoft/trellis` and the
 * same code runs against it.
 *
 * What NVIDIA's own hosted function currently does. Every documented path was
 * tried with a live key, over about an hour:
 *
 *   text, full payload            202 Accepted, then errored / 500   (x3)
 *   text, bare {prompt}           202 Accepted, then errored / 500
 *   text, low steps / no_texture  202 Accepted, then errored / 500
 *   text, output_format stl       202 Accepted, then errored / 500
 *   image, inline base64          422 at validation, 128-1024 px     (x4)
 *   image, as an array            422
 *   image, NVIDIA's own example   422   <- from their published spec
 *   image, NVCF asset upload      422   (slot + S3 PUT 200 + reference)
 *   version-pinned URL            same as above
 *
 * The decisive one: with the same key in the same minute, FLUX.1-dev answered
 * 200 SUCCESS in 4.2 seconds while TRELLIS answered 500. The key is fine, the
 * endpoint is right, the payload matches their schema — the deployment fails
 * its own jobs.
 *
 * So `model-source.ts` keeps TRELLIS in the chain but remembers the verdict for
 * the process rather than paying ninety seconds per model. When NVIDIA repairs
 * it, this starts working with no change here — which is the whole reason to
 * speak the real protocol rather than give up on it.
 */

/** NVIDIA's own hosted TRELLIS NIM, as an NVCF function. */
export const NVCF_TRELLIS_FUNCTION = '7c3ba6c7-1664-4486-a611-bd4475c98d92';
export const NVCF_INVOKE = 'https://api.nvcf.nvidia.com/v2/nvcf/pexec/functions';
export const NVCF_STATUS = 'https://api.nvcf.nvidia.com/v2/nvcf/pexec/status';

/** The demo endpoint, named so it can be recognised and refused. */
export const DEMO_ENDPOINT = 'https://ai.api.nvidia.com/v1/genai/microsoft/trellis';

export interface TrellisOptions {
  /**
   * A self-hosted NIM container's base URL (its `/v1/infer` is appended).
   * Omitted means NVIDIA's hosted NVCF function.
   */
  baseUrl?: string;
  /** How closely the mesh follows the input. 1-10. */
  cfgScale?: number;
  /** More steps, more detail, more time. 10-50. */
  samplingSteps?: number;
  /** Skips texture baking, which is faster and fine for a greybox. */
  noTexture?: boolean;
  seed?: number;
  timeoutMs?: number;
  onProgress?: (note: string) => void;
  signal?: AbortSignal;
}

export interface TrellisResult {
  /** The .glb bytes, when it worked. */
  model?: Uint8Array;
  error?: string;
  /** True when the failure is NVIDIA's deployment, not the request. */
  upstreamBroken?: boolean;
}

/** The documented request body, for either endpoint. */
export function requestBody(
  input: { prompt?: string; imageDataUri?: string },
  options: TrellisOptions = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    output_format: 'glb',
    seed: options.seed ?? 0,
    slat_cfg_scale: options.cfgScale ?? 3,
    ss_cfg_scale: 7.5,
    slat_sampling_steps: options.samplingSteps ?? 25,
    ss_sampling_steps: options.samplingSteps ?? 25,
    ...(options.noTexture ? { no_texture: true } : {}),
  };

  // `mode` is not optional in practice: without it the service guesses, and a
  // request carrying both a prompt and an image is ambiguous.
  if (input.imageDataUri) {
    body.mode = 'image';
    body.image = input.imageDataUri;
  } else {
    body.mode = 'text';
    body.prompt = (input.prompt ?? '').slice(0, 600);
  }
  return body;
}

/** Turns a failure into something worth showing a user. */
export function trellisError(status: number, body: string, endpoint: string): TrellisResult {
  if (endpoint.startsWith(DEMO_ENDPOINT) || /Expected:\s*example_id/i.test(body)) {
    return {
      error:
        "NVIDIA's build.nvidia.com TRELLIS is a demo that only accepts their own sample images — it cannot take a prompt or an upload. Chomugiri uses the real NIM function instead.",
      upstreamBroken: true,
    };
  }
  if (status === 401 || status === 403) {
    return { error: 'NVIDIA rejected the key for TRELLIS. Check it in Settings → API Keys.' };
  }
  if (status === 404) {
    return { error: 'That TRELLIS endpoint does not exist. For a self-hosted container the URL is its base, not /v1/infer.' };
  }
  if (status === 422) {
    // Their own example image is refused here too, so this is not the caller's
    // payload however tempting it is to keep tuning it.
    return {
      error:
        "NVIDIA's hosted TRELLIS refused the image (422). Their own documented example image is refused the same way, so the deployment is not accepting image jobs right now. Add a Meshy or Tripo key, or self-host the NIM container.",
      upstreamBroken: true,
    };
  }
  if (status >= 500) {
    return {
      error:
        "NVIDIA's hosted TRELLIS accepted the job and then failed it (500). That is their deployment, not the request. Add a Meshy or Tripo key, or self-host the NIM container.",
      upstreamBroken: true,
    };
  }

  let detail = '';
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; title?: string };
    detail = typeof parsed.detail === 'string' ? parsed.detail : (parsed.title ?? '');
  } catch {
    // Not JSON.
  }
  return { error: detail ? `TRELLIS: ${detail}.` : `TRELLIS returned ${status}.` };
}

/** The .glb out of an Object3DResponse. */
export function modelFrom(json: unknown): { model?: Uint8Array; error?: string } {
  const artifacts = (json as { artifacts?: Array<Record<string, unknown>> })?.artifacts;
  const first = Array.isArray(artifacts) ? artifacts[0] : undefined;
  if (!first) return { error: 'TRELLIS answered without a model in it.' };

  const reason = String(first.finishReason ?? '').toUpperCase();
  if (reason === 'CONTENT_FILTERED') return { error: 'TRELLIS filtered that prompt. Try describing the object differently.' };
  if (reason && reason !== 'SUCCESS') return { error: `TRELLIS finished as ${reason}.` };

  const b64 = typeof first.base64 === 'string' ? first.base64 : '';
  if (!b64) return { error: 'TRELLIS reported success but returned no model.' };

  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { model: bytes };
}

/**
 * Generates a mesh.
 *
 * Handles both shapes at once: a self-hosted container answers `/v1/infer`
 * synchronously, while NVCF answers `202` with a request id to poll. Which one
 * happens is decided by the response, not by configuration, so pointing at your
 * own container needs nothing but the URL.
 */
export async function generateModel(
  input: { prompt?: string; imageDataUri?: string },
  apiKey: string,
  options: TrellisOptions = {},
): Promise<TrellisResult> {
  if (options.baseUrl?.startsWith(DEMO_ENDPOINT)) {
    return trellisError(422, 'Expected: example_id', DEMO_ENDPOINT);
  }

  const endpoint = options.baseUrl
    ? `${options.baseUrl.replace(/\/+$/, '').replace(/\/v1\/infer$/, '')}/v1/infer`
    : `${NVCF_INVOKE}/${NVCF_TRELLIS_FUNCTION}`;

  const deadline = Date.now() + (options.timeoutMs ?? 300_000);

  try {
    options.onProgress?.('Asking TRELLIS for a mesh…');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestBody(input, options)),
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 300_000),
    });

    if (res.status === 202) {
      const reqId = res.headers.get('nvcf-reqid');
      if (!reqId) return { error: 'TRELLIS queued the job but returned no request id to poll.' };
      return await pollNvcf(reqId, apiKey, deadline, options);
    }

    if (!res.ok) return trellisError(res.status, await res.text(), endpoint);
    return modelFrom(await res.json());
  } catch (err) {
    return { error: `Could not reach TRELLIS: ${(err as Error).message}` };
  }
}

/**
 * Waits on an NVCF job.
 *
 * The status route is long-polling: it holds the connection open and answers
 * 202 if the job is still running, so the loop needs no sleep of its own — and
 * adding one would only make a finished job sit unnoticed.
 */
async function pollNvcf(
  reqId: string,
  apiKey: string,
  deadline: number,
  options: TrellisOptions,
): Promise<TrellisResult> {
  for (let attempt = 1; ; attempt += 1) {
    if (Date.now() > deadline) {
      return { error: 'TRELLIS did not finish in time.' };
    }
    if (options.signal?.aborted) return { error: 'Cancelled.' };

    options.onProgress?.(`TRELLIS is generating… (check ${attempt})`);
    const res = await fetch(`${NVCF_STATUS}/${reqId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: options.signal ?? AbortSignal.timeout(Math.max(5_000, deadline - Date.now())),
    });

    if (res.status === 202) continue;
    if (!res.ok) return trellisError(res.status, await res.text(), NVCF_STATUS);
    return modelFrom(await res.json());
  }
}
