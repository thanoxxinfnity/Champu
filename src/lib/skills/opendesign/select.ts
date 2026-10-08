/**
 * Which of the Open Design skills, templates, design systems and craft rules go in front of the model for a request.
 *
 * Deterministic, like the lane router: the same request picks the same things, and the chat can say which ones and why.
 * Nothing is injected unless the request is about design work at all, and the total stays a size a model can use.
 */
import type { OdIndex, OdSkill, OdSystem, OdTemplate } from './types.ts';

/** Words that make a request design work (a screen, a page, a deck, a brand), as opposed to code or a game. */
const DESIGN_INTENT =
  /\b(ui|ux|website|web ?site|web ?page|landing|homepage|portfolio|dashboard|screen|interface|design|redesign|layout|mockup|prototype|wireframe|deck|slides?|presentation|pitch|poster|brochure|resume|cv|infographic|brand(ing)?|logo|style ?guide|design system|theme|login|sign ?up|onboarding|pricing|checkout|app)\b/i;

/** Systems whose id is an ordinary style word: they only count when the request says "<name> style/theme/look". */
const STYLE_WORDS = new Set([
  'application', 'artistic', 'bold', 'cafe', 'clean', 'colorful', 'contemporary', 'corporate', 'cosmic', 'creative', 'dashboard',
  'default', 'dramatic', 'editorial', 'elegant', 'energetic', 'enterprise', 'expressive', 'fantasy', 'flat', 'friendly', 'futuristic',
  'gradient', 'luxury', 'material', 'minimal', 'modern', 'mono', 'neon', 'paper', 'premium', 'professional', 'publication', 'refined',
  'retro', 'simple', 'sleek', 'spacious', 'storytelling', 'vibrant', 'vintage', 'agentic', 'levels', 'meta', 'claude', 'cursor', 'arc',
  'ant', 'cal', 'kami', 'clay', 'wise', 'warp', 'bento', 'doodle', 'hud', 'loom', 'linear', 'perspective', 'sanity',
]);

const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
const has = (text: string, phrase: string): boolean => {
  const p = phrase.toLowerCase().trim();
  if (!p) return false;
  // Plain words match on word boundaries; anything else (Chinese triggers) as a substring.
  return /^[a-z0-9 .&+-]+$/.test(p) ? new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text) : text.includes(p);
};

export function isDesignRequest(request: string): boolean {
  return DESIGN_INTENT.test(request);
}

interface Scored<T> { item: T; score: number; why: string }

/**
 * Requests people actually type, in English and Hinglish, mapped to the skill that answers them. Trigger phrases in a
 * skill's front matter are written for English prompts; this is what catches "ui ganda lag raha hai, sundar banao".
 */
const BOOSTS: Array<[RegExp, string[]]> = [
  [/(review|audit|critique|check|rate|feedback).{0,30}\b(design|ui|ux|page|site|screen|app)\b|\b(design|ui|ux)\b.{0,20}(review|audit|critique)/i, ['design-review']],
  [/\b(polish|improve|beautify|refresh|redesign|upgrade|fix)\b.{0,30}\b(ui|ux|design|look|page|site|screen)\b|\b(ganda|ugly|boring|sundar|behtar|better[- ]looking|professional look)\b/i, ['impeccable-design-polish', 'redesign-skill']],
  [/\b(landing|website|web ?site|web ?page|homepage|portfolio|ui)\b/i, ['frontend-design']],
  [/\b(deck|slides?|presentation|ppt|pitch)\b/i, ['frontend-slides', 'slides']],
  [/\b(gsap|scroll ?trigger|scroll[- ]?(driven|animation)|timeline animation)\b/i, ['gsap-core', 'gsap-scrolltrigger']],
  [/\b(resume|cv)\b/i, ['resume-modern']],
  [/\b(copy|copywriting|headline|tagline|slogan|ad copy|marketing text)\b/i, ['copywriting']],
  [/\b(colou?rs?|palette|contrast)\b/i, ['color-expert']],
  [/\b(brand (guide|guidelines|kit)|brandkit|logo)\b/i, ['brand-guidelines', 'brandkit']],
  [/\bshadcn\b/i, ['shadcn-ui']],
  [/\b(log ?in|sign ?in|sign ?up|register|auth(entication)? screen)\b/i, ['login-flow']],
  [/\b(pricing|paywall|upgrade|subscription)\b/i, ['paywall-upgrade-cro']],
  [/\bfaq\b/i, ['faq-page']],
  [/\b(ios|swiftui|iphone app)\b/i, ['swiftui-design', 'apple-hig']],
  [/\b(flutter)\b/i, ['flutter-animating-apps']],
  [/\b(data ?viz|chart|graph|d3)\b/i, ['d3-visualization']],
  [/\b(design brief|brief for)\b/i, ['design-brief']],
  [/\b(release notes?|changelog)\b/i, ['release-notes-one-pager']],
  [/\b(magazine|article layout|editorial)\b/i, ['article-magazine']],
  [/\b(poster|flyer)\b/i, ['poster-hero']],
];

function boostFor(request: string, id: string): number {
  return BOOSTS.some(([re, ids]) => ids.includes(id) && re.test(request)) ? 6 : 0;
}

function scoreEntry(request: string, e: { id: string; description: string; triggers: string[] }): { score: number; why: string } {
  const text = request.toLowerCase();
  const present = new Set(words(text));
  let score = 0;
  const hits: string[] = [];
  for (const t of e.triggers) {
    const toks = words(t);
    // A phrase counts when its words are all there, in any order: "review my design" is the "design review" skill.
    const matched = has(text, t) || (toks.length >= 2 && toks.every((w) => present.has(w)));
    if (!matched) continue;
    const weak = toks.length === 1 && toks[0].length < 5;
    score += weak ? 1 : 3;
    hits.push(`"${t}"`);
  }
  const idPhrase = e.id.replace(/-/g, ' ');
  if (e.id.length > 4 && (has(text, idPhrase) || has(text, e.id))) { score += 5; hits.push(e.id); }
  const boost = boostFor(request, e.id);
  if (boost) { score += boost; hits.push('what you asked for'); }
  // Description overlap is weak evidence: it only breaks ties and rescues a request that names the topic in other words.
  const sig = new Set(words(e.description).filter((w) => w.length >= 6));
  let overlap = 0;
  for (const w of present) if (sig.has(w)) overlap += 1;
  if (overlap >= 2) score += Math.min(3, overlap - 1);
  return { score: Math.min(score, 14), why: [...new Set(hits)].slice(0, 3).join(', ') || 'matches its description' };
}

/** A brand or style the request names: "stripe jaisa", "like Airbnb", "brutalism style", "glassmorphism". */
export function matchSystem(request: string, systems: OdSystem[]): Scored<OdSystem> | null {
  const text = request.toLowerCase();
  let best: Scored<OdSystem> | null = null;
  for (const s of systems) {
    const names = [...new Set([s.id.replace(/-/g, ' '), s.name.toLowerCase()])].filter((n) => n.length >= 3);
    for (const n of names) {
      if (!has(text, n)) continue;
      const styled = new RegExp(`(?:(?:like|inspired by|in the style of|style of|jaisa|jaise|wala|ki tarah|theme|look(?: and feel)?|design system|brand)\\s+(?:of\\s+)?${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(?:style|theme|look|design|jaisa|jaise|wala|aesthetic|vibe|ui))`, 'i').test(request);
      const generic = STYLE_WORDS.has(s.id);
      if (generic && !styled) continue;
      const score = styled ? 10 : 6;
      if (!best || score > best.score || (score === best.score && n.length > best.item.name.length)) best = { item: s, score, why: styled ? `you asked for the ${s.name} look` : `you named ${s.name}` };
    }
  }
  return best;
}

export interface OdPick {
  skills: Array<{ id: string; why: string }>;
  template?: { id: string; why: string };
  system?: { id: string; why: string };
  craft: string[];
  /** The request was design work at all. */
  design: boolean;
}

/** Craft rules that apply to every screen, deck or page; the rest are pulled in by the skill that asks for them. */
const BASE_CRAFT = ['anti-ai-slop', 'typography', 'color', 'state-coverage'];
const MAX_SKILLS = 2;
const INJECTABLE = new Set(['prototype', 'design-system', 'deck', 'utility', 'template', 'design']);

export function pickOpenDesign(request: string, index: OdIndex, opts: { force?: { skill?: string; system?: string; template?: string } } = {}): OdPick {
  const design = isDesignRequest(request);
  const pick: OdPick = { skills: [], craft: [], design };
  const force = opts.force ?? {};

  if (force.skill) {
    const s = index.skills.find((k) => k.id === force.skill);
    if (s) pick.skills.push({ id: s.id, why: 'you asked for it by name' });
  }
  if (force.system) {
    const s = index.systems.find((k) => k.id === force.system);
    if (s) pick.system = { id: s.id, why: 'you asked for it by name' };
  }
  if (force.template) {
    const t = index.templates.find((k) => k.id === force.template);
    if (t) pick.template = { id: t.id, why: 'you asked for it by name' };
  }

  const forced = Boolean(force.skill || force.system || force.template);
  if (!design && !forced) return pick;

  if (!pick.skills.length) {
    const scored: Array<Scored<OdSkill>> = index.skills
      .filter((s) => !s.external && INJECTABLE.has(s.mode))
      .map((s) => ({ item: s, ...scoreEntry(request, s) }))
      .filter((s) => s.score >= 4)
      .sort((a, b) => b.score - a.score);
    for (const s of scored.slice(0, MAX_SKILLS)) pick.skills.push({ id: s.item.id, why: s.why });
  }

  if (!pick.template) {
    const scored: Array<Scored<OdTemplate>> = index.templates
      .map((t) => ({ item: t, ...scoreEntry(request, t) }))
      .filter((t) => t.score >= 6)
      .sort((a, b) => b.score - a.score);
    if (scored[0]) pick.template = { id: scored[0].item.id, why: scored[0].why };
  }

  if (!pick.system) {
    const m = matchSystem(request, index.systems);
    if (m) pick.system = { id: m.item.id, why: m.why };
  }

  const craft = new Set<string>(design || forced ? BASE_CRAFT : []);
  for (const id of pick.skills.map((s) => s.id)) for (const c of index.skills.find((k) => k.id === id)?.craft ?? []) craft.add(c);
  if (pick.template) for (const c of index.templates.find((k) => k.id === pick.template!.id)?.craft ?? []) craft.add(c);
  if (/\b(rtl|arabic|urdu|hebrew|farsi)\b/i.test(request)) craft.add('rtl-and-bidi');
  if (/\b(form|login|sign ?up|checkout|input|validation)\b/i.test(request)) craft.add('form-validation');
  if (/\b(animat|motion|transition|scroll)\w*/i.test(request)) craft.add('animation-discipline');
  const known = new Set(index.craft.map((c) => c.id));
  pick.craft = [...craft].filter((c) => known.has(c)).slice(0, 6);
  return pick;
}
