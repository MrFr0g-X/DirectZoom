// Cursor artwork. Each design draws into a square box of `size` px whose hotspot uses
// per-design fractions, so placement and click/scale behaviour stay consistent.
// macOS-style, minimal, crosshair, lavender and parched shapes are DirectZoom drawings (the
// themed ones are original designs); the Windows
// style uses the user's own system cursors exported by dzcap.
import type { SystemCursor } from './types';
import { hotspot } from './cursor-motion';

export type CursorArt = { image: CanvasImageSource; hotspot: { x: number; y: number } };
export type CursorDesign = 'macos' | 'windows' | 'minimal' | 'crosshair' | 'lavender' | 'parched';

const RASTER = 256;
const svgDoc = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${RASTER}" height="${RASTER}">` +
  // Shadow equivalent to CSS drop-shadow(0 2px 4px rgba(0,0,0,.3)) on a ~80 px cursor box.
  `<defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#000" flood-opacity="0.3"/></filter></defs>` +
  `<g filter="url(#s)">${body}</g></svg>`;

function macos(type: string, fill: string, stroke: string) {
  if (type === 'pointer') {
    const hand = 'M35.5 31.5A4.5 4.5 0 0 1 44.5 31.5L44.5 47.5A3.5 3.5 0 0 1 51.5 47.5L51.5 49.5A3.25 3.25 0 0 1 58 49.5L58 52A3 3 0 0 1 64 52L64 63C64 69 61.5 73 59.5 77L39.5 77C37 74 33 69 29.5 64.5C27.3 61.7 25.8 58.6 27.6 56.6C29.4 54.6 32.6 55.8 35.5 59Z';
    return svgDoc(
      `<path d="${hand}" fill="${fill}" stroke="${stroke}" stroke-width="2.4" stroke-linejoin="round"/>` +
      `<path d="M44.5 50.5V58M51.5 51.5V58M58 53.5V58" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`);
  }
  if (type === 'text') {
    const beam = 'M43.5 33.5Q50 33 50 38.5Q50 33 56.5 33.5M50 38.5V61.5M43.5 66.5Q50 67 50 61.5Q50 67 56.5 66.5';
    return svgDoc(
      `<path d="${beam}" fill="none" stroke="${fill}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${beam}" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  // Classic black arrow with a light border; tip at (31.25, 21.9) like the macOS
  // design, half the box tall. Body uses the outline colour, border the fill colour, so the
  // defaults (#ffffff / #000000) give the familiar macOS look.
  // The border (3 units) wraps the tip, so the polygon starts just inside the hotspot.
  const arrow = 'M32.75 24.5L32.75 69.5L43.25 60L49.75 74.5L56.75 71.5L50.25 57.5L64.25 57.5Z';
  return svgDoc(
    `<path d="${arrow}" fill="${fill}" stroke="${fill}" stroke-width="6" stroke-linejoin="round"/>` +
    `<path d="${arrow}" fill="${stroke}" stroke="${stroke}" stroke-width="0.6" stroke-linejoin="round"/>`);
}

function minimal(type: string, fill: string, stroke: string) {
  if (type === 'text') return svgDoc(`<rect x="47.5" y="38" width="5" height="24" rx="2.5" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);
  const radius = type === 'pointer' ? 12 : 8.5;
  const opacity = type === 'pointer' ? 0.85 : 1;
  return svgDoc(`<circle cx="50" cy="50" r="${radius}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2.4"/>`);
}

function crosshair(type: string, fill: string, stroke: string) {
  const lines = 'M50 32V45M50 55V68M32 50H45M55 50H68';
  const centre = type === 'pointer' ? `<circle cx="50" cy="50" r="5" fill="none" stroke="${fill}" stroke-width="2"/>` : '';
  return svgDoc(
    `<path d="${lines}" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="${lines}" stroke="${fill}" stroke-width="2.2" stroke-linecap="round"/>${centre}`);
}

/** Pastel gradient arrow and hand with a white rim and soft glow (fixed colours, like a theme pack). */
function lavender(type: string) {
  const defs = `<defs><linearGradient id="lv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9d5ff"/><stop offset="0.55" stop-color="#a78bfa"/><stop offset="1" stop-color="#7c3aed"/></linearGradient>` +
    `<filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.4"/></filter></defs>`;
  if (type === 'text') {
    const beam = 'M43.5 33.5Q50 33 50 38.5Q50 33 56.5 33.5M50 38.5V61.5M43.5 66.5Q50 67 50 61.5Q50 67 56.5 66.5';
    return svgDoc(`${defs}<path d="${beam}" fill="none" stroke="#ffffff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/><path d="${beam}" fill="none" stroke="url(#lv)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  // Tip at (8, 8) and fingertip at (48, 10).
  const shape = type === 'pointer'
    ? 'M43.5 14.5A4.5 4.5 0 0 1 52.5 14.5L52.5 30.5A3.5 3.5 0 0 1 59.5 30.5L59.5 32.5A3.25 3.25 0 0 1 66 32.5L66 35A3 3 0 0 1 72 35L72 46C72 52 69.5 56 67.5 60L47.5 60C45 57 41 52 37.5 47.5C35.3 44.7 33.8 41.6 35.6 39.6C37.4 37.6 40.6 38.8 43.5 42Z'
    : 'M9.5 9.5L9.5 54L20 44.5L26.5 59L33.5 56L27 42L41 42Z';
  return svgDoc(`${defs}<path d="${shape}" fill="#c4b5fd" opacity="0.65" filter="url(#glow)"/>` +
    `<path d="${shape}" fill="url(#lv)" stroke="#ffffff" stroke-width="3.4" stroke-linejoin="round"/>`);
}

/** Centred ink dot on a parchment disc; a ring over clickable things (fixed colours). */
function parched(type: string) {
  if (type === 'text') return svgDoc(`<rect x="47" y="37" width="6" height="26" rx="3" fill="#5b3a1e" stroke="#f3e2c0" stroke-width="2"/>`);
  if (type === 'pointer') {
    return svgDoc(`<circle cx="50" cy="50" r="13" fill="#f3e2c0" fill-opacity="0.55" stroke="#7a4b25" stroke-width="3"/>` +
      `<circle cx="50" cy="50" r="4" fill="#5b3a1e"/>`);
  }
  return svgDoc(`<circle cx="50" cy="50" r="10" fill="#f3e2c0" stroke="#7a4b25" stroke-width="2.6"/>` +
    `<path d="M46 47.5c2.2-2.6 6.4-2.4 8 0.6c1.4 2.6-0.4 5.6-3.4 6c-2.8 0.4-5.6-1.2-5.6-3.6c0-1.1 0.4-2.1 1-3z" fill="#5b3a1e"/>`);
}

const cache = new Map<string, Promise<CursorArt | null>>();

function rasterizeSvg(svg: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = RASTER;
      canvas.getContext('2d')!.drawImage(image, 0, 0, RASTER, RASTER);
      resolve(canvas);
    };
    image.onerror = reject;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

/**
 * Places a system cursor into the box: the visible shape is scaled so its height is
 * `fill` of the box, with the real hotspot at the same box fraction used for
 * its Windows design.
 */
async function systemArt(cursor: SystemCursor, type: string): Promise<CursorArt> {
  const image = await loadImage(cursor.url);
  const w = image.naturalWidth, h = image.naturalHeight;
  const probe = document.createElement('canvas');
  probe.width = w; probe.height = h;
  const pctx = probe.getContext('2d', { willReadFrequently: true })!;
  pctx.drawImage(image, 0, 0);
  const data = pctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 8) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }
  const contentH = maxY - minY + 1;
  // Arrow and hand use Windows' hotspot fractions; centred cursors use the middle.
  const target = type === 'default' || type === 'pointer' || type === 'help' || type === 'progress' ? hotspot(type === 'pointer' ? 'pointer' : 'default', 'windows') : { x: 0.5, y: 0.5 };
  const scale = (RASTER * 0.52) / contentH; // shape height ≈ 52% of the box, like the macOS arrow
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = RASTER;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  // Put the real hotspot at the design's hotspot fraction.
  const hx = cursor.hotspotX * w, hy = cursor.hotspotY * h;
  ctx.drawImage(image, target.x * RASTER - hx * scale, target.y * RASTER - hy * scale, w * scale, h * scale);
  return { image: canvas, hotspot: target };
}

let systemCursors: Promise<Record<string, SystemCursor>> | null = null;

/** Artwork for a design and cursor type, with the hotspot as a fraction of the box. */
export function cursorArt(design: CursorDesign, type: string, fill: string, stroke: string): Promise<CursorArt | null> {
  const key = `${design}|${type}|${fill}|${stroke}`;
  let pending = cache.get(key);
  if (pending) return pending;
  pending = (async () => {
    if (design === 'windows') {
      systemCursors ??= window.dz?.systemCursors?.() ?? Promise.resolve({});
      const set = await systemCursors;
      const cursor = set[type] ?? set.default;
      if (cursor) return systemArt(cursor, set[type] ? type : 'default');
      design = 'macos';
    }
    const shapeType = ['pointer', 'text'].includes(type) ? type : 'default';
    const svg = design === 'minimal' ? minimal(shapeType, fill, stroke) : design === 'crosshair' ? crosshair(shapeType, fill, stroke)
      : design === 'lavender' ? lavender(shapeType) : design === 'parched' ? parched(shapeType) : macos(shapeType, fill, stroke);
    return { image: await rasterizeSvg(svg), hotspot: hotspot(shapeType, design) };
  })().catch(() => null);
  cache.set(key, pending);
  return pending;
}

/** Cursor types each design has artwork for (others fall back to `default`). */
export const designTypes: Record<CursorDesign, string[]> = {
  macos: ['default', 'pointer', 'text'],
  windows: ['default', 'pointer', 'text', 'wait', 'progress', 'crosshair', 'ew-resize', 'ns-resize', 'nwse-resize', 'nesw-resize', 'move', 'not-allowed', 'help'],
  minimal: ['default', 'pointer', 'text'],
  crosshair: ['default', 'pointer', 'text'],
  lavender: ['default', 'pointer', 'text'],
  parched: ['default', 'pointer', 'text'],
};
