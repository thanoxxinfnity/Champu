// Verified facts. A fact is a short statement plus the exact place in the code that proves it. It is only ever handed back after
// that place has been looked at again: if the code moved, the fact follows it; if the code changed, the fact is marked stale and is NOT injected.
import { readFileSync } from 'node:fs';
import { safeJoin, redact } from './privacy.mjs';
import { sha1 } from './indexer.mjs';
import { vecToBlob } from './embed.mjs';
import { searchTable } from './search.mjs';
import { tx } from './db.mjs';

const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** Look at one piece of evidence now. Returns { ok, reason?, start, end, snippet, hash }. */
export function checkEvidence(root, ev) {
  let text;
  try { text = readFileSync(safeJoin(root, ev.file), 'utf8'); } catch { return { ok: false, reason: `file not found: ${ev.file}` }; }
  const lines = text.split('\n');
  const wanted = ev.snippet ? norm(ev.snippet) : null;
  if (!wanted) {
    const s = Math.max(1, ev.start_line ?? 1);
    const e = Math.min(lines.length, ev.end_line ?? s);
    if (s > lines.length) return { ok: false, reason: `${ev.file} has only ${lines.length} lines` };
    const snippet = lines.slice(s - 1, e).join('\n');
    return { ok: true, start: s, end: e, snippet: redact(snippet).slice(0, 600), hash: sha1(norm(snippet)) };
  }
  // look near where it used to be first, then anywhere in the file (the code may simply have moved)
  const windowFor = (from, to) => norm(lines.slice(Math.max(0, from - 1), to).join('\n'));
  const near = ev.start_line ? windowFor(ev.start_line - 25, (ev.end_line ?? ev.start_line) + 25) : null;
  if (near === null || !near.includes(wanted)) {
    if (!norm(text).includes(wanted)) return { ok: false, reason: `the code ${ev.file} no longer contains that text` };
  }
  const first = norm(ev.snippet.split('\n').find((l) => l.trim()) ?? ev.snippet);
  const idx = lines.findIndex((l) => norm(l).includes(first.slice(0, 80)));
  const start = idx >= 0 ? idx + 1 : ev.start_line ?? 1;
  const span = Math.max(0, ev.snippet.split('\n').length - 1);
  return { ok: true, start, end: Math.min(lines.length, start + span), snippet: redact(ev.snippet).slice(0, 600), hash: sha1(wanted), moved: ev.start_line && ev.start_line !== start };
}

export async function remember(ctx, { text, evidence = [], tags = [] }) {
  const { db, root, embedder } = ctx;
  if (!text || !text.trim()) throw new Error('a fact needs text');
  if (!evidence.length) throw new Error('a fact needs evidence: at least one { file, start_line, end_line } or { file, snippet } that proves it. (Memory is only evidence, never an opinion.)');
  const checked = evidence.map((ev) => ({ ev, r: checkEvidence(root, ev) }));
  const bad = checked.filter((c) => !c.r.ok);
  if (bad.length) throw new Error(`could not verify the evidence: ${bad.map((b) => `${b.ev.file} (${b.r.reason})`).join('; ')}`);
  const clean = redact(text.trim()).slice(0, 600);
  const [vec] = await embedder.embed([`${clean} ${tags.join(' ')}`]);
  return tx(db, () => {
    const dup = db.prepare("SELECT id FROM facts WHERE text = ? AND status != 'superseded'").get(clean);
    if (dup) return { id: Number(dup.id), duplicate: true };
    const r = db.prepare('INSERT INTO facts(text, tags, status, created, verified_at, vec) VALUES (?,?,?,?,?,?)').run(clean, tags.join(','), 'verified', Date.now(), Date.now(), vecToBlob(vec));
    const id = Number(r.lastInsertRowid);
    db.prepare('INSERT INTO facts_fts(rowid, text, tags) VALUES (?,?,?)').run(id, clean, tags.join(' '));
    const ins = db.prepare('INSERT INTO fact_evidence(fact_id, file, start_line, end_line, snippet, hash) VALUES (?,?,?,?,?,?)');
    for (const { ev, r: c } of checked) ins.run(id, ev.file, c.start, c.end, c.snippet, c.hash);
    return { id, duplicate: false };
  });
}

/** Re-check one fact against the files as they are now. */
export function verifyFact(ctx, id) {
  const { db, root } = ctx;
  const fact = db.prepare('SELECT * FROM facts WHERE id = ?').get(id);
  if (!fact) return null;
  const evs = db.prepare('SELECT * FROM fact_evidence WHERE fact_id = ?').all(id);
  let allOk = true;
  const problems = [];
  for (const ev of evs) {
    const r = checkEvidence(root, { file: ev.file, start_line: ev.start_line, end_line: ev.end_line, snippet: ev.snippet });
    if (r.ok) db.prepare('UPDATE fact_evidence SET start_line = ?, end_line = ? WHERE id = ?').run(r.start, r.end, ev.id);
    else { allOk = false; problems.push(`${ev.file}: ${r.reason}`); }
  }
  const status = allOk ? 'verified' : 'stale';
  db.prepare('UPDATE facts SET status = ?, verified_at = ? WHERE id = ?').run(status, Date.now(), id);
  return { id, status, problems };
}

export function verifyAll(ctx) {
  const ids = ctx.db.prepare("SELECT id FROM facts WHERE status != 'superseded'").all().map((r) => r.id);
  const res = ids.map((id) => verifyFact(ctx, id));
  return { checked: res.length, verified: res.filter((r) => r.status === 'verified').length, stale: res.filter((r) => r.status === 'stale') };
}

const ago = (ts) => { const s = Math.max(0, (Date.now() - ts) / 1000); return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };

/**
 * The facts worth putting in front of the model right now: the best matches for the query, each re-verified before it is returned,
 * stopping at a character budget. Stale facts are never returned (their number is, so the model knows there is something to refresh).
 */
export async function recall(ctx, query, { budget = 2200, limit = 10 } = {}) {
  const { db } = ctx;
  const hits = await searchTable(ctx, 'facts', 'facts_fts', null, query, limit * 3);
  const out = [];
  let used = 0, stale = 0;
  for (const h of hits) {
    const f = db.prepare("SELECT * FROM facts WHERE id = ? AND status != 'superseded'").get(h.id);
    if (!f) continue;
    const v = verifyFact(ctx, f.id);
    if (v.status !== 'verified') { stale++; continue; }
    const evs = db.prepare('SELECT file, start_line, end_line, snippet FROM fact_evidence WHERE fact_id = ?').all(f.id);
    const line = `#${f.id} [verified ${ago(Date.now())}] ${f.text}\n` + evs.map((e) => `    evidence: ${e.file}:${e.start_line}${e.end_line && e.end_line !== e.start_line ? `-${e.end_line}` : ''}  ${norm(e.snippet).slice(0, 110)}`).join('\n');
    if (used + line.length > budget && out.length) break;
    out.push({ id: f.id, text: f.text, tags: f.tags, evidence: evs, line });
    used += line.length;
    db.prepare('UPDATE facts SET uses = uses + 1 WHERE id = ?').run(f.id);
    if (out.length >= limit) break;
  }
  return { facts: out, stale, chars: used };
}

export function forget(ctx, id, supersededBy = null) {
  const { db } = ctx;
  tx(db, () => {
    db.prepare("UPDATE facts SET status = 'superseded', superseded_by = ? WHERE id = ?").run(supersededBy, id);
    db.prepare('DELETE FROM facts_fts WHERE rowid = ?').run(id);
  });
}

export function listFacts(db, { status } = {}) {
  return db.prepare(`SELECT id, text, tags, status, verified_at, uses FROM facts ${status ? 'WHERE status = ?' : "WHERE status != 'superseded'"} ORDER BY id DESC LIMIT 200`).all(...(status ? [status] : []));
}
