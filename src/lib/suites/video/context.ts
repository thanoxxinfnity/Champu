/**
 * What the model is told when it is asked for a video: the recipe that was tested, and the framework guidance that fits the request.
 * The guidance is read from public/video/ (HyperFrames and Remotion's own skills); the recipe is ours.
 */
import type { OdIo } from '../../skills/opendesign/types.ts';
import { videoEngine, videoSize, type VideoEngine } from './detect.ts';
import { HYPERFRAMES_VERSION, REMOTION_VERSION, renderCommands } from './kit.ts';

interface VideoItem { engine: VideoEngine; id: string; title: string; keywords: string[]; bytes: number }
export interface VideoIndex { sources: Record<string, { repo: string; commit: string; license: string }>; items: VideoItem[] }

const BASE: Record<VideoEngine, string[]> = {
  hyperframes: ['core', 'minimal-composition', 'determinism-rules', 'animation'],
  remotion: ['markup', 'compositions'],
};
// Remotion's guidance is long and a hosted model degraded on it (garbled output twice in a row), so it gets a smaller share.
const BUDGET = { first: 9000, rest: 5000, total: 30000 };
const REMOTION_BUDGET = { first: 6000, rest: 3000, total: 17000 };

const clip = (t: string, max: number): string => {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf('\n'), max * 0.8))}\n…(trimmed)`;
};

export function pickVideoGuides(request: string, index: VideoIndex, engine: VideoEngine): string[] {
  const text = request.toLowerCase();
  const ids = [...BASE[engine]];
  const extra: Array<{ id: string; hits: number }> = [];
  for (const it of index.items) {
    if (it.engine !== engine || ids.includes(it.id) || !it.keywords.length) continue;
    // Three caption guides share one set of keywords: the display one is enough unless the request is about importing or transcribing.
    if (it.id === 'captions-import-srt' && !/\bsrt\b/.test(text)) continue;
    if (it.id === 'captions-transcribe' && !/\b(transcribe|transcription|speech to text|whisper)\b/.test(text)) continue;
    const hits = it.keywords.filter((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(text)).length;
    if (hits) extra.push({ id: it.id, hits });
  }
  extra.sort((a, b) => b.hits - a.hits);
  return [...ids, ...extra.slice(0, 3).map((e) => e.id)];
}

export function videoRecipe(engine: VideoEngine, request: string): string {
  const { width, height, vertical } = videoSize(request);
  const cmds = renderCommands(engine).map((c) => `\`\`\`bash path=@terminal cwd=.\n${c}\n\`\`\``).join('\n');
  const common = `## VIDEO — a real MP4, made from code and rendered on the user's own machine
You are making a finished video, not describing one. It is rendered by the bridge, so nothing is limited, metered or paid for: no account, no key, no per-video cost. Engine: **${engine === 'hyperframes' ? `HyperFrames (HTML + GSAP, Apache-2.0, v${HYPERFRAMES_VERSION})` : `Remotion (React, v${REMOTION_VERSION}; its licence is free for individuals and small teams, paid for larger companies, see remotion.dev/license — say this in one line)`}**.
Frame: ${width}×${height}${vertical ? ' (vertical, for Reels / Shorts / TikTok)' : ''}. Length: ${vertical ? '12–25' : '12–30'} seconds unless asked otherwise.

### How the work goes
1. One line on the concept (hook → 3–5 scenes → closing line) and the look (palette, type, motion style). Then the files. Then the terminal block that renders it:
${cmds}
2. If a command fails, the error comes back to you: fix the file it names (write the whole file again) and run the failed command again. A render that was refused for a network reason (the package server, the browser download) is retried with \`sleep 30 &&\` in front, files untouched.
3. When the render finishes the MP4 is collected and played in the chat. Say where it is and how long it is, and what you would change next.

### What makes it look made, not generated
- A written concept before pixels: a hook in the first 2 seconds, one idea per scene, a closing line. Real copy in the user's language (Hinglish stays Hinglish). No lorem ipsum, no "Your text here".
- One type scale (title ≥ ${vertical ? '96' : '84'}px, body ≥ ${vertical ? '48' : '40'}px at this frame size), one palette of 3–5 colours with a real contrast, safe margins of ${vertical ? '90' : '120'}px so nothing sits at the edge.
- Motion with intent: stagger entrances, ease-out on arrival and ease-in on exit, one scene-to-scene transition style used throughout, something always moving slowly under the text (a drifting gradient, a slow zoom, floating shapes). Never a still frame for more than 1.5 seconds.
- Icons and illustrations are drawn inline SVG or CSS shapes. No emoji, no external images unless the user attached them. Fonts: system fonts, or a Google Fonts \`<link>\`.
- The video is silent unless the user asks for sound and has given you a file: say so in one line instead of promising music you cannot source.`;

  const hf = `
### HyperFrames, in short (the contract is in the reference below; follow it)
- Write \`video/index.html\` (and, for long films, scenes in \`video/compositions/*.html\`). The app adds \`package.json\`, \`hyperframes.json\` and \`meta.json\` if you do not.
- Root: \`<div id="root" data-composition-id="main" data-start="0" data-duration="N" data-width="${width}" data-height="${height}">\`. Every timed element has \`data-start\` and \`data-duration\` (seconds); the \`<meta name="viewport" content="width=${width}, height=${height}">\` matches.
- One \`gsap.timeline({ paused: true })\`, registered last as \`window.__timelines["main"] = tl\`. GSAP is loaded with \`<script src="gsap.min.js"></script>\` — the app puts that file beside your composition (never a CDN link).
- Seek-safe: no \`Date.now\`, no unseeded \`Math.random\`, no \`setInterval\`/\`requestAnimationFrame\`, no CSS animations or hover states. Everything moves through the one timeline.`;
  const rm = `
### Remotion, in short (the rules are in the reference below; follow them)
- Write \`video/src/Root.tsx\` registering \`<Composition id="Main" … width={${width}} height={${height}} fps={30} durationInFrames={…} />\`, and the scenes in \`video/src/*.tsx\`. The app adds \`package.json\`, \`tsconfig.json\` and \`src/index.ts\` if you do not.
- \`Root.tsx\` has \`export const Root\` (the app's \`src/index.ts\` registers it). \`interpolate\` takes and returns numbers only: to animate a CSS string, interpolate a number and build the string from it. Animate only from \`useCurrentFrame()\` with \`interpolate\`/\`spring\`; sequence scenes with \`<Sequence>\` or \`<TransitionSeries>\`. No CSS transitions, no timers, no \`Math.random\`.
- If the render says no browser was found, run it again with \`--browser-executable=$(command -v chromium || command -v chromium-browser || command -v google-chrome)\` added.`;
  return `${common}\n${engine === 'hyperframes' ? hf : rm}`;
}

export interface VideoContext { text: string; summary: string; engine: VideoEngine; guides: string[] }

export async function videoContext(request: string, io: OdIo): Promise<VideoContext> {
  const engine = videoEngine(request);
  const recipe = videoRecipe(engine, request);
  const index = await io.json<VideoIndex>('index.json');
  const parts: string[] = [recipe];
  const guides: string[] = [];
  if (index) {
    let used = recipe.length;
    for (const [i, id] of pickVideoGuides(request, index, engine).entries()) {
      const md = await io.text(`${engine}/${id}.md`);
      if (!md) continue;
      const b = engine === 'remotion' ? REMOTION_BUDGET : BUDGET;
      const piece = clip(md, i === 0 ? b.first : b.rest);
      if (used + piece.length > b.total) break;
      used += piece.length;
      guides.push(id);
      parts.push(`### Reference: ${id} (${engine === 'hyperframes' ? 'heygen-com/hyperframes' : 'remotion-dev/skills'})\n${piece}`);
    }
  }
  const name = engine === 'hyperframes' ? 'HyperFrames' : 'Remotion';
  return { text: parts.join('\n\n'), summary: `::video:: Making a real video with ${name} — rendered on your bridge, no limits.`, engine, guides };
}
