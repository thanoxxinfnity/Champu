/**
 * Tripo AI, as an optional upgrade over code-built geometry.
 *
 * The floor of the 3D feature is `glb.ts`, which needs no key and cannot fail.
 * This sits above it for when a user wants something organic rather than boxy,
 * and it is deliberately shaped so its absence costs nothing: no key means the
 * code-built model, not a failed build.
 *
 * Tripo is a *job queue*, not a request/response API — the call returns a task
 * id and the model appears minutes later. Treating it as synchronous is the
 * obvious way to get this wrong.
 *
 * Verified against the live API: POST /v2/openapi/task with no key answers
 * `401 {"code":1002,"message":"Authentication failed"}`, which is how we know
 * the route and payload shape are right.
 */

const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';

export interface TripoTask {
  taskId: string;
}

export interface TripoResult {
  status: 'queued' | 'running' | 'done' | 'failed';
  /** Present once done: a URL the .glb can be downloaded from. */
  modelUrl?: string;
  progress?: number;
  error?: string;
}

/** Tripo's own error envelope, in words worth showing. */
export function tripoError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { code?: number; message?: string; suggestion?: string };
    if (parsed.message) {
      const suggestion = parsed.suggestion ? ` ${parsed.suggestion}` : '';
      // 1002 is specifically a bad or missing key, which is worth naming
      // rather than repeating Tripo's wording.
      if (parsed.code === 1002) {
        return `Tripo rejected the API key. Open Settings → API Keys and paste the one from platform.tripo3d.ai.${suggestion}`;
      }
      return `Tripo: ${parsed.message}.${suggestion}`;
    }
  } catch {
    // Not JSON; fall through to the status.
  }
  return `Tripo returned ${status}.`;
}

/** Reads a task id out of Tripo's create response. */
export function taskIdFrom(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const body = json as { data?: { task_id?: string } };
  return body.data?.task_id ?? null;
}

/**
 * Reads a poll response.
 *
 * Tripo reports `status` as one of queued/running/success/failed plus a
 * progress percentage, and puts the model under `output`, whose key has moved
 * between `pbr_model` and `model` across versions — both are accepted.
 */
export function resultFrom(json: unknown): TripoResult {
  if (!json || typeof json !== 'object') return { status: 'failed', error: 'Tripo returned nothing.' };

  const data = (json as { data?: Record<string, unknown> }).data;
  if (!data) return { status: 'failed', error: 'Tripo returned no task data.' };

  const status = String(data.status ?? '');
  const progress = typeof data.progress === 'number' ? data.progress : undefined;
  const output = (data.output ?? {}) as Record<string, unknown>;
  const modelUrl =
    (typeof output.pbr_model === 'string' && output.pbr_model) ||
    (typeof output.model === 'string' && output.model) ||
    undefined;

  if (status === 'success') {
    return modelUrl
      ? { status: 'done', modelUrl, progress: 100 }
      : { status: 'failed', error: 'Tripo reported success but returned no model URL.' };
  }
  if (status === 'failed' || status === 'cancelled' || status === 'banned') {
    return { status: 'failed', error: `Tripo task ${status}.`, progress };
  }
  if (status === 'running') return { status: 'running', progress };
  return { status: 'queued', progress };
}

/** Starts a text-to-3D job. Returns the task id to poll. */
export async function startTextToModel(
  apiKey: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ taskId?: string; error?: string }> {
  try {
    // `signal ?? AbortSignal.timeout(...)` drops the deadline the moment a
    // caller signal exists — a stall then has nothing to end it.
    const timeout = AbortSignal.timeout(30_000);
    const res = await fetch(`${TRIPO_BASE}/task`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'text_to_model', prompt: prompt.slice(0, 1024) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });

    const text = await res.text();
    if (!res.ok) return { error: tripoError(res.status, text) };

    const taskId = taskIdFrom(JSON.parse(text) as unknown);
    return taskId ? { taskId } : { error: 'Tripo accepted the job but returned no task id.' };
  } catch (err) {
    return { error: `Could not reach Tripo: ${(err as Error).message}` };
  }
}

/** Reads a job's current state. */
export async function pollTask(apiKey: string, taskId: string, signal?: AbortSignal): Promise<TripoResult> {
  try {
    const timeout = AbortSignal.timeout(30_000);
    const res = await fetch(`${TRIPO_BASE}/task/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await res.text();
    if (!res.ok) return { status: 'failed', error: tripoError(res.status, text) };
    return resultFrom(JSON.parse(text) as unknown);
  } catch (err) {
    return { status: 'failed', error: `Could not reach Tripo: ${(err as Error).message}` };
  }
}

/**
 * Waits for a job, within a budget.
 *
 * Generation takes minutes, so this is bounded and reports why it stopped
 * rather than hanging a run indefinitely — the caller can fall back to the
 * code-built model, which is the point of having one.
 */
export async function waitForModel(
  apiKey: string,
  taskId: string,
  options: { timeoutMs?: number; onProgress?: (result: TripoResult) => void; signal?: AbortSignal } = {},
): Promise<TripoResult> {
  const deadline = Date.now() + (options.timeoutMs ?? 300_000);
  let wait = 3_000;

  for (;;) {
    const result = await pollTask(apiKey, taskId, options.signal);
    options.onProgress?.(result);

    if (result.status === 'done' || result.status === 'failed') return result;
    if (Date.now() > deadline) {
      return {
        status: 'failed',
        error: 'Tripo did not finish in time. The job may still complete — check it at platform.tripo3d.ai.',
        progress: result.progress,
      };
    }
    if (options.signal?.aborted) return { status: 'failed', error: 'Cancelled.' };

    await new Promise((resolve) => setTimeout(resolve, wait));
    // Backs off, but never so far that a finished job sits unnoticed.
    wait = Math.min(wait * 1.5, 15_000);
  }
}
