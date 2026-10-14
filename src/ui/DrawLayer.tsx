import { useEffect, useRef, useState } from 'react';
import { drawAnnotations } from '../annotations';
import type { Annotation } from '../types';

type Draft = Omit<Annotation, 'id' | 'startMs' | 'endMs'>;

/**
 * Transparent drawing surface over the preview. Points are normalized to the composition, so
 * strokes land where they were drawn regardless of export size.
 */
export function DrawLayer({ width, height, designWidth, template, onCreate }: {
  width: number; height: number; designWidth: number;
  template: Omit<Draft, 'points'>;
  onCreate: (draft: Draft) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<Array<{ x: number; y: number }>>([]);
  const drawing = useRef(false);
  const current = useRef<Array<{ x: number; y: number }>>([]);
  const update = (next: Array<{ x: number; y: number }>) => { current.current = next; setPoints(next); };

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(width * ratio); c.height = Math.round(height * ratio);
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!points.length) return;
    // Stroke widths are in composition pixels; scale the live preview the same way.
    const scale = c.width / designWidth;
    ctx.save();
    ctx.scale(scale, scale);
    drawAnnotations(ctx, [{ ...template, points, id: 'draft', startMs: 0, endMs: 1e9, animation: 'none' }], 1, designWidth, c.height / scale);
    ctx.restore();
  }, [points, width, height, designWidth, template]);

  const toPoint = (e: React.PointerEvent) => {
    const box = canvas.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)) };
  };

  return (
    <canvas ref={canvas} style={{ position: 'absolute', width, height, cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={e => {
        drawing.current = true;
        try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch {}
        const p = toPoint(e);
        update(template.shape === 'freehand' ? [p] : [p, p]);
      }}
      onPointerMove={e => {
        if (!drawing.current) return;
        const p = toPoint(e);
        const pts = current.current;
        update(template.shape === 'freehand' ? [...pts, p] : [pts[0], p]);
      }}
      onPointerUp={() => {
        if (!drawing.current) return;
        drawing.current = false;
        const pts = current.current;
        const [a, b] = [pts[0], pts[pts.length - 1]];
        const big = pts.length > 2 || (a && b && Math.hypot(b.x - a.x, b.y - a.y) > 0.01);
        update([]);
        if (big) onCreate({ ...template, points: pts });
      }} />
  );
}
