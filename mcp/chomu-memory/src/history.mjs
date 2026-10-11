// Checkpoints (snapshots of code and logic), the event log, and the search over all of it. Everything is files and one SQLite database
// under the project's .chomu-memory folder. File contents are stored zlib-compressed and content-addressed, with secrets blanked first.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, cpSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { redact, safeJoin } from './privacy.mjs';
import { tx } from './db.mjs';
import { ftsQuery } from './search.mjs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function putBlob(dataDir, text) {
  const h = sha256(text);
  const p = join(dataDir, 'blobs', h.slice(0, 2), h.slice(2));
  if (!existsSync(p)) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, deflateSync(Buffer.from(text, 'utf8'), { level: 6 })); }
  return h;
}
export function getBlob(dataDir, h) {
  const p = join(dataDir, 'blobs', h.slice(0, 2), h.slice(2));
  return existsSync(p) ? inflateSync(readFileSync(p)).toString('utf8') : null;
}

export function logEvent(db, kind, text, ref = null) {
  const t = redact(String(text)).slice(0, 4000);
  const r = db.prepare('INSERT INTO events(ts, kind, text, ref) VALUES (?,?,?,?)').run(Date.now(), kind, t, ref);
  db.prepare('INSERT INTO events_fts(rowid, text, kind) VALUES (?,?,?)').run(r.lastInsertRowid, t, kind);
  return Number(r.lastInsertRowid);
}

function liveManifest(ctx) {
  const { db, root, dataDir } = ctx;
  const files = [];
  for (const f of db.prepare('SELECT path FROM files ORDER BY path').all()) {
    let text;
    try { text = readFileSync(safeJoin(root, f.path), 'utf8'); } catch { continue; }
    files.push({ path: f.path, hash: putBlob(dataDir, redact(text)) });
  }
  const symbols = db.prepare('SELECT qname, file, kind, signature, bhash FROM symbols').all();
  return { files, symbols };
}

export function checkpointCreate(ctx, { name, note = '' }) {
  const { db } = ctx;
  if (!name || !/^[\w.\- ]{1,60}$/.test(name)) throw new Error('name: 1-60 letters, digits, space, dot, dash or underscore');
  if (db.prepare('SELECT 1 FROM checkpoints WHERE name = ?').get(name)) throw new Error(`a checkpoint called "${name}" already exists`);
  const prev = db.prepare('SELECT id, name FROM checkpoints ORDER BY id DESC LIMIT 1').get();
  const m = liveManifest(ctx);
  const id = tx(db, () => {
    const r = db.prepare('INSERT INTO checkpoints(name, note, ts, files, symbols, summary) VALUES (?,?,?,?,?,?)').run(name, redact(note), Date.now(), m.files.length, m.symbols.length, '');
    const cid = Number(r.lastInsertRowid);
    const f = db.prepare('INSERT INTO checkpoint_files(checkpoint_id, path, hash) VALUES (?,?,?)');
    for (const x of m.files) f.run(cid, x.path, x.hash);
    const s = db.prepare('INSERT INTO checkpoint_symbols(checkpoint_id, qname, file, kind, signature, bhash) VALUES (?,?,?,?,?,?)');
    for (const x of m.symbols) s.run(cid, x.qname, x.file, x.kind, x.signature, x.bhash);
    return cid;
  });
  let summary = `${m.files.length} files, ${m.symbols.length} symbols.`;
  if (prev) {
    const d = checkpointDiff(ctx, prev.name, name);
    summary += ` Since "${prev.name}": +${d.files.added.length}/-${d.files.removed.length}/~${d.files.modified.length} files; symbols +${d.symbols.added.length}/-${d.symbols.removed.length}/~${d.symbols.changed.length}.`;
    if (d.symbols.added.length) summary += ` New: ${d.symbols.added.slice(0, 8).map((s) => s.qname).join(', ')}.`;
    if (d.symbols.removed.length) summary += ` Gone: ${d.symbols.removed.slice(0, 8).map((s) => s.qname).join(', ')}.`;
  }
  db.prepare('UPDATE checkpoints SET summary = ? WHERE id = ?').run(summary, id);
  logEvent(db, 'checkpoint', `checkpoint "${name}": ${note || summary}`, name);
  return { id, name, summary };
}

export const listCheckpoints = (db) => db.prepare('SELECT id, name, note, ts, files, symbols, summary FROM checkpoints ORDER BY id DESC LIMIT 100').all();

function manifestOf(ctx, ref) {
  const { db } = ctx;
  if (ref === 'current' || ref === 'live') { const m = liveManifest(ctx); return { files: new Map(m.files.map((f) => [f.path, f.hash])), symbols: new Map(m.symbols.map((s) => [s.qname + '@' + s.file, s])) }; }
  const cp = db.prepare('SELECT id FROM checkpoints WHERE name = ? OR id = ?').get(ref, /^\d+$/.test(String(ref)) ? Number(ref) : -1);
  if (!cp) throw new Error(`no checkpoint "${ref}"`);
  const files = new Map(db.prepare('SELECT path, hash FROM checkpoint_files WHERE checkpoint_id = ?').all(cp.id).map((r) => [r.path, r.hash]));
  const symbols = new Map(db.prepare('SELECT qname, file, kind, signature, bhash FROM checkpoint_symbols WHERE checkpoint_id = ?').all(cp.id).map((s) => [s.qname + '@' + s.file, s]));
  return { files, symbols };
}

export function checkpointDiff(ctx, a, b = 'current') {
  const A = manifestOf(ctx, a), B = manifestOf(ctx, b);
  const files = { added: [], removed: [], modified: [] };
  for (const [p, h] of B.files) { if (!A.files.has(p)) files.added.push(p); else if (A.files.get(p) !== h) files.modified.push(p); }
  for (const p of A.files.keys()) if (!B.files.has(p)) files.removed.push(p);
  const symbols = { added: [], removed: [], changed: [] };
  for (const [k, s] of B.symbols) { const o = A.symbols.get(k); if (!o) symbols.added.push(s); else if (o.bhash !== s.bhash) symbols.changed.push({ ...s, signatureChanged: o.signature !== s.signature }); }
  for (const [k, s] of A.symbols) if (!B.symbols.has(k)) symbols.removed.push(s);
  return { a, b, files, symbols };
}

export function checkpointFile(ctx, ref, path) {
  const { db, dataDir } = ctx;
  const cp = db.prepare('SELECT id FROM checkpoints WHERE name = ? OR id = ?').get(ref, /^\d+$/.test(String(ref)) ? Number(ref) : -1);
  if (!cp) throw new Error(`no checkpoint "${ref}"`);
  const row = db.prepare('SELECT hash FROM checkpoint_files WHERE checkpoint_id = ? AND path = ?').get(cp.id, path);
  if (!row) throw new Error(`${path} was not in checkpoint "${ref}"`);
  return getBlob(dataDir, row.hash);
}

/** A small line diff (longest common subsequence), enough to show what changed between a checkpoint and now. */
export function lineDiff(oldText, newText, context = 2, maxLines = 120) {
  const a = oldText.split('\n'), b = newText.split('\n');
  if (a.length * b.length > 4_000_000) return `(too large to diff line by line: ${a.length} -> ${b.length} lines)`;
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push([' ', a[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['-', a[i++]]); else ops.push(['+', b[j++]]);
  }
  while (i < a.length) ops.push(['-', a[i++]]);
  while (j < b.length) ops.push(['+', b[j++]]);
  const keep = new Set();
  ops.forEach(([t], k) => { if (t !== ' ') for (let x = Math.max(0, k - context); x <= Math.min(ops.length - 1, k + context); x++) keep.add(x); });
  const out = [];
  let last = -2;
  ops.forEach(([t, l], k) => { if (!keep.has(k)) return; if (k !== last + 1) out.push('@@'); out.push(`${t}${l}`); last = k; });
  return out.slice(0, maxLines).join('\n') + (out.length > maxLines ? `\n… ${out.length - maxLines} more lines` : '');
}

export function historySearch(ctx, query, limit = 15) {
  const { db } = ctx;
  const q = ftsQuery(query);
  const out = [];
  if (q) {
    for (const r of db.prepare('SELECT e.id, e.ts, e.kind, e.text, e.ref FROM events_fts f JOIN events e ON e.id = f.rowid WHERE events_fts MATCH ? ORDER BY bm25(events_fts) LIMIT ?').all(q, limit)) out.push({ ts: r.ts, kind: r.kind, text: r.text.slice(0, 400), ref: r.ref });
  }
  const like = `%${query.replace(/[%_]/g, '')}%`;
  for (const c of db.prepare('SELECT name, note, ts, summary FROM checkpoints WHERE name LIKE ? OR note LIKE ? OR summary LIKE ? ORDER BY id DESC LIMIT 8').all(like, like, like)) out.push({ ts: c.ts, kind: 'checkpoint', text: `${c.name}: ${c.note || c.summary}`.slice(0, 400), ref: c.name });
  // "when did this function exist": identifier-like queries are looked up in every checkpoint's symbol table
  if (/^[\w.]+$/.test(query.trim())) {
    const rows = db.prepare('SELECT c.name, c.ts, s.file, s.signature FROM checkpoint_symbols s JOIN checkpoints c ON c.id = s.checkpoint_id WHERE s.qname = ? OR s.qname LIKE ? ORDER BY c.id').all(query.trim(), `%.${query.trim()}`);
    if (rows.length) out.push({ ts: rows[0].ts, kind: 'symbol-history', text: `"${query}" exists in ${rows.length} checkpoint(s), first in "${rows[0].name}" (${rows[0].file}); latest signature: ${rows[rows.length - 1].signature}`.slice(0, 400), ref: rows[0].name });
  }
  return out.sort((x, y) => y.ts - x.ts).slice(0, limit);
}

export function saveCompaction(ctx, { summary, decisions = [], open_questions = [], files_touched = [], next_steps = [], checkpoint }) {
  const body = JSON.stringify({ summary, decisions, open_questions, files_touched, next_steps });
  const id = logEvent(ctx.db, 'compaction', body);
  let cp = null;
  if (checkpoint) cp = checkpointCreate(ctx, { name: checkpoint, note: summary.slice(0, 200) });
  return { id, checkpoint: cp };
}

export function lastCompactions(db, n = 2) {
  return db.prepare("SELECT id, ts, text FROM events WHERE kind = 'compaction' ORDER BY id DESC LIMIT ?").all(n).map((r) => ({ id: r.id, ts: r.ts, ...JSON.parse(r.text) }));
}

export function archiveInfo(dataDir) {
  let files = 0, bytes = 0, blobs = 0;
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else { files++; bytes += statSync(p).size; if (p.includes('/blobs/')) blobs++; } } };
  if (existsSync(dataDir)) walk(dataDir);
  return { dataDir, files, bytes, blobs };
}
export function archiveExport(dataDir, dest) { cpSync(dataDir, dest, { recursive: true }); return archiveInfo(dest); }
export function archiveWipe(dataDir) {
  if (!existsSync(join(dataDir, 'chomu.db')) || basename(dataDir) === '' || dataDir === '/') throw new Error('refusing: not a chomu-memory folder');
  rmSync(dataDir, { recursive: true, force: true });
}
