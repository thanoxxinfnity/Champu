/**
 * Motion-design guidance for an animated website, from the HyperFrames and Remotion skills (see scripts/vendor-motion-guides.mjs).
 *
 * Those were written for video; the principles (easing, stagger, text effects, scene-to-scene transitions, zoom and camera moves)
 * are the same for a page that moves. They are handed over only when a website is being built AND the request is about motion,
 * with a line saying to adapt them to CSS and GSAP on the web.
 */
import type { OdIo } from '../../skills/opendesign/types.ts';

const MOTION =
  /\b(animat\w*|motion|transition\w*|parallax|scroll(?:ing)?[- ](?:driven|triggered|animation|effect|reveal)|scroll ?trigger|reveal|stagger\w*|gsap|micro-?interactions?|hover effects?|hero (?:effect|animation)|kinetic|typewriter|morph\w*|ken burns|smooth(?:ly)? (?:move|scroll|slide)|interactive|moving|floating)\b/i;

export const wantsMotion = (text: string): boolean => MOTION.test(text);

interface MotionItem { id: string; source: string; title: string; keywords: string[]; bytes: number }
interface MotionIndex { items: MotionItem[] }

export function pickMotionGuides(request: string, index: MotionIndex): string[] {
  const text = request.toLowerCase();
  const scored = index.items
    .map((it) => ({ id: it.id, hits: it.keywords.filter((k) => text.includes(k)).length }))
    .filter((x) => x.hits > 0 || x.id === 'animation')
    .sort((a, b) => (b.id === 'animation' ? 1 : 0) - (a.id === 'animation' ? 1 : 0) || b.hits - a.hits);
  const ids = scored.map((s) => s.id);
  return ['animation', ...ids.filter((i) => i !== 'animation').slice(0, 2)];
}

const clip = (t: string, max: number): string => {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf('\n'), max * 0.8))}\n…(trimmed)`;
};

export interface MotionContext { text: string; summary: string; ids: string[] }

export async function motionContext(request: string, io: OdIo): Promise<MotionContext | null> {
  const index = await io.json<MotionIndex>('index.json');
  if (!index) return null;
  const ids = pickMotionGuides(request, index);
  const parts: string[] = [];
  const used: string[] = [];
  for (const [i, id] of ids.entries()) {
    const md = await io.text(`${id}.md`);
    const meta = index.items.find((m) => m.id === id);
    if (!md || !meta) continue;
    used.push(id);
    parts.push(`### ${id} — ${meta.title}\n${clip(md, i === 0 ? 8000 : 4000)}`);
  }
  if (!parts.length) return null;
  const text = `## MOTION REFERENCE (for the animated parts of this website)
Motion-design principles from the HyperFrames and Remotion skills. They were written for rendered video: take the ideas (easing choices, stagger, text-reveal effects, scene-to-scene transitions, zoom and camera moves, spring timing) and build them with CSS transitions, the Web Animations API or GSAP (with ScrollTrigger for scroll). Ignore anything about frames, \`useCurrentFrame\`, \`data-start\`, paused or seekable timelines and rendering. On a page, respect \`prefers-reduced-motion\`, animate only transform and opacity, and never block reading or tapping.

${parts.join('\n\n')}`;
  return { text, summary: `::wand:: Motion rules brought in for the animations (${used.join(', ')}).`, ids: used };
}
