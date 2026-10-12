/**
 * Built-in example projects — "File → Load example", and the fixture this upgrade's own tests check
 * against. "JJK Showcase" exists to prove the VFX/rig/camera pieces actually work together: a stick
 * figure throws a punch, cursed-energy particles flare around the fist, the camera snaps in and shakes,
 * and a one-frame flash sells the impact — the brief this whole upgrade was built from.
 */
import { addLayer, emptyProject, setKeyframe, updateLayer, type MotionProject } from './project.ts';
import { setCameraKeyframe } from './camera.ts';
import { newParticleConfig } from './particles.ts';

export function jjkShowcaseProject(): MotionProject {
  let p: MotionProject = { ...emptyProject(), title: 'JJK Showcase', duration: 2.2, background: '#0a0b10' };

  p = addLayer(p, 'rig');
  const rigId = p.layers[p.layers.length - 1]!.id;
  p = updateLayer(p, rigId, { name: 'Fighter', color: '#f4f5f7' });
  {
    const l = p.layers.find((x) => x.id === rigId)!;
    const wound = setKeyframe(l, 0, { x: l.keyframes[0]!.x - 60, pose: { armR: -40, forearmR: 150 }, easing: 'easeIn' });
    const punch = setKeyframe(wound, 0.45, { x: l.keyframes[0]!.x + 10, scale: 1.05, pose: { armR: -10, forearmR: 10 } });
    const recover = setKeyframe(punch, 1.0, { x: l.keyframes[0]!.x, scale: 1, pose: { armR: -30, forearmR: 100 }, easing: 'easeOut' });
    p = { ...p, layers: p.layers.map((x) => (x.id === rigId ? recover : x)) };
  }

  p = addLayer(p, 'particles');
  const auraId = p.layers[p.layers.length - 1]!.id;
  p = updateLayer(p, auraId, {
    name: 'Cursed aura',
    particles: { ...newParticleConfig('cursed', 7), spawnRate: 10, lifespan: 0.5 },
  });
  {
    const l = p.layers.find((x) => x.id === auraId)!;
    const base = l.keyframes[0]!;
    const hidden = setKeyframe(l, 0, { x: base.x - 60, opacity: 0.15 });
    const burst = setKeyframe(hidden, 0.42, { x: base.x + 10, opacity: 1 });
    const fade = setKeyframe(burst, 1.0, { x: base.x, opacity: 0.2, easing: 'easeOut' });
    p = { ...p, layers: p.layers.map((x) => (x.id === auraId ? fade : x)) };
    p = updateLayer(p, auraId, {
      particles: { ...fade.particles!, preset: 'explosion', colorStart: '#5cffb0', colorEnd: '#0a1a14' },
    });
  }

  p = { ...p, camera: setCameraKeyframe(p.camera, 0, { x: 0, y: 0, zoom: 1, rotation: 0, easing: 'easeIn' }) };
  p = { ...p, camera: setCameraKeyframe(p.camera, 0.42, { x: 30, y: -10, zoom: 1.35, rotation: -2 }) };
  p = { ...p, camera: setCameraKeyframe(p.camera, 1.2, { x: 0, y: 0, zoom: 1, rotation: 0, easing: 'easeOut' }) };

  p = { ...p, shakes: [{ id: 'shake_showcase', t: 0.42, duration: 0.28, magnitude: 26, seed: 11 }] };
  p = { ...p, impacts: [{ id: 'impact_showcase', t: 0.42, duration: 0.06, style: 'flash' }] };
  p = { ...p, speedRamps: [{ id: 'ramp_showcase', t0: 0.3, t1: 0.42, rate: 0.3 }] };

  return p;
}
