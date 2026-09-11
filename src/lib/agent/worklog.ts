import type { CommandArtifact, FileArtifact } from './artifacts';

/**
 * What the run actually did, per file.
 *
 * A build used to end by dropping files into a panel, which left the obvious
 * question unanswered: what is in them, and which one holds the thing I asked
 * for? This reads each generated file and says what it defines, so the run
 * reports its work the way a developer would hand it over.
 *
 * Every fact here is derived from the file itself rather than asked of the
 * model — a summary the model writes about its own output can be wrong, a line
 * count cannot.
 */

export interface FileChange {
  path: string;
  language: string;
  action: 'created' | 'updated';
  lines: number;
  bytes: number;
  /** Net line change against the previous version; 0 for a new file. */
  delta: number;
  /** What the file defines, read out of its contents. */
  defines: string;
}

const MAX_SYMBOLS = 4;

function uniq(xs: string[]): string[] {
  return [...new Set(xs)].filter(Boolean);
}

function matchAll(content: string, re: RegExp, group = 1): string[] {
  return [...content.matchAll(re)].map((m) => m[group]).filter(Boolean);
}

/**
 * A one-line description of a file, by language.
 *
 * Deliberately shallow: regexes over source, not a parser. The cost of being
 * wrong here is a slightly vague sentence, and the cost of a parser per
 * language is not worth paying for that.
 */
export function describeContents(path: string, language: string, content: string): string {
  const lang = (language || path.split('.').pop() || '').toLowerCase();
  const name = path.split('/').pop() ?? path;

  if (/^(ts|tsx|js|jsx|mjs|cjs)$/.test(lang)) {
    const symbols = uniq([
      ...matchAll(content, /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g),
      ...matchAll(content, /export\s+(?:const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g),
    ]);
    if (content.includes('export default')) symbols.push('default export');
    if (symbols.length) return `exports ${list(symbols)}`;
    const local = uniq(matchAll(content, /(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g));
    if (local.length) return `defines ${list(local)}`;
  }

  if (/^(kt|kts|java)$/.test(lang)) {
    const types = uniq([
      ...matchAll(content, /\b(?:class|object|interface|enum class|data class)\s+([A-Za-z_][\w]*)/g),
    ]);
    const funs = uniq(matchAll(content, /\bfun\s+([A-Za-z_][\w]*)/g));
    if (types.length) return `defines ${list(types)}${funs.length ? ` with ${funs.length} function${funs.length === 1 ? '' : 's'}` : ''}`;
    if (funs.length) return `defines ${list(funs)}`;
  }

  if (/^(py)$/.test(lang)) {
    const defs = uniq([
      ...matchAll(content, /(?:^|\n)class\s+([A-Za-z_]\w*)/g),
      ...matchAll(content, /(?:^|\n)def\s+([A-Za-z_]\w*)/g),
    ]);
    if (defs.length) return `defines ${list(defs)}`;
  }

  if (lang === 'json') {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (Array.isArray(parsed)) return `${parsed.length} entries`;
      if (parsed && typeof parsed === 'object') {
        const keys = Object.keys(parsed as Record<string, unknown>);
        return `keys ${list(keys)}`;
      }
    } catch {
      return 'JSON data';
    }
  }

  if (/^(md|markdown)$/.test(lang)) {
    const heading = content.match(/^#\s+(.+)$/m)?.[1];
    return heading ? `notes: ${heading.trim()}` : 'documentation';
  }

  if (/^(css|scss)$/.test(lang)) {
    const rules = (content.match(/\{/g) ?? []).length;
    return `${rules} style rule${rules === 1 ? '' : 's'}`;
  }

  if (/^(xml|html)$/.test(lang)) {
    const root = content.match(/<([A-Za-z][\w.-]*)/)?.[1];
    return root ? `<${root}> document` : 'markup';
  }

  if (/^(gradle|properties|toml|yml|yaml|env)$/.test(lang)) return 'configuration';

  return name;
}

function list(xs: string[]): string {
  const shown = xs.slice(0, MAX_SYMBOLS);
  const rest = xs.length - shown.length;
  const joined =
    shown.length <= 1
      ? shown.join('')
      : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${joined} (+${rest} more)` : joined;
}

export function countLines(content: string): number {
  if (!content) return 0;
  return content.endsWith('\n') ? content.split('\n').length - 1 : content.split('\n').length;
}

/** Compares what the run produced against what was already in the workspace. */
export function describeFileWork(
  files: FileArtifact[],
  previous: Map<string, FileArtifact>,
): FileChange[] {
  return files.map((f) => {
    const before = previous.get(f.path);
    const lines = countLines(f.content);
    return {
      path: f.path,
      language: f.language,
      action: before ? 'updated' : 'created',
      lines,
      bytes: f.bytes,
      delta: before ? lines - countLines(before.content) : 0,
      defines: describeContents(f.path, f.language, f.content),
    };
  });
}

/**
 * The hand-over note, as markdown.
 *
 * Returns an empty string when there is nothing to report, so the caller can
 * skip posting rather than showing an empty "here is what I did".
 */
export function renderWorkLog(changes: FileChange[], commands: CommandArtifact[] = []): string {
  if (!changes.length && !commands.length) return '';

  const lines: string[] = [];
  const created = changes.filter((c) => c.action === 'created').length;
  const updated = changes.length - created;

  const parts: string[] = [];
  if (created) parts.push(`${created} file${created === 1 ? '' : 's'} created`);
  if (updated) parts.push(`${updated} updated`);
  const total = changes.reduce((n, c) => n + c.lines, 0);
  if (total) parts.push(`${total} line${total === 1 ? '' : 's'}`);

  lines.push(`**What I did** — ${parts.join(' · ')}`, '');

  for (const c of changes) {
    const verb = c.action === 'created' ? 'Created' : 'Updated';
    // A net line change is only interesting on a file that already existed.
    const churn =
      c.action === 'updated' && c.delta !== 0 ? ` (${c.delta > 0 ? '+' : ''}${c.delta} lines)` : '';
    lines.push(`- **${verb}** \`${c.path}\` — ${c.defines}. ${c.lines} lines${churn}`);
  }

  if (commands.length) {
    lines.push('', `**Commands run** — ${commands.length}`, '');
    for (const cmd of commands) {
      const where = cmd.cwd ? ` in \`${cmd.cwd}\`` : '';
      lines.push(`- \`${cmd.command}\`${where}`);
    }
  }

  return lines.join('\n');
}
