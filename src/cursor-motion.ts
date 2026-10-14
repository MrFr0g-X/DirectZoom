// Cursor motion and click feedback
// (regression-tested by tests/cursor-motion.test.mjs).
import type { CursorEvent } from './types';

export type CursorSettings = {
  visible: boolean;
  design: string;
  size: number;
  color: string;
  strokeColor: string;
  smooth: boolean;
  smoothingIntensity: number; // 0–100
  hideWhenIdle: boolean;
  idleHideDelayMs: number;
  clickShrink: boolean;
  clickShrinkAmount: number;
  tiltOnMove: boolean;
  tiltAmount: number;
  highlightClicks: boolean;
  clickEffect: 'ring' | 'ripple' | 'glow' | 'burst' | 'bounce' | 'none';
  clickEffectDuration: number;
  highlightColor: string;
  useDetectedCursorType: boolean;
  forcedCursorType: string;
};

export const defaultCursorSettings: CursorSettings = {
  visible: true, design: 'macos', size: 98, color: '#ffffff', strokeColor: '#000000',
  smooth: true, smoothingIntensity: 50, hideWhenIdle: false, idleHideDelayMs: 1000,
  clickShrink: true, clickShrinkAmount: 0.8, tiltOnMove: true, tiltAmount: 15,
  highlightClicks: false, clickEffect: 'ring', clickEffectDuration: 300, highlightColor: 'rgba(99, 102, 241, 0.4)',
  useDetectedCursorType: true, forcedCursorType: 'default',
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

type Extrapolate = 'extend' | 'clamp';
/** Piecewise linear interpolation (default extrapolation: extend). */
export function interpolate(input: number, inRange: number[], outRange: number[], options: { left?: Extrapolate; right?: Extrapolate } = {}) {
  let segment = 1;
  for (; segment < inRange.length - 1; segment++) if (inRange[segment] >= input) break;
  segment -= 1;
  const [a, b] = [inRange[segment], inRange[segment + 1]];
  const [c, d] = [outRange[segment], outRange[segment + 1]];
  let x = input;
  if (x < a && options.left === 'clamp') x = a;
  if (x > b && options.right === 'clamp') x = b;
  if (c === d) return c;
  return c + ((x - a) / (b - a)) * (d - c);
}

const shown = (e: CursorEvent | undefined) => e?.visible !== false;

/** Index of the last event at or before `time` (0 when before the first). */
export function indexAt(events: CursorEvent[], time: number) {
  let lo = 0, hi = events.length - 1;
  if (hi < 0) return -1;
  if (time < events[0].t) return 0;
  if (time >= events[hi].t) return hi;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (events[mid].t <= time) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Gaussian smoothing of move positions over time (window grows with intensity). */
export function smoothCursor(events: CursorEvent[], intensity: number): CursorEvent[] {
  if (events.length < 3 || intensity <= 0) return events;
  const window = Math.pow(clamp(intensity, 0, 100) / 100, 1.2) * 500;
  if (window <= 0) return events;
  const sigma = Math.max(window / 3, 1);
  return events.map((event, index) => {
    if (event.event !== 'move') return event;
    let sx = 0, sy = 0, sw = 0;
    for (let i = index; i >= 0; i--) {
      const dt = event.t - events[i].t;
      if (dt > window) break;
      const w = Math.exp(-(dt * dt) / (2 * sigma * sigma));
      sx += events[i].x * w; sy += events[i].y * w; sw += w;
    }
    for (let i = index + 1; i < events.length; i++) {
      const dt = events[i].t - event.t;
      if (dt > window) break;
      const w = Math.exp(-(dt * dt) / (2 * sigma * sigma));
      sx += events[i].x * w; sy += events[i].y * w; sw += w;
    }
    return sw === 0 ? event : { ...event, x: clamp(sx / sw, 0, 1), y: clamp(sy / sw, 0, 1) };
  });
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number, tension = 0.5) {
  const t2 = t * t, t3 = t2 * t;
  return tension * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

const LONG_GAP = 300, GAP_MOVE = 200;
/** Cursor position at `time`: linear between samples, blended toward Catmull-Rom by intensity. */
export function positionAt(events: CursorEvent[], time: number, intensity: number) {
  if (!events.length) return { x: 0.5, y: 0.5, cursorType: 'default' };
  const index = indexAt(events, time);
  let cursorType = 'default';
  for (let i = index; i >= 0; i--) if (events[i].cursorType) { cursorType = events[i].cursorType!; break; }
  if (index >= events.length - 1) {
    const last = events[events.length - 1];
    return { x: last.x, y: last.y, cursorType };
  }
  const a = events[index], b = events[index + 1], gap = b.t - a.t;
  if (gap <= 0) return { x: a.x, y: a.y, cursorType };
  // After a long pause the cursor waits, then moves during the last 200 ms.
  const t = gap > LONG_GAP ? clamp((time - (b.t - GAP_MOVE)) / GAP_MOVE, 0, 1) : clamp((time - a.t) / gap, 0, 1);
  const lx = a.x + (b.x - a.x) * t, ly = a.y + (b.y - a.y) * t;
  const blend = clamp(intensity / 100, 0, 1);
  if (blend <= 0) return { x: lx, y: ly, cursorType };
  const p0 = index > 0 ? events[index - 1] : a, p3 = index + 2 < events.length ? events[index + 2] : b;
  const cx = catmullRom(p0.x, a.x, b.x, p3.x, t), cy = catmullRom(p0.y, a.y, b.y, p3.y, t);
  return { x: clamp(mix(lx, cx, blend), 0, 1), y: clamp(mix(ly, cy, blend), 0, 1), cursorType };
}

const IDLE_FADE = 240, REVEAL = 160, IDLE_SCALE = 0.88;
/** Hide-when-idle opacity/scale. `moves` are smoothed move events. */
export function idleState(moves: CursorEvent[], time: number, enabled: boolean, delay = 1000) {
  if (!enabled || !moves.length) return { opacity: 1, scale: 1 };
  const wait = Math.max(0, Number.isFinite(delay) ? delay : 1000);
  if (time < moves[0].t) return { opacity: 0, scale: IDLE_SCALE };
  const index = indexAt(moves, time);
  let burst = index;
  while (burst > 0 && moves[burst].t - moves[burst - 1].t <= wait) burst--;
  const sinceBurst = time - moves[burst].t;
  if (burst > 0 && sinceBurst >= 0 && sinceBurst < REVEAL) {
    const p = easeOutCubic(sinceBurst / REVEAL);
    return { opacity: p, scale: mix(IDLE_SCALE, 1, p) };
  }
  const still = time - moves[index].t;
  if (still <= wait) return { opacity: 1, scale: 1 };
  const p = easeOutCubic((still - wait) / IDLE_FADE);
  return { opacity: 1 - p, scale: mix(1, IDLE_SCALE, p) };
}

/** Bounce click effect scale: 1 → 1.3 → 0.9 → 1 over the effect duration. */
export function bounceScale(sinceClick: number, duration: number) {
  if (sinceClick > duration || sinceClick < 0) return 1;
  const p = sinceClick / duration;
  if (p < 0.2) return interpolate(p, [0, 0.2], [1, 1.3], { right: 'clamp' });
  if (p < 0.5) return interpolate(p, [0.2, 0.5], [1.3, 0.9], { right: 'clamp' });
  return interpolate(p, [0.5, 1], [0.9, 1], { right: 'clamp' });
}

const PRESS_MS = 80, RELEASE_MS = 180;
/** Shrink while the button is held; `events` are raw cursor events. */
export function shrinkScale(events: CursorEvent[], time: number, enabled: boolean, amount = 0.8) {
  if (!enabled || !events.length) return 1;
  for (let i = indexAt(events, time); i >= 0; i--) {
    const event = events[i];
    if (event.event === 'down') {
      const held = time - event.t;
      if (held >= PRESS_MS) return amount;
      const p = clamp(held / PRESS_MS, 0, 1);
      return 1 - (1 - Math.pow(1 - p, 3)) * (1 - amount);
    }
    if (event.event === 'up') {
      const since = time - event.t;
      if (since < 0 || since > RELEASE_MS) return 1;
      const p = clamp(since / RELEASE_MS, 0, 1);
      return amount + (1 - Math.pow(1 - p, 3)) * (1 - amount);
    }
  }
  return 1;
}

/** Tilt (degrees) from horizontal speed over the last 100 ms. */
export function tiltAngle(smoothed: CursorEvent[], time: number, intensity: number, amount: number) {
  const from = Math.max(0, time - 100);
  if (time - from <= 0) return 0;
  const now = positionAt(smoothed, time, intensity), before = positionAt(smoothed, from, intensity);
  const velocity = (now.x - before.x) / (time - from);
  return (velocity >= 0 ? 1 : -1) * Math.min(1, Math.abs(velocity) / 0.0004) * amount;
}

const TYPE_HOLD = 120;
/** Cursor-type changes that last at least 120 ms. */
export function typeChanges(events: CursorEvent[]) {
  const changes: Array<{ t: number; type: string }> = [];
  let current = 'default';
  for (const event of events) {
    const type = event.cursorType || current;
    if (type !== current) { changes.push({ t: event.t, type }); current = type; }
  }
  return changes.filter((change, i) => (i + 1 < changes.length ? changes[i + 1].t : Infinity) - change.t >= TYPE_HOLD);
}

export function typeAt(changes: Array<{ t: number; type: string }>, time: number) {
  if (!changes.length || time < changes[0].t) return 'default';
  let lo = 0, hi = changes.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (changes[mid].t <= time) lo = mid; else hi = mid - 1;
  }
  return changes[lo].type;
}

/** Hotspot as a fraction of the cursor box, per design and cursor type. */
export function hotspot(type: string, design: string) {
  if (type === 'text') return { x: 0.5, y: 0.5 };
  if (design === 'lavender') return type === 'pointer' ? { x: 0.48, y: 0.1 } : { x: 0.08, y: 0.08 };
  if (['minimal', 'crosshair', 'parched', 'chooper', 'amongus', 'turtle'].includes(design)) return { x: 0.5, y: 0.5 };
  if (design === 'macos') return type === 'pointer' ? { x: 0.4, y: 0.27 } : { x: 0.31, y: 0.23 };
  if (design === 'windows') return type === 'pointer' ? { x: 0.33, y: 0.06 } : { x: 0.23, y: 0.13 };
  return { x: 0, y: 0 };
}

export type CursorFrame = {
  x: number; y: number; insideCapturedArea: boolean; cursorType: string;
  opacity: number; scale: number; rotation: number;
  click: { x: number; y: number; since: number } | null;
};

/** Precomputed per-project cursor data; build once, query per frame. */
export function prepareCursor(cursor: CursorEvent[], settings: CursorSettings) {
  const noClicks = cursor.filter(e => e.event !== 'click');
  const visible = noClicks.filter(shown);
  const intensity = settings.smooth === false ? 0 : settings.smoothingIntensity ?? 50;
  const smoothed = intensity > 0 ? smoothCursor(visible, intensity) : visible;
  const moves = smoothed.filter(e => e.event === 'move');
  const changes = typeChanges(smoothed);
  return { raw: cursor, noClicks, visible, smoothed, moves, changes, intensity };
}

export function cursorFrame(prepared: ReturnType<typeof prepareCursor>, settings: CursorSettings, time: number): CursorFrame | null {
  const { raw, noClicks, smoothed, moves, changes, intensity, visible } = prepared;
  if (!settings.visible || !raw.length || !noClicks.length || !smoothed.length) return null;
  // Position: smoothed when the cursor is inside the capture, else the last visible raw point.
  const at = indexAt(noClicks, time);
  let base: { x: number; y: number; cursorType: string; insideCapturedArea: boolean } | null;
  if (shown(noClicks[at])) base = { ...positionAt(smoothed, time, intensity), insideCapturedArea: true };
  else {
    let last = null;
    for (let i = at; i >= 0; i--) if (shown(noClicks[i])) { last = noClicks[i]; break; }
    base = last ? { x: last.x, y: last.y, cursorType: last.cursorType || 'default', insideCapturedArea: false } : null;
  }
  if (!base) return null;
  const idle = idleState(moves, time, !!settings.hideWhenIdle, settings.idleHideDelayMs ?? 1000);
  const detected = changes.length ? typeAt(changes, time) : base.cursorType ?? 'default';
  const cursorType = settings.useDetectedCursorType ? detected : settings.forcedCursorType;

  // Earliest click still inside the effect window.
  const duration = settings.clickEffectDuration || 300;
  let lo = 0, hi = raw.length - 1;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (raw[mid].t < time - duration) lo = mid + 1; else hi = mid; }
  let click: CursorEvent | null = null;
  for (let i = lo; i < raw.length && raw[i].t <= time; i++) if (raw[i].event === 'click') { click = raw[i]; break; }
  const since = click ? time - click.t : -1;
  const bounce = settings.clickEffect === 'bounce' && settings.highlightClicks ? bounceScale(since, duration) : 1;
  const shrink = shrinkScale(raw, time, settings.clickShrink, settings.clickShrinkAmount ?? 0.8);
  const rotation = !settings.tiltOnMove || visible.length < 2 || !base.insideCapturedArea ? 0 : tiltAngle(smoothed, time, intensity, settings.tiltAmount ?? 15);
  return {
    x: base.x, y: base.y, insideCapturedArea: base.insideCapturedArea, cursorType,
    opacity: idle.opacity, scale: idle.scale * bounce * shrink, rotation,
    click: settings.highlightClicks && click ? { x: click.x, y: click.y, since } : null,
  };
}
