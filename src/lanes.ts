// Timeline lanes: items that overlap in time go on separate rows of their track, like stacked
// layers in a video editor. Greedy packing in start order keeps each item on the lowest free row.

export type Span = { id: string; start: number; end: number };

/** Lane index for every item (by id) and the number of lanes used (at least 1). */
export function assignLanes(items: Span[], gap = 0): { lane: Map<string, number>; count: number } {
  const lane = new Map<string, number>();
  const ends: number[] = [];
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  for (const item of sorted) {
    let row = ends.findIndex(end => end + gap <= item.start);
    if (row === -1) { row = ends.length; ends.push(item.end); } else ends[row] = item.end;
    lane.set(item.id, row);
  }
  return { lane, count: Math.max(1, ends.length) };
}

const SHAPE_NAMES: Record<string, string> = { freehand: 'Drawing', line: 'Line', arrow: 'Arrow', rectangle: 'Rectangle', ellipse: 'Ellipse' };

/**
 * Display names for timeline items: the item's own name, or a default such as "Arrow 2"
 * numbered per kind in list order.
 */
export function itemNames<T extends { id: string; name?: string }>(items: T[], kind: (item: T) => string): Map<string, string> {
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  for (const item of items) {
    const base = kind(item);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    names.set(item.id, item.name?.trim() || `${base} ${n}`);
  }
  return names;
}

export const annotationKind = (shape: string) => SHAPE_NAMES[shape] ?? 'Annotation';
