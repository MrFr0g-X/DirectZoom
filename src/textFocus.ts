// Text focus: while the user types into a field, everything except the field is
// dimmed or blurred. Events come from the recorder (text-focus-events.json); regions are
// derived from the recorded focus events and drawn over the media.
import type { TextFocusEvent, TextFocusRegion, TextFocusSettings } from './types';

const MAX_REGION = 30000; // mC
const MIN_REGION = 200; // ev
const TRAILING = 3000; // CU: a focus without a blur lasts this long
const MERGE_GAP = 1500; // EU
const SAME_BOUNDS = 0.05; // tp

type Bounds = TextFocusRegion['bounds'];
const similar = (a: Bounds, b: Bounds) =>
  Math.abs(a.x - b.x) < SAME_BOUNDS && Math.abs(a.y - b.y) < SAME_BOUNDS && Math.abs(a.width - b.width) < SAME_BOUNDS && Math.abs(a.height - b.height) < SAME_BOUNDS;

let counter = 0;
const newId = () => `focus-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Focus/blur events → regions. */
export function regionsFromEvents(events: TextFocusEvent[], duration: number): TextFocusRegion[] {
  if (!events.length) return [];
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const regions: TextFocusRegion[] = [];
  let open: { t: number; bounds: Bounds } | null = null;
  const close = (at: number) => {
    if (!open) return;
    const end = Math.min(at, open.t + MAX_REGION);
    if (end - open.t >= MIN_REGION) regions.push({ id: newId(), start: open.t, end, bounds: open.bounds });
  };
  for (const event of sorted) {
    const type = event.type || 'focus';
    if (type === 'focus' && event.bounds) {
      close(event.t);
      open = { t: event.t, bounds: event.bounds };
    } else if (type === 'blur') {
      close(event.t);
      open = null;
    }
  }
  if (open) {
    const end = Math.min(open.t + TRAILING, duration);
    if (end - open.t >= MIN_REGION) regions.push({ id: newId(), start: open.t, end, bounds: open.bounds });
  }
  for (const r of regions) { r.start = Math.max(0, r.start); r.end = Math.min(duration, r.end); }
  if (regions.length <= 1) return regions;
  const merged = [{ ...regions[0] }];
  for (let i = 1; i < regions.length; i++) {
    const last = merged[merged.length - 1], next = regions[i];
    if (next.start - last.end <= MERGE_GAP && similar(last.bounds, next.bounds)) last.end = next.end;
    else merged.push({ ...next });
  }
  return merged;
}

const easeInOut = (t: number) => {
  // In-out ease: ease = bezier(0.42, 0, 1, 1); the second half mirrors it.
  const ease = (x: number) => cubicBezier(0.42, 0, 1, 1, x);
  return t < 0.5 ? ease(t * 2) / 2 : 1 - ease((1 - t) * 2) / 2;
};

function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 30; i++) {
    t = (lo + hi) / 2;
    const cx = 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
    if (cx < x) lo = t; else hi = t;
  }
  return 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
}

/** Active region and its opacity at `time` (timeline ms), quantized to frames. */
export function focusAt(regions: TextFocusRegion[], settings: TextFocusSettings, time: number, fps: number) {
  if (!settings.enabled || !regions.length) return null;
  const frame = Math.round((time / 1000) * fps);
  const ramp = Math.max(1, Math.round((settings.transitionDuration / 1000) * fps));
  for (const region of regions) {
    const s = Math.round((region.start / 1000) * fps), e = Math.round((region.end / 1000) * fps);
    if (frame < s - ramp || frame > e + ramp) continue;
    const opacity = frame < s ? easeInOut((frame - (s - ramp)) / ramp) : frame > e ? easeInOut(1 - (frame - e) / ramp) : 1;
    if (opacity > 0) return { region, opacity };
  }
  return null;
}

/**
 * Draws the spotlight over the media rectangle (mx, my, mw, mh in composition px) of a
 * `videoWidth`×`videoHeight` source. `blurSource` re-draws the media for blur mode.
 */
export function drawTextFocus(
  ctx: CanvasRenderingContext2D, active: { region: TextFocusRegion; opacity: number }, settings: TextFocusSettings,
  media: { x: number; y: number; width: number; height: number }, video: { width: number; height: number },
  device: number, blurSource: (() => void) | null,
) {
  const { bounds } = active.region;
  const px = settings.padding / video.width, py = settings.padding / video.height;
  const x = Math.max(0, bounds.x - px), y = Math.max(0, bounds.y - py);
  const w = Math.min(1 - x, bounds.width + 2 * px), h = Math.min(1 - y, bounds.height + 2 * py);
  const hole = { x: media.x + x * media.width, y: media.y + y * media.height, w: w * media.width, h: h * media.height };
  const radius = Math.min((settings.borderRadius / video.width) * media.width, hole.w / 2, hole.h / 2);
  ctx.save();
  ctx.globalAlpha *= active.opacity;
  ctx.beginPath();
  ctx.rect(media.x, media.y, media.width, media.height);
  ctx.roundRect(hole.x, hole.y, hole.w, hole.h, radius);
  if (settings.mode === 'dim' || !blurSource) {
    ctx.fillStyle = settings.dimColor;
    ctx.globalAlpha *= settings.dimOpacity;
    ctx.fill('evenodd');
  } else {
    ctx.clip('evenodd');
    ctx.filter = `blur(${(settings.blurAmount * device).toFixed(2)}px)`;
    blurSource();
    ctx.filter = 'none';
  }
  ctx.restore();
}
