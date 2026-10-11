// Hybrid search: keyword ranking (SQLite FTS5 / BM25) and meaning ranking (vector cosine), merged by reciprocal rank fusion.
import { tokenize, cosine, blobToVec } from './embed.mjs';
import { getMeta } from './db.mjs';

const caches = new WeakMap();

/** All vectors of one table in memory (rebuilt only when the index version changes). */
function matrix(db, table, versionKey) {
  const version = `${getMeta(db, versionKey) ?? '0'}`;
  let c = caches.get(db)?.[table];
  if (c && c.version === version) return c;
  const rows = db.prepare(`SELECT id, vec FROM ${table} WHERE vec IS NOT NULL`).all();
  c = { version, ids: rows.map((r) => r.id), vecs: rows.map((r) => blobToVec(r.vec)) };
  if (!caches.has(db)) caches.set(db, {});
  caches.get(db)[table] = c;
  return c;
}
export const invalidate = (db) => caches.delete(db);

export function ftsQuery(text) {
  const raw = [...new Set((text.match(/[A-Za-z][A-Za-z0-9]+/g) ?? []).flatMap((w) => [w, ...w.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ')]).map((w) => w.toLowerCase()))].filter((w) => w.length > 1);
  const toks = raw.length ? raw : tokenize(text);
  return toks.slice(0, 14).map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
}

export function rrf(...lists) {
  const score = new Map();
  lists.forEach((list) => list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (60 + rank))));
  return [...score.entries()].sort((a, b) => b[1] - a[1]);
}

export async function searchChunks(ctx, query, { limit = 8, kind, path } = {}) {
  const { db, embedder } = ctx;
  const q = ftsQuery(query);
  const lex = q ? db.prepare('SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts, 4.0, 1.0) LIMIT 60').all(q).map((r) => r.id) : [];
  const [qv] = await embedder.embed([query]);
  const m = matrix(db, 'chunks', 'index_version');
  const scored = [];
  for (let i = 0; i < m.ids.length; i++) scored.push([m.ids[i], cosine(qv, m.vecs[i])]);
  scored.sort((a, b) => b[1] - a[1]);
  const sem = scored.slice(0, 60).filter((s) => s[1] > 0.05);
  const semRank = new Map(sem.map(([id], i) => [id, i + 1]));
  const lexRank = new Map(lex.map((id, i) => [id, i + 1]));
  const fused = rrf(lex, sem.map(([id]) => id));
  const get = db.prepare('SELECT id, file, symbol_id, kind, title, text, line, end_line FROM chunks WHERE id = ?');
  const hits = [];
  for (const [id, score] of fused) {
    const c = get.get(id);
    if (!c) continue;
    if (kind && c.kind !== kind) continue;
    if (path && !c.file.startsWith(path)) continue;
    hits.push({ ...c, score, lexRank: lexRank.get(id) ?? null, semRank: semRank.get(id) ?? null, sim: scored.find((s) => s[0] === id)?.[1] ?? 0 });
    if (hits.length >= limit) break;
  }
  return hits;
}

export async function searchTable(ctx, table, ftsTable, versionKey, query, limit = 20) {
  const { db, embedder } = ctx;
  const q = ftsQuery(query);
  const lex = q ? db.prepare(`SELECT rowid AS id FROM ${ftsTable} WHERE ${ftsTable} MATCH ? ORDER BY bm25(${ftsTable}) LIMIT 40`).all(q).map((r) => r.id) : [];
  let sem = [];
  if (table) {
    const [qv] = await embedder.embed([query]);
    const rows = db.prepare(`SELECT id, vec FROM ${table} WHERE vec IS NOT NULL`).all();
    sem = rows.map((r) => [r.id, cosine(qv, blobToVec(r.vec))]).sort((a, b) => b[1] - a[1]).slice(0, 40).filter((s) => s[1] > 0.05).map((s) => s[0]);
  }
  return rrf(lex, sem).slice(0, limit).map(([id, score]) => ({ id, score }));
}
