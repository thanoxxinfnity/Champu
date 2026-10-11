// A parser for every language that has no compiler available here: definitions by pattern, calls by name, block ends by indentation or braces.
// It is approximate and says so (the graph marks names that more than one place defines as ambiguous). TypeScript/JavaScript use the real compiler (ts.mjs).

const KEYWORDS = new Set('if else elif for while match switch case return and or not in is as with try except catch finally raise throw new delete await async yield lambda func def fn function class struct enum impl trait self super this print range len int str float bool list dict set tuple var let const pass break continue import from using typeof sizeof assert elif then end do local null none true false null'.split(' '));

const DEFS = {
  py: [
    { re: /^(\s*)(?:async\s+)?def\s+(\w+)\s*\((.*?)\)?\s*(?:->\s*[^:]+)?:?/, kind: (ind, inClass) => (inClass ? 'method' : 'function'), name: 2, params: 3 },
    { re: /^(\s*)class\s+(\w+)/, kind: () => 'class', name: 2 },
  ],
  gd: [
    { re: /^(\s*)(?:static\s+)?func\s+(\w+)\s*\((.*?)\)/, kind: (ind, inClass) => (inClass ? 'method' : 'function'), name: 2, params: 3 },
    { re: /^(\s*)class_name\s+(\w+)/, kind: () => 'class', name: 2, noBody: true },
    { re: /^(\s*)class\s+(\w+)/, kind: () => 'class', name: 2 },
    { re: /^(\s*)signal\s+(\w+)/, kind: () => 'signal', name: 2, noBody: true },
  ],
  go: [
    { re: /^func\s+(?:\(\s*\w+\s+\*?(\w+)\s*\)\s*)?(\w+)\s*\((.*?)\)/, kind: (m) => (m ? 'method' : 'function'), name: 2, params: 3, brace: true },
    { re: /^type\s+(\w+)\s+(?:struct|interface)/, kind: () => 'class', name: 1, brace: true },
  ],
  rs: [
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\((.*?)\)/, kind: () => 'function', name: 1, params: 2, brace: true },
    { re: /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/, kind: () => 'class', name: 1, brace: true },
    { re: /^\s*impl(?:<[^>]*>)?\s+(?:\w+\s+for\s+)?(\w+)/, kind: () => 'impl', name: 1, brace: true },
  ],
  java: [
    { re: /^\s*(?:@\w+\s+)*(?:public|private|protected|internal|static|final|abstract|override|virtual|inline|suspend|async|fun|\w+(?:<[^>]*>)?(?:\[\])?\*?&?)\s+(?:static\s+|final\s+)*(?:[\w<>\[\],.?*&]+\s+)?(\w+)\s*\(([^;{)]*)\)\s*(?:const\s*)?(?:throws\s+[\w, .]+)?\s*\{/, kind: () => 'method', name: 1, params: 2, brace: true },
    { re: /^\s*(?:public\s+|private\s+|protected\s+|internal\s+|abstract\s+|final\s+|static\s+|sealed\s+|data\s+)*(?:class|interface|enum|struct|object)\s+(\w+)/, kind: () => 'class', name: 1, brace: true },
  ],
  rb: [
    { re: /^(\s*)def\s+(?:self\.)?(\w+[?!]?)\s*(?:\((.*?)\))?/, kind: () => 'method', name: 2, params: 3, end: true },
    { re: /^(\s*)(?:class|module)\s+(\w+)/, kind: () => 'class', name: 2, end: true },
  ],
  php: [
    { re: /^\s*(?:public\s+|private\s+|protected\s+|static\s+)*function\s+(\w+)\s*\((.*?)\)/, kind: () => 'function', name: 1, params: 2, brace: true },
    { re: /^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+(\w+)/, kind: () => 'class', name: 1, brace: true },
  ],
  lua: [{ re: /^\s*(?:local\s+)?function\s+([\w.:]+)\s*\((.*?)\)/, kind: () => 'function', name: 1, params: 2, end: true }],
  sh: [{ re: /^\s*(?:function\s+)?(\w+)\s*\(\)\s*\{?/, kind: () => 'function', name: 1, brace: true }],
};

const IMPORTS = {
  py: [/^\s*from\s+([\w.]+)\s+import\s+(.+)$/, /^\s*import\s+([\w., ]+)$/],
  gd: [/\b(?:preload|load)\(\s*["']([^"']+)["']/, /^\s*extends\s+["']?([\w./:]+)["']?/],
  go: [/^\s*import\s+(?:\w+\s+)?"([^"]+)"/, /^\s*"([^"]+)"\s*$/],
  rs: [/^\s*use\s+([\w:]+)/],
  java: [/^\s*(?:import|using)\s+([\w.]+)/],
  rb: [/^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/],
  php: [/^\s*use\s+([\w\\]+)/],
};

const indentOf = (s) => s.match(/^\s*/)[0].replace(/\t/g, '    ').length;

/** Last line (1-based) of the block that starts at line index i. */
function blockEnd(lines, i, mode, startIndent) {
  if (mode === 'brace') {
    let depth = 0, seen = false;
    for (let j = i; j < Math.min(lines.length, i + 4000); j++) {
      for (const ch of lines[j].replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '')) {
        if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--;
      }
      if (seen && depth <= 0) return j + 1;
    }
    return i + 1;
  }
  if (mode === 'end') {
    let depth = 0;
    for (let j = i; j < Math.min(lines.length, i + 4000); j++) {
      const t = lines[j].trim();
      if (/^(def|class|module|if|unless|while|for|case|begin|do)\b/.test(t) || /\bdo\s*(\|.*\|)?$/.test(t) || /^function\b/.test(t)) depth++;
      if (/^end\b/.test(t)) { depth--; if (depth <= 0) return j + 1; }
    }
    return i + 1;
  }
  let last = i;
  for (let j = i + 1; j < lines.length; j++) {
    if (!lines[j].trim()) continue;
    if (indentOf(lines[j]) <= startIndent) break;
    last = j;
  }
  return last + 1;
}

function docAbove(lines, i, lang, endLine) {
  const out = [];
  for (let j = i - 1; j >= 0 && out.length < 8; j--) {
    const t = lines[j].trim();
    if (/^(#|\/\/|\/\/\/|--)/.test(t)) out.unshift(t.replace(/^(#+|\/\/\/?|--)\s?/, ''));
    else if (t === '' && out.length === 0) continue;
    else break;
  }
  if (!out.length && (lang === 'py' || lang === 'gd')) {
    const nxt = lines.slice(i + 1, i + 6).join('\n').match(/^\s*(?:"""|''')([\s\S]*?)(?:"""|''')/);
    if (nxt) out.push(nxt[1].trim().split('\n')[0]);
  }
  return out.join(' ').slice(0, 300);
}

const splitParams = (s) => (s ?? '').split(',').map((p) => p.trim().replace(/^[*&]+/, '').split(/[\s:=]/)[0]).filter((p) => p && p !== 'self' && p !== 'cls');

export function parseGeneric(text, lang) {
  const lines = text.split('\n');
  const defs = DEFS[lang] ?? [];
  const symbols = [];
  const classStack = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(#|\/\/|--)/.test(line)) continue;
    for (const d of defs) {
      const m = line.match(d.re);
      if (!m) continue;
      const indent = indentOf(line);
      while (classStack.length && classStack[classStack.length - 1].indent >= indent && lang !== 'go') classStack.pop();
      const inClass = classStack.length > 0;
      const name = m[d.name];
      const kind = d.kind(lang === 'go' ? m[1] : indent, inClass);
      const mode = d.noBody ? 'none' : d.brace ? 'brace' : d.end ? 'end' : 'indent';
      const endLine = d.noBody ? i + 1 : blockEnd(lines, i, mode, indent);
      const parent = inClass ? classStack[classStack.length - 1].name : null;
      symbols.push({
        name, qname: parent ? `${parent}.${name}` : name, kind, line: i + 1, endLine,
        signature: line.trim().slice(0, 200), params: splitParams(d.params ? m[d.params] : ''), doc: docAbove(lines, i, lang, endLine),
        exported: lang === 'py' || lang === 'gd' ? !name.startsWith('_') : /^(pub|public|export)\b/.test(line.trim()) || /^[A-Z]/.test(name),
      });
      if (kind === 'class' && !d.noBody) classStack.push({ name, indent });
      break;
    }
  }
  // GDScript: the script is itself the class named by class_name / the file; its methods are methods.
  const edges = [];
  const sorted = [...symbols].filter((s) => s.kind !== 'signal' && s.kind !== 'class').sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line));
  const callRe = /(?<![\w.])((?:[\w]+\.)*)(\w+)\s*\(/g;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(#|\/\/|--)/.test(raw)) continue;
    const line = raw.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
    const owner = sorted.find((s) => i + 1 >= s.line && i + 1 <= s.endLine);
    if (!owner) continue;
    for (const m of line.matchAll(callRe)) {
      const nm = m[2];
      const prefix = m[1];
      if (KEYWORDS.has(nm) || nm === owner.name && m.index === line.indexOf(owner.name) && i + 1 === owner.line) continue;
      const rest = line.slice(m.index + m[0].length);
      edges.push({ from: owner.qname, to: nm, kind: 'call', line: i + 1, args: rest.split(')')[0].slice(0, 120), recv: !prefix ? 'plain' : /^(self|this|super)\.$/.test(prefix) ? 'self' : 'member' });
    }
    // Callables handed over by name: connect(_on_hit), Callable(self, "name"), signal.connect(name)
    for (const m of raw.matchAll(/Callable\([^,]+,\s*"(\w+)"\)|\.connect\(\s*(\w+)\s*[,)]|\.bind\(\s*(\w+)/g)) {
      const nm = m[1] ?? m[2] ?? m[3];
      if (nm && !KEYWORDS.has(nm)) edges.push({ from: owner.qname, to: nm, kind: 'ref', line: i + 1, args: '' });
    }
  }
  const imports = [];
  for (const re of IMPORTS[lang] ?? []) {
    for (const line of lines) {
      const m = line.match(re);
      if (m) imports.push({ spec: m[1].trim(), names: (m[2] ?? '').trim() });
    }
  }
  if (lang === 'gd') {
    const cn = text.match(/^class_name\s+(\w+)/m);
    if (cn) imports.push({ spec: `class:${cn[1]}`, names: '' });
  }
  return { symbols, edges, imports };
}
