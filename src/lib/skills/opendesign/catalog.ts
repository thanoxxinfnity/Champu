import type { OdIndex, OdIo, OdPrompt } from './types.ts';

const short = (s: string, n = 110): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const group = <T>(items: T[], key: (t: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const i of items) m.set(key(i) || 'other', [...(m.get(key(i) || 'other') ?? []), i]);
  return m;
};

/** What is in the pack, as chat text. The overview is short; a named list is complete. */
export function renderCatalog(index: OdIndex, what: 'all' | 'skills' | 'systems' | 'templates' | 'prompts' | 'craft'): string {
  const usable = index.skills.filter((s) => !s.external);
  if (what === 'skills') {
    return [`**Skills** (${index.skills.length}) — call one with \`/od <name> <task>\``, '',
      ...index.skills.map((s) => `- \`${s.id}\`${s.external ? ' _(needs an outside service)_' : ''} — ${short(s.description)}`)].join('\n');
  }
  if (what === 'systems') {
    const lines = [`**Design systems** (${index.systems.length}) — use one with \`/od style <name> <task>\` or just say "<name> jaisa"`, ''];
    for (const [cat, list] of group(index.systems, (s) => s.category)) lines.push(`- **${cat}:** ${list.map((s) => s.id).join(', ')}`);
    return lines.join('\n');
  }
  if (what === 'templates') {
    return [`**Ready layouts** (${index.templates.length}) — start from one with \`/od template <name> <task>\``, '',
      ...index.templates.map((t) => `- \`${t.id}\` — ${short(t.description, 90)}`)].join('\n');
  }
  if (what === 'craft') {
    return [`**Craft rules** (${index.craft.length}) — added automatically to design work`, '', ...index.craft.map((c) => `- \`${c.id}\` — ${c.title}`)].join('\n');
  }
  if (what === 'prompts') {
    const lines = [`**Image & video prompts** (${index.prompts.length}) — find one with \`/od prompt <words>\``, ''];
    for (const [cat, list] of group(index.prompts, (p) => `${p.surface} · ${p.category}`)) lines.push(`- **${cat}:** ${list.slice(0, 6).map((p) => p.title).join(' · ')}${list.length > 6 ? ' …' : ''}`);
    return lines.join('\n');
  }

  const byMode = group(usable, (s) => s.mode);
  const n = (m: string) => byMode.get(m)?.length ?? 0;
  const names = (m: string, k: number) => (byMode.get(m) ?? []).slice(0, k).map((s) => s.id).join(', ');
  return [
    `**Open Design is in.** ${usable.length} skills · ${index.systems.length} design systems · ${index.templates.length} ready layouts · ${index.craft.length} craft rule sets · ${index.prompts.length} image/video prompts.`,
    '',
    '**What it does for you**',
    `- **Web & app screens** (${n('prototype')} skills): ${names('prototype', 8)} …`,
    `- **Decks & slides** (${n('deck')}): ${names('deck', 5)} …`,
    `- **Design systems** (${n('design-system')} skills, ${index.systems.length} brand looks): Stripe, Apple, Airbnb, Spotify, Notion, Vercel, Linear, Tesla… and styles like brutalism, glassmorphism, neumorphism, bento`,
    `- **Reviews & polish:** design-review, impeccable-design-polish, review-animations, web-design-guidelines`,
    `- **Documents:** docx, pdf, pptx, resume-modern, release-notes-one-pager, article-magazine`,
    `- **Animation & 3D:** gsap-* (core, scrolltrigger, timeline, react…), threejs, shader-dev`,
    `- **Writing & strategy:** copywriting, marketing-psychology, brand-guidelines, design-brief`,
    '',
    '**It triggers by itself** when your request is about design work (a website, screen, dashboard, deck, poster, brand). Name a brand and its look is used.',
    '**Call it yourself:** `/od list skills|styles|templates|prompts|craft` · `/od <skill> <task>` · `/od style <brand> <task>` · `/od template <name> <task>` · `/od prompt <words>`',
  ].join('\n');
}

const fillArgs = (prompt: string): string => prompt.replace(/\{argument name=\\?"([^"\\]*)\\?" default=\\?"((?:[^"\\]|\\.)*?)\\?"\}/g, (_m, _n, d: string) => d);

function scorePrompt(p: OdPrompt, words: string[]): number {
  const hay = `${p.title} ${p.summary} ${p.category} ${p.tags.join(' ')}`.toLowerCase();
  return words.reduce((n, w) => n + (hay.includes(w) ? (p.title.toLowerCase().includes(w) ? 3 : 1) : 0), 0);
}

/** `/od prompt <words>`: the best few ready prompts, with their blanks filled in by their defaults. */
export async function renderPromptSearch(index: OdIndex, io: OdIo, query: string): Promise<string> {
  const words = query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  if (!words.length) return renderCatalog(index, 'prompts');
  const top = index.prompts.map((p) => ({ p, s: scorePrompt(p, words) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
  if (!top.length) return `No ready prompt matches “${query}”. Try \`/od prompt\` to browse them all.`;
  const out: string[] = [`**Ready prompts for “${query}”** — copy one into the ${top[0].p.surface} tool and change the details.`];
  for (const { p } of top) {
    const j = await io.json<{ prompt?: string }>(`prompts/${p.surface}/${p.id}.json`);
    const body = j?.prompt ? fillArgs(j.prompt) : p.summary;
    out.push('', `**${p.title}** — ${p.surface}${p.model ? ` · ${p.model}` : ''}${p.aspect ? ` · ${p.aspect}` : ''}`, `_${short(p.summary, 160)}_`, '```', short(body, 1800), '```');
  }
  return out.join('\n');
}
