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

/** A file the reply writes (a path= block) or changes (SEARCH/REPLACE edits), with how many lines it adds and removes. */
export interface FileChange {
  path: string;
  op: 'create' | 'edit';
  added: number;
  removed: number;
  /** The block as written: the whole file, or the SEARCH/REPLACE edits. */
  body: string;
  language: string;
  complete: boolean;
}

export type ReplySegment =
  | { kind: 'text'; text: string }
  | { kind: 'commands'; commands: CommandBlock[]; files?: FileChange[] };

const EDIT_OPEN = /^[ \t]*<{5,9}[ \t]*SEARCH\b(.*)$/;
const EDIT_MID = /^[ \t]*={5,9}[ \t]*$/;
const EDIT_CLOSE = /^[ \t]*>{5,9}[ \t]*REPLACE[ \t]*$/;

/** SEARCH/REPLACE edits → one change per file, lines counted (an empty SEARCH creates the file). */
export function editChanges(body: string, fallbackPath = '', complete = true): FileChange[] {
  const out = new Map<string, FileChange>();
  let path = fallbackPath, mode: 'none' | 'search' | 'replace' = 'none', search = 0, replace = 0, block: string[] = [];
  const flush = () => {
    const key = path || '(file)';
    const prev = out.get(key);
    const create = search === 0;
    const text = block.join('\n');
    if (prev) { prev.added += replace; prev.removed += search; prev.body += `\n${text}`; if (!create) prev.op = 'edit'; }
    else out.set(key, { path: key, op: create ? 'create' : 'edit', added: replace, removed: search, body: text, language: 'diff', complete });
    search = 0; replace = 0; block = [];
  };
  for (const line of body.split('\n')) {
    const o = EDIT_OPEN.exec(line);
    if (o) { mode = 'search'; block = [line]; const m = /path=("[^"]+"|'[^']+'|\S+)/.exec(o[1] ?? ''); if (m) path = m[1]!.replace(/^["']|["']$/g, ''); continue; }
    if (mode === 'none') continue;
    block.push(line);
    if (mode === 'search' && EDIT_MID.test(line)) { mode = 'replace'; continue; }
    if (mode === 'replace' && EDIT_CLOSE.test(line)) { mode = 'none'; flush(); continue; }
    if (mode === 'search' && line.trim()) search++;
    else if (mode === 'replace' && line.trim()) replace++;
  }
  if (mode !== 'none') { flush(); for (const c of out.values()) c.complete = false; }
  return [...out.values()];
}

const nonEmptyLines = (text: string) => text.split('\n').filter((l) => l.trim()).length;

const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\n]*)$/;

export function splitCommandBlocks(content: string, opts: { shellRuns?: boolean; files?: boolean } = {}): ReplySegment[] {
  const lines = content.split('\n');
  const segments: ReplySegment[] = [];
  let prose: string[] = [];
  type Open = { fence: string; indent: string; start: number; isCommand: boolean; isFile?: { path: string; language: string }; cwd?: string; description?: string; body: string[] };
  let bareEdit: string[] | null = null;
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
  const pushFiles = (changes: FileChange[]) => {
    if (!changes.length) return;
    flushProse();
    const last = segments[segments.length - 1];
    if (last?.kind === 'commands') (last.files ??= []).push(...changes);
    else segments.push({ kind: 'commands', commands: [], files: [...changes] });
  };
  const fileOf = (o: Open, complete: boolean): FileChange[] => {
    const body = o.body.join('\n');
    if (o.body.some((l) => EDIT_OPEN.test(l))) return editChanges(body, o.isFile!.path, complete);
    return [{ path: o.isFile!.path, op: 'create', added: nonEmptyLines(body), removed: 0, body, language: o.isFile!.language, complete }];
  };
  const commandOf = (body: string[]) => {
    let command = body.join('\n').trim();
    // A lone backtick at either end is inline-code quoting leaking into the block, not part of the command.
    if ((command.match(/`/g) ?? []).length % 2 === 1) command = command.replace(/^`+/, '').replace(/`+$/, '').trim();
    return command;
  };

  lines.forEach((line, i) => {
    // An unfenced SEARCH/REPLACE edit, when files are shown as activity.
    if (bareEdit) {
      bareEdit.push(line);
      if (EDIT_CLOSE.test(line)) { pushFiles(editChanges(bareEdit.join('\n'))); bareEdit = null; }
      return;
    }
    if (opts.files && !open && EDIT_OPEN.test(line)) { bareEdit = [line]; return; }
    const match = FENCE.exec(line);
    if (open) {
      if (match && match[2][0] === open.fence[0] && match[2].length >= open.fence.length && !match[3].trim()) {
        if (open.isCommand) push({ command: commandOf(open.body), cwd: open.cwd, description: open.description, complete: true });
        else if (open.isFile) pushFiles(fileOf(open, true));
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
      const isFile = opts.files && !isCommand && meta.path && !meta.path.startsWith('@') ? { path: meta.path, language: meta.language } : undefined;
      open = { fence: match[2], indent: match[1], start: i, isCommand, isFile, cwd: meta.cwd, description: meta.description, body: [] };
      return;
    }
    prose.push(line);
  });

  const o = open as Open | null;
  if (o) {
    if (o.isCommand) push({ command: commandOf(o.body), cwd: o.cwd, description: o.description, complete: false });
    else if (o.isFile) pushFiles(fileOf(o, false));
    else prose.push(...lines.slice(o.start));
  }
  const be = bareEdit as string[] | null;
  if (be) pushFiles(editChanges(be.join('\n'), '', false));
  flushProse();
  return segments;
}

/** How many commands a reply carries. */
export function commandCount(segments: ReplySegment[]): number {
  return segments.reduce((n, s) => n + (s.kind === 'commands' ? s.commands.length : 0), 0);
}

/** Commands and file changes together: anything shown as an activity line. */
export function activityCount(segments: ReplySegment[]): number {
  return segments.reduce((n, s) => n + (s.kind === 'commands' ? s.commands.length + (s.files?.length ?? 0) : 0), 0);
}

/** "Created a file, edited 2 files, browsed the web, ran 3 commands" — the words of an activity line, like a work log. */
export function activityLabel(a: { commands: Array<{ command: string; complete?: boolean }>; files?: FileChange[]; running?: boolean }): string {
  const files = a.files ?? [];
  const created = files.filter((f) => f.op === 'create').length;
  const edited = files.length - created;
  const writing = files.some((f) => !f.complete);
  const web = a.commands.filter((c) => /(\bbrowse\b|webcmd|duckduckgo|crawl4ai|\bcurl\s+-?s?\S*\s*https?:)/i.test(c.command)).length;
  const other = a.commands.length - web;
  const n = (k: number, one: string, many: string) => (k === 1 ? one : `${k} ${many}`);
  const parts: string[] = [];
  if (created) parts.push(`${writing && !edited ? 'writing' : 'created'} ${n(created, 'a file', 'files')}`);
  if (edited) parts.push(`${writing ? 'editing' : 'edited'} ${n(edited, 'a file', 'files')}`);
  if (web) parts.push(a.running ? 'browsing the web' : 'browsed the web');
  if (other) parts.push(`${a.running ? 'running' : 'ran'} ${n(other, 'a command', 'commands')}`);
  const text = parts.join(', ') || 'worked';
  return text[0]!.toUpperCase() + text.slice(1);
}

/** Lines added and removed across the file changes of a reply. */
export function diffTotals(files: FileChange[] = []): { added: number; removed: number } {
  return files.reduce((t, f) => ({ added: t.added + f.added, removed: t.removed + f.removed }), { added: 0, removed: 0 });
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
