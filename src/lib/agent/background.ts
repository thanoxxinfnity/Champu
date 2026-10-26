'use client';

/**
 * Background messages: a reply the terminal bridge writes while the app is closed, waiting in an inbox until the user comes back.
 *
 * Sending: the message is saved into its conversation like any other, together with an empty reply that says "working on the terminal", and the
 * model call is handed to the bridge as a job (providers/recipe.ts). From then on the app can be closed, swiped away or killed by the phone.
 * Receiving: whenever the app opens, the bridge comes back online or the tab becomes visible, `syncJobs` lists the bridge's jobs, fills the
 * waiting reply of each one that ended (text, files, usage), shows one notification and tells the bridge to forget it. While the app is open a
 * running job's answer streams into its bubble from the bridge's copy.
 *
 * What it cannot do: commands. A background reply is one model answer — files and explanations land, but the run-a-command-and-read-the-result
 * loop needs the app, so commands in the reply are shown and wait.
 */

import { appendMessage, createSession, getSession, listMessages, getSetting, setSetting, titleFromInput, touchSession, uid, upsertArtifact } from '@/lib/db/history';
import { buildUserContent } from '@/lib/agent/runtime';
import { extractArtifacts, filesOf } from '@/lib/agent/artifacts';
import { buildSystemPrompt } from '@/lib/agent/system-prompt';
import { classifyLocal } from '@/lib/agent/router';
import { hasJobs } from '@/lib/bridge/update';
import type { JobDetail, JobSummary } from '@/lib/bridge/client';
import { candidatesFor } from '@/lib/providers/chat-client';
import { endpointConfigFor } from '@/lib/providers/endpoint-models';
import { recipesFor } from '@/lib/providers/recipe';
import type { ChatMessage } from '@/lib/providers/types';
import { notifyDone } from '@/lib/notify';
import { useWorkspace, type ChatAttachment } from '@/lib/store';
import type { SuiteId } from '@/lib/db/schema';

export const BG_SETTING = 'backgroundMode';
export const NTFY_SETTING = 'ntfyTopic';

/** Can this terminal take a background job right now? */
export function bridgeTakesJobs(): boolean {
  const { heartbeat } = useWorkspace.getState();
  return (heartbeat.status === 'online' || heartbeat.status === 'degraded') && hasJobs(heartbeat.health);
}

export type BackgroundResult = { ok: true; jobId: string } | { ok: false; reason: string };

/** Hands one message to the terminal. `reason` says (in plain words) why it could not, and the caller then sends it the usual way. */
export async function sendInBackground(opts: { input: string; attachments?: ChatAttachment[]; suite: SuiteId; sessionId?: string | null; forceLane?: 'A' | 'B' }): Promise<BackgroundResult> {
  const st = useWorkspace.getState();
  const input = opts.input.trim();
  const attachments = opts.attachments ?? [];
  if (!input && !attachments.length) return { ok: false, reason: 'Nothing to send.' };
  if (!bridgeTakesJobs()) return { ok: false, reason: 'The terminal is not connected, or it is too old for background work (it needs bridge 1.3.0).' };

  const selection = st.selection;
  const custom = endpointConfigFor(st.endpoints, selection);
  const lane = opts.forceLane ?? classifyLocal(input, { hasAttachments: attachments.length > 0 }).lane;

  let sessionId = opts.sessionId ?? st.sessionId;
  const history: ChatMessage[] = [];
  if (sessionId) {
    const live = st.sessionId === sessionId ? st.messages : (await listMessages(sessionId)).filter((m) => m.role !== 'tool');
    for (const m of live.filter((x) => !x.error && x.content.trim()).slice(-10)) history.push({ role: m.role === 'system' ? 'system' : (m.role as 'user' | 'assistant'), content: m.content });
  }
  const system = buildSystemPrompt({
    lane,
    suite: opts.suite,
    bridgeStatus: 'offline',
    bridgeDetail: 'This reply is being written in the background while the user is away. Commands cannot run until they return: give the finished files and a clear explanation instead of command steps.',
    attachments: attachments.map((a) => ({ name: a.name, kind: a.kind, bytes: a.bytes })),
  });
  const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history, { role: 'user', content: buildUserContent(input, attachments) }];
  const base = { provider: selection.provider, model: selection.model, messages, custom };
  const recipes = recipesFor(candidatesFor(base), messages, { maxTokens: 8192 });
  if (!recipes.length) return { ok: false, reason: 'This model cannot run in the background (NVIDIA NIM keeps its key on the server). Pick a free provider or your own endpoint.' };

  if (!sessionId) {
    const made = await createSession(opts.suite, titleFromInput(input), { provider: selection.provider, model: selection.model });
    sessionId = made.id;
    useWorkspace.getState().setSessionId(sessionId);
  }

  const now = Date.now();
  const userId = uid('msg');
  const assistantId = uid('msg');
  const jobId = `bg-${uid('j')}`.replace(/[^\w-]/g, '');
  const live = useWorkspace.getState();
  const showHere = live.sessionId === sessionId;
  const userMessage = { id: userId, role: 'user' as const, content: input, createdAt: now, attachments, lane };
  if (showHere) {
    live.pushMessage(userMessage);
    live.pushMessage({ id: assistantId, role: 'assistant', content: '', streaming: true, createdAt: now + 1, lane, background: jobId, model: selection.model, provider: selection.provider });
  }
  await appendMessage({ ...userMessage, sessionId, suite: opts.suite });
  // The waiting reply is stored too, so a reload shows "working on the terminal" instead of nothing.
  await appendMessage({ id: assistantId, role: 'assistant', content: '', createdAt: now + 1, sessionId, suite: opts.suite, lane, model: selection.model, provider: selection.provider, background: jobId });

  const topic = await getSetting<string>(NTFY_SETTING, '');
  const session = await getSession(sessionId);
  try {
    await useWorkspace.getState().bridge.createJob({
      id: jobId,
      meta: { sessionId, assistantId, userId, suite: opts.suite, lane, title: session?.title ?? titleFromInput(input), model: selection.model, provider: selection.provider, startedAt: now },
      recipes,
      ntfy: topic || undefined,
    });
  } catch (err) {
    const reason = (err as Error).message;
    await failWaiting(sessionId, assistantId, `Could not hand this to the terminal: ${reason}`);
    return { ok: false, reason };
  }
  void syncJobs();
  return { ok: true, jobId };
}

async function failWaiting(sessionId: string, assistantId: string, message: string): Promise<void> {
  const { updateMessage } = await import('@/lib/db/history');
  await updateMessage(assistantId, { error: message, background: undefined });
  const st = useWorkspace.getState();
  if (st.sessionId === sessionId) st.patchMessage(assistantId, { streaming: false, error: message, background: undefined });
}

// ── Receiving ────────────────────────────────────────────────────────────────

const taken = new Set<string>();
let syncing = false;

/** The ids of jobs known to still be running (so the inbox hook knows whether to poll fast). */
export let runningJobs = 0;

/**
 * Looks at the terminal's jobs. Returns how many were taken into conversations in this pass.
 * Safe to call as often as you like: one pass at a time, a job is taken once.
 */
export async function syncJobs(): Promise<number> {
  if (syncing || !bridgeTakesJobs()) return 0;
  syncing = true;
  let imported = 0;
  try {
    const bridge = useWorkspace.getState().bridge;
    const { jobs } = await bridge.jobs();
    runningJobs = jobs.filter((j) => j.status === 'running').length;
    const finished: JobSummary[] = [];
    for (const job of jobs) {
      if (!job.meta?.sessionId || !job.meta.assistantId) continue;
      if (job.status === 'running') await showProgress(job);
      else if (!taken.has(job.id)) finished.push(job);
    }
    const done: string[] = [];
    for (const job of finished) {
      taken.add(job.id);
      try {
        if (await takeIn(await bridge.job(job.id))) imported++;
        done.push(job.id);
      } catch (err) {
        console.warn('background: could not take in job', job.id, err);
        taken.delete(job.id); // try again next time
      }
    }
    if (done.length) await bridge.ackJobs(done).catch(() => undefined);
  } catch {
    // The bridge went away mid-pass; the next one will look again.
  } finally {
    syncing = false;
  }
  return imported;
}

/** A running job of the conversation on screen: its answer so far goes into the waiting bubble. */
async function showProgress(job: JobSummary): Promise<void> {
  const st = useWorkspace.getState();
  const meta = job.meta!;
  if (st.sessionId !== meta.sessionId || job.chars === 0) return;
  const detail = await st.bridge.job(job.id).catch(() => null);
  if (!detail) return;
  if (!useWorkspace.getState().messages.some((m) => m.id === meta.assistantId)) {
    useWorkspace.getState().pushMessage({ id: meta.assistantId, role: 'assistant', content: '', streaming: true, createdAt: job.startedAt + 1, background: job.id });
  }
  useWorkspace.getState().patchMessage(meta.assistantId, { content: detail.content, reasoning: detail.reasoning || undefined, streaming: true, background: job.id });
}

/** Puts a finished job's answer into its conversation. Returns false when the conversation no longer exists. */
async function takeIn(job: JobDetail): Promise<boolean> {
  const meta = job.meta!;
  const session = await getSession(meta.sessionId);
  if (!session) return false;
  const suite = (meta.suite as SuiteId) ?? session.suite;
  const ok = job.status === 'done';
  const error = ok ? undefined : job.status === 'cancelled' ? 'Cancelled.' : job.error || 'The terminal could not finish this.';
  const content = job.content || '';

  // Files the reply wrote are saved to the conversation, and shown at once when it is open.
  const files = filesOf(extractArtifacts(content)).filter((f) => f.complete);
  for (const f of files) await upsertArtifact({ sessionId: meta.sessionId, suite, path: f.path, language: f.language, content: f.content, bytes: f.bytes });

  await appendMessage({
    id: meta.assistantId,
    role: 'assistant',
    content,
    reasoning: job.reasoning || undefined,
    createdAt: (meta.startedAt ?? job.startedAt) + 1,
    sessionId: meta.sessionId,
    suite,
    lane: meta.lane,
    model: meta.model,
    provider: meta.provider,
    usage: job.usage ?? undefined,
    durationMs: job.endedAt ? job.endedAt - job.startedAt : undefined,
    error,
    background: undefined,
  });
  await touchSession(meta.sessionId, {});

  const st = useWorkspace.getState();
  const here = st.sessionId === meta.sessionId;
  if (here) {
    if (!st.messages.some((m) => m.id === meta.assistantId)) st.pushMessage({ id: meta.assistantId, role: 'assistant', content: '', createdAt: job.startedAt + 1 });
    st.patchMessage(meta.assistantId, { content, reasoning: job.reasoning || undefined, streaming: false, error, background: undefined, usage: job.usage ?? undefined, durationMs: job.endedAt ? job.endedAt - job.startedAt : undefined });
    if (files.length && (st.slotSessionId === null || st.slotSessionId === meta.sessionId)) {
      st.setSlotOwner(meta.sessionId);
      for (const f of files) st.upsertFile(f);
    }
  }
  const topic = meta.title ?? session.title;
  st.pushNotice({ sessionId: meta.sessionId, suite, topic, status: ok ? 'done' : 'failed', title: ok ? 'reply ready' : 'background job failed', detail: ok ? `${content.length.toLocaleString()} characters${files.length ? ` · ${files.length} file${files.length === 1 ? '' : 's'}` : ''}` : error });
  void notifyDone(topic, ok ? 'Your reply is ready.' : `Could not finish: ${error}`);
  return true;
}

export async function setBackgroundMode(on: boolean): Promise<void> {
  await setSetting(BG_SETTING, on);
}
