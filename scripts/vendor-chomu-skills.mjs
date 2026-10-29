#!/usr/bin/env node
/**
 * Adds Chomugiri's own hand-written skills (skills-src/chomu/*.md) to public/skills: the free no-key tools (search, crawl, scrape,
 * video, speech, browser), screenshot-to-code, skill hunting, Open Design control, lessons and mobile-first delivery.
 *   node scripts/vendor-chomu-skills.mjs
 * Run it again after scripts/vendor-skill-library.mjs (which rebuilds public/skills from the three upstream collections).
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const src = 'skills-src/chomu';
const out = 'public/skills';
const indexPath = path.join(out, 'index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
mkdirSync(path.join(out, 'files'), { recursive: true });
const STOP = new Set('the and for with from that this your you are use used using when then than into over also not but can will have has any all one two out its our their his her they them what which while where such each more most only some very just like make made need want work works'.split(' '));
index.skills = index.skills.filter((s) => s.source !== 'chomu');
for (const f of readdirSync(src).filter((n) => n.endsWith('.md')).sort()) {
  const raw = readFileSync(path.join(src, f), 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${f}: no front matter`);
  const get = (k) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(m[1])?.[1].trim();
  const id = get('name');
  const description = get('description');
  if (!id || !description) throw new Error(`${f}: name and description are required`);
  const body = m[2].trim();
  writeFileSync(path.join(out, 'files', `${id}.md`), body);
  const words = `${id.replace(/-/g, ' ')} ${description}`.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [];
  const kw = [...new Set(words.map((w) => w.replace(/[.-]+$/, '')).filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 40);
  const entry = { id, source: 'chomu', description, kw, bytes: Buffer.byteLength(body), category: get('category') ?? 'chomugiri' };
  if (get('process') === 'true') entry.process = true;
  index.skills = index.skills.filter((s) => s.id !== id);
  index.skills.push(entry);
}
index.sources.chomu = { repo: 'https://github.com/thanoxxinfnity/champu (skills-src/chomu)', commit: 'local', license: 'MIT (written for Chomugiri; tools they describe keep their own licences)' };
writeFileSync(indexPath, JSON.stringify(index));
console.log('chomu skills:', index.skills.filter((s) => s.source === 'chomu').length, 'total:', index.skills.length);
