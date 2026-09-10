/**
 * Error fingerprinting & anti-loop guard.
 *
 * The failure mode this exists to kill: an agent runs `./gradlew assembleDebug`,
 * hits the same missing-SDK error, "fixes" it by running the identical command,
 * and burns the context window on an identical stack trace. Here, the second
 * identical fingerprint is a hard stop that forces a strategy change.
 */

export type AttemptKind = 'terminal' | 'codegen' | 'network' | 'build' | 'deploy' | 'parse';

export interface Attempt {
  kind: AttemptKind;
  /** The command, file path, or endpoint the attempt targeted. */
  subject: string;
  /** Raw stderr / stack trace / compiler output. */
  error?: string;
  exitCode?: number;
  at: number;
}

export interface Fingerprint {
  hash: string;
  kind: AttemptKind;
  subject: string;
  /** Normalised error signature, stable across runs. */
  signature: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  samples: string[];
}

export type GuardVerdict =
  | { action: 'proceed'; fingerprint: string }
  | { action: 'warn'; fingerprint: string; message: string; priorCount: number }
  | { action: 'halt'; fingerprint: string; message: string; priorCount: number; directive: string };

/**
 * Strip everything run-specific so two occurrences of the same underlying fault
 * collapse to one signature: absolute paths, line/col, hex addresses, uuids,
 * timestamps, ports, durations, memory figures.
 */
export function normalizeError(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/[A-Za-z]:\\[^\s:]+|\/(?:home|Users|tmp|var|opt|mnt|root)\/[^\s:)"']+/g, '<PATH>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<ADDR>')
    .replace(/\b[0-9a-f]{7,40}\b/gi, '<HASH>')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<TIME>')
    .replace(/:\d+:\d+/g, ':<LINE>:<COL>')
    .replace(/\bline \d+\b/gi, 'line <N>')
    .replace(/\b\d+(?:\.\d+)?\s?(ms|s|sec|secs|seconds|MB|GB|KB|kB)\b/g, '<QTY>')
    .replace(/\bport \d+\b/gi, 'port <PORT>')
    .replace(/\b\d{4,}\b/g, '<NUM>')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    // A stack trace's identity lives in its head, not its 200-frame tail.
    .slice(0, 12)
    .join('\n')
    .slice(0, 1500);
}

/** Normalise a command so `npm i x` and `npm  install  x` are one subject. */
export function normalizeSubject(kind: AttemptKind, subject: string): string {
  let s = subject.trim().replace(/\s+/g, ' ');
  if (kind === 'terminal' || kind === 'build') {
    s = s
      .replace(/^(sudo|env\s+\w+=\S+)\s+/g, '')
      .replace(/\bnpm i\b/g, 'npm install')
      .replace(/--(?:no-)?(?:audit|fund|progress|color)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return s.slice(0, 300);
}

/** FNV-1a — deterministic, dependency-free, plenty for a dedupe key. */
export function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function fingerprintOf(attempt: Attempt): { hash: string; signature: string; subject: string } {
  const subject = normalizeSubject(attempt.kind, attempt.subject);
  const signature = attempt.error ? normalizeError(attempt.error) : `exit:${attempt.exitCode ?? 'unknown'}`;
  return { hash: hash(`${attempt.kind}|${subject}|${signature}`), signature, subject };
}

export interface GuardOptions {
  /** Consecutive identical failures allowed before a hard halt. Spec says 2. */
  haltAt?: number;
  /** Fingerprints older than this are forgiven (default 30 min). */
  ttlMs?: number;
}

/**
 * Per-run failure ledger. One instance per execution run; serialise it into
 * suite history so a resumed run keeps its memory of what already failed.
 */
export class AntiLoopGuard {
  private readonly ledger = new Map<string, Fingerprint>();
  private readonly haltAt: number;
  private readonly ttlMs: number;
  /** Subjects that reached halt — surfaced to the model as "do not repeat". */
  private readonly banned = new Set<string>();

  constructor(opts: GuardOptions = {}) {
    this.haltAt = opts.haltAt ?? 2;
    this.ttlMs = opts.ttlMs ?? 30 * 60_000;
  }

  /** Check *before* executing. Blocks a subject already banned this run. */
  precheck(kind: AttemptKind, subject: string): GuardVerdict | null {
    const norm = normalizeSubject(kind, subject);
    if (!this.banned.has(`${kind}|${norm}`)) return null;

    const fp = [...this.ledger.values()].find((f) => f.kind === kind && f.subject === norm);
    return {
      action: 'halt',
      fingerprint: fp?.hash ?? hash(`${kind}|${norm}`),
      priorCount: fp?.count ?? this.haltAt,
      message: `Blocked: "${norm}" already failed ${fp?.count ?? this.haltAt}× this run with the same signature.`,
      directive: this.directiveFor(fp),
    };
  }

  /** Record a failure and get the verdict for what to do next. Never `proceed` — a recorded attempt is by definition a failure. */
  record(attempt: Attempt): Extract<GuardVerdict, { action: 'warn' | 'halt' }> {
    this.sweep();
    const { hash: h, signature, subject } = fingerprintOf(attempt);
    const now = attempt.at || Date.now();

    const existing = this.ledger.get(h);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = now;
      if (existing.samples.length < 3 && attempt.error) existing.samples.push(attempt.error.slice(0, 800));
    } else {
      this.ledger.set(h, {
        hash: h,
        kind: attempt.kind,
        subject,
        signature,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        samples: attempt.error ? [attempt.error.slice(0, 800)] : [],
      });
    }

    const fp = this.ledger.get(h)!;

    if (fp.count >= this.haltAt) {
      this.banned.add(`${attempt.kind}|${subject}`);
      return {
        action: 'halt',
        fingerprint: h,
        priorCount: fp.count,
        message: `HALT — identical failure ×${fp.count}: "${subject}". Retrying this is banned for the rest of the run.`,
        directive: this.directiveFor(fp),
      };
    }

    return {
      action: 'warn',
      fingerprint: h,
      priorCount: fp.count,
      message: `First failure on "${subject}". One more identical failure triggers a hard stop and a strategy change.`,
    };
  }

  /**
   * Root-cause hint + a concrete pivot. Generic "try something else" is useless;
   * these map the failure classes that actually recur in this workspace.
   */
  private directiveFor(fp?: Fingerprint): string {
    if (!fp) return 'Change the approach entirely. Do not re-issue the failed action.';
    const sig = fp.signature.toLowerCase();

    const rules: Array<[RegExp, string]> = [
      [/enoent|command not found|not recognized|no such file/, 'The binary or path does not exist on the host. Verify with a `which`/`ls` probe and install the toolchain, or switch to a path that exists. Do not re-run the same command.'],
      [/sdk|android_home|sdkmanager|licen[cs]e/, 'Android SDK is missing, unlicensed, or ANDROID_HOME is unset. Run the SDK/licence bootstrap step first, or fall back to emitting the Gradle project as a ZIP for local build.'],
      [/gradle|aapt|d8|dex|kotlin compile/, 'The Android build itself failed. Read the first Gradle error only, patch that single file, and rebuild with `--stacktrace`. Do not re-run the identical task.'],
      [/eacces|permission denied/, 'Permission failure. Change the target directory to one the agent user owns instead of re-running with the same path.'],
      [/eaddrinuse|address already in use/, 'Port is occupied. Pick a different port; do not retry the same bind.'],
      [/enospc|no space left/, 'Disk allowance exhausted. Delete build caches and artifacts before any further write.'],
      [/etimedout|econnrefused|econnreset|network|getaddrinfo|fetch failed/, 'Network path is broken. Verify the bridge heartbeat and the tunnel URL, then either switch endpoint or park the step and continue browser-side work.'],
      [/401|403|unauthorized|forbidden|invalid api key/, 'Credentials rejected. Stop retrying — the key or auth header is wrong. Surface it to the user and switch to a zero-key provider for the meantime.'],
      [/429|rate limit|quota/, 'Rate limited. Back off, switch provider (Pollinations is keyless), and do not hammer the same endpoint.'],
      [/syntaxerror|unexpected token|parse error|cannot find module|ts\d{4}/, 'The generated code is structurally wrong. Re-emit the whole file from scratch with a different construction rather than patching the same broken output.'],
      [/oom|out of memory|heap/, 'Memory exhausted. Reduce batch/parallelism or stream the work; the same invocation will fail identically.'],
    ];

    for (const [re, advice] of rules) if (re.test(sig)) return advice;

    return `Same signature twice. Root-cause it from the captured trace, then take a structurally different path — different tool, different file layout, or different library. Re-issuing "${fp.subject}" is banned.`;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [k, v] of this.ledger) if (v.lastSeen < cutoff) this.ledger.delete(k);
  }

  /** Human-readable "do not repeat" list injected into the system prompt. */
  bannedApproaches(): string[] {
    return [...this.ledger.values()]
      .filter((f) => f.count >= this.haltAt)
      .map((f) => `[${f.kind}] ${f.subject} — failed ×${f.count}: ${f.signature.split('\n')[0].slice(0, 160)}`);
  }

  entries(): Fingerprint[] {
    return [...this.ledger.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  toJSON(): Fingerprint[] {
    return this.entries();
  }

  static fromJSON(entries: Fingerprint[], opts?: GuardOptions): AntiLoopGuard {
    const guard = new AntiLoopGuard(opts);
    for (const e of entries) {
      guard.ledger.set(e.hash, { ...e });
      if (e.count >= guard.haltAt) guard.banned.add(`${e.kind}|${e.subject}`);
    }
    return guard;
  }

  reset(): void {
    this.ledger.clear();
    this.banned.clear();
  }
}
