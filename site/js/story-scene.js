/**
 * The site's 3D story: a room assembles, the camera drifts around it like an
 * establishing shot, then a character walks in holding a phone and opens
 * Chomugiri. Every model here is a real generated asset (Tripo-class image-to-3D,
 * downsized for the web — see assets/3d/README.md), not a placeholder.
 *
 * Kept separate from model3d.js (the small code-built icon in the feature
 * list) — this is the hero-scale piece, heavier and only started when its
 * canvas is actually on screen.
 */
import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/examples/OrbitControls.js';
import { GLTFLoader } from '/vendor/three/examples/GLTFLoader.js';

const $ = (s) => document.querySelector(s);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ASSETS = '/assets/3d/';

// Room layout: file, x, z, yaw (deg), target real-world size in metres (the
// model's largest dimension is scaled to this — each Tripo-class generation
// comes out at an arbitrary, unrelated scale, so placing by a fixed
// multiplier is what produced a lamp the size of a bookshelf the first time
// this was tried). y is filled in at load time from the model's own floor.
const ROOM = [
  ['01_grey_sofa.glb', -1.6, -1.2, 32, 2.0],
  ['02_coffee_table.glb', -0.6, -0.4, 0, 1.1],
  ['03_tv_console.glb', 0, -2.6, 0, 1.6],
  ['04_tv.glb', 0, -2.55, 0, 1.1, 0.62],
  ['07_bookshelf.glb', -2.6, -2.2, 20, 1.9],
  ['08_armchair.glb', 1.7, -0.9, -40, 1.0],
  ['09_persian_rug.glb', -0.6, -0.6, 0, 2.6, undefined, true],
  ['10_palm_plant.glb', 2.4, -2.2, 0, 1.6],
  ['12_pendant_lamp.glb', -0.6, -0.6, 0, 0.42, 1.9],
  ['15_floor_lamp.glb', 2.6, -0.4, 0, 1.5],
  ['17_landscape_painting.glb', -2.7, -2.85, 10, 1.0, 1.4],
  ['19_book_stack.glb', -0.3, -0.35, 0, 0.3],
  ['22_photo_frame.glb', 1.9, -2.85, 0, 0.35, 1.2],
  ['16_succulent.glb', 1.6, -0.5, 0, 0.28],
];
const CENTER = new THREE.Vector3(0, 1.1, 0.6);
const ORBIT_RADIUS = 5.2;
const ORBIT_HEIGHT = 2.0;
const ORBIT_SPEED = 0.07; // radians/sec — a slow drift, not a spin

export function start() {
  const canvas = $('#story-canvas');
  const card = $('#story-card');
  if (!canvas || !card) return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);

  const key = new THREE.DirectionalLight(0xfff3e6, 2.4);
  key.position.set(4, 5, 3);
  scene.add(key);
  scene.add(new THREE.DirectionalLight(0xdce8ff, 0.5).translateX(-4).translateY(2).translateZ(-3));
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(5.5, 48),
    new THREE.MeshStandardMaterial({ color: 0x1c1712, roughness: 0.9, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const loader = new GLTFLoader();
  const loadModel = (file) =>
    new Promise((resolve) => {
      loader.load(
        ASSETS + file,
        (gltf) => resolve(gltf.scene),
        undefined,
        () => resolve(null), // one missing prop should not blank the whole room
      );
    });

  /**
   * Scales a loaded model to a real-world size and sits it on the floor at
   * (x, z) — or, when `fixedY` is given (a wall-mounted TV, lamp head,
   * painting), hangs it there instead of grounding it.
   */
  function fitAndPlace(node, { x, z, yawDeg = 0, targetSize, fixedY, layFlat }) {
    const box = new THREE.Box3().setFromObject(node);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = targetSize / maxDim;
    node.scale.setScalar(scale);
    // A rug/mat comes out of image-to-3D standing upright, facing whichever
    // way the source photo faced — it has to be laid onto the XZ plane.
    if (layFlat) node.rotation.x = -Math.PI / 2;
    node.rotation.y = (yawDeg * Math.PI) / 180;

    // Re-measure after scaling/rotating, then recentre on (x, z) and rest the
    // base on the floor — the model's own origin is wherever its generator
    // put it, almost never the geometric centre or the floor.
    const box2 = new THREE.Box3().setFromObject(node);
    const center2 = box2.getCenter(new THREE.Vector3());
    node.position.x += x - center2.x;
    node.position.z += z - center2.z;
    node.position.y += fixedY != null ? fixedY - center2.y : -box2.min.y;
  }

  const root = new THREE.Group();
  scene.add(root);

  // Character + phone, animated separately from the static room.
  let character = null;
  let phone = null;
  const glowGeo = new THREE.PlaneGeometry(0.26, 0.5);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const screenGlow = new THREE.Mesh(glowGeo, glowMat);

  async function build() {
    await Promise.all(
      ROOM.map(async ([file, x, z, yawDeg, targetSize, fixedY, layFlat]) => {
        const node = await loadModel(file);
        if (!node) return;
        fitAndPlace(node, { x, z, yawDeg, targetSize, fixedY, layFlat });
        root.add(node);
      }),
    );

    const [charScene, phoneScene] = await Promise.all([loadModel('character.glb'), loadModel('phone.glb')]);
    if (charScene) {
      character = charScene;
      // Off-stage start: the walk-in reads as an entrance only if there is
      // somewhere to walk in from. Grounded and sized like an adult, not
      // whatever scale the generator happened to export at.
      fitAndPlace(character, { x: WALK_FROM_XZ[0], z: WALK_FROM_XZ[1], yawDeg: 63, targetSize: 1.75 });
      character.userData.groundY = character.position.y;
      root.add(character);
    }
    if (phoneScene) {
      phone = phoneScene;
      fitAndPlace(phone, { x: PHONE_FROM_XZ[0], z: PHONE_FROM_XZ[1], targetSize: 0.15 });
      phone.userData.groundY = phone.position.y;
      root.add(phone);
      screenGlow.position.set(0, 0.02, 0.045);
      phone.add(screenGlow);
    }
  }
  const ready = build();

  function resize() {
    const w = card.clientWidth, h = card.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(card);
  resize();

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 3;
  controls.maxDistance = 9;
  controls.target.copy(CENTER);
  // A drag takes over the shot; it does not fight the user for the camera.
  let userDriving = false;
  let userDriveUntil = 0;
  controls.addEventListener('start', () => { userDriving = true; });
  controls.addEventListener('end', () => { userDriving = false; userDriveUntil = performance.now() + 4000; });

  // Walk-in timeline, in seconds from page-visible. x/z only — each model's
  // grounded Y (set by fitAndPlace) is captured once it loads and reapplied
  // every frame, so the walk never fights the floor placement.
  const WALK_START = 1.0;
  const WALK_DURATION = 3.2;
  const WALK_FROM_XZ = [-4.2, 1.4];
  const WALK_TO_XZ = [0.55, 0.9];
  const PHONE_FROM_XZ = [-4.0, 2.4];
  const PHONE_TO_XZ = [0.78, 1.0];
  const PHONE_HELD_HEIGHT = 1.15; // raised to roughly chest/hand height once arrived

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const lerp = (a, b, e) => a + (b - a) * e;

  let raf = 0;
  const clock = new THREE.Clock();
  function tick() {
    raf = requestAnimationFrame(tick);
    const t = clock.getElapsedTime();

    if (!userDriving && performance.now() > userDriveUntil) {
      const angle = t * ORBIT_SPEED;
      camera.position.set(
        CENTER.x + Math.sin(angle) * ORBIT_RADIUS,
        CENTER.y + ORBIT_HEIGHT + Math.sin(t * 0.15) * 0.25,
        CENTER.z + Math.cos(angle) * ORBIT_RADIUS,
      );
    }
    controls.update();

    if (character) {
      const walkT = Math.min(1, Math.max(0, (t - WALK_START) / WALK_DURATION));
      const e = easeOutCubic(walkT);
      const bob = walkT < 1 && !reduced() ? Math.abs(Math.sin(t * 6.5)) * 0.06 * (1 - e) : 0;
      character.position.set(
        lerp(WALK_FROM_XZ[0], WALK_TO_XZ[0], e),
        character.userData.groundY + bob,
        lerp(WALK_FROM_XZ[1], WALK_TO_XZ[1], e),
      );
      character.rotation.y = Math.PI * 0.35 * (1 - e); // turns to face the room as it arrives
      if (!reduced()) character.rotation.z = Math.sin(t * 1.4) * 0.01; // a breathing idle once arrived

      if (phone) {
        phone.position.set(
          lerp(PHONE_FROM_XZ[0], PHONE_TO_XZ[0], e),
          lerp(phone.userData.groundY, PHONE_HELD_HEIGHT, e),
          lerp(PHONE_FROM_XZ[1], PHONE_TO_XZ[1], e),
        );
        phone.rotation.set(-0.15, Math.PI * 0.15, 0.08);
        const litT = Math.min(1, Math.max(0, (walkT - 0.85) / 0.15));
        glowMat.opacity = litT * 0.85;
      }
    }

    renderer.render(scene, camera);
  }

  function playing() { return !document.hidden; }
  ready.finally(() => {
    if (reduced()) {
      // Settle straight to the final pose without animating.
      if (character) character.position.set(WALK_TO_XZ[0], character.userData.groundY, WALK_TO_XZ[1]);
      if (phone) { phone.position.set(PHONE_TO_XZ[0], PHONE_HELD_HEIGHT, PHONE_TO_XZ[1]); glowMat.opacity = 0.85; }
      resize(); controls.update(); renderer.render(scene, camera);
    } else {
      tick();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!playing()) cancelAnimationFrame(raf);
    else if (!reduced()) tick();
  });
}
