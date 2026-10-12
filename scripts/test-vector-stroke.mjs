/** node --experimental-strip-types --test scripts/test-vector-stroke.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bezierNodesToPolyline, fitBezierNodes, moveHandle, moveNode, simplifyPoints, vectorizeStroke,
} from '../src/lib/suites/motion/vectorStroke.ts';

function withPressure(pts) { return pts.map(([x, y]) => ({ x, y, pressure: 0.6 })); }

test('simplifyPoints keeps a straight line down to its two endpoints', () => {
  const pts = withPressure(Array.from({ length: 50 }, (_, i) => [i * 2, i * 2]));
  const simplified = simplifyPoints(pts, 0.5);
  assert.equal(simplified.length, 2);
  assert.deepEqual(simplified[0], pts[0]);
  assert.deepEqual(simplified[simplified.length - 1], pts[pts.length - 1]);
});

test('simplifyPoints keeps real corners — a right-angle bend does not collapse to a straight line', () => {
  const pts = withPressure([[0, 0], [10, 0], [20, 0], [20, 10], [20, 20]]);
  const simplified = simplifyPoints(pts, 0.5);
  assert.ok(simplified.length >= 3, 'the corner at (20,0) must survive');
});

test('simplifyPoints never drops the first or last point, any epsilon', () => {
  const pts = withPressure([[0, 0], [5, 8], [12, 3], [20, 20]]);
  for (const eps of [0, 1, 5, 50]) {
    const s = simplifyPoints(pts, eps);
    assert.deepEqual(s[0], pts[0], `eps=${eps}`);
    assert.deepEqual(s[s.length - 1], pts[pts.length - 1], `eps=${eps}`);
  }
});

test('fitBezierNodes gives the first and last node no in/out handle respectively (open curve ends)', () => {
  const nodes = fitBezierNodes(withPressure([[0, 0], [10, 5], [20, 0]]));
  assert.equal(nodes[0].inX, null);
  assert.equal(nodes[nodes.length - 1].outX, null);
  assert.notEqual(nodes[0].outX, null);
  assert.notEqual(nodes[nodes.length - 1].inX, null);
});

test('bezierNodesToPolyline passes exactly through every anchor (Catmull-Rom guarantee)', () => {
  const nodes = fitBezierNodes(withPressure([[0, 0], [10, 20], [30, 0], [40, 15]]));
  const poly = bezierNodesToPolyline(nodes, 10);
  for (const n of nodes) {
    const hit = poly.some((p) => Math.abs(p.x - n.x) < 1e-6 && Math.abs(p.y - n.y) < 1e-6);
    assert.ok(hit, `anchor (${n.x},${n.y}) should be exactly on the sampled curve`);
  }
});

test('a single-point stroke still produces one node and one polyline point', () => {
  const nodes = fitBezierNodes(withPressure([[5, 5]]));
  assert.equal(nodes.length, 1);
  const poly = bezierNodesToPolyline(nodes);
  assert.equal(poly.length, 1);
  assert.deepEqual(poly[0], { x: 5, y: 5, pressure: 0.6 });
});

test('moveNode drags the anchor and carries its handles along by the same delta (shape preserved)', () => {
  const nodes = fitBezierNodes(withPressure([[0, 0], [10, 10], [20, 0]]));
  const mid = nodes[1];
  const handleOffsetBefore = { dx: mid.outX - mid.x, dy: mid.outY - mid.y };
  const moved = moveNode(nodes, mid.id, 50, 50);
  const newMid = moved.find((n) => n.id === mid.id);
  assert.equal(newMid.x, 50);
  assert.equal(newMid.y, 50);
  assert.ok(Math.abs((newMid.outX - newMid.x) - handleOffsetBefore.dx) < 1e-9, 'handle offset from the anchor should be unchanged');
});

test('moveHandle reshapes the curve without moving the anchor (a true reshape)', () => {
  const nodes = fitBezierNodes(withPressure([[0, 0], [10, 10], [20, 0]]));
  const mid = nodes[1];
  const reshaped = moveHandle(nodes, mid.id, 'out', 200, 200);
  const newMid = reshaped.find((n) => n.id === mid.id);
  assert.equal(newMid.x, mid.x, 'anchor position must not move');
  assert.equal(newMid.outX, 200);
  assert.equal(newMid.outY, 200);
  const before = bezierNodesToPolyline(nodes, 20);
  const after = bezierNodesToPolyline(reshaped, 20);
  assert.notDeepEqual(before, after, 'the sampled curve must actually change shape');
});

test('vectorizeStroke end to end: a wobbly hand-drawn line becomes a clean, much shorter node list', () => {
  const wobble = [];
  for (let i = 0; i < 300; i++) wobble.push([i, Math.sin(i / 8) * 1.2]); // near-straight with tiny jitter
  const nodes = vectorizeStroke(withPressure(wobble), 2);
  assert.ok(nodes.length < 20, `expected heavy simplification of a near-straight line, got ${nodes.length} nodes`);
  assert.ok(nodes.length >= 2);
});
