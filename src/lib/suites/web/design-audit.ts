/**
 * A design-audit pass for a website request that complains about the look rather than the motion or the code —
 * "looks generic", "like AI made it", "no design sense", "boring". The usual reply to that complaint is to tune
 * colours or add an animation; the actual fault is almost always the still layout underneath: identical sections,
 * a flat type scale, no spacing rhythm, placeholder copy. This hands the model a short checklist to run *before*
 * touching motion or colour, so the fix lands on the right layer.
 */

const AUDIT =
  /\b(generic|boring|template[- ]?y|like every other site|cookie[- ]?cutter|no design sense|doesn'?t look designed|not (?:well[- ]?)?designed|looks (?:cheap|amateur|unfinished|plain|flat|empty))\b|\blike ai (?:made|built|generated) (?:it|this)\b|\b(looks?|design) (?:ajeeb|ganda|bekar|normal)\b|\bdesign (?:accha|theek) nahi\b|\bsite (?:bekar|ganda) lag/i;

export const wantsDesignAudit = (text: string): boolean => AUDIT.test(text);

const CHECKLIST = `## DESIGN AUDIT (the complaint is about the still frame, not the motion)

A page called "generic", "boring" or "like AI made it" is almost never missing an animation — it is missing a
design the animation could sit on top of. Fix these, in order, before adding or tuning any motion:

1. **Judge the page with every animation switched off.** If a plain screenshot of it would not stand on its own
   — a centred headline, three identical cards, a footer — the layout is the problem, not the motion.
2. **Macrostructure.** Sections should not all share one shape (icon, heading, paragraph, repeat). Vary the
   rhythm: a full-bleed statement, an asymmetric two-column block, a dense comparison, a wide quote. At least
   one section should break the grid the others use.
3. **Type scale.** Pick 3–4 sizes with real contrast between them (not 16/18/20px, which reads as one size) and
   use nothing outside that scale. The headline should be large enough to feel like a decision, not a default.
4. **Spacing rhythm.** One spacing unit, multiplied (8/16/24/32/48/64...), used consistently — not arbitrary
   padding per element. Generous whitespace around the hero; cramped spacing is the single most common tell of
   an unfinished page.
5. **Colour.** One accent colour doing real work (links, primary actions, the one thing that should draw the
   eye), a neutral scale for everything else. Three competing bright colours on one screen reads as unplanned,
   not lively.
6. **Copy.** Real, specific sentences about the actual subject — never "Lorem ipsum", "Feature one", "Company
   Name". Invented facts are fine for a mock, but they must sound like facts, not placeholders.
7. **One idea the page is built around.** A page that could have its headline swapped for any other product's
   headline with nothing else changing has no concept. Name the one thing this page is about before laying out
   a single section, and let every section serve it.

Only once the still frame passes this list does tuning easing, stagger or scroll behaviour help — motion on an
undesigned layout reads as the same generic page, moving.`;

export function designAuditContext(): { text: string; summary: string } {
  return { text: CHECKLIST, summary: '::spark:: Design checklist brought in — the still layout, before any motion gets touched.' };
}
