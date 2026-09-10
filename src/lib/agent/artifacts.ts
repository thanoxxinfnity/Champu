/**
 * Streaming artifact extractor.
 *
 * Lane B answers arrive as a token stream containing fenced blocks tagged with a
 * path. This pulls files and terminal commands out *while* the stream is still
 * running so the file manager and terminal light up mid-answer instead of after.
 *
 *   ```ts path=src/lib/x.ts
 *   ...
 *   ```
 *   ```bash path=@terminal cwd=/work/app
 *   ./gradlew assembleDebug
 *   ```
 */

export interface FileArtifact {
  kind: 'file';
  path: string;
  language: string;
  content: string;
  complete: boolean;
  bytes: number;
}

export interface CommandArtifact {
  kind: 'command';
  command: string;
  cwd?: string;
  complete: boolean;
}

export type Artifact = FileArtifact | CommandArtifact;

const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\n]*)$/;

interface Meta {
  language: string;
  path?: string;
  cwd?: string;
}

export function parseInfoString(info: string): Meta {
  const trimmed = info.trim();
  if (!trimmed) return { language: 'text' };

  const tokens = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const meta: Meta = { language: 'text' };

  tokens.forEach((tok, i) => {
    const eq = tok.indexOf('=');
    if (eq > 0) {
      const key = tok.slice(0, eq).toLowerCase();
      const value = tok.slice(eq + 1).replace(/^["']|["']$/g, '');
      if (key === 'path' || key === 'file' || key === 'filename') meta.path = value;
      else if (key === 'cwd' || key === 'dir') meta.cwd = value;
      return;
    }
    if (i === 0) meta.language = tok.toLowerCase();
    // A bare token that looks like a path is treated as one: ```ts src/a.ts
    else if (!meta.path && /[/.]/.test(tok) && !tok.includes(':')) meta.path = tok;
  });

  return meta;
}

const EXT_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  json: 'json', md: 'markdown', css: 'css', scss: 'scss', html: 'html', htm: 'html',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'toml',
  xml: 'xml', gradle: 'groovy', sql: 'sql', dockerfile: 'dockerfile', env: 'bash',
};

export function languageForPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  if (/^dockerfile$/i.test(base)) return 'dockerfile';
  if (/^makefile$/i.test(base)) return 'makefile';
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
  return EXT_LANGUAGE[ext] ?? 'text';
}

/** Reject traversal and absolute paths before anything touches a filesystem. */
export function sanitizePath(path: string): string | null {
  const clean = path.trim().replace(/^\.\//, '').replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean)) return null;
  if (clean.split('/').some((seg) => seg === '..')) return null;
  if (clean.length > 400) return null;
  return clean;
}

/**
 * Incremental parser. Feed it the *whole* accumulated text on every tick — it is
 * cheap and idempotent, which beats trying to keep a delta-based state machine
 * correct across chunk boundaries that split a fence in half.
 */
export function extractArtifacts(text: string): Artifact[] {
  const lines = text.split('\n');
  const out: Artifact[] = [];

  let open: { fence: string; indent: string; meta: Meta; body: string[] } | null = null;

  for (const line of lines) {
    if (open) {
      const close = FENCE.exec(line);
      // A closing fence is the same char, at least as long, and carries no info.
      if (close && close[2][0] === open.fence[0] && close[2].length >= open.fence.length && !close[3].trim()) {
        out.push(finish(open, true));
        open = null;
        continue;
      }
      open.body.push(line.startsWith(open.indent) ? line.slice(open.indent.length) : line);
      continue;
    }

    const match = FENCE.exec(line);
    if (match) open = { fence: match[2], indent: match[1], meta: parseInfoString(match[3]), body: [] };
  }

  // A block still streaming is emitted as incomplete so the UI can show progress.
  if (open) out.push(finish(open, false));

  return out.filter(Boolean);
}

function finish(
  open: { meta: Meta; body: string[] },
  complete: boolean,
): Artifact {
  const content = open.body.join('\n');
  const { meta } = open;

  if (meta.path === '@terminal' || meta.path === '@shell') {
    return {
      kind: 'command',
      command: content.trim(),
      cwd: meta.cwd,
      complete,
    };
  }

  const path = meta.path ? sanitizePath(meta.path) : null;
  return {
    kind: 'file',
    path: path ?? `untitled/snippet-${hashish(content)}.${extFor(meta.language)}`,
    language: path ? languageForPath(path) : meta.language,
    content,
    complete,
    bytes: new TextEncoder().encode(content).length,
  };
}

function extFor(language: string): string {
  const entry = Object.entries(EXT_LANGUAGE).find(([, l]) => l === language);
  return entry?.[0] ?? 'txt';
}

function hashish(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6);
}

export function filesOf(artifacts: Artifact[]): FileArtifact[] {
  return artifacts.filter((a): a is FileArtifact => a.kind === 'file');
}

export function commandsOf(artifacts: Artifact[]): CommandArtifact[] {
  return artifacts.filter((a): a is CommandArtifact => a.kind === 'command');
}

/**
 * Merge a new extraction into an existing file map.
 * Later blocks for the same path win — the model rewriting a file mid-run is a
 * correction, not a duplicate.
 */
export function mergeFiles(
  existing: Map<string, FileArtifact>,
  incoming: FileArtifact[],
): Map<string, FileArtifact> {
  const next = new Map(existing);
  for (const file of incoming) {
    const prior = next.get(file.path);
    // Never let a half-streamed block clobber a completed one.
    if (prior?.complete && !file.complete) continue;
    next.set(file.path, file);
  }
  return next;
}

/** Strip artifact fences from prose so the chat bubble stays readable. */
export function stripArtifactBlocks(text: string): string {
  return text.replace(
    /^([ \t]*)(`{3,}|~{3,})[ \t]*[^\n]*(?:path|file|filename)=[^\n]*\n[\s\S]*?(?:\1\2[ \t]*$|$)/gm,
    (_m, _i, _f) => '',
  );
}
