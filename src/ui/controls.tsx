import type { CSSProperties, ReactNode } from 'react';

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button className={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Slider({ label, value, min, max, step = 1, format, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; format?: (v: number) => string; onChange: (v: number) => void;
}) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <div className="field">
      <div className="field-head"><span>{label}</span><span className="value">{format ? format(value) : value}</span></div>
      <input className="slider" type="range" min={min} max={max} step={step} value={value} aria-label={label}
        style={{ '--fill': fill } as CSSProperties} onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}

export function ToggleRow({ title, desc, on, onChange }: { title: string; desc?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row">
      <div><div className="title">{title}</div>{desc && <div className="desc">{desc}</div>}</div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, columns = 3 }: {
  options: Array<{ value: T; label: ReactNode }>; value: T; onChange: (v: T) => void; columns?: number;
}) {
  return (
    <div className="segmented" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {options.map(option => (
        <button key={String(option.value)} className={option.value === value ? 'active' : ''} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : rgbaToHex(value);
  return (
    <label className="color-row">
      <input type="color" value={hex} onChange={e => onChange(value.startsWith('rgba') ? hexToRgba(e.target.value, alphaOf(value)) : e.target.value)} />
      <div><div className="label">{label}</div><div className="code">{value.toUpperCase()}</div></div>
    </label>
  );
}

const alphaOf = (rgba: string) => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(rgba)?.[1] ?? 1);
function rgbaToHex(value: string) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  if (!m) return '#ffffff';
  return `#${[m[1], m[2], m[3]].map(v => Number(v).toString(16).padStart(2, '0')).join('')}`;
}
function hexToRgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export const formatTime = (ms: number, withTenths = false) => {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60), s = Math.floor(total % 60);
  const base = `${m}:${String(s).padStart(2, '0')}`;
  return withTenths ? `${base}.${Math.floor((total % 1) * 10)}` : base;
};
