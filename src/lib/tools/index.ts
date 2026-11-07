import { calcTools } from './defs/calc.ts';
import { colorTools } from './defs/color.ts';
import { convertTools } from './defs/convert.ts';
import { devTools } from './defs/dev.ts';
import { generateTools } from './defs/generate.ts';
import { securityTools } from './defs/security.ts';
import { textTools } from './defs/text.ts';
import { timeTools } from './defs/time.ts';
import { webFunTools } from './defs/webfun.ts';
import type { Category, Field, Out, ToolDef, Values } from './types.ts';

export type { Category, Field, Out, ToolDef, Values } from './types.ts';

export const CATEGORIES: Category[] = [
  { id: 'text', name: 'Text', glyph: 'Aa', hue: 262, blurb: 'Count, clean, convert and play with text' },
  { id: 'dev', name: 'Developer', glyph: '{ }', hue: 199, blurb: 'JSON, encoders, regex, formatters and web basics' },
  { id: 'convert', name: 'Converters', glyph: '⇄', hue: 160, blurb: 'Units, numbers, bases and sizes' },
  { id: 'calc', name: 'Calculators', glyph: '∑', hue: 32, blurb: 'Money, health, school and everyday maths' },
  { id: 'generate', name: 'Generators', glyph: '✦', hue: 320, blurb: 'Passwords, QR codes, CSS, images and test data' },
  { id: 'color', name: 'Colour', glyph: '◐', hue: 340, blurb: 'Palettes, contrast, gradients and conversions' },
  { id: 'time', name: 'Date & time', glyph: '◷', hue: 48, blurb: 'Dates, ages, time zones and calendars' },
  { id: 'security', name: 'Security', glyph: '⛨', hue: 140, blurb: 'Hashes, encryption, 2FA and password checks' },
  { id: 'web', name: 'Web & SEO', glyph: '⌘', hue: 220, blurb: 'Meta tags, sitemaps, redirects and share links' },
  { id: 'fun', name: 'Fun', glyph: '☺', hue: 12, blurb: 'Dice, coins, teams and party games' },
];

export const TOOLS: ToolDef[] = [...textTools, ...devTools, ...convertTools, ...calcTools, ...generateTools, ...colorTools, ...timeTools, ...securityTools, ...webFunTools];

const BY_ID = new Map(TOOLS.map((t) => [t.id, t]));
export const toolById = (id: string): ToolDef | undefined => BY_ID.get(id);
export const categoryOf = (t: ToolDef): Category => CATEGORIES.find((c) => c.id === t.cat)!;

/** The value each field starts with. */
export function defaultsFor(t: ToolDef): Values {
  const v: Values = {};
  for (const f of t.fields) {
    v[f.id] = f.kind === 'toggle' ? Boolean(f.default) : f.kind === 'number' || f.kind === 'range' ? f.default ?? 0 : f.kind === 'select' ? f.default ?? (typeof f.options[0] === 'string' ? f.options[0] : f.options[0]!.value) : f.kind === 'color' ? f.default ?? '#4f7cff' : f.default ?? '';
  }
  return v;
}

/** Runs a tool; a thrown error becomes an error result, so the screen never crashes. */
export async function runTool(t: ToolDef, values: Values): Promise<Out> {
  try {
    return await t.run({ ...defaultsFor(t), ...values });
  } catch (e) {
    return { kind: 'error', message: (e as Error).message || 'Something went wrong.' };
  }
}

/** Search by name, id, blurb, category and keywords; names starting with the query come first. */
export function searchTools(q: string, cat?: string): ToolDef[] {
  const s = q.toLowerCase().trim();
  const words = s.split(/\s+/).filter(Boolean);
  const pool = cat && cat !== 'all' ? TOOLS.filter((t) => t.cat === cat) : TOOLS;
  if (!words.length) return pool;
  return pool
    .map((t) => {
      const hay = `${t.name} ${t.id.replace(/-/g, ' ')} ${t.blurb} ${t.cat} ${(t.keywords ?? []).join(' ')}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      return { t, score: (t.name.toLowerCase().startsWith(s) ? 4 : 0) + (t.name.toLowerCase().includes(s) ? 2 : 0) + (t.id.includes(s.replace(/\s+/g, '-')) ? 1 : 0) };
    })
    .filter((x): x is { t: ToolDef; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t);
}

/** A plain-text rendering of a result, for copying and for the chat. */
export function outToText(o: Out): string {
  switch (o.kind) {
    case 'text': return o.text;
    case 'list': return o.items.join('\n');
    case 'table': return [o.head.join('\t'), ...o.rows.map((r) => r.join('\t'))].join('\n');
    case 'stats': return o.items.map((i) => `${i.label}: ${i.value}`).join('\n');
    case 'swatches': return o.items.map((i) => (i.label ? `${i.hex} ${i.label}` : i.hex)).join('\n');
    case 'svg': return o.svg;
    case 'bars': return o.items.map((i) => `${i.label}: ${i.value}`).join('\n');
    case 'calendar': return `${o.year}-${String(o.month + 1).padStart(2, '0')}`;
    case 'diff': return o.rows.map((r) => `${r.t} ${r.s}`).join('\n');
    case 'css': return o.css;
    case 'multi': return o.parts.map((p) => (p.title ? `# ${p.title}\n` : '') + outToText(p.out)).join('\n\n');
    case 'error': return o.message;
  }
}
