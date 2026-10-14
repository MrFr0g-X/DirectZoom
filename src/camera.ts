// Zoom camera (regression-tested by tests/camera.test.mjs). Zoom in/out follows a spring stretched to the transition
// length; while zoomed, the focus can track the cursor inside a safe zone.
import type { CursorEvent, ZoomRegion } from './types';

export type SpringConfig = { damping: number; mass: number; stiffness: number; overshootClamping?: boolean };
export const springPresets: Record<'slow' | 'mellow' | 'quick' | 'rapid', SpringConfig> = {
  slow: { damping: 30, mass: 2, stiffness: 50 },
  mellow: { damping: 20, mass: 1, stiffness: 100 },
  quick: { damping: 15, mass: 0.5, stiffness: 200 },
  rapid: { damping: 10, mass: 0.3, stiffness: 300 },
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const lerpClamped = (value: number, [a, b]: [number, number], [c, d]: [number, number]) =>
  c + (d - c) * clamp((value - a) / (b - a), 0, 1);

// ---- Spring (analytic damped oscillator, advanced one frame at a time) ----

type SpringState = { lastTimestamp: number; current: number; toValue: number; velocity: number };

function advance(state: SpringState, now: number, config: SpringConfig): SpringState {
  const { toValue, lastTimestamp, current, velocity } = state;
  const t = Math.min(now - lastTimestamp, 64) / 1000;
  const { damping: c, mass: m, stiffness: k } = config;
  const v0 = -velocity;
  const x0 = toValue - current;
  const zeta = c / (2 * Math.sqrt(k * m));
  const omega0 = Math.sqrt(k / m);
  const omega1 = omega0 * Math.sqrt(1 - zeta ** 2);
  const sin1 = Math.sin(omega1 * t);
  const cos1 = Math.cos(omega1 * t);
  const envelope = Math.exp(-zeta * omega0 * t);
  const fragment = envelope * (sin1 * ((v0 + zeta * omega0 * x0) / omega1) + x0 * cos1);
  const critical = Math.exp(-omega0 * t);
  return {
    toValue, lastTimestamp: now,
    current: zeta < 1 ? toValue - fragment : toValue - critical * (x0 + (v0 + omega0 * x0) * t),
    velocity: zeta < 1
      ? zeta * omega0 * fragment - envelope * (cos1 * (v0 + zeta * omega0 * x0) - omega1 * x0 * sin1)
      : critical * (v0 * (t * omega0 - 1) + t * x0 * omega0 * omega0),
  };
}

const defaultSpring: SpringConfig = { damping: 10, mass: 1, stiffness: 100, overshootClamping: false };
const simulationCache = new Map<string, SpringState>();

function simulate(frame: number, fps: number, config: SpringConfig): SpringState {
  const key = [frame, fps, config.damping, config.mass, config.overshootClamping, config.stiffness].join('-');
  const cached = simulationCache.get(key);
  if (cached) return cached;
  const merged = { ...defaultSpring, ...config };
  let state: SpringState = { lastTimestamp: 0, current: 0, toValue: 1, velocity: 0 };
  const target = Math.max(0, frame);
  const fraction = target % 1;
  for (let f = 0; f <= Math.floor(target); f++) {
    const step = f === Math.floor(target) ? f + fraction : f;
    state = advance(state, (step / fps) * 1000, merged);
    if (f === Math.floor(target)) break;
  }
  simulationCache.set(key, state);
  return state;
}

const naturalDurationCache = new Map<string, number>();
/** Frames until the spring settles within `threshold` and stays there for 20 frames. */
export function measureSpring(fps: number, config: SpringConfig, threshold = 0.005): number {
  const key = [fps, config.damping, config.mass, config.overshootClamping, config.stiffness, threshold].join('-');
  const cached = naturalDurationCache.get(key);
  if (cached !== undefined) return cached;
  let frame = 0;
  let distance = Math.abs(simulate(frame, fps, config).current - 1);
  while (distance >= threshold) distance = Math.abs(simulate(++frame, fps, config).current - 1);
  let finished = frame;
  for (let i = 0; i < 20; i++) {
    distance = Math.abs(simulate(++frame, fps, config).current - 1);
    if (distance >= threshold) { i = 0; finished = frame + 1; }
  }
  naturalDurationCache.set(key, finished);
  return finished;
}

/** Damped spring from 0 to 1, optionally stretched to `durationInFrames`. */
export function spring(frame: number, fps: number, config: SpringConfig, durationInFrames?: number): number {
  const scaled = durationInFrames === undefined ? frame : frame / (durationInFrames / measureSpring(fps, config));
  if (durationInFrames && frame > durationInFrames) return 1;
  const value = simulate(scaled, fps, config).current;
  return config.overshootClamping ? Math.min(value, 1) : value;
}

// ---- Follow cursor ----

export type Bounds = { minX: number; maxX: number; minY: number; maxY: number; visX: number; visY: number };
export const fullBounds: Bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1, visX: 1, visY: 1 };

type FollowSpring = { stiffness: number; damping: number; mass: number; reactionDelay: number; velocityThreshold: number };
const followSpring: FollowSpring = { stiffness: 80, damping: 0.85, mass: 1.5, reactionDelay: 50, velocityThreshold: 0.0001 };

const clampToBounds = (x: number, y: number, b: Bounds) => ({ x: clamp(x, b.minX, b.maxX), y: clamp(y, b.minY, b.maxY) });

/** Near the edges of the allowed area the camera reacts faster. */
function nearEdge(x: number, y: number, b: Bounds) {
  const u = (x - b.minX) / Math.max(1e-6, b.maxX - b.minX);
  const v = (y - b.minY) / Math.max(1e-6, b.maxY - b.minY);
  return u < 0.1 || u > 0.9 || v < 0.1 || v > 0.9;
}

/** Last raw event at or before `time`, if visible and no older than `maxAge` ms. */
function cursorAt(events: CursorEvent[], time: number, maxAge = Infinity) {
  if (!events.length || time < events[0].t) return null;
  let lo = 0, hi = events.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (events[mid].t <= time) lo = mid; else hi = mid - 1;
  }
  const event = events[lo];
  if (!event || event.visible === false || time - event.t > maxAge) return null;
  return { x: clamp(event.x, 0, 1), y: clamp(event.y, 0, 1) };
}

function samplePath(events: CursorEvent[], from: number, to: number, step: number, maxAge: number) {
  const samples: Array<{ time: number; x: number; y: number }> = [];
  for (let time = from; time <= to; time += step) {
    const p = cursorAt(events, time, maxAge);
    if (p) samples.push({ time, ...p });
  }
  const last = cursorAt(events, to, maxAge);
  if (last && (!samples.length || samples[samples.length - 1].time < to)) samples.push({ time: to, ...last });
  return samples;
}

function springStep(position: number, velocity: number, target: number, config: FollowSpring, dt: number) {
  const offset = position - target;
  const nextVelocity = velocity + ((-config.stiffness * offset - 2 * Math.sqrt(config.stiffness * config.mass) * config.damping * velocity) / config.mass) * dt;
  if (Math.abs(nextVelocity) < config.velocityThreshold && Math.abs(offset) < config.velocityThreshold) return { position: target, velocity: 0 };
  return { position: position + nextVelocity * dt, velocity: nextVelocity };
}

function keepInside(position: number, velocity: number, min: number, max: number) {
  const clamped = clamp(position, min, max);
  return { position: clamped, velocity: clamped === position ? velocity : 0 };
}

/** Where the camera should aim so the cursor stays inside the safe zone of the zoomed view. */
function safeZoneTarget(cx: number, cy: number, fx: number, fy: number, scale: number, safeZone: number, vx: number, vy: number, b: Bounds) {
  const viewW = b.visX / scale, viewH = b.visY / scale;
  const zoneW = viewW * safeZone, zoneH = viewH * safeZone;
  const dx = cx - fx, dy = cy - fy;
  let x = fx, y = fy, needsMovement = false, urgency = 0;
  const recentre = 0.7;
  const overX = Math.max(0, Math.abs(dx) - zoneW / 2), overY = Math.max(0, Math.abs(dy) - zoneH / 2);
  const reach = 0.5 * Math.max(viewW, viewH);
  if (dx < -zoneW / 2) { x = cx + (zoneW * recentre) / 2; needsMovement = true; urgency = Math.max(urgency, Math.min(1, overX / reach)); }
  else if (dx > zoneW / 2) { x = cx - (zoneW * recentre) / 2; needsMovement = true; urgency = Math.max(urgency, Math.min(1, overX / reach)); }
  if (dy < -zoneH / 2) { y = cy + (zoneH * recentre) / 2; needsMovement = true; urgency = Math.max(urgency, Math.min(1, overY / reach)); }
  else if (dy > zoneH / 2) { y = cy - (zoneH * recentre) / 2; needsMovement = true; urgency = Math.max(urgency, Math.min(1, overY / reach)); }
  if (Math.hypot(vx, vy) > 0.01) urgency = Math.min(1, urgency + 0.3);
  return { ...clampToBounds(x, y, b), needsMovement, urgency };
}

function followSafeZone(events: CursorEvent[], time: number, from: number, region: ZoomRegion, scale: number, safeZone: number, smoothing: number, fps: number, b: Bounds) {
  const stiffnessFactor = lerpClamped(smoothing, [0.05, 0.3], [1.5, 0.5]);
  const config = { ...followSpring, stiffness: followSpring.stiffness * stiffnessFactor, reactionDelay: lerpClamped(smoothing, [0.05, 0.3], [30, 100]) };
  const frameMs = 1000 / fps, dt = frameMs / 1000;
  const path = samplePath(events, from, time, frameMs, 250);
  const start = clampToBounds(region.focus.x, region.focus.y, b);
  if (!path.length) return { ...start, isFollowing: false };
  const state = { x: start.x, y: start.y, vx: 0, vy: 0 };
  let following = false, target = { x: state.x, y: state.y }, lastRetarget = from;
  for (let i = 0; i < path.length; i++) {
    const point = path[i];
    let vx = 0, vy = 0;
    if (i > 0) {
      const prev = path[i - 1], elapsed = point.time - prev.time;
      if (elapsed > 0) { vx = (point.x - prev.x) / elapsed; vy = (point.y - prev.y) / elapsed; }
    }
    const aim = safeZoneTarget(point.x, point.y, state.x, state.y, scale, safeZone, vx, vy, b);
    if (aim.needsMovement) {
      following = true;
      const delay = config.reactionDelay * lerpClamped(aim.urgency, [0, 1], [1, 0.1]) * (nearEdge(point.x, point.y, b) ? 0.3 : 1);
      if (point.time - lastRetarget >= delay || aim.urgency > 0.7) { target = { x: aim.x, y: aim.y }; lastRetarget = point.time; }
    }
    const boosted = { ...config, stiffness: config.stiffness * (1 + 0.5 * aim.urgency) };
    const sx = springStep(state.x, state.vx, target.x, boosted, dt), sy = springStep(state.y, state.vy, target.y, boosted, dt);
    const kx = keepInside(sx.position, sx.velocity, b.minX, b.maxX), ky = keepInside(sy.position, sy.velocity, b.minY, b.maxY);
    state.x = kx.position; state.vx = kx.velocity; state.y = ky.position; state.vy = ky.velocity;
  }
  return { ...clampToBounds(state.x, state.y, b), isFollowing: following };
}

function followAlways(events: CursorEvent[], time: number, from: number, region: ZoomRegion, smoothing: number, fps: number, b: Bounds) {
  const stiffnessFactor = lerpClamped(smoothing, [0.05, 0.3], [2, 0.7]);
  const config = { ...followSpring, stiffness: followSpring.stiffness * stiffnessFactor, reactionDelay: lerpClamped(smoothing, [0.05, 0.3], [16, 50]) };
  const frameMs = 1000 / fps, dt = frameMs / 1000;
  const path = samplePath(events, from, time, frameMs, 250);
  const start = clampToBounds(region.focus.x, region.focus.y, b);
  if (!path.length) return { ...start, isFollowing: false };
  const state = { x: start.x, y: start.y, vx: 0, vy: 0 };
  let lastRetarget = from, target = { x: state.x, y: state.y };
  for (const point of path) {
    const delay = nearEdge(point.x, point.y, b) ? 0.3 * config.reactionDelay : config.reactionDelay;
    if (point.time - lastRetarget >= delay) { target = clampToBounds(point.x, point.y, b); lastRetarget = point.time; }
    const sx = springStep(state.x, state.vx, target.x, config, dt), sy = springStep(state.y, state.vy, target.y, config, dt);
    const kx = keepInside(sx.position, sx.velocity, b.minX, b.maxX), ky = keepInside(sy.position, sy.velocity, b.minY, b.maxY);
    state.x = kx.position; state.vx = kx.velocity; state.y = ky.position; state.vy = ky.velocity;
  }
  return { ...clampToBounds(state.x, state.y, b), isFollowing: true };
}

// ---- Camera ----

export type CameraSettings = {
  enabled: boolean; transitionDuration: number; followCursor: boolean;
  followCursorSafeZone?: number; followCursorSmoothing?: number; followCursorAlwaysTrack?: boolean;
};
export type CameraState = { scale: number; focusX: number; focusY: number; isZooming: boolean; isFollowingCursor: boolean; progress: number };

/**
 * Camera at time `time` (ms) / frame `frame`. `cursor` is the raw recorded cursor data.
 * `bounds` limits where the focus may go (used with crop).
 */
export function cameraAt(zooms: ZoomRegion[], settings: CameraSettings, cursor: CursorEvent[], time: number, fps: number, frame: number, bounds: Bounds = fullBounds): CameraState {
  const idle: CameraState = { scale: 1, focusX: 0.5, focusY: 0.5, isZooming: false, isFollowingCursor: false, progress: 0 };
  if (!settings.enabled || !zooms.length) return idle;
  const transition = settings.transitionDuration;
  const transitionFrames = Math.round((transition / 1000) * fps);
  const region = zooms.find(zoom => time >= zoom.start - transition && time <= zoom.end + transition);
  if (!region) return idle;
  let progress = 1, isZooming = false;
  if (time < region.start) {
    isZooming = true;
    progress = spring(Math.max(0, frame - Math.round(((region.start - transition) / 1000) * fps)), fps, springPresets.mellow, transitionFrames);
  } else if (time > region.end) {
    isZooming = true;
    progress = 1 - spring(Math.max(0, frame - Math.round((region.end / 1000) * fps)), fps, springPresets.mellow, transitionFrames);
  }
  const scale = lerpClamped(progress, [0, 1], [1, region.scale]);
  const events = settings.followCursor ? cursor : [];
  if (scale <= 1 || !events.length) {
    const focus = { x: clamp(lerpClamped(progress, [0, 1], [0.5, region.focus.x]), 0, 1), y: clamp(lerpClamped(progress, [0, 1], [0.5, region.focus.y]), 0, 1) };
    return { scale, focusX: focus.x, focusY: focus.y, isZooming, isFollowingCursor: false, progress: clamp(progress, 0, 1) };
  }
  const from = region.start - transition;
  const smoothing = settings.followCursorSmoothing ?? 0.12;
  const follow = settings.followCursorAlwaysTrack
    ? followAlways(events, time, from, region, smoothing, fps, bounds)
    : followSafeZone(events, time, from, region, scale, settings.followCursorSafeZone ?? 0.7, smoothing, fps, bounds);
  const focus = clampToBounds(lerpClamped(progress, [0, 1], [0.5, follow.x]), lerpClamped(progress, [0, 1], [0.5, follow.y]), bounds);
  return { scale, focusX: focus.x, focusY: focus.y, isZooming, isFollowingCursor: follow.isFollowing, progress: clamp(progress, 0, 1) };
}
