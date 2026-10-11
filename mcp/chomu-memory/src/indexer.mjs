// Walks the project, parses what changed, and fills the map: files, symbols, edges (calls, extends, refs), imports, and one searchable card per symbol and per file.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { createHash } from 'node:crypto';
import { tx, getMeta, setMeta } from './db.mjs';
import { shouldIndex, langOf, redact, toPosix, IGNORED_DIRS, loadIgnore } from './privacy.mjs';
import { parseTs } from './parsers/ts.mjs';
import { parseGeneric } from './parsers/generic.mjs';
import { vecToBlob } from './embed.mjs';

export const sha1 = (s) => createHash('sha1').update(s).digest('hex');

function* walk(root, rel = '', ignored = loadIgnore(root)) {
  let entries;
  try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github' && !/^\.(env|gitignore)/.test(e.name) && e.isDirectory()) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (ignored(r)) continue;
    if (e.isDirectory()) { if (!IGNORED_DIRS.has(e.name)) yield* walk(root, r, ignored); }
    else if (e.isFile()) yield r;
  }
}

export function parseFile(text, rel, root) {
  const lang = langOf(rel);
  if (lang === 'ts') return parseTs(text, rel, root);
  if (['doc', 'data'].includes(lang)) return { symbols: [], edges: [], imports: [] };
  return parseGeneric(text, lang);
}

const firstLines = (text, from, to, max = 700) => text.split('\n').slice(from - 1, to).map((l) => l.trim()).filter(Boolean).join(' ⏎ ').slice(0, max);

function symbolCard(sym, calls, file, bodyText) {
  return [
    `${sym.kind} ${sym.qname} in ${file}:${sym.line}`, sym.signature, sym.doc ? `does: ${sym.doc}` : '',
    calls.length ? `calls: ${[...new Set(calls)].slice(0, 25).join(', ')}` : '', bodyText ? `body: ${bodyText}` : '',
  ].filter(Boolean).join('\n');
}

/** Bring the index up to date. Only files whose size/time/hash changed are read again. Returns counts. */
export async function indexProject(ctx, { force = false } = {}) {
  const { db, root, embedder } = ctx;
  const seen = new Set();
  const stats = { files: 0, changed: 0, removed: 0, symbols: 0, edges: 0, skipped: 0 };
  const known = new Map(db.prepare('SELECT path, hash, size, mtime FROM files').all().map((r) => [r.path, r]));
  const pending = [];
  for (const rel of walk(root)) {
    let st;
    try { st = statSync(join(root, rel)); } catch { continue; }
    if (!shouldIndex(rel, st.size)) { stats.skipped++; continue; }
    seen.add(rel);
    stats.files++;
    const k = known.get(rel);
    if (!force && k && k.size === st.size && Math.abs(k.mtime - st.mtimeMs) < 1) continue;
    let text;
    try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    const hash = sha1(text);
    if (!force && k && k.hash === hash) { db.prepare('UPDATE files SET mtime = ? WHERE path = ?').run(st.mtimeMs, rel); continue; }
    pending.push({ rel, text, hash, st });
  }
  const gone = [...known.keys()].filter((p) => !seen.has(p));
  const embedderId = getMeta(db, 'embedder');
  const reembed = embedderId && embedderId !== embedder.id;
  if (reembed) { db.exec('DELETE FROM chunks; DELETE FROM chunks_fts; DELETE FROM files'); pending.length = 0; return indexProject(ctx, { force: true }); }
  for (const rel of gone) { removeFile(db, rel); stats.removed++; }

  for (const f of pending) {
    const parsed = (() => { try { return parseFile(f.text, f.rel, root); } catch { return { symbols: [], edges: [], imports: [] }; } })();
    const lines = f.text.split('\n');
    const lang = langOf(f.rel);
    // build the cards first (the embedder may be async), then write everything in one transaction
    const cards = [];
    const byQ = new Map();
    for (const s of parsed.symbols) {
      const calls = parsed.edges.filter((e) => e.from === s.qname && e.kind === 'call').map((e) => e.to);
      const body = firstLines(f.text, s.line + 1, Math.min(s.endLine, s.line + 14));
      const card = redact(symbolCard(s, calls, f.rel, body));
      cards.push({ s, card });
    }
    const fileCard = redact([
      `file ${f.rel} (${lang}, ${lines.length} lines)`, firstLines(f.text, 1, 12, 400),
      parsed.imports.length ? `imports: ${[...new Set(parsed.imports.map((i) => i.spec))].slice(0, 20).join(', ')}` : '',
      parsed.symbols.length ? `defines: ${parsed.symbols.filter((s) => s.exported || s.kind === 'class').map((s) => s.qname).slice(0, 30).join(', ')}` : '',
    ].filter(Boolean).join('\n'));
    const texts = [fileCard, ...cards.map((c) => c.card)];
    const vecs = await embedder.embed(texts);

    tx(db, () => {
      removeFile(db, f.rel);
      db.prepare('INSERT INTO files(path, hash, size, mtime, lang, lines, indexed_at) VALUES (?,?,?,?,?,?,?)').run(f.rel, f.hash, f.st.size, f.st.mtimeMs, lang, lines.length, Date.now());
      const insSym = db.prepare('INSERT INTO symbols(file, name, qname, kind, line, end_line, signature, params, doc, exported, bhash) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      const insChunk = db.prepare('INSERT INTO chunks(file, symbol_id, kind, title, text, line, end_line, vec) VALUES (?,?,?,?,?,?,?,?)');
      const insFts = db.prepare('INSERT INTO chunks_fts(rowid, title, text) VALUES (?,?,?)');
      const addChunk = (symId, kind, title, text, line, endLine, vec) => {
        const r = insChunk.run(f.rel, symId, kind, title, text, line, endLine, vecToBlob(vec));
        insFts.run(r.lastInsertRowid, title, text);
      };
      addChunk(null, 'file', f.rel, fileCard, 1, lines.length, vecs[0]);
      cards.forEach(({ s, card }, i) => {
        const bhash = sha1(lines.slice(s.line - 1, s.endLine).join('\n'));
        const r = insSym.run(f.rel, s.name, s.qname, s.kind, s.line, s.endLine, redact(s.signature ?? ''), JSON.stringify(s.params ?? []), redact(s.doc ?? ''), s.exported ? 1 : 0, bhash);
        byQ.set(s.qname, Number(r.lastInsertRowid));
        addChunk(Number(r.lastInsertRowid), s.kind, s.qname, card, s.line, s.endLine, vecs[i + 1]);
      });
      const insEdge = db.prepare('INSERT INTO edges(from_id, from_file, to_name, kind, line, args, recv) VALUES (?,?,?,?,?,?,?)');
      for (const e of parsed.edges) { insEdge.run(e.from ? byQ.get(e.from) ?? null : null, f.rel, e.to, e.kind, e.line ?? 0, redact(e.args ?? ''), e.recv ?? 'plain'); stats.edges++; }
      const insImp = db.prepare('INSERT INTO imports(file, spec, names, resolved) VALUES (?,?,?,?)');
      for (const im of parsed.imports) insImp.run(f.rel, im.spec, im.names ?? '', null);
    });
    stats.changed++;
    stats.symbols += parsed.symbols.length;
  }
  if (stats.changed || stats.removed || force) { resolveImports(db); resolveEdges(db); setMeta(db, 'index_version', Date.now()); }
  setMeta(db, 'embedder', embedder.id);
  setMeta(db, 'last_index', JSON.stringify({ at: Date.now(), ...stats }));
  return stats;
}

export function removeFile(db, rel) {
  const ids = db.prepare('SELECT id FROM chunks WHERE file = ?').all(rel);
  const del = db.prepare('DELETE FROM chunks_fts WHERE rowid = ?');
  for (const r of ids) del.run(r.id);
  db.prepare('DELETE FROM chunks WHERE file = ?').run(rel);
  db.prepare('DELETE FROM edges WHERE from_file = ?').run(rel);
  db.prepare('DELETE FROM symbols WHERE file = ?').run(rel);
  db.prepare('DELETE FROM imports WHERE file = ?').run(rel);
  db.prepare('DELETE FROM files WHERE path = ?').run(rel);
}

// Methods that nearly every object has: a call to one of these on an unknown receiver is not matched to a project symbol.
const BUILTIN_METHODS = new Set('test ok equal exec match matchAll replace replaceAll split join slice splice push pop shift unshift map filter find findIndex forEach some every reduce includes indexOf startsWith endsWith trim keys values entries get set has add delete clear then catch finally toString toFixed toLowerCase toUpperCase from of call apply bind next emit on off once close open read write send end log warn error info debug now parse stringify assign freeze size length append insert remove count copy duplicate free queue_free connect disconnect play stop start pause reset update draw'.split(' '));

const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.py', '.gd', '/index.ts', '/index.tsx', '/index.js', '/index.mjs', '/__init__.py'];

/** relative/alias import specifiers to a project file (or null for packages). */
export function resolveImports(db) {
  const files = new Set(db.prepare('SELECT path FROM files').all().map((r) => r.path));
  const classFile = new Map();
  for (const r of db.prepare("SELECT file, spec FROM imports WHERE spec LIKE 'class:%'").all()) classFile.set(r.spec.slice(6), r.file);
  const upd = db.prepare('UPDATE imports SET resolved = ? WHERE file = ? AND spec = ?');
  for (const im of db.prepare('SELECT file, spec FROM imports').all()) {
    let target = null;
    const dir = posix.dirname(im.file);
    const cands = [];
    if (im.spec.startsWith('.')) cands.push(posix.normalize(posix.join(dir, im.spec)));
    else if (im.spec.startsWith('@/')) cands.push(`src/${im.spec.slice(2)}`);
    else if (im.spec.startsWith('res://')) cands.push(im.spec.slice(6));
    else if (/^[\w.]+$/.test(im.spec) && im.file.endsWith('.py')) cands.push(im.spec.replace(/\./g, '/'), posix.join(dir, im.spec.replace(/\./g, '/')));
    else if (classFile.has(im.spec)) target = classFile.get(im.spec);
    for (const c of cands) {
      for (const x of EXTS) if (!target && files.has(c + x)) target = c + x;
      if (!target && c.endsWith('.js')) for (const x of ['.ts', '.tsx']) if (files.has(c.slice(0, -3) + x)) target = c.slice(0, -3) + x;
    }
    if (target) upd.run(target, im.file, im.spec);
  }
}

/** Point each call at the symbol it means: unique name, else the one in the same file, else the one in a file this file imports. */
export function resolveEdges(db) {
  db.exec('UPDATE edges SET to_id = NULL, ambiguous = 0');
  const byName = new Map();
  for (const s of db.prepare('SELECT id, name, qname, file, kind FROM symbols').all()) {
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(s);
  }
  const importsOf = new Map();
  for (const r of db.prepare('SELECT file, resolved FROM imports WHERE resolved IS NOT NULL').all()) {
    if (!importsOf.has(r.file)) importsOf.set(r.file, new Set());
    importsOf.get(r.file).add(r.resolved);
  }
  const upd = db.prepare('UPDATE edges SET to_id = ?, ambiguous = ? WHERE id = ?');
  tx(db, () => {
    for (const e of db.prepare('SELECT id, from_file, to_name, kind, recv FROM edges').all()) {
      let c = byName.get(e.to_name);
      if (!c) continue;
      if (e.recv === 'member') {
        // obj.name(): the receiver's type is unknown, so only methods can be meant, and never a name every object has (test, push, get ...)
        if (BUILTIN_METHODS.has(e.to_name) && !byName.get(e.to_name).some((s) => s.file === e.from_file)) continue;
        c = c.filter((s) => s.kind === 'method' || s.file.endsWith('.gd') || s.file.endsWith('.py') && false);
        if (!c.length) continue;
      } else if (e.recv === 'self') {
        const own = c.filter((s) => s.file === e.from_file);
        if (own.length) c = own;
      }
      let pick = null;
      let amb = 0;
      if (c.length === 1) pick = c[0];
      else {
        const sameFile = c.filter((s) => s.file === e.from_file);
        const imp = importsOf.get(e.from_file) ?? new Set();
        const viaImport = c.filter((s) => imp.has(s.file));
        if (sameFile.length === 1) pick = sameFile[0];
        else if (viaImport.length === 1) pick = viaImport[0];
        else amb = c.length;
      }
      if (pick) upd.run(pick.id, 0, e.id);
      else if (amb) upd.run(null, amb, e.id);
    }
  });
}
