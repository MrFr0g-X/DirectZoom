import type { PointerEvent as ReactPointerEvent } from 'react';

type Region = { x: number; y: number; width: number; height: number };
type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Draggable crop rectangle over a box of `width`×`height` px; `aspect` is width/height in source pixels or null. */
export function CropOverlay({ region, width, height, sourceAspect, aspect, onChange, onStart }: {
  region: Region; width: number; height: number; sourceAspect: number; aspect: number | null;
  onChange: (region: Region) => void; onStart: () => void;
}) {
  const begin = (handle: Handle) => (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onStart();
    const start = { x: event.clientX, y: event.clientY, region };
    const target = event.currentTarget as HTMLElement;
    try { target.setPointerCapture(event.pointerId); } catch {}
    const min = 0.05;
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - start.x) / width, dy = (e.clientY - start.y) / height;
      let { x, y, width: w, height: h } = start.region;
      if (handle === 'move') {
        x = Math.min(Math.max(0, x + dx), 1 - w);
        y = Math.min(Math.max(0, y + dy), 1 - h);
      } else {
        if (handle.includes('w')) { const nx = Math.min(Math.max(0, x + dx), x + w - min); w += x - nx; x = nx; }
        if (handle.includes('e')) w = Math.min(Math.max(min, w + dx), 1 - x);
        if (handle.includes('n')) { const ny = Math.min(Math.max(0, y + dy), y + h - min); h += y - ny; y = ny; }
        if (handle.includes('s')) h = Math.min(Math.max(min, h + dy), 1 - y);
        if (aspect) {
          // Keep the chosen output aspect: adjust height from width (normalized units differ by source aspect).
          const wanted = (w * sourceAspect) / aspect;
          if (handle === 'n' || handle === 's') w = Math.min(1 - x, (h * aspect) / sourceAspect);
          else h = Math.min(1 - y, wanted);
          if (handle.includes('n')) y = start.region.y + start.region.height - h;
        }
      }
      onChange({ x, y, width: w, height: h });
    };
    const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  const handles: Array<[Handle, Record<string, string | number>]> = [
    ['nw', { left: -6, top: -6, cursor: 'nwse-resize' }], ['n', { left: '50%', top: -6, marginLeft: -6, cursor: 'ns-resize' }],
    ['ne', { right: -6, top: -6, cursor: 'nesw-resize' }], ['e', { right: -6, top: '50%', marginTop: -6, cursor: 'ew-resize' }],
    ['se', { right: -6, bottom: -6, cursor: 'nwse-resize' }], ['s', { left: '50%', bottom: -6, marginLeft: -6, cursor: 'ns-resize' }],
    ['sw', { left: -6, bottom: -6, cursor: 'nesw-resize' }], ['w', { left: -6, top: '50%', marginTop: -6, cursor: 'ew-resize' }],
  ];
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div onPointerDown={begin('move')} style={{
        position: 'absolute', left: region.x * width, top: region.y * height, width: region.width * width, height: region.height * height,
        border: '2px solid #fff', boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)', cursor: 'move',
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.25) 1px, transparent 1px)',
        backgroundSize: '33.333% 33.333%', backgroundPosition: '-1px -1px',
      }}>
        {handles.map(([name, style]) => (
          <span key={name} onPointerDown={begin(name)} style={{ position: 'absolute', width: 12, height: 12, borderRadius: 3, background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.5)', ...style }} />
        ))}
      </div>
    </div>
  );
}
