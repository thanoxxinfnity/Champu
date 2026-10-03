'use client';

import { classifyLocal, wantsSite, type Classification } from './router';
import { liveSearchContext, needsLiveSearch, type LiveSearchResult } from './livesearch';
import { needsResearch, planResearch, runResearch, summarizeResearch, type ResearchReport } from './research';
import { getKeys, withKeys } from '@/lib/keys';
import { buildSystemPrompt } from './system-prompt';
import { heuristicPlan, parsePlan, PLANNER_PROMPT, planProgress, parkBridgeTasks, requiresBridge, type Plan } from './planner';
import { extractArtifacts, filesOf, commandsOf, languageForPath, mergeFiles, splitAtOpenBlock, type FileArtifact } from './artifacts';
import { repairResources } from '@/lib/suites/android/resources';
import { repairSite } from '@/lib/suites/site/lint';
import { isTruncated, MAX_CONTINUATIONS, MAX_NUDGES, planContinuation, planNudge } from './continuation';
import { looksTransient } from './transient';
import { describeFileWork, renderWorkLog, renderCommandLog, type CommandOutcome } from './worklog';
import { noticeTopic, shouldNotify } from './notify';
import { runFinished, runStarted } from '@/lib/shell/run-state';
import { advancePlan, NO_EVIDENCE, settleRemaining, type RunEvidence } from './progress';
import { buildPackExport, describeExport, detectPacks, missingGeometries, validatePacks } from '@/lib/suites/minecraft/pack';
import { bodyPlan, buildGeometry, inferPlan } from '@/lib/suites/minecraft/geometry';
import { planBrief, planGame, planSummary, playerParts } from '@/lib/suites/godot/plan';
import { buildGodotExport, describeExport as describeGodotExport, detectGodotProject, referencedResources, relativePath } from '@/lib/suites/godot/export';
import { buildProject } from '@/lib/suites/godot/project';
import { generateModel, pipelineStatement, sourceChain } from '@/lib/suites/godot/model-source';
import { creditsFile } from '@/lib/suites/godot/sketchfab';
import { describeProblems } from '@/lib/suites/godot/verify';
import { apkArtifact, glbArtifact, wavArtifact } from '@/lib/suites/godot/artifact';
import { buildApkOnBridge } from '@/lib/suites/godot/bridge-build';
import { buildWebOnBridge, describeBuild, keepPlayable } from '@/lib/suites/godot/web-export';
import { effect as sfxFor, toWav, track as musicTrack, type ScaleName } from '@/lib/suites/godot/audio';
import {
  RUNNER_THEMES,
  insistOnDetail,
  looksFlat,
  // Aliased: the Minecraft suite has its own texture planner, and two
  // different meanings of `plannedTextures` in one file is how the wrong one
  // gets called.
  plannedTextures as plannedGameTextures,
  texturePrompt as gameTexturePrompt,
} from '@/lib/suites/godot/textures';
import { plannedTextures, texturePrompt, textureArtifact, toPixelArt } from '@/lib/suites/minecraft/texture';
import type { ChatMessage, ProviderId, StreamFrame } from '@/lib/providers/types';
import type { CustomEndpointConfig } from '@/lib/providers/types';
import { useWorkspace, type ChatAttachment } from '@/lib/store';
import { describeCommand, openingPhrase, streamingPhrase } from './narrate.ts';
import { PLANNER_NIM_MODEL } from '@/lib/providers/registry';
import { endpointConfigFor } from '@/lib/providers/endpoint-models';
import { draftSystemSuffix, pickAngles } from './drafts';
import { scanForSecrets, hasBlockingSecret } from '@/lib/security/secrets';
import { appendMessage, createSession, listMessages, touchSession, upsertArtifact, recordRun, uid } from '@/lib/db/history';
import type { SuiteId } from '@/lib/db/schema';
import { BridgeOfflineError } from '@/lib/bridge/client';

/**
 * Client-side agent runtime.
 *
 * Owns the whole cycle: classify → plan → stream → extract artifacts → execute
 * terminal steps → record history. Keeping it in the browser means the to-do HUD,
 * terminal and file manager update from one source of truth without a server
 * round-trip per state change.
 */

export interface SendOptions {
  input: string;
  attachments?: ChatAttachment[];
  suite?: SuiteId;
  /** Overrides the lane classifier. */
  forceLane?: 'A' | 'B';
  custom?: CustomEndpointConfig;
  /** The session this message belongs to; defaults to the one on screen. */
  sessionId?: string;
}

interface StreamCallbacks {
  onDelta?: (delta: string, full: string) => void;
  onReasoning?: (delta: string, full: string) => void;
  onError?: (message: string) => void;
}

// ── Transport ───────────────────────────────────────────────────────────────

async function streamCompletion(
  body: {
    provider: ProviderId;
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    json?: boolean;
    custom?: CustomEndpointConfig;
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<{ content: string; reasoning: string; usage?: StreamFrame & { type: 'usage' }; error?: string; finishReason?: string }> {
  let content = '';
  let reasoning = '';
  let usage: (StreamFrame & { type: 'usage' }) | undefined;
  let error: string | undefined;
  let finishReason: string | undefined;

  let res: Response;
  try {
    // Same failure shape as complete(): a raw caller signal with no timeout
    // means a genuinely stuck connection (not the upstream provider erroring,
    // which the server route already bounds internally) never resolves or
    // rejects, and the whole chat run — the main path through this app — hangs
    // forever with nothing to catch. 300s matches the server route's own
    // maxDuration and openai-compat.ts's streamChat() default.
    const timeout = AbortSignal.timeout(300_000);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
    res = await fetch('/api/chat', withKeys({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }),
      signal: composed,
    }));
  } catch (err) {
    const message = (err as Error).name === 'AbortError' ? 'Run cancelled.' : `Gateway unreachable: ${(err as Error).message}`;
    callbacks.onError?.(message);
    return { content, reasoning, error: message };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    const message = payload.error ?? `Gateway returned ${res.status}.`;
    callbacks.onError?.(message);
    return { content, reasoning, error: message };
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const message = 'Gateway returned an empty stream.';
    callbacks.onError?.(message);
    return { content, reasoning, error: message };
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const SEP = /\r?\n\r?\n/g;
      for (;;) {
        SEP.lastIndex = 0;
        const match = SEP.exec(buffer);
        if (!match) break;
        const chunk = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);

        for (const line of chunk.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;

          let frame: StreamFrame;
          try {
            frame = JSON.parse(raw) as StreamFrame;
          } catch {
            continue;
          }

          switch (frame.type) {
            case 'delta':
              content += frame.delta;
              callbacks.onDelta?.(frame.delta, content);
              break;
            case 'reasoning':
              reasoning += frame.delta;
              callbacks.onReasoning?.(frame.delta, reasoning);
              break;
            case 'usage':
              usage = frame;
              break;
            case 'error':
              error = frame.message;
              callbacks.onError?.(frame.message);
              break;
            case 'done':
              // Kept: "length" is the provider saying the reply was cut off.
              if (frame.finishReason) finishReason = frame.finishReason;
              break;
            default:
              break;
          }
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      error = `Stream interrupted: ${(err as Error).message}`;
      callbacks.onError?.(error);
    }
  } finally {
    reader.releaseLock();
  }

  return { content, reasoning, usage, error, finishReason };
}

/** Single-shot completion for internal steps (planning, classification). */
async function complete(
  body: { provider: ProviderId; model: string; messages: ChatMessage[]; json?: boolean; custom?: CustomEndpointConfig; maxTokens?: number },
  signal?: AbortSignal,
): Promise<string> {
  // Same failure shape paintTexture() was fixed for: a stalled provider on a
  // non-streaming call had no timeout of its own, only the user's own Stop
  // button — so a hung planner call left the run stuck on "Decomposing into
  // atomic steps..." forever, with nothing to catch and fall back to
  // heuristicPlan(). Composed with the caller's signal so Stop still cuts a
  // slow-but-alive call short.
  const timeout = AbortSignal.timeout(45_000);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const res = await fetch('/api/chat', withKeys({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: false }),
    signal: composed,
  }));
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Gateway returned ${res.status}`);
  }
  const data = (await res.json()) as { content: string };
  return data.content;
}


/**
 * One texture from the image gateway.
 *
 * Returns null rather than throwing: a build wants a dozen of these and one
 * refusal should cost one surface, not the game. Falls through to Pollinations
 * on any NIM failure — a stalled/degraded NIM used to mean an unbounded
 * `fetch` with no fallback, so a dozen textures each hanging out to the
 * platform's own multi-minute ceiling looked to the user like one frozen step
 * for nearly two hours. A short per-attempt timeout, composed with the
 * caller's own abort signal so the stop button actually cuts a hung attempt
 * short, keeps that from happening again.
 */
async function paintTexture(
  prompt: string,
  seed: number,
  signal?: AbortSignal,
): Promise<{ dataUrl: string; bytes: number } | null> {
  for (const body of [
    { provider: 'nim', model: 'black-forest-labs/flux.1-dev', prompt, width: 1024, height: 1024, steps: 30, seed: seed % 1_000_000 },
    { provider: 'pollinations', prompt, width: 1024, height: 1024, seed: seed % 1_000_000 },
  ]) {
    try {
      const timeout = AbortSignal.timeout(45_000);
      const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const res = await fetch('/api/image', withKeys({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: composed,
      }));
      if (!res.ok) continue;

      const json = (await res.json()) as { images?: Array<{ dataUrl?: string }> };
      const dataUrl = json.images?.[0]?.dataUrl;
      if (!dataUrl) continue;

      // Base64 is 4 bytes per 3 of payload; near enough to judge whether the
      // image has any detail in it.
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      return { dataUrl, bytes: Math.round(b64.length * 0.75) };
    } catch {
      // One provider stalling or refusing is not both refusing.
    }
  }
  return null;
}

/**
 * A reference image for an image-to-3D generator.
 *
 * Pixal3D lifts an image into a mesh; it cannot read a prompt. This is the
 * first half of that chain, and it deliberately falls through to Pollinations,
 * which needs no key: a user whose only credential is a Kaggle token should
 * still get meshes, and refusing because there is no NVIDIA key would make the
 * free path depend on a paid one.
 */
async function referenceImage(prompt: string): Promise<Uint8Array | null> {
  for (const body of [
    { provider: 'nim', model: 'black-forest-labs/flux.1-dev', prompt, width: 1024, height: 1024, steps: 30 },
    { provider: 'pollinations', prompt, width: 1024, height: 1024 },
  ]) {
    try {
      // Same fix as paintTexture(): no signal at all meant a stalled provider
      // hung the Kaggle image-to-3D chain forever instead of falling through.
      const res = await fetch('/api/image', withKeys({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      }));
      if (!res.ok) continue;
      const json = (await res.json()) as { images?: Array<{ dataUrl?: string }> };
      const dataUrl = json.images?.[0]?.dataUrl;
      if (!dataUrl) continue;
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      if (bytes.byteLength > 1024) return bytes;
    } catch {
      // One provider refusing is not both refusing.
    }
  }
  return null;
}

// ── Thinking bubble ─────────────────────────────────────────────────────────

function startNarration(sessionId: string, lane: 'A' | 'B'): () => void {
  // One honest opening line; real stages (planning, researching, writing a named file, running a
  // command) replace it as they happen. No rotating filler: see narrate.ts.
  useWorkspace.getState().setThinking(true, openingPhrase(lane), sessionId);
  return () => useWorkspace.getState().setThinking(false, undefined, sessionId);
}

/** Says what stage a session's run is in — only when it changed, so the bubble does not flicker. */
function narrate(sessionId: string, phrase: string): void {
  const s = useWorkspace.getState();
  if (s.runs[sessionId] && s.thinkingBy[sessionId]?.phrase !== phrase) s.setThinking(true, phrase, sessionId);
}

// ── Message assembly ────────────────────────────────────────────────────────

function buildUserContent(input: string, attachments: ChatAttachment[]): ChatMessage['content'] {
  const images = attachments.filter((a) => a.dataUrl && a.kind.startsWith('image/'));
  const texts = attachments.filter((a) => a.text);

  const textBody = [
    input,
    ...texts.map((a) => `\n\n--- attached: ${a.name} (${a.kind}, ${a.bytes} bytes) ---\n${a.text!.slice(0, 80_000)}`),
    ...attachments
      .filter((a) => !a.text && !a.dataUrl)
      .map((a) => `\n\n[attached binary: ${a.name} (${a.kind}, ${a.bytes} bytes) — content not inlined]`),
  ].join('');

  // Multi-part content only when images are present; some endpoints choke on the
  // array form for text-only turns.
  if (!images.length) return textBody;

  return [
    { type: 'text' as const, text: textBody },
    ...images.map((a) => ({ type: 'image_url' as const, image_url: { url: a.dataUrl! } })),
  ];
}

/**
 * The conversation so far for one session. The live transcript is only the session on screen, so a run
 * in another session reads its own from storage.
 */
async function historyFor(sessionId: string, limit = 12): Promise<ChatMessage[]> {
  const live = useWorkspace.getState();
  const rows: Array<{ role: string; content: string; error?: unknown }> =
    live.sessionId === sessionId ? live.messages : (await listMessages(sessionId)).filter((m) => m.role !== 'tool');
  return rows
    .filter((m) => !m.error && m.content.trim())
    .slice(-limit)
    .map((m) => ({ role: m.role === 'system' ? ('system' as const) : (m.role as 'user' | 'assistant'), content: m.content }));
}

// ── Bridge execution ────────────────────────────────────────────────────────

interface ExecOutcome {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  skipped?: 'offline' | 'banned';
  message?: string;
}

/**
 * Run one command on the bridge with anti-loop protection.
 *
 * Three gates before anything executes: heartbeat, the ban list, and the
 * fingerprint precheck. A banned command never runs a second time — that is the
 * whole point of the guard.
 */
export async function executeCommand(
  command: string,
  opts: { cwd?: string; sessionId?: string; suite?: SuiteId; signal?: AbortSignal; /** Tell the thinking bubble — only for commands the run itself is executing. */ narrate?: boolean } = {},
): Promise<ExecOutcome> {
  const state = useWorkspace.getState();
  const { bridge, heartbeat, guard, appendTerminal, setRunningExecId, refreshFingerprints } = state;

  if (heartbeat.status !== 'online' && heartbeat.status !== 'degraded') {
    const message = `Terminal bridge is ${heartbeat.status}. Command parked: ${command}`;
    appendTerminal({ stream: 'system', text: `⏸  ${message}` });
    return { ok: false, exitCode: null, stdout: '', stderr: '', skipped: 'offline', message };
  }

  const precheck = guard.precheck('terminal', command);
  if (precheck?.action === 'halt') {
    appendTerminal({ stream: 'system', text: `⛔ ${precheck.message}\n   → ${precheck.directive}` });
    refreshFingerprints();
    return { ok: false, exitCode: null, stdout: '', stderr: '', skipped: 'banned', message: precheck.message };
  }

  appendTerminal({ stream: 'command', text: `$ ${command}` });
  if (opts.narrate && opts.sessionId) narrate(opts.sessionId, describeCommand(command));

  const startedAt = Date.now();
  try {
    const { execId } = await bridge.exec(command, { cwd: opts.cwd });
    setRunningExecId(execId);

    let stdout = '';
    let stderr = '';

    const outcome = await bridge.stream(
      execId,
      (frame) => {
        if (frame.type === 'stdout' && frame.data) {
          stdout += frame.data;
          appendTerminal({ stream: 'stdout', text: frame.data, execId });
        } else if (frame.type === 'stderr' && frame.data) {
          stderr += frame.data;
          appendTerminal({ stream: 'stderr', text: frame.data, execId });
        }
      },
      opts.signal,
    );

    setRunningExecId(null);
    if (opts.narrate && opts.sessionId) narrate(opts.sessionId, 'Reading the result…');

    const ok = outcome.exitCode === 0;
    appendTerminal({
      stream: 'system',
      text: ok
        ? `✔ exit 0 · ${(outcome.durationMs / 1000).toFixed(1)}s`
        : `✘ exit ${outcome.exitCode ?? 'null'}${outcome.killed ? ' (killed)' : ''} · ${(outcome.durationMs / 1000).toFixed(1)}s`,
    });

    let fingerprint: string | undefined;
    if (!ok) {
      const verdict = guard.record({
        kind: 'terminal',
        subject: command,
        error: stderr || stdout.slice(-2000),
        exitCode: outcome.exitCode ?? undefined,
        at: Date.now(),
      });
      fingerprint = verdict.fingerprint;
      refreshFingerprints();

      appendTerminal({
        stream: 'system',
        text: verdict.action === 'halt'
          ? `⛔ ${verdict.message}\n   → ${verdict.directive}`
          : `⚠  ${verdict.message}`,
      });
    }

    if (opts.sessionId) {
      void recordRun({
        sessionId: opts.sessionId,
        suite: opts.suite ?? 'terminal',
        execId,
        command,
        cwd: opts.cwd,
        exitCode: outcome.exitCode,
        stdout: stdout.slice(-100_000),
        stderr: stderr.slice(-100_000),
        startedAt,
        endedAt: Date.now(),
        durationMs: outcome.durationMs,
        fingerprint,
      });
    }

    return { ok, exitCode: outcome.exitCode, stdout, stderr };
  } catch (err) {
    setRunningExecId(null);
    const offline = err instanceof BridgeOfflineError;
    const message = (err as Error).message;

    appendTerminal({ stream: 'system', text: offline ? `⏸  ${message}` : `✘ ${message}` });

    if (!offline) {
      guard.record({ kind: 'terminal', subject: command, error: message, at: Date.now() });
      refreshFingerprints();
    }

    return { ok: false, exitCode: null, stdout: '', stderr: message, skipped: offline ? 'offline' : undefined, message };
  }
}

// ── Planning ────────────────────────────────────────────────────────────────

async function buildPlan(
  input: string,
  selection: { provider: ProviderId; model: string },
  suite: SuiteId | undefined,
  custom: CustomEndpointConfig | undefined,
  signal: AbortSignal,
): Promise<Plan> {
  // Decomposition is a cheap structured task. Spending a 2.8T flagship's latency
  // on it before the real work even starts is waste, so NIM runs plan through the
  // fast Nemotron; other providers keep the selected model.
  const plannerModel = selection.provider === 'nim' ? PLANNER_NIM_MODEL : selection.model;

  try {
    const raw = await complete(
      {
        provider: selection.provider,
        model: plannerModel,
        messages: [
          { role: 'system', content: PLANNER_PROMPT },
          { role: 'user', content: input.slice(0, 8000) },
        ],
        json: true,
        maxTokens: 1200,
        custom,
      },
      signal,
    );
    return parsePlan(raw, input, suite) ?? heuristicPlan(input, suite);
  } catch {
    // A dead planner must not kill the run — the heuristic plan is a real plan.
    return heuristicPlan(input, suite);
  }
}

/**
 * Generate two alternatives in parallel and let the user choose.
 *
 * Both share the abort controller, so the Stop button kills the pair — a draft
 * left streaming after cancel is the bug that makes Stop feel broken.
 */
async function runDrafts(opts: {
  input: string;
  systemPrompt: string;
  history: ChatMessage[];
  userContent: ChatMessage['content'];
  lane: 'A' | 'B';
  suite: SuiteId;
  selection: { provider: ProviderId; model: string };
  custom?: CustomEndpointConfig;
  signal: AbortSignal;
}): Promise<void> {
  const { setDrafts, patchDraft } = useWorkspace.getState();
  const [angleA, angleB] = pickAngles(opts.lane, opts.suite);

  const drafts = [angleA, angleB].map((angle, i) => ({
    id: uid(`draft${i}`),
    label: angle.label,
    angle: angle.angle,
    content: '',
    reasoning: '',
    streaming: true,
    model: opts.selection.model,
  }));
  setDrafts(drafts);

  const request = (angle: typeof angleA, id: string) =>
    streamCompletion(
      {
        provider: opts.selection.provider,
        model: opts.selection.model,
        messages: [
          { role: 'system', content: `${opts.systemPrompt}\n\n${draftSystemSuffix(angle)}` },
          ...opts.history,
          { role: 'user', content: opts.userContent },
        ],
        temperature: angle.temperature,
        maxTokens: 4096,
        custom: opts.custom,
      },
      {
        onDelta: (_d, full) => patchDraft(id, { content: full }),
        onReasoning: (_d, full) => patchDraft(id, { reasoning: full }),
        onError: () => undefined, // surfaced below, after the retry decides
      },
      opts.signal,
    );

  const runOne = async (angle: typeof angleA, id: string) => {
    let result = await request(angle, id);

    // One retry for a genuinely transient limit. Not a loop: a key that is over
    // quota stays over quota, and hammering it just delays the error.
    if (result.error && /rate limit|429|quota|too many/i.test(result.error) && !opts.signal.aborted) {
      patchDraft(id, { error: undefined, content: '' });
      await new Promise((r) => setTimeout(r, 3000));
      result = await request(angle, id);
    }

    patchDraft(id, {
      content: result.content,
      reasoning: result.reasoning,
      streaming: false,
      error: result.content ? undefined : result.error,
    });
  };

  // Verified against the live API: NVIDIA NIM's free tier permits exactly one
  // in-flight completion per key — a second concurrent request 429s immediately,
  // every time. So drafts run sequentially there and in parallel everywhere
  // else, rather than firing two requests the provider was never going to serve.
  const parallelSafe = opts.selection.provider !== 'nim';

  if (parallelSafe) {
    await Promise.all([runOne(angleA, drafts[0].id), runOne(angleB, drafts[1].id)]);
  } else {
    await runOne(angleA, drafts[0].id);
    if (!opts.signal.aborted) await runOne(angleB, drafts[1].id);
  }
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Many sessions at once, one message at a time per session.
 *
 * Each session runs on its own: a chat in one session streams while another builds in the next, and
 * "running" is shown only where it is true. Two things are shared and so cannot be doubled: the plan,
 * files and terminal are one live slot, so only one build (or drafts run) may hold it at a time. A
 * message that has to wait — behind the run in its own session, or for a build that wants the slot while
 * another holds it — is queued against its session and starts, in order, the moment it can. Starting a
 * queued message never moves the view; the user stays where they are.
 */
let creating: Promise<string> | null = null;

/** Builds and draft runs write the shared slot; a plain chat answer does not. */
function needsSlot(opts: SendOptions): boolean {
  const st = useWorkspace.getState();
  const attachments = opts.attachments ?? [];
  const lane = opts.forceLane ?? classifyLocal(opts.input.trim(), { hasAttachments: attachments.length > 0 }).lane;
  return lane === 'B' || (st.draftsEnabled && !opts.forceLane);
}

/** Sessions a queued message has been taken for but whose run has not registered yet (true = it wants the slot). */
const claimed = new Map<string, boolean>();

function canStartNow(sessionId: string, heavy: boolean): boolean {
  const st = useWorkspace.getState();
  const slotClaimed = [...claimed.values()].some(Boolean);
  return !st.runs[sessionId] && !claimed.has(sessionId) && (!heavy || (st.runSessionId === null && !slotClaimed));
}

export async function send(opts: SendOptions): Promise<void> {
  const st = useWorkspace.getState();
  const input = opts.input.trim();
  const attachments = opts.attachments ?? [];
  if (!input && !attachments.length) return;

  const suite = opts.suite ?? st.activeSuite;
  // A brand-new chat gets its session now, once, so everything typed into it while it waits belongs together.
  let sessionId = opts.sessionId ?? st.sessionId;
  if (!sessionId) {
    creating ??= createSession(suite, input.slice(0, 80) || 'Untitled run', { provider: st.selection.provider, model: st.selection.model })
      .then((made) => {
        useWorkspace.getState().setSessionId(made.id);
        return made.id;
      })
      .finally(() => { creating = null; });
    sessionId = await creating;
  }

  const heavy = needsSlot(opts);
  if (!canStartNow(sessionId, heavy)) {
    useWorkspace.getState().enqueue({ id: uid('q'), sessionId, suite, input, attachments, forceLane: opts.forceLane, at: Date.now() });
    // The run it waits for may have ended while the session was being made; then nobody else is coming to start this.
    void drainQueue();
    return;
  }
  await launch(sessionId, { ...opts, sessionId, suite }, heavy);
}

/** Runs one message to its end, then gives whatever was waiting its turn. */
async function launch(sessionId: string, opts: SendOptions, heavy: boolean): Promise<void> {
  try {
    await execute({ ...opts, sessionId }, heavy);
  } finally {
    useWorkspace.getState().endRun(sessionId);
    // Even if this run threw, whatever waited behind it still gets its turn.
    void drainQueue();
  }
}

/** Starts every queued message that can start now — without taking the view away from where the user is. */
async function drainQueue(): Promise<void> {
  for (;;) {
    const next = useWorkspace.getState().takeQueued((item) =>
      canStartNow(item.sessionId, needsSlot({ input: item.input, attachments: item.attachments, forceLane: item.forceLane })),
    );
    if (!next) return;
    const opts: SendOptions = { input: next.input, attachments: next.attachments, suite: next.suite, forceLane: next.forceLane, sessionId: next.sessionId };
    const heavy = needsSlot(opts);
    // Claimed before the first await, so nothing else can start in this session (or take the slot) meanwhile.
    claimed.set(next.sessionId, heavy);
    try {
      const { db, isBrowser } = await import('@/lib/db/schema');
      if (isBrowser() && !(await db().sessions.get(next.sessionId))) continue; // the session was deleted while it waited
      // execute() registers its run before its first await, so the claim can be let go as soon as it returns a promise.
      const running = launch(next.sessionId, opts, heavy).catch(() => undefined);
      claimed.delete(next.sessionId);
      void running;
    } finally {
      claimed.delete(next.sessionId);
    }
  }
}

async function execute(opts: SendOptions, heavy: boolean): Promise<void> {
  const state = useWorkspace.getState();
  const {
    selection, activeSuite, guard, heartbeat, pushMessage, patchMessage,
    setPlan, setTaskStatus, setRightPaneTab,
  } = state;

  const baseSuite = opts.suite ?? activeSuite;
  const attachments = opts.attachments ?? [];

  // Resolved here rather than at every call site: nothing that calls send()
  // knew to look up the endpoint, so a selected custom model went out with no
  // base URL at all and the request could only fail.
  const custom = opts.custom ?? endpointConfigFor(state.endpoints, selection);
  const input = opts.input.trim();
  if (!input && !attachments.length) return;

  // Last line of defence. The dock blocks this at the keystroke, but a skill
  // template or a programmatic call could still route a credential here, and
  // sending it would hand the user's key to a third-party model provider.
  const leaked = scanForSecrets(input);
  if (hasBlockingSecret(leaked)) {
    pushMessage({
      id: uid('msg'),
      role: 'system',
      content:
        `Blocked before sending: this message contains ${leaked
          .filter((m) => m.confidence === 'certain')
          .map((m) => m.label)
          .join(', ')}. ` +
        'Chomugiri will not transmit a credential to a model provider. Remove it, or store it under Settings → Secrets.',
      createdAt: Date.now(),
      error: 'secret_blocked',
    });
    return;
  }

  const suite = baseSuite;

  // Session bootstrap.
  let sessionId = opts.sessionId ?? state.sessionId;
  if (!sessionId) {
    const session = await createSession(suite, input.slice(0, 80) || 'Untitled run', {
      provider: selection.provider,
      model: selection.model,
    });
    sessionId = session.id;
    useWorkspace.getState().setSessionId(sessionId);
  }

  const controller = new AbortController();
  useWorkspace.getState().beginRun(sessionId, { controller, heavy });

  /** Shows what this run is doing, in this session's own bubble. */
  const think = (active: boolean, phrase?: string) => useWorkspace.getState().setThinking(active, phrase, sessionId);
  /**
   * The plan and files are one live slot. A run may write it unless a build in another session holds it;
   * what it makes is still saved to its own session either way.
   */
  const upsertFile: typeof state.upsertFile = (file) => {
    const held = useWorkspace.getState().runSessionId;
    if (held === null || held === sessionId) state.upsertFile(file);
  };

  /**
   * Writes that belong to *this* run's session.
   *
   * The live transcript is a single list with no session of its own, so a run
   * that finished while the user was reading another conversation wrote its
   * messages into whatever was on screen — one session's answer appearing
   * inside another. Persistence was always correct; only the view bled. These
   * guards drop the live write when the user has moved on, and the message is
   * still saved to the session it belongs to, so switching back shows it.
   */
  const isCurrent = () => useWorkspace.getState().sessionId === sessionId;
  const emit = (message: Parameters<typeof pushMessage>[0]) => {
    if (isCurrent()) pushMessage(message);
  };
  const patch = (id: string, patchValue: Parameters<typeof patchMessage>[1]) => {
    if (isCurrent()) patchMessage(id, patchValue);
  };

  // ── Classify ──────────────────────────────────────────────────────────────
  const classification: Classification = opts.forceLane
    ? { lane: opts.forceLane, confidence: 1, reason: 'explicit override', suite }
    : classifyLocal(input, { hasAttachments: attachments.length > 0 });

  const lane = classification.lane;

  const userMessage = {
    id: uid('msg'),
    role: 'user' as const,
    content: input,
    createdAt: Date.now(),
    attachments,
    lane,
  };
  emit(userMessage);
  void appendMessage({ ...userMessage, sessionId, suite });

  const assistantId = uid('msg');
  emit({
    id: assistantId,
    role: 'assistant',
    content: '',
    reasoning: '',
    lane,
    model: selection.model,
    provider: selection.provider,
    createdAt: Date.now(),
    streaming: true,
  });
  useWorkspace.getState().patchRun(sessionId, { assistantId });

  // Android freezes a backgrounded process unless something says work is
  // happening. Saying it here, rather than at the transport, means the whole
  // run is covered — planning, streaming, terminal steps and all.
  void runStarted(noticeTopic(input));

  const stopPhrases = startNarration(sessionId, lane);
  const startedAt = Date.now();

  try {
    // ── Plan (Lane B only) ──────────────────────────────────────────────────
    let plan: Plan | null = null;
    if (lane === 'B') {
      think(true, 'Decomposing into atomic steps...');
      plan = await buildPlan(input, selection, suite, custom, controller.signal);

      // Park terminal steps immediately if the tunnel is already down, rather
      // than letting them fail one at a time later.
      if (heartbeat.status !== 'online' && plan.tasks.some(requiresBridge)) {
        const parked = parkBridgeTasks(plan, `Bridge is ${heartbeat.status} — resumes when the tunnel is back.`);
        plan = parked.plan;
      }

      setPlan(plan);
      setRightPaneTab('plan');

      const first = plan.tasks.find((t) => t.status === 'pending');
      if (first) setTaskStatus(first.id, 'in_progress');
    }

    // A game is designed before it is written. Read deterministically from the
    // prompt so the same request plans the same game every time — and so the
    // user can correct it in one sentence instead of after a whole build.
    const design = suite === 'godot' ? planGame(input) : null;
    if (design) {
      think(true, `Planning ${design.name}…`);
      // Shown before the build, not after it. A misread prompt costs one
      // sentence to correct here and a whole regenerated project later.
      const note = {
        id: uid('msg'),
        role: 'system' as const,
        content: `**Here is the game I am about to build.** Say so if any of it is wrong.\n\n${planSummary(design)}`,
        createdAt: Date.now(),
      };
      emit(note);
      void appendMessage({ ...note, sessionId, suite });
    }

    // ── Live web search, for a question a fixed training cutoff answers badly ──
    // Deterministic pattern match first, same as lane classification: most
    // messages ("write me a for loop") decide themselves with no network
    // round trip, and the ones that do fire cost a free search chain, not a
    // paid one — see needsLiveSearch's own reasoning for why it leans toward
    // triggering rather than staying quiet.
    let liveSearch: LiveSearchResult | null = null;
    if (needsLiveSearch(input).needed) {
      think(true, 'Checking the live web…');
      liveSearch = await liveSearchContext(input, { signal: controller.signal });
      if (liveSearch) {
        const note = {
          id: uid('msg'),
          role: 'system' as const,
          content: `🔍 Searched the web for **${liveSearch.query}** — ${liveSearch.hits.length} result${liveSearch.hits.length === 1 ? '' : 's'} via ${liveSearch.provider}.`,
          createdAt: Date.now(),
        };
        emit(note);
        void appendMessage({ ...note, sessionId, suite });
      }
    }

    // ── Research before building ────────────────────────────────────────────
    // The model's training data stops at a date and the tools it builds with do
    // not. For a build, look up what it is most likely stale about and read the
    // real pages — see research.ts. Fails soft: no result means "build from
    // what you know", the same as before this existed.
    let research: ResearchReport | null = null;
    if (needsResearch(input, suite, lane)) {
      const queries = planResearch(input, suite);
      if (queries.length) {
        think(true, 'Researching the live web before building…');
        research = await runResearch(queries, async (body) => {
          const res = await fetch('/api/research', withKeys({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]),
          }));
          return res.ok ? await res.json() : null;
        });
        const line = summarizeResearch(research);
        if (line) {
          const note = { id: uid('msg'), role: 'system' as const, content: line, createdAt: Date.now() };
          emit(note);
          void appendMessage({ ...note, sessionId, suite });
        }
      }
    }

    // ── Stream the answer ───────────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt({
      lane,
      suite,
      ...(liveSearch ? { liveSearch } : {}),
      ...(research?.findings.length ? { research } : {}),
      bridgeStatus:
        heartbeat.status === 'online' ? 'online'
          : heartbeat.status === 'degraded' ? 'degraded'
            : heartbeat.status === 'unknown' || heartbeat.status === 'connecting' ? 'unknown'
              : 'offline',
      bridgeDetail: heartbeat.health
        ? `Host: ${heartbeat.health.platform}/${heartbeat.health.arch}, workspace root ${heartbeat.health.workspace} (commands and cwd are relative to it — use cwd=. or a subfolder, not this absolute path). Toolchain — java: ${heartbeat.health.toolchains.java ?? 'absent'}, gradle: ${heartbeat.health.toolchains.gradle ?? 'absent'}, android sdk: ${heartbeat.health.toolchains.androidSdk ?? 'absent'}, node: ${heartbeat.health.toolchains.node ?? 'absent'}, python: ${heartbeat.health.toolchains.python ?? 'absent'}, godot: ${heartbeat.health.toolchains.godot ?? 'absent'}. These are READ from this machine — trust them over what you remember (a version newer than you know is normal; write for it).`
        : heartbeat.lastError ?? undefined,
      todos: plan?.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
      failedApproaches: guard.bannedApproaches(),
      attachments: attachments.map((a) => ({ name: a.name, kind: a.kind, bytes: a.bytes })),
      workspaceFiles: [...useWorkspace.getState().files.keys()],
      buildingSite: wantsSite(input),
      ...(design ? { gamePlan: planBrief(design) } : {}),
      // Computed from the keys that are actually set, so the pipeline line the
      // model prints is a fact about this session rather than a guess.
      ...(suite === 'godot'
        ? (() => {
            const k = getKeys();
            return { assetPipeline: pipelineStatement({ meshy: k.meshy, tripo: k.tripo, nim: k.nim, trellisUrl: k.trellisUrl }) };
          })()
        : {}),
    });

    const history = await historyFor(sessionId, 10);
    const userContent = buildUserContent(input, attachments);

    // Drafts replace the single answer entirely; the chosen one is committed
    // into the transcript when the user picks it.
    if (useWorkspace.getState().draftsEnabled && !opts.forceLane) {
      patch(assistantId, { streaming: false, content: '' });
      think(true, 'Drafting two approaches...');

      await runDrafts({
        input,
        systemPrompt,
        history,
        userContent,
        lane,
        suite,
        selection,
        custom,
        signal: controller.signal,
      });

      // The placeholder turn is a slot the chosen draft fills in.
      patch(assistantId, { content: '', streaming: false });
      return;
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userContent },
    ];

    // Taken before anything streams: files are saved into the workspace as they
    // finish mid-stream, so a snapshot taken afterwards calls every one of them
    // "updated" and the hand-over note says nothing was created.
    const filesBefore = new Map(useWorkspace.getState().files);

    let seenFiles = new Map<string, FileArtifact>();

    // `prefix` is what earlier passes already produced, so a continuation
    // streams into the same bubble instead of replacing it.
    let narratedAt = 0;
    const callbacksFor = (prefix: string): StreamCallbacks => ({
      onDelta: (_delta, part) => {
        const full = prefix + part;
        patch(assistantId, { content: full });
        // Re-reading the whole reply on every delta gets slow on a phone; the stage only changes at a fence.
        if (_delta.includes('`') || full.length - narratedAt > 800) {
          narratedAt = full.length;
          narrate(sessionId, streamingPhrase(full, lane));
        }

        // Extract artifacts live so the file manager fills in mid-stream.
        if (lane === 'B' && full.includes('```')) {
          const artifacts = extractArtifacts(full);
          const files = filesOf(artifacts).filter((f) => f.complete);
          if (files.length) {
            const merged = mergeFiles(seenFiles, files);
            for (const [path, file] of merged) {
              if (seenFiles.get(path)?.content !== file.content) upsertFile(file);
            }
            seenFiles = merged;
          }
        }
      },
      onReasoning: (_delta, full) => {
        patch(assistantId, { reasoning: full });
        narrate(sessionId, 'Reasoning…');
      },
      onError: (message) => patch(assistantId, { error: message }),
    });

    let result = await streamCompletion(
      {
        provider: selection.provider,
        model: selection.model,
        messages,
        temperature: lane === 'B' ? 0.25 : 0.5,
        maxTokens: 8192,
        custom,
      },
      callbacksFor(''),
      controller.signal,
    );

    // Two ways a build reply ends before its files do. It can run out of
    // output ("length"): pick up from the last finished file instead of handing
    // over a half-written project. Or it can announce a file and stop on a
    // clean "stop" — the model narrating and treating the file as a next turn
    // that never comes — in which case it is told to write what it named.
    let continuations = 0;
    let nudges = 0;
    // The provider said "length", or the connection dropped mid-reply (the
    // 300 s limit on a slow reasoning model lands exactly like this). Either
    // way the reply stops partway through a file.
    const wasCut = (r: typeof result) => isTruncated(r.finishReason) || Boolean(r.error && r.content.trim());
    while (
      lane === 'B' &&
      (!result.error || wasCut(result)) &&
      continuations + nudges < MAX_CONTINUATIONS + MAX_NUDGES &&
      !controller.signal.aborted
    ) {
      const truncated = wasCut(result);
      if (!truncated && nudges >= MAX_NUDGES) break;
      if (truncated && continuations >= MAX_CONTINUATIONS) break;

      const next = truncated ? planContinuation(result.content) : planNudge(result.content);
      if (!next) break;
      if (truncated) continuations += 1;
      else nudges += 1;

      const prefix = `${next.kept}\n\n`;
      const more = await streamCompletion(
        {
          provider: selection.provider,
          model: selection.model,
          messages: [...messages, { role: 'assistant', content: next.kept }, { role: 'user', content: next.prompt }],
          temperature: 0.25,
          maxTokens: 8192,
          custom,
        },
        callbacksFor(prefix),
        controller.signal,
      );

      result = {
        ...more,
        content: prefix + more.content,
        reasoning: [result.reasoning, more.reasoning].filter(Boolean).join('\n\n'),
        usage: more.usage ?? result.usage,
      };
    }

    // Still cut off after every pass, or nothing had finished to continue
    // from. Say so: the alternative is a project that silently lacks its
    // last file.
    const stillTruncated = lane === 'B' && wasCut(result);
    if (stillTruncated) {
      const cut = splitAtOpenBlock(result.content);
      // A dropped connection and a hit output limit leave the same hole, but
      // the advice differs, so say which one it was.
      const dropped = Boolean(result.error) && !isTruncated(result.finishReason);
      const why = dropped
        ? `The connection to the model dropped mid-reply${continuations ? ` and kept dropping after ${continuations} retr${continuations === 1 ? 'y' : 'ies'}` : ''} (${result.error})`
        : `The reply hit the model's output limit${continuations ? ` even after ${continuations} continuation${continuations === 1 ? '' : 's'}` : ''}`;
      const advice = dropped
        ? 'Try again, or pick a faster model.'
        : 'Ask for that file on its own, or pick a model with a larger output limit.';
      const note = {
        id: uid('msg'),
        role: 'system' as const,
        content: cut
          ? `${why}, so ${cut.openPath ? `\`${cut.openPath}\`` : 'the last file'} was cut off and has been left out rather than saved half-written. ${advice}`
          : `${why} before it finished${result.content.trim() ? '' : ' — it produced no answer text at all, which usually means a reasoning model spent its whole budget thinking'}. ${dropped ? advice : 'Try again, ask for fewer files at a time, or pick a model with a larger output limit.'}`,
        createdAt: Date.now(),
      };
      emit(note);
      void appendMessage({ ...note, sessionId, suite });
    }

    patch(assistantId, {
      content: result.content,
      reasoning: result.reasoning,
      streaming: false,
      error: result.error,
      usage: result.usage
        ? { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens, totalTokens: result.usage.totalTokens }
        : undefined,
      durationMs: Date.now() - startedAt,
    });

    void appendMessage({
      id: assistantId,
      sessionId,
      suite,
      role: 'assistant',
      content: result.content,
      reasoning: result.reasoning,
      createdAt: startedAt,
      model: selection.model,
      provider: selection.provider,
      lane,
      plan,
      error: result.error,
      durationMs: Date.now() - startedAt,
    });

    if (result.error && !result.content) {
      if (plan) {
        const active = plan.tasks.find((t) => t.status === 'in_progress');
        if (active) setTaskStatus(active.id, 'failed', result.error);
      }
      return;
    }

    // ── Post-stream artifact persistence ────────────────────────────────────
    const artifacts = extractArtifacts(result.content);
    // A block left open because the reply was cut off is half a file; one left
    // open because a weaker model forgot the closing fence is still the whole
    // file. Only the first kind is dropped.
    const files = filesOf(artifacts).filter((f) => f.complete || !stillTruncated);

    for (const file of files) {
      upsertFile(file);
      void upsertArtifact({
        sessionId,
        suite,
        path: file.path,
        language: file.language,
        content: file.content,
        bytes: file.bytes,
      });
    }

    // ── Android: make every icon and drawable the project names exist ───────
    //
    // A model writing an app reliably names `@mipmap/ic_launcher` in the
    // manifest and never draws it, and resource linking then refuses to build
    // anything. The missing ones are added here, and said so plainly — a
    // placeholder icon is honest, a build that fails on an icon is not.
    if (files.some((f) => /(^|\/)AndroidManifest\.xml$/.test(f.path))) {
      const repair = repairResources(
        [...useWorkspace.getState().files.values(), ...files].map((f) => ({ path: f.path, content: f.content })),
        input.slice(0, 40),
      );

      for (const added of repair.files) {
        const artifact = {
          kind: 'file' as const,
          path: added.path,
          language: languageForPath(added.path),
          content: added.content,
          complete: true,
          bytes: new TextEncoder().encode(added.content).length,
        };
        files.push(artifact);
        upsertFile(artifact);
        void upsertArtifact({
          sessionId,
          suite,
          path: artifact.path,
          language: artifact.language,
          content: artifact.content,
          bytes: artifact.bytes,
        });
      }

      if (repair.files.length) {
        const parts: string[] = [];
        if (repair.launcherIcons.length) {
          parts.push(`the launcher icon (${repair.launcherIcons.map((n) => `\`@${n}\``).join(', ')})`);
        }
        if (repair.placeholders.length) {
          parts.push(`${repair.placeholders.length} drawable${repair.placeholders.length === 1 ? '' : 's'} (${repair.placeholders.map((n) => `\`@${n}\``).join(', ')})`);
        }
        const note = {
          id: uid('msg'),
          role: 'system' as const,
          content: `The project used ${parts.join(' and ')} but nothing defined ${repair.launcherIcons.length + repair.placeholders.length === 1 ? 'it' : 'them'}, which fails resource linking before anything compiles. I added ${repair.files.length} resource file${repair.files.length === 1 ? '' : 's'} so it builds. ${repair.launcherIcons.length ? 'The launcher icon is a coloured placeholder — replace it with your real logo. ' : ''}${repair.placeholders.length ? 'The placeholder drawables are plain outlines — swap in real art.' : ''}`.trim(),
          createdAt: Date.now(),
        };
        emit(note);
        void appendMessage({ ...note, sessionId, suite });
      }
    }

    // ── Website: mistakes that look like the page failed to load ────────────
    //
    // The one found in practice: a "no WebGL" card hidden with the `hidden`
    // attribute and styled with `display: flex`, which defeats `hidden` and
    // leaves the card opaque over the whole scene on every device.
    if (files.some((f) => /\.html?$/i.test(f.path))) {
      const fixes = repairSite(
        [...useWorkspace.getState().files.values(), ...files].map((f) => ({ path: f.path, content: f.content })),
      );

      for (const fix of fixes) {
        const artifact = {
          kind: 'file' as const,
          path: fix.path,
          language: languageForPath(fix.path),
          content: fix.content,
          complete: true,
          bytes: new TextEncoder().encode(fix.content).length,
        };
        const at = files.findIndex((f) => f.path === fix.path);
        if (at >= 0) files[at] = artifact;
        else files.push(artifact);
        upsertFile(artifact);
        void upsertArtifact({
          sessionId,
          suite,
          path: artifact.path,
          language: artifact.language,
          content: artifact.content,
          bytes: artifact.bytes,
        });

        const note = {
          id: uid('msg'),
          role: 'system' as const,
          content: `Fixed \`${fix.path}\`: ${fix.reason}`,
          createdAt: Date.now(),
        };
        emit(note);
        void appendMessage({ ...note, sessionId, suite });
      }
    }

    if (files.length) setRightPaneTab('files');

    // Everything the plan's progress is derived from. Gathered here rather
    // than asked of the model: a checklist should tick on what happened.
    const evidence: RunEvidence = {
      ...NO_EVIDENCE,
      answerChars: result.content.length,
      filesWritten: files.length,
      failed: Boolean(result.error),
    };

    // ── Minecraft: build the models the entity asks for ────────────────────
    //
    // An entity naming a geometry nothing defines imports cleanly and then
    // draws nothing — Bedrock reports no error, so it only shows up on the
    // user's device. The format has several ways to be silently wrong, so the
    // model is compiled from a body plan here rather than written by hand.
    if (files.length) {
      const missing = missingGeometries(detectPacks(files));

      for (const gap of missing) {
        try {
          const plan = inferPlan(`${input} ${gap.identifier}`);
          const geo = buildGeometry({ identifier: gap.identifier, parts: bodyPlan(plan) });

          // Alongside the entity that asked for it, where Minecraft looks.
          const dir = gap.file.replace(/\/entity\/[^/]+$/, '');
          const name = gap.identifier.split('.').pop() ?? 'model';
          const artifact = {
            kind: 'file' as const,
            path: `${dir}/models/entity/${name}.geo.json`,
            language: 'json',
            content: JSON.stringify(geo, null, 2),
            complete: true,
            bytes: 0,
          };
          artifact.bytes = artifact.content.length;

          files.push(artifact);
          upsertFile(artifact);

          emit({
            id: uid('msg'),
            role: 'system',
            content:
              `Built the missing model — \`${artifact.path}\` (${plan} rig, ${geo['minecraft:geometry'][0].bones.length} bones). ` +
              `Without it the entity would import and then be invisible. Open it at web.blockbench.net to reshape it.`,
            createdAt: Date.now(),
          });
        } catch (err) {
          emit({
            id: uid('msg'),
            role: 'system',
            content: `Could not build a model for \`${gap.identifier}\` — ${(err as Error).message}`,
            createdAt: Date.now(),
          });
        }
      }
    }

    // ── Minecraft: paint the textures the model could not ──────────────────
    //
    // A language model cannot emit a PNG, so every pack arrived with its art
    // missing and Minecraft rendered it magenta-and-black. Chomugiri already
    // generates images; this fills exactly the holes the pack declares.
    if (files.length) {
      const detected = detectPacks(files);
      const wanted = plannedTextures(detected);

      if (wanted.length) {
        emit({
          id: uid('msg'),
          role: 'system',
          content: `Painting ${wanted.length} texture${wanted.length === 1 ? '' : 's'} the pack asks for — ${wanted
            .map((t) => `\`${t.path.split('/').pop()}\``)
            .join(', ')}.`,
          createdAt: Date.now(),
        });

        for (const texture of wanted) {
          if (controller.signal.aborted) break;
          try {
            // Checking controller.signal.aborted between textures only stops
            // the *next* one from starting — it does nothing for one already
            // stalled, since the fetch itself carried no signal and no
            // timeout. A dozen textures each hanging out to the platform's own
            // ceiling looked like one frozen step.
            const res = await fetch('/api/image', withKeys({
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]),
              body: JSON.stringify({
                // The user's chosen image model, falling back to whatever is
                // actually configured — NIM needs a key, Pollinations does not.
                ...(() => {
                  const [chosenProvider, ...rest] = (useWorkspace.getState().imageModel || 'nim:').split(':');
                  const chosenModel = rest.join(':');
                  const nimReady = useWorkspace.getState().models.some((m) => m.provider === 'nim');
                  const provider = chosenProvider === 'nim' && !nimReady ? 'pollinations' : chosenProvider;
                  return { provider, ...(chosenModel ? { model: chosenModel } : {}) };
                })(),
                prompt: texturePrompt(texture),
                // Generated large and reduced afterwards: the detail that
                // survives the downscale is what makes a 16px icon readable.
                width: 1024,
                height: 1024,
              }),
            }));
            if (!res.ok) throw new Error(`image provider returned ${res.status}`);

            // The route answers { images: [{ dataUrl }] }; a single-image
            // shape is accepted too so a change there cannot silently break
            // texture generation again.
            const body = (await res.json()) as { images?: Array<{ dataUrl?: string }>; dataUrl?: string };
            const dataUrl = body.images?.[0]?.dataUrl ?? body.dataUrl;
            if (!dataUrl) throw new Error('the image provider returned no image');

            // The downscale is the part that makes it a Minecraft texture
            // rather than a small painting.
            const pixels = await toPixelArt(dataUrl, texture.size);
            const artifact = textureArtifact(texture.path, pixels);
            files.push(artifact);
            upsertFile(artifact);
          } catch (err) {
            // One texture failing must not cost the user the whole add-on.
            emit({
              id: uid('msg'),
              role: 'system',
              content: `Could not paint \`${texture.path}\` — ${(err as Error).message}. The pack is still built; drop a PNG in at that path yourself.`,
              createdAt: Date.now(),
            });
          }
        }
      }
    }

    // ── Godot: a chat model that never finishes writing the project ─────────
    //
    // Chat-authored code depends on the selected model actually reaching the
    // code before it runs out of time or budget. Verified live against the
    // real gateway: a 300-second NIM call and a 100-second Pollinations call
    // both spent their whole run narrating or reasoning about the plan and
    // never emitted a single file — the exact shape of "0/7 complete" and no
    // game. Game Studio's dedicated button never has this problem because it
    // never asks a model to hand-write the project; it calls the deterministic
    // builder below directly. Lane B chat gets the same floor: if the model's
    // own output does not already contain a working project, one is built
    // from the plan instead of leaving the user with nothing.
    if (suite === 'godot' && design && !detectGodotProject(files)) {
      const built = buildProject({ name: design.name, dimension: design.dimension, genre: design.genre, view: design.view });
      for (const f of built) {
        const artifact = {
          kind: 'file' as const,
          path: f.path,
          language: f.path.endsWith('.gd') ? 'gdscript' : f.path.endsWith('.md') ? 'markdown' : 'text',
          content: f.content,
          complete: true,
          bytes: new TextEncoder().encode(f.content).length,
        };
        files.push(artifact);
        upsertFile(artifact);
      }
      emit({
        id: uid('msg'),
        role: 'system',
        content:
          `${selection.model} did not finish writing the project — it can happen when the model is slow or spends its ` +
          `whole answer reasoning about the plan instead of the code. Built **${design.name}** from the plan directly ` +
          `instead, so the build does not depend on that finishing.`,
        createdAt: Date.now(),
      });
    }

    // ── Godot: build the model, complete the project, hand over a zip ───────
    //
    // The suite used to stop at "here are some files": a project.godot and a
    // .tscn in the file panel, which on a phone means creating the folder and
    // saving each one by hand. And nothing ever generated the .glb the scene
    // referenced, so the character the plan described was never actually built.
    if (suite === 'godot' && files.length && detectGodotProject(files)) {
      const keys = getKeys();
      // 'character' because this call builds the thing the player looks at —
      // the one place the paid Meshy and Tripo keys are meant to be spent.
      const chain = sourceChain(
        { meshy: keys.meshy, tripo: keys.tripo, nim: keys.nim, trellisUrl: keys.trellisUrl, kaggle: keys.kaggle },
        'character',
      );

      // The scene names the model it wants; only build one if it asked.
      const wantsModel = referencedResources(files, detectGodotProject(files)?.root ?? '').some((r) => r.endsWith('.glb'));

      if (wantsModel && design) {
        think(true, `Building the ${design.player.description} model…`);
        try {
          const outcome = await generateModel(
            {
              prompt: `${design.player.description}, ${design.genre} game character, realistic, detailed`,
              role: 'character',
              plan: design.player.body,
              parts: playerParts(design),
            },
            { meshy: keys.meshy, tripo: keys.tripo, nim: keys.nim, trellisUrl: keys.trellisUrl, kaggle: keys.kaggle, huggingface: keys.huggingface },
            {
              onStage: (_source, message) => think(true, message),
              renderImage: referenceImage,
            },
          );

          if (outcome.bytes) {
            const target = referencedResources(files, detectGodotProject(files)?.root ?? '').find((r) => r.endsWith('.glb'));
            const artifact = glbArtifact(target ?? 'hero.glb', outcome.bytes);
            files.push(artifact);
            upsertFile(artifact);
            evidence.artifactProduced = true;
          }

          // The licence's credit goes into the project, not into a chat message
          // the user has to remember to copy. Nearly every downloadable
          // Sketchfab model is CC Attribution, and a build that ships without
          // the credit is a licence violation.
          if (outcome.credit) {
            const root = detectGodotProject(files)?.root ?? '';
            const content = creditsFile([outcome.credit]);
            const credits = {
              kind: 'file' as const,
              path: root ? `${root}/CREDITS.md` : 'CREDITS.md',
              language: 'markdown',
              content,
              complete: true,
              bytes: new TextEncoder().encode(content).length,
            };
            files.push(credits);
            upsertFile(credits);
          }

          // Said plainly rather than swallowed: a user who pasted a Meshy key
          // and silently got a box model would think the key was ignored.
          const notes = [...outcome.notes];
          if (outcome.credit) {
            notes.push(
              `Model is "${outcome.credit.name}" by ${outcome.credit.author}, ${outcome.credit.licence}. The credit is written into CREDITS.md — keep it with anything you ship.`,
            );
          }
          if (outcome.url) {
            notes.push(`${outcome.source} generated the model at ${outcome.url} — download it and save it into the project folder.`);
          }
          if (!outcome.rigged && outcome.source !== 'built') {
            notes.push('That model has no skeleton, so it will not animate until it is rigged.');
          }
          if (notes.length) {
            emit({
              id: uid('msg'),
              role: 'system',
              content: [`**Model built with ${outcome.source}.**`, '', ...notes.map((n) => `- ${n}`)].join('\n'),
              createdAt: Date.now(),
            });
          }
        } catch (err) {
          // Losing the model must not cost the user the project.
          emit({
            id: uid('msg'),
            role: 'system',
            content: `Could not build the 3D model — ${(err as Error).message}. The project is still here; it will open without it.`,
            createdAt: Date.now(),
          });
        }
      }

      // Flat-coloured boxes are what makes a generated game read as a
      // placeholder. Geometry we can build; a *surface* we cannot, so the
      // surfaces are generated — NVIDIA's FLUX answers in seconds, which is
      // what makes a dozen of them practical in one build.
      if (!files.some((f) => f.path.startsWith('textures/'))) {
        const planned = plannedGameTextures(RUNNER_THEMES);
        const themeFor = (i: number) =>
          i < RUNNER_THEMES.length * 2 ? RUNNER_THEMES[Math.floor(i / 2)] : undefined;

        for (let i = 0; i < planned.length; i += 1) {
          if (controller.signal.aborted) break;
          const texture = planned[i];
          think(true, `Painting ${texture.subject}…`);
          try {
            let art = await paintTexture(gameTexturePrompt(texture, themeFor(i)), texture.seed, controller.signal);
            // A flat texture is worse than none: the surface renders as a blank
            // sheet and the geometry on it disappears. One reroll, insisting.
            if (art && looksFlat(art.bytes)) {
              const retry = await paintTexture(
                insistOnDetail(texture, themeFor(i)),
                (texture.seed + 7919) % 1_000_000,
                controller.signal,
              );
              if (retry && retry.bytes > art.bytes) art = retry;
            }
            if (!art) continue;
            const artifact = textureArtifact(texture.path, art.dataUrl);
            files.push(artifact);
            upsertFile(artifact);
          } catch {
            // One surface failing costs that surface, not the build; the game
            // falls back to flat colour for it.
          }
        }
        if (files.some((f) => f.path.startsWith('textures/'))) evidence.artifactProduced = true;
      }

      // A silent game reads as a tech demo. The model cannot emit a binary, so
      // the soundtrack is synthesised here — one track per stage plus the four
      // effects a game needs, all derived from the plan so two stages actually
      // sound different.
      if (!files.some((f) => f.path.startsWith('audio/'))) {
        think(true, 'Writing the soundtrack…');
        try {
          const moods: Array<{ scale: ScaleName; bpm: number; root: number }> = [
            { scale: 'pentatonic', bpm: 104, root: -12 },
            { scale: 'minor', bpm: 124, root: -10 },
            { scale: 'major', bpm: 136, root: -7 },
            { scale: 'phrygian', bpm: 148, root: -14 },
            { scale: 'minor', bpm: 160, root: -17 },
          ];
          const stages = Math.max(1, Math.min(moods.length, design?.entities.length ?? 3));

          for (let i = 0; i < stages; i += 1) {
            const mood = moods[i];
            const wav = toWav(musicTrack({ ...mood, seed: 1101 + i * 1103, seconds: 48 }));
            const artifact = wavArtifact(`audio/zone_${i}.wav`, wav);
            files.push(artifact);
            upsertFile(artifact);
          }
          for (const kind of ['coin', 'jump', 'crash', 'levelup'] as const) {
            const artifact = wavArtifact(`audio/sfx_${kind}.wav`, toWav(sfxFor(kind)));
            files.push(artifact);
            upsertFile(artifact);
          }
          evidence.artifactProduced = true;
        } catch (err) {
          // A game with no music still plays.
          emit({
            id: uid('msg'),
            role: 'system',
            content: `Could not write the soundtrack — ${(err as Error).message}. The game is still here; it will just be quiet.`,
            createdAt: Date.now(),
          });
        }
      }

      const exported = buildGodotExport(files, design);
      if (exported) {
        evidence.artifactProduced = true;

        // buildGodotExport checks the project's shape. This checks the failures
        // that are silent at load — a script that does not parse, a node
        // addressed at a path its scene does not contain, an input action
        // nothing declares. Godot reports none of those as errors: it opens,
        // and the gun just does not shoot.
        const header = exported.problems.length
          ? `**This project will not open cleanly yet.** ${describeGodotExport(exported)}`
          : `**Your game is ready.** ${describeGodotExport(exported)}`;

        const body = [
          header,
          '',
          ...(exported.problems.length
            ? ['Fix these first:', '', ...exported.problems.map((p) => `- ${p}`), '']
            : ['Extract it, open Godot 4 on your phone, press Import and pick the `project.godot` inside.', '']),
          ...(exported.warnings.length ? [describeProblems(exported.warnings), ''] : []),
          ...(exported.filledIn.length
            ? ['Filled in because the project referenced them and they were not written:', '',
               ...exported.filledIn.map((f) => `- \`${f}\``), '']
            : []),
          chain[0] === 'built'
            ? '_Models are being built in code. Add a Meshy or Tripo key in Settings → API Keys for generated ones._'
            : `_Model source: ${chain[0]}._`,
        ].join('\n');

        const offer = {
          id: uid('msg'),
          role: 'system' as const,
          content: body,
          // Offered even with problems: the user may want to repair it by hand
          // rather than be told no.
          offer: { kind: 'godot-project' as const, filename: exported.filename, label: describeGodotExport(exported) },
          createdAt: Date.now(),
        };
        emit(offer);
        void appendMessage({ ...offer, sessionId, suite });

        // ── And the APK, when there is a machine to build it on ────────────
        //
        // A browser tab cannot make one: an APK is a zip of compiled native
        // code, signed, and Godot's exporter is a native binary. So this only
        // happens with the bridge up, and when it is down the user is told
        // that plainly rather than left wondering where the button is.
        if (!exported.problems.length) {
          const live = useWorkspace.getState().heartbeat.status;
          if (live !== 'online' && live !== 'degraded') {
            const parked = {
              id: uid('msg'),
              role: 'system' as const,
              content: `_No APK: making one needs Godot's own exporter on a real machine, and the terminal bridge is ${live}. The project above is complete — bring the bridge up and ask again, or open it in Godot on your phone and export from there._`,
              createdAt: Date.now(),
            };
            emit(parked);
            void appendMessage({ ...parked, sessionId, suite });
          } else {
            const projectRoot = detectGodotProject(files)?.root ?? '';
            const forBridge = files.map((f) => ({ path: relativePath(f.path, projectRoot), content: f.content }));

            // ── Playable here, before anything is installed ────────────────
            //
            // The same project, exported to WebAssembly. It goes first because
            // it is the one that costs the user nothing: no install, no
            // "unknown source" warning, no wait — the game appears under the
            // message that asked for it. The APK is still worth having, and
            // still native-fast, but nobody should have to install a thing to
            // find out whether it is any good.
            think(true, 'Compiling it to run in the chat…');
            // Godot's own export is the part that used to be invisible: its
            // stdout/stderr only ever showed up, truncated, in the chat message
            // after the whole thing finished or failed. Streamed into the same
            // terminal pane a normal command runs in, and switched to it, so a
            // multi-minute compile reads as progress rather than a stuck spinner.
            useWorkspace.getState().setRightPaneTab('terminal');
            const web = await buildWebOnBridge(useWorkspace.getState().bridge, forBridge, {
              name: design?.name ?? 'Chomugiri Game',
              onStage: (message) => {
                think(true, message);
                useWorkspace.getState().appendTerminal({ stream: 'system', text: `— ${message}` });
              },
              onOutput: (chunk, stream) => useWorkspace.getState().appendTerminal({ stream, text: chunk }),
            });

            if (web.files) {
              const playId = uid('play');
              keepPlayable(playId, web.files);
              const playable = {
                id: uid('msg'),
                role: 'system' as const,
                content: `**${design?.name ?? 'The game'} runs right here.** ${describeBuild(web)}`,
                offer: {
                  kind: 'play' as const,
                  filename: 'index.html',
                  label: `${(web.size / 1024 / 1024).toFixed(0)} MB, no install`,
                  playId,
                },
                createdAt: Date.now(),
              };
              emit(playable);
              // The offer is kept out of history on purpose: the build it
              // points at does not survive a reload, and a Play button that
              // does nothing is worse than no button.
              const { offer: _transient, ...history } = playable;
              void appendMessage({ ...history, sessionId, suite });
            } else {
              // Said out loud. The only branch used to be the success one, so a
              // failed web export — a missing export template, a bridge that
              // went away — left the user watching a progress line that simply
              // stopped, after they had waited through the whole compile.
              const nope = {
                id: uid('msg'),
                role: 'system' as const,
                content: `_It did not compile to run in the chat: ${web.error} The APK below is the same game._${
                  web.log.trim() ? `\n\n\`\`\`\n${web.log.slice(-500).trim()}\n\`\`\`` : ''
                }`,
                createdAt: Date.now(),
              };
              emit(nope);
              void appendMessage({ ...nope, sessionId, suite });
            }

            think(true, 'Compiling the APK on the bridge…');
            const built = await buildApkOnBridge(
              useWorkspace.getState().bridge,
              forBridge,
              {
                name: design?.name ?? 'Chomugiri Game',
                versionName: '1.0',
                onStage: (message) => {
                  think(true, message);
                  useWorkspace.getState().appendTerminal({ stream: 'system', text: `— ${message}` });
                },
                onOutput: (chunk, stream) => useWorkspace.getState().appendTerminal({ stream, text: chunk }),
              },
            );

            if (built.bytes) {
              // Stored as a workspace file so the download button has something
              // to hand over — unlike the zip, it cannot be rebuilt on click.
              const apkFile = apkArtifact(built.filename, built.bytes);
              upsertFile(apkFile);
              const apkOffer = {
                id: uid('msg'),
                role: 'system' as const,
                content: `**${built.filename} is built.** ${(built.bytes.byteLength / 1024 / 1024).toFixed(1)} MB, signed, exported with Godot at \`${built.godot}\`. Android will warn that it came from outside the Play Store — allow it and it installs.`,
                offer: {
                  kind: 'apk' as const,
                  filename: built.filename,
                  label: `${built.filename} — ${(built.bytes.byteLength / 1024 / 1024).toFixed(1)} MB`,
                  source: apkFile.path,
                },
                createdAt: Date.now(),
              };
              emit(apkOffer);
              void appendMessage({ ...apkOffer, sessionId, suite });
            } else {
              const failed = {
                id: uid('msg'),
                role: 'system' as const,
                content: `**The APK did not build.** ${built.error}\n\nThe project itself is fine — the zip above is the same one. Godot's last words:\n\n\`\`\`\n${built.log.slice(-600).trim()}\n\`\`\``,
                createdAt: Date.now(),
              };
              emit(failed);
              void appendMessage({ ...failed, sessionId, suite });
            }
          }
        }
      }
    }

    // ── Minecraft: hand over something installable ──────────────────────────
    //
    // A Bedrock add-on is a ZIP of JSON with no build step, so it never needed
    // the terminal bridge — which was the only packaging path the runtime had.
    // The result was a correct pack that stopped at "here are some files",
    // which from the user's side is simply "it did not build my mod".
    if (files.length) {
      const packs = detectPacks(files);
      const exported = buildPackExport(packs, input.slice(0, 48) || 'chomugiri-addon');
      if (exported) {
        evidence.artifactProduced = true;

        // Checked before it is handed over: a pack can be valid JSON and still
        // fail at the import screen, and that failure happens on the user's
        // device long after the run that caused it.
        const problems = validatePacks(packs);
        const blockers = problems.filter((p) => p.severity === 'blocker');
        const warnings = problems.filter((p) => p.severity === 'warning');

        const header = blockers.length
          ? `**This add-on will not import yet.** ${describeExport(exported)}`
          : `**Your add-on is ready.** ${describeExport(exported)}`;

        const body = [
          header,
          '',
          ...(blockers.length
            ? ['Fix these first:', '', ...blockers.map((p) => `- ${p.message}`), '']
            : [
                exported.packs > 1
                  ? 'Open it on a device with Minecraft installed and both packs import together.'
                  : 'Open it on a device with Minecraft installed to import it.',
                '',
              ]),
          ...(warnings.length ? ['Worth knowing:', '', ...warnings.map((p) => `- ${p.message}`)] : []),
        ].join('\n');

        const offer = {
          id: uid('msg'),
          role: 'system' as const,
          content: body,
          createdAt: Date.now(),
          // Offered even when it has blockers: the user may want to inspect or
          // repair it by hand rather than be told no.
          offer: { kind: 'minecraft-pack' as const, filename: exported.filename, label: describeExport(exported) },
        };
        emit(offer);
        void appendMessage({ ...offer, sessionId, suite });
      }
    }

    // ── Report the work ─────────────────────────────────────────────────────
    // Files landing silently in a panel leaves the obvious question unanswered:
    // what is in them, and which one holds the thing that was asked for. This
    // says so per file, from the file's own contents.
    if (files.length) {
      const summary = renderWorkLog(
        describeFileWork(files, filesBefore),
        commandsOf(artifacts).filter((c) => c.complete && c.command),
      );
      if (summary) {
        const note = {
          id: uid('msg'),
          role: 'system' as const,
          content: summary,
          createdAt: Date.now(),
        };
        emit(note);
        void appendMessage({ ...note, sessionId, suite });
      }
    }

    // ── Execute terminal steps ──────────────────────────────────────────────
    if (lane === 'B') {
      const commands = commandsOf(artifacts).filter((c) => c.complete && c.command);

      // A build request that comes back with no files and no terminal
      // commands did not fail loudly — it just chatted, leaving "why didn't
      // this build anything?" with no answer. This is the model not
      // following the ```bash path=@terminal / file-block convention the
      // system prompt asks for, which weaker or generic custom-endpoint
      // models are the most likely to do — say so plainly instead of ending
      // the run in silence.
      if (!files.length && !commands.length && !stillTruncated) {
        const isCustom = selection.provider === 'custom';
        const body = [
          "This model's reply didn't include any files or terminal commands, so nothing was built.",
          isCustom
            ? `${selection.model} (custom endpoint) may not reliably follow the file/terminal block format this app builds with — that's a model capability limit, not a sign the bridge or terminal is missing. Try asking again, or switch to one of the built-in models (Settings → Models) for build tasks.`
            : `${selection.model} answered conversationally instead of emitting buildable output. Try rephrasing as a direct build request, or try again.`,
        ].join('\n\n');
        const note = {
          id: uid('msg'),
          role: 'system' as const,
          content: body,
          createdAt: Date.now(),
        };
        emit(note);
        void appendMessage({ ...note, sessionId, suite });
      }

      if (commands.length) {
        setRightPaneTab('terminal');

        // Push generated files to the bridge workspace first — commands almost
        // always operate on them.
        //
        // The whole workspace, not just this run's files: a follow-up like
        // "turn that site into an APK" runs `cp index.html …` against files an
        // earlier run wrote, and those have to be on the bridge too.
        const workspace = new Map(useWorkspace.getState().files);
        for (const f of files) workspace.set(f.path, f);
        // Files the user attached are text the model has already read; making
        // them available on the bridge too is what lets a command `cp` them
        // instead of the model writing them all out again.
        for (const a of attachments) {
          if (a.text && !workspace.has(a.name)) {
            workspace.set(a.name, {
              kind: 'file',
              path: a.name,
              language: languageForPath(a.name),
              content: a.text,
              complete: true,
              bytes: a.bytes,
            });
          }
        }
        if (workspace.size && (heartbeat.status === 'online' || heartbeat.status === 'degraded')) {
          try {
            await useWorkspace.getState().bridge.writeFiles(
              [...workspace.values()].map((f) => ({ path: f.path, content: f.content })),
            );
            useWorkspace.getState().appendTerminal({
              stream: 'system',
              text: `⇪ synced ${workspace.size} file${workspace.size === 1 ? '' : 's'} to the bridge workspace`,
            });
          } catch (err) {
            useWorkspace.getState().appendTerminal({
              stream: 'system',
              text: `⚠  file sync failed: ${(err as Error).message}`,
            });
          }
        }

        const commandResults: CommandOutcome[] = [];
        for (const command of commands) {
          if (controller.signal.aborted) break;
          const startedAt = Date.now();
          const runOnce = () =>
            executeCommand(command.command, {
              cwd: command.cwd,
              sessionId,
              suite,
              signal: controller.signal,
              narrate: true,
            });
          let outcome = await runOnce();

          // A download that did not finish is not a verdict on the project: one
          // more attempt, said out loud. A second identical failure still goes
          // through the anti-loop guard like any other.
          let retried = false;
          if (
            !outcome.ok &&
            !outcome.skipped &&
            !controller.signal.aborted &&
            looksTransient(`${outcome.stderr}\n${outcome.stdout.slice(-4000)}`)
          ) {
            retried = true;
            useWorkspace.getState().appendTerminal({
              stream: 'system',
              text: '↻ that failure looks like a network hiccup (a download that did not finish) — trying once more',
            });
            outcome = await runOnce();
          }

          commandResults.push({
            command: command.command,
            cwd: command.cwd,
            ok: outcome.ok,
            exitCode: outcome.exitCode,
            durationMs: Date.now() - startedAt,
            skipped: outcome.skipped,
            retried,
            errorExcerpt: outcome.ok ? undefined : (outcome.stderr || outcome.stdout || outcome.message || ''),
          });
          // A command parked because the bridge is offline did not run, so it
          // is neither a success nor a failure to report.
          if (outcome.skipped !== 'offline') {
            evidence.commandsRun += 1;
            if (!outcome.ok) evidence.commandsFailed += 1;
          }
          // A ban or a hard failure stops the sequence; continuing would run
          // dependent commands against a broken state.
          if (!outcome.ok && outcome.skipped !== 'offline') break;
        }

        // The chat transcript otherwise ends looking clean even when the last
        // command failed — that only ever showed up in the separate Terminal
        // tab. Post the real per-command result, with the actual error text
        // for anything that failed, right where the rest of the run is read.
        const commandSummary = renderCommandLog(commandResults);
        if (commandSummary) {
          const note = { id: uid('msg'), role: 'system' as const, content: commandSummary, createdAt: Date.now() };
          emit(note);
          void appendMessage({ ...note, sessionId, suite });
        }

        // A built artifact buried in terminal scrollback may as well not exist.
        // Collect and post it as a tappable link in the transcript.
        try {
          const collected = await useWorkspace.getState().bridge.collect(['.apk', '.aab', '.zip', '.mcpack', '.mcaddon']);
          if (collected.count) {
            evidence.artifactProduced = true;
            const bridgeClient = useWorkspace.getState().bridge;
            const lines = collected.collected.map(
              (a) => `- [\`${a.name}\`](${bridgeClient.artifactUrl(a.name)}) — ${(a.bytes / 1024 / 1024).toFixed(1)} MB`,
            );
            const body = [
              `### Build artifacts (${collected.count})`,
              '',
              ...lines,
              '',
              '_Served from your bridge. The link works while the tunnel is up._',
            ].join('\n');

            const artifactId = uid('msg');
            emit({
              id: artifactId,
              role: 'assistant',
              content: body,
              lane,
              createdAt: Date.now(),
            });
            void appendMessage({ id: artifactId, sessionId, suite, role: 'assistant', content: body, createdAt: Date.now(), lane });
          }
        } catch {
          // Collection is a convenience; a failure here must not fail the run.
        }
      }

      // ── Reconcile the plan ────────────────────────────────────────────────
      const current = useWorkspace.getState().plan;
      if (current) {
        const updated = current.tasks.map((task) => {
          if (task.status === 'in_progress') return { ...task, status: 'completed' as const, endedAt: Date.now() };
          if (task.status === 'pending' && !requiresBridge(task) && files.length) {
            return { ...task, status: 'completed' as const, endedAt: Date.now() };
          }
          if (task.status === 'pending' && requiresBridge(task) && heartbeat.status !== 'online') {
            return { ...task, status: 'blocked' as const, detail: 'Waiting on the terminal bridge.' };
          }
          return task;
        });

        const next = { ...current, tasks: updated };
        setPlan(next);

        const progress = planProgress(next);
        if (progress.blocked) {
          useWorkspace.getState().appendTerminal({
            stream: 'system',
            text: `⏸  ${progress.blocked} step${progress.blocked === 1 ? '' : 's'} parked on the terminal bridge. They resume automatically once the tunnel is up.`,
          });
        }
      }
    }

    // ── Settle the checklist ────────────────────────────────────────────────
    //
    // Nothing used to complete a task, so the HUD read "0/7 complete" through a
    // run that had done all seven things. Steps tick on the evidence above;
    // whatever is left had no evidence and is marked skipped rather than being
    // claimed.
    const finalPlan = useWorkspace.getState().plan;
    if (finalPlan) {
      setPlan(settleRemaining(advancePlan(finalPlan, evidence), evidence));
    }

    void touchSession(sessionId, {
      title: input.slice(0, 80) || 'Untitled run',
      model: selection.model,
      provider: selection.provider,
      lane,
    });
  } finally {
    stopPhrases();

    // ── Tell the user it finished, if they are not watching ─────────────────
    //
    // A long build is something you start and then go and do something else.
    // Announcing it only in the transcript means the one case that needs an
    // announcement — nobody is looking at the transcript — is the one case it
    // does not cover. So: a notice when the tab is hidden or the user has moved
    // to another session, and silence when they are already watching it happen.
    const after = useWorkspace.getState();
    const announce = shouldNotify({
      currentSessionId: after.sessionId,
      runSessionId: sessionId,
      hidden: typeof document !== 'undefined' && document.hidden,
      aborted: controller.signal.aborted,
    });

    const finished = after.messages.find((m) => m.id === assistantId);

    // The plan and files stay in the slot, owned by this session: the views hide them from other
    // sessions, and a follow-up in this one (a queued "now package it") still finds its work.

    if (announce) {
      after.pushNotice({
        sessionId,
        suite,
        topic: noticeTopic(input),
        status: finished?.error ? 'failed' : 'done',
        detail: finished?.error ? noticeTopic(finished.error) : undefined,
      });
    }

    // Let the shell go. The in-app notice above is only seen by someone looking
    // at the app; when the run was left to finish in the background, the shell
    // posts the one dismissible notification that says so.
    void runFinished({
      topic: noticeTopic(input),
      ok: !finished?.error,
      summary: finished?.error ? noticeTopic(finished.error, 120) : noticeTopic(input, 120),
      notify: announce,
    });
  }
}

/** Retry the parked bridge steps once the heartbeat recovers. */
export async function resumeParkedWork(): Promise<void> {
  const { plan, setPlan, heartbeat, appendTerminal } = useWorkspace.getState();
  if (!plan || heartbeat.status !== 'online') return;

  const parked = plan.tasks.filter((t) => t.status === 'blocked' && requiresBridge(t));
  if (!parked.length) return;

  appendTerminal({
    stream: 'system',
    text: `▶  Bridge is back. ${parked.length} parked step${parked.length === 1 ? '' : 's'} are runnable again.`,
  });

  setPlan({
    ...plan,
    tasks: plan.tasks.map((t) =>
      t.status === 'blocked' && requiresBridge(t) ? { ...t, status: 'pending' as const, detail: undefined } : t,
    ),
  });
}
