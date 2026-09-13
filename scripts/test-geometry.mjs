/** node --experimental-strip-types --test scripts/test-geometry.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bodyPlan, buildGeometry, defaultPivot, originOf, packUVs, uvFootprint } from '../src/lib/suites/minecraft/geometry.ts';

const part = (over = {}) => ({ name: 'body', size: [8, 12, 4], at: [0, 12, 0], ...over });

test('origin is the minimum corner, not the centre — the classic mistake', () => {
  // An 8-wide box centred on x=0 starts at -4, not 0.
  assert.deepEqual(originOf(part()), [-4, 12, -2]);
});

test('a part described off-centre lands where it was described', () => {
  assert.deepEqual(originOf(part({ size: [4, 12, 4], at: [6, 12, 0] })), [4, 12, -2]);
});

test('the default pivot is the top of the box, so a limb swings from its joint', () => {
  // A pivot left at the origin would swing the limb about the world centre.
  assert.deepEqual(defaultPivot(part({ size: [4, 12, 4], at: [6, 12, 0] })), [6, 24, 0]);
});

test('a cube unwraps to the cross Minecraft expects', () => {
  // width = 2*(depth+width), height = depth+height
  assert.deepEqual(uvFootprint([8, 12, 4]), { w: 24, h: 16 });
});

test('UV islands never overlap, which would make two parts share pixels', () => {
  const parts = [part(), part({ name: 'head', size: [8, 8, 8] }), part({ name: 'arm', size: [4, 12, 4] })];
  const { uvs } = packUVs(parts, 64);

  const boxes = parts.map((p, i) => ({ ...uvFootprint(p.size), x: uvs[i][0], y: uvs[i][1] }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `islands ${i} and ${j} overlap`);
    }
  }
});

test('islands wrap to a new row instead of running off the texture', () => {
  const wide = Array.from({ length: 6 }, (_, i) => part({ name: `p${i}`, size: [8, 8, 8] }));
  const { uvs, height } = packUVs(wide, 64);
  assert.ok(uvs.every(([x]) => x < 64), 'nothing may start past the texture edge');
  assert.ok(height > 16, 'a second row must have been started');
});

test('a compiled model is valid geometry with the identifier it was given', () => {
  const geo = buildGeometry({ identifier: 'geometry.ns.mob', parts: bodyPlan('biped') });
  const entry = geo['minecraft:geometry'][0];
  assert.equal(geo.format_version, '1.12.0');
  assert.equal(entry.description.identifier, 'geometry.ns.mob');
  assert.equal(entry.bones.length, 6);
  // Every bone must carry a pivot, or it rotates about the world origin.
  assert.ok(entry.bones.every((b) => Array.isArray(b.pivot) && b.pivot.length === 3));
});

test('texture dimensions are powers of two and big enough for every island', () => {
  const geo = buildGeometry({ identifier: 'geometry.ns.mob', parts: bodyPlan('quadruped') });
  const { texture_width: w, texture_height: h } = geo['minecraft:geometry'][0].description;
  assert.equal(w & (w - 1), 0, `${w} is not a power of two`);
  assert.equal(h & (h - 1), 0, `${h} is not a power of two`);

  const packed = packUVs(bodyPlan('quadruped'), w);
  assert.ok(h >= packed.height, 'the texture must contain every island');
});

test('limbs hang from the body, so they move with it', () => {
  const geo = buildGeometry({ identifier: 'geometry.ns.mob', parts: bodyPlan('biped') });
  const bones = geo['minecraft:geometry'][0].bones;
  assert.equal(bones.find((b) => b.name === 'leftArm').parent, 'body');
  assert.equal(bones.find((b) => b.name === 'body').parent, undefined, 'the root hangs from nothing');
});

test('a part hanging from a bone that does not exist is refused', () => {
  assert.throws(
    () => buildGeometry({ identifier: 'g', parts: [part({ parent: 'ghost' })] }),
    /hangs from "ghost", which does not exist/,
  );
});

test('duplicate bone names are refused rather than silently losing one', () => {
  assert.throws(() => buildGeometry({ identifier: 'g', parts: [part(), part()] }), /Two parts are both called/);
});

test('an empty model is refused, because it renders nothing', () => {
  assert.throws(() => buildGeometry({ identifier: 'g', parts: [] }), /at least one part/);
});

test('every body plan compiles and scales', () => {
  for (const plan of ['biped', 'quadruped', 'blob', 'flying']) {
    const geo = buildGeometry({ identifier: `geometry.ns.${plan}`, parts: bodyPlan(plan, 0.5) });
    assert.ok(geo['minecraft:geometry'][0].bones.length > 0, plan);
  }
});

test('a flat part is marked two-sided, or a wing is invisible from one side', () => {
  const geo = buildGeometry({ identifier: 'g', parts: bodyPlan('flying') });
  const wing = geo['minecraft:geometry'][0].bones.find((b) => b.name === 'leftWing');
  assert.equal(wing.cubes[0].mirror, true);
});
