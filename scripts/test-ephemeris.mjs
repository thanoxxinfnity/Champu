/** node --experimental-strip-types --test scripts/test-ephemeris.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AU_KM, centuries, julianDate, lightMinutes, moonPhase, moonPosition, orbitPath, planetPosition, solveKepler } from '../site/js/ephemeris.js';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/horizons.json', import.meta.url), 'utf8'));

// Angular error as seen from the Sun, in arc-minutes, and the miss in AU.
const angleArcmin = (a, b) => {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const c = dot / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
  return (Math.acos(Math.min(1, c)) * 180 * 60) / Math.PI;
};
const miss = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('Julian date and centuries match the J2000 epoch', () => {
  assert.equal(julianDate(new Date('2000-01-01T12:00:00Z')), 2451545.0);
  assert.equal(centuries(new Date('2000-01-01T12:00:00Z')), 0);
});

test("Kepler's equation is solved for a circle and for a comet-like orbit", () => {
  assert.ok(Math.abs(solveKepler(1.234, 0) - 1.234) < 1e-12);
  const E = solveKepler(2.0, 0.9);
  assert.ok(Math.abs(E - 0.9 * Math.sin(E) - 2.0) < 1e-10);
});

test('every planet lands where NASA JPL Horizons puts it, on every sampled date', () => {
  // JPL's own stated accuracy for these elements over 1800-2050 is arc-minutes for
  // the inner planets, a few arc-minutes more for the outer ones. The limits below
  // are set to that, not to whatever this code happens to achieve.
  const limits = { mercury: 20, venus: 20, earth: 20, mars: 30, jupiter: 60, saturn: 60, uranus: 60, neptune: 60, pluto: 120 };
  const worst = {};
  for (const sample of FIX.samples) {
    const T = centuries(new Date(sample.when));
    for (const [name, ref] of Object.entries(sample.planets)) {
      const ours = planetPosition(name, T);
      const err = angleArcmin(ours, ref);
      worst[name] = Math.max(worst[name] ?? 0, err);
      assert.ok(err < limits[name], `${name} ${sample.when}: ${err.toFixed(1)}' off JPL (limit ${limits[name]}')`);
      // And the distance from the Sun, which is a separate quantity from direction.
      assert.ok(Math.abs(ours.r - Math.hypot(ref.x, ref.y, ref.z)) / ours.r < 0.01, `${name} ${sample.when}: distance from the Sun is off by more than 1%`);
    }
  }
  console.log('worst angular error vs JPL Horizons (arc-minutes):', Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +v.toFixed(1)])));
});

test('Earth is about one AU out and Mars about 1.5 on the sampled days', () => {
  const T = centuries(new Date('2026-10-02T00:00:00Z'));
  assert.ok(Math.abs(planetPosition('earth', T).r - 1.0) < 0.02);
  assert.ok(Math.abs(planetPosition('mars', T).r - 1.5) < 0.15);
});

test('the Moon is where Horizons has it, to within a couple of degrees and a few thousand km', () => {
  for (const sample of FIX.samples) {
    const T = centuries(new Date(sample.when));
    const ours = moonPosition(T);
    const ref = { x: sample.moon.x * AU_KM, y: sample.moon.y * AU_KM, z: sample.moon.z * AU_KM };
    const err = angleArcmin(ours, ref) / 60;
    assert.ok(err < 1.5, `moon ${sample.when}: ${err.toFixed(2)} degrees off`);
    assert.ok(Math.abs(ours.distKm - Math.hypot(ref.x, ref.y, ref.z)) < 6000, `moon ${sample.when}: distance off`);
  }
});

test('the Moon phase is sensible: new moon near 2024-04-08, full near 2024-04-23', () => {
  const near = (p, target) => Math.min(Math.abs(p - target), 1 - Math.abs(p - target));
  assert.ok(near(moonPhase(new Date('2024-04-08T18:00:00Z')), 0) < 0.03);
  assert.ok(near(moonPhase(new Date('2024-04-23T23:49:00Z')), 0.5) < 0.03);
});

test('an orbit path is a closed loop that passes through the planet', () => {
  const T = centuries(new Date('2026-10-02T00:00:00Z'));
  const path = orbitPath('mars', T, 360);
  assert.equal(path.length, 361);
  assert.ok(miss(path[0], path[360]) < 1e-9);
  const p = planetPosition('mars', T);
  assert.ok(Math.min(...path.map((q) => miss(q, p))) < 0.03);
});

test('light takes about 8.3 minutes to cross one AU', () => {
  assert.ok(Math.abs(lightMinutes(1) - 8.317) < 0.01);
});
