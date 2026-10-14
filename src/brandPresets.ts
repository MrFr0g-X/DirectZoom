// Brand presets: four built-in looks plus presets the user saves. Applying a preset merges its
// sections into the project settings; unknown keys (for example from presets saved by other
// versions) are skipped.
import type { ProjectSettings } from './types';

export type BrandSections = Pick<ProjectSettings, 'backgroundSettings' | 'cursorSettings' | 'captionSettings' | 'keyboardSettings' | 'cameraSettings'>;
/** Partial settings per section; applyPreset() only merges keys DirectZoom knows. */
export type BrandPreset = { id: string; name: string; description: string; accent: string; settings: Record<string, Record<string, unknown> | undefined> };

export const builtInPresets: BrandPreset[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Deep blue backdrop, white cursor, quiet captions.',
    accent: 'linear-gradient(135deg, #0b1d3a 0%, #1e40af 60%, #38bdf8 100%)',
    settings: {
      backgroundSettings: { type: 'wallpaper', wallpaper: 'midnight', padding: 48, borderRadius: 16, shadow: true, shadowSettings: { blur: 48, offsetX: 0, offsetY: 24, opacity: 0.35 } },
      cursorSettings: { cursorDesign: 'macos', color: '#ffffff', strokeColor: '#0b1220', clickEffect: 'ripple', highlightColor: 'rgba(56, 189, 248, 0.45)', size: 96 },
      captionSettings: { style: 'classic', position: 'bottom', fontSize: 36, fontWeight: 'bold', textTransform: 'none', textColor: '#ffffff', highlightColor: '#38bdf8', backgroundColor: '#0b1220', backgroundOpacity: 0.7 },
      keyboardSettings: { style: 'glass', position: 'bottom-center', backgroundColor: 'rgba(11, 18, 32, 0.75)', textColor: '#e2e8f0' },
      cameraSettings: { shape: 'circle', position: 9, borderWidth: 3, borderColor: '#ffffff', shadow: true },
    },
  },
  {
    id: 'sunrise',
    name: 'Sunrise',
    description: 'Warm gradient, soft cursor glow, karaoke captions.',
    accent: 'linear-gradient(135deg, #f97316 0%, #ec4899 55%, #8b5cf6 100%)',
    settings: {
      backgroundSettings: { type: 'wallpaper', wallpaper: 'sunrise', padding: 56, borderRadius: 22, shadow: true, shadowSettings: { blur: 56, offsetX: 0, offsetY: 26, opacity: 0.3 } },
      cursorSettings: { cursorDesign: 'minimal', color: '#ffffff', strokeColor: '#3b0a2a', clickEffect: 'glow', highlightColor: 'rgba(251, 146, 60, 0.5)', size: 92 },
      captionSettings: { style: 'karaoke', position: 'bottom', fontSize: 40, fontWeight: 'black', textTransform: 'none', textColor: '#ffffff', highlightColor: '#fde047', backgroundColor: '#1f0a1a', backgroundOpacity: 0.55 },
      keyboardSettings: { style: 'pill', position: 'top-center', backgroundColor: 'rgba(31, 10, 26, 0.8)', textColor: '#ffffff' },
      cameraSettings: { shape: 'rounded', position: 7, roundness: 35, borderWidth: 0, shadow: true },
    },
  },
  {
    id: 'paper',
    name: 'Paper',
    description: 'Light and minimal, for documentation and tutorials.',
    accent: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 60%, #94a3b8 100%)',
    settings: {
      backgroundSettings: { type: 'solid', color: '#eef1f5', padding: 40, borderRadius: 12, shadow: true, shadowSettings: { blur: 36, offsetX: 0, offsetY: 14, opacity: 0.18 } },
      cursorSettings: { cursorDesign: 'windows', color: '#ffffff', strokeColor: '#111827', clickEffect: 'ring', highlightColor: 'rgba(37, 99, 235, 0.35)', size: 90 },
      captionSettings: { style: 'classic', position: 'bottom', fontSize: 34, fontWeight: 'bold', textTransform: 'none', textColor: '#111827', highlightColor: '#2563eb', backgroundColor: '#ffffff', backgroundOpacity: 0.92 },
      keyboardSettings: { style: 'keycap', position: 'bottom-right', backgroundColor: 'rgba(255, 255, 255, 0.95)', textColor: '#111827' },
      cameraSettings: { shape: 'square', position: 3, roundness: 18, borderWidth: 2, borderColor: '#e5e7eb', shadow: true },
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'Bold colours and punchy word-by-word captions.',
    accent: 'linear-gradient(135deg, #22d3ee 0%, #a855f7 50%, #f43f5e 100%)',
    settings: {
      backgroundSettings: { type: 'gradient', gradient: 'linear-gradient(135deg, #0f0c29 0%, #5b21b6 50%, #db2777 100%)', padding: 52, borderRadius: 20, shadow: true, shadowSettings: { blur: 60, offsetX: 0, offsetY: 28, opacity: 0.4 } },
      cursorSettings: { cursorDesign: 'lavender', color: '#ffffff', strokeColor: '#1e1b4b', clickEffect: 'burst', highlightColor: 'rgba(34, 211, 238, 0.5)', size: 100 },
      captionSettings: { style: 'tiktok', position: 'center', fontSize: 46, fontWeight: 'black', textTransform: 'uppercase', textColor: '#ffffff', highlightColor: '#22d3ee', backgroundColor: '#000000', backgroundOpacity: 0 },
      keyboardSettings: { style: 'outline', position: 'bottom-center', backgroundColor: 'rgba(15, 12, 41, 0.6)', textColor: '#f0abfc' },
      cameraSettings: { shape: 'circle', position: 9, borderWidth: 4, borderColor: '#22d3ee', shadow: true },
    },
  },
];

const sections = ['backgroundSettings', 'cursorSettings', 'captionSettings', 'keyboardSettings', 'cameraSettings'] as const;
const cursorDesigns = ['macos', 'windows', 'minimal', 'crosshair', 'lavender', 'parched'];

function mergeKnown(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in target) || value === undefined) continue;
    const current = target[key];
    if (current && typeof current === 'object' && !Array.isArray(current) && value && typeof value === 'object') out[key] = mergeKnown(current as Record<string, unknown>, value as Record<string, unknown>);
    else if (current === null || typeof current === typeof value) out[key] = value;
  }
  return out;
}

/** Settings with the preset applied. */
export function applyPreset(settings: ProjectSettings, preset: BrandPreset): ProjectSettings {
  const next = { ...settings } as Record<string, unknown>;
  for (const section of sections) {
    const patch = { ...(preset.settings[section] as Record<string, unknown> | undefined) };
    if (!Object.keys(patch).length) continue;
    if (section === 'cursorSettings' && patch.cursorDesign && !cursorDesigns.includes(String(patch.cursorDesign))) delete patch.cursorDesign;
    next[section] = mergeKnown(settings[section] as unknown as Record<string, unknown>, patch);
  }
  return next as ProjectSettings;
}

/** A preset capturing the project's current look. */
export function presetFrom(settings: ProjectSettings, name: string): BrandPreset {
  const pickStyle = <K extends keyof BrandSections>(key: K) => ({ ...settings[key] });
  const background = pickStyle('backgroundSettings');
  return {
    id: `custom-${Date.now().toString(36)}`, name, description: 'Saved from a project',
    accent: background.type === 'gradient' ? background.gradient : background.type === 'solid' ? background.color : 'linear-gradient(135deg, #334155, #0f172a)',
    settings: {
      backgroundSettings: background, cursorSettings: pickStyle('cursorSettings'), captionSettings: { ...pickStyle('captionSettings'), enabled: undefined },
      keyboardSettings: pickStyle('keyboardSettings'), cameraSettings: pickStyle('cameraSettings'),
    },
  };
}

const STORE = 'dz.brandPresets';
export function loadCustomPresets(): BrandPreset[] {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '[]'); } catch { return []; }
}
export function saveCustomPresets(presets: BrandPreset[]) {
  try { localStorage.setItem(STORE, JSON.stringify(presets)); } catch {}
}
