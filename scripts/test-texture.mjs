/** node --experimental-strip-types --test scripts/test-texture.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { plannedTextures, subjectFromKey, textureArtifact, texturePrompt } from '../src/lib/suites/minecraft/texture.ts';
import { detectPacks } from '../src/lib/suites/minecraft/pack.ts';

const f = (path, content = '{}') => ({ kind: 'file', path, language: 'json', content, complete: true, bytes: content.length });
const rpManifest = JSON.stringify({ format_version: 2, header: { name: 'RP', uuid: 'aaaaaaaa-1111-4222-8333-444444444444', version: [1, 0, 0] }, modules: [{ type: 'resources', uuid: 'bbbbbbbb-1111-4222-8333-444444444444' }] });

test('an identifier becomes something promptable', () => {
  assert.equal(subjectFromKey('chomu:ruby_sword'), 'ruby sword');
  assert.equal(subjectFromKey('textures/items/fire_gem.png'), 'textures items fire gem');
});

test('item textures are planned from item_texture.json', () => {
  const map = JSON.stringify({ texture_data: { ruby: { textures: 'textures/items/ruby' } } });
  const packs = detectPacks([f('rp/manifest.json', rpManifest), f('rp/textures/item_texture.json', map)]);
  const planned = plannedTextures(packs);
  assert.equal(planned.length, 1);
  // The extension is added, and the path is rooted in the resource pack.
  assert.equal(planned[0].path, 'rp/textures/items/ruby.png');
  assert.equal(planned[0].size, 16, 'items are 16px');
  assert.equal(planned[0].kind, 'item');
});

test('a texture that is already in the pack is not planned again', () => {
  const map = JSON.stringify({ texture_data: { ruby: { textures: 'textures/items/ruby' } } });
  const packs = detectPacks([
    f('rp/manifest.json', rpManifest),
    f('rp/textures/item_texture.json', map),
    f('rp/textures/items/ruby.png', 'data:image/png;base64,AAAA'),
  ]);
  assert.deepEqual(plannedTextures(packs), []);
});

test('entity textures are planned, and get more room than an item', () => {
  const entity = JSON.stringify({
    'minecraft:client_entity': { description: { identifier: 'chomu:emberling', textures: { default: 'textures/entity/emberling' } } },
  });
  const packs = detectPacks([f('rp/manifest.json', rpManifest), f('rp/entity/emberling.entity.json', entity)]);
  const planned = plannedTextures(packs);
  assert.equal(planned[0].path, 'rp/textures/entity/emberling.png');
  assert.equal(planned[0].size, 64, 'an entity sheet needs more than 16px');
  assert.equal(planned[0].subject, 'emberling');
});

test('block textures come from terrain_texture.json', () => {
  const map = JSON.stringify({ texture_data: { ruby_ore: { textures: ['textures/blocks/ruby_ore'] } } });
  const packs = detectPacks([f('rp/manifest.json', rpManifest), f('rp/textures/terrain_texture.json', map)]);
  assert.equal(plannedTextures(packs)[0].kind, 'block');
});

test('the same texture referenced twice is planned once', () => {
  const map = JSON.stringify({ texture_data: { a: { textures: 'textures/items/x' }, b: { textures: 'textures/items/x' } } });
  const packs = detectPacks([f('rp/manifest.json', rpManifest), f('rp/textures/item_texture.json', map)]);
  assert.equal(plannedTextures(packs).length, 1);
});

test('a broken texture map does not throw, it just plans nothing', () => {
  const packs = detectPacks([f('rp/manifest.json', rpManifest), f('rp/textures/item_texture.json', '{ broken')]);
  assert.deepEqual(plannedTextures(packs), []);
});

test('the prompt asks for pixel art, not a painting', () => {
  const p = texturePrompt({ path: 'x.png', subject: 'ruby sword', size: 16, kind: 'item' });
  assert.ok(/pixel art/i.test(p), p);
  assert.ok(/16x16/.test(p), p);
  assert.ok(/transparent background/i.test(p), p);
  // A background scene would make the item unreadable at 16px.
  assert.ok(/no background scenery/i.test(p), p);
});

test('a generated texture is a normal file artifact the pipeline understands', () => {
  const a = textureArtifact('rp/textures/items/ruby.png', 'data:image/png;base64,AAAAAAAA');
  assert.equal(a.path, 'rp/textures/items/ruby.png');
  assert.equal(a.language, 'png');
  assert.ok(a.complete);
  assert.ok(a.bytes > 0);
});
