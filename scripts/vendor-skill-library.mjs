#!/usr/bin/env node
/**
 * Builds public/skills/: a library of general-purpose agent skills from three open-source collections.
 *   node scripts/vendor-skill-library.mjs <obra/superpowers clone> <anthropics/skills clone> <sickn33/agentic-awesome-skills clone>
 *
 * - obra/superpowers (MIT): the development process skills (brainstorm, plan, test first, debug, verify, review).
 * - anthropics/skills (Apache-2.0 skills only; the source-available docx/pdf/pptx/xlsx are left out).
 * - sickn33/agentic-awesome-skills (code MIT, content CC BY 4.0): the "safe", English, builder-relevant part of its 2,600 skills.
 * Design skills are not taken: they are covered, with brand design systems, by public/od (Open Design).
 * Only SKILL.md is taken; helper scripts and assets are not, so a step that needs one is skipped by the model.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [superpowers, anthropic, agentic] = process.argv.slice(2);
if (!agentic) { console.error('usage: node scripts/vendor-skill-library.mjs <superpowers> <anthropic-skills> <agentic-awesome-skills>'); process.exit(1); }
const out = 'public/skills';
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'files'), { recursive: true });
const commit = (d) => execFileSync('git', ['-C', d, 'rev-parse', 'HEAD']).toString().trim();

function front(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw.trim() };
  const fm = m[1];
  const get = (k) => {
    const block = new RegExp(`^${k}:\\s*[|>][-+]?\\n((?:[ \\t]+.*\\n?)+)`, 'm').exec(fm + '\n');
    if (block) return block[1].split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
    const line = new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm);
    return line ? line[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  return { meta: { name: get('name'), description: get('description') }, body: m[2].trim() };
}

const STOP = new Set('this that with from your when will have been into them then than also only such more most some other about which would could should their there these those what where while using used uses make makes need needs want wants work works like just very much many each both any all not and the for are you can use via per its our out how why who one two get gets set sets new add adds run runs'.split(' '));
const words = (s) => [...new Set((s.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? []).map((w) => w.replace(/[.-]+$/, '')).filter((w) => w.length >= 3 && !STOP.has(w)))];

const MAX_BYTES = 12_000;
// English only: the pack is read by a model answering in the user's language, but the selector matches English words.
const EN = /\b(the|and|for|with|when|use|your|this|that|to|of|in|is|you|are|or|a)\b/gi;
const looksEnglish = (t) => (t.slice(0, 700).match(EN) ?? []).length >= 8;
const skills = [];
const used = new Set();
function add(source, name, desc, body, extra = {}) {
  // A stub (a name and a paragraph) teaches nothing and only adds noise to the selector.
  if (source === 'agentic' && (body.length < 1500 || desc.length < 50 || !looksEnglish(`${desc} ${body}`))) return;
  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!id || body.length < 200) return;
  if (used.has(id)) id = `${id}-${source}`;
  if (used.has(id)) return;
  used.add(id);
  const clipped = body.length > MAX_BYTES ? `${body.slice(0, MAX_BYTES)}\n\n…(the rest of this skill is left out)` : body;
  writeFileSync(path.join(out, 'files', `${id}.md`), clipped);
  skills.push({ id, source, description: desc.slice(0, 300), kw: words(`${id.replace(/-/g, ' ')} ${desc}`).slice(0, 24), bytes: clipped.length, ...extra });
}

// 1) superpowers — the working method
const SP = ['brainstorming', 'writing-plans', 'executing-plans', 'test-driven-development', 'systematic-debugging', 'verification-before-completion', 'requesting-code-review', 'receiving-code-review'];
for (const n of SP) {
  const f = path.join(superpowers, 'skills', n, 'SKILL.md');
  if (!existsSync(f)) continue;
  const { meta, body } = front(readFileSync(f, 'utf8'));
  add('superpowers', n, meta.description || n, body, { process: true });
}

// 2) anthropics/skills — Apache-2.0 ones that read well without their scripts
for (const n of ['claude-api', 'webapp-testing', 'internal-comms', 'skill-creator']) {
  const f = path.join(anthropic, 'skills', n, 'SKILL.md');
  if (!existsSync(f)) continue;
  const { meta, body } = front(readFileSync(f, 'utf8'));
  add('anthropic', n, meta.description || n, body);
}

// 3) agentic-awesome-skills — the English, builder-relevant part. Its "critical" label means the skill runs commands on
//    infrastructure (docker, kubernetes, databases): fine as guidance for an agent on the user's own machine. "offensive" is dropped.
const KEEP = new Set(['development', 'web-development', 'testing', 'backend', 'code-quality', 'api-integration', 'data', 'mobile', 'architecture', 'database', 'devops', 'reliability', 'engineering', 'code', 'data-ai', 'research', 'security', 'game-development', 'ai-ml', 'automation', 'super-code']);
const idx = JSON.parse(readFileSync(path.join(agentic, 'skills_index.json'), 'utf8'));
for (const s of idx) {
  if (!['safe', 'critical'].includes(s.risk) || /^hunt-|pentest|exploit|jailbreak/.test(s.id) || !KEEP.has(s.category) || /[^\x00-\x7f]/.test(s.description ?? '')) continue;
  const f = path.join(agentic, s.path, 'SKILL.md');
  if (!existsSync(f)) continue;
  const { meta, body } = front(readFileSync(f, 'utf8'));
  add('agentic', s.id, meta.description || s.description || s.id, body, { category: s.category });
}

const index = {
  sources: {
    superpowers: { repo: 'https://github.com/obra/superpowers', commit: commit(superpowers), license: 'MIT' },
    anthropic: { repo: 'https://github.com/anthropics/skills', commit: commit(anthropic), license: 'Apache-2.0 (per skill)' },
    agentic: { repo: 'https://github.com/sickn33/agentic-awesome-skills', commit: commit(agentic), license: 'MIT code, CC BY 4.0 content' },
  },
  skills,
};
writeFileSync(path.join(out, 'index.json'), JSON.stringify(index));
writeFileSync(path.join(out, 'NOTICE.md'), `# Skill library\n\n${Object.entries(index.sources).map(([k, v]) => `- ${k}: ${v.repo} @ ${v.commit.slice(0, 7)} — ${v.license}`).join('\n')}\n\nOnly SKILL.md files, trimmed to ${MAX_BYTES} bytes. Content from agentic-awesome-skills is CC BY 4.0 (attribution: sickn33 and contributors). Re-create with scripts/vendor-skill-library.mjs.\n`);
const by = {}; for (const s of skills) by[s.source] = (by[s.source] ?? 0) + 1;
console.log(by, `${(skills.reduce((n, s) => n + s.bytes, 0) / 1e6).toFixed(2)} MB`);
