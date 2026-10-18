/**
 * The site's 3D story: a room assembles, the camera drifts around it like an
 * establishing shot, then a character walks in, sits on the sofa, turns the
 * TV on (a flashing ad, then the Chomugiri brand), picks up their phone, and
 * types the exact request Chomugiri would actually build. Every model here
 * is a real generated asset (Tripo-class image-to-3D, downsized for the web
 * — see assets/3d/README.md), not a placeholder.
 *
 * Kept separate from model3d.js (the small code-built icon in the feature
 * list) — this is the hero-scale piece, heavier and only started when its
 * canvas is actually on screen.
 */
import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/examples/OrbitControls.js';
import { GLTFLoader } from '/vendor/three/examples/GLTFLoader.js';
import { typeInto } from './type.js';

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
const CENTER = new THREE.Vector3(-0.6, 1.0, -1.0);
const ORBIT_RADIUS = 4.6;
const ORBIT_HEIGHT = 1.9;
const ORBIT_SPEED = 0.06; // radians/sec — a slow drift, not a spin

// ── The whole sequence, as named phases on one timeline (seconds from the
// canvas becoming visible). Each later phase starts where the one before it
// settles, so moving one duration does not have to re-time everything after
// it by hand. ──────────────────────────────────────────────────────────────
const WALK_START = 1.0, WALK_DUR = 3.0;
const SIT_START = WALK_START + WALK_DUR, SIT_DUR = 0.9;
const TV_ON_START = SIT_START + SIT_DUR + 0.4, TV_ON_DUR = 0.4;
const TV_AD_START = TV_ON_START + TV_ON_DUR, TV_AD_DUR = 2.6;
const TV_BRAND_START = TV_AD_START + TV_AD_DUR, TV_BRAND_DUR = 1.8;
const PHONE_START = TV_BRAND_START + TV_BRAND_DUR + 0.3, PHONE_DUR = 1.6;
const PROMPT_START = PHONE_START + PHONE_DUR + 0.3;
const PROMPT_TEXT = 'Make me a racing game';

const WALK_FROM_XZ = [-4.2, 1.4];
const STAND_XZ = [-0.75, -0.55]; // in front of the sofa, facing it
const SIT_XZ = [-1.15, -0.85]; // settled into the seat cushion
const SIT_DROP = 0.5; // how far the rigid body sinks to read as "seated" — a stand-in for knee/hip bend a static mesh cannot do
const PHONE_REST_OFFSET = [0.28, -0.32, 0.1]; // relative to the character, resting on their lap
const PHONE_HELD_OFFSET = [0.22, 0.42, 0.28]; // relative to the character, raised to read it

const phase = (t, start, dur) => Math.min(1, Math.max(0, (t - start) / dur));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, e) => a + (b - a) * e;

export function start() {
  const canvas = $('#story-canvas');
  const card = $('#story-card');
  const bubble = $('#story-bubble');
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
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);
  // The TV is the only other light source in the story — its glow should
  // actually tint the room once it is "on", or the whole beat reads as inert.
  const tvBounce = new THREE.PointLight(0xff8a3d, 0, 4, 2);
  tvBounce.position.set(0, 1.0, -2.2);
  scene.add(tvBounce);

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

  // ── The TV screen: a canvas texture drawn fresh each frame while the ad or
  // the brand beat is playing, idle (and dark) otherwise — cheaper than a
  // video element and gives full control over the two beats it needs to show.
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 256; screenCanvas.height = 160;
  const screenCtx = screenCanvas.getContext('2d');
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const tvScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.56),
    new THREE.MeshBasicMaterial({ map: screenTex, transparent: true, opacity: 0 }),
  );
  tvScreen.position.set(0, 1.0, -2.29);
  root.add(tvScreen);

  function drawTvOff() {
    screenCtx.fillStyle = '#05080c';
    screenCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
  }
  function drawTvAd(t) {
    const hue = (t * 140) % 360;
    const grd = screenCtx.createLinearGradient(0, 0, screenCanvas.width, screenCanvas.height);
    grd.addColorStop(0, `hsl(${hue}, 70%, 55%)`);
    grd.addColorStop(1, `hsl(${(hue + 80) % 360}, 70%, 40%)`);
    screenCtx.fillStyle = grd;
    screenCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
    // A couple of blocky "ad" shapes, not real content — it reads as motion at this size.
    screenCtx.fillStyle = 'rgba(255,255,255,0.85)';
    const bw = 40 + 30 * Math.sin(t * 3);
    screenCtx.fillRect(20, 110 + 10 * Math.sin(t * 2.2), bw, 14);
    screenCtx.beginPath();
    screenCtx.arc(190 + 20 * Math.cos(t * 1.7), 50, 22, 0, Math.PI * 2);
    screenCtx.fill();
  }
  function drawTvBrand(e) {
    screenCtx.fillStyle = '#17130f';
    screenCtx.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
    const scale = 0.85 + 0.15 * Math.min(1, e * 3); // a quick pop-in
    screenCtx.save();
    screenCtx.translate(screenCanvas.width / 2, screenCanvas.height / 2);
    screenCtx.scale(scale, scale);
    screenCtx.fillStyle = '#ff8a3d';
    screenCtx.font = '700 34px system-ui, sans-serif';
    screenCtx.textAlign = 'center';
    screenCtx.textBaseline = 'middle';
    screenCtx.shadowColor = 'rgba(255,138,61,0.8)';
    screenCtx.shadowBlur = 18;
    screenCtx.fillText('CHOMUGIRI', 0, -6);
    screenCtx.font = '600 13px system-ui, sans-serif';
    screenCtx.fillStyle = '#f4d9c4';
    screenCtx.shadowBlur = 0;
    screenCtx.fillText('say it. it builds it.', 0, 24);
    screenCtx.restore();
  }
  drawTvOff();

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
      character.userData.standGroundY = character.position.y;
      root.add(character);
    }
    if (phoneScene) {
      phone = phoneScene;
      fitAndPlace(phone, { x: 0, z: 0, targetSize: 0.15 });
      phone.userData.localY = phone.position.y; // the model's own floor offset at this scale
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

  let promptStarted = false;
  function startPrompt() {
    if (promptStarted || !bubble) return;
    promptStarted = true;
    bubble.classList.add('on');
    void typeInto(bubble.querySelector('.story-bubble-text'), PROMPT_TEXT, { speed: 48 });
  }

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
      const walkE = easeOutCubic(phase(t, WALK_START, WALK_DUR));
      const sitE = easeInOutCubic(phase(t, SIT_START, SIT_DUR));
      const bob = walkE < 1 && !reduced() ? Math.abs(Math.sin(t * 6.5)) * 0.06 * (1 - walkE) : 0;

      // Walking covers off-stage → standing in front of the sofa; sitting
      // then covers standing → seated, as its own phase so the two never blend.
      const x = lerp(lerp(WALK_FROM_XZ[0], STAND_XZ[0], walkE), SIT_XZ[0], sitE);
      const z = lerp(lerp(WALK_FROM_XZ[1], STAND_XZ[1], walkE), SIT_XZ[1], sitE);
      const y = character.userData.standGroundY + bob - SIT_DROP * sitE;
      character.position.set(x, y, z);

      // Faces the room while walking, then the TV once seated.
      const faceRoom = Math.PI * 0.35 * (1 - walkE);
      const faceTv = lerp(0, 0.25, sitE);
      character.rotation.y = faceRoom + faceTv;
      character.rotation.x = -0.12 * sitE; // a slight recline into the cushions
      if (!reduced()) character.rotation.z = Math.sin(t * 1.4) * 0.01 * (1 - sitE * 0.6); // idle breathing, settles once seated

      if (phone) {
        const raiseE = easeInOutCubic(phase(t, PHONE_START, PHONE_DUR));
        const ox = lerp(PHONE_REST_OFFSET[0], PHONE_HELD_OFFSET[0], raiseE);
        const oy = lerp(PHONE_REST_OFFSET[1], PHONE_HELD_OFFSET[1], raiseE);
        const oz = lerp(PHONE_REST_OFFSET[2], PHONE_HELD_OFFSET[2], raiseE);
        phone.position.set(character.position.x + ox, character.userData.standGroundY + phone.userData.localY + oy, character.position.z + oz);
        phone.rotation.set(-0.15 - 0.3 * raiseE, Math.PI * 0.15, 0.08);
        glowMat.opacity = Math.max(0, raiseE - 0.5) * 1.7;
      }
    }

    // The TV: off, then the ad, then the brand beat — each only (re)draws the
    // canvas while it is the active one, so the texture is not re-painted 60
    // times a second for nothing once the beat has passed.
    const onE = phase(t, TV_ON_START, TV_ON_DUR);
    const adE = phase(t, TV_AD_START, TV_AD_DUR);
    const brandE = phase(t, TV_BRAND_START, TV_BRAND_DUR);
    if (t >= TV_ON_START && t < TV_AD_START) { tvScreen.material.opacity = onE; drawTvOff(); screenTex.needsUpdate = true; }
    else if (t >= TV_AD_START && t < TV_BRAND_START) { drawTvAd(t); screenTex.needsUpdate = true; tvScreen.material.opacity = 1; }
    else if (t >= TV_BRAND_START) { drawTvBrand(brandE); screenTex.needsUpdate = brandE < 1 || Math.floor(t * 2) % 2 === 0; tvScreen.material.opacity = 1; }
    tvBounce.intensity = t >= TV_ON_START ? 0.9 + 0.1 * Math.sin(t * 8) : 0;
    ambient.intensity = 0.55 + 0.15 * Math.min(1, onE);

    if (t >= PROMPT_START) startPrompt();

    renderer.render(scene, camera);
  }

  function playing() { return !document.hidden; }
  ready.finally(() => {
    if (reduced()) {
      // Settle straight to the final pose without animating.
      if (character) {
        character.position.set(SIT_XZ[0], character.userData.standGroundY - SIT_DROP, SIT_XZ[1]);
        character.rotation.set(-0.12, 0.25, 0);
      }
      if (phone && character) {
        phone.position.set(
          character.position.x + PHONE_HELD_OFFSET[0],
          character.userData.standGroundY + phone.userData.localY + PHONE_HELD_OFFSET[1],
          character.position.z + PHONE_HELD_OFFSET[2],
        );
        glowMat.opacity = 0.85;
      }
      drawTvBrand(1);
      screenTex.needsUpdate = true;
      tvScreen.material.opacity = 1;
      tvBounce.intensity = 0.9;
      startPrompt();
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
