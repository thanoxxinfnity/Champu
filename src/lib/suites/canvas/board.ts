/**
 * Design Canvas: a board of device-sized screens (app or website), each one a single self-contained HTML file.
 *
 * This module is the pure part — prompts, parsing the model's reply, layout and the export. The board is a place to
 * design and to take the result away: it does not touch a project, a repo or GitHub. The user imports the export
 * into their own app or site themselves.
 */
import type { ZipEntry } from '../../zip.ts';

export type Device = 'phone' | 'tablet' | 'desktop';

export const DEVICES: Record<Device, { label: string; w: number; h: number }> = {
  phone: { label: 'Phone', w: 390, h: 844 },
  tablet: { label: 'Tablet', w: 820, h: 1180 },
  desktop: { label: 'Desktop', w: 1280, h: 800 },
};

export interface CanvasScreen {
  id: string;
  name: string;
  device: Device;
  html: string;
  /** Position on the board, in board pixels. */
  x: number;
  y: number;
  /** What the user asked for, kept so a revision knows the intent. */
  brief: string;
}

export interface CanvasBoard {
  title: string;
  /** Open Design system id the screens were designed against, if one was picked. */
  system?: string;
  screens: CanvasScreen[];
}

export const EMPTY_BOARD: CanvasBoard = { title: 'My design', screens: [] };

const GAP = 80;

export function newId(): string {
  return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Where the next screen goes: right of the rightmost one on the same row, or the origin when the board is empty. */
export function nextSlot(screens: CanvasScreen[], device: Device): { x: number; y: number } {
  if (!screens.length) return { x: 0, y: 0 };
  let right = 0;
  for (const s of screens) right = Math.max(right, s.x + DEVICES[s.device].w);
  return { x: right + GAP, y: 0 };
}

/** The reply may be fenced, chatty or both; what is wanted is the document. */
export function extractHtml(reply: string): string | null {
  const text = (reply ?? '').replace(/<\|[^|>]*\|>/g, '').trim();
  const fenced = /```(?:html|htm)?\s*\n([\s\S]*?)```/i.exec(text);
  let body = fenced ? fenced[1] : text;
  const start = body.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return null;
  body = body.slice(start);
  const end = body.search(/<\/html\s*>/i);
  if (end >= 0) body = body.slice(0, end + body.slice(end).indexOf('>') + 1);
  body = body.trim();
  return /<body[\s>]/i.test(body) ? body : null;
}

export function slug(name: string, taken: Set<string> = new Set()): string {
  const base = (name || 'screen').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'screen';
  let out = base;
  for (let i = 2; taken.has(out); i++) out = `${base}-${i}`;
  taken.add(out);
  return out;
}

const RULES = `You design one screen as a single self-contained HTML file.
- Output only the HTML document, starting with <!doctype html>. No explanation before or after.
- Inline <style>, no external CSS, fonts, scripts or images (no network). Draw icons as inline SVG, never emoji.
- Put every colour, font, radius and spacing value in :root as a CSS variable (--bg, --surface, --ink, --muted, --accent, --radius, --space-1…) and use only those variables below it.
- Set <meta name="viewport" content="width=device-width,initial-scale=1"> and make the layout fill the frame it is given, with no horizontal scroll.
- Real, specific copy and plausible data. No lorem ipsum, no "Item 1".
- Every interactive element is a real <button> or <a> with a visible hover/focus state; tap targets at least 44px on phone.
- Add a short HTML comment right after <body> naming the screen and its main sections, so a developer can map it to components.`;

export function systemPrompt(opts: { designContext?: string }): string {
  return opts.designContext ? `${RULES}\n\n${opts.designContext}` : RULES;
}

export function newScreenPrompt(opts: { name: string; device: Device; brief: string; siblings: CanvasScreen[] }): string {
  const d = DEVICES[opts.device];
  const others = opts.siblings.length
    ? `\nScreens already on the board (stay consistent with their look, reuse their :root variables):\n${opts.siblings
        .slice(-4)
        .map((s) => `- ${s.name} (${s.device})${rootVars(s.html) ? `: ${rootVars(s.html).slice(0, 360)}` : ''}`)
        .join('\n')}\n`
    : '';
  return `Design the screen "${opts.name}" for a ${d.label.toLowerCase()} frame of ${d.w}×${d.h}px.\n${others}\nBrief: ${opts.brief}`;
}

export function revisePrompt(screen: CanvasScreen, change: string): string {
  return `Here is the current HTML of the screen "${screen.name}" (${screen.device}, ${DEVICES[screen.device].w}×${DEVICES[screen.device].h}px).\n\nChange requested: ${change}\n\nReturn the complete updated HTML document, keeping everything that was not asked to change.\n\n${screen.html}`;
}

/** The text inside the first :root { … } block, collapsed. */
export function rootVars(html: string): string {
  const m = /:root\s*\{([^}]*)\}/i.exec(html);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/** Union of the custom properties across screens; a later screen only adds what an earlier one lacks. */
export function collectTokens(screens: CanvasScreen[]): Array<{ name: string; value: string }> {
  const seen = new Map<string, string>();
  for (const s of screens) {
    const block = /:root\s*\{([^}]*)\}/i.exec(s.html);
    if (!block) continue;
    for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) if (!seen.has(m[1])) seen.set(m[1], m[2].trim());
  }
  return [...seen].map(([name, value]) => ({ name, value }));
}

export function tokensCss(screens: CanvasScreen[]): string {
  const t = collectTokens(screens);
  return `/* Design tokens collected from the screens. Paste into your global stylesheet. */\n:root {\n${t.map((x) => `  ${x.name}: ${x.value};`).join('\n')}\n}\n`;
}

export function tokensJson(screens: CanvasScreen[]): string {
  const o: Record<string, string> = {};
  for (const t of collectTokens(screens)) o[t.name.replace(/^--/, '')] = t.value;
  return `${JSON.stringify(o, null, 2)}\n`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One page that shows every screen side by side, for a quick look or to send to someone. */
export function overviewHtml(board: CanvasBoard, files: Map<string, string>): string {
  const frames = board.screens
    .map((s) => {
      const d = DEVICES[s.device];
      return `<figure><figcaption>${esc(s.name)} <span>${d.label} ${d.w}×${d.h}</span></figcaption><iframe src="${esc(files.get(s.id) ?? '')}" width="${d.w}" height="${d.h}" loading="lazy"></iframe></figure>`;
    })
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(board.title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:32px;background:#16181d;color:#e8eaee;font:14px/1.4 system-ui,sans-serif}h1{font-size:18px;margin:0 0 24px}main{display:flex;gap:32px;align-items:flex-start;overflow-x:auto;padding-bottom:24px}figure{margin:0;flex:none}figcaption{margin-bottom:8px;font-weight:600}figcaption span{font-weight:400;opacity:.6;margin-left:6px}iframe{border:0;border-radius:14px;background:#fff;display:block}</style></head><body><h1>${esc(board.title)}</h1><main>\n${frames}\n</main></body></html>`;
}

export function readme(board: CanvasBoard, files: Map<string, string>): string {
  const list = board.screens.map((s) => `- \`${files.get(s.id)}\` — ${s.name} (${DEVICES[s.device].label})`).join('\n');
  return `# ${board.title}

Exported from the Chomugiri Design Canvas. Nothing here was added to any project: take what you want.

## Files
- \`index.html\` — every screen side by side. Open it in a browser.
${list}
- \`tokens.css\` / \`tokens.json\` — colours, type and spacing collected from the screens.

## Using it in your own app or website
1. Open \`index.html\` and look through the screens.
2. Paste \`tokens.css\` into your global stylesheet (or map \`tokens.json\` into your theme).
3. Rebuild each screen as components in your project. Each HTML file starts with a comment that lists the screen's sections, and every value is a variable from \`tokens.css\`.
4. Icons are inline SVG; copy them or swap in your icon set.
`;
}

/** Everything that goes into the zip. Pure: the caller does the download. */
export function exportEntries(board: CanvasBoard): ZipEntry[] {
  const taken = new Set<string>();
  const files = new Map<string, string>();
  const entries: ZipEntry[] = [];
  for (const s of board.screens) {
    const path = `screens/${slug(s.name, taken)}.html`;
    files.set(s.id, path);
    entries.push({ path, content: s.html });
  }
  entries.push({ path: 'index.html', content: overviewHtml(board, files) });
  entries.push({ path: 'tokens.css', content: tokensCss(board.screens) });
  entries.push({ path: 'tokens.json', content: tokensJson(board.screens) });
  entries.push({ path: 'README.md', content: readme(board, files) });
  return entries;
}
