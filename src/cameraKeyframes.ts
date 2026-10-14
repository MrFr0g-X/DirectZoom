// Webcam keyframes (camera-keyframes.json): position, shape, size, roundness, mirror,
// visibility and opacity change over time. Between two keyframes size, roundness and position
// follow a damped spring (damping 20, mass 1, stiffness 100) stretched over the gap, opacity
// is linear, and discrete properties switch half way.
import { spring } from './camera.ts';
import type { CameraKeyframe, CameraSettings } from './types';

export const cells: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 }, 2: { x: 0.5, y: 0 }, 3: { x: 1, y: 0 }, 4: { x: 0, y: 0.5 }, 5: { x: 0.5, y: 0.5 },
  6: { x: 1, y: 0.5 }, 7: { x: 0, y: 1 }, 8: { x: 0.5, y: 1 }, 9: { x: 1, y: 1 },
};

export type CameraPose = {
  x: number; y: number; shape: CameraSettings['shape']; size: number; roundness: number; mirror: boolean; visible: boolean; opacity: number;
};

const SPRING = { damping: 20, mass: 1, stiffness: 100, overshootClamping: false };

function bracket(keyframes: CameraKeyframe[], time: number) {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  let prev: CameraKeyframe | null = null, next: CameraKeyframe | null = null;
  for (const k of sorted) {
    if (k.time <= time) prev = k;
    if (k.time > time && !next) { next = k; break; }
  }
  if (!prev && sorted.length) prev = sorted[0];
  return { prev, next };
}

const place = (k: CameraKeyframe) => k.customPosition ?? cells[k.position] ?? cells[9];

/** Camera pose at `time` (timeline ms) from timeline-mapped keyframes. */
export function cameraPoseAt(keyframes: CameraKeyframe[], settings: CameraSettings, time: number, fps: number): CameraPose {
  if (!keyframes.length) {
    const p = cells[settings.position] ?? cells[9];
    return { x: p.x, y: p.y, shape: settings.shape, size: settings.size, roundness: settings.roundness, mirror: settings.mirror, visible: settings.visible, opacity: 1 };
  }
  const { prev, next } = bracket(keyframes, time);
  if (!prev || !next || prev === next) {
    const k = (prev ?? next ?? keyframes[0])!;
    const p = place(k);
    return { x: p.x, y: p.y, shape: k.shape ?? settings.shape, size: k.size, roundness: k.roundness, mirror: k.mirror, visible: k.visible, opacity: k.opacity };
  }
  const gap = next.time - prev.time, local = time - prev.time;
  const s = Math.min(1, spring(Math.floor((local / 1000) * fps), fps, SPRING, Math.ceil((gap / 1000) * fps)));
  const linear = Math.min(1, local / gap);
  const a = place(prev), b = place(next);
  return {
    x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s,
    shape: linear < 0.5 ? prev.shape ?? settings.shape : next.shape ?? settings.shape,
    size: prev.size + (next.size - prev.size) * s,
    roundness: prev.roundness + (next.roundness - prev.roundness) * s,
    mirror: linear < 0.5 ? prev.mirror : next.mirror,
    visible: linear < 0.5 ? prev.visible : next.visible,
    opacity: prev.opacity + (next.opacity - prev.opacity) * linear,
  };
}
