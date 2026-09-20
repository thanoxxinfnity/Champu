/**
 * Meshy AI: a second optional generator, and the only one that auto-rigs.
 *
 * Tripo and Meshy do the same job — a prompt in, a .glb out — but Meshy also
 * exposes a rigging endpoint, which turns a generated mesh into something with
 * a skeleton. That is worth having: `rig.ts` can only rig geometry *we* built,
 * because it knows where the boxes are. A mesh that arrived from a generator is
 * an opaque blob of triangles, and nothing local can find its shoulders.
 *
 * Like Tripo, this is a job queue: the call returns a task id and the model
 * appears minutes later. And like Tripo it is optional — no key means the
 * code-built rigged model, which needs no network and cannot fail.
 *
 * Routes verified against the live API. Each answers
 * `401 {"message":"Missing API key"}` with no key and
 * `401 {"message":"Invalid API key"}` with a bearer, which is how we know they
 * route rather than falling through to a catch-all:
 *   POST/GET https://api.meshy.ai/openapi/v2/text-to-3d[/{id}]
 *   POST/GET https://api.meshy.ai/openapi/v1/rigging[/{id}]
 *
 * The response *shapes* could not be verified without a paid key, so the
 * readers below accept several spellings rather than one. That is deliberate:
 * guessing one and being wrong fails at the worst moment — after the user has
 * paid for a generation that actually succeeded.
 */

const MESHY_BASE = 'https://api.meshy.ai/openapi';

/** Which queue a task belongs to; they are polled at different paths. */
export type MeshyKind = 'text-to-3d' | 'rigging';

export interface MeshyResult {
  status: 'queued' | 'running' | 'done' | 'failed';
  /** Present once done: a URL the .glb can be downloaded from. */
  modelUrl?: string;
  /** Present on a finished rigging task, which returns both. */
  riggedUrl?: string;
  progress?: number;
  error?: string;
}

function pathFor(kind: MeshyKind): string {
  return kind === 'rigging' ? `${MESHY_BASE}/v1/rigging` : `${MESHY_BASE}/v2/text-to-3d`;
}

/** Meshy's error envelope, in words worth showing. */
export function meshyError(status: number, body: string): string {
  let message = '';
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: string };
    message = parsed.message ?? parsed.error ?? '';
  } catch {
    // Not JSON — an HTML body here means a proxy or a firewall, not Meshy.
  }

  // Both spellings are real: "Missing API key" with no header, "Invalid API
  // key" with a bad one. Neither is worth repeating verbatim to a user who
  // needs to know where the key goes.
  if (status === 401) {
    return 'Meshy rejected the API key. Open Settings → API Keys and paste the one from meshy.ai.';
  }
  if (status === 402) {
    return 'Meshy is out of credits. Top up at meshy.ai, or clear the key to use the built-in model instead.';
  }
  if (status === 429) return 'Meshy is rate limiting. Waiting and retrying usually clears it.';
  return message ? `Meshy: ${message}.` : `Meshy returned ${status}.`;
}

/**
 * The task id out of a create response.
 *
 * Meshy documents `{ "result": "<id>" }`. Other ids in the same API are spelled
 * `id` or `task_id`, and some responses wrap everything in `data`, so all of
 * them are accepted — a create that succeeded and then read as a failure is the
 * expensive kind of wrong.
 */
export function taskIdFrom(json: unknown): string | null {
  if (typeof json === 'string' && json) return json;
  if (!json || typeof json !== 'object') return null;

  const obj = json as Record<string, unknown>;
  for (const source of [obj, obj.data as Record<string, unknown> | undefined]) {
    if (!source || typeof source !== 'object') continue;
    for (const key of ['result', 'id', 'task_id', 'taskId']) {
      const value = source[key];
      if (typeof value === 'string' && value) return value;
    }
  }
  return null;
}

/** A .glb URL out of whichever bag of formats the response used. */
function glbFrom(source: Record<string, unknown> | undefined): string | undefined {
  if (!source) return undefined;
  for (const key of ['model_urls', 'rigged_model_urls', 'modelUrls']) {
    const urls = source[key];
    if (urls && typeof urls === 'object') {
      const glb = (urls as Record<string, unknown>).glb;
      if (typeof glb === 'string' && glb) return glb;
    }
  }
  for (const key of ['model_url', 'glb_url', 'modelUrl']) {
    const value = source[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/**
 * Reads a poll response.
 *
 * Meshy reports status in capitals — PENDING, IN_PROGRESS, SUCCEEDED, FAILED,
 * CANCELED — which is worth normalising here so callers do not compare strings
 * against the wrong case and treat every task as still running forever.
 */
export function resultFrom(json: unknown): MeshyResult {
  if (!json || typeof json !== 'object') return { status: 'failed', error: 'Meshy returned nothing.' };

  const body = json as Record<string, unknown>;
  const data = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, unknown>;

  const status = String(data.status ?? '').toUpperCase();
  const progress = typeof data.progress === 'number' ? data.progress : undefined;

  // A rigging task nests its output under `result`; text-to-3d puts it at the
  // top level. Look in both rather than branching on the kind, which the
  // caller would then have to keep in sync.
  const nested = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : undefined;
  const rigged = glbFrom(nested && { rigged_model_urls: nested.rigged_model_urls }) ?? glbFrom(nested);
  const modelUrl = glbFrom(data) ?? rigged;

  if (status === 'SUCCEEDED') {
    return modelUrl
      ? { status: 'done', modelUrl, ...(rigged ? { riggedUrl: rigged } : {}), progress: 100 }
      : { status: 'failed', error: 'Meshy reported success but returned no model URL.' };
  }
  if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
    const taskError = data.task_error;
    const detail =
      taskError && typeof taskError === 'object' && typeof (taskError as { message?: unknown }).message === 'string'
        ? `: ${(taskError as { message: string }).message}`
        : '';
    return { status: 'failed', error: `Meshy task ${status.toLowerCase()}${detail}.`, progress };
  }
  if (status === 'IN_PROGRESS') return { status: 'running', progress };
  return { status: 'queued', progress };
}

async function post(apiKey: string, url: string, body: unknown, signal?: AbortSignal) {
  // `signal ?? AbortSignal.timeout(...)` drops the deadline entirely the
  // moment a caller signal exists, leaving a stalled request uncancellable
  // except by the caller's own signal firing.
  const timeout = AbortSignal.timeout(30_000);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  return { res, text: await res.text() };
}

/**
 * Starts a text-to-3D job.
 *
 * `preview` is the first of Meshy's two stages and the one that produces usable
 * geometry; `refine` adds texture on top and costs again. Preview is what a
 * game character needs, so that is what this asks for.
 */
export async function startTextToModel(
  apiKey: string,
  prompt: string,
  options: { artStyle?: 'realistic' | 'sculpture'; polycount?: number; signal?: AbortSignal } = {},
): Promise<{ taskId?: string; error?: string }> {
  try {
    const { res, text } = await post(
      apiKey,
      pathFor('text-to-3d'),
      {
        mode: 'preview',
        prompt: prompt.slice(0, 600),
        art_style: options.artStyle ?? 'realistic',
        should_remesh: true,
        // Quads rig and deform far better than an unstructured triangle soup,
        // and this mesh is going straight into a rigging job.
        topology: 'quad',
        target_polycount: options.polycount ?? 30_000,
      },
      options.signal,
    );

    if (!res.ok) return { error: meshyError(res.status, text) };
    const taskId = taskIdFrom(JSON.parse(text) as unknown);
    return taskId ? { taskId } : { error: 'Meshy accepted the job but returned no task id.' };
  } catch (err) {
    return { error: `Could not reach Meshy: ${(err as Error).message}` };
  }
}

/**
 * Rigs a finished text-to-3D task.
 *
 * This is the reason Meshy is here at all. `character_height` is in metres and
 * sets the scale the skeleton is fitted to — leaving it at a default that does
 * not match the mesh produces a skeleton inside the wrong body.
 */
export async function startRigging(
  apiKey: string,
  inputTaskId: string,
  options: { heightMetres?: number; signal?: AbortSignal } = {},
): Promise<{ taskId?: string; error?: string }> {
  try {
    const { res, text } = await post(
      apiKey,
      pathFor('rigging'),
      { input_task_id: inputTaskId, character_height: options.heightMetres ?? 1.7 },
      options.signal,
    );

    if (!res.ok) return { error: meshyError(res.status, text) };
    const taskId = taskIdFrom(JSON.parse(text) as unknown);
    return taskId ? { taskId } : { error: 'Meshy accepted the rigging job but returned no task id.' };
  } catch (err) {
    return { error: `Could not reach Meshy: ${(err as Error).message}` };
  }
}

/** Reads a job's current state. */
export async function pollTask(
  apiKey: string,
  kind: MeshyKind,
  taskId: string,
  signal?: AbortSignal,
): Promise<MeshyResult> {
  try {
    const timeout = AbortSignal.timeout(30_000);
    const res = await fetch(`${pathFor(kind)}/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await res.text();
    if (!res.ok) return { status: 'failed', error: meshyError(res.status, text) };
    return resultFrom(JSON.parse(text) as unknown);
  } catch (err) {
    return { status: 'failed', error: `Could not reach Meshy: ${(err as Error).message}` };
  }
}

/**
 * Waits for a job, within a budget.
 *
 * Bounded rather than open-ended: generation takes minutes and the caller has a
 * code-built model to fall back on, so a run that stalls should give up and
 * produce something rather than hang.
 */
export async function waitForTask(
  apiKey: string,
  kind: MeshyKind,
  taskId: string,
  options: { timeoutMs?: number; onProgress?: (result: MeshyResult) => void; signal?: AbortSignal } = {},
): Promise<MeshyResult> {
  const deadline = Date.now() + (options.timeoutMs ?? 300_000);
  let wait = 3_000;

  for (;;) {
    const result = await pollTask(apiKey, kind, taskId, options.signal);
    options.onProgress?.(result);

    if (result.status === 'done' || result.status === 'failed') return result;
    if (options.signal?.aborted) return { status: 'failed', error: 'Cancelled.' };
    if (Date.now() > deadline) {
      return {
        status: 'failed',
        error: 'Meshy did not finish in time. The job may still complete — check it at meshy.ai.',
        progress: result.progress,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, wait));
    // Backs off, but never so far that a finished job sits unnoticed.
    wait = Math.min(wait * 1.5, 15_000);
  }
}

/**
 * Prompt to rigged .glb URL, both stages.
 *
 * Rigging is attempted and not required: if it fails the unrigged mesh is still
 * a perfectly good prop, and returning it beats failing the whole build.
 */
export async function generateRiggedModel(
  apiKey: string,
  prompt: string,
  options: {
    heightMetres?: number;
    timeoutMs?: number;
    onProgress?: (stage: 'modelling' | 'rigging', result: MeshyResult) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ modelUrl?: string; rigged: boolean; error?: string; warning?: string }> {
  const started = await startTextToModel(apiKey, prompt, { signal: options.signal });
  if (!started.taskId) return { rigged: false, error: started.error };

  const model = await waitForTask(apiKey, 'text-to-3d', started.taskId, {
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    onProgress: (r) => options.onProgress?.('modelling', r),
  });
  if (model.status !== 'done' || !model.modelUrl) return { rigged: false, error: model.error };

  const rigging = await startRigging(apiKey, started.taskId, {
    heightMetres: options.heightMetres,
    signal: options.signal,
  });
  if (!rigging.taskId) {
    return { modelUrl: model.modelUrl, rigged: false, warning: rigging.error };
  }

  const rigged = await waitForTask(apiKey, 'rigging', rigging.taskId, {
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    onProgress: (r) => options.onProgress?.('rigging', r),
  });
  if (rigged.status !== 'done' || !rigged.modelUrl) {
    return { modelUrl: model.modelUrl, rigged: false, warning: rigged.error };
  }

  return { modelUrl: rigged.modelUrl, rigged: true };
}
