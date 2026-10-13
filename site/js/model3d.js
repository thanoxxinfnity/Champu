/**
 * A small, real 3D model rendered right in the page — a stand-in for the "3D models" line in the
 * feature list above it. Code-built (an icosahedron core with an orbiting ring of cut facets), the
 * same honest fallback Chomugiri itself uses when it has no AI model provider configured: never a
 * flat placeholder, always something real turning in front of you.
 */
import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/examples/OrbitControls.js';

const $ = (s) => document.querySelector(s);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function start() {
  const canvas = $('#model3d-canvas');
  const card = $('#model3d-card');
  if (!canvas || !card) return;

  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ea580c';
  const accent2 = () => getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#fb923c';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  camera.position.set(0, 0.4, 4.2);

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 4, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff0e0, 0.6);
  fill.position.set(-4, -2, -3);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  const group = new THREE.Group();
  scene.add(group);

  const coreMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(accent()),
    metalness: 0.15, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.3,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), coreMat);
  group.add(core);

  const wireMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accent2()), wireframe: true, transparent: true, opacity: 0.35 });
  const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.015, 1), wireMat);
  group.add(wire);

  // a small ring of orbiting facets — "parts being assembled", echoing the hero's orbiting icons
  const bits = new THREE.Group();
  const bitMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accent2()), metalness: 0.2, roughness: 0.4 });
  const bitCount = 7;
  for (let i = 0; i < bitCount; i++) {
    const geo = new THREE.OctahedronGeometry(0.12);
    const bit = new THREE.Mesh(geo, bitMat);
    const angle = (i / bitCount) * Math.PI * 2;
    bit.position.set(Math.cos(angle) * 1.8, Math.sin(angle * 1.7) * 0.5, Math.sin(angle) * 1.8);
    bits.add(bit);
  }
  group.add(bits);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.autoRotate = !reduced();
  controls.autoRotateSpeed = 2.2;

  function resize() {
    const w = card.clientWidth, h = card.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(card);
  resize();

  let raf = 0;
  const clock = new THREE.Clock();
  function tick() {
    raf = requestAnimationFrame(tick);
    const t = clock.getElapsedTime();
    bits.rotation.y = t * 0.6;
    bits.rotation.x = Math.sin(t * 0.3) * 0.2;
    if (!reduced()) wire.rotation.y = t * 0.15;
    controls.update();
    renderer.render(scene, camera);
  }
  if (reduced()) { resize(); controls.update(); renderer.render(scene, camera); } else { tick(); }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); } else if (!reduced()) { tick(); }
  });
}
