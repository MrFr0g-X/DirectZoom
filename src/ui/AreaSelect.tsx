import { useEffect, useRef, useState } from 'react';

type Point = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };

export function AreaSelect() {
  const start = useRef<Point | null>(null);
  const [rect, setRect] = useState<Box | null>(null);
  const done = useRef(false);

  useEffect(() => {
    document.body.style.background = 'transparent';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !done.current) { done.current = true; window.dz.areaDone(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const boxFrom = (a: Point, b: Point): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });

  const finish = (end: Point) => {
    if (done.current || !start.current) return;
    const box = boxFrom(start.current, end);
    start.current = null;
    if (box.width < 40 || box.height < 40) { setRect(null); return; }
    done.current = true;
    setRect(box);
    window.dz.areaDone(box);
  };

  return (
    <div className="area-root"
      onMouseDown={e => { start.current = { x: e.clientX, y: e.clientY }; setRect(boxFrom(start.current, start.current)); }}
      onMouseMove={e => { if (start.current && e.buttons === 1) setRect(boxFrom(start.current, { x: e.clientX, y: e.clientY })); }}
      onMouseUp={e => finish({ x: e.clientX, y: e.clientY })}>
      {!rect && <div className="area-help">Drag to select the area to record · Esc to cancel</div>}
      {rect && (
        <div className="area-rect" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
          <span className="area-size">{Math.round(rect.width * devicePixelRatio)} × {Math.round(rect.height * devicePixelRatio)}</span>
        </div>
      )}
    </div>
  );
}
