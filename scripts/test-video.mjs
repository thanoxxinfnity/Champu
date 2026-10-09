/** node --experimental-strip-types --test scripts/test-video.mjs */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { videoEngine, videoSize, wantsCodeVideo } from '../src/lib/suites/video/detect.ts';
import { videoKitFor, renderCommands, localGsap, hasComposition, HYPERFRAMES_VERSION } from '../src/lib/suites/video/kit.ts';
import { videoContext, pickVideoGuides } from '../src/lib/suites/video/context.ts';

const root = new URL('../public/video/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', root), 'utf8'));
const io = {
  text: async (p) => (existsSync(new URL(p, root)) ? readFileSync(new URL(p, root), 'utf8') : null),
  json: async (p) => (existsSync(new URL(p, root)) ? JSON.parse(readFileSync(new URL(p, root), 'utf8')) : null),
};

test('a request for a film is a video, in English and Hinglish', () => {
  for (const t of ['make a 15 second promo video for my chai shop', 'Ek reel banao mere bakery ke liye', 'create an explainer video about solar panels', 'remotion se ek trailer banao', 'ek video banao jisme mera logo animate ho', '30 second intro video chahiye']) assert.equal(wantsCodeVideo(t), true, t);
});

test('the word video in something else is not a request to render one', () => {
  for (const t of ['make a video game with zombies', 'build a video player app for android', 'download this youtube video', 'make a landing page with a video background', 'add a <video> tag to my page', 'write a video call app with webrtc', 'what is a video codec?']) assert.equal(wantsCodeVideo(t), false, t);
});

test('HyperFrames is the default; Remotion only when asked for by name', () => {
  assert.equal(videoEngine('make a promo video'), 'hyperframes');
  assert.equal(videoEngine('make a promo video with remotion'), 'remotion');
  assert.equal(videoEngine('react video for my startup'), 'remotion');
});

test('a reel is vertical, a promo is widescreen', () => {
  assert.deepEqual(videoSize('make an instagram reel'), { width: 1080, height: 1920, vertical: true });
  assert.deepEqual(videoSize('make a promo video'), { width: 1920, height: 1080, vertical: false });
});

test('the kit supplies the package files around the composition, replacing any the model wrote', () => {
  const hf = videoKitFor('hyperframes', [{ path: 'video/index.html' }]).map((k) => k.path).sort();
  assert.deepEqual(hf, ['video/hyperframes.json', 'video/meta.json', 'video/package.json']);
  assert.equal(videoKitFor('hyperframes', [{ path: 'video/index.html' }, { path: 'video/package.json' }]).some((k) => k.path === 'video/package.json'), true);
  assert.equal(hasComposition('remotion', [{ path: 'video/src/Root.tsx' }]), true);
  assert.equal(hasComposition('remotion', [{ path: 'video/package.json' }]), false);
  assert.equal(hasComposition('hyperframes', [{ path: 'video/index.html' }]), true);
  const rm = videoKitFor('remotion', [{ path: 'clip/src/Root.tsx' }]).map((k) => k.path).sort();
  assert.deepEqual(rm, ['clip/package.json', 'clip/src/index.ts', 'clip/tsconfig.json']);
  assert.deepEqual(videoKitFor('hyperframes', [{ path: 'notes.md' }]), []);
});

test('the render commands are the tested ones, pinned', () => {
  const cmds = renderCommands('hyperframes');
  assert.equal(cmds.length, 1);
  assert.match(cmds[0], new RegExp(`hyperframes@${HYPERFRAMES_VERSION} render --output renders\\/video\\.mp4`));
  assert.match(renderCommands('remotion')[1], /remotion render src\/index\.ts Main/);
});

test('the guidance pack is complete and the right guides are chosen', async () => {
  for (const it of index.items) assert.ok(existsSync(new URL(`${it.engine}/${it.id}.md`, root)), it.id);
  assert.ok(pickVideoGuides('promo with a smooth zoom and background music', index, 'hyperframes').some((g) => g === 'keyframes' || g === 'audio'));
  assert.ok(pickVideoGuides('video with captions and transitions', index, 'remotion').includes('transitions'));
});

test('the context carries the recipe, the contract and a bound', async () => {
  const ctx = await videoContext('make a 20 second promo video for a chai shop', io);
  assert.equal(ctx.engine, 'hyperframes');
  assert.match(ctx.text, /VIDEO — a real MP4/);
  assert.match(ctx.text, /data-composition-id/);
  assert.match(ctx.text, /npx --yes hyperframes@/);
  assert.match(ctx.text, /src="gsap\.min\.js"/);
  assert.ok(ctx.text.length < 45_000, String(ctx.text.length));
  assert.match(ctx.summary, /HyperFrames/);
  const r = await videoContext('make a trailer with remotion', io);
  assert.match(r.text, /remotion\.dev\/license/);
});

import { looksDegenerate } from '../src/lib/agent/artifacts.ts';

test('a reply full of leaked control tokens, or of path-less scraps, is recognised as noise', () => {
  assert.equal(looksDegenerate('Creating the file.\n\n<|close|> ,<|close|>\nitem\n<|close|>emos'), true);
  const scraps = Array.from({ length: 20 }, (_, i) => '```\nscrap ' + i + '\n```\n').join('\n') + 'x'.repeat(500);
  assert.equal(looksDegenerate(scraps), true);
  assert.equal(looksDegenerate('Creating `video/index.html`.\n\n```html path=video/index.html\n<html></html>\n```\n'), false);
});

test('GSAP is shipped beside the composition and a CDN link is pointed at it', () => {
  const k = videoKitFor('hyperframes', [{ path: 'video/index.html' }], { gsap: '/* gsap */' });
  assert.ok(k.some((f) => f.path === 'video/gsap.min.js' && f.content === '/* gsap */'));
  assert.equal(localGsap('<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>'), '<script src="gsap.min.js"></script>');
  assert.equal(localGsap('<script src="gsap.min.js"></script>'), '<script src="gsap.min.js"></script>');
  assert.ok(existsSync(new URL('gsap.min.js', root)));
});

import { chipifyHtml } from '../src/lib/sites/domains.ts';

test('a link to the bridge (an address, not a website) does not get a site logo', () => {
  const html = '<a href="http://127.0.0.1:7717/v1/artifact/video.mp4">video.mp4</a>';
  assert.equal(chipifyHtml(html), html);
  assert.match(chipifyHtml('<a href="https://github.com/a/b">repo</a>'), /site-chip/);
});

import { extractArtifacts, commandsOf } from '../src/lib/agent/artifacts.ts';

test('a stray backtick around a command is not part of the command', () => {
  const cmds = commandsOf(extractArtifacts('```bash path=@terminal cwd=.\n`cd video && npm install\n```\n'));
  assert.equal(cmds[0].command, 'cd video && npm install');
  assert.equal(commandsOf(extractArtifacts('```bash path=@terminal\necho `date`\n```\n'))[0].command, 'echo `date`');
});
