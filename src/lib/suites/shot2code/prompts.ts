import type { ChatMessage, ChatMessagePart } from '@/lib/providers/types';

/**
 * Screenshot → code: a vision model rebuilds a screenshot (or a mock-up, a photo of a sketch) as one runnable HTML file in the
 * chosen stack, then revises it from plain-language instructions. The stack rules and the replication brief follow
 * abi/screenshot-to-code (MIT, © 2023 Abi Raja); its tool-calling agent is replaced here by a single fenced HTML reply, which
 * every chat model in Chomugiri can give, and its image tools by placeholder images that are later swapped for Pollinations
 * pictures drawn from their alt text.
 */

export type Stack = 'html_tailwind' | 'html_css' | 'react_tailwind' | 'vue_tailwind' | 'bootstrap' | 'ionic_tailwind';

export const STACKS: Array<{ id: Stack; label: string }> = [
  { id: 'html_tailwind', label: 'HTML + Tailwind' },
  { id: 'html_css', label: 'HTML + CSS' },
  { id: 'react_tailwind', label: 'React + Tailwind' },
  { id: 'vue_tailwind', label: 'Vue + Tailwind' },
  { id: 'bootstrap', label: 'Bootstrap' },
  { id: 'ionic_tailwind', label: 'Ionic + Tailwind' },
];

const TAILWIND = '<script src="https://cdn.tailwindcss.com"></script>';

const STACK_RULES: Record<Stack, string> = {
  html_tailwind: `Use HTML and Tailwind. Include Tailwind with: ${TAILWIND}`,
  html_css: 'Use only HTML, CSS and JS. Do not use Tailwind.',
  react_tailwind: [
    'Use React with Tailwind, runnable as a standalone page. Include:',
    '<script src="https://cdn.jsdelivr.net/npm/react@18.0.0/umd/react.development.js"></script>',
    '<script src="https://cdn.jsdelivr.net/npm/react-dom@18.0.0/umd/react-dom.development.js"></script>',
    '<script src="https://unpkg.com/@babel/standalone@7.25.6/babel.min.js"></script>',
    TAILWIND,
    'Pin that exact Babel version (the unversioned URL is Babel 8, whose JSX runtime injects an import that breaks in the browser). Put the app in <script type="text/babel">.',
  ].join('\n'),
  vue_tailwind: [
    'Use Vue 3 (global build) with Tailwind. Include:',
    '<script src="https://registry.npmmirror.com/vue/3.3.11/files/dist/vue.global.js"></script>',
    TAILWIND,
    'Mount with `const { createApp, ref } = Vue; createApp({ setup() { ... } }).mount("#app")`.',
  ].join('\n'),
  bootstrap: 'Use Bootstrap 5. Include: <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">',
  ionic_tailwind: [
    'Use Ionic with Tailwind. Include:',
    '<script type="module" src="https://cdn.jsdelivr.net/npm/@ionic/core/dist/ionic/ionic.esm.js"></script>',
    '<script nomodule src="https://cdn.jsdelivr.net/npm/@ionic/core/dist/ionic/ionic.js"></script>',
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@ionic/core/css/ionic.bundle.css" />',
    TAILWIND,
    'Use ionicons for icons (<script type="module" src="https://cdn.jsdelivr.net/npm/ionicons/dist/ionicons/ionicons.esm.js"></script>).',
  ].join('\n'),
};

export const SYSTEM_PROMPT = `You are an expert front-end developer who turns screenshots of web pages and apps into code.

Output rules:
- Reply with ONE complete HTML document (from <!doctype html> to </html>) inside a single \`\`\`html fenced block, and nothing else of substance — at most one short sentence before it.
- Never leave anything out: no "<!-- repeat for other items -->", no "...", no "rest of the content". Write every element.
- Google Fonts and other public fonts are fine. Except for Ionic, use Font Awesome for icons: <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.3/css/all.min.css">
- For pictures, use https://placehold.co with the right size (for example https://placehold.co/600x400) and write a detailed description of the picture in its alt attribute; those placeholders are replaced by generated images later.
- Reply in the user's language for the one sentence; code comments in English.`;

export interface Shot {
  /** data: URL of the screenshot. */
  dataUrl: string;
  name?: string;
}

function imageParts(shots: Shot[]): ChatMessagePart[] {
  return shots.map((s) => ({ type: 'image_url' as const, image_url: { url: s.dataUrl } }));
}

/** The first request: rebuild these screenshots in this stack. */
export function createMessages(shots: Shot[], stack: Stack, extra = ''): ChatMessage[] {
  const brief = [
    'Generate code for a web page that looks exactly like the provided screenshot(s).',
    '',
    `Stack: ${STACK_RULES[stack]}`,
    '',
    'Replication instructions:',
    '- Make the page look exactly like the screenshot: layout, spacing, colours, font sizes, borders, shadows.',
    '- Use the exact text from the screenshot.',
    '- Repeat every repeated element (list rows, cards, menu items) as many times as the screenshot shows.',
    '- For mobile screenshots, leave out the device frame and the status / browser bars; build only the UI.',
    shots.length > 1
      ? '- Several screenshots: if they are pages of one site, make them sections or pages linked from a nav; if they are tabs of an app, connect them with its navigation; if unrelated, make a scaffold with "Screenshot 1", "Screenshot 2", … to switch between them.'
      : '',
    extra.trim() ? `\nAdditional instructions: ${extra.trim()}` : '',
  ].filter(Boolean).join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: [...imageParts(shots), { type: 'text', text: brief }] },
  ];
}

/** A revision: the current file and what to change (optionally scoped to one element picked in the preview). */
export function updateMessages(shots: Shot[], stack: Stack, code: string, instruction: string, selected = ''): ChatMessage[] {
  const scope = selected.trim()
    ? `\n\nThe change applies to this element, picked in the rendered preview (its live outerHTML, which may differ from the source: JSX className, Vue directives, classes injected by scripts). Find the code that renders it and change only that:\n${selected.trim().slice(0, 4000)}`
    : '';
  const text = [
    `Stack: ${STACK_RULES[stack]}`,
    '',
    'Here is the current code of the page:',
    '```html',
    code,
    '```',
    '',
    `Change it as follows: ${instruction.trim()}${scope}`,
    '',
    'Reply with the whole updated HTML document in one ```html block (every line, nothing elided).',
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: [...imageParts(shots.slice(0, 2)), { type: 'text', text }] },
  ];
}

/** The HTML document out of a model reply (fenced or bare, with chatter around it); a still-streaming reply gives what it has so far. */
export function extractCode(reply: string, partial = false): string | null {
  const text = (reply ?? '').replace(/<\|[^|>]*\|>/g, '');
  const fence = /```(?:html|htm|vue|jsx)?[^\n]*\n([\s\S]*?)(```|$)/i.exec(text);
  let body = fence ? fence[1] : text;
  const start = body.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return null;
  body = body.slice(start);
  const end = body.search(/<\/html\s*>/i);
  if (end >= 0) body = body.slice(0, end + body.slice(end).indexOf('>') + 1);
  else if (!partial) return null;
  return body.trim();
}

/** placehold.co images → Pollinations pictures drawn from the alt text, same size (free, no key). */
export function withGeneratedImages(html: string, seed = 7): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc\s*=\s*["'](https?:\/\/placehold\.co\/(\d+)(?:x(\d+))?[^"']*)["']/i.exec(tag);
    if (!src) return tag;
    const alt = /\salt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.trim() || 'abstract soft gradient';
    const w = Math.min(1280, Number(src[2]) || 600);
    const h = Math.min(1280, Number(src[3] ?? src[2]) || 400);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(alt.slice(0, 300))}?width=${w}&height=${h}&nologo=true&seed=${seed}`;
    return tag.replace(src[1], url);
  });
}

/** A short, safe file name for downloads. */
export function fileName(stack: Stack, title = 'screenshot'): string {
  const base = title.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'screenshot';
  return `${base}-${stack.replace('_', '-')}.html`;
}
