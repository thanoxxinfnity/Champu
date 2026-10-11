// The symbol graph: who defines what, who calls whom, what depends on what, and what nothing reaches. Every answer carries a confidence,
// because calls are matched by name (exact for a unique name, "ambiguous" when several places define the same name).

const SYM = 'id, file, name, qname, kind, line, end_line AS endLine, signature, params, doc, exported';

export function findSymbols(db, name, { exact = false, kind, limit = 20 } = {}) {
  const like = exact ? name : `%${name}%`;
  const rows = db.prepare(`SELECT ${SYM} FROM symbols WHERE (name ${exact ? '=' : 'LIKE'} ? OR qname ${exact ? '=' : 'LIKE'} ?) ${kind ? 'AND kind = ?' : ''} ORDER BY (name = ?) DESC, exported DESC, length(name) LIMIT ?`)
    .all(...[like, like, ...(kind ? [kind] : []), name, limit]);
  return rows;
}

export const symbolById = (db, id) => db.prepare(`SELECT ${SYM} FROM symbols WHERE id = ?`).get(id);

/** One symbol from a name, "file:name", or "Class.method"; says so if the name is ambiguous. */
export function pickSymbol(db, ref) {
  let file = null, name = ref;
  const m = ref.match(/^(.+?\.\w+):(.+)$/);
  if (m) { file = m[1]; name = m[2]; }
  let rows = db.prepare(`SELECT ${SYM} FROM symbols WHERE (qname = ? OR name = ?) ${file ? 'AND file LIKE ?' : ''} ORDER BY (qname = ?) DESC, exported DESC`).all(...[name, name, ...(file ? [`%${file}`] : []), name]);
  if (!rows.length) return { symbol: null, candidates: findSymbols(db, name, { limit: 8 }) };
  return { symbol: rows[0], candidates: rows.slice(1, 8), ambiguous: rows.length > 1 };
}

/** Incoming edges to a symbol: resolved ones, plus same-named unresolved ones flagged as "maybe". */
export function callersOf(db, sym) {
  const sure = db.prepare('SELECT e.id, e.from_id, e.from_file, e.line, e.kind, e.args, s.qname AS from_name, s.file AS file FROM edges e LEFT JOIN symbols s ON s.id = e.from_id WHERE e.to_id = ?').all(sym.id)
    .map((r) => ({ ...r, confidence: 'resolved' }));
  const maybe = db.prepare('SELECT e.id, e.from_id, e.from_file, e.line, e.kind, e.args, e.ambiguous, s.qname AS from_name, s.file AS file FROM edges e LEFT JOIN symbols s ON s.id = e.from_id WHERE e.to_name = ? AND e.to_id IS NULL AND e.ambiguous > 0').all(sym.name)
    .map((r) => ({ ...r, confidence: `ambiguous (${r.ambiguous} places define "${sym.name}")` }));
  return [...sure, ...maybe];
}

export function calleesOf(db, sym) {
  return db.prepare('SELECT e.id, e.to_name, e.to_id, e.kind, e.line, e.args, e.ambiguous, t.file AS to_file, t.qname AS to_qname, t.line AS to_line FROM edges e LEFT JOIN symbols t ON t.id = e.to_id WHERE e.from_id = ? ORDER BY e.line').all(sym.id);
}

/** Breadth-first walk up the callers (who ends up calling this?), depth-limited, each node once. */
export function callerTree(db, sym, depth = 3, limit = 60) {
  const seen = new Set([sym.id]);
  const out = [];
  let frontier = [{ s: sym, path: [sym.qname] }];
  for (let d = 1; d <= depth && frontier.length && out.length < limit; d++) {
    const next = [];
    for (const { s, path } of frontier) {
      for (const c of callersOf(db, s)) {
        if (!c.from_id || seen.has(c.from_id)) continue;
        seen.add(c.from_id);
        const caller = symbolById(db, c.from_id);
        if (!caller) continue;
        const node = { depth: d, symbol: caller, line: c.line, confidence: c.confidence, path: [caller.qname, ...path] };
        out.push(node);
        next.push({ s: caller, path: node.path });
        if (out.length >= limit) break;
      }
    }
    frontier = next;
  }
  return out;
}

export function calleeTree(db, sym, depth = 2, limit = 60) {
  const seen = new Set([sym.id]);
  const out = [];
  let frontier = [sym];
  for (let d = 1; d <= depth && frontier.length && out.length < limit; d++) {
    const next = [];
    for (const s of frontier) {
      for (const e of calleesOf(db, s)) {
        if (!e.to_id || seen.has(e.to_id)) continue;
        seen.add(e.to_id);
        const callee = symbolById(db, e.to_id);
        if (callee) { out.push({ depth: d, symbol: callee, line: e.line, from: s.qname }); next.push(callee); }
        if (out.length >= limit) break;
      }
    }
    frontier = next;
  }
  return out;
}

/** The shortest chain of calls from one symbol to another. */
export function callPath(db, from, to, maxDepth = 8) {
  const prev = new Map([[from.id, null]]);
  let frontier = [from.id];
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next = [];
    for (const id of frontier) {
      for (const e of db.prepare('SELECT to_id, line FROM edges WHERE from_id = ? AND to_id IS NOT NULL').all(id)) {
        if (prev.has(e.to_id)) continue;
        prev.set(e.to_id, { id, line: e.line });
        if (e.to_id === to.id) {
          const chain = [];
          for (let cur = to.id; cur != null; cur = prev.get(cur)?.id ?? null) chain.unshift({ symbol: symbolById(db, cur), line: prev.get(cur)?.line ?? null });
          return chain;
        }
        next.push(e.to_id);
      }
    }
    frontier = next;
  }
  return null;
}

export function references(db, sym, limit = 50) {
  return db.prepare('SELECT e.line, e.kind, e.from_file AS file, s.qname AS inside FROM edges e LEFT JOIN symbols s ON s.id = e.from_id WHERE e.to_id = ? OR (e.to_name = ? AND e.to_id IS NULL) ORDER BY e.from_file, e.line LIMIT ?').all(sym.id, sym.name, limit);
}

/** Everything that would be touched if this symbol changed: its transitive callers, grouped by file. */
export function impact(db, sym, depth = 5) {
  const tree = callerTree(db, sym, depth, 400);
  const files = new Map();
  for (const n of tree) files.set(n.symbol.file, (files.get(n.symbol.file) ?? 0) + 1);
  return { affected: tree.length, files: [...files.entries()].sort((a, b) => b[1] - a[1]), tree };
}

export function fileDependencies(db, file) {
  const uses = db.prepare('SELECT spec, resolved, names FROM imports WHERE file = ? ORDER BY resolved IS NULL, spec').all(file);
  const usedBy = db.prepare('SELECT file, names FROM imports WHERE resolved = ? ORDER BY file').all(file);
  return { imports: uses, importedBy: usedBy };
}

const ENTRY_NAME = /^(main|__main__|_ready|_process|_physics_process|_input|_unhandled_input|_init|_enter_tree|_exit_tree|_draw|constructor|default|setup|run|handler|GET|POST|PUT|PATCH|DELETE|middleware|generateMetadata|generateStaticParams|__init__|__call__|test\w*|\w*_test|it|describe|before\w*|after\w*|on_\w+|_on_\w+)$/;
const ENTRY_FILE = /(^|\/)(index|main|app|server|cli|page|layout|route|middleware|bin\/[^/]+|scripts\/[^/]+|tests?\/[^/]+|[^/]*\.(test|spec)\.\w+|[^/]*_test\.\w+)(\.|$)/;

/** Symbols no one reaches. `strict`: also treats public exports as unused if nothing in the project uses them. */
export function deadCode(db, { strict = false, path, limit = 80 } = {}) {
  const rows = db.prepare(`SELECT ${SYM} FROM symbols WHERE kind IN ('function','method','class') ${path ? 'AND file LIKE ?' : ''} ORDER BY file, line`).all(...(path ? [`${path}%`] : []));
  const out = [];
  const incoming = db.prepare('SELECT COUNT(*) AS n FROM edges WHERE to_id = ? OR (to_name = ? AND to_id IS NULL)');
  for (const s of rows) {
    if (ENTRY_NAME.test(s.name) || ENTRY_FILE.test(s.file)) continue;
    if (s.exported && !strict) continue;
    if (incoming.get(s.id, s.name).n === 0) out.push({ ...s, why: s.exported ? 'exported but nothing in the project uses it' : 'nothing calls or references it' });
    if (out.length >= limit) break;
  }
  return out;
}

/** Symbols not reachable from any entry point (so a whole cluster of dead functions that only call each other shows up). Exports count as entry points unless `strict`. */
export function unreachable(db, { path, limit = 80, strict = false } = {}) {
  const all = db.prepare(`SELECT ${SYM} FROM symbols WHERE kind IN ('function','method','class')`).all();
  const entries = all.filter((s) => ENTRY_NAME.test(s.name) || ENTRY_FILE.test(s.file) || (!strict && s.exported));
  const seen = new Set();
  const stack = entries.map((s) => s.id);
  const next = db.prepare('SELECT to_id FROM edges WHERE from_id = ? AND to_id IS NOT NULL');
  const byFile = db.prepare('SELECT id FROM symbols WHERE file = ? AND kind IN (\'function\',\'method\',\'class\')');
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of next.all(id)) stack.push(e.to_id);
  }
  // calls made at file level (no enclosing symbol) start from the file: whatever they name is reachable
  for (const e of db.prepare('SELECT to_id FROM edges WHERE from_id IS NULL AND to_id IS NOT NULL').all()) stack.push(e.to_id);
  while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); for (const e of next.all(id)) stack.push(e.to_id); }
  void byFile;
  return all.filter((s) => !seen.has(s.id) && (!path || s.file.startsWith(path))).slice(0, limit);
}

/** Leaves of the call graph worth knowing: functions that call nothing the project defines (where a trace ends). */
export function deadEnds(db, { path, limit = 60 } = {}) {
  const rows = db.prepare(`SELECT ${SYM} FROM symbols WHERE kind IN ('function','method') ${path ? 'AND file LIKE ?' : ''}`).all(...(path ? [`${path}%`] : []));
  const out = db.prepare('SELECT COUNT(*) AS n FROM edges WHERE from_id = ? AND to_id IS NOT NULL');
  const inn = db.prepare('SELECT COUNT(*) AS n FROM edges WHERE to_id = ?');
  return rows.filter((s) => out.get(s.id).n === 0 && inn.get(s.id).n > 0).sort((a, b) => inn.get(b.id).n - inn.get(a.id).n).slice(0, limit);
}

export function overview(db) {
  const langs = db.prepare('SELECT lang, COUNT(*) AS files, SUM(lines) AS lines FROM files GROUP BY lang ORDER BY lines DESC').all();
  const dirs = db.prepare("SELECT substr(path, 1, instr(path || '/', '/') - 1) AS dir, COUNT(*) AS files FROM files GROUP BY dir ORDER BY files DESC LIMIT 12").all();
  const hot = db.prepare('SELECT s.qname, s.file, s.line, COUNT(e.id) AS callers FROM symbols s JOIN edges e ON e.to_id = s.id GROUP BY s.id ORDER BY callers DESC LIMIT 12').all();
  const totals = db.prepare('SELECT (SELECT COUNT(*) FROM files) AS files, (SELECT COUNT(*) FROM symbols) AS symbols, (SELECT COUNT(*) FROM edges) AS edges, (SELECT COUNT(*) FROM edges WHERE to_id IS NOT NULL) AS resolved').get();
  return { totals, langs, dirs, hot };
}
