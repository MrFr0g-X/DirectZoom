// Motion blur amount: a Gaussian blur over
// the screen layer that peaks halfway through each zoom transition (sin envelope) and grows
// with fast cursor movement. Result is in composition pixels, capped at 20.
import type { CursorEvent, ZoomRegion } from './types';

export type MotionBlurSettings = {
  zoomBlur: boolean; zoomBlurStrength: number;
  cursorBlur: boolean; cursorBlurStrength: number;
  globalStrength: number;
};

export type Transition = { start: number; end: number; type: 'in' | 'out' };

/** Zoom-in windows end at a zoom's start; zoom-out windows begin at its end. */
export function transitions(zooms: ZoomRegion[], duration: number): Transition[] {
  return zooms
    .flatMap(zoom => [
      { start: zoom.start - duration, end: zoom.start, type: 'in' as const },
      { start: zoom.end, end: zoom.end + duration, type: 'out' as const },
    ])
    .sort((a, b) => a.start - b.start);
}

/** Mean normalized cursor speed (units/ms) over up to 3 events either side of `time`. */
function cursorSpeedBlur(cursor: CursorEvent[], time: number, strength: number) {
  let lo = 0, hi = cursor.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (cursor[mid].t < time) lo = mid + 1; else hi = mid;
  }
  const span = Math.min(3, lo, cursor.length - lo - 1);
  if (span < 1) return 0;
  const from = Math.max(0, lo - span), to = Math.min(cursor.length - 1, lo + span);
  if (to - from < 1) return 0;
  let total = 0, count = 0;
  for (let i = from + 1; i <= to; i++) {
    const a = cursor[i - 1], b = cursor[i], dt = b.t - a.t;
    if (dt <= 0) continue;
    total += Math.hypot(b.x - a.x, b.y - a.y) / dt;
    count++;
  }
  if (!count) return 0;
  const speed = total / count, threshold = 0.001;
  return speed < threshold ? 0 : Math.min((speed - threshold) / 0.004, 1) * strength * 8;
}

/**
 * Blur radius (composition px) at `time`. `windows` comes from {@link transitions};
 * `cursor` is the visible, timeline-mapped cursor track.
 */
export function motionBlurAmount(settings: MotionBlurSettings, windows: Transition[], transitionDuration: number, cursor: CursorEvent[], time: number) {
  let amount = 0;
  if (settings.zoomBlur) {
    for (const w of windows) {
      if (time >= w.start && time <= w.end) {
        amount += Math.sin(((time - w.start) / transitionDuration) * Math.PI) * settings.zoomBlurStrength * 15;
        break;
      }
      if (w.start > time) break;
    }
  }
  if (settings.cursorBlur && cursor.length >= 2) amount += cursorSpeedBlur(cursor, time, settings.cursorBlurStrength);
  return Math.min(amount * settings.globalStrength, 20);
}
