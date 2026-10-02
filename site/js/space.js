/**
 * The solar system, placed by the real date.
 *
 * Where each planet is comes from ephemeris.js (JPL's published orbit tables). The Earth is
 * turned to the real time of day, lit by the real Sun, and the Moon sits on the real side
 * of it with its real phase. Planet sizes are enlarged — at true size every planet would be
 * a speck — and the page says so. Directions and the order of things are real.
 *
 * Two views: "easy" squeezes the distances so all nine planets fit on a phone screen;
 * "true" keeps every distance in proportion, which shows how empty space really is.
 */
import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/examples/OrbitControls.js';
import { PLANET_IDS, centuries, planetPosition, orbitPath, moonPosition, moonPhase, lightMinutes, AU_KM } from './ephemeris.js';

const $ = (s) => document.querySelector(s);
const RAD = Math.PI / 180;

/* ---------------- what we know about each body ---------------- */
const BODY = {
  sun: { name: 'Sun', size: 3.4, type: 'Star', radiusKm: 695700, year: '—', day: '25 Earth days at the equator', moons: '—', blurb: 'A ball of hydrogen and helium that holds 99.8% of all the mass in the solar system. Everything below circles it.' },
  mercury: { name: 'Mercury', size: 0.55, tilt: 0.03, spinDays: 58.646, tex: 'mercury', type: 'Planet', radiusKm: 2439.7, year: '88 days', day: '59 Earth days', moons: '0', blurb: 'The smallest planet and the closest to the Sun — scorching by day, freezing by night.' },
  venus: { name: 'Venus', size: 0.95, tilt: 177.4, spinDays: -243.02, tex: 'venus', type: 'Planet', radiusKm: 6051.8, year: '225 days', day: '243 Earth days, backwards', moons: '0', blurb: 'Wrapped in thick clouds of carbon dioxide, it is hotter than Mercury: about 465 °C at the surface.' },
  earth: { name: 'Earth', size: 1.0, tilt: 23.44, type: 'Planet', radiusKm: 6371, year: '365.25 days', day: '23 h 56 min', moons: '1', blurb: 'The only world we know has life. This globe is turned to the real time and lit by the real Sun — the night side shows city lights.' },
  mars: { name: 'Mars', size: 0.72, tilt: 25.19, spinDays: 1.026, tex: 'mars', type: 'Planet', radiusKm: 3389.5, year: '687 days', day: '24 h 37 min', moons: '2', blurb: 'A cold red desert with the tallest volcano in the solar system, Olympus Mons.' },
  jupiter: { name: 'Jupiter', size: 2.7, tilt: 3.13, spinDays: 0.4135, tex: 'jupiter', type: 'Planet', radiusKm: 69911, year: '11.9 years', day: '9 h 56 min', moons: '95+', blurb: 'More than twice as heavy as all the other planets put together. Its Great Red Spot is a storm bigger than Earth.' },
  saturn: { name: 'Saturn', size: 2.3, tilt: 26.73, spinDays: 0.444, tex: 'saturn', type: 'Planet', radiusKm: 58232, year: '29.5 years', day: '10 h 33 min', moons: '270+', blurb: 'Famous for rings of billions of pieces of ice. It is less dense than water. (The surface colours here are drawn to look right, not photographed.)' },
  uranus: { name: 'Uranus', size: 1.6, tilt: 97.77, spinDays: -0.718, tex: 'uranus', type: 'Planet', radiusKm: 25362, year: '84 years', day: '17 h 14 min, backwards', moons: '28', blurb: 'An ice giant knocked onto its side, so it rolls around the Sun like a ball.' },
  neptune: { name: 'Neptune', size: 1.55, tilt: 28.32, spinDays: 0.671, tex: 'neptune', type: 'Planet', radiusKm: 24622, year: '165 years', day: '16 h 6 min', moons: '16', blurb: 'The farthest planet, with the fastest winds measured anywhere in the solar system. (Colours drawn to look right, not photographed.)' },
  pluto: { name: 'Pluto', size: 0.38, tilt: 122.5, spinDays: -6.387, color: 0xb59c86, type: 'Dwarf planet', radiusKm: 1188.3, year: '248 years', day: '6.4 Earth days, backwards', moons: '5', blurb: 'A dwarf planet out in the Kuiper belt. Its tilted orbit swings inside Neptune’s at its closest.' },
  moon: { name: 'Moon', size: 0.27, tex: 'moon', type: 'Moon of Earth', radiusKm: 1737.4, year: '27.3 days around Earth', day: 'Always shows us the same face', moons: '—', blurb: 'Drawn from NASA’s Lunar Reconnaissance Orbiter map. It sits on the real side of Earth, with its real phase, but much closer in than true scale.' },
};
const FOCUS = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const TEX = ['sun', 'mercury', 'venus', 'earth_day', 'earth_night', 'earth_clouds', 'moon', 'mars', 'jupiter', 'saturn', 'saturn_ring', 'uranus', 'neptune', 'milkyway'];

/* ---------------- state ---------------- */
let renderer, scene, camera, controls, loaded = false;
const bodies = {}; // id -> { group, mesh, size, label }
const state = { mode: 'easy', speed: 0, live: true, simMs: Date.now(), focus: null, showOrbits: true, showLabels: true };
let orbitLines = {};
let flyTo = null;
let sunLight;
let visible = false;
let last = 0;
let spinAcc = 0;
let earthMat;

const easyR = (r) => 11 * Math.sqrt(r);
const trueR = (r) => 60 * r;
const scaleFor = (r) => (state.mode === 'easy' ? easyR(r) : trueR(r)) / Math.max(r, 1e-9);
const sizeOf = (id) => BODY[id].size * (state.mode === 'easy' ? 1 : id === 'sun' ? 0.35 : 0.4);

/** Ecliptic (x, y, z) in AU → scene coordinates (y up), distances squeezed or true. */
function toScene(v, out = new THREE.Vector3()) {
  const r = Math.hypot(v.x, v.y, v.z);
  const k = r > 0 ? scaleFor(r) : 1;
  return out.set(v.x * k, v.z * k, -v.y * k);
}

/* ---------------- building the scene ---------------- */
function loadTextures() {
  const manager = new THREE.LoadingManager();
  const loader = new THREE.TextureLoader(manager);
  const tex = {};
  const aniso = renderer.capabilities.getMaxAnisotropy();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(tex); } };
    manager.onLoad = finish;
    setTimeout(finish, 12000);
    for (const name of TEX) {
      const t = loader.load(`/textures/${name}.${name === 'saturn_ring' ? 'png' : 'jpg'}`);
      t.anisotropy = Math.min(8, aniso);
      if (name !== 'earth_clouds') t.colorSpace = THREE.SRGBColorSpace;
      tex[name] = t;
    }
  });
}

function glowSprite(color, scale) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, `rgba(${color},1)`); grd.addColorStop(0.25, `rgba(${color},.55)`); grd.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(scale);
  return s;
}

const EARTH_VERT = `
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const EARTH_FRAG = `
uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D cloudMap; uniform vec3 sunDir; uniform float time;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
  float d = dot(N, sunDir);
  vec3 day = texture2D(dayMap, vUv).rgb; vec3 night = texture2D(nightMap, vUv).rgb;
  float cl = texture2D(cloudMap, vUv + vec2(time * 0.0015, 0.0)).r;
  float lit = smoothstep(-0.14, 0.2, d);
  vec3 dayC = mix(day, vec3(1.0), cl * 0.8) * (0.10 + 0.95 * max(d, 0.0));
  vec3 nightC = night * 1.5 * (1.0 - cl * 0.65);
  vec3 col = mix(nightC, dayC, lit);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += vec3(0.25, 0.5, 1.0) * rim * (0.15 + 0.85 * smoothstep(-0.3, 0.4, d)) * 0.9;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const ATMO_FRAG = `
uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
  float f = pow(1.0 - abs(dot(N, V)), 2.6);
  float d = smoothstep(-0.35, 0.35, dot(N, sunDir));
  gl_FragColor = vec4(vec3(0.3, 0.55, 1.0) * f * (0.2 + 0.8 * d), f * (0.15 + 0.85 * d));
  #include <colorspace_fragment>
}`;

function makeBodies(tex) {
  const sphere = (r) => new THREE.SphereGeometry(r, 56, 36);
  // Sun
  const sun = new THREE.Group();
  const sunMesh = new THREE.Mesh(sphere(1), new THREE.MeshBasicMaterial({ map: tex.sun, color: 0xffd9a0 }));
  sun.add(sunMesh);
  const glow = glowSprite('255,170,70', 4.2); sun.add(glow);
  const glow2 = glowSprite('255,120,40', 9); glow2.material.opacity = 0.35; sun.add(glow2);
  scene.add(sun);
  bodies.sun = { group: sun, mesh: sunMesh, glow, glow2, id: 'sun' };

  for (const id of PLANET_IDS) {
    const cfg = BODY[id];
    const group = new THREE.Group();           // position
    const tilt = new THREE.Group();            // axial tilt
    tilt.rotation.x = (cfg.tilt ?? 0) * RAD;
    group.add(tilt);
    let mesh;
    if (id === 'earth') {
      earthMat = new THREE.ShaderMaterial({
        uniforms: { dayMap: { value: tex.earth_day }, nightMap: { value: tex.earth_night }, cloudMap: { value: tex.earth_clouds }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, time: { value: 0 } },
        vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG,
      });
      mesh = new THREE.Mesh(sphere(1), earthMat);
      const atmo = new THREE.Mesh(sphere(1.07), new THREE.ShaderMaterial({ uniforms: { sunDir: earthMat.uniforms.sunDir }, vertexShader: EARTH_VERT, fragmentShader: ATMO_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      tilt.add(atmo);
    } else {
      mesh = new THREE.Mesh(sphere(1), new THREE.MeshStandardMaterial({ map: cfg.tex ? tex[cfg.tex] : null, color: cfg.color ?? 0xffffff, roughness: 1, metalness: 0 }));
    }
    tilt.add(mesh);
    if (id === 'saturn') {
      const geo = new THREE.RingGeometry(1.24, 2.3, 160, 1);
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i += 1) { const r = Math.hypot(pos.getX(i), pos.getY(i)); uv.setXY(i, (r - 1.24) / (2.3 - 1.24), 0.5); }
      const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex.saturn_ring, side: THREE.DoubleSide, transparent: true, depthWrite: false, color: 0xe8dcc8 }));
      ring.rotation.x = -Math.PI / 2;
      tilt.add(ring);
    }
    scene.add(group);
    bodies[id] = { group, mesh, tilt, id };
  }

  // Moon
  const moon = new THREE.Mesh(sphere(1), new THREE.MeshStandardMaterial({ map: tex.moon, roughness: 1 }));
  scene.add(moon);
  bodies.moon = { group: moon, mesh: moon, id: 'moon' };
}

function buildOrbits() {
  for (const l of Object.values(orbitLines)) { scene.remove(l); l.geometry.dispose(); l.material.dispose(); }
  orbitLines = {};
  const T = centuries(new Date(state.simMs));
  for (const id of PLANET_IDS) {
    const pts = orbitPath(id, T, 320).map((p) => toScene(p));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x9fb6e8, transparent: true, opacity: 0.28, depthWrite: false }));
    line.visible = state.showOrbits;
    scene.add(line);
    orbitLines[id] = line;
  }
  highlightOrbit();
}
function highlightOrbit() {
  for (const [id, l] of Object.entries(orbitLines)) { l.material.opacity = id === state.focus ? 0.9 : 0.28; l.material.color.set(id === state.focus ? 0xffa45c : 0x9fb6e8); }
}

/* ---------------- labels ---------------- */
function makeLabels() {
  const host = $('#space-labels');
  for (const id of FOCUS) {
    const b = document.createElement('button');
    b.className = 'sp-label'; b.textContent = BODY[id].name; b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); select(id); });
    host.append(b);
    bodies[id].label = b;
  }
}
const tmp = new THREE.Vector3();
function placeLabels() {
  const stage = $('#space-stage');
  const w = stage.clientWidth, h = stage.clientHeight;
  for (const id of FOCUS) {
    const b = bodies[id]; if (!b.label) continue;
    b.group.getWorldPosition(tmp);
    tmp.y += b.group.scale.x * 1.25;
    tmp.project(camera);
    const hideMoon = id === 'moon' && state.focus !== 'earth' && state.focus !== 'moon';
    const on = state.showLabels && !hideMoon && tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    b.label.style.display = on ? '' : 'none';
    if (on) b.label.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -100%)`;
    b.label.classList.toggle('on', id === state.focus);
  }
}

/* ---------------- time → positions ---------------- */
const pos = {}; // id -> Vector3 (scene)
function update(dt) {
  if (state.live && state.speed === 0) state.simMs = Date.now();
  else state.simMs += dt * state.speed * 86400000;
  const date = new Date(state.simMs);
  const T = centuries(date);
  const jd = date.getTime() / 86400000 + 2440587.5;

  const ecl = {};
  for (const id of PLANET_IDS) ecl[id] = planetPosition(id, T);
  const fast = Math.abs(state.speed) > 2;
  spinAcc += dt * 0.25;

  const sunS = sizeOf('sun');
  bodies.sun.group.scale.setScalar(sunS);
  bodies.sun.mesh.rotation.y += dt * 0.02;
  bodies.sun.glow.scale.setScalar(2.7); bodies.sun.glow2.scale.setScalar(5.5); // local units: the group already carries the Sun's size
  pos.sun = bodies.sun.group.position;

  for (const id of PLANET_IDS) {
    const b = bodies[id], cfg = BODY[id];
    toScene(ecl[id], b.group.position);
    pos[id] = b.group.position;
    b.group.scale.setScalar(Math.max(sizeOf(id), camera.position.distanceTo(b.group.position) * 0.0035));
    if (id === 'earth') {
      const gmst = (280.46061837 + 360.98564736629 * (jd - 2451545.0)) * RAD;
      b.mesh.rotation.y = fast ? spinAcc : gmst;
      earthMat.uniforms.sunDir.value.copy(b.group.position).multiplyScalar(-1).normalize();
      earthMat.uniforms.time.value = performance.now() / 1000;
    } else {
      b.mesh.rotation.y = fast ? spinAcc * (cfg.spinDays < 0 ? -1 : 1) : ((jd - 2451545.0) / cfg.spinDays) * 2 * Math.PI;
    }
  }

  // Moon: real direction and phase, pulled in so it does not sit inside the Earth's glow.
  const m = moonPosition(T);
  const dir = new THREE.Vector3(m.x, m.z, -m.y).normalize();
  const eS = sizeOf('earth');
  const mm = bodies.moon.group;
  const dSun = camera.position.length();
  const g = Math.min(1, Math.max(0.12, dSun / (sunS * 9)));
  bodies.sun.glow.material.opacity = Math.max(0.3, g); bodies.sun.glow2.material.opacity = 0.35 * g;
  mm.position.copy(bodies.earth.group.position).addScaledVector(dir, eS * (state.mode === 'easy' ? 3.1 : 4.2));
  mm.scale.setScalar(Math.max(sizeOf('moon'), camera.position.distanceTo(mm.position) * 0.0025));
  mm.rotation.y = Math.atan2(dir.z, -dir.x); // near side (local +x) toward Earth
  pos.moon = mm.position;

  return { date, ecl, moon: m };
}

/* ---------------- selection + info ---------------- */
const fmtNum = (n, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
let latest = null;
function infoHTML(id) {
  if (!id) return '<h4>Tap a planet</h4><p>Drag to look around, pinch to zoom, and tap any name to fly there.</p>';
  const c = BODY[id];
  let rows = `<dt>Type</dt><dd>${c.type}</dd><dt>Radius</dt><dd>${fmtNum(c.radiusKm, c.radiusKm < 5000 ? 1 : 0)} km</dd><dt>Year</dt><dd>${c.year}</dd><dt>Day</dt><dd>${c.day}</dd>`;
  if (c.moons !== '—') rows += `<dt>Moons</dt><dd>${c.moons}</dd>`;
  if (latest) {
    if (id === 'moon') {
      const phase = moonPhase(latest.date);
      const lit = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
      rows += `<dt>From Earth</dt><dd>${fmtNum(latest.moon.distKm)} km · light ${(latest.moon.distKm / 299792.458).toFixed(2)} s</dd><dt>Lit now</dt><dd>${Math.round(lit * 100)}% · ${phase < 0.5 ? 'waxing' : 'waning'}</dd>`;
    } else if (id !== 'sun') {
      const p = latest.ecl[id], e = latest.ecl.earth;
      const fromEarth = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
      rows += `<dt>From Sun</dt><dd>${p.r.toFixed(3)} AU · ${fmtNum(p.r * AU_KM / 1e6, 1)} M km · light ${lightMinutes(p.r).toFixed(1)} min</dd>`;
      if (id !== 'earth') rows += `<dt>From Earth</dt><dd>${fromEarth.toFixed(3)} AU · ${fmtNum(fromEarth * AU_KM / 1e6, 1)} M km · light ${lightMinutes(fromEarth).toFixed(1)} min</dd>`;
    } else {
      rows += `<dt>Earth is</dt><dd>${latest.ecl.earth.r.toFixed(4)} AU away · light ${lightMinutes(latest.ecl.earth.r).toFixed(2)} min</dd>`;
    }
  }
  return `<h4>${c.name}</h4><dl>${rows}</dl><p>${c.blurb}</p>`;
}

function select(id, { fly = true } = {}) {
  state.focus = id;
  highlightOrbit();
  document.querySelectorAll('#space-ui [data-f]').forEach((b) => b.classList.toggle('on', (b.dataset.f || '') === (id || '')));
  if (fly) flyTo = { dist: id ? Math.max(sizeOf(id) * (id === 'saturn' ? 7.5 : id === 'sun' ? 5 : 5.8), 1.6) : overviewDist() };
  paintInfo();
}
const aspect = () => Math.min(1.4, camera.aspect || 1);
const overviewDist = () => (state.mode === 'easy' ? 150 / aspect() : 4200 / aspect());
function paintInfo() { $('#space-info').innerHTML = infoHTML(state.focus); }

/* ---------------- ui ---------------- */
function buildUI() {
  const ui = $('#space-ui');
  const mk = (txt, attrs = {}, on) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chipbtn'; b.textContent = txt; Object.assign(b.dataset, attrs); b.addEventListener('click', on); return b; };
  const row1 = document.createElement('div'); row1.className = 'ui-row';
  row1.append(mk('Overview', { f: '' }, () => select(null)));
  for (const id of FOCUS) row1.append(mk(BODY[id].name, { f: id }, () => select(id)));
  const row2 = document.createElement('div'); row2.className = 'ui-row';
  const orb = mk('Orbits', {}, () => { state.showOrbits = !state.showOrbits; orb.classList.toggle('on', state.showOrbits); Object.values(orbitLines).forEach((l) => { l.visible = state.showOrbits; }); });
  const lab = mk('Names', {}, () => { state.showLabels = !state.showLabels; lab.classList.toggle('on', state.showLabels); });
  const tru = mk('True distances', {}, () => {
    state.mode = state.mode === 'easy' ? 'true' : 'easy';
    tru.classList.toggle('on', state.mode === 'true');
    buildOrbits();
    flyTo = { dist: state.focus ? Math.max(sizeOf(state.focus) * (state.focus === 'saturn' ? 7.5 : 5.8), 1.6) : overviewDist() };
    const note = $('#space-info');
    if (state.mode === 'true' && !state.focus) note.innerHTML = '<h4>True distances</h4><p>Everything is now in proportion — Earth to Sun is 60 units, Neptune is 1,800. The inner planets are specks. Tap <b>Earth</b> to fly in.</p>';
    else paintInfo();
  });
  orb.classList.add('on'); lab.classList.add('on');
  row2.append(orb, lab, tru);
  ui.append(row1, row2);
}

function buildTime() {
  const date = $('#sp-date'), now = $('#sp-now'), speeds = [...document.querySelectorAll('#sp-speed button')];
  const setSpeed = (v) => { state.speed = v; speeds.forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === v && (v !== 0 || state.live))); };
  speeds.forEach((b) => b.addEventListener('click', () => {
    const v = Number(b.dataset.v);
    if (v === 0) { state.live = true; state.simMs = Date.now(); buildOrbits(); } else state.live = false;
    setSpeed(v);
  }));
  now.addEventListener('click', () => { state.live = true; state.simMs = Date.now(); setSpeed(0); buildOrbits(); });
  date.addEventListener('change', () => {
    const t = Date.parse(`${date.value}T12:00:00Z`);
    if (Number.isNaN(t)) return;
    state.live = false; state.simMs = t; setSpeed(0); buildOrbits();
  });
  date.min = '1800-01-01'; date.max = '2050-12-31';
}

let lastReadout = '';
function readout(info) {
  const d = info.date;
  const iso = d.toISOString();
  const dateEl = $('#sp-date');
  if (document.activeElement !== dateEl && dateEl.value !== iso.slice(0, 10)) dateEl.value = iso.slice(0, 10);
  const e = info.ecl.earth;
  const text = `${iso.slice(0, 16).replace('T', ' ')} UT · Earth–Sun <b>${e.r.toFixed(4)} AU</b> · light <b>${lightMinutes(e.r).toFixed(2)} min</b>`;
  if (text !== lastReadout) { $('#sp-readout').innerHTML = text; lastReadout = text; }
}

/* ---------------- loop ---------------- */
const follow = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  if (!visible || document.hidden || !loaded) { last = now; return; }
  const dt = Math.min(0.1, (now - last) / 1000 || 0.016); last = now;
  latest = update(dt);

  // camera follows the focused body (or drifts back to the Sun for the overview)
  const goal = state.focus ? pos[state.focus] : follow.set(0, 0, 0);
  const delta = tmp.copy(goal).sub(controls.target);
  const k = state.focus ? 1 : Math.min(1, dt * 3);
  controls.target.addScaledVector(delta, k);
  camera.position.addScaledVector(delta, k);
  if (flyTo) {
    const off = camera.position.clone().sub(controls.target);
    const len = off.length();
    const nl = len + (flyTo.dist - len) * Math.min(1, dt * 3.2);
    camera.position.copy(controls.target).add(off.setLength(nl));
    if (Math.abs(nl - flyTo.dist) < flyTo.dist * 0.01) flyTo = null;
  }
  const dist = camera.position.distanceTo(controls.target);
  camera.near = Math.max(0.02, dist * 0.02);
  camera.updateProjectionMatrix();
  controls.minDistance = state.focus ? sizeOf(state.focus) * 1.5 : 2;
  controls.update();
  sky.position.copy(camera.position);

  readout(latest);
  if (Math.floor(now / 1000) !== Math.floor((now - dt * 1000) / 1000) && state.focus) paintInfo();
  renderer.render(scene, camera);
  placeLabels();
}

let sky;
export async function start() {
  const canvas = $('#space-canvas'), stage = $('#space-stage');
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch {
    $('#space-loading').textContent = 'This device could not start 3D. The NASA data below still works.';
    return;
  }
  // A phone can take the GL context away (low memory, app switch). Say so and recover when it comes back.
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); $('#space-loading').textContent = 'The 3D view paused — scroll away and back to wake it.'; $('#space-loading').classList.remove('gone'); });
  canvas.addEventListener('webglcontextrestored', () => $('#space-loading').classList.add('gone'));
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(48, 1, 0.1, 60000);
  camera.position.set(0, 120, 110);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.07; controls.maxDistance = 25000; controls.zoomSpeed = 0.9;
  controls.addEventListener('start', () => { flyTo = null; });

  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    // on a phone the info card covers the bottom; shift the picture up so the planet stays clear of it
    if (w < 700) camera.setViewOffset(w, h, 0, h * 0.13, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(stage); resize();
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.02 }).observe(stage);

  const tex = await loadTextures();
  sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 32), new THREE.MeshBasicMaterial({ map: tex.milkyway, side: THREE.BackSide, color: 0x8a93a8, depthWrite: false }));
  sky.rotation.x = 60.2 * RAD; // roughly puts the galactic plane where it really is relative to the ecliptic
  scene.add(sky);
  scene.add(new THREE.AmbientLight(0x1d2740, 0.9));
  sunLight = new THREE.PointLight(0xfff1dd, 38000, 0, 2);
  scene.add(sunLight);
  makeBodies(tex);
  makeLabels(); buildUI(); buildTime(); buildOrbits();
  // physical lights fall off with distance²; scale by the squeezed distance so every planet is evenly lit
  scene.traverse((o) => { if (o.isMesh && o.material?.isMeshStandardMaterial) o.material.envMapIntensity = 0; });
  sunLight.decay = 0; sunLight.intensity = 5.5;

  // touch: let the page scroll until the visitor chooses to explore the sky
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse) lockForScroll(stage, canvas);

  // tap on a planet to select it
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 450) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(FOCUS.map((id) => bodies[id].mesh), false);
    if (hits.length) { const id = FOCUS.find((i) => bodies[i].mesh === hits[0].object); if (id) select(id); }
  });

  state.focus = null;
  paintInfo();
  select(null, { fly: false });
  loaded = true; visible = true;
  requestAnimationFrame(frame);
  $('#space-loading').classList.add('gone');
  // expose for tests / the console
  window.__space = { state, select, bodies };
}

function lockForScroll(stage, canvas) {
  const hint = document.createElement('button');
  hint.type = 'button'; hint.className = 'explore-hint'; hint.textContent = '✋ Tap to explore the sky';
  stage.append(hint);
  const done = document.createElement('button');
  done.type = 'button'; done.className = 'chipbtn explore-done'; done.textContent = '✕ done'; done.hidden = true;
  document.querySelectorAll('#space-ui .ui-row')[1].append(done);
  const set = (unlocked) => { canvas.style.touchAction = unlocked ? 'none' : 'pan-y'; controls.enabled = unlocked; hint.hidden = unlocked; done.hidden = !unlocked; };
  set(false);
  hint.addEventListener('click', () => set(true));
  done.addEventListener('click', () => set(false));
}
