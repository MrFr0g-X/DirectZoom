// Screen annotations: freehand/line/arrow/rectangle/ellipse strokes in
// output space with draw-on, fade, pop and pulse animations; the highlighter tool is wider,
// translucent and screen-blended.
import type { Annotation } from './types';

type Point = { x: number; y: number };

/** CSS-style cubic bezier easing. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) break;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    for (let i = 0; i < 20 && Math.abs(sampleX(t) - x) > 1e-6; i++) { if (sampleX(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return sampleY(t);
  };
}
const ease = bezier(0.16, 1, 0.3, 1);

/** Eased, clamped interpolation over [a, b]. */
function tween(t: number, [a, b]: [number, number], [from, to]: [number, number]) {
  if (b <= a) return t >= b ? to : from;
  const p = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return from + (to - from) * ease(p);
}

const distance = (a: Point, b: Point) => Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
const centroid = (points: Point[]) => points.length ? { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length } : { x: 0, y: 0 };
function box(points: Point[]) {
  const a = points[0] ?? { x: 0, y: 0 }, b = points[points.length - 1] ?? a;
  const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y), right = Math.max(a.x, b.x), bottom = Math.max(a.y, b.y);
  const width = Math.max(1, right - left), height = Math.max(1, bottom - top);
  return { left, top, right, bottom, width, height, center: { x: left + width / 2, y: top + height / 2 } };
}

/** Filled arrow outline. */
function arrowPath(from: Point, to: Point, strokeWidth: number) {
  const len = distance(from, to);
  const ux = (to.x - from.x) / len, uy = (to.y - from.y) / len, nx = -uy, ny = ux;
  const width = Math.max(2, Number.isFinite(strokeWidth) ? strokeWidth : 2);
  const headLength = Math.max(12, Math.min(Math.max(24, width * 3.2), len * 0.48));
  const shaft = Math.max(3.2, Math.max(2, strokeWidth) * 0.58);
  const head = Math.max(shaft * 2.25, headLength * 0.5);
  const base = { x: to.x - ux * headLength, y: to.y - uy * headLength };
  const tail = { x: from.x - ux * shaft, y: from.y - uy * shaft };
  const p = new Path2D();
  p.moveTo(from.x + nx * shaft, from.y + ny * shaft);
  p.lineTo(base.x + nx * shaft, base.y + ny * shaft);
  p.lineTo(base.x + nx * head, base.y + ny * head);
  p.lineTo(to.x, to.y);
  p.lineTo(base.x - nx * head, base.y - ny * head);
  p.lineTo(base.x - nx * shaft, base.y - ny * shaft);
  p.lineTo(from.x - nx * shaft, from.y - ny * shaft);
  p.quadraticCurveTo(tail.x, tail.y, from.x + nx * shaft, from.y + ny * shaft);
  p.closePath();
  return p;
}

type Geometry = { stroke?: Path2D; fill?: Path2D; length: number; center: Point };

export function geometry(annotation: Annotation, width: number, height: number): Geometry | null {
  const points = annotation.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map(p => ({ x: Math.max(0, Math.min(1, p.x)) * width, y: Math.max(0, Math.min(1, p.y)) * height }));
  if (!points.length) return null;
  const shape = annotation.shape ?? 'freehand';
  const first = points[0], last = points[points.length - 1] ?? first;
  if (shape === 'line' || shape === 'arrow') {
    const stroke = new Path2D();
    stroke.moveTo(first.x, first.y); stroke.lineTo(last.x, last.y);
    return { stroke, fill: shape === 'arrow' ? arrowPath(first, last, annotation.strokeWidth) : undefined, length: distance(first, last), center: centroid([first, last]) };
  }
  if (shape === 'rectangle') {
    const b = box(points);
    const stroke = new Path2D();
    stroke.rect(b.left, b.top, b.width, b.height);
    return { stroke, length: Math.max(1, 2 * (b.width + b.height)), center: b.center };
  }
  if (shape === 'ellipse') {
    const b = box(points), rx = Math.max(1, b.width / 2), ry = Math.max(1, b.height / 2);
    const stroke = new Path2D();
    stroke.ellipse(b.center.x, b.center.y, rx, ry, 0, Math.PI, Math.PI * 3);
    return { stroke, length: Math.max(1, Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))), center: b.center };
  }
  const stroke = new Path2D();
  stroke.moveTo(first.x, first.y);
  if (points.length === 1) stroke.lineTo(first.x + 0.01, first.y + 0.01);
  for (const p of points.slice(1)) stroke.lineTo(p.x, p.y);
  let length = 0;
  for (let i = 1; i < points.length; i++) length += distance(points[i - 1], points[i]);
  return { stroke, length: Math.max(1, length), center: centroid(points) };
}

/** Draws annotations active at `time` (timeline ms) in output space of width × height. */
export function drawAnnotations(ctx: CanvasRenderingContext2D, annotations: Annotation[], time: number, width: number, height: number) {
  for (const a of annotations) {
    if (a.endMs <= a.startMs || !a.points.length) continue;
    const span = Math.max(100, a.endMs - a.startMs);
    const drawTime = Math.min(900, Math.max(180, 0.45 * span));
    const fadeTime = Math.min(220, Math.max(80, 0.18 * span));
    if (time < a.startMs || time > a.endMs + fadeTime) continue;
    const g = geometry(a, width, height);
    if (!g) continue;
    const progress = a.animation === 'draw-on' ? tween(time, [a.startMs, a.startMs + drawTime], [0, 1]) : 1;
    const fadeIn = tween(time, [a.startMs, a.startMs + fadeTime], [0, 1]);
    const fadeOut = tween(time, [a.endMs, a.endMs + fadeTime], [1, 0]);
    const visibility = a.animation === 'fade' ? Math.min(fadeIn, fadeOut) : fadeOut;
    const scale = (a.animation === 'pulse' ? 0.94 + 0.06 * Math.sin((time / 1000) * Math.PI * 3) : 1)
      * (a.animation === 'pop' ? tween(time, [a.startMs, a.startMs + 220], [0.86, 1]) : 1);
    const highlighter = a.tool === 'highlighter';
    const opacity = Math.max(0, Math.min(1, a.opacity * visibility * (highlighter ? 0.58 : 1)));
    if (opacity <= 0) continue;
    ctx.save();
    ctx.globalCompositeOperation = highlighter ? 'screen' : 'source-over';
    ctx.translate(g.center.x, g.center.y);
    ctx.scale(scale, scale);
    ctx.translate(-g.center.x, -g.center.y);
    if (g.fill) {
      ctx.globalAlpha = opacity * progress;
      ctx.fillStyle = a.color;
      ctx.lineJoin = 'round';
      ctx.fill(g.fill);
    } else if (g.stroke) {
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = highlighter ? 2.2 * a.strokeWidth : a.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([g.length, g.length]);
      ctx.lineDashOffset = g.length * (1 - progress);
      ctx.stroke(g.stroke);
    }
    ctx.restore();
  }
}
