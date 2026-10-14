import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationKind, assignLanes, itemNames } from '../src/lanes.ts';

test('overlapping items go to separate lanes, others reuse the lowest free lane', () => {
  const { lane, count } = assignLanes([
    { id: 'a', start: 0, end: 1000 },
    { id: 'b', start: 500, end: 1500 },   // overlaps a
    { id: 'c', start: 1000, end: 2000 },  // starts when a ends
    { id: 'd', start: 600, end: 700 },    // overlaps a and b
    { id: 'e', start: 3000, end: 4000 },
  ]);
  assert.equal(count, 3);
  assert.equal(lane.get('a'), 0);
  assert.equal(lane.get('b'), 1);
  assert.equal(lane.get('d'), 2);
  assert.equal(lane.get('c'), 0);
  assert.equal(lane.get('e'), 0);
});

test('empty input still has one lane', () => {
  assert.equal(assignLanes([]).count, 1);
});

test('default names are numbered per kind and custom names win', () => {
  const notes = [
    { id: '1', shape: 'arrow' }, { id: '2', shape: 'freehand' }, { id: '3', shape: 'arrow', name: 'Point at menu' }, { id: '4', shape: 'arrow' },
  ];
  const names = itemNames(notes, n => annotationKind(n.shape));
  assert.deepEqual([...names.values()], ['Arrow 1', 'Drawing 1', 'Point at menu', 'Arrow 3']);
});
