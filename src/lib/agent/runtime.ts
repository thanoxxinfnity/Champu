'use client';

import { classifyLocal, type Classification } from './router';
import { withKeys } from '@/lib/keys';
import { buildSystemPrompt } from './system-prompt';
import { heuristicPlan, parsePlan, PLANNER_PROMPT, planProgress, parkBridgeTasks, requiresBridge, type Plan } from './planner';
import { extractArtifacts, filesOf, commandsOf, mergeFiles, type FileArtifact } from './artifacts';
import { describeFileWork, renderWorkLog } from './worklog';
import { noticeTopic, shouldNotify } from './notify';
import { advancePlan, NO_EVIDENCE, settleRemaining, type RunEvidence } from './progress';
import { buildPackExport, describeExport, detectPacks } from '@/lib/suites/minecraft/pack';
import type { ChatMessage, ProviderId, StreamFrame } from '@/lib/providers/types';
import type { CustomEndpointConfig } from '@/lib/providers/types';
import { useWorkspace, type ChatAttachment, THINKING_PHRASES, LANE_B_PHRASES } from '@/lib/store';
import { PLANNER_NIM_MODEL } from '@/lib/providers/registry';
import { draftSystemSuffix, pickAngles } from './drafts';
import { scanForSecrets, hasBlockingSecret } from '@/lib/security/secrets';
import { appendMessage, createSession, touchSession, upsertArtifact, recordRun, uid } from '@/lib/db/history';
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
): Promise<{ content: string; reasoning: string; usage?: StreamFrame & { type: 'usage' }; error?: string }> {
  let content = '';
  let reasoning = '';
  let usage: (StreamFrame & { type: 'usage' }) | undefined;
  let error: string | undefined;

  let res: Response;
  try {
    res = await fetch('/api/chat', withKeys({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
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

  return { content, reasoning, usage, error };
}

/** Single-shot completion for internal steps (planning, classification). */
async function complete(
  body: { provider: ProviderId; model: string; messages: ChatMessage[]; json?: boolean; custom?: CustomEndpointConfig; maxTokens?: number },
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/chat', withKeys({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: false }),
    signal,
  }));
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Gateway returned ${res.status}`);
  }
  const data = (await res.json()) as { content: string };
  return data.content;
}

// ── Thinking bubble ─────────────────────────────────────────────────────────

function startPhraseCycle(lane: 'A' | 'B'): () => void {
  const phrases = lane === 'B' ? [...LANE_B_PHRASES, ...THINKING_PHRASES] : THINKING_PHRASES;
  const { setThinking } = useWorkspace.getState();

  let index = 0;
  setThinking(true, phrases[0]);

  const timer = setInterval(() => {
    index = (index + 1) % phrases.length;
    setThinking(true, phrases[index]);
  }, 2600);

  return () => {
    clearInterval(timer);
    setThinking(false);
  };
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

function historyFor(limit = 12): ChatMessage[] {
  const { messages } = useWorkspace.getState();
  return messages
    .filter((m) => !m.error && m.content.trim())
    .slice(-limit)
    .map((m) => ({ role: m.role === 'system' ? ('system' as const) : m.role, content: m.content }));
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
  opts: { cwd?: string; sessionId?: string; suite?: SuiteId; signal?: AbortSignal } = {},
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

export async function send(opts: SendOptions): Promise<void> {
  const state = useWorkspace.getState();
  const {
    selection, activeSuite, guard, heartbeat, pushMessage, patchMessage,
    setPlan, setTaskStatus, upsertFile, setAbortController, setRightPaneTab,
  } = state;

  const suite = opts.suite ?? activeSuite;
  const attachments = opts.attachments ?? [];
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

  // Session bootstrap.
  let sessionId = state.sessionId;
  if (!sessionId) {
    const session = await createSession(suite, input.slice(0, 80) || 'Untitled run', {
      provider: selection.provider,
      model: selection.model,
    });
    sessionId = session.id;
    useWorkspace.getState().setSessionId(sessionId);
  }

  const controller = new AbortController();
  setAbortController(controller);

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
  pushMessage(userMessage);
  void appendMessage({ ...userMessage, sessionId, suite });

  const assistantId = uid('msg');
  pushMessage({
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

  const stopPhrases = startPhraseCycle(lane);
  const startedAt = Date.now();

  try {
    // ── Plan (Lane B only) ──────────────────────────────────────────────────
    let plan: Plan | null = null;
    if (lane === 'B') {
      useWorkspace.getState().setThinking(true, 'Decomposing into atomic steps...');
      plan = await buildPlan(input, selection, suite, opts.custom, controller.signal);

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

    // ── Stream the answer ───────────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt({
      lane,
      suite,
      bridgeStatus:
        heartbeat.status === 'online' ? 'online'
          : heartbeat.status === 'degraded' ? 'degraded'
            : heartbeat.status === 'unknown' || heartbeat.status === 'connecting' ? 'unknown'
              : 'offline',
      bridgeDetail: heartbeat.health
        ? `Host: ${heartbeat.health.platform}/${heartbeat.health.arch}, workspace ${heartbeat.health.workspace}. Toolchain — java: ${heartbeat.health.toolchains.java ?? 'absent'}, gradle: ${heartbeat.health.toolchains.gradle ?? 'absent'}, android sdk: ${heartbeat.health.toolchains.androidSdk ?? 'absent'}, node: ${heartbeat.health.toolchains.node ?? 'absent'}, python: ${heartbeat.health.toolchains.python ?? 'absent'}.`
        : heartbeat.lastError ?? undefined,
      todos: plan?.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
      failedApproaches: guard.bannedApproaches(),
      attachments: attachments.map((a) => ({ name: a.name, kind: a.kind, bytes: a.bytes })),
      workspaceFiles: [...useWorkspace.getState().files.keys()],
    });

    const history = historyFor(10);
    const userContent = buildUserContent(input, attachments);

    // Drafts replace the single answer entirely; the chosen one is committed
    // into the transcript when the user picks it.
    if (useWorkspace.getState().draftsEnabled && !opts.forceLane) {
      patchMessage(assistantId, { streaming: false, content: '' });
      useWorkspace.getState().setThinking(true, 'Drafting two approaches...');

      await runDrafts({
        input,
        systemPrompt,
        history,
        userContent,
        lane,
        suite,
        selection,
        custom: opts.custom,
        signal: controller.signal,
      });

      // The placeholder turn is a slot the chosen draft fills in.
      patchMessage(assistantId, { content: '', streaming: false });
      return;
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userContent },
    ];

    let seenFiles = new Map<string, FileArtifact>();

    const result = await streamCompletion(
      {
        provider: selection.provider,
        model: selection.model,
        messages,
        temperature: lane === 'B' ? 0.25 : 0.5,
        maxTokens: 8192,
        custom: opts.custom,
      },
      {
        onDelta: (_delta, full) => {
          patchMessage(assistantId, { content: full });

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
        onReasoning: (_delta, full) => patchMessage(assistantId, { reasoning: full }),
        onError: (message) => patchMessage(assistantId, { error: message }),
      },
      controller.signal,
    );

    patchMessage(assistantId, {
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
    const files = filesOf(artifacts);

    // Snapshot before writing, so "created" and "updated" mean what they say.
    const filesBefore = new Map(useWorkspace.getState().files);

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

    if (files.length) setRightPaneTab('files');

    // Everything the plan's progress is derived from. Gathered here rather
    // than asked of the model: a checklist should tick on what happened.
    const evidence: RunEvidence = {
      ...NO_EVIDENCE,
      answerChars: result.content.length,
      filesWritten: files.length,
      failed: Boolean(result.error),
    };

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
        const offer = {
          id: uid('msg'),
          role: 'system' as const,
          content:
            `**Your add-on is ready.** ${describeExport(exported)}\n\n` +
            (exported.packs > 1
              ? 'Open it on a device with Minecraft installed and both packs import together.'
              : 'Open it on a device with Minecraft installed to import it.'),
          createdAt: Date.now(),
          offer: { kind: 'minecraft-pack' as const, filename: exported.filename, label: describeExport(exported) },
        };
        pushMessage(offer);
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
        pushMessage(note);
        void appendMessage({ ...note, sessionId, suite });
      }
    }

    // ── Execute terminal steps ──────────────────────────────────────────────
    if (lane === 'B') {
      const commands = commandsOf(artifacts).filter((c) => c.complete && c.command);

      if (commands.length) {
        setRightPaneTab('terminal');

        // Push generated files to the bridge workspace first — commands almost
        // always operate on them.
        if (files.length && (heartbeat.status === 'online' || heartbeat.status === 'degraded')) {
          try {
            await useWorkspace.getState().bridge.writeFiles(
              files.map((f) => ({ path: f.path, content: f.content })),
            );
            useWorkspace.getState().appendTerminal({
              stream: 'system',
              text: `⇪ synced ${files.length} file${files.length === 1 ? '' : 's'} to the bridge workspace`,
            });
          } catch (err) {
            useWorkspace.getState().appendTerminal({
              stream: 'system',
              text: `⚠  file sync failed: ${(err as Error).message}`,
            });
          }
        }

        for (const command of commands) {
          if (controller.signal.aborted) break;
          const outcome = await executeCommand(command.command, {
            cwd: command.cwd,
            sessionId,
            suite,
            signal: controller.signal,
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
            pushMessage({
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
    setAbortController(null);

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

    if (announce) {
      const finished = after.messages.find((m) => m.id === assistantId);
      after.pushNotice({
        sessionId,
        suite,
        topic: noticeTopic(input),
        status: finished?.error ? 'failed' : 'done',
        detail: finished?.error ? noticeTopic(finished.error) : undefined,
      });
    }
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
