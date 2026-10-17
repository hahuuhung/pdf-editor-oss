import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickSelection, dropGap, followOrder } from '../src/pageselect.js';

test('a plain click selects one page and sets the anchor', () => {
  assert.deepEqual(clickSelection([1, 2, 5], 3, 1), { selection: [3], anchor: 3 });
});

test('Ctrl toggles a page but never empties the selection', () => {
  assert.deepEqual(clickSelection([1], 4, 1, { toggle: true }), { selection: [1, 4], anchor: 4 });
  assert.deepEqual(clickSelection([1, 4], 1, 4, { toggle: true }), { selection: [4], anchor: 1 });
  assert.deepEqual(clickSelection([4], 4, 4, { toggle: true }), { selection: [4], anchor: 4 });
});

test('Shift selects the range from the anchor, added to the selection with Ctrl', () => {
  assert.deepEqual(clickSelection([2], 5, 2, { range: true }), { selection: [2, 3, 4, 5], anchor: 2 });
  assert.deepEqual(clickSelection([2], 0, 2, { range: true }), { selection: [0, 1, 2], anchor: 2 });
  assert.deepEqual(clickSelection([0, 7], 4, 2, { range: true, toggle: true }), { selection: [0, 2, 3, 4, 7], anchor: 2 });
  // Without an anchor Shift acts like a plain click.
  assert.deepEqual(clickSelection([], 3, null, { range: true }), { selection: [3], anchor: 3 });
});

test('followOrder keeps selected pages selected at their new positions', () => {
  // Pages 1 and 2 moved before page 0: new order [1, 2, 0, 3].
  assert.deepEqual(followOrder([1, 2], [1, 2, 0, 3]), [0, 1]);
  // Page 2 deleted: new order [0, 1, 3].
  assert.deepEqual(followOrder([2, 3], [0, 1, 3]), [2]);
  // A new page inserted at 1 (-1 marks it).
  assert.deepEqual(followOrder([1], [0, -1, 1, 2]), [2]);
});

test('dropGap counts the card centres above the pointer', () => {
  const mids = [100, 300, 500];
  assert.equal(dropGap(mids, 20), 0);
  assert.equal(dropGap(mids, 299), 1);
  assert.equal(dropGap(mids, 301), 2);
  assert.equal(dropGap(mids, 900), 3);
  assert.equal(dropGap([], 10), 0);
});
