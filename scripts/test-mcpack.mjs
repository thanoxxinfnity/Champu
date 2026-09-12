/** node --experimental-strip-types --test scripts/test-mcpack.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPackExport, classifyManifest, describeExport, detectPacks, slugify } from '../src/lib/suites/minecraft/pack.ts';

const f = (path, content = '{}') => ({ kind: 'file', path, language: 'json', content, complete: true, bytes: content.length });

const bpManifest = JSON.stringify({ header: { name: 'Ruby Tools' }, modules: [{ type: 'data' }] });
const rpManifest = JSON.stringify({ header: { name: 'Ruby Tools' }, modules: [{ type: 'resources' }] });

test('a pack kind comes from its manifest modules', () => {
  assert.equal(classifyManifest(bpManifest, 'bp').kind, 'behavior');
  assert.equal(classifyManifest(rpManifest, 'rp').kind, 'resource');
  assert.equal(classifyManifest(bpManifest, 'bp').name, 'Ruby Tools');
});

test('an unparseable manifest still classifies from its folder', () => {
  assert.equal(classifyManifest('{ broken', 'behavior_pack').kind, 'behavior');
  assert.equal(classifyManifest('{ broken', 'RP').kind, 'resource');
  assert.equal(classifyManifest('{ broken', 'stuff').kind, 'unknown');
});

test('no manifest means there is no pack to export', () => {
  assert.deepEqual(detectPacks([f('src/index.ts'), f('readme.md')]), []);
  assert.equal(buildPackExport([], 'x'), null);
});

test('a two-pack add-on is found, and behaviour is listed first', () => {
  const packs = detectPacks([
    f('rp/manifest.json', rpManifest),
    f('rp/textures/item.png'),
    f('bp/manifest.json', bpManifest),
    f('bp/items/ruby.json'),
  ]);
  assert.equal(packs.length, 2);
  assert.deepEqual(packs.map((p) => p.kind), ['behavior', 'resource']);
});

test('one pack ships as .mcpack with the manifest at the archive root', () => {
  const exp = buildPackExport(detectPacks([f('bp/manifest.json', bpManifest), f('bp/items/ruby.json')]), 'Ruby Tools');
  assert.equal(exp.filename, 'ruby-tools.mcpack');
  // Minecraft rejects a .mcpack whose manifest is nested.
  assert.ok(exp.entries.some((e) => e.path === 'manifest.json'), JSON.stringify(exp.entries));
  assert.ok(exp.entries.some((e) => e.path === 'items/ruby.json'));
});

test('two packs ship as .mcaddon, each in its own folder', () => {
  const exp = buildPackExport(
    detectPacks([f('bp/manifest.json', bpManifest), f('bp/items/ruby.json'), f('rp/manifest.json', rpManifest), f('rp/textures/item.png')]),
    'Ruby Tools',
  );
  assert.equal(exp.filename, 'ruby-tools.mcaddon');
  assert.equal(exp.packs, 2);
  // A .mcaddon whose packs are not separated imports as one broken pack.
  assert.ok(exp.entries.some((e) => e.path === 'ruby-tools_BP/manifest.json'), JSON.stringify(exp.entries.map((e) => e.path)));
  assert.ok(exp.entries.some((e) => e.path === 'ruby-tools_RP/manifest.json'));
  assert.ok(!exp.entries.some((e) => e.path === 'manifest.json'), 'no manifest may sit at the root of a .mcaddon');
});

test('a pack at the bundle root is handled too', () => {
  const exp = buildPackExport(detectPacks([f('manifest.json', bpManifest), f('items/ruby.json')]), 'Flat');
  // Named from the manifest ("Ruby Tools"), not from the caller's fallback.
  assert.equal(exp.filename, 'ruby-tools.mcpack');
  assert.ok(exp.entries.some((e) => e.path === 'manifest.json'));
});

test('slugs are filename-safe and never empty', () => {
  assert.equal(slugify('Ruby Tools!! v2'), 'ruby-tools-v2');
  assert.equal(slugify('***'), 'chomugiri-addon');
  assert.ok(slugify('x'.repeat(200)).length <= 48);
});

test('the summary says what the user is about to download', () => {
  const exp = buildPackExport(detectPacks([f('bp/manifest.json', bpManifest), f('rp/manifest.json', rpManifest)]), 'Ruby');
  const text = describeExport(exp);
  assert.ok(text.includes('ruby-tools.mcaddon'), text);
  assert.ok(text.includes('behaviour pack'), text);
  assert.ok(text.includes('resource pack'), text);
});

test('the archive is named after the pack, not after the prompt', async () => {
  const { archiveName } = await import('../src/lib/suites/minecraft/pack.ts');
  const packs = [
    { kind: 'behavior', root: 'bp', files: [], name: 'Ruby Tools BP' },
    { kind: 'resource', root: 'rp', files: [], name: 'Ruby Tools RP' },
  ];
  assert.equal(archiveName(packs, 'build a minecraft bedrock addon spec'), 'Ruby Tools');
  // "Behaviour Pack" / "Resource Pack" suffixes are trimmed the same way.
  assert.equal(archiveName([{ kind: 'behavior', root: '', files: [], name: 'Chomugiri Behaviour Pack' }], 'x'), 'Chomugiri');
  // With nothing to go on, the caller's fallback stands.
  assert.equal(archiveName([{ kind: 'behavior', root: '', files: [] }], 'fallback-name'), 'fallback-name');
});

test('the built filename uses the manifest name end to end', () => {
  const bp = JSON.stringify({ header: { name: 'Ruby Tools BP' }, modules: [{ type: 'data' }] });
  const rp = JSON.stringify({ header: { name: 'Ruby Tools RP' }, modules: [{ type: 'resources' }] });
  const exp = buildPackExport(detectPacks([f('bp/manifest.json', bp), f('rp/manifest.json', rp)]), 'some long ugly prompt text');
  assert.equal(exp.filename, 'ruby-tools.mcaddon');
});
