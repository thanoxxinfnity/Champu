import { parseInfoString } from '../agent/artifacts.ts';

/**
 * Splits a reply into prose and the terminal commands it asked for.
 *
 * The runtime runs every ```bash path=@terminal``` block (and, in a build, any bare shell block). The chat shows those as one
 * quiet "Ran N commands" row instead of a code box per command, so the reply reads as words and what ran sits one tap away
 * with its description, command and output. Pure text work, so it is tested directly.
 */

export interface CommandBlock {
  command: string;
  cwd?: string;
  /** What it is for, from the block's `desc="…"`, when the reply gave one. */
  description?: string;
  /** False while the closing fence has not arrived yet (the reply is still streaming). */
  complete: boolean;
}

export type ReplySegment =
  | { kind: 'text'; text: string }
  | { kind: 'commands'; commands: CommandBlock[] };

const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\n]*)$/;

export function splitCommandBlocks(content: string, opts: { shellRuns?: boolean } = {}): ReplySegment[] {
  const lines = content.split('\n');
  const segments: ReplySegment[] = [];
  let prose: string[] = [];
  type Open = { fence: string; indent: string; start: number; isCommand: boolean; cwd?: string; description?: string; body: string[] };
  let open = null as Open | null;

  const flushProse = () => {
    const text = prose.join('\n');
    prose = [];
    if (text.trim()) segments.push({ kind: 'text', text });
  };
  const push = (block: CommandBlock) => {
    flushProse();
    const last = segments[segments.length - 1];
    if (last?.kind === 'commands') last.commands.push(block);
    else segments.push({ kind: 'commands', commands: [block] });
  };
  const commandOf = (body: string[]) => {
    let command = body.join('\n').trim();
    // A lone backtick at either end is inline-code quoting leaking into the block, not part of the command.
    if ((command.match(/`/g) ?? []).length % 2 === 1) command = command.replace(/^`+/, '').replace(/`+$/, '').trim();
    return command;
  };

  lines.forEach((line, i) => {
    const match = FENCE.exec(line);
    if (open) {
      if (match && match[2][0] === open.fence[0] && match[2].length >= open.fence.length && !match[3].trim()) {
        if (open.isCommand) push({ command: commandOf(open.body), cwd: open.cwd, description: open.description, complete: true });
        else prose.push(...lines.slice(open.start, i + 1));
        open = null;
      } else {
        open.body.push(line.startsWith(open.indent) ? line.slice(open.indent.length) : line);
      }
      return;
    }
    if (match) {
      const meta = parseInfoString(match[3]);
      const bareShell = opts.shellRuns && !meta.path && /^(bash|sh|shell|zsh|console)$/i.test(meta.language);
      const isCommand = meta.path === '@terminal' || meta.path === '@shell' || Boolean(bareShell);
      open = { fence: match[2], indent: match[1], start: i, isCommand, cwd: meta.cwd, description: meta.description, body: [] };
      return;
    }
    prose.push(line);
  });

  const o = open as Open | null;
  if (o) {
    if (o.isCommand) push({ command: commandOf(o.body), cwd: o.cwd, description: o.description, complete: false });
    else prose.push(...lines.slice(o.start));
  }
  flushProse();
  return segments;
}

/** How many commands a reply carries. */
export function commandCount(segments: ReplySegment[]): number {
  return segments.reduce((n, s) => n + (s.kind === 'commands' ? s.commands.length : 0), 0);
}

export interface RunLike {
  command: string;
  cwd?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: number;
  durationMs?: number;
}

/**
 * Pairs each command of a reply with the run that executed it, in order. A command that was retried matches its attempts one
 * after the other; one with no run yet has none (it is waiting, running, or was parked because the bridge was down).
 */
export function matchRuns<R extends RunLike>(commands: CommandBlock[], runs: R[], since: number): Array<R | undefined> {
  const pool = runs.filter((r) => r.startedAt >= since - 2000).sort((a, b) => a.startedAt - b.startedAt);
  const used = new Set<R>();
  return commands.map((c) => {
    const hit = pool.find((r) => !used.has(r) && r.command.trim() === c.command.trim());
    if (hit) used.add(hit);
    return hit;
  });
}
