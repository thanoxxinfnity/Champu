/**
 * A map of the project: which file holds which functions, classes and exports, ranked by what the request is about.
 *
 * The idea behind Aider's "repo map": a model that has to change a project does not need every file in its context, it needs to know
 * where things are and to read the few files that matter in full. Symbols are found with per-language patterns (no parser to ship to a
 * phone); files are ranked by how well their path and symbols match the request and by how many other files use what they define.
 * Pure text work, so it is tested directly.
 */

export interface MapFile {
  path: string;
  content: string;
}

export interface Symbol {
  name: string;
  kind: 'function' | 'class' | 'method' | 'type' | 'const' | 'selector' | 'id' | 'node';
  /** The line as written, shortened — what the map shows. */
  signature: string;
  line: number;
  /** Nested under the previous class. */
  nested?: boolean;
}

export interface FileEntry {
  path: string;
  lines: number;
  symbols: Symbol[];
  score: number;
}

const SKIP = /(^|\/)(node_modules|\.git|\.next|dist|build|out|\.gradle|\.artifacts|__pycache__)\//;
const BINARY_OR_BULK = /\.(png|jpe?g|gif|webp|ico|mp3|wav|ogg|glb|gltf|apk|zip|woff2?|ttf|otf|lock|map|min\.js)$|package-lock\.json$/i;

const short = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/\{\s*$/, '').slice(0, 110);

type Rule = { re: RegExp; kind: Symbol['kind']; name: number };

const JS: Rule[] = [
  { re: /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: 'function', name: 1 },
  { re: /^\s*(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/, kind: 'function', name: 1 },
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class', name: 1 },
  { re: /^\s*export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/, kind: 'type', name: 1 },
  { re: /^\s*(?:interface|enum)\s+([A-Za-z_$][\w$]*)/, kind: 'type', name: 1 },
  { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/, kind: 'function', name: 1 },
  { re: /^\s*export\s+const\s+([A-Z][A-Z0-9_]{2,})\b/, kind: 'const', name: 1 },
];
const JS_METHOD: Rule = { re: /^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|async\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/, kind: 'method', name: 1 };

const RULES: Array<[RegExp, Rule[]]> = [
  [/\.(tsx?|jsx?|mjs|cjs)$/i, JS],
  [/\.py$/i, [
    { re: /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, kind: 'function', name: 1 },
    { re: /^class\s+([A-Za-z_]\w*)/, kind: 'class', name: 1 },
    { re: /^\s{4,}(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, kind: 'method', name: 1 },
  ]],
  [/\.gd$/i, [
    { re: /^(?:static\s+)?func\s+([A-Za-z_]\w*)\s*\(/, kind: 'function', name: 1 },
    { re: /^class_name\s+([A-Za-z_]\w*)/, kind: 'class', name: 1 },
    { re: /^class\s+([A-Za-z_]\w*)/, kind: 'class', name: 1 },
    { re: /^(?:signal)\s+([A-Za-z_]\w*)/, kind: 'const', name: 1 },
  ]],
  [/\.(kt|kts|java)$/i, [
    { re: /^\s*(?:(?:public|private|internal|protected|open|abstract|data|sealed|final|static)\s+)*(?:class|interface|object|enum class)\s+([A-Za-z_]\w*)/, kind: 'class', name: 1 },
    { re: /^\s*(?:(?:public|private|internal|protected|open|override|suspend|static|final)\s+)*fun\s+(?:<[^>]+>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\(/, kind: 'function', name: 1 },
    { re: /^\s*(?:(?:public|private|protected|static|final|synchronized)\s+)+[\w<>\[\],.? ]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:throws [\w, .]+)?\{/, kind: 'method', name: 1 },
  ]],
  [/\.(go)$/i, [
    { re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, kind: 'function', name: 1 },
    { re: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/, kind: 'type', name: 1 },
  ]],
  [/\.rs$/i, [
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, kind: 'function', name: 1 },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|impl)\s+([A-Za-z_]\w*)/, kind: 'type', name: 1 },
  ]],
  [/\.css$|\.scss$/i, [
    { re: /^\s*(\.[A-Za-z_-][\w-]*|#[A-Za-z_-][\w-]*)\s*[,{]/, kind: 'selector', name: 1 },
  ]],
  [/\.html?$/i, [
    { re: /<(?:[a-z0-9-]+)[^>]*\sid=["']([^"']+)["']/i, kind: 'id', name: 1 },
  ]],
  [/\.tscn$|\.tres$/i, [
    { re: /^\[node name="([^"]+)"/, kind: 'node', name: 1 },
  ]],
  [/\.(sh|bash)$/i, [
    { re: /^(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{/, kind: 'function', name: 1 },
  ]],
];

/** The symbols one file defines, in order. Method patterns apply only below a class. */
export function symbolsOf(path: string, content: string): Symbol[] {
  const rules = RULES.find(([ext]) => ext.test(path))?.[1];
  if (!rules) return [];
  const isJs = rules === JS;
  const out: Symbol[] = [];
  const lines = content.split('\n');
  let inClass = false;
  for (let i = 0; i < lines.length && out.length < 400; i++) {
    const line = lines[i];
    if (line.length > 400) continue;
    let hit: Symbol | undefined;
    for (const rule of rules) {
      const m = rule.re.exec(line);
      if (!m) continue;
      if (rule.kind === 'method' && !inClass) continue;
      hit = { name: m[rule.name], kind: rule.kind, signature: short(line), line: i + 1, nested: rule.kind === 'method' };
      break;
    }
    if (!hit && isJs && inClass) {
      const m = JS_METHOD.re.exec(line);
      if (m && !/^(if|for|while|switch|catch|return|function)$/.test(m[1])) hit = { name: m[1], kind: 'method', signature: short(line), line: i + 1, nested: true };
    }
    if (hit) {
      if (hit.kind === 'class') inClass = true;
      else if (!hit.nested && /^\S/.test(line)) inClass = false;
      out.push(hit);
    } else if (/^\S/.test(line) && !/^[)\]}]/.test(line) && inClass && !/^\s*(\/\/|\*|#)/.test(line)) {
      // a new top-level statement ends the class
      inClass = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\b/.test(line);
    }
  }
  return out;
}

const STOP = new Set('the a an and or of to in on for with from this that it is are be as at by add fix make use new file files code project app please can you me my i want need change update create build write bug error not work works working'.split(' '));

/** The words of a request that can point at code: lower-cased, split on case and punctuation, without filler. */
export function queryTerms(query: string): string[] {
  const words = query
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(words)];
}

const words = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Every file with its symbols and a relevance score, best first. */
export function rankFiles(files: MapFile[], query = '', opts: { focus?: string[] } = {}): FileEntry[] {
  const usable = files.filter((f) => typeof f.content === 'string' && !f.content.startsWith('data:') && !SKIP.test(f.path) && !BINARY_OR_BULK.test(f.path) && !f.path.startsWith('untitled/'));
  const terms = queryTerms(query);
  const focus = new Set(opts.focus ?? []);

  const entries: FileEntry[] = usable.map((f) => ({ path: f.path, lines: f.content.split('\n').length, symbols: symbolsOf(f.path, f.content), score: 0 }));

  // How many other files mention what a file defines (a name used everywhere is central).
  const defined = new Map<string, Set<string>>();
  for (const e of entries) for (const s of e.symbols) if (s.name.length > 3 && s.kind !== 'selector' && s.kind !== 'id' && s.kind !== 'node') {
    if (!defined.has(s.name)) defined.set(s.name, new Set());
    defined.get(s.name)!.add(e.path);
  }
  const used = new Map<string, number>();
  if (defined.size) {
    const names = [...defined.keys()];
    for (const f of usable) {
      const bag = new Set(f.content.match(/[A-Za-z_$][\w$]{3,}/g) ?? []);
      for (const n of names) if (bag.has(n)) for (const owner of defined.get(n)!) if (owner !== f.path) used.set(owner, (used.get(owner) ?? 0) + 1);
    }
  }

  for (const e of entries) {
    const pathWords = new Set(words(e.path));
    const symbolWords = new Set(e.symbols.flatMap((s) => words(s.name)));
    let score = 0;
    for (const t of terms) {
      if (pathWords.has(t)) score += 6;
      else if (e.path.toLowerCase().includes(t)) score += 3;
      if (symbolWords.has(t)) score += 3;
    }
    score += Math.min(4, Math.log2(1 + (used.get(e.path) ?? 0)));
    if (focus.has(e.path)) score += 12;
    if (/(^|\/)(index|main|app|page|layout)\.[a-z]+$/i.test(e.path)) score += 0.8;
    if (/(^|\/)(test|tests|__tests__|scripts)\/|\.(test|spec)\./i.test(e.path)) score -= 1.5;
    e.score = score;
  }
  return entries.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

/** The map as text: each file with its symbols, the most relevant first, cut to the budget. */
export function buildRepoMap(files: MapFile[], opts: { query?: string; maxChars?: number; focus?: string[] } = {}): string {
  const maxChars = opts.maxChars ?? 6000;
  const ranked = rankFiles(files, opts.query ?? '', { focus: opts.focus });
  const parts: string[] = [];
  let used = 0;
  let left = 0;
  for (const e of ranked) {
    const head = `${e.path}  (${e.lines} line${e.lines === 1 ? '' : 's'})`;
    const body: string[] = [];
    for (const s of e.symbols.slice(0, e.score > 4 ? 60 : 14)) body.push(`${s.nested ? '    ' : '  '}⋮ ${s.signature}`);
    if (e.symbols.length > (e.score > 4 ? 60 : 14)) body.push(`  ⋮ … ${e.symbols.length - (e.score > 4 ? 60 : 14)} more`);
    const piece = [head, ...body].join('\n');
    if (used + piece.length + 1 > maxChars) { left++; continue; }
    used += piece.length + 1;
    parts.push(piece);
  }
  if (left) parts.push(`… ${left} more file${left === 1 ? '' : 's'} not shown (ask for one by path).`);
  return parts.join('\n');
}

/**
 * What a model is shown of the project: small projects whole, big ones as a map plus the files that matter in full.
 * `fullChars` is what the whole-file part may use; the map takes `mapChars` on top.
 */
export function projectView(files: MapFile[], opts: { query?: string; fullChars?: number; mapChars?: number; focus?: string[] } = {}): { text: string; mode: 'whole' | 'map'; included: string[] } {
  const fullChars = opts.fullChars ?? 30_000;
  const ranked = rankFiles(files, opts.query ?? '', { focus: opts.focus });
  const byPath = new Map(files.map((f) => [f.path, f]));
  const total = ranked.reduce((n, e) => n + (byPath.get(e.path)?.content.length ?? 0), 0);
  const block = (p: string) => `### ${p}\n\`\`\`\n${byPath.get(p)!.content}\n\`\`\``;

  if (total <= fullChars) {
    return { text: ranked.map((e) => block(e.path)).join('\n\n'), mode: 'whole', included: ranked.map((e) => e.path) };
  }
  const included: string[] = [];
  const pieces: string[] = [];
  let used = 0;
  for (const e of ranked) {
    const len = byPath.get(e.path)!.content.length;
    if (e.score <= 0 && included.length) break;
    if (used + len > fullChars) continue;
    used += len;
    included.push(e.path);
    pieces.push(block(e.path));
  }
  const map = buildRepoMap(files, { query: opts.query, maxChars: opts.mapChars ?? 5000, focus: opts.focus });
  return {
    text: `Project map (every file and what it defines; files not shown in full below can be changed with edit blocks if you copy their lines exactly, or ask for them):\n${map}\n\nFiles most relevant to the request, in full:\n\n${pieces.join('\n\n')}`,
    mode: 'map',
    included,
  };
}
