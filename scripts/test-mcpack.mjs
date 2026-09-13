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

// ── Import blockers ─────────────────────────────────────────────────────────

const { validatePacks } = await import('../src/lib/suites/minecraft/pack.ts');
const good = (over = {}) =>
  JSON.stringify({
    format_version: 2,
    header: { name: 'Ruby', uuid: '11111111-2222-4333-8444-555555555555', version: [1, 0, 0], min_engine_version: [1, 21, 0] },
    modules: [{ type: 'data', uuid: '66666666-7777-4888-8999-aaaaaaaaaaaa', version: [1, 0, 0] }],
    ...over,
  });

const blockers = (packs) => validatePacks(packs).filter((p) => p.severity === 'blocker').map((p) => p.message);

test('a well-formed pack reports no blockers', () => {
  assert.deepEqual(blockers(detectPacks([f('bp/manifest.json', good())])), []);
});

test('the all-zero placeholder uuid is caught', () => {
  const bad = good({ header: { name: 'x', uuid: '00000000-0000-0000-0000-000000000000', version: [1, 0, 0] } });
  const out = blockers(detectPacks([f('bp/manifest.json', bad)]));
  assert.ok(out.some((m) => /all-zero placeholder/i.test(m)), out.join(' | '));
});

test('a uuid reused between header and module is caught', () => {
  const dup = '11111111-2222-4333-8444-555555555555';
  const bad = good({ header: { name: 'x', uuid: dup, version: [1, 0, 0] }, modules: [{ type: 'data', uuid: dup }] });
  const out = blockers(detectPacks([f('bp/manifest.json', bad)]));
  assert.ok(out.some((m) => /reuses the uuid/i.test(m)), out.join(' | '));
});

test('a uuid reused across two packs is caught', () => {
  const shared = '11111111-2222-4333-8444-555555555555';
  const bp = good();
  const rp = JSON.stringify({
    format_version: 2,
    header: { name: 'Ruby RP', uuid: shared, version: [1, 0, 0], min_engine_version: [1, 21, 0] },
    modules: [{ type: 'resources', uuid: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', version: [1, 0, 0] }],
  });
  const out = blockers(detectPacks([f('bp/manifest.json', bp), f('rp/manifest.json', rp)]));
  assert.ok(out.some((m) => /reuses the uuid/i.test(m)), out.join(' | '));
});

test('unparseable or module-less manifests are blockers, not surprises at import', () => {
  assert.ok(blockers(detectPacks([f('bp/manifest.json', '{ nope')])).some((m) => /not valid JSON/i.test(m)));
  const noModules = good({ modules: [] });
  assert.ok(blockers(detectPacks([f('bp/manifest.json', noModules)])).some((m) => /no modules/i.test(m)));
});

test('a missing lang file warns rather than blocks', () => {
  const rp = JSON.stringify({
    format_version: 2,
    header: { name: 'RP', uuid: 'aaaaaaaa-1111-4222-8333-444444444444', version: [1, 0, 0], min_engine_version: [1, 21, 0] },
    modules: [{ type: 'resources', uuid: 'bbbbbbbb-1111-4222-8333-444444444444', version: [1, 0, 0] }],
  });
  const out = validatePacks(detectPacks([f('rp/manifest.json', rp), f('rp/items/ruby.json')]));
  assert.deepEqual(out.filter((p) => p.severity === 'blocker'), []);
  assert.ok(out.some((p) => /raw identifiers/i.test(p.message)), JSON.stringify(out));
});

test('a behaviour pack shipped alone is flagged as having no textures or names', () => {
  const out = validatePacks(detectPacks([f('bp/manifest.json', good())]));
  assert.ok(out.some((p) => p.severity === 'warning' && /no textures or names/i.test(p.message)));
});

// ── The invisible-entity trap ───────────────────────────────────────────────

const clientEntity = (geometryId) =>
  JSON.stringify({
    'minecraft:client_entity': {
      description: { identifier: 'ns:mob', geometry: { default: geometryId }, render_controllers: ['controller.render.mob'] },
    },
  });

const geo = (identifier) =>
  JSON.stringify({
    format_version: '1.12.0',
    'minecraft:geometry': [{ description: { identifier }, bones: [{ name: 'root', pivot: [0, 0, 0] }] }],
  });

test('an entity whose geometry the pack does not define is a blocker', () => {
  // This exact shape imports cleanly and then draws nothing in game.
  const out = blockers(detectPacks([f('rp/manifest.json', good({ modules: [{ type: 'resources', uuid: 'cccccccc-1111-4222-8333-444444444444' }] })), f('rp/entity/mob.entity.json', clientEntity('geometry.ns.mob'))]));
  assert.ok(out.some((m) => /would be invisible in game/i.test(m)), out.join(' | '));
});

test('the same entity passes once the .geo.json is present', () => {
  const out = blockers(
    detectPacks([
      f('rp/manifest.json', good({ modules: [{ type: 'resources', uuid: 'cccccccc-1111-4222-8333-444444444444' }] })),
      f('rp/entity/mob.entity.json', clientEntity('geometry.ns.mob')),
      f('rp/models/entity/mob.geo.json', geo('geometry.ns.mob')),
    ]),
  );
  assert.deepEqual(out, []);
});

test('a geometry identifier that does not match is caught, not silently accepted', () => {
  const out = blockers(
    detectPacks([
      f('rp/manifest.json', good({ modules: [{ type: 'resources', uuid: 'cccccccc-1111-4222-8333-444444444444' }] })),
      f('rp/entity/mob.entity.json', clientEntity('geometry.ns.mob')),
      f('rp/models/entity/mob.geo.json', geo('geometry.ns.TYPO')),
    ]),
  );
  assert.ok(out.some((m) => /geometry "geometry.ns.mob"/.test(m)), out.join(' | '));
});

test('an entity declaring no geometry at all is a blocker', () => {
  const noGeo = JSON.stringify({ 'minecraft:client_entity': { description: { identifier: 'ns:mob' } } });
  const out = blockers(detectPacks([f('rp/manifest.json', good({ modules: [{ type: 'resources', uuid: 'cccccccc-1111-4222-8333-444444444444' }] })), f('rp/entity/mob.entity.json', noGeo)]));
  assert.ok(out.some((m) => /no geometry/i.test(m)), out.join(' | '));
});

test('a broken .geo.json is reported rather than ignored', () => {
  const out = blockers(detectPacks([f('rp/manifest.json', good({ modules: [{ type: 'resources', uuid: 'cccccccc-1111-4222-8333-444444444444' }] })), f('rp/models/entity/mob.geo.json', '{ broken')]));
  assert.ok(out.some((m) => /model will not load/i.test(m)), out.join(' | '));
});

// ── Binary textures ─────────────────────────────────────────────────────────

test('a data-URL texture is decoded to bytes, not written as text', () => {
  // "PNG" as base64 — a PNG written into a ZIP as text is a corrupt PNG.
  const png = 'data:image/png;base64,UE5H';
  const exp = buildPackExport(
    detectPacks([f('rp/manifest.json', good({ modules: [{ type: 'resources', uuid: 'dddddddd-1111-4222-8333-444444444444' }] })), f('rp/textures/items/ruby.png', png)]),
    'Ruby',
  );
  const entry = exp.entries.find((e) => e.path.endsWith('ruby.png'));
  assert.ok(entry.content instanceof Uint8Array, 'texture must be bytes');
  assert.deepEqual([...entry.content], [0x50, 0x4e, 0x47]);
});

test('ordinary JSON files stay as text alongside the binary ones', () => {
  const png = 'data:image/png;base64,UE5H';
  const exp = buildPackExport(
    detectPacks([f('rp/manifest.json', good({ modules: [{ type: 'resources', uuid: 'dddddddd-1111-4222-8333-444444444444' }] })), f('rp/textures/items/ruby.png', png)]),
    'Ruby',
  );
  const manifest = exp.entries.find((e) => e.path.endsWith('manifest.json'));
  assert.equal(typeof manifest.content, 'string');
});

test('a shipped texture clears the missing-texture warning', () => {
  const png = 'data:image/png;base64,UE5H';
  const rp = good({ modules: [{ type: 'resources', uuid: 'dddddddd-1111-4222-8333-444444444444' }] });
  const withTexture = validatePacks(
    detectPacks([f('rp/manifest.json', rp), f('rp/textures/item_texture.json', '{}'), f('rp/textures/items/ruby.png', png)]),
  );
  assert.ok(!withTexture.some((p) => /none are included/i.test(p.message)), JSON.stringify(withTexture));
});
