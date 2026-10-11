import { resolve, join } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { openDb } from './db.mjs';
import { makeEmbedder } from './embed.mjs';

/** Open (or create) the archive for a project: <root>/.chomu-memory by default. */
export function makeContext({ root, data, embed } = {}) {
  const r = resolve(root || process.cwd());
  const dataDir = resolve(data || join(r, '.chomu-memory'));
  mkdirSync(dataDir, { recursive: true });
  // the archive must never end up in git or in an upload by accident
  try { writeFileSync(join(dataDir, '.gitignore'), '*\n'); } catch { /* read-only */ }
  const gi = join(r, '.gitignore');
  try { if (existsSync(gi) && !/^\.chomu-memory\/?$/m.test(readFileSync(gi, 'utf8')) && dataDir === join(r, '.chomu-memory')) appendFileSync(gi, '\n.chomu-memory/\n'); } catch { /* fine */ }
  return { root: r, dataDir, db: openDb(dataDir), embedder: makeEmbedder(embed), lastRefresh: 0 };
}
