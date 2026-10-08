#!/usr/bin/env node
/**
 * Copies the knowledge from https://github.com/nexu-io/open-design (Apache-2.0) into public/od/ so the app can hand the
 * relevant parts to the model at run time:
 *   git clone --depth 1 https://github.com/nexu-io/open-design.git /tmp/open-design
 *   node scripts/vendor-open-design.mjs /tmp/open-design
 *
 * What is taken: the functional skills and design templates (their SKILL.md), the design systems (their DESIGN.md), the
 * craft rules, and the image/video prompt library. What is not: the OpenDesign app itself, plugins, images and other
 * binaries. Everything is plain text, loaded on demand (nothing here is bundled into the main script).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/vendor-open-design.mjs <path to a clone of open-design>'); process.exit(1); }
const out = 'public/od';
rmSync(out, { recursive: true, force: true });
for (const d of ['skills', 'templates', 'systems', 'craft', 'prompts']) mkdirSync(path.join(out, d), { recursive: true });

const commit = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD']).toString().trim();
const dirs = (p) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);

/** Front matter without a YAML library: just the handful of keys the app uses. */
function front(raw) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const fm = m[1];
  const text = (key) => {
    const block = new RegExp(`^${key}:\\s*[|>][-+]?\\n((?:[ \\t]+.*\\n?)+)`, 'm').exec(fm + '\n');
    if (block) return block[1].split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
    const line = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm);
    return line ? line[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  const triggers = [];
  const t = /^triggers:\s*\n((?:\s+-\s+.*\n?)+)/m.exec(fm + '\n');
  if (t) for (const l of t[1].split('\n')) { const v = /^\s+-\s+(.*)$/.exec(l)?.[1]; if (v) triggers.push(v.trim().replace(/^["']|["']$/g, '')); }
  const od = /^od:\s*\n((?:[ \t]+.*\n?)*)/m.exec(fm + '\n')?.[1] ?? '';
  const sub = (key) => new RegExp(`^\\s+${key}:\\s*(.+)$`, 'm').exec(od)?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
  const craft = /craft:\s*\n\s+requires:\s*\[([^\]]*)\]/.exec(od)?.[1].split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  return { meta: { name: text('name'), description: text('description'), triggers, mode: sub('mode'), category: sub('category'), platform: sub('platform'), scenario: sub('scenario'), craft }, body: m[2].trim() };
}

// Skills that only work with an outside service the user may not have; listed in the catalogue, never injected on their own.
const EXTERNAL = /^(fal-|figma-|agent-browser)/;

const skills = [];
for (const id of dirs(path.join(src, 'skills'))) {
  const f = path.join(src, 'skills', id, 'SKILL.md');
  if (!existsSync(f)) continue;
  const { meta, body } = front(readFileSync(f, 'utf8'));
  writeFileSync(path.join(out, 'skills', `${id}.md`), body);
  skills.push({ id, description: meta.description, triggers: meta.triggers, mode: meta.mode, category: meta.category, craft: meta.craft, external: EXTERNAL.test(id), bytes: body.length });
}

const templates = [];
for (const id of dirs(path.join(src, 'design-templates'))) {
  const f = path.join(src, 'design-templates', id, 'SKILL.md');
  if (!existsSync(f)) continue;
  const { meta, body } = front(readFileSync(f, 'utf8'));
  writeFileSync(path.join(out, 'templates', `${id}.md`), body);
  const ex = path.join(src, 'design-templates', id, 'example.html');
  const hasExample = existsSync(ex) && readFileSync(ex).length <= 60_000;
  if (hasExample) copyFileSync(ex, path.join(out, 'templates', `${id}.html`));
  templates.push({ id, description: meta.description, triggers: meta.triggers, mode: meta.mode, platform: meta.platform, scenario: meta.scenario, craft: meta.craft, example: hasExample, bytes: body.length });
}

const systems = [];
for (const id of dirs(path.join(src, 'design-systems'))) {
  if (id.startsWith('_')) continue;
  const f = path.join(src, 'design-systems', id, 'DESIGN.md');
  if (!existsSync(f)) continue;
  const body = readFileSync(f, 'utf8');
  copyFileSync(f, path.join(out, 'systems', `${id}.md`));
  const name = /^#\s+(?:Design System Inspired by\s+)?(.+)$/m.exec(body)?.[1].trim() ?? id;
  const category = /^>\s*Category:\s*(.+)$/m.exec(body)?.[1].trim() ?? '';
  const tagline = body.split('\n').filter((l) => l.startsWith('>') && !/Category:/.test(l)).map((l) => l.replace(/^>\s*/, '')).join(' ').trim().slice(0, 200);
  systems.push({ id, name, category, tagline, bytes: body.length });
}

const craft = [];
for (const f of readdirSync(path.join(src, 'craft')).filter((n) => n.endsWith('.md') && !['README.md', 'FUTURE_SECTIONS.md'].includes(n)).sort()) {
  const body = readFileSync(path.join(src, 'craft', f), 'utf8');
  const id = f.replace(/\.md$/, '');
  writeFileSync(path.join(out, 'craft', f), body);
  craft.push({ id, title: /^#\s+(.+)$/m.exec(body)?.[1].trim() ?? id, bytes: body.length });
}

const prompts = [];
for (const surface of ['image', 'video']) {
  const base = path.join(src, 'prompt-templates', surface);
  if (!existsSync(base)) continue;
  mkdirSync(path.join(out, 'prompts', surface), { recursive: true });
  for (const f of readdirSync(base).filter((n) => n.endsWith('.json')).sort()) {
    const j = JSON.parse(readFileSync(path.join(base, f), 'utf8'));
    delete j.previewImageUrl;
    writeFileSync(path.join(out, 'prompts', surface, f), JSON.stringify(j));
    prompts.push({ id: j.id ?? f.replace(/\.json$/, ''), surface, title: j.title, summary: j.summary, category: j.category, tags: j.tags ?? [], model: j.model, aspect: j.aspect, license: j.source?.license });
  }
}

const index = { source: { repo: 'https://github.com/nexu-io/open-design', commit, license: 'Apache-2.0' }, skills, templates, systems, craft, prompts };
writeFileSync(path.join(out, 'index.json'), JSON.stringify(index));
writeFileSync(path.join(out, 'NOTICE.md'), `# Open Design material\n\nSkills, design templates, design systems, craft rules and prompt templates copied from ${index.source.repo} @ ${commit}.\nLicense: Apache-2.0 (see the upstream LICENSE). Prompt templates keep their own per-file source and license (several are CC-BY-4.0, from YouMind-OpenLab/awesome-gpt-image-2).\nRe-create with scripts/vendor-open-design.mjs.\n`);
console.log(`skills ${skills.length} · templates ${templates.length} · systems ${systems.length} · craft ${craft.length} · prompts ${prompts.length} · commit ${commit.slice(0, 7)}`);
