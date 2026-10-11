// The one SQLite file that holds the map, the facts and the history. Node's own sqlite (node:sqlite): no packages, no native build.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, hash TEXT, size INTEGER, mtime REAL, lang TEXT, lines INTEGER, indexed_at INTEGER);
CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY, file TEXT NOT NULL, name TEXT NOT NULL, qname TEXT NOT NULL, kind TEXT NOT NULL,
  line INTEGER, end_line INTEGER, signature TEXT, params TEXT, doc TEXT, exported INTEGER DEFAULT 0, bhash TEXT);
CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS symbols_file ON symbols(file);
CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY, from_id INTEGER, from_file TEXT NOT NULL, to_name TEXT NOT NULL, to_id INTEGER, kind TEXT NOT NULL,
  line INTEGER, args TEXT, ambiguous INTEGER DEFAULT 0, recv TEXT);
CREATE INDEX IF NOT EXISTS edges_to ON edges(to_name);
CREATE INDEX IF NOT EXISTS edges_toid ON edges(to_id);
CREATE INDEX IF NOT EXISTS edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS edges_file ON edges(from_file);
CREATE TABLE IF NOT EXISTS imports (file TEXT NOT NULL, spec TEXT NOT NULL, names TEXT, resolved TEXT);
CREATE INDEX IF NOT EXISTS imports_file ON imports(file);
CREATE INDEX IF NOT EXISTS imports_resolved ON imports(resolved);
CREATE TABLE IF NOT EXISTS chunks (id INTEGER PRIMARY KEY, file TEXT NOT NULL, symbol_id INTEGER, kind TEXT, title TEXT, text TEXT, line INTEGER, end_line INTEGER, vec BLOB);
CREATE INDEX IF NOT EXISTS chunks_file ON chunks(file);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(title, text, tokenize = 'porter unicode61');
CREATE TABLE IF NOT EXISTS facts (id INTEGER PRIMARY KEY, text TEXT NOT NULL, tags TEXT, status TEXT NOT NULL, created INTEGER, verified_at INTEGER, uses INTEGER DEFAULT 0, vec BLOB, superseded_by INTEGER);
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(text, tags, tokenize = 'porter unicode61');
CREATE TABLE IF NOT EXISTS fact_evidence (id INTEGER PRIMARY KEY, fact_id INTEGER NOT NULL, file TEXT NOT NULL, start_line INTEGER, end_line INTEGER, snippet TEXT, hash TEXT);
CREATE INDEX IF NOT EXISTS evidence_fact ON fact_evidence(fact_id);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, ref TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(text, kind, tokenize = 'porter unicode61');
CREATE TABLE IF NOT EXISTS checkpoints (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, note TEXT, ts INTEGER NOT NULL, files INTEGER, symbols INTEGER, summary TEXT);
CREATE TABLE IF NOT EXISTS checkpoint_files (checkpoint_id INTEGER NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (checkpoint_id, path));
CREATE TABLE IF NOT EXISTS checkpoint_symbols (checkpoint_id INTEGER NOT NULL, qname TEXT NOT NULL, file TEXT, kind TEXT, signature TEXT, bhash TEXT);
CREATE INDEX IF NOT EXISTS cps ON checkpoint_symbols(checkpoint_id, qname);
`;

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'chomu.db'));
  db.exec(SCHEMA);
  // older archives: add what a later version needs (never drops anything)
  const cols = db.prepare('PRAGMA table_info(edges)').all().map((c) => c.name);
  if (!cols.includes('recv')) db.exec('ALTER TABLE edges ADD COLUMN recv TEXT');
  return db;
}

export const tx = (db, fn) => {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};
export const getMeta = (db, k) => db.prepare('SELECT value FROM meta WHERE key = ?').get(k)?.value;
export const setMeta = (db, k, v) => db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
