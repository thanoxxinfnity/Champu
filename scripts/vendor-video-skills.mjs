#!/usr/bin/env node
/**
 * Builds public/video/: the know-how for making real videos from code, from two open-source frameworks.
 *   node scripts/vendor-video-skills.mjs <remotion-dev/skills clone> <heygen-com/hyperframes clone>
 *
 * - Remotion (https://github.com/remotion-dev/skills): videos as React. Remotion's own licence is free for individuals and
 *   small companies and paid above that (see remotion.dev/license): the app says so when it picks Remotion.
 * - HyperFrames (https://github.com/heygen-com/hyperframes, Apache-2.0): videos as an HTML file with timing attributes,
 *   rendered by headless Chrome and FFmpeg. No per-use limit, no licence fee: the default.
 * Only the written guidance is taken (SKILL.md and the rule files); scripts, assets and sub-agent workflows are not.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [remotion, hyper] = process.argv.slice(2);
if (!hyper) { console.error('usage: node scripts/vendor-video-skills.mjs <remotion skills clone> <hyperframes clone>'); process.exit(1); }
const out = 'public/video';
rmSync(out, { recursive: true, force: true });
for (const d of ['remotion', 'hyperframes']) mkdirSync(path.join(out, d), { recursive: true });
const commit = (d) => execFileSync('git', ['-C', d, 'rev-parse', 'HEAD']).toString().trim();
const strip = (raw) => raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
const MAX = 16_000;
const clip = (t) => (t.length > MAX ? `${t.slice(0, MAX)}\n\n…(trimmed)` : t);

const items = [];
function add(engine, id, title, body, keywords) {
  writeFileSync(path.join(out, engine, `${id}.md`), clip(body));
  items.push({ engine, id, title, keywords, bytes: Math.min(body.length, MAX) });
}

// Remotion: the markup rules plus layout, tailwind, render and captions
const rm = path.join(remotion, 'skills');
add('remotion', 'markup', 'Remotion markup best practices', strip(readFileSync(path.join(rm, 'remotion-markup/SKILL.md'), 'utf8')), []);
const KW = {
  transitions: ['transition', 'crossfade', 'wipe', 'slide'], audio: ['audio', 'music', 'sound', 'volume'], voiceover: ['voiceover', 'narration', 'voice', 'tts', 'speech'],
  effects: ['effect', 'glow', 'blur', 'glitch'], 'light-leaks': ['light leak', 'cinematic', 'film'], gifs: ['gif'], '3d': ['3d', 'three'], lottie: ['lottie'],
  'multi-scene-video': ['scene', 'scenes', 'sequence'], sequencing: ['sequence', 'timeline', 'order'], timing: ['timing', 'ease', 'spring', 'animate'], 'timing-props': ['timing', 'duration'],
  'audio-visualization': ['waveform', 'visualizer', 'spectrum', 'equalizer'], 'text-highlights': ['highlight', 'text'], 'motion-blur': ['motion blur'], 'google-fonts': ['font', 'typography'],
  'local-fonts': ['font'], images: ['image', 'photo'], 'embedding-videos': ['clip', 'footage', 'embed'], 'video-editing': ['edit', 'trim', 'cut', 'clip'], 'calculate-metadata': ['duration', 'dynamic', 'length'],
  compositions: ['composition', 'resolution', 'portrait', 'vertical', 'reel', 'short', 'square'], parameters: ['props', 'parameters', 'zod', 'data'], sfx: ['sfx', 'sound effect'],
  'silence-detection': ['silence'], 'html-in-canvas': ['canvas'], 'measuring-text': ['text', 'fit'], cropping: ['crop'], 'connected-compositions': ['connected'],
};
for (const f of readdirSync(path.join(rm, 'remotion-markup')).filter((n) => n.endsWith('.md') && n !== 'SKILL.md').sort()) {
  const id = f.replace(/\.md$/, '');
  add('remotion', id, id.replace(/-/g, ' '), strip(readFileSync(path.join(rm, 'remotion-markup', f), 'utf8')), KW[id] ?? [id.replace(/-/g, ' ')]);
}
add('remotion', 'video-layout', 'video layout and text sizing', strip(readFileSync(path.join(rm, 'remotion-create/video-layout.md'), 'utf8')), ['layout', 'text size', 'safe area', 'vertical', 'portrait']);
add('remotion', 'tailwind', 'Tailwind in Remotion', strip(readFileSync(path.join(rm, 'remotion-create/tailwind.md'), 'utf8')), ['tailwind']);
for (const f of ['display-captions', 'import-srt-captions', 'transcribe-captions']) {
  add('remotion', `captions-${f.replace(/-captions$/, '')}`, f.replace(/-/g, ' '), strip(readFileSync(path.join(rm, 'remotion-captions', `${f}.md`), 'utf8')), ['caption', 'captions', 'subtitle', 'subtitles', 'srt']);
}
add('remotion', 'render', 'rendering', strip(readFileSync(path.join(rm, 'remotion-render/SKILL.md'), 'utf8')), ['render', 'transparent']);

// HyperFrames: the composition contract, motion, creative direction, audio, keyframes, the CLI
const hs = path.join(hyper, 'skills');
add('hyperframes', 'core', 'the composition contract', strip(readFileSync(path.join(hs, 'hyperframes-core/SKILL.md'), 'utf8')), []);
for (const f of ['data-attributes', 'determinism-rules', 'minimal-composition', 'tracks-and-clips', 'sub-compositions', 'composition-patterns', 'variables-and-media']) {
  const p = path.join(hs, 'hyperframes-core/references', `${f}.md`);
  if (existsSync(p)) add('hyperframes', f, f.replace(/-/g, ' '), strip(readFileSync(p, 'utf8')), f === 'sub-compositions' ? ['scene', 'scenes', 'sub'] : f === 'variables-and-media' ? ['variable', 'media', 'image', 'footage', 'clip'] : []);
}
add('hyperframes', 'animation', 'motion and animation', strip(readFileSync(path.join(hs, 'hyperframes-animation/SKILL.md'), 'utf8')), ['animation', 'animate', 'motion', 'text', 'transition']);
add('hyperframes', 'creative', 'creative direction', strip(readFileSync(path.join(hs, 'hyperframes-creative/SKILL.md'), 'utf8')), ['palette', 'typography', 'style', 'brand', 'design', 'narration']);
add('hyperframes', 'audio', 'mixing audio', strip(readFileSync(path.join(hs, 'hyperframes-audio/SKILL.md'), 'utf8')), ['audio', 'music', 'voiceover', 'fade', 'duck', 'sound']);
add('hyperframes', 'keyframes', 'zoom, camera moves and keyframes', strip(readFileSync(path.join(hs, 'hyperframes-keyframes/SKILL.md'), 'utf8')), ['zoom', 'ken burns', 'camera', 'punch', 'pan', 'keyframe']);
add('hyperframes', 'cli', 'the command line', strip(readFileSync(path.join(hs, 'hyperframes-cli/SKILL.md'), 'utf8')), ['render', 'check', 'lint', 'gif', 'webm', 'quality']);
add('hyperframes', 'slideshow', 'slideshow videos', strip(readFileSync(path.join(hs, 'slideshow/SKILL.md'), 'utf8')), ['slideshow', 'slides', 'photos', 'deck']);

const index = {
  sources: {
    remotion: { repo: 'https://github.com/remotion-dev/skills', commit: commit(remotion), license: 'see remotion.dev/license (free for individuals and small teams)' },
    hyperframes: { repo: 'https://github.com/heygen-com/hyperframes', commit: commit(hyper), license: 'Apache-2.0' },
  },
  items,
};
writeFileSync(path.join(out, 'index.json'), JSON.stringify(index));
writeFileSync(path.join(out, 'NOTICE.md'), `# Video know-how\n\n- Remotion skills: ${index.sources.remotion.repo} @ ${index.sources.remotion.commit.slice(0, 7)}\n- HyperFrames: ${index.sources.hyperframes.repo} @ ${index.sources.hyperframes.commit.slice(0, 7)} (Apache-2.0)\n\nGuidance text only. Re-create with scripts/vendor-video-skills.mjs.\n`);
console.log(items.length, 'files', `${(items.reduce((n, i) => n + i.bytes, 0) / 1024).toFixed(0)} KB`);
