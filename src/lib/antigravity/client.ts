/**
 * Antigravity connector (experimental) — talks to the `agy` language-server hub that AntiGem supervises.
 *
 * How it connects, in the order it happens:
 *   1. The AntiGem Go bridge (`agy_ide_bridge`, default port 8080) is reached at `bridgeUrl`. Its WebSocket `/ws` greets every client
 *      with a `hub_status` frame carrying the hub's port and the hub's own CSRF token.
 *   2. The hub (the Antigravity daemon) is then called directly over the Connect protocol with JSON bodies — the same RPCs the
 *      AntiGem app calls over gRPC: GetAvailableModels, StartCascade, SendUserCascadeMessage, StreamAgentStateUpdates.
 *   3. Every request carries the "framed" header AntiGem patches into the daemon: `x-ag<12-char token>_9qx: <csrf>`.
 *
 * Nothing here is sent to any server of ours; the browser talks to your own device (or the tunnel you gave it).
 * Written from AntiGem's protocol sources and exercised against a mock hub (tests/antigravity.test.ts); it has NOT been run against a
 * live daemon, so every step reports exactly what the hub answered (see `AgTrace`) to make a mismatch quick to find.
 */
import type { ModelDescriptor, StreamFrame, ChatMessage } from '../providers/types.ts';

const SERVICE = 'exa.language_server_pb.LanguageServerService';
const PREFIX = 'x-ag';
const SUFFIX = '_9qx';
const TOKEN_LEN = 12;

export interface AgConfig {
  /** AntiGem Go bridge, e.g. http://127.0.0.1:8080 (or the tunnel URL in front of it). */
  bridgeUrl: string;
  /** The 12-character security token the bridge prints at start-up. */
  token: string;
  /** Filled by `connect()`; override only to point at a hub directly. */
  hubUrl?: string;
  csrf?: string;
}

export interface AgTraceEntry {
  step: string;
  ok: boolean;
  detail: string;
}

export type AgTrace = (entry: AgTraceEntry) => void;

export function framedHeader(token: string): string {
  const t = token.trim();
  const padded = t.length > TOKEN_LEN ? t.slice(0, TOKEN_LEN) : t.padEnd(TOKEN_LEN, ' ');
  return `${PREFIX}${padded}${SUFFIX}`;
}

function trimUrl(u: string): string {
  return u.trim().replace(/\/+$/, '');
}

function authHeaders(cfg: AgConfig): Record<string, string> {
  return { [framedHeader(cfg.token)]: cfg.csrf || 'true' };
}

// ── sign-in (through the bridge) ─────────────────────────────────────────────

/**
 * Antigravity's Google sign-in, driven by the bridge: `POST /api/auth/start-login` makes the hub start a login, and the hub's login
 * address then shows up at `GET /api/auth/login-url`. Open that address, sign in with Google there, and the hub holds the account.
 */
export async function startLogin(cfg: AgConfig, opts: { waitMs?: number; pollMs?: number } = {}): Promise<string> {
  const base = trimUrl(cfg.bridgeUrl);
  const headers = { 'Content-Type': 'application/json', ...authHeaders({ ...cfg, csrf: undefined }) };
  const post = await fetch(`${base}/api/auth/start-login`, { method: 'POST', headers, body: '{}' });
  if (post.status === 401 || post.status === 403) throw new AgError('The bridge refused the security token — copy it again from AntiGem.', post.status, 'unauthenticated');
  if (!post.ok) throw new AgError(`start-login → HTTP ${post.status}`, post.status);
  const deadline = Date.now() + (opts.waitMs ?? 15000);
  for (;;) {
    const res = await fetch(`${base}/api/auth/login-url`, { headers });
    if (res.ok) {
      const j = (await res.json()) as { loginUrl?: string };
      if (j.loginUrl) return j.loginUrl;
    }
    if (Date.now() > deadline) throw new AgError('The hub did not return a sign-in address. Is the Antigravity hub running inside AntiGem?');
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 800));
  }
}

// ── discovery ─────────────────────────────────────────────────────────────────

export interface HubStatus {
  status: string;
  port: number;
  csrf: string;
  error?: string;
}

/** Asks the bridge where the hub is: the first `hub_status` frame on its WebSocket. */
export function discoverHub(
  cfg: AgConfig,
  opts: { timeoutMs?: number; WS?: typeof WebSocket } = {},
): Promise<HubStatus> {
  const WS = opts.WS ?? WebSocket;
  const base = trimUrl(cfg.bridgeUrl).replace(/^http/i, 'ws');
  const url = `${base}/ws?token=${encodeURIComponent(cfg.token.trim())}`;
  return new Promise((resolve, reject) => {
    let done = false;
    const ws = new WS(url);
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try { ws.close(); } catch { /* already closed */ }
        reject(new Error('The bridge did not answer within a few seconds — check the URL, the token and that AntiGem is running.'));
      }
    }, opts.timeoutMs ?? 8000);
    ws.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        if (msg.type === 'hub_status' && !done) {
          done = true;
          clearTimeout(timer);
          ws.close();
          resolve({
            status: String(msg.status ?? ''),
            port: Number(msg.port ?? 0),
            csrf: String(msg.csrf_token ?? msg.csrfToken ?? ''),
            error: msg.error ? String(msg.error) : undefined,
          });
        }
      } catch { /* not JSON: ignore */ }
    };
    ws.onerror = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(new Error('Could not open the bridge WebSocket. Is the URL right (and reachable from this device)?'));
      }
    };
  });
}

/** Resolves the hub address + CSRF token and returns a config ready for the RPC calls. */
export async function connect(cfg: AgConfig, trace?: AgTrace, WS?: typeof WebSocket): Promise<AgConfig> {
  const hub = await discoverHub(cfg, { WS });
  trace?.({ step: 'bridge', ok: true, detail: `hub ${hub.status || 'unknown'} on port ${hub.port}${hub.error ? ` — ${hub.error}` : ''}` });
  if (!hub.port) throw new Error(hub.error || 'The bridge is up, but the Antigravity hub is not running yet (no port reported).');
  let host: string;
  try {
    host = new URL(trimUrl(cfg.bridgeUrl)).hostname;
  } catch {
    throw new Error('The bridge URL is not a valid URL.');
  }
  return { ...cfg, hubUrl: cfg.hubUrl || `http://${host}:${hub.port}`, csrf: hub.csrf };
}

// ── Connect protocol ─────────────────────────────────────────────────────────

export class AgError extends Error {
  // Plain fields, not constructor parameter properties: the test scripts run this file with node's strip-only TypeScript mode.
  status: number;
  code: string;
  constructor(message: string, status = 0, code = 'ag_error') {
    super(message);
    this.name = 'AgError';
    this.status = status;
    this.code = code;
  }
}

async function unary<T>(cfg: AgConfig, method: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (!cfg.hubUrl) throw new AgError('Not connected: no hub address.');
  const res = await fetch(`${trimUrl(cfg.hubUrl)}/${SERVICE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', ...authHeaders(cfg) },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new AgError('The hub refused the security token (HTTP ' + res.status + '). Re-copy the token from AntiGem.', res.status, 'unauthenticated');
    throw new AgError(`${method} → HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new AgError(`${method} returned something that is not JSON: ${text.slice(0, 200)}`);
  }
}

function envelope(json: unknown): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(json));
  const out = new Uint8Array(5 + payload.length);
  out[0] = 0;
  new DataView(out.buffer).setUint32(1, payload.length, false);
  out.set(payload, 5);
  return out;
}

/**
 * Server-streaming call: yields each JSON message the hub sends until it ends the stream.
 * The request goes out immediately (not on the first `next()`), so a caller can subscribe and then send its prompt without a gap.
 */
function serverStream<T>(cfg: AgConfig, method: string, body: unknown, signal?: AbortSignal): AsyncGenerator<T> {
  if (!cfg.hubUrl) throw new AgError('Not connected: no hub address.');
  const pending = fetch(`${trimUrl(cfg.hubUrl)}/${SERVICE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/connect+json', 'Connect-Protocol-Version': '1', ...authHeaders(cfg) },
    body: envelope(body) as unknown as BodyInit,
    signal,
  });
  pending.catch(() => undefined);   // surfaced when the generator awaits it
  return readStream<T>(pending, method);
}

async function* readStream<T>(pending: Promise<Response>, method: string): AsyncGenerator<T> {
  const res = await pending;
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new AgError(`${method} → HTTP ${res.status}: ${t.slice(0, 300)}`, res.status);
  }
  const reader = res.body.getReader();
  let buf = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      const joined = new Uint8Array(buf.length + value.length);
      joined.set(buf);
      joined.set(value, buf.length);
      buf = joined;
    }
    while (buf.length >= 5) {
      const flags = buf[0];
      const len = new DataView(buf.buffer, buf.byteOffset + 1, 4).getUint32(0, false);
      if (buf.length < 5 + len) break;
      const chunk = buf.slice(5, 5 + len);
      buf = buf.slice(5 + len);
      const text = new TextDecoder().decode(chunk);
      if (flags & 2) {
        // End-of-stream frame: an `error` member means the call failed.
        try {
          const end = JSON.parse(text) as { error?: { code?: string; message?: string } };
          if (end.error) throw new AgError(`${method}: ${end.error.code ?? 'error'} — ${end.error.message ?? ''}`);
        } catch (e) {
          if (e instanceof AgError) throw e;
        }
        return;
      }
      yield JSON.parse(text) as T;
    }
    if (done) return;
  }
}

// ── models ───────────────────────────────────────────────────────────────────

interface ModelDetailsJson {
  displayName?: string;
  display_name?: string;
  supportsImages?: boolean;
  supportsThinking?: boolean;
  recommended?: boolean;
  maxTokens?: number;
  disabled?: boolean;
  description?: string;
  model?: string;
  modelProvider?: string;
}

export interface AgModel {
  /** Key in the hub's catalogue — what Chomugiri stores as the model id. */
  id: string;
  /** The `MODEL_…` enum the cascade request needs. */
  enumName: string;
}

/** Every model the signed-in Antigravity account can use, as Chomugiri model descriptors. */
export async function listModels(cfg: AgConfig, trace?: AgTrace): Promise<{ descriptors: ModelDescriptor[]; map: Record<string, AgModel> }> {
  const res = await unary<{ response?: { models?: Record<string, ModelDetailsJson> }; models?: Record<string, ModelDetailsJson> }>(
    cfg,
    'GetAvailableModels',
    { forceRefresh: true },
  );
  const models = res.response?.models ?? res.models ?? {};
  const descriptors: ModelDescriptor[] = [];
  const map: Record<string, AgModel> = {};
  for (const [key, d] of Object.entries(models)) {
    if (d.disabled) continue;
    const label = d.displayName ?? d.display_name ?? key;
    const enumName = d.model && d.model !== 'MODEL_UNSPECIFIED' ? d.model : key;
    map[key] = { id: key, enumName };
    const caps: ModelDescriptor['capabilities'] = ['chat', 'tools'];
    if (d.supportsThinking) caps.push('reasoning');
    if (d.supportsImages) caps.push('vision');
    descriptors.push({
      id: key,
      provider: 'antigravity',
      label: `Antigravity · ${label}`,
      vendor: 'Antigravity',
      capabilities: caps,
      contextWindow: d.maxTokens || undefined,
      emitsReasoning: Boolean(d.supportsThinking),
      origin: 'catalogue',
      note: d.description || 'Runs in the Antigravity agent sandbox through your AntiGem hub.',
    });
  }
  trace?.({ step: 'models', ok: true, detail: `${descriptors.length} models` });
  return { descriptors, map };
}

// ── chat ─────────────────────────────────────────────────────────────────────

/** Chomugiri sends the whole conversation each time; the Antigravity cascade takes one prompt, so history is flattened into it. */
export function flattenMessages(messages: ChatMessage[]): string {
  const text = (m: ChatMessage): string =>
    typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text ?? '' : '[image]')).join('\n');
  const system = messages.filter((m) => m.role === 'system').map(text).join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');
  const last = turns[turns.length - 1];
  const history = turns.slice(0, -1);
  const parts: string[] = [];
  if (system) parts.push(`<instructions>\n${system}\n</instructions>`);
  if (history.length) parts.push(`<conversation so far>\n${history.map((m) => `${m.role}: ${text(m)}`).join('\n')}\n</conversation so far>`);
  if (last) parts.push(text(last));
  return parts.join('\n\n');
}

interface StepJson {
  plannerResponse?: { response?: string; thinking?: string; modifiedResponse?: string };
  planner_response?: { response?: string; thinking?: string };
}

interface AgentUpdateJson {
  update?: {
    status?: string;
    fullyIdle?: boolean;
    mainTrajectoryUpdate?: { stepsUpdate?: { indices?: number[]; steps?: StepJson[] }; fullyIdle?: boolean };
  };
}

function uuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'ag-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Runs one prompt through a fresh cascade and yields Chomugiri stream frames. */
export async function* chatStream(
  cfg: AgConfig,
  model: { id: string; enumName?: string },
  messages: ChatMessage[],
  opts: { signal?: AbortSignal; trace?: AgTrace; idleTimeoutMs?: number } = {},
): AsyncGenerator<StreamFrame> {
  const { signal, trace } = opts;
  const cascadeId = uuid();
  const enumName = model.enumName || model.id;
  yield { type: 'meta', provider: 'antigravity', model: model.id };

  await unary(cfg, 'StartCascade', {
    cascadeId,
    source: 'CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT',
    requestedModel: enumName,
  }, signal);
  trace?.({ step: 'StartCascade', ok: true, detail: cascadeId });

  // Subscribe first, so nothing the planner says is missed, then send the prompt.
  const updates = serverStream<AgentUpdateJson>(cfg, 'StreamAgentStateUpdates', { conversationId: cascadeId, subscriberId: uuid() }, signal);
  await unary(cfg, 'SendUserCascadeMessage', {
    cascadeId,
    items: [{ text: flattenMessages(messages) }],
    metadata: { ideName: 'antigravity' },
    cascadeConfig: { plannerConfig: { requestedModel: { model: enumName } } },
  }, signal);
  trace?.({ step: 'SendUserCascadeMessage', ok: true, detail: 'prompt sent' });

  const sentText = new Map<number, number>();
  const sentThink = new Map<number, number>();
  let sawAnswer = false;
  let sawRunning = false;
  const deadline = Date.now() + (opts.idleTimeoutMs ?? 240_000);

  for await (const frame of updates) {
    const u = frame.update;
    if (!u) continue;
    const upd = u.mainTrajectoryUpdate?.stepsUpdate;
    const steps = upd?.steps ?? [];
    const indices = upd?.indices ?? [];
    for (let i = 0; i < steps.length; i++) {
      const idx = indices[i] ?? i;
      const pr = steps[i].plannerResponse ?? steps[i].planner_response;
      if (!pr) continue;
      const think = pr.thinking ?? '';
      const prevT = sentThink.get(idx) ?? 0;
      if (think.length > prevT) {
        yield { type: 'reasoning', delta: think.slice(prevT) };
        sentThink.set(idx, think.length);
      }
      const resp = (pr as { modifiedResponse?: string }).modifiedResponse || pr.response || '';
      const prev = sentText.get(idx) ?? 0;
      if (resp.length > prev) {
        yield { type: 'delta', delta: resp.slice(prev) };
        sentText.set(idx, resp.length);
        sawAnswer = true;
      }
    }
    const status = u.status ?? '';
    if (status.includes('RUNNING') || status.includes('BUSY')) sawRunning = true;
    const idle = status.includes('IDLE') || u.fullyIdle || u.mainTrajectoryUpdate?.fullyIdle;
    if (idle && (sawAnswer || sawRunning)) break;
    if (Date.now() > deadline) throw new AgError('Antigravity did not finish in time.');
  }
  yield { type: 'done', finishReason: 'stop' };
}

/** Same as `chatStream`, gathered into a string (the non-streaming callers: planning, memory capture). */
export async function chatOnce(cfg: AgConfig, model: { id: string; enumName?: string }, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  let out = '';
  for await (const f of chatStream(cfg, model, messages, { signal })) {
    if (f.type === 'delta') out += f.delta;
  }
  return out;
}
