// Background-music ducking: speech ranges closer than 500 ms are merged; the music
// drops to `amount` inside a range and ramps back over 100 ms either side.
import type { Caption, VoiceoverClip } from './types';

export type Interval = { start: number; end: number };

export const voiceoverLength = (clip: VoiceoverClip) => Math.max(0, clip.trimEndMs - clip.trimStartMs);

/** Speech ranges on the timeline: captions plus voiceover clips. */
export function duckIntervals(captions: Caption[], voiceovers: VoiceoverClip[]): Interval[] {
  const ranges = [
    ...captions.map(c => ({ start: c.startMs, end: c.endMs })),
    ...voiceovers.map(v => ({ start: v.startTimeMs, end: v.startTimeMs + voiceoverLength(v) })),
  ].filter(r => r.end > r.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start - last.end < 500) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * Music gain multiplier at `time` (ms). A naive ramp would be inverted (full volume right at
 * the speech edge, then a jump down); this ramps the intended way, as the export filter does.
 */
export function duckGain(intervals: Interval[], time: number, amount: number) {
  const ramp = 100;
  let distance = Infinity;
  for (const r of intervals) {
    if (r.start - ramp > time) break;
    distance = Math.min(distance, Math.max(r.start - time, time - r.end, 0));
  }
  return amount + (1 - amount) * Math.min(1, distance / ramp);
}
