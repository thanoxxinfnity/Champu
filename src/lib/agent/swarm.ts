import { applyEdits, parseEdits, type EditResult } from './diff-edit.ts';
import { commandsOf, extractArtifacts, filesOf, languageForPath } from './artifacts.ts';
import { buildRepoMap, projectView, type MapFile } from './repo-map.ts';

/**
 * The Swarm engine: one coding task, four roles.
 *
 *   Architect    breaks the task into modules and files (what each is for, what it uses)
 *   Coder        writes the files, a few at a time, as whole files or as edit blocks
 *   Reviewer     reads what was written for logic and syntax mistakes; the Coder fixes what it finds
 *   Orchestrator keeps the files of every step in one place and hands back one reply the rest of the app already understands
 *
 * The shape follows MetaGPT's role pipeline (a product of specialised roles passing work along), kept small enough for a phone. Every call
 * goes through `deps.ask`, so the same code runs against any model, the gateway's per-role choice included, and is tested with a fake.
 */

export type Role = 'architect' | 'coder' | 'reviewer' | 'orchestrator';

export interface SwarmDeps {
  /** One model call for a role. The system text is the role's own instructions plus whatever the app adds. */
  ask: (role: Role, system: string, user: string, opts?: { json?: boolean; maxTokens?: number }) => Promise<string>;
  /** Clean, step-by-step lines for the terminal log: "[1/4] Architect …". */
  log: (line: string) => void;
  /** The role changed state; the to-do list and the thinking bubble follow. */
  step?: (role: Role, state: 'running' | 'done' | 'failed', detail?: string) => void;
  /** The workspace as it is now. */
  files: () => MapFile[];
  signal?: AbortSignal;
}

export interface ModuleSpec {
  path: string;
  purpose: string;
  uses: string[];
}

export interface Architecture {
  summary: string;
  modules: ModuleSpec[];
  notes: string[];
}

export interface ReviewIssue {
  path: string;
  problem: string;
  fix?: string;
  /** Found by the local checks (no model) or by the Reviewer. */
  by: 'static' | 'reviewer';
}

export interface SwarmResult {
  /** The reply the runtime reads: prose, then every changed file as a path= block, then any commands. */
  content: string;
  changed: string[];
  issues: ReviewIssue[];
  rounds: number;
  architecture: Architecture | null;
  aborted?: boolean;
}

// ── Prompts ─────────────────────────────────────────────────────────────────

export const ARCHITECT_PROMPT = `You are the Architect of a small engineering team. Do not write code. Break the task into the files the Coder must write or change.

Reply with ONE JSON object, no prose, no fence:
{"summary":"<two sentences: what will be built and how it fits together>","modules":[{"path":"<relative file path>","purpose":"<one line: what this file is for>","uses":["<path of another module it imports or calls>"]}],"notes":["<a decision the Coder must keep: names, formats, ports, limits (at most 5)>"]}

Rules: at most 12 modules; order them so that a file comes after the files it uses; paths are relative, no leading slash, no "..". Files that already exist and must change are listed too. Keep the structure the project already has.`;

export const CODER_PROMPT = `You are the Coder of a small engineering team. You write the files the Architect named, nothing else.

- A new file: a fenced block whose info string carries the path, e.g. \`\`\`ts path=src/thing.ts, with the WHOLE file inside.
- A file that already exists: an edit block with only the changed lines, copied exactly from the project shown to you:
<<<<<<< SEARCH path=src/thing.ts
the lines as they are now
=======
the new lines
>>>>>>> REPLACE
- Never write "rest unchanged", "...", or a placeholder body. Every file you write must work.
- Keep to the Architect's names and the files it said each one uses.
- Commands: write none unless you are told this is the last batch; then put the commands that install, build or test the project in \`\`\`bash path=@terminal\`\`\` blocks, one command per block.
Reply with the blocks and at most two short sentences.`;

export const REVIEWER_PROMPT = `You are the Reviewer of a small engineering team. Read the files below against the task and the architecture. Look for: logic mistakes, a function that is called but never defined or has the wrong arguments, an import of a file or name that does not exist, wrong paths, syntax errors, a requirement of the task that is missing.

Reply with ONE JSON object, no prose, no fence:
{"ok":true|false,"issues":[{"path":"<file>","problem":"<what is wrong, one line>","fix":"<what to change, one line>"}]}
At most 8 issues. If everything is sound, reply {"ok":true,"issues":[]}. Do not report style preferences.`;

// ── Parsing ─────────────────────────────────────────────────────────────────

function jsonOf(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(text.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function cleanPath(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  const c = p.trim().replace(/^\.\//, '').replace(/\\/g, '/');
  if (!c || c.startsWith('/') || /^[A-Za-z]:/.test(c) || c.split('/').includes('..') || c.length > 300 || !/[\w]/.test(c)) return null;
  return c;
}

export function parseArchitecture(raw: string): Architecture | null {
  const data = jsonOf(raw) as { summary?: unknown; modules?: unknown; notes?: unknown } | null;
  if (!data || !Array.isArray(data.modules)) return null;
  const seen = new Set<string>();
  const modules: ModuleSpec[] = [];
  for (const m of data.modules as Array<Record<string, unknown>>) {
    const path = cleanPath(m?.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    modules.push({
      path,
      purpose: String(m.purpose ?? '').slice(0, 200),
      uses: Array.isArray(m.uses) ? (m.uses as unknown[]).map(cleanPath).filter((x): x is string => Boolean(x)).slice(0, 10) : [],
    });
    if (modules.length >= 12) break;
  }
  if (!modules.length) return null;
  return {
    summary: String(data.summary ?? '').slice(0, 500),
    modules,
    notes: Array.isArray(data.notes) ? (data.notes as unknown[]).map((n) => String(n).slice(0, 200)).slice(0, 5) : [],
  };
}

export function parseReview(raw: string): { ok: boolean; issues: ReviewIssue[] } {
  const data = jsonOf(raw) as { ok?: unknown; issues?: unknown } | null;
  if (!data) return { ok: true, issues: [] }; // an unreadable review blocks nothing; the local checks still ran
  const issues: ReviewIssue[] = [];
  if (Array.isArray(data.issues)) {
    for (const i of data.issues as Array<Record<string, unknown>>) {
      const path = cleanPath(i?.path);
      const problem = String(i?.problem ?? '').trim();
      if (!path || !problem) continue;
      issues.push({ path, problem: problem.slice(0, 240), fix: i.fix ? String(i.fix).slice(0, 240) : undefined, by: 'reviewer' });
      if (issues.length >= 8) break;
    }
  }
  return { ok: data.ok !== false && issues.length === 0, issues };
}

/** Modules in batches of at most `size`, keeping their order (a file stays after the files it uses). */
export function batchModules(modules: ModuleSpec[], size = 3): ModuleSpec[][] {
  const out: ModuleSpec[][] = [];
  for (let i = 0; i < modules.length; i += size) out.push(modules.slice(i, i + size));
  return out;
}

// ── Local checks (no model) ─────────────────────────────────────────────────

const PLACEHOLDER = /(rest (?:of the (?:file|code) )?(?:is )?unchanged|\.\.\. ?(?:existing|rest|other) (?:code|content)|\/\/ \.\.\.$|# \.\.\.$|<rest of|implement(?:ation)? (?:here|goes here)|your code here)/i;

/** Brackets that do not pair up, ignoring strings and comments; a cheap way to catch a file cut off in the middle. */
export function bracketBalance(path: string, text: string): string | null {
  const lang = languageForPath(path);
  const c = /^(typescript|tsx|javascript|jsx|java|kotlin|c|cpp|csharp|go|rust|swift|css|scss|json)$/.test(lang);
  if (!c) return null;
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const two = text.slice(i, i + 2);
    if (lang !== 'json' && two === '//') { while (i < n && text[i] !== '\n') i++; continue; }
    if (two === '/*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (ch === '"' || ch === "'" || (ch === '`' && lang !== 'json')) {
      const q = ch;
      i++;
      while (i < n && text[i] !== q) {
        if (text[i] === '\\') i++;
        if (q !== '`' && text[i] === '\n') break;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.pop() !== pairs[ch]) return `unbalanced ${ch} near line ${text.slice(0, i).split('\n').length}`;
    }
    i++;
  }
  return stack.length ? `${stack.length} unclosed ${stack[stack.length - 1]} (the file looks cut off)` : null;
}

/** What can be told about a file without running it. */
export function staticCheck(path: string, content: string): string[] {
  const out: string[] = [];
  if (!content.trim()) return ['the file is empty'];
  if (PLACEHOLDER.test(content)) out.push('contains a placeholder instead of real code ("rest unchanged", "...", "implement here")');
  if (/\.json$/i.test(path)) {
    try {
      JSON.parse(content);
    } catch (e) {
      out.push(`is not valid JSON (${(e as Error).message.slice(0, 80)})`);
    }
  } else {
    const b = bracketBalance(path, content);
    if (b) out.push(b);
  }
  if (/\.py$/i.test(path) && /^\t+ +\S|^ +\t+\S/m.test(content)) out.push('mixes tabs and spaces in indentation');
  return out;
}

export function staticIssues(files: Map<string, string>, paths: Iterable<string>): ReviewIssue[] {
  const out: ReviewIssue[] = [];
  for (const p of paths) {
    const text = files.get(p);
    if (text === undefined) continue;
    for (const problem of staticCheck(p, text)) out.push({ path: p, problem, by: 'static' });
  }
  return out;
}

// ── The Orchestrator: one reply out of many steps ───────────────────────────

const fenceFor = (text: string) => (text.includes('```') ? '````' : '```');

/** The reply the rest of the app reads: what was done in words, then each changed file whole, then the commands. */
export function assembleReply(arch: Architecture | null, files: Map<string, string>, changed: string[], commands: string[], issues: ReviewIssue[]): string {
  const parts: string[] = [];
  parts.push(arch?.summary || `Wrote ${changed.length} file${changed.length === 1 ? '' : 's'}.`);
  for (const p of changed) {
    const text = files.get(p);
    if (text === undefined) continue;
    const f = fenceFor(text);
    parts.push(`${f}${languageForPath(p)} path=${p}\n${text.replace(/\n$/, '')}\n${f}`);
  }
  for (const c of commands) parts.push(`\`\`\`bash path=@terminal\n${c}\n\`\`\``);
  if (issues.length) {
    parts.push(`Reviewer notes still open:\n${issues.map((i) => `- ${i.path}: ${i.problem}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

// ── The run ─────────────────────────────────────────────────────────────────

function archText(a: Architecture): string {
  return [
    `Summary: ${a.summary}`,
    'Files:',
    ...a.modules.map((m) => `- ${m.path}: ${m.purpose}${m.uses.length ? ` (uses ${m.uses.join(', ')})` : ''}`),
    ...(a.notes.length ? ['Keep to:', ...a.notes.map((n) => `- ${n}`)] : []),
  ].join('\n');
}

interface Applied {
  edits: EditResult[];
  wrote: string[];
  commands: string[];
}

/** Takes what a Coder reply contains (whole files, edit blocks, commands) into the working copy. */
export function applyCoderReply(reply: string, work: Map<string, string>): Applied {
  const artifacts = extractArtifacts(reply, { shellRuns: false });
  const wrote: string[] = [];
  for (const f of filesOf(artifacts)) {
    if (!f.complete) continue;
    work.set(f.path, f.content);
    wrote.push(f.path);
  }
  const edits = parseEdits(reply);
  const { files, results } = applyEdits(work, edits);
  for (const r of results) if (r.ok && r.content !== undefined) {
    work.set(r.path, files.get(r.path)!);
    wrote.push(r.path);
  }
  const commands = commandsOf(artifacts).filter((c) => c.complete && c.command).map((c) => c.command);
  return { edits: results, wrote, commands };
}

export async function runSwarm(task: string, deps: SwarmDeps, opts: { maxRounds?: number; batchSize?: number } = {}): Promise<SwarmResult> {
  const maxRounds = opts.maxRounds ?? 2;
  const work = new Map<string, string>(deps.files().filter((f) => typeof f.content === 'string' && !f.content.startsWith('data:')).map((f) => [f.path, f.content]));
  const touched = new Set<string>();
  const commands: string[] = [];
  const aborted = () => Boolean(deps.signal?.aborted);
  const total = 4;
  const view = (query: string, focus: string[]) => projectView([...work].map(([path, content]) => ({ path, content })), { query, focus, fullChars: 20_000, mapChars: 3500 }).text;
  const finish = (arch: Architecture | null, issues: ReviewIssue[], rounds: number, wasAborted = false): SwarmResult => ({
    content: assembleReply(arch, work, [...touched], [...new Set(commands)], issues),
    changed: [...touched],
    issues,
    rounds,
    architecture: arch,
    aborted: wasAborted || undefined,
  });

  // 1 · Architect
  deps.log(`[1/${total}] Architect · planning the modules`);
  deps.step?.('architect', 'running');
  let arch: Architecture | null = null;
  try {
    const map = work.size ? `\n\nThe project today:\n${buildRepoMap([...work].map(([path, content]) => ({ path, content })), { query: task, maxChars: 4000 })}` : '';
    arch = parseArchitecture(await deps.ask('architect', ARCHITECT_PROMPT, `Task:\n${task.slice(0, 6000)}${map}`, { json: true, maxTokens: 1500 }));
  } catch (err) {
    if (aborted()) return finish(null, [], 0, true);
    deps.log(`[1/${total}] Architect · no plan (${(err as Error).message.slice(0, 80)}), the Coder will plan as it writes`);
  }
  if (arch) {
    deps.log(`[1/${total}] Architect ✓ ${arch.modules.length} file${arch.modules.length === 1 ? '' : 's'}: ${arch.modules.map((m) => m.path).join(', ')}`);
    deps.step?.('architect', 'done', `${arch.modules.length} files`);
  } else {
    deps.step?.('architect', 'failed', 'no plan');
  }
  if (aborted()) return finish(arch, [], 0, true);

  // 2 · Coder
  const batches = arch ? batchModules(arch.modules, opts.batchSize ?? 3) : [[]];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const last = i === batches.length - 1;
    const label = batch.length ? batch.map((m) => m.path).join(', ') : 'the whole task';
    deps.log(`[2/${total}] Coder · batch ${i + 1}/${batches.length}: ${label}`);
    deps.step?.('coder', 'running', `batch ${i + 1}/${batches.length}`);
    const prompt = [
      `Task:\n${task.slice(0, 6000)}`,
      arch ? `\nArchitecture:\n${archText(arch)}` : '',
      batch.length ? `\nWrite these files now: ${batch.map((m) => m.path).join(', ')}.` : '\nWrite the files the task needs.',
      last ? '\nThis is the last batch: also give the commands that install, build or test the project, if the task needs any.' : '\nWrite no commands in this batch.',
      `\nThe project as it is now:\n${view(task, batch.map((m) => m.path))}`,
    ].join('\n');
    let reply = await deps.ask('coder', CODER_PROMPT, prompt, { maxTokens: 8192 });
    let applied = applyCoderReply(reply, work);
    // Edits that did not match get one more try with the reasons.
    const failed = applied.edits.filter((r) => !r.ok);
    if (failed.length && !aborted()) {
      deps.log(`[2/${total}] Coder · ${failed.length} edit${failed.length === 1 ? '' : 's'} did not match, asking again`);
      reply = await deps.ask('coder', CODER_PROMPT, `${prompt}\n\nThese edits did not apply:\n${failed.map((r) => `- ${r.error}`).join('\n')}\n\nSend them again, copying the SEARCH lines exactly, or write the whole file.`, { maxTokens: 8192 });
      const again = applyCoderReply(reply, work);
      applied = { edits: [...applied.edits.filter((r) => r.ok), ...again.edits], wrote: [...applied.wrote, ...again.wrote], commands: [...applied.commands, ...again.commands] };
    }
    for (const p of applied.wrote) touched.add(p);
    commands.push(...applied.commands);
    deps.log(`[2/${total}] Coder ✓ ${[...new Set(applied.wrote)].length} file${[...new Set(applied.wrote)].length === 1 ? '' : 's'} written`);
    deps.step?.('coder', 'done', `batch ${i + 1}/${batches.length}`);
    if (aborted()) return finish(arch, [], 0, true);
  }

  // 3 · Reviewer, with the Coder fixing what it finds
  let issues: ReviewIssue[] = [];
  let rounds = 0;
  for (let round = 1; round <= maxRounds; round++) {
    rounds = round;
    deps.log(`[3/${total}] Reviewer · round ${round}/${maxRounds}`);
    deps.step?.('reviewer', 'running', `round ${round}`);
    const local = staticIssues(work, touched);
    let found: ReviewIssue[] = [];
    try {
      const bundle = [...touched].map((p) => `### ${p}\n\`\`\`\n${(work.get(p) ?? '').slice(0, 9000)}\n\`\`\``).join('\n\n').slice(0, 40_000);
      const review = parseReview(await deps.ask('reviewer', REVIEWER_PROMPT, `Task:\n${task.slice(0, 4000)}\n\n${arch ? `Architecture:\n${archText(arch)}\n\n` : ''}Files:\n${bundle}`, { json: true, maxTokens: 1200 }));
      found = review.issues;
    } catch {
      // a reviewer that cannot answer must not stop the run; the local checks stand
    }
    issues = [...local, ...found.filter((f) => !local.some((l) => l.path === f.path && l.problem === f.problem))];
    if (!issues.length) {
      deps.log(`[3/${total}] Reviewer ✓ no problems found`);
      deps.step?.('reviewer', 'done', 'clean');
      break;
    }
    deps.log(`[3/${total}] Reviewer ✗ ${issues.length} issue${issues.length === 1 ? '' : 's'}: ${issues.slice(0, 3).map((i) => `${i.path} — ${i.problem}`).join('; ')}${issues.length > 3 ? '; …' : ''}`);
    if (round === maxRounds || aborted()) {
      deps.step?.('reviewer', 'failed', `${issues.length} open`);
      break;
    }
    deps.log(`[2/${total}] Coder · fixing round ${round}`);
    const affected = [...new Set(issues.map((i) => i.path))];
    const fixPrompt = [
      `Task:\n${task.slice(0, 4000)}`,
      `\nThe Reviewer found these problems:\n${issues.map((i) => `- ${i.path}: ${i.problem}${i.fix ? ` → ${i.fix}` : ''}`).join('\n')}`,
      `\nThe files as they are now:\n${affected.map((p) => `### ${p}\n\`\`\`\n${(work.get(p) ?? '(missing)').slice(0, 9000)}\n\`\`\``).join('\n\n')}`,
      '\nFix each problem with an edit block (or the whole file if it is cut off). Write no commands.',
    ].join('\n');
    const reply = await deps.ask('coder', CODER_PROMPT, fixPrompt, { maxTokens: 8192 });
    const applied = applyCoderReply(reply, work);
    for (const p of applied.wrote) touched.add(p);
    if (aborted()) return finish(arch, issues, rounds, true);
  }

  // 4 · Orchestrator
  deps.log(`[4/${total}] Orchestrator · ${touched.size} file${touched.size === 1 ? '' : 's'} in sync${issues.length ? `, ${issues.length} note${issues.length === 1 ? '' : 's'} left open` : ''}`);
  deps.step?.('orchestrator', 'done', `${touched.size} files`);
  return finish(arch, issues, rounds);
}
