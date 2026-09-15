/**
 * Microsoft TRELLIS, through NVIDIA. Prompt or sample image in, a .glb out.
 *
 * Everything here was measured against the live API, and several of the rules
 * are the opposite of what the published NIM OpenAPI says — because that spec
 * describes the container, and NVIDIA's hosted deployment is not that container
 * with the same manners.
 *
 * ── The four rules that decide whether a call works ─────────────────────────
 *
 * 1. **`prompt` and nothing else.** Adding `seed`, `mode`, `output_format` or
 *    any sampler setting does not get a validation error — it gets a 500.
 *    The documented `Object3DRequest` fields are exactly what breaks it.
 *
 * 2. **No charset on the content type.** NVIDIA answers
 *    `415 Unsupported media type: application/json; charset=utf-8. It must be
 *    application/json`. Most HTTP clients append one for you; `fetch` with a
 *    string body does not, which is why the header is set explicitly here.
 *
 * 3. **Failures are slow, successes are fast.** A good call answers in 12-20s;
 *    a bad one stalls about 90 seconds and then 500s. So the per-attempt
 *    timeout is deliberately short — it turns a long dead wait into another
 *    attempt, which is what actually produces a model.
 *
 * 4. **Success is capacity, not correctness.** The identical body fails and
 *    then works. So the strategy is rounds of two racing requests, taking
 *    whichever lands first. Two per round, not more: more made the service
 *    refuse far more often.
 *
 * ── The endpoint, and the one that looks like it ────────────────────────────
 *
 * `ai.api.nvidia.com/v1/genai/microsoft/trellis` is the one that works. The
 * NVCF `pexec/functions/{id}` route reaches the same model and accepts the
 * documented payload, but every job submitted there has failed.
 *
 * ── Images ──────────────────────────────────────────────────────────────────
 *
 * Only NVIDIA's bundled sample is accepted, as
 * `{"image":"data:image/png;example_id,0"}`. Your own photo is refused however
 * it is sent — inline base64 and a properly uploaded NVCF asset both answer
 * `422 Expected: example_id`. The upload half genuinely works; TRELLIS just
 * will not take the result.
 *
 * ── Service status ──────────────────────────────────────────────────────────
 *
 * As of 2026-09-15 the endpoint 500s for everything, text and its own sample
 * alike, on every attempt — twelve racing attempts in a row, and the same with
 * the documented NVCF payload. That is NVIDIA's deployment, not this client:
 * FLUX answered 200 in 4.2 seconds on the same key in the same minute. Nothing
 * here works around it, and nothing here needs to change when they fix it.
 */

export const TRELLIS_URL = 'https://ai.api.nvidia.com/v1/genai/microsoft/trellis';
export const NVCF_ASSETS = 'https://api.nvcf.nvidia.com/v2/nvcf/assets';
export const NVCF_STATUS = 'https://api.nvcf.nvidia.com/v2/nvcf/pexec/status';

/** The only image input the hosted deployment accepts. */
export const SAMPLE_IMAGE = 'data:image/png;example_id,0';

/** Mesh density, steered through the prompt — there is no parameter for it. */
export type Detail = 'low' | 'standard' | 'high';

const DETAIL_HINT: Record<Detail, string> = {
  low: 'low poly, simplified geometry, flat shaded, game asset',
  // Asking for exactly one complete, textured object cuts down the results
  // that come back missing a part or with no texture at all.
  standard: 'a single complete object, fully textured, clean geometry, plain background',
  high: 'highly detailed, intricate surface detail, fully textured, single object',
};

export interface TrellisOptions {
  /** A self-hosted NIM container, which takes the documented payload at /v1/infer. */
  baseUrl?: string;
  detail?: Detail;
  /** Rounds of two racing requests. Twelve attempts by default. */
  rounds?: number;
  /** Cut off well below the ~90s a failing call stalls for. */
  attemptMs?: number;
  /**
   * Keep asking until a model comes back or this many milliseconds have gone,
   * whichever is first. `rounds` is ignored while this is set.
   *
   * There is no truly unbounded version of this and there should not be: a
   * deployment that answers 500 in four seconds would spin the loop forever
   * without ever producing a model, and the build it belongs to would never
   * finish. A budget is the honest shape of "keep trying" — make it an hour if
   * an hour is what the model is worth.
   */
  budgetMs?: number;
  /** Seconds to wait between rounds when persisting. Backs off to a minute. */
  pauseMs?: number;
  onProgress?: (note: string) => void;
  signal?: AbortSignal;
}

export interface TrellisResult {
  model?: Uint8Array;
  error?: string;
  /** True when the failure is NVIDIA's deployment rather than the request. */
  upstreamBroken?: boolean;
  /** How many requests it took, so a slow success is visible as one. */
  attempts?: number;
}

/**
 * The request body.
 *
 * Deliberately minimal: `prompt` alone, or `image` alone. Every extra field
 * that the published schema documents is a field that makes this 500.
 */
export function requestBody(input: { prompt?: string; sampleImage?: boolean }, options: TrellisOptions = {}): string {
  if (input.sampleImage) return JSON.stringify({ image: SAMPLE_IMAGE });
  const hint = DETAIL_HINT[options.detail ?? 'standard'];
  return JSON.stringify({ prompt: `${(input.prompt ?? '').slice(0, 500)}, ${hint}` });
}

/**
 * Headers.
 *
 * `Content-Type` is written without a charset on purpose — with one NVIDIA
 * answers 415 and names the exact string it wanted.
 */
export function headersFor(apiKey: string, assetId?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    // Asks the gateway to hold the connection rather than handing back a 202
    // to poll, which is simpler and usually faster.
    'NVCF-POLL-SECONDS': '300',
    ...(assetId ? { 'NVCF-INPUT-ASSET-REFERENCES': assetId } : {}),
  };
}

/** Turns a failure into something worth showing a user. */
export function trellisError(status: number, body: string): TrellisResult {
  if (/Expected:\s*example_id/i.test(body)) {
    return {
      error:
        'NVIDIA\'s TRELLIS will not take an uploaded image — only its own bundled sample. Your photo reached them fine; they refused it.',
      upstreamBroken: true,
    };
  }
  if (status === 415) {
    // Only reachable if something rewrites the header on the way out.
    return { error: 'NVIDIA refused the content type. It must be exactly "application/json", with no charset.' };
  }
  if (status === 401 || status === 403) {
    return { error: 'NVIDIA rejected the key for TRELLIS. Check it in Settings → API Keys.' };
  }
  if (status === 404) {
    return { error: 'That TRELLIS endpoint does not exist. For a self-hosted container the URL is its base, not /v1/infer.' };
  }
  if (status === 429) return { error: 'NVIDIA is rate limiting TRELLIS. Waiting a minute usually clears it.' };
  if (status >= 500) {
    return {
      error:
        'NVIDIA\'s TRELLIS is failing its own jobs (500). Not the key and not the request — FLUX works on the same key. Add a Meshy or Tripo key, or self-host the NIM container.',
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

/** The .glb out of the response. */
export function modelFrom(json: unknown): { model?: Uint8Array; error?: string } {
  const artifacts = (json as { artifacts?: Array<Record<string, unknown>> })?.artifacts;
  const first = Array.isArray(artifacts) ? artifacts[0] : undefined;
  if (!first) return { error: 'TRELLIS answered without a model in it.' };

  const reason = String(first.finishReason ?? '').toUpperCase();
  if (reason === 'CONTENT_FILTERED') return { error: 'TRELLIS filtered that prompt. Describe the object differently.' };
  if (reason && reason !== 'SUCCESS') return { error: `TRELLIS finished as ${reason}.` };

  const b64 = typeof first.base64 === 'string' ? first.base64 : '';
  if (!b64) return { error: 'TRELLIS reported success but returned no model.' };

  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { model: bytes };
}

/** One attempt. A 202 means queued, so it polls; anything else is the answer. */
async function attempt(
  url: string,
  body: string,
  apiKey: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TrellisResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: headersFor(apiKey),
    body,
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });

  if (res.status === 202) {
    const reqId = res.headers.get('nvcf-reqid');
    if (!reqId) return { error: 'TRELLIS queued the job but returned no request id.' };
    return await poll(reqId, apiKey, signal);
  }
  if (!res.ok) return trellisError(res.status, await res.text());
  return modelFrom(await res.json());
}

/** Waits on a queued job. The status route long-polls, so this needs no sleep. */
async function poll(reqId: string, apiKey: string, signal?: AbortSignal): Promise<TrellisResult> {
  for (let i = 1; i <= 6; i += 1) {
    const res = await fetch(`${NVCF_STATUS}/${reqId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: signal ?? AbortSignal.timeout(120_000),
    });
    if (res.status === 202) continue;

    // A 5xx here means two things: with `nvcf-status: errored` the job is dead,
    // without it the gateway stumbled and the job may still be running.
    if (res.status >= 500 && res.headers.get('nvcf-status') !== 'errored' && i < 4) continue;
    if (!res.ok) return trellisError(res.status, await res.text());
    return modelFrom(await res.json());
  }
  return { error: 'TRELLIS queued the job and never finished it.' };
}

/**
 * Generates a mesh, racing two requests a round.
 *
 * Whether a call succeeds is capacity on NVIDIA's side rather than anything
 * about the request, so the way to get a model is to ask again — quickly,
 * because a failing attempt would otherwise hold the line for ninety seconds.
 */
/** A cancellable pause. Rejecting on abort would make every caller catch it. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

export async function generateModel(
  input: { prompt?: string; sampleImage?: boolean },
  apiKey: string,
  options: TrellisOptions = {},
): Promise<TrellisResult> {
  const url = options.baseUrl
    ? `${options.baseUrl.replace(/\/+$/, '').replace(/\/v1\/infer$/, '')}/v1/infer`
    : TRELLIS_URL;
  const body = requestBody(input, options);
  const attemptMs = options.attemptMs ?? 45_000;
  const budgetMs = options.budgetMs;
  // A budget replaces the round count rather than capping it: "until it works"
  // is a deadline, not a number of tries.
  const rounds = budgetMs ? Number.MAX_SAFE_INTEGER : options.rounds ?? 6;
  const deadline = budgetMs ? Date.now() + budgetMs : Infinity;

  let last: TrellisResult = { error: 'TRELLIS was never reached.' };
  let tried = 0;

  for (let round = 1; round <= rounds; round += 1) {
    if (options.signal?.aborted) return { error: 'Cancelled.', attempts: tried };
    if (Date.now() >= deadline) break;
    options.onProgress?.(
      budgetMs
        ? `Asking TRELLIS (round ${round}, ${Math.ceil((deadline - Date.now()) / 60_000)} min left)…`
        : `Asking TRELLIS (round ${round} of ${rounds})…`,
    );

    // Two lanes, and the first real model wins. A rejected lane must not settle
    // the round while the other is still going, so failures resolve to null and
    // are only counted once both are in.
    const lanes = [0, 1].map(async () => {
      tried += 1;
      try {
        return await attempt(url, body, apiKey, attemptMs, options.signal);
      } catch (err) {
        const message = (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError'
          ? 'That attempt stalled, which is what a failing TRELLIS call does.'
          : `Could not reach TRELLIS: ${(err as Error).message}`;
        return { error: message } as TrellisResult;
      }
    });

    const results = await Promise.all(lanes);
    const won = results.find((r) => r.model);
    if (won) return { ...won, attempts: tried };
    last = results.find((r) => r.error && !/stalled/.test(r.error)) ?? results[0];

    // Hammering a deployment that is down helps nobody and gets the key rate
    // limited. Backs off from the given pause up to a minute between rounds.
    if (budgetMs && Date.now() < deadline) {
      const pause = Math.min(60_000, (options.pauseMs ?? 5_000) * Math.min(round, 12));
      await sleep(Math.min(pause, deadline - Date.now()), options.signal);
    }
  }

  return {
    ...last,
    attempts: tried,
    ...(budgetMs ? { error: `${last.error ?? 'TRELLIS did not answer.'} Gave up after ${tried} attempts.` } : {}),
  };
}
