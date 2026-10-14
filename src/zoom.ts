import type { CursorEvent, ZoomRegion } from './types';

export type GeneratorSettings = { autoZoom: boolean; zoomOnClicks: boolean; zoomOnSlowdown: boolean; zoomScale: number; transitionMs: number };

type Candidate = { time: number; x: number; y: number; clusterDuration: number };
const shown = (event: CursorEvent) => event.visible !== false;
const midpoint = (a: number, b: number) => (a + b) / 2;

export function clickCandidates(events: CursorEvent[]): Candidate[] {
  // Recorded order is kept; only merged candidates are sorted.
  const clicks = events.filter(event => shown(event) && (event.event === 'click' || event.event === 'down'));
  if (!clicks.length) return [];
  const clusters: CursorEvent[][] = [[clicks[0]]];
  for (const event of clicks.slice(1)) {
    const cluster = clusters[clusters.length - 1];
    if (event.t - cluster[cluster.length - 1].t <= 2500) cluster.push(event);
    else clusters.push([event]);
  }
  return clusters.map(cluster => ({
    time: midpoint(cluster[0].t, cluster[cluster.length - 1].t),
    x: cluster.reduce((sum, event) => sum + event.x, 0) / cluster.length,
    y: cluster.reduce((sum, event) => sum + event.y, 0) / cluster.length,
    clusterDuration: cluster[cluster.length - 1].t - cluster[0].t,
  }));
}

export function slowdownCandidates(events: CursorEvent[]): Candidate[] {
  const moves = events.filter(event => shown(event) && event.event === 'move');
  if (moves.length < 3) return [];
  const speeds: Array<Candidate & { velocity: number }> = [];
  for (let index = 1; index < moves.length; index++) {
    const previous = moves[index - 1], current = moves[index];
    const elapsed = current.t - previous.t;
    if (elapsed <= 0) continue;
    speeds.push({ time: current.t, x: current.x, y: current.y, velocity: Math.hypot(current.x - previous.x, current.y - previous.y) / elapsed * 1000, clusterDuration: 0 });
  }
  if (speeds.length < 10) return [];
  const threshold = speeds.reduce((sum, item) => sum + item.velocity, 0) / speeds.length * 0.15;
  const candidates: Candidate[] = [];
  let start: number | null = null;
  for (let index = 0; index < speeds.length; index++) {
    if (speeds[index].velocity < threshold) { if (start === null) start = index; continue; }
    if (start === null) continue;
    const last = index - 1;
    const duration = speeds[last].time - speeds[start].time;
    if (duration >= 200) {
      const middle = speeds[Math.floor((start + index - 1) / 2)];
      candidates.push({ time: middle.time, x: middle.x, y: middle.y, clusterDuration: duration });
    }
    start = null;
  }
  // A low-speed run closes only when a faster sample follows it,
  // so a run that lasts until the final sample produces no candidate.
  return candidates;
}

export function generateZooms(events: CursorEvent[], settings: GeneratorSettings, duration: number): ZoomRegion[] {
  if (!settings.autoZoom) return [];
  const points = [
    ...(settings.zoomOnClicks ? clickCandidates(events) : []),
    ...(settings.zoomOnSlowdown ? slowdownCandidates(events) : []),
  ].sort((a, b) => a.time - b.time);
  if (!points.length) return [];

  const merged: Candidate[] = [{ ...points[0] }];
  for (const point of points.slice(1)) {
    const prior = merged[merged.length - 1];
    if (point.time - prior.time >= 5000) { merged.push({ ...point }); continue; }
    const begin = prior.time - prior.clusterDuration / 2;
    const end = point.time + point.clusterDuration / 2;
    prior.x = midpoint(prior.x, point.x);
    prior.y = midpoint(prior.y, point.y);
    prior.time = midpoint(begin, end);
    prior.clusterDuration = end - begin;
  }

  const regions: ZoomRegion[] = merged.map((point, index): ZoomRegion => {
    const span = Math.min(6000, 3000 + point.clusterDuration);
    return {
      id: `auto-${index}-${Math.round(point.time)}`,
      start: Math.max(0, point.time - span / 2 - settings.transitionMs),
      end: Math.min(duration, point.time + span / 2),
      scale: settings.zoomScale,
      focus: { x: point.x, y: point.y },
      source: 'auto',
    };
  }).sort((a, b) => a.start - b.start);

  const overlap: ZoomRegion[] = [];
  for (const region of regions) {
    const prior = overlap[overlap.length - 1];
    if (!prior || region.start > prior.end) { overlap.push({ ...region }); continue; }
    prior.end = Math.max(prior.end, region.end);
    prior.scale = Math.max(prior.scale, region.scale);
  }
  const result: ZoomRegion[] = [];
  for (const region of overlap) {
    const prior = result[result.length - 1];
    if (!prior || region.start - prior.end >= settings.transitionMs * 3) { result.push({ ...region }); continue; }
    prior.end = Math.max(prior.end, region.end);
    prior.scale = Math.max(prior.scale, region.scale);
    prior.focus = { x: midpoint(prior.focus.x, region.focus.x), y: midpoint(prior.focus.y, region.focus.y) };
  }
  return result;
}

export function zoomAt(time: number, regions: ZoomRegion[], transitionMs: number) {
  const region = regions.find(item => time >= item.start && time <= item.end);
  if (!region) return { scale: 1, focus: { x: 0.5, y: 0.5 } };
  const transition = Math.min(transitionMs, (region.end - region.start) / 2);
  const amount = transition <= 0 ? 1 : Math.min(1, (time - region.start) / transition, (region.end - time) / transition);
  const eased = amount * amount * (3 - 2 * amount);
  return { scale: 1 + (region.scale - 1) * eased, focus: region.focus };
}
