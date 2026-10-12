/**
 * Turns a raw drawn stroke into an editable vector curve — a short list of anchor points with bezier
 * handles, the way Illustrator/Procreate's vector brush reshaping works. The stroke drawn by hand is
 * usually hundreds of points; `simplifyPoints` (Ramer–Douglas–Peucker) throws out the ones a smooth curve
 * doesn't need, then `fitBezierNodes` turns the survivors into anchors with in/out handles (a standard
 * Catmull-Rom → cubic-Bezier conversion, which passes exactly through every anchor — unlike a fitted
 * approximation, there is nothing surprising about where a node ends up). Dragging a node or a handle
 * afterward is just editing this array; `bezierNodesToPolyline` turns it back into points to draw or dab.
 */
import type { StrokePoint } from './brush.ts';

export interface BezierNode {
  id: string;
  x: number;
  y: number;
  /** Incoming control handle, in absolute coordinates (not an offset) — null at the first node. */
  inX: number | null;
  inY: number | null;
  /** Outgoing control handle — null at the last node. */
  outX: number | null;
  outY: number | null;
  pressure: number;
}

function perpendicularDistance(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len);
  const projX = a.x + t * dx, projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/** Ramer–Douglas–Peucker: keep only the points a straight-line approximation within `epsilon` pixels needs. */
export function simplifyPoints(points: StrokePoint[], epsilon: number): StrokePoint[] {
  if (points.length <= 2) return points;
  let maxDist = -1, maxIndex = 0;
  const first = points[0]!, last = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, first, last);
    if (d > maxDist) { maxDist = d; maxIndex = i; }
  }
  if (maxDist > epsilon) {
    const left = simplifyPoints(points.slice(0, maxIndex + 1), epsilon);
    const right = simplifyPoints(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

let nodeCounter = 0;
function newNodeId(): string {
  return `node_${Date.now().toString(36)}${(nodeCounter++).toString(36)}`;
}

/**
 * Simplified points → editable bezier nodes. Handle length is a fraction of the distance to each
 * neighbour (Catmull-Rom's standard tangent estimate), so the curve passes through every anchor smoothly
 * without the caller having to choose handle positions.
 */
export function fitBezierNodes(points: StrokePoint[], tension = 1 / 6): BezierNode[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    const p = points[0]!;
    return [{ id: newNodeId(), x: p.x, y: p.y, inX: null, inY: null, outX: null, outY: null, pressure: p.pressure }];
  }
  const nodes: BezierNode[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    const tangentX = (next.x - prev.x) * tension;
    const tangentY = (next.y - prev.y) * tension;
    nodes.push({
      id: newNodeId(),
      x: p.x,
      y: p.y,
      inX: i === 0 ? null : p.x - tangentX,
      inY: i === 0 ? null : p.y - tangentY,
      outX: i === points.length - 1 ? null : p.x + tangentX,
      outY: i === points.length - 1 ? null : p.y + tangentY,
      pressure: p.pressure,
    });
  }
  return nodes;
}

function cubicAt(p0: number, c0: number, c1: number, p1: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * c0 + 3 * mt * t * t * c1 + t * t * t * p1;
}

/** Dense points along the curve, for drawing or re-dabbing — `samplesPerSegment` controls smoothness. */
export function bezierNodesToPolyline(nodes: BezierNode[], samplesPerSegment = 12): StrokePoint[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) return [{ x: nodes[0]!.x, y: nodes[0]!.y, pressure: nodes[0]!.pressure }];
  const out: StrokePoint[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i]!, b = nodes[i + 1]!;
    const c0x = a.outX ?? a.x, c0y = a.outY ?? a.y;
    const c1x = b.inX ?? b.x, c1y = b.inY ?? b.y;
    const steps = i === nodes.length - 2 ? samplesPerSegment : samplesPerSegment - 1; // avoid duplicating shared endpoints
    for (let s = 0; s <= steps; s++) {
      const t = s / samplesPerSegment;
      out.push({
        x: cubicAt(a.x, c0x, c1x, b.x, t),
        y: cubicAt(a.y, c0y, c1y, b.y, t),
        pressure: a.pressure + (b.pressure - a.pressure) * t,
      });
    }
  }
  return out;
}

/** Move one node's anchor, keeping its handle offsets relative to it (so the curve's shape stays put). */
export function moveNode(nodes: BezierNode[], nodeId: string, x: number, y: number): BezierNode[] {
  return nodes.map((n) => {
    if (n.id !== nodeId) return n;
    const dx = x - n.x, dy = y - n.y;
    return {
      ...n, x, y,
      inX: n.inX === null ? null : n.inX + dx, inY: n.inY === null ? null : n.inY + dy,
      outX: n.outX === null ? null : n.outX + dx, outY: n.outY === null ? null : n.outY + dy,
    };
  });
}

/** Move one handle independently of its anchor — a true reshape, the thing this module exists for. */
export function moveHandle(nodes: BezierNode[], nodeId: string, which: 'in' | 'out', x: number, y: number): BezierNode[] {
  return nodes.map((n) => {
    if (n.id !== nodeId) return n;
    return which === 'in' ? { ...n, inX: x, inY: y } : { ...n, outX: x, outY: y };
  });
}

/** The full pipeline: a raw hand-drawn stroke → a clean, draggable vector curve. */
export function vectorizeStroke(points: StrokePoint[], epsilon = 1.5): BezierNode[] {
  return fitBezierNodes(simplifyPoints(points, epsilon));
}
