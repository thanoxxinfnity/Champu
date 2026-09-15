/** node --experimental-strip-types --test scripts/test-textures.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RUNNER_THEMES,
  insistOnDetail,
  looksFlat,
  plannedTextures,
  seedFor,
  texturePrompt,
} from '../src/lib/suites/godot/textures.ts';

test('a tiling prompt forbids everything that would repeat visibly', () => {
  // A tiling texture with a lamp post in it repeats that lamp post every four
  // metres, which reads as a bug rather than as a style.
  const p = texturePrompt({ path: 'textures/road_0.jpg', subject: 'asphalt', kind: 'tiling', seed: 1 });
  const lower = p.toLowerCase();
  for (const forbidden of ['no perspective', 'no horizon', 'no objects', 'no text', 'no watermark']) {
    assert.ok(lower.includes(forbidden), `missing "${forbidden}" in: ${p}`);
  }
  assert.match(p, /[Ss]eamless tileable/);
});

test('a tiling prompt demands detail, because a flat one is unusable', () => {
  // "Even diffuse lighting, no shadows" on snow produced a flat white rectangle:
  // the stage rendered as a blank sheet with the geometry invisible on it.
  const p = texturePrompt({ path: 'textures/road_2.jpg', subject: 'packed snow', kind: 'tiling', seed: 1 });
  assert.match(p, /high surface detail|grain|contrast/);
});

test('the theme reaches the prompt, so two stages do not look the same', () => {
  const tex = { path: 'textures/road_1.jpg', subject: 'asphalt', kind: 'tiling', seed: 1 };
  const neon = texturePrompt(tex, RUNNER_THEMES[1]);
  const frost = texturePrompt(tex, RUNNER_THEMES[2]);
  assert.notEqual(neon, frost);
  assert.ok(neon.includes(RUNNER_THEMES[1].mood));
});

test('a flat texture is detected, and a detailed one is not', () => {
  // Measured against the real generations: the snow that rendered as a blank
  // sheet was 14 KB; every usable surface was over 60 KB at 1 MP.
  assert.equal(looksFlat(14_072), true, 'the snow that broke Frost Line');
  assert.equal(looksFlat(23_602), true);
  assert.equal(looksFlat(334_000), false);
  assert.equal(looksFlat(61_000), false);
  // The threshold is per megapixel, so halving the resolution halves the bar.
  assert.equal(looksFlat(20_000, 512, 512), false);
});

test('the retry prompt asks for more than the first one did', () => {
  const tex = { path: 'textures/road_2.jpg', subject: 'packed snow', kind: 'tiling', seed: 1 };
  const retry = insistOnDetail(tex, RUNNER_THEMES[2]);
  assert.ok(retry.length > texturePrompt(tex, RUNNER_THEMES[2]).length);
  assert.match(retry, /never smooth|never plain|macro/);
});

test('a seed is stable, so regenerating does not reshuffle every surface', () => {
  assert.equal(seedFor('textures/road_0.jpg'), seedFor('textures/road_0.jpg'));
  assert.notEqual(seedFor('textures/road_0.jpg'), seedFor('textures/road_1.jpg'));
  // NVIDIA rejects a seed at or above 2^32.
  for (const p of ['a', 'textures/road_0.jpg', 'x'.repeat(200)]) {
    assert.ok(seedFor(p) >= 0 && seedFor(p) < 2 ** 32);
  }
});

test('every stage gets its own ground and rail, and the props are shared', () => {
  // Five sets of coins is five times the wait and the download, for something
  // nobody looks at closely.
  const planned = plannedTextures(RUNNER_THEMES);
  const paths = planned.map((t) => t.path);
  for (let i = 0; i < RUNNER_THEMES.length; i += 1) {
    assert.ok(paths.includes(`textures/road_${i}.jpg`));
    assert.ok(paths.includes(`textures/rail_${i}.jpg`));
  }
  assert.equal(paths.filter((p) => p.includes('coin')).length, 1);
  assert.equal(new Set(paths).size, paths.length, 'no path is planned twice');
});

test('the character is textured too, because it is on screen the whole time', () => {
  const paths = plannedTextures(RUNNER_THEMES).map((t) => t.path);
  assert.ok(paths.includes('textures/hero_skin.jpg'));
  assert.ok(paths.includes('textures/hero_cloth.jpg'));
});
