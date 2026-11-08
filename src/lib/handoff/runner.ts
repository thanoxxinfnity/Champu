'use client';
/**
 * Computer use, run from anywhere (the chat's /computer-use): one store of live runs — steps, the screen, a pending approval,
 * a question, a secure form — and the actions a card needs (approve, answer, fill the form, stop). It drives the same loop as the
 * Handoff area (loop.ts) with the same safety: the vault, the phishing guard, approvals and "always allow" rules.
 */
import { create } from 'zustand';
import { useWorkspace } from '../store';
import { streamCompletion } from '../providers/chat-client';
import { endpointConfigFor } from '../providers/endpoint-models';
import { GATEWAY_ENDPOINT_ID, GATEWAY_PREFIX } from '../providers/gateway';
import type { ChatMessage } from '../providers/types';
import { getSetting, setSetting } from '../db/history';
import { hasDesktop } from '../bridge/update';
import { loadMemories } from '../memory/store';
import { recall } from '../memory/memory';
import type { Action, Mode } from './actions';
import { runHandoff, type ApprovalRequest, type HandoffEvent, type Screen, type VaultAccess } from './loop';
import { isAllowed, pickMode, siteOf, type AllowRule } from './specialties';
export { pickMode };
import { describeForAgent, fieldValue, findByRef, newItemId } from './vault';
import { useVaultStore } from './vault-store';

export interface ModelPick { provider: string; model: string; endpointId?: string }
export const AUTO_VISION: ModelPick = { provider: 'custom', model: `${GATEWAY_PREFIX}vision`, endpointId: GATEWAY_ENDPOINT_ID };
export const ALLOW_KEY = 'handoff.allow.v1';

export async function callModel(m: ModelPick, messages: ChatMessage[], signal?: AbortSignal, maxTokens = 1200): Promise<string> {
  const r = await streamCompletion({ provider: m.provider as never, model: m.model, maxTokens, temperature: 0.2, custom: endpointConfigFor(useWorkspace.getState().endpoints, m), messages }, {}, signal);
  if (r.error && !r.content) throw new Error(r.error);
  return r.content;
}

/** Does this model read images? The gateway's "vision" route does; a listed model says so in its capabilities. */
export function seesImages(m: ModelPick): boolean {
  return m.model.endsWith('/vision') || useWorkspace.getState().models.some((x) => x.id === m.model && x.capabilities.includes('vision'));
}

export interface RunStep { index: number; label: string; thought: string; verdict: string; ok?: boolean; result?: string; approved?: boolean }
export interface PendingApproval { label: string; reason: string; action: Action; host?: string; rememberable: boolean; kind: string; secret?: { kind: string; label: string } }
export interface SecureAsk { fields: string[]; why: string; site?: string }
export interface LiveRun {
  id: string;
  task: string;
  mode: Mode;
  status: 'running' | 'done' | 'stopped' | 'failed' | 'limit';
  summary: string;
  steps: RunStep[];
  screen: Screen | null;
  statusText: string;
  approval: PendingApproval | null;
  question: string | null;
  secure: SecureAsk | null;
  startedAt: number;
  endedAt?: number;
}

interface RunnerState { runs: Record<string, LiveRun>; set: (id: string, fn: (r: LiveRun) => LiveRun) => void }
export const useRunner = create<RunnerState>((set) => ({
  runs: {},
  set: (id, fn) => set((s) => (s.runs[id] ? { runs: { ...s.runs, [id]: fn(s.runs[id]!) } } : s)),
}));

interface Waiters { abort: AbortController; approve?: (yes: boolean) => void; answer?: (t: string | null) => void; secure?: (refs: string[] | null) => void; oneTime: Map<string, string> }
const waiters = new Map<string, Waiters>();

function vaultAccessFor(oneTime: Map<string, string>, ask: VaultAccess['ask']): VaultAccess {
  return {
    info: () => {
      const v = useVaultStore.getState();
      return v.open ? describeForAgent(v.items, [...oneTime.keys()]) : `The vault is locked, so saved logins and cards are not available.${oneTime.size ? ` Given for this job: ${[...oneTime.keys()].map((k) => `once:${k}`).join(', ')}.` : ''} If the job needs a login, card or code, use request_secret.`;
    },
    get: (ref, field) => {
      if (ref.startsWith('once:')) { const val = oneTime.get(ref.slice(5)); return val ? { value: val, kind: 'once', label: ref.slice(5) } : null; }
      const v = useVaultStore.getState();
      if (!v.open) return null;
      const it = findByRef(ref, v.items);
      const val = it ? fieldValue(it, field) : null;
      if (!it || !val) return null;
      v.touch();
      return { value: val, kind: it.kind, site: it.kind === 'login' ? it.site : undefined, label: it.kind === 'login' ? it.site : it.label };
    },
    ask,
  };
}

/** Starts a run and returns its id at once; the run goes on in the background and its card follows the store. */
export function startComputerUse(opts: { task: string; mode?: Mode; model?: ModelPick; maxSteps?: number; guide?: string; onFinish?: (run: LiveRun) => void }): string | { error: string } {
  const st = useWorkspace.getState();
  const online = st.heartbeat.status === 'online' || st.heartbeat.status === 'degraded';
  if (!online) return { error: 'The Terminal Bridge is not connected (Settings → Terminal Bridge). Computer use needs a computer to work on — the browser and screen run there.' };
  const desktopOk = hasDesktop(st.heartbeat.health as never);
  const picked = opts.mode ? { mode: opts.mode, task: opts.task } : pickMode(opts.task, desktopOk);
  let model: ModelPick = opts.model ?? (st.selection.model ? { provider: st.selection.provider, model: st.selection.model, endpointId: st.selection.endpointId } : AUTO_VISION);
  if (picked.mode === 'desktop' && !seesImages(model)) model = AUTO_VISION;
  const vision = seesImages(model);

  const id = `cu_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const run: LiveRun = { id, task: picked.task, mode: picked.mode, status: 'running', summary: '', steps: [], screen: null, statusText: 'Starting…', approval: null, question: null, secure: null, startedAt: Date.now() };
  useRunner.setState((s) => ({ runs: { ...s.runs, [id]: run } }));
  const set = (fn: (r: LiveRun) => LiveRun) => useRunner.getState().set(id, fn);
  const w: Waiters = { abort: new AbortController(), oneTime: new Map() };
  waiters.set(id, w);

  void (async () => {
    let memory = '';
    try { memory = recall(await loadMemories(), picked.task, { limit: 6 }).map((x) => `- ${x.text}`).join('\n'); } catch { /* none */ }
    const rules = await getSetting<AllowRule[]>(ALLOW_KEY, []).catch(() => [] as AllowRule[]);
    const bridge = useWorkspace.getState().bridge;
    const onEvent = (e: HandoffEvent) => {
      switch (e.kind) {
        case 'status': set((r) => ({ ...r, statusText: e.text })); break;
        case 'screen': set((r) => ({ ...r, screen: e.screen })); break;
        case 'step': set((r) => ({ ...r, steps: [...r.steps, { index: e.index, label: e.label, thought: e.thought, verdict: e.verdict }] })); break;
        case 'result': set((r) => ({ ...r, steps: r.steps.map((s) => (s.index === e.index ? { ...s, ok: e.ok, result: e.text } : s)) })); break;
        case 'approved': set((r) => ({ ...r, steps: r.steps.map((s) => (s.index === e.index ? { ...s, approved: e.yes } : s)) })); break;
        default: break;
      }
    };
    const approve = (req: ApprovalRequest) => new Promise<boolean>((res) => {
      const kind = req.secret?.kind === 'login' ? 'login' : req.action.type;
      if (req.rememberable && isAllowed(Array.isArray(rules) ? rules : [], req.host, kind)) { res(true); return; }
      w.approve = res;
      set((r) => ({ ...r, approval: { label: req.label, reason: req.reason, action: req.action, host: req.host, rememberable: req.rememberable, kind, secret: req.secret } }));
    });
    const ask: VaultAccess['ask'] = (req) => new Promise((res) => { w.secure = res; set((r) => ({ ...r, secure: req })); });
    const result = await runHandoff({ task: picked.task, mode: picked.mode, vision, liveView: true, maxSteps: opts.maxSteps ?? 30, memory, guide: opts.guide, signal: w.abort.signal }, {
      llm: (msgs, signal) => callModel(model, msgs, signal),
      browser: (tool, args) => bridge.browser(tool, args),
      desktop: (body) => bridge.desktop(body),
      shell: (cmd) => bridge.runShell(cmd, { signal: w.abort.signal }),
      image: (name) => bridge.artifactDataUrl(name),
      approve,
      answer: (q) => new Promise((res) => { w.answer = res; set((r) => ({ ...r, question: q })); }),
      vault: vaultAccessFor(w.oneTime, ask),
      onEvent,
    }).catch((e: Error) => ({ status: 'failed' as const, summary: e.message, steps: [] }));
    w.oneTime.clear();
    waiters.delete(id);
    set((r) => ({ ...r, status: result.status, summary: result.summary, statusText: '', approval: null, question: null, secure: null, endedAt: Date.now() }));
    opts.onFinish?.(useRunner.getState().runs[id]!);
  })();
  return id;
}

export async function decideApproval(id: string, yes: boolean, remember = false): Promise<void> {
  const run = useRunner.getState().runs[id];
  const w = waiters.get(id);
  if (!run || !w?.approve) return;
  const a = run.approval;
  if (yes && remember && a?.rememberable && a.host) {
    const rules = await getSetting<AllowRule[]>(ALLOW_KEY, []).catch(() => [] as AllowRule[]);
    const list = Array.isArray(rules) ? rules : [];
    if (!isAllowed(list, a.host, a.kind)) await setSetting(ALLOW_KEY, [...list, { host: siteOf(a.host), kind: a.kind, createdAt: Date.now() }]);
  }
  const res = w.approve; w.approve = undefined;
  useRunner.getState().set(id, (r) => ({ ...r, approval: null }));
  res(yes);
}

export function answerQuestion(id: string, text: string | null): void {
  const w = waiters.get(id);
  if (!w?.answer) return;
  const res = w.answer; w.answer = undefined;
  useRunner.getState().set(id, (r) => ({ ...r, question: null }));
  res(text);
}

export function submitSecureForm(id: string, values: Record<string, string> | null, saveLogin = false): void {
  const run = useRunner.getState().runs[id];
  const w = waiters.get(id);
  if (!run || !w?.secure) return;
  const req = run.secure;
  const res = w.secure; w.secure = undefined;
  useRunner.getState().set(id, (r) => ({ ...r, secure: null }));
  if (!values || !req) { res(null); return; }
  for (const f of req.fields) w.oneTime.set(f, values[f] ?? '');
  const v = useVaultStore.getState();
  if (saveLogin && req.site && v.open && values.password) void v.save([...v.items, { id: newItemId(), kind: 'login', label: '', site: siteOf(req.site), username: values.username ?? values.email ?? '', password: values.password }]).catch(() => {});
  res(req.fields.map((f) => `once:${f}`));
}

export function stopComputerUse(id: string): void {
  const w = waiters.get(id);
  if (!w) return;
  w.abort.abort();
  w.approve?.(false); w.answer?.(null); w.secure?.(null);
}

/** The run, as markdown for the chat history (kept after the live card is gone). */
export function runToMarkdown(r: LiveRun): string {
  const head = r.status === 'done' ? '✅ **Computer use — done**' : r.status === 'failed' ? '⚠️ **Computer use — failed**' : r.status === 'limit' ? '⏹ **Computer use — step limit**' : '⏹ **Computer use — stopped**';
  const steps = r.steps.slice(0, 40).map((s) => `${s.index}. ${s.label}${s.ok === false ? ' ✗' : ''}${s.approved === true ? ' (approved)' : s.approved === false ? ' (refused)' : ''}`).join('\n');
  return `${head} · ${r.mode === 'desktop' ? 'desktop' : 'browser'} · ${r.steps.length} steps\n\n**Job:** ${r.task}\n\n${r.summary}${steps ? `\n\n**Steps**\n${steps}` : ''}`;
}
