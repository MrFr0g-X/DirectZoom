// Backgrounds: DirectZoom's own procedural wallpapers, CSS-style linear gradients, solid
// colours and user images. Rendered once per size/settings into a cached canvas.
import type { BackgroundSettings } from './types';

type Blob = { x: number; y: number; r: number; color: string };
export type Wallpaper = { id: string; name: string; base: string; blobs: Blob[]; grain?: number };

export const wallpapers: Wallpaper[] = [
  { id: 'dusk', name: 'Dusk', base: '#1b1033', blobs: [
    { x: 0.1, y: 0.15, r: 0.75, color: '#ff7a59' }, { x: 0.85, y: 0.2, r: 0.7, color: '#c2338d' },
    { x: 0.55, y: 0.95, r: 0.8, color: '#4b2bd6' }, { x: 0.15, y: 0.9, r: 0.55, color: '#ffb36b' }] },
  { id: 'aurora', name: 'Aurora', base: '#04111f', blobs: [
    { x: 0.15, y: 0.25, r: 0.7, color: '#00d1b2' }, { x: 0.8, y: 0.15, r: 0.65, color: '#3f6dff' },
    { x: 0.7, y: 0.9, r: 0.75, color: '#b44cff' }, { x: 0.1, y: 0.95, r: 0.5, color: '#ff6f91' }] },
  { id: 'ocean', name: 'Ocean', base: '#03162b', blobs: [
    { x: 0.2, y: 0.1, r: 0.8, color: '#0077b6' }, { x: 0.9, y: 0.4, r: 0.7, color: '#00b4d8' },
    { x: 0.3, y: 0.95, r: 0.7, color: '#023e8a' }, { x: 0.75, y: 0.95, r: 0.5, color: '#90e0ef' }] },
  { id: 'ember', name: 'Ember', base: '#140604', blobs: [
    { x: 0.85, y: 0.15, r: 0.7, color: '#ff4d1c' }, { x: 0.2, y: 0.85, r: 0.75, color: '#ffa62b' },
    { x: 0.5, y: 0.5, r: 0.5, color: '#7a1a0a' }] },
  { id: 'meadow', name: 'Meadow', base: '#061a12', blobs: [
    { x: 0.15, y: 0.2, r: 0.7, color: '#2ecc71' }, { x: 0.85, y: 0.3, r: 0.6, color: '#c6f36b' },
    { x: 0.5, y: 1, r: 0.8, color: '#0f766e' }] },
  { id: 'sunrise', name: 'Sunrise', base: '#2a0f2f', blobs: [
    { x: 0.5, y: 1.05, r: 0.9, color: '#ffb199' }, { x: 0.1, y: 0.2, r: 0.6, color: '#ff4f86' },
    { x: 0.9, y: 0.2, r: 0.6, color: '#ffd29d' }] },
  { id: 'midnight', name: 'Midnight', base: '#05070f', blobs: [
    { x: 0.2, y: 0.2, r: 0.7, color: '#1e3a8a' }, { x: 0.85, y: 0.85, r: 0.7, color: '#4c1d95' },
    { x: 0.8, y: 0.15, r: 0.35, color: '#0ea5e9' }] },
  { id: 'graphite', name: 'Graphite', base: '#111216', blobs: [
    { x: 0.2, y: 0.1, r: 0.8, color: '#3a3d46' }, { x: 0.9, y: 0.9, r: 0.7, color: '#24262d' },
    { x: 0.75, y: 0.2, r: 0.4, color: '#4b4f5c' }] },
  { id: 'blossom', name: 'Blossom', base: '#2b1530', blobs: [
    { x: 0.2, y: 0.2, r: 0.7, color: '#f9a8d4' }, { x: 0.85, y: 0.3, r: 0.6, color: '#c084fc' },
    { x: 0.5, y: 0.95, r: 0.75, color: '#fb7185' }] },
  { id: 'glacier', name: 'Glacier', base: '#dfe9f3', blobs: [
    { x: 0.15, y: 0.15, r: 0.7, color: '#a5c8ff' }, { x: 0.9, y: 0.25, r: 0.6, color: '#e0c3fc' },
    { x: 0.5, y: 1, r: 0.8, color: '#8ec5fc' }] },
];

export const gradients = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
  'linear-gradient(160deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
  'linear-gradient(135deg, #ff8008 0%, #ffc837 100%)',
  'linear-gradient(135deg, #1d2671 0%, #c33764 100%)',
  'linear-gradient(135deg, #232526 0%, #414345 100%)',
  'linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)',
];

export const solids = ['#0f0f12', '#1a1a2e', '#ffffff', '#f4f4f5', '#111827', '#1e293b', '#3b0764', '#7c2d12', '#064e3b', '#0c4a6e'];

/** Parses `linear-gradient(<angle>deg, <color> <pos>%, ...)`. */
export function parseGradient(css: string): { angle: number; stops: Array<{ color: string; at: number }> } {
  const inner = /linear-gradient\((.*)\)\s*$/i.exec(css.trim())?.[1] ?? '';
  const parts: string[] = [];
  let depth = 0, current = '';
  for (const c of inner) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else current += c;
  }
  if (current.trim()) parts.push(current.trim());
  let angle = 180;
  if (parts[0] && /deg$/.test(parts[0])) angle = parseFloat(parts.shift()!);
  else if (parts[0]?.startsWith('to ')) {
    const map: Record<string, number> = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to bottom right': 135, 'to bottom left': 225, 'to top left': 315 };
    angle = map[parts.shift()!] ?? 180;
  }
  const stops = parts.map((part, index) => {
    const match = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(part)!;
    return { color: match[1].trim(), at: match[2] !== undefined ? parseFloat(match[2]) / 100 : index / Math.max(1, parts.length - 1) };
  });
  return { angle, stops };
}

function fillGradient(ctx: CanvasRenderingContext2D, css: string, w: number, h: number) {
  const { angle, stops } = parseGradient(css);
  const a = (angle * Math.PI) / 180;
  const length = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
  const dx = (Math.sin(a) * length) / 2, dy = (-Math.cos(a) * length) / 2;
  const gradient = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
  for (const stop of stops) gradient.addColorStop(Math.min(1, Math.max(0, stop.at)), stop.color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

export function paintWallpaper(ctx: CanvasRenderingContext2D, wallpaper: Wallpaper, w: number, h: number) {
  ctx.fillStyle = wallpaper.base;
  ctx.fillRect(0, 0, w, h);
  const span = Math.max(w, h);
  for (const blob of wallpaper.blobs) {
    const x = blob.x * w, y = blob.y * h, r = blob.r * span;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, blob.color);
    g.addColorStop(0.45, `${blob.color}aa`);
    g.addColorStop(1, `${blob.color}00`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  // Soft vignette for depth.
  const v = ctx.createRadialGradient(w / 2, h / 2, span * 0.2, w / 2, h / 2, span * 0.85);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadBackgroundImage(url: string) {
  let pending = imageCache.get(url);
  if (!pending) {
    pending = new Promise(resolve => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    imageCache.set(url, pending);
  }
  return pending;
}

/** Background into a new canvas of w×h (blur applied). */
export function renderBackground(settings: BackgroundSettings, w: number, h: number, image: HTMLImageElement | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d')!;
  const paint = (target: CanvasRenderingContext2D) => {
    if (settings.type === 'solid') { target.fillStyle = settings.color; target.fillRect(0, 0, w, h); }
    else if (settings.type === 'gradient') fillGradient(target, settings.gradient, w, h);
    else if (settings.type === 'image' && image) {
      const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
      const iw = image.naturalWidth * scale, ih = image.naturalHeight * scale;
      target.drawImage(image, (w - iw) / 2, (h - ih) / 2, iw, ih);
    } else paintWallpaper(target, wallpapers.find(p => p.id === settings.wallpaper) ?? wallpapers[0], w, h);
  };
  if (settings.backgroundBlur > 0) {
    const raw = document.createElement('canvas');
    raw.width = canvas.width; raw.height = canvas.height;
    paint(raw.getContext('2d')!);
    ctx.filter = `blur(${settings.backgroundBlur}px)`;
    // Draw slightly larger so blurred edges stay opaque.
    const pad = settings.backgroundBlur * 2;
    ctx.drawImage(raw, -pad, -pad, w + pad * 2, h + pad * 2);
    ctx.filter = 'none';
  } else paint(ctx);
  return canvas;
}
