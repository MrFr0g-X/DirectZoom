// Clip timeline: kept pieces of the source placed back to back. Zooms and cursor data stay in
// source time and are mapped onto the timeline for rendering.
import type { Clip, CursorEvent, ZoomRegion } from './types';

export const clipLength = (clip: Clip) => (clip.sourceEnd - clip.sourceStart) / (clip.speed || 1);
export const clipEnd = (clip: Clip) => clip.timelineStart + clipLength(clip);
export const totalDuration = (clips: Clip[]) => clips.reduce((sum, clip) => sum + clipLength(clip), 0);

const toTimeline = (t: number, clip: Clip) => clip.timelineStart + (t - clip.sourceStart) / (clip.speed || 1);

/** Source time → timeline time, or null when the source time was cut. */
export function sourceToTimeline(t: number, clips: Clip[]): number | null {
  for (const clip of clips) if (t >= clip.sourceStart && t < clip.sourceEnd) return toTimeline(t, clip);
  for (let i = clips.length - 1; i >= 0; i--) if (t === clips[i].sourceEnd) return toTimeline(t, clips[i]);
  return null;
}

/** Timeline time → source time (clamped into the clip under the playhead). */
export function timelineToSource(time: number, clips: Clip[]): number {
  if (!clips.length) return time;
  for (const clip of clips) if (time >= clip.timelineStart && time < clipEnd(clip)) return clip.sourceStart + (time - clip.timelineStart) * (clip.speed || 1);
  const last = clips[clips.length - 1];
  return time < 0 ? clips[0].sourceStart : last.sourceEnd;
}

export function mapCursor(cursor: CursorEvent[], clips: Clip[]): CursorEvent[] {
  if (!clips.length) return cursor;
  const mapped: CursorEvent[] = [];
  for (const event of cursor) {
    const t = sourceToTimeline(event.t, clips);
    if (t !== null) mapped.push({ ...event, t });
  }
  return mapped;
}

export function mapZooms(zooms: ZoomRegion[], clips: Clip[]): ZoomRegion[] {
  return mapRanges(zooms, clips);
}

/** Maps any source-time ranges onto the timeline, splitting them at cuts. */
export function mapRanges<T extends { id: string; start: number; end: number }>(zooms: T[], clips: Clip[]): T[] {
  if (!clips.length) return zooms;
  const mapped: T[] = [];
  for (const zoom of zooms) for (const clip of clips) {
    const start = Math.max(zoom.start, clip.sourceStart), end = Math.min(zoom.end, clip.sourceEnd);
    if (start >= end) continue;
    mapped.push({ ...zoom, id: zoom.id + (clips.length > 1 ? `-${clip.id}` : ''), start: toTimeline(start, clip), end: toTimeline(end, clip) });
  }
  return mapped;
}

/** Re-flows clips back to back in their current order. */
export function reflow(clips: Clip[]): Clip[] {
  let at = 0;
  return clips.map(clip => {
    const next = { ...clip, timelineStart: at };
    at += clipLength(next);
    return next;
  });
}

let counter = 0;
const newId = () => `clip-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Splits the clip under `time` (timeline ms). */
export function splitAt(clips: Clip[], time: number): Clip[] {
  const index = clips.findIndex(clip => time > clip.timelineStart + 50 && time < clipEnd(clip) - 50);
  if (index < 0) return clips;
  const clip = clips[index];
  const sourceTime = clip.sourceStart + (time - clip.timelineStart) * (clip.speed || 1);
  const left = { ...clip, sourceEnd: sourceTime };
  const right = { ...clip, id: newId(), sourceStart: sourceTime };
  return reflow([...clips.slice(0, index), left, right, ...clips.slice(index + 1)]);
}

export function removeClip(clips: Clip[], id: string): Clip[] {
  if (clips.length <= 1) return clips;
  return reflow(clips.filter(clip => clip.id !== id));
}

/** Moves one edge of a clip, keeping it inside the source and at least 100 ms long. */
export function trimClip(clips: Clip[], id: string, edge: 'start' | 'end', sourceTime: number, sourceDuration: number): Clip[] {
  return reflow(clips.map(clip => {
    if (clip.id !== id) return clip;
    if (edge === 'start') return { ...clip, sourceStart: Math.min(Math.max(0, sourceTime), clip.sourceEnd - 100) };
    return { ...clip, sourceEnd: Math.max(Math.min(sourceDuration, sourceTime), clip.sourceStart + 100) };
  }));
}

/** Kept source ranges in output order (for exporting audio). */
export const segments = (clips: Clip[]) => clips.map(clip => ({ start: clip.sourceStart, end: clip.sourceEnd, speed: clip.speed || 1 }));

/** Removes source-time ranges from the clips (e.g. filler words); clips reflow back to back. */
export function cutRanges(clips: Clip[], ranges: Array<{ start: number; end: number }>, minLength = 60): Clip[] {
  let pieces = clips;
  for (const range of ranges) {
    if (range.end - range.start < minLength) continue;
    pieces = pieces.flatMap(clip => {
      if (range.end <= clip.sourceStart || range.start >= clip.sourceEnd) return [clip];
      const out: Clip[] = [];
      if (range.start - clip.sourceStart >= minLength) out.push({ ...clip, sourceEnd: range.start });
      if (clip.sourceEnd - range.end >= minLength) out.push({ ...clip, id: out.length ? newId() : clip.id, sourceStart: range.end });
      return out;
    });
  }
  return reflow(pieces);
}

/** The clip playing at `time` (timeline ms). */
export const clipAt = (time: number, clips: Clip[]) => clips.find(clip => time >= clip.timelineStart && time < clipEnd(clip)) ?? clips[clips.length - 1];

/** Changes a clip's playback speed; later clips move to stay back to back. */
export function setClipSpeed(clips: Clip[], id: string, speed: number): Clip[] {
  return reflow(clips.map(clip => (clip.id === id ? { ...clip, speed } : clip)));
}

/** Moves a clip to position `index` in the clip order (the timeline is laid out again). */
export function moveClip(clips: Clip[], id: string, index: number): Clip[] {
  const from = clips.findIndex(clip => clip.id === id);
  if (from < 0) return clips;
  const to = Math.max(0, Math.min(clips.length - 1, index));
  if (to === from) return clips;
  const order = [...clips];
  const [clip] = order.splice(from, 1);
  order.splice(to, 0, clip);
  return reflow(order);
}
