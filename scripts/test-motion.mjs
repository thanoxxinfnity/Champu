/** node --experimental-strip-types --test scripts/test-motion.mjs */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { motionContext, pickMotionGuides, wantsMotion } from '../src/lib/suites/web/motion.ts';

const root = new URL('../public/motion/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', root), 'utf8'));
const io = {
  text: async (p) => (existsSync(new URL(p, root)) ? readFileSync(new URL(p, root), 'utf8') : null),
  json: async (p) => (existsSync(new URL(p, root)) ? JSON.parse(readFileSync(new URL(p, root), 'utf8')) : null),
};

test('a request that is about movement asks for the motion rules; a plain page does not', () => {
  assert.equal(wantsMotion('animated landing page with parallax and a smooth scroll reveal'), true);
  assert.equal(wantsMotion('hero ko animate karo, stagger text'), true);
  assert.equal(wantsMotion('a simple contact form with three fields'), false);
});

test('every guide in the index exists and the animation guide always comes first', () => {
  for (const it of index.items) assert.ok(existsSync(new URL(`${it.id}.md`, root)), it.id);
  assert.equal(pickMotionGuides('page with a fade transition between sections', index)[0], 'animation');
  assert.ok(pickMotionGuides('slide transition between pages', index).length <= 3);
});

test('the context tells the model to build it with web tools, not as a video', async () => {
  const c = await motionContext('animated hero with transitions', io);
  assert.ok(c);
  assert.match(c.text, /CSS transitions|GSAP/);
  assert.match(c.text, /prefers-reduced-motion/);
  assert.ok(c.text.length < 24000);
});

test('no video-generation feature is left in the source', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : [new URL(e.name, d)]));
  const files = walk(new URL('../src/', import.meta.url)).filter((u) => /\.(ts|tsx)$/.test(u.pathname));
  const hits = files.filter((u) => /renderCommands|videoKitFor|VideoOffer|HYPERFRAMES_VERSION|\/video\b.*hyperframes/i.test(readFileSync(u, 'utf8')));
  assert.deepEqual(hits.map((u) => u.pathname), []);
  assert.ok(!existsSync(new URL('../public/video/index.json', import.meta.url)));
});
