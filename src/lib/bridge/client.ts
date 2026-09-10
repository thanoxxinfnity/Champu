/**
 * Terminal bridge client (browser side).
 *
 * Talks directly to the tunnelled agent — the daemon sends `Access-Control-Allow-Origin: *`,
 * so no server hop is needed and terminal output streams at tunnel latency rather
 * than tunnel + Vercel latency.
 *
 * When a tunnel provider strips CORS, `via: 'proxy'` routes through
 * `/api/bridge/*` instead. Both paths expose the same interface.
 */

export type BridgeStatus = 'unknown' | 'connecting' | 'online' | 'degraded' | 'offline' | 'unauthorized';

export interface Toolchains {
  node: string | null;
  npm: string | null;
  git: string | null;
  java: string | null;
  gradle: string | null;
  python: string | null;
  androidSdk: string | null;
  adb: string | null;
  docker: string | null;
  zip: string | null;
}

export interface BridgeHealth {
  ok: boolean;
  agent: string;
  version: string;
  platform: string;
  arch: string;
  node: string;
  workspace: string;
  uptimeSec: number;
  activeRuns: number;
  toolchains: Toolchains;
  allowList: string[] | null;
  serverTime: number;
}

export interface BridgeConfig {
  url: string;
  token: string;
  via?: 'direct' | 'proxy';
}

export interface ExecFrame {
  execId: string;
  type: 'start' | 'stdout' | 'stderr' | 'exit';
  data?: string;
  cmd?: string;
  cwd?: string;
  exitCode?: number | null;
  signal?: string | null;
  durationMs?: number;
  killed?: boolean;
  replay?: boolean;
}

export class BridgeOfflineError extends Error {
  readonly code = 'bridge_offline';
  constructor(message = 'Terminal bridge is offline.') {
    super(message);
    this.name = 'BridgeOfflineError';
  }
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export class BridgeClient {
  private config: BridgeConfig;

  constructor(config: BridgeConfig) {
    this.config = { ...config, url: normalizeUrl(config.url) };
  }

  update(config: Partial<BridgeConfig>): void {
    this.config = { ...this.config, ...config, url: normalizeUrl(config.url ?? this.config.url) };
  }

  get configured(): boolean {
    return Boolean(this.config.url && this.config.token);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      // ngrok free tier serves an HTML interstitial without this.
      'ngrok-skip-browser-warning': 'true',
    };
  }

  private endpoint(path: string): string {
    if (this.config.via === 'proxy') {
      return `/api/bridge/proxy?path=${encodeURIComponent(path)}`;
    }
    return `${this.config.url}${path}`;
  }

  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
    if (!this.configured) throw new BridgeOfflineError('Bridge URL or token is not configured.');

    const proxied = this.config.via === 'proxy';
    const headers: Record<string, string> = {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(proxied
        ? { 'X-Bridge-Url': this.config.url, 'X-Bridge-Token': this.config.token }
        : this.headers()),
      ...((init.headers as Record<string, string>) ?? {}),
    };

    let res: Response;
    try {
      res = await fetch(this.endpoint(path), {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
    } catch (err) {
      throw new BridgeOfflineError(
        `Cannot reach the bridge at ${this.config.url}: ${(err as Error).message}. Is the tunnel up?`,
      );
    }

    if (res.status === 401) {
      const e = new Error('Bridge rejected the token. Re-copy it from the agent startup banner.');
      e.name = 'BridgeUnauthorizedError';
      throw e;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let message = `${res.status} ${res.statusText}`;
      try {
        const parsed = JSON.parse(body) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        if (body) message = body.slice(0, 300);
      }
      throw new Error(message);
    }

    return (await res.json()) as T;
  }

  health(timeoutMs = 8000): Promise<BridgeHealth> {
    return this.request<BridgeHealth>('/v1/health', { method: 'GET' }, timeoutMs);
  }

  exec(cmd: string, opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}) {
    return this.request<{ execId: string; cmd: string; cwd: string; startedAt: number }>('/v1/exec', {
      method: 'POST',
      body: JSON.stringify({ cmd, ...opts }),
    });
  }

  kill(execId: string) {
    return this.request<{ execId: string; killing?: boolean }>(`/v1/kill/${execId}`, { method: 'POST' });
  }

  writeFiles(files: Array<{ path: string; content?: string; base64?: string }>) {
    return this.request<{ written: Array<{ path: string; bytes: number }>; count: number }>('/v1/fs/write', {
      method: 'POST',
      body: JSON.stringify({ files }),
    }, 120_000);
  }

  readFile(path: string) {
    return this.request<{ path: string; bytes: number; content?: string; base64?: string; binary: boolean }>(
      `/v1/fs/read?path=${encodeURIComponent(path)}`,
      { method: 'GET' },
    );
  }

  list(path = '.') {
    return this.request<{ root: string; files: Array<{ path: string; bytes: number; modified: number }> }>(
      `/v1/fs/list?path=${encodeURIComponent(path)}`,
      { method: 'GET' },
      60_000,
    );
  }

  zip(path: string, name: string) {
    return this.request<{ artifact: string; bytes: number; entries: number; url: string }>('/v1/fs/zip', {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    }, 300_000);
  }

  collect(patterns?: string[]) {
    return this.request<{ collected: Array<{ name: string; source: string; bytes: number; url: string }>; count: number }>(
      '/v1/collect',
      { method: 'POST', body: JSON.stringify({ patterns }) },
      300_000,
    );
  }

  artifacts() {
    return this.request<{ artifacts: Array<{ name: string; bytes: number; modified: number; url: string }> }>(
      '/v1/artifacts',
      { method: 'GET' },
    );
  }

  artifactUrl(name: string): string {
    return `${this.config.url}/v1/artifact/${encodeURIComponent(name)}`;
  }

  /**
   * Stream a run's output. Uses fetch + ReadableStream rather than EventSource
   * because EventSource cannot send an Authorization header.
   */
  async stream(
    execId: string,
    onFrame: (frame: ExecFrame) => void,
    signal?: AbortSignal,
  ): Promise<{ exitCode: number | null; durationMs: number; killed: boolean }> {
    const res = await fetch(this.endpoint(`/v1/stream/${execId}`), {
      headers:
        this.config.via === 'proxy'
          ? { 'X-Bridge-Url': this.config.url, 'X-Bridge-Token': this.config.token }
          : this.headers(),
      signal,
      cache: 'no-store',
    });

    if (!res.ok || !res.body) {
      throw new BridgeOfflineError(`Could not open the output stream for ${execId} (${res.status}).`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = { exitCode: null as number | null, durationMs: 0, killed: false };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const SEP = /\r?\n\r?\n/g;
        for (;;) {
          SEP.lastIndex = 0;
          const m = SEP.exec(buffer);
          if (!m) break;
          const chunk = buffer.slice(0, m.index);
          buffer = buffer.slice(m.index + m[0].length);

          for (const line of chunk.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            try {
              const frame = JSON.parse(line.slice(5).trim()) as ExecFrame;
              onFrame(frame);
              if (frame.type === 'exit') {
                result = {
                  exitCode: frame.exitCode ?? null,
                  durationMs: frame.durationMs ?? 0,
                  killed: Boolean(frame.killed),
                };
              }
            } catch {
              /* keep-alive comment */
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return result;
  }

  /** Run a command and resolve once it exits, collecting all output. */
  async run(
    cmd: string,
    opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number; onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void; signal?: AbortSignal } = {},
  ): Promise<{ execId: string; exitCode: number | null; stdout: string; stderr: string; durationMs: number; killed: boolean }> {
    const { execId } = await this.exec(cmd, { cwd: opts.cwd, env: opts.env, timeoutMs: opts.timeoutMs });
    let stdout = '';
    let stderr = '';

    const outcome = await this.stream(
      execId,
      (frame) => {
        if (frame.type === 'stdout' && frame.data) {
          stdout += frame.data;
          opts.onOutput?.(frame.data, 'stdout');
        } else if (frame.type === 'stderr' && frame.data) {
          stderr += frame.data;
          opts.onOutput?.(frame.data, 'stderr');
        }
      },
      opts.signal,
    );

    return { execId, stdout, stderr, ...outcome };
  }
}

// ── Heartbeat monitor ───────────────────────────────────────────────────────

export interface HeartbeatState {
  status: BridgeStatus;
  health: BridgeHealth | null;
  lastOk: number | null;
  lastError: string | null;
  latencyMs: number | null;
  consecutiveFailures: number;
}

export const INITIAL_HEARTBEAT: HeartbeatState = {
  status: 'unknown',
  health: null,
  lastOk: null,
  lastError: null,
  latencyMs: null,
  consecutiveFailures: 0,
};

/**
 * Polls the bridge and derives a status.
 *
 * One dropped beat is `degraded`, not `offline` — tunnels hiccup constantly and
 * tearing down an in-flight build on a single 502 is worse than riding it out.
 * Two consecutive failures is offline. Backs off to 30s while offline so a dead
 * tunnel does not generate a request storm.
 */
export class HeartbeatMonitor {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: HeartbeatState = { ...INITIAL_HEARTBEAT };
  private stopped = true;

  constructor(
    private readonly client: BridgeClient,
    private readonly onChange: (state: HeartbeatState) => void,
    private readonly intervalMs = 6000,
  ) {}

  get current(): HeartbeatState {
    return this.state;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.beat();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Force an immediate check (used by the "Reconnect" button). */
  async ping(): Promise<HeartbeatState> {
    await this.beat(true);
    return this.state;
  }

  private set(next: Partial<HeartbeatState>): void {
    const merged = { ...this.state, ...next };
    const changed =
      merged.status !== this.state.status ||
      merged.consecutiveFailures !== this.state.consecutiveFailures ||
      merged.lastError !== this.state.lastError ||
      merged.health?.activeRuns !== this.state.health?.activeRuns;
    this.state = merged;
    if (changed) this.onChange(merged);
  }

  private async beat(manual = false): Promise<void> {
    if (this.stopped && !manual) return;

    if (!this.client.configured) {
      this.set({ status: 'offline', lastError: 'No bridge URL configured.', health: null });
      this.schedule(30_000);
      return;
    }

    if (this.state.status === 'unknown') this.set({ status: 'connecting' });

    const started = performance.now();
    try {
      const health = await this.client.health();
      this.set({
        status: 'online',
        health,
        lastOk: Date.now(),
        lastError: null,
        latencyMs: Math.round(performance.now() - started),
        consecutiveFailures: 0,
      });
      this.schedule(this.intervalMs);
    } catch (err) {
      const failures = this.state.consecutiveFailures + 1;
      const unauthorized = (err as Error).name === 'BridgeUnauthorizedError';

      this.set({
        status: unauthorized ? 'unauthorized' : failures >= 2 ? 'offline' : 'degraded',
        consecutiveFailures: failures,
        lastError: (err as Error).message,
        latencyMs: null,
        health: failures >= 2 ? null : this.state.health,
      });

      // Bad token will never self-heal by polling; back off hard.
      this.schedule(unauthorized ? 60_000 : failures >= 2 ? 30_000 : 3000);
    }
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.beat(), ms);
  }
}
