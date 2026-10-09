import { searchSkills, pickSkills } from './select.ts';
import type { LibIndex, LibSkill } from './types.ts';
import type { OdIo } from '../opendesign/types.ts';

const LIMIT_FIRST = 7000;
const LIMIT_NEXT = 4500;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf('\n'), max * 0.8))}\n…(trimmed)`;
}

const SOURCE_NAME = { superpowers: 'obra/superpowers', anthropic: 'anthropics/skills', agentic: 'sickn33/agentic-awesome-skills' } as const;

export interface LibContext { text: string; summary: string; ids: string[] }

export async function skillLibraryContext(
  request: string,
  index: LibIndex,
  io: OdIo,
  opts: { force?: string[]; max?: number; exclude?: Set<string> } = {},
): Promise<LibContext | null> {
  const picks = pickSkills(request, index, opts);
  if (!picks.length) return null;
  const parts: string[] = [];
  const said: string[] = [];
  const ids: string[] = [];
  for (const [i, p] of picks.entries()) {
    const meta = index.skills.find((s) => s.id === p.id);
    const md = await io.text(`files/${p.id}.md`);
    if (!meta || !md) continue;
    parts.push(
      `## SKILL: ${p.id} (${SOURCE_NAME[meta.source]})\nBrought in automatically because ${p.why}. Work the way it says while you handle this request. It was written for an agent with a full workstation: skip any step that needs a script, subagent or tool you do not have, and say so in one line instead of pretending.\n\n${clip(md, i === 0 ? LIMIT_FIRST : LIMIT_NEXT)}`,
    );
    said.push(`${p.id}`);
    ids.push(p.id);
  }
  if (!parts.length) return null;
  return { text: parts.join('\n\n'), summary: `::books:: Skill${ids.length === 1 ? '' : 's'} — using ${said.join(', ')}.`, ids };
}

// ── /skills and /use ─────────────────────────────────────────────────────────

export type SkillsCommand =
  | { kind: 'overview' }
  | { kind: 'search'; query: string }
  | { kind: 'auto'; on: boolean | null }
  | { kind: 'use'; id: string; task: string };

/** `/skills` · `/skills <words>` · `/skills auto on|off` · `/use <skill> <task>`. Null when it is neither. */
export function parseSkillsCommand(input: string, index?: LibIndex): SkillsCommand | null {
  const t = input.trim();
  const use = /^\/use(?:\s+([\s\S]*))?$/i.exec(t);
  if (use) {
    const [head, ...rest] = (use[1] ?? '').trim().split(/\s+/);
    const id = (head ?? '').toLowerCase();
    if (!id) return { kind: 'overview' };
    if (index && !index.skills.some((s) => s.id === id)) return { kind: 'search', query: [id, ...rest].join(' ') };
    return { kind: 'use', id, task: rest.join(' ') };
  }
  const m = /^\/skills(?:\s+([\s\S]*))?$/i.exec(t);
  if (!m) return null;
  const arg = (m[1] ?? '').trim();
  if (!arg) return { kind: 'overview' };
  const auto = /^auto(?:\s+(on|off|yes|no|true|false))?$/i.exec(arg);
  if (auto) return { kind: 'auto', on: auto[1] ? /^(on|yes|true)$/i.test(auto[1]) : null };
  return { kind: 'search', query: arg };
}

const short = (s: string, n = 120): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function renderSkillsOverview(index: LibIndex, odCounts: { skills: number; systems: number } | null, auto: boolean): string {
  const by = (src: string) => index.skills.filter((s) => s.source === src).length;
  const cat = new Map<string, number>();
  for (const s of index.skills) if (s.category) cat.set(s.category, (cat.get(s.category) ?? 0) + 1);
  const top = [...cat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, n]) => `${c} (${n})`).join(' · ');
  return [
    `**Skills library** — ${index.skills.length} skills${odCounts ? ` + ${odCounts.skills} design skills and ${odCounts.systems} brand looks (Open Design)` : ''}. Automatic use is **${auto ? 'on' : 'off'}**.`,
    '',
    '**Where they come from**',
    `- obra/superpowers (${by('superpowers')}) — how to work: brainstorm, plan, test first, debug, verify, review`,
    `- anthropics/skills (${by('anthropic')}) — Claude API, web-app testing, internal comms, writing skills`,
    `- sickn33/agentic-awesome-skills (${by('agentic')}) — ${top}`,
    '',
    '**It picks the skill itself.** When a request needs one — a bug to fix, tests to write, an API to design, a database, a deploy pipeline, an SEO audit — that skill is put in front of the AI and the chat says which. Design work goes to Open Design.',
    '',
    '**Or you choose:** `/skills <words>` search · `/use <skill> <task>` use one by name · `/skills auto off` (or `on`) turn the automatic part off or on · `/od list` the design side.',
  ].join('\n');
}

export function renderSkillsSearch(index: LibIndex, query: string): string {
  const found = searchSkills(query, index, 10);
  if (!found.length) return `No skill matches “${query}”. Try other words, or \`/skills\` for the overview.`;
  const row = (s: LibSkill) => `- \`${s.id}\` — ${short(s.description)} _(${s.source === 'superpowers' ? 'superpowers' : s.source === 'anthropic' ? 'anthropic' : s.category ?? 'library'})_`;
  return [`**Skills for “${query}”** — use one with \`/use <name> <task>\``, '', ...found.map(row)].join('\n');
}
