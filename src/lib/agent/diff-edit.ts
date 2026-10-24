/**
 * Search/replace edits: change part of a file without writing the whole file again.
 *
 * A reply that wants to change a file that already exists writes
 *
 *     <<<<<<< SEARCH path=src/app.ts
 *     the lines as they are now
 *     =======
 *     the lines as they should be
 *     >>>>>>> REPLACE
 *
 * (inside a fence or bare). The same idea editing assistants such as Aider use: only the changed part costs tokens, and the rest of the
 * file cannot be broken by a model that forgot a function while retyping it. A block with an empty SEARCH creates a new file.
 * Pure text work, so it is tested directly.
 */

export interface EditBlock {
  path: string;
  search: string;
  replace: string;
}

export interface EditResult {
  path: string;
  ok: boolean;
  /** The file after the edit (when ok). */
  content?: string;
  /** How the match was found: exactly, ignoring trailing spaces, or ignoring indentation. */
  how?: 'exact' | 'trailing-space' | 'indent' | 'create';
  error?: string;
}

const OPEN = /^[ \t]*<{5,9}[ \t]*SEARCH\b(.*)$/;
const MID = /^[ \t]*={5,9}[ \t]*$/;
const CLOSE = /^[ \t]*>{5,9}[ \t]*REPLACE[ \t]*$/;
const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\n]*)$/;

function pathFrom(text: string): string | undefined {
  const m = /(?:path|file|filename)=("[^"]+"|'[^']+'|\S+)/.exec(text);
  return m?.[1]?.replace(/^["']|["']$/g, '');
}

/** A bare line that is only a file name ("src/app.ts", "`src/app.ts`", "**src/app.ts**") names the block that follows it. */
function looksLikePath(line: string): string | undefined {
  const t = line.trim().replace(/^[`*#\s]+|[`*:\s]+$/g, '');
  return /^[\w@./-]+\.[A-Za-z0-9]{1,8}$/.test(t) && !t.includes('..') ? t : undefined;
}

export function parseEdits(text: string): EditBlock[] {
  const lines = text.split('\n');
  const out: EditBlock[] = [];
  let fencePath: string | undefined;
  let lastNamed: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = OPEN.exec(line);
    if (!open) {
      const f = FENCE.exec(line);
      if (f) fencePath = pathFrom(f[2]) ?? fencePath;
      else {
        const p = looksLikePath(line);
        if (p) lastNamed = p;
      }
      continue;
    }
    const search: string[] = [];
    const replace: string[] = [];
    let state: 'search' | 'replace' = 'search';
    let j = i + 1;
    let closed = false;
    for (; j < lines.length; j++) {
      if (state === 'search' && MID.test(lines[j])) { state = 'replace'; continue; }
      if (state === 'replace' && CLOSE.test(lines[j])) { closed = true; break; }
      (state === 'search' ? search : replace).push(lines[j]);
    }
    if (!closed) break; // a block still streaming is not an edit yet
    const path = pathFrom(open[1]) ?? fencePath ?? lastNamed;
    if (path) out.push({ path: path.replace(/^\.\//, ''), search: search.join('\n'), replace: replace.join('\n') });
    i = j;
  }
  return out;
}

/** Edit blocks cut out of a reply, so what is left reads as words. */
export function stripEdits(text: string): string {
  return text.replace(/^[ \t]*<{5,9}[ \t]*SEARCH\b[^\n]*\n[\s\S]*?^[ \t]*>{5,9}[ \t]*REPLACE[ \t]*$\n?/gm, '');
}

const trimEnd = (s: string) => s.replace(/[ \t]+$/g, '');

function indexOfLines(hay: string[], needle: string[], same: (a: string, b: string) => boolean): number[] {
  const hits: number[] = [];
  if (!needle.length) return hits;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let k = 0; k < needle.length; k++) if (!same(hay[i + k], needle[k])) { ok = false; break; }
    if (ok) hits.push(i);
  }
  return hits;
}

const leading = (s: string) => /^[ \t]*/.exec(s)![0];

/** Applies one edit to a file's text. `current` is undefined when the file does not exist yet. */
export function applyEdit(current: string | undefined, edit: EditBlock): EditResult {
  const { path } = edit;
  if (!edit.search.trim()) {
    if (current === undefined || !current.trim()) return { path, ok: true, content: edit.replace, how: 'create' };
    return { path, ok: false, error: `${path} already exists; an edit needs the lines to replace in SEARCH (an empty SEARCH only creates a new file).` };
  }
  if (current === undefined) return { path, ok: false, error: `${path} does not exist; to create it, leave SEARCH empty.` };

  const crlf = current.includes('\r\n');
  const text = current.replace(/\r\n/g, '\n');
  const hay = text.split('\n');
  const needle = edit.search.replace(/\r\n/g, '\n').split('\n');
  const repl = edit.replace.replace(/\r\n/g, '\n').split('\n');
  // A SEARCH that ends with a blank line before the marker has nothing to match there.
  while (needle.length > 1 && needle[needle.length - 1] === '' && !hay.includes('')) needle.pop();

  const done = (lines: string[], how: EditResult['how']): EditResult => {
    const joined = lines.join('\n');
    return { path, ok: true, content: crlf ? joined.replace(/\n/g, '\r\n') : joined, how };
  };
  const splice = (at: number, withLines: string[]) => [...hay.slice(0, at), ...withLines, ...hay.slice(at + needle.length)];

  const exact = indexOfLines(hay, needle, (a, b) => a === b);
  if (exact.length === 1) return done(splice(exact[0], repl), 'exact');
  if (exact.length > 1) return { path, ok: false, error: `The SEARCH text matches ${exact.length} places in ${path}. Add more surrounding lines so it matches exactly one.` };

  // Part of a line: the same text, found once anywhere in the file.
  const joinedSearch = needle.join('\n');
  const at = text.indexOf(joinedSearch);
  if (at >= 0) {
    if (text.indexOf(joinedSearch, at + 1) < 0) return done((text.slice(0, at) + repl.join('\n') + text.slice(at + joinedSearch.length)).split('\n'), 'exact');
    return { path, ok: false, error: `The SEARCH text matches more than one place in ${path}. Add more surrounding lines so it matches exactly one.` };
  }

  const loose = indexOfLines(hay, needle, (a, b) => trimEnd(a) === trimEnd(b));
  if (loose.length === 1) return done(splice(loose[0], repl), 'trailing-space');
  if (loose.length > 1) return { path, ok: false, error: `The SEARCH text matches ${loose.length} places in ${path}. Add more surrounding lines so it matches exactly one.` };

  // The model got the indentation wrong by a constant amount: match on the trimmed lines and re-indent the replacement to the file.
  const same = (a: string, b: string) => a.trim() === b.trim();
  const shifted = indexOfLines(hay, needle, same).filter((at) => needle.every((n, k) => !n.trim() || !hay[at + k].trim() || true));
  if (shifted.length === 1) {
    const at = shifted[0];
    const firstReal = needle.findIndex((n) => n.trim());
    const fileIndent = firstReal >= 0 ? leading(hay[at + firstReal]) : '';
    const askedIndent = firstReal >= 0 ? leading(needle[firstReal]) : '';
    const reindented = repl.map((l) => {
      if (!l.trim()) return l;
      return l.startsWith(askedIndent) ? fileIndent + l.slice(askedIndent.length) : l;
    });
    return done(splice(at, reindented), 'indent');
  }
  if (shifted.length > 1) return { path, ok: false, error: `The SEARCH text matches ${shifted.length} places in ${path}. Add more surrounding lines so it matches exactly one.` };

  const first = needle.find((l) => l.trim())?.trim().slice(0, 80) ?? '';
  const near = hay.findIndex((l) => first && l.includes(first.slice(0, 30)));
  return {
    path,
    ok: false,
    error: `The SEARCH text was not found in ${path}${near >= 0 ? ` (its first line looks like line ${near + 1}, but the lines after it differ)` : ''}. Copy the lines exactly as they are in the file now.`,
  };
}

/** Applies a list of edits in order, each to the result of the one before, over a path → text map. */
export function applyEdits(files: Map<string, string>, edits: EditBlock[]): { files: Map<string, string>; results: EditResult[] } {
  const next = new Map(files);
  const results: EditResult[] = [];
  for (const edit of edits) {
    const r = applyEdit(next.get(edit.path), edit);
    results.push(r);
    if (r.ok && r.content !== undefined) next.set(edit.path, r.content);
  }
  return { files: next, results };
}
