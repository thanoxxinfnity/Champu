/** node --experimental-strip-types --test scripts/test-motion-studio.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addLayer, easeFn, emptyProject, exportCss, exportGsap, exportHtml, exportZip,
  moveKeyframe, newLayer, removeKeyframe, removeLayer, setKeyframe, updateLayer, valueAt,
} from '../src/lib/suites/motion/project.ts';

test('a new layer starts centred on the stage, with one keyframe at t=0', () => {
  const p = emptyProject();
  const l = newLayer('rect', p);
  assert.equal(l.keyframes.length, 1);
  assert.equal(l.keyframes[0].t, 0);
  assert.equal(l.x, undefined); // position lives on the keyframe, not the layer
  const kf = l.keyframes[0];
  assert.equal(kf.x, Math.round(p.width / 2 - l.w / 2));
  assert.equal(kf.y, Math.round(p.height / 2 - l.h / 2));
});

test('addLayer appends without mutating the original project (pure)', () => {
  const p0 = emptyProject();
  const p1 = addLayer(p0, 'circle');
  assert.equal(p0.layers.length, 0, 'the original is untouched');
  assert.equal(p1.layers.length, 1);
  assert.equal(p1.layers[0].kind, 'circle');
});

test('removeLayer and updateLayer', () => {
  let p = addLayer(emptyProject(), 'text');
  const id = p.layers[0].id;
  p = updateLayer(p, id, { text: 'Hello', color: '#fff' });
  assert.equal(p.layers[0].text, 'Hello');
  p = removeLayer(p, id);
  assert.equal(p.layers.length, 0);
});

test('setKeyframe inserts in time order, and replaces one at (nearly) the same instant', () => {
  let p = addLayer(emptyProject(), 'rect');
  let l = p.layers[0];
  l = setKeyframe(l, 2, { x: 500, y: 100, opacity: 1 });
  l = setKeyframe(l, 1, { x: 250 });
  assert.deepEqual(l.keyframes.map((k) => k.t), [0, 1, 2]);
  l = setKeyframe(l, 1.002, { x: 999 }); // within 1/120s of t=1 — the same key
  assert.equal(l.keyframes.length, 3, 'did not add a fourth keyframe');
  assert.equal(l.keyframes.find((k) => Math.abs(k.t - 1) < 0.01).x, 999);
});

test('a layer always keeps somewhere to be: the last keyframe cannot be removed', () => {
  let p = addLayer(emptyProject(), 'rect');
  let l = p.layers[0];
  const onlyId = l.keyframes[0].id;
  l = removeKeyframe(l, onlyId);
  assert.equal(l.keyframes.length, 1, 'refused to empty the layer');
  l = setKeyframe(l, 2, { x: 10 });
  assert.equal(l.keyframes.length, 2);
  l = removeKeyframe(l, l.keyframes[1].id);
  assert.equal(l.keyframes.length, 1);
});

test('moveKeyframe re-sorts the array', () => {
  let p = addLayer(emptyProject(), 'rect');
  let l = p.layers[0];
  l = setKeyframe(l, 1, { x: 1 });
  l = setKeyframe(l, 2, { x: 2 });
  const first = l.keyframes[0].id; // t=0
  l = moveKeyframe(l, first, 3);
  assert.deepEqual(l.keyframes.map((k) => k.t), [1, 2, 3]);
});

test('easing: linear is identity, easeIn/out stay within 0..1, back and bounce may overshoot on purpose', () => {
  assert.equal(easeFn('linear')(0.37), 0.37);
  for (const name of ['easeIn', 'easeOut', 'easeInOut', 'ease']) {
    const f = easeFn(name);
    for (const p of [0, 0.25, 0.5, 0.75, 1]) assert.ok(f(p) >= -1e-9 && f(p) <= 1 + 1e-9, `${name}(${p})`);
  }
  assert.ok(easeFn('back')(0.8) > 1, 'easeOutBack overshoots past 1 near the end, by design');
});

test('valueAt holds the first keyframe before it starts and the last after it ends', () => {
  let p = addLayer(emptyProject(), 'rect');
  let l = p.layers[0];
  l = setKeyframe(l, 2, { x: 500, y: 0, scale: 2, rotation: 90, opacity: 0.4, easing: 'linear' });
  const before = valueAt(l, -5);
  const start = valueAt(l, 0);
  assert.deepEqual(before, start);
  const after = valueAt(l, 999);
  assert.deepEqual(after, valueAt(l, 2));
});

test('valueAt interpolates linearly at the midpoint with linear easing', () => {
  let p = addLayer(emptyProject(), 'rect');
  let l = p.layers[0];
  l = setKeyframe(l, 0, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, easing: 'linear' });
  l = setKeyframe(l, 2, { x: 100, y: 200, scale: 3, rotation: 90, opacity: 0 });
  const mid = valueAt(l, 1);
  assert.equal(mid.x, 50);
  assert.equal(mid.y, 100);
  assert.equal(mid.scale, 2);
  assert.equal(mid.rotation, 45);
  assert.equal(mid.opacity, 0.5);
});

test('valueAt with easeOut moves faster at the start than a linear ease would, for the same segment', () => {
  let p = addLayer(emptyProject(), 'rect');
  let l = p.layers[0];
  l = setKeyframe(l, 0, { x: 0, easing: 'easeOut' });
  l = setKeyframe(l, 1, { x: 100 });
  const quarterEaseOut = valueAt(l, 0.25).x;
  const quarterLinear = 25;
  assert.ok(quarterEaseOut > quarterLinear, `easeOut (${quarterEaseOut}) should be ahead of linear (${quarterLinear}) early on`);
});

test('two differently-timed layers do not interfere with each other', () => {
  let p = addLayer(emptyProject(), 'rect');
  p = addLayer(p, 'circle');
  let [a, b] = p.layers;
  a = setKeyframe(a, 1, { x: 100 });
  b = setKeyframe(b, 1, { x: -100 });
  assert.notEqual(valueAt(a, 0.5).x, valueAt(b, 0.5).x);
});

test('exportCss: a @keyframes block per layer, stop percentages from t/duration, per-stop easing kept', () => {
  let p = emptyProject();
  p = { ...p, duration: 4, layers: [] };
  p = addLayer(p, 'text');
  p = updateLayer(p, p.layers[0].id, { name: 'Headline', text: 'Hi' });
  let l = p.layers[0];
  l = setKeyframe(l, 2, { x: 300, easing: 'easeIn' });
  p = { ...p, layers: [l] };
  const css = exportCss(p);
  assert.match(css, /@keyframes headline-move/);
  assert.match(css, /0\.00%\{/);
  assert.match(css, /50\.00%\{/); // t=2 of a 4s project
  assert.match(css, /animation-timing-function:cubic-bezier\(\.32,0,\.67,0\)/); // easeIn
  assert.match(css, /\.motion-stage\{position:relative;width:960px;height:540px/);
});

test('exportCss gives two layers with the same name distinct, non-colliding class names', () => {
  let p = emptyProject();
  p = addLayer(p, 'rect');
  p = addLayer(p, 'rect');
  p = updateLayer(p, p.layers[0].id, { name: 'Box' });
  p = updateLayer(p, p.layers[1].id, { name: 'Box' });
  const css = exportCss(p);
  assert.match(css, /\.box\{/);
  assert.match(css, /\.box-2\{/);
});

test('exportGsap: a timeline with a tl.set for the first keyframe and a tl.to per segment, placed at the right time', () => {
  let p = addLayer(emptyProject(), 'rect');
  p = updateLayer(p, p.layers[0].id, { name: 'Ball' });
  let l = p.layers[0];
  l = setKeyframe(l, 0, { x: 0, y: 0, easing: 'bounce' });
  l = setKeyframe(l, 1.5, { x: 400, y: 0 });
  p = { ...p, layers: [l] };
  const js = exportGsap(p);
  assert.match(js, /gsap\.timeline\(\{ repeat: -1 \}\)/);
  assert.match(js, /tl\.set\("#ball", \{ x: 0, y: 0,/);
  assert.match(js, /tl\.to\("#ball", \{ x: 400, y: 0,.*duration: 1\.5, ease: "bounce\.out" \}, 0\);/);
});

test('exportHtml: self-contained, the layer text is escaped, and it names the project in <title>', () => {
  let p = addLayer(emptyProject(), 'text');
  p = { ...p, title: 'A <script> test' };
  p = updateLayer(p, p.layers[0].id, { text: '<b>bold</b> & safe' });
  const html = exportHtml(p);
  assert.match(html, /<title>A &lt;script&gt; test<\/title>/);
  assert.ok(!html.includes('<b>bold</b>'));
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt; &amp; safe/);
  assert.ok(!/<script/.test(html), 'no script tag anywhere — it is a static page');
  assert.match(html, /class="motion-stage"/);
});

test('exportZip bundles the html, css, gsap script and the raw project json', () => {
  const p = addLayer(emptyProject(), 'rect');
  const files = exportZip(p);
  const paths = files.map((f) => f.path);
  assert.ok(paths.some((p2) => p2.endsWith('.html')));
  assert.ok(paths.some((p2) => p2.endsWith('.css')));
  assert.ok(paths.some((p2) => p2.endsWith('.gsap.js')));
  const json = files.find((f) => f.path.endsWith('.json'));
  assert.deepEqual(JSON.parse(json.content), p);
});
