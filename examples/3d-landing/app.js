import * as THREE from 'three';

/**
 * The scene behind the page.
 *
 * Rules it keeps, because each one is the difference between 3D and a black box:
 * the renderer is sized from its own client box, the pixel ratio is clamped,
 * resize updates both camera and renderer, there are real lights, the loop stops
 * when the tab is hidden, and reduced-motion gets one static frame.
 */

const canvas = document.getElementById('scene');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
} catch {
  // No WebGL: the page is readable without it, so leave the content alone.
  canvas.remove();
}

if (renderer) {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(dark ? 0x17120d : 0xfdf6ec, 9, 26);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  camera.position.set(0, 0, 12);

  // ── Lights ──────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0xffffff, dark ? 0.5 : 0.85));

  const key = new THREE.DirectionalLight(0xffc79a, 2.1);
  key.position.set(5, 6, 7);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xff7a2f, 1.5);
  rim.position.set(-7, -3, -5);
  scene.add(rim);

  // ── The shape ───────────────────────────────────────────────────────────
  const group = new THREE.Group();
  scene.add(group);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.6, 1),
    new THREE.MeshStandardMaterial({
      color: dark ? 0xff8b3d : 0xe8722a,
      roughness: 0.38,
      metalness: 0.12,
      flatShading: true,
    }),
  );
  group.add(core);

  const cage = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3.5, 1)),
    new THREE.LineBasicMaterial({ color: dark ? 0xffa763 : 0xc25314, transparent: true, opacity: 0.35 }),
  );
  group.add(cage);

  // Satellites on three tilted rings, built in code — nothing to download.
  const cubeGeometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const cubeMaterial = new THREE.MeshStandardMaterial({
    color: dark ? 0xf6e8d8 : 0x2b1d12,
    roughness: 0.55,
    metalness: 0.05,
    transparent: true,
    opacity: 0.78,
  });
  const satellites = [];
  for (let ring = 0; ring < 3; ring += 1) {
    const orbit = new THREE.Group();
    orbit.rotation.x = (ring - 1) * 0.7;
    orbit.rotation.z = ring * 0.5;
    for (let i = 0; i < 9; i += 1) {
      const angle = (i / 9) * Math.PI * 2;
      const radius = 4.6 + ring * 0.85;
      const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
      cube.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      cube.rotation.set(angle, angle * 1.4, 0);
      orbit.add(cube);
    }
    satellites.push(orbit);
    group.add(orbit);
  }

  // ── Fit to the canvas, not to the window ────────────────────────────────
  // Where the shape sits, which is a layout decision as much as a 3D one: on a
  // wide screen the copy owns the left, on a phone it owns the top.
  let anchor = { x: 3.1, y: 0 };

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Pull the camera back on a narrow screen, or the shape crops badly.
    camera.position.z = width < 760 ? 17 : 12;
    camera.updateProjectionMatrix();

    anchor = width < 760 ? { x: 1.6, y: -3.4 } : { x: 4.4, y: -0.4 };
  }
  resize();
  addEventListener('resize', resize, { passive: true });

  // ── Input: the shape follows the pointer and the scroll ─────────────────
  const pointer = { x: 0, y: 0 };
  addEventListener(
    'pointermove',
    (e) => {
      pointer.x = (e.clientX / innerWidth) * 2 - 1;
      pointer.y = (e.clientY / innerHeight) * 2 - 1;
    },
    { passive: true },
  );

  let scrolled = 0;
  addEventListener(
    'scroll',
    () => {
      const max = Math.max(1, document.body.scrollHeight - innerHeight);
      scrolled = Math.min(1, scrollY / max);
    },
    { passive: true },
  );

  const clock = new THREE.Clock();

  function frame() {
    const t = clock.getElapsedTime();

    group.rotation.y += 0.0024;
    group.rotation.x = Math.sin(t * 0.25) * 0.16 + pointer.y * 0.22;
    group.rotation.z = pointer.x * 0.12;

    // Scroll pushes it away and to the side, so the copy keeps the foreground.
    group.position.x = anchor.x + pointer.x * 0.6 - scrolled * 1.4;
    group.position.y = anchor.y - scrolled * 1.1;
    group.position.z = -scrolled * 5;

    core.scale.setScalar(1 + Math.sin(t * 0.9) * 0.03);
    satellites.forEach((orbit, i) => {
      orbit.rotation.z += 0.0016 * (i + 1);
    });

    renderer.render(scene, camera);
  }

  if (reduceMotion) {
    // One frame, then nothing moves.
    group.position.x = anchor.x;
    group.position.y = anchor.y;
    renderer.render(scene, camera);
  } else {
    renderer.setAnimationLoop(frame);

    // A hidden tab keeps a phone's GPU busy for a page nobody is looking at.
    document.addEventListener('visibilitychange', () => {
      renderer.setAnimationLoop(document.hidden ? null : frame);
    });
  }
}
