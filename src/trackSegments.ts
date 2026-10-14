// Per-track segments for the camera, system audio and microphone tracks. They follow the screen's
// cuts (source time is shared, so they stay in sync), and can additionally be split on their own,
// have pieces removed (hidden / silent there) and have pieces moved in time.
//
// Times are source ms. A segment plays the recording's [start, end) content; `offset` moves it so
// it plays at [start + offset, end + offset) instead. An empty list means "one segment over the
// whole recording" (never edited).
import type { Clip } from './types.ts';
import { clipEnd, sourceToTimeline } from './timeline.ts';

export type MediaTrack = 'camera' | 'system' | 'mic';
export type TrackSegment = { id: string; start: number; end: number; enabled: boolean; offset?: number };
export type TrackSegments = Partial<Record<MediaTrack, TrackSegment[]>>;

const MIN = 50;
let counter = 0;
const newId = () => `seg-${Date.now().toString(36)}-${(counter++).toString(36)}`;
const off = (s: TrackSegment) => s.offset ?? 0;
/** Where a segment plays (source time after its offset). */
export const shown = (s: TrackSegment) => ({ start: s.start + off(s), end: s.end + off(s) });

/** The track's segments, or a single segment over the whole recording. */
export function segmentsOf(list: TrackSegment[] | undefined, sourceDuration: number): TrackSegment[] {
  return list && list.length ? list : [{ id: 'all', start: 0, end: sourceDuration, enabled: true }];
}

/** Splits the segment playing at `time` (ignored within 50 ms of a segment edge). */
export function splitTrack(list: TrackSegment[] | undefined, sourceDuration: number, time: number): TrackSegment[] {
  const segments = segmentsOf(list, sourceDuration);
  const index = segments.findIndex(s => time > shown(s).start + MIN && time < shown(s).end - MIN);
  if (index < 0) return segments;
  const s = segments[index];
  const at = time - off(s);
  return [...segments.slice(0, index), { ...s, id: newId(), end: at }, { ...s, id: newId(), start: at }, ...segments.slice(index + 1)];
}

/** Removes (disables) a segment: the track is hidden or silent there. */
export function removeSegment(list: TrackSegment[] | undefined, sourceDuration: number, id: string): TrackSegment[] {
  return segmentsOf(list, sourceDuration).map(s => (s.id === id ? { ...s, enabled: false } : s));
}

/**
 * Moves a segment to play `offset` ms from its recorded position, clamped to the recording and so
 * that it never overlaps another (enabled) segment of the same track.
 */
export function moveSegment(list: TrackSegment[] | undefined, sourceDuration: number, id: string, offset: number): TrackSegment[] {
  const segments = segmentsOf(list, sourceDuration);
  const target = segments.find(s => s.id === id);
  if (!target) return segments;
  const length = target.end - target.start;
  let lo = 0, hi = sourceDuration;
  const here = shown(target);
  for (const other of segments) {
    if (other.id === id || !other.enabled) continue;
    const o = shown(other);
    if (o.end <= here.start + 1) lo = Math.max(lo, o.end);
    else if (o.start >= here.end - 1) hi = Math.min(hi, o.start);
  }
  const start = Math.min(Math.max(target.start + offset, lo), hi - length);
  return segments.map(s => (s.id === id ? { ...s, offset: Math.round(start - target.start) } : s));
}

/** The recording time the track plays at source time `time`, or null when it is silent/hidden. */
export function trackSource(list: TrackSegment[] | undefined, time: number): number | null {
  if (!list || !list.length) return time;
  const segment = list.find(s => s.enabled && time >= shown(s).start && time < shown(s).end);
  return segment ? time - off(segment) : null;
}

/** Whether the track plays at source time `time`. */
export function trackOn(list: TrackSegment[] | undefined, time: number): boolean {
  return trackSource(list, time) !== null;
}

/** A source range's visible pieces on the timeline (one per screen clip it overlaps). */
export function onTimeline(start: number, end: number, clips: Clip[]): Array<{ start: number; end: number }> {
  const pieces: Array<{ start: number; end: number }> = [];
  for (const clip of clips) {
    const a = Math.max(start, clip.sourceStart), b = Math.min(end, clip.sourceEnd);
    if (b - a <= 0) continue;
    const ta = sourceToTimeline(a, [clip]) ?? clip.timelineStart;
    const tb = sourceToTimeline(b, [clip]) ?? clipEnd(clip);
    if (tb - ta > 0.5) pieces.push({ start: ta, end: tb });
  }
  return pieces;
}

/**
 * Each segment's visible pieces on the timeline (one per screen clip it overlaps), with the part of
 * the recording each piece plays and that clip's speed.
 */
export function trackPieces(list: TrackSegment[] | undefined, sourceDuration: number, clips: Clip[]) {
  const out: Array<{ id: string; enabled: boolean; start: number; end: number; sourceStart: number; sourceEnd: number; speed: number }> = [];
  for (const segment of segmentsOf(list, sourceDuration)) {
    const range = shown(segment);
    for (const clip of clips) {
      const a = Math.max(range.start, clip.sourceStart), b = Math.min(range.end, clip.sourceEnd);
      if (b - a <= 0) continue;
      const start = sourceToTimeline(a, [clip]) ?? clip.timelineStart;
      const end = sourceToTimeline(b, [clip]) ?? clipEnd(clip);
      if (end - start > 0.5) out.push({ id: segment.id, enabled: segment.enabled, start, end, sourceStart: a - off(segment), sourceEnd: b - off(segment), speed: clip.speed || 1 });
    }
  }
  return out;
}

/**
 * Audio pieces for the exporter (part of the recording, output start in ms, speed), or null for a
 * track that was never split, removed or moved (the exporter then uses the plain clip assembly).
 */
export function audioPieces(list: TrackSegment[] | undefined, clips: Clip[]) {
  if (!list || !list.length) return null;
  return trackPieces(list, Infinity, clips).filter(p => p.enabled)
    .map(p => ({ sourceStart: p.sourceStart, sourceEnd: p.sourceEnd, outputStart: p.start, speed: p.speed }));
}

/** Timeline ranges (output ms) where the track is removed. */
export function removedRanges(list: TrackSegment[] | undefined, clips: Clip[]): Array<{ start: number; end: number }> {
  if (!list) return [];
  return list.filter(s => !s.enabled).flatMap(s => onTimeline(shown(s).start, shown(s).end, clips));
}

/** Normalises what was read from disk (missing file → no edits). */
export function readTrackSegments(raw: unknown): TrackSegments {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: TrackSegments = {};
  for (const track of ['camera', 'system', 'mic'] as const) {
    const list = (raw as Record<string, unknown>)[track];
    if (Array.isArray(list)) {
      out[track] = list.filter(s => s && typeof s.start === 'number' && typeof s.end === 'number')
        .map(s => ({ id: String(s.id), start: s.start, end: s.end, enabled: s.enabled !== false, ...(typeof s.offset === 'number' && s.offset ? { offset: s.offset } : {}) }));
    }
  }
  return out;
}
