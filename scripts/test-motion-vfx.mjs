/** node --experimental-strip-types --test scripts/test-motion-vfx.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { lerpColor, newParticleConfig, particlesAt, PARTICLE_PRESETS } from '../src/lib/suites/motion/particles.ts';

test('every preset has a config and produces a non-empty pool', () => {
  for (const preset of PARTICLE_PRESETS) {
    const cfg = newParticleConfig(preset, 7);
    const pool = particlesAt(cfg, 0.5);
    assert.ok(pool.length > 0, preset);
  }
});

test('particlesAt is a pure function of t: same t always gives the same pool', () => {
  const cfg = newParticleConfig('fire', 42);
  const a = particlesAt(cfg, 1.234);
  const b = particlesAt(cfg, 1.234);
  assert.deepEqual(a, b);
});

test('a pool loops on lifespan: t and t+lifespan give (within float rounding) the same pool', () => {
  const cfg = newParticleConfig('aura', 3);
  const a = particlesAt(cfg, 0.4);
  const b = particlesAt(cfg, 0.4 + cfg.lifespan);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.abs(a[i].x - b[i].x) < 1e-6, `particle ${i} x`);
    assert.ok(Math.abs(a[i].y - b[i].y) < 1e-6, `particle ${i} y`);
    assert.ok(Math.abs(a[i].opacity - b[i].opacity) < 1e-6, `particle ${i} opacity`);
  }
});

test('two different seeds do not produce the same pool', () => {
  const a = particlesAt(newParticleConfig('cursed', 1), 0.5);
  const b = particlesAt(newParticleConfig('cursed', 2), 0.5);
  assert.notDeepEqual(a, b);
});

test('a particle fades out as it ages: nudging t forward by a small amount ages (and so dims) nearly every particle in the pool', () => {
  // Each particle's phase is random but fixed, so for a small dt most particles' age simply increases
  // by dt (a few near a lifespan boundary wrap and brighten again — that is expected, not a bug).
  const cfg = newParticleConfig('electric', 9);
  const dt = cfg.lifespan / 200;
  const a = particlesAt(cfg, 0.1);
  const b = particlesAt(cfg, 0.1 + dt);
  const dimmed = a.filter((p, i) => b[i].opacity <= p.opacity + 1e-9).length;
  assert.ok(dimmed / a.length > 0.9, `expected >90% of particles to dim or hold, got ${dimmed}/${a.length}`);
});

test('explosion particles travel outward but decelerate (burst, not a constant drift)', () => {
  const cfg = newParticleConfig('explosion', 5);
  const early = particlesAt(cfg, cfg.lifespan * 0.1);
  const mid = particlesAt(cfg, cfg.lifespan * 0.5);
  const dist = (xs) => xs.reduce((s, p) => s + Math.hypot(p.x, p.y), 0) / xs.length;
  const d1 = dist(early), d2 = dist(mid);
  assert.ok(d2 > d1, 'still moving outward by the midpoint');
});

test('lerpColor interpolates channel-wise between two hex colours', () => {
  assert.equal(lerpColor('#000000', '#ffffff', 0), '#000000');
  assert.equal(lerpColor('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(lerpColor('#000000', '#ffffff', 0.5), '#808080');
});

test('fire particles are biased upward (negative y on average), not falling', () => {
  const cfg = newParticleConfig('fire', 11);
  const pool = particlesAt(cfg, cfg.lifespan * 0.6);
  const avgY = pool.reduce((s, p) => s + p.y, 0) / pool.length;
  assert.ok(avgY < 0, `fire should drift upward on average, got avg y=${avgY}`);
});
