#!/usr/bin/env node
/**
 * Builds public/motion/: motion-design guidance for animated websites, taken from two open-source video frameworks' own skills.
 *   node scripts/vendor-motion-guides.mjs <remotion-dev/skills clone> <heygen-com/hyperframes clone>
 *
 * Only the principles are wanted (easing, stagger, text effects, scene-to-scene transitions, zoom and camera moves, spring timing),
 * written for video but true of a page that moves. Each file is handed to the model with a line saying to adapt it to CSS / GSAP
 * on the web; nothing here renders video.
 *   - HyperFrames (https://github.com/heygen-com/hyperframes, Apache-2.0): animation, keyframes
 *   - Remotion skills (https://github.com/remotion-dev/skills): timing, transitions
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [remotion, hyper] = process.argv.slice(2);
if (!hyper) { console.error('usage: node scripts/vendor-motion-guides.mjs <remotion skills clone> <hyperframes clone>'); process.exit(1); }
const out = 'public/motion';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const commit = (d) => execFileSync('git', ['-C', d, 'rev-parse', 'HEAD']).toString().trim();
const strip = (raw) => raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
const MAX = 14_000;
const clip = (t) => (t.length > MAX ? `${t.slice(0, MAX)}\n\n…(trimmed)` : t);

const guides = [
  { id: 'animation', from: path.join(hyper, 'skills/hyperframes-animation/SKILL.md'), source: 'hyperframes', title: 'motion rules, text effects and scene blueprints (GSAP)', keywords: ['animation', 'animate', 'motion', 'text', 'hero', 'reveal', 'stagger', 'gsap', 'typewriter', 'kinetic'] },
  { id: 'keyframes', from: path.join(hyper, 'skills/hyperframes-keyframes/SKILL.md'), source: 'hyperframes', title: 'zoom, camera moves, paths and keyframes', keywords: ['zoom', 'parallax', 'camera', 'ken burns', 'pan', 'keyframe', 'path', 'svg', 'morph', '3d'] },
  { id: 'transitions', from: path.join(remotion, 'skills/remotion-markup/transitions.md'), source: 'remotion', title: 'scene-to-scene transitions', keywords: ['transition', 'page transition', 'wipe', 'slide', 'crossfade', 'section'] },
  { id: 'timing', from: path.join(remotion, 'skills/remotion-markup/timing.md'), source: 'remotion', title: 'timing, easing and springs', keywords: ['timing', 'easing', 'ease', 'spring', 'smooth', 'bounce'] },
];
const items = guides.map((g) => {
  const body = strip(readFileSync(g.from, 'utf8'));
  writeFileSync(path.join(out, `${g.id}.md`), clip(body));
  return { id: g.id, source: g.source, title: g.title, keywords: g.keywords, bytes: Math.min(body.length, MAX) };
});
const index = {
  sources: {
    hyperframes: { repo: 'https://github.com/heygen-com/hyperframes', commit: commit(hyper), license: 'Apache-2.0' },
    remotion: { repo: 'https://github.com/remotion-dev/skills', commit: commit(remotion), license: 'see remotion.dev/license' },
  },
  items,
};
writeFileSync(path.join(out, 'index.json'), JSON.stringify(index));
writeFileSync(path.join(out, 'NOTICE.md'), `# Motion guidance\n\nPrinciples from the HyperFrames skills (${index.sources.hyperframes.repo} @ ${index.sources.hyperframes.commit.slice(0, 7)}, Apache-2.0) and the Remotion skills (${index.sources.remotion.repo} @ ${index.sources.remotion.commit.slice(0, 7)}), used as motion-design reference for websites. Guidance text only.\nRe-create with scripts/vendor-motion-guides.mjs.\n`);
console.log(items.length, 'guides', `${(items.reduce((n, i) => n + i.bytes, 0) / 1024).toFixed(0)} KB`);
