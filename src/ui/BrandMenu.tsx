import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Sparkles, X } from 'lucide-react';
import { applyPreset, builtInPresets, loadCustomPresets, presetFrom, saveCustomPresets, type BrandPreset } from '../brandPresets';
import type { ProjectSettings } from '../types';

/** "Brand" menu: built-in looks, saved looks, and "Save current brand". */
export function BrandMenu({ settings, onApply }: { settings: ProjectSettings; onApply: (settings: ProjectSettings) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<BrandPreset[]>(loadCustomPresets);
  const [name, setName] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  const apply = (preset: BrandPreset) => { onApply(applyPreset(settings, preset)); setActive(preset.id); };
  const save = () => {
    if (!name.trim()) return;
    const next = [...custom, presetFrom(settings, name.trim())];
    setCustom(next); saveCustomPresets(next); setName('');
  };
  const remove = (id: string) => { const next = custom.filter(p => p.id !== id); setCustom(next); saveCustomPresets(next); };
  const item = (preset: BrandPreset, removable: boolean) => (
    <div key={preset.id} className={`brand-item${active === preset.id ? ' active' : ''}`} onClick={() => apply(preset)} role="button" tabIndex={0}>
      <span className="brand-swatch" style={{ background: preset.accent }} />
      <span className="brand-text"><b>{preset.name}</b><small>{preset.description}</small></span>
      {removable && <button className="icon-btn" title="Delete preset" onClick={e => { e.stopPropagation(); remove(preset.id); }}><X size={13} /></button>}
    </div>
  );

  return (
    <div ref={root} style={{ position: 'relative', marginRight: 8 }}>
      <button className={`btn ${open ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOpen(o => !o)} title="Brand presets" aria-haspopup="menu" aria-expanded={open}>
        <Sparkles size={14} />Brand<ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} />
      </button>
      {open && (
        <div className="brand-menu" role="menu">
          <div className="brand-title">Brand presets</div>
          {builtInPresets.map(p => item(p, false))}
          <div className="section-label" style={{ marginTop: 10 }}>Save current brand</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="text-field" placeholder="Preset name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
            <button className="btn btn-primary" disabled={!name.trim()} onClick={save}><Plus size={14} />Save</button>
          </div>
          {custom.length > 0 && <div className="section-label" style={{ marginTop: 10 }}>Custom</div>}
          {custom.map(p => item(p, true))}
        </div>
      )}
    </div>
  );
}
