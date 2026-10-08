/**
 * Turns a pick (select.ts) into the section of the system prompt, and parses the `/od` command.
 *
 * Everything here is size-bounded: the pack is large, a prompt is not, and the model does better with a few
 * things said clearly than with a library dumped in front of it.
 */
import { pickOpenDesign, type OdPick } from './select.ts';
import type { OdIndex, OdIo } from './types.ts';

const LIMITS = { skill: 8000, secondSkill: 5500, system: 9000, template: 4500, example: 6500, craftEach: 1500, craftTotal: 7500 } as const;

/** Headings, rules and short bullets survive; code fences and long prose go. What is left is the checkable part. */
export function condense(md: string, max: number): string {
  const out: string[] = [];
  let fence = false;
  let size = 0;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (/^```/.test(line)) { fence = !fence; continue; }
    if (fence || !line.trim() || /^>/.test(line)) continue;
    const keep = /^#{1,4}\s/.test(line) || /^\s*([-*]|\d+\.)\s/.test(line) || /^\|/.test(line) || line.length <= 160;
    if (!keep) continue;
    if (size + line.length + 1 > max) break;
    out.push(line);
    size += line.length + 1;
  }
  return out.join('\n');
}

/** Cuts at a line break, not mid-rule. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf('\n'), max * 0.8))}\n…(trimmed)`;
}

export interface OdContext {
  text: string;
  /** One line for the chat: what was brought in and why. */
  summary: string;
  pick: OdPick;
}

export async function openDesignContext(
  request: string,
  index: OdIndex,
  io: OdIo,
  opts: { force?: { skill?: string; system?: string; template?: string }; /** A native app: the colours, type and craft rules apply, the HTML skills and layouts do not. */ native?: boolean } = {},
): Promise<OdContext | null> {
  const pick = pickOpenDesign(request, index, opts);
  if (opts.native) { pick.skills = []; pick.template = undefined; }
  if (!pick.skills.length && !pick.system && !pick.template && !pick.craft.length) return null;

  const parts: string[] = [];
  const said: string[] = [];

  const craftBits: string[] = [];
  let craftSize = 0;
  for (const id of pick.craft) {
    const md = await io.text(`craft/${id}.md`);
    if (!md) continue;
    const c = condense(md, LIMITS.craftEach);
    if (craftSize + c.length > LIMITS.craftTotal) break;
    craftSize += c.length;
    craftBits.push(`### ${id}\n${c}`);
  }
  if (craftBits.length) {
    parts.push(`## DESIGN CRAFT RULES\nHard-won rules from Open Design for work that looks designed, not generated. Treat the "must" and "never" lines as requirements.\n\n${craftBits.join('\n\n')}`);
    said.push(`${craftBits.length} craft rule set${craftBits.length === 1 ? '' : 's'}`);
  }

  if (pick.system) {
    const md = await io.text(`systems/${pick.system.id}.md`);
    const meta = index.systems.find((s) => s.id === pick.system!.id);
    if (md && meta) {
      parts.push(
        `## DESIGN SYSTEM: ${meta.name}\nThe user asked for this look (${pick.system.why}). Treat the document below as the source of truth for colour, type, spacing, radius, shadow and components. Put its colour and type values in :root as CSS variables and use only those. It is an inspiration for a new design: do not copy a company's logo, wordmark or trademarked artwork.\n\n${clip(md, LIMITS.system)}`,
      );
      said.push(`the ${meta.name} design system`);
    }
  }

  for (const [i, s] of pick.skills.entries()) {
    const md = await io.text(`skills/${s.id}.md`);
    if (!md) continue;
    parts.push(`## SKILL: ${s.id}\nOpen Design skill, brought in because ${s.why}. Follow its workflow and checks while you work on this request; ignore any step that needs a tool you do not have.\n\n${clip(md, i === 0 ? LIMITS.skill : LIMITS.secondSkill)}`);
    said.push(`the ${s.id} skill`);
  }

  if (pick.template) {
    const md = await io.text(`templates/${pick.template.id}.md`);
    const meta = index.templates.find((t) => t.id === pick.template!.id);
    if (md && meta) {
      const example = meta.example ? await io.text(`templates/${pick.template.id}.html`) : null;
      parts.push(
        `## TEMPLATE: ${pick.template.id}\nA finished layout pattern for this kind of output (${pick.template.why}). Use its structure and sections; replace its content with the user's real content.\n\n${clip(md, LIMITS.template)}${example ? `\n\n### Reference markup (structure only, trimmed)\n\`\`\`html\n${clip(example, LIMITS.example)}\n\`\`\`` : ''}`,
      );
      said.push(`the ${pick.template.id} template`);
    }
  }

  if (!parts.length) return null;
  return { text: parts.join('\n\n'), summary: `🎨 Open Design — using ${said.join(', ')}.`, pick };
}

// ── The /od command ──────────────────────────────────────────────────────────

export type OdCommand =
  | { kind: 'help' }
  | { kind: 'list'; what: 'skills' | 'systems' | 'templates' | 'prompts' | 'craft' | 'all' }
  | { kind: 'prompt'; query: string }
  | { kind: 'use'; force: { skill?: string; system?: string; template?: string }; task: string };

/**
 * `/od` → help · `/od list [skills|styles|templates|prompts|craft]` · `/od prompt <words>`
 * `/od <skill> <task>` · `/od style <brand> <task>` · `/od template <id> <task>` · `/od <brand> <task>`
 * Returns null when the text is not an /od command at all.
 */
export function parseOd(input: string, index?: OdIndex): OdCommand | null {
  const m = /^\/(?:od|opendesign|open-design)(?:\s+([\s\S]*))?$/i.exec(input.trim());
  if (!m) return null;
  const rest = (m[1] ?? '').trim();
  if (!rest || /^(help|\?|kaise|how)$/i.test(rest)) return { kind: 'help' };
  const [head, ...tail] = rest.split(/\s+/);
  const arg = tail.join(' ').trim();
  const h = head.toLowerCase();

  if (h === 'list' || h === 'catalog' || h === 'catalogue') {
    const w = arg.toLowerCase();
    const what = /^skill/.test(w) ? 'skills' : /^(style|system|brand|design)/.test(w) ? 'systems' : /^templ/.test(w) ? 'templates' : /^prompt/.test(w) ? 'prompts' : /^craft/.test(w) ? 'craft' : 'all';
    return { kind: 'list', what };
  }
  if (h === 'prompt' || h === 'prompts') return { kind: 'prompt', query: arg };
  if (/^(style|system|brand|look)$/.test(h)) {
    const [id, ...task] = arg.split(/\s+/);
    return { kind: 'use', force: { system: (id ?? '').toLowerCase() }, task: task.join(' ') };
  }
  if (h === 'template') {
    const [id, ...task] = arg.split(/\s+/);
    return { kind: 'use', force: { template: (id ?? '').toLowerCase() }, task: task.join(' ') };
  }
  if (index) {
    if (index.skills.some((s) => s.id === h)) return { kind: 'use', force: { skill: h }, task: arg };
    if (index.systems.some((s) => s.id === h)) return { kind: 'use', force: { system: h }, task: arg };
    if (index.templates.some((t) => t.id === h)) return { kind: 'use', force: { template: h }, task: arg };
  }
  // Not a known name: treat the whole thing as a task and let the automatic pick decide.
  return { kind: 'use', force: {}, task: rest };
}

export const OD_HELP = `**Open Design** — design skills, 150+ brand design systems, ready layouts and craft rules, from github.com/nexu-io/open-design.

**It works on its own.** Ask for a website, app screen, dashboard, deck or poster and the right skill, layout and craft rules are brought in automatically. Name a brand ("Stripe jaisa", "Airbnb style") and that design system is used.

**Or call it yourself:**
- \`/od list\` — everything available (\`/od list skills\` · \`styles\` · \`templates\` · \`prompts\` · \`craft\`)
- \`/od design-review <what to review>\` — use a skill by name
- \`/od style stripe landing page banao\` — build in a brand's design system
- \`/od template dashboard expense dashboard\` — start from a ready layout
- \`/od prompt cinematic portrait\` — find a ready image/video prompt

When something is brought in, the chat says so in one line.`;
