/** node --experimental-strip-types --test scripts/test-library.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { addLayer, emptyProject, updateLayer } from '../src/lib/suites/motion/project.ts';
import {
  PROP_PRESETS, BACKGROUND_PRESETS, VFX_STICKERS, propToLayer, serializeLayer, instantiateLayer,
  layerToJson, layerFromJson,
} from '../src/lib/suites/motion/library.ts';

test('PROP_PRESETS: every preset has a unique id and a positive size', () => {
  const ids = new Set();
  for (const p of PROP_PRESETS) {
    assert.ok(!ids.has(p.id), `duplicate prop id ${p.id}`);
    ids.add(p.id);
    assert.ok(p.w > 0 && p.h > 0);
  }
});

test('BACKGROUND_PRESETS and VFX_STICKERS: unique ids, well-formed', () => {
  const bgIds = new Set(BACKGROUND_PRESETS.map((b) => b.id));
  assert.equal(bgIds.size, BACKGROUND_PRESETS.length);
  for (const b of BACKGROUND_PRESETS) assert.match(b.color, /^#[0-9a-f]{6}$/i);
  const stickerIds = new Set(VFX_STICKERS.map((s) => s.id));
  assert.equal(stickerIds.size, VFX_STICKERS.length);
});

test('propToLayer: the prop lands centred on the given point', () => {
  const project = emptyProject();
  const rock = PROP_PRESETS.find((p) => p.id === 'rock');
  const layer = propToLayer(rock, project, 500, 300);
  assert.equal(layer.kind, 'circle');
  assert.equal(layer.w, rock.w);
  assert.equal(layer.keyframes[0].x, 500 - rock.w / 2);
  assert.equal(layer.keyframes[0].y, 300 - rock.h / 2);
});

test('propToLayer: a text prop carries its glyph through', () => {
  const project = emptyProject();
  const star = PROP_PRESETS.find((p) => p.id === 'star');
  const layer = propToLayer(star, project, 0, 0);
  assert.equal(layer.text, star.text);
});

// ── portable layer round-trip ────────────────────────────────────────────

test('serializeLayer/instantiateLayer: round-trips a plain rect with a fresh id', () => {
  let project = addLayer(emptyProject(), 'rect');
  const original = project.layers[0];
  const portable = serializeLayer(original);
  assert.equal(portable.id, undefined);
  assert.equal(portable.groupId, undefined);
  const copy = instantiateLayer(portable);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.kind, original.kind);
  assert.equal(copy.color, original.color);
  assert.equal(copy.groupId, null);
});

test('instantiateLayer: gives every keyframe a fresh id, never reusing the original\'s', () => {
  let project = addLayer(emptyProject(), 'rect');
  const original = project.layers[0];
  const portable = serializeLayer(original);
  const copy = instantiateLayer(portable);
  const originalIds = new Set(original.keyframes.map((k) => k.id));
  for (const k of copy.keyframes) assert.ok(!originalIds.has(k.id));
});

test('instantiateLayer: with x/y, repositions the first keyframe there and shifts the rest by the same delta', () => {
  let project = addLayer(emptyProject(), 'rect');
  let layer = project.layers[0];
  layer = updateLayer(project, layer.id, {}).layers[0]; // no-op, just reuse layer
  // give it two keyframes so the delta-shift behaviour (not an absolute override) is actually exercised
  layer = { ...layer, keyframes: [{ ...layer.keyframes[0], x: 10, y: 20 }, { ...layer.keyframes[0], id: 'kf2', t: 1, x: 110, y: 20 }] };
  const portable = serializeLayer(layer);
  const copy = instantiateLayer(portable, 200, 200);
  assert.equal(copy.keyframes[0].x, 200);
  assert.equal(copy.keyframes[0].y, 200);
  // the second keyframe should have moved by the same delta (190, 180), keeping the shape's internal motion intact
  assert.equal(copy.keyframes[1].x, 110 + 190);
  assert.equal(copy.keyframes[1].y, 20 + 180);
});

test('instantiateLayer: a paint layer gets fresh stroke ids too', () => {
  let project = addLayer(emptyProject(), 'paint');
  let layer = project.layers[0];
  layer = {
    ...layer,
    paint: { ...layer.paint, frames: [{ strokes: [{ id: 'orig_stroke', brush: { kind: 'pencil', size: 2, opacity: 1, color: '#fff', stabilizer: 0, pressureSizeMix: 0, pressureOpacityMix: 0 }, nodes: [], mode: 'draw' }] }] },
  };
  const portable = serializeLayer(layer);
  const copy = instantiateLayer(portable);
  assert.notEqual(copy.paint.frames[0].strokes[0].id, 'orig_stroke');
});

test('instantiateLayer: a rig layer keeps its bone ids unchanged (angles/detachments reference them)', () => {
  let project = addLayer(emptyProject(), 'rig');
  const original = project.layers[0];
  const portable = serializeLayer(original);
  const copy = instantiateLayer(portable);
  assert.deepEqual(copy.rig.bones.map((b) => b.id), original.rig.bones.map((b) => b.id));
});

test('layerToJson/layerFromJson: round-trips through text', () => {
  let project = addLayer(emptyProject(), 'circle');
  const original = project.layers[0];
  const json = layerToJson(original);
  const portable = layerFromJson(json);
  assert.notEqual(portable, null);
  const copy = instantiateLayer(portable);
  assert.equal(copy.kind, 'circle');
  assert.equal(copy.color, original.color);
});

test('layerFromJson: returns null (never throws) on garbage input', () => {
  assert.equal(layerFromJson('not json at all'), null);
  assert.equal(layerFromJson('{"not":"a layer"}'), null);
  assert.equal(layerFromJson('null'), null);
  assert.equal(layerFromJson('42'), null);
});
