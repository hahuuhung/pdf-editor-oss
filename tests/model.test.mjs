import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addBox,
  boxesOnPage,
  clampFontSize,
  nextId,
  removeBox,
  sanitizeBox,
  updateBox,
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from '../src/model.js';

const base = { id: 1, page: 0, x: 10, y: 20, text: 'Xin chào', fontSize: 14, color: '#112233' };

test('clampFontSize keeps size within bounds and rejects non-numbers', () => {
  assert.equal(clampFontSize(1), MIN_FONT_SIZE);
  assert.equal(clampFontSize(500), MAX_FONT_SIZE);
  assert.equal(clampFontSize('abc'), DEFAULT_FONT_SIZE);
  assert.equal(clampFontSize(12.6), 13);
});

test('sanitizeBox fills invalid fields with safe defaults', () => {
  const box = sanitizeBox({ id: 3, page: -2, x: NaN, y: 5, text: 42, fontSize: 'x', color: 'red' });
  assert.deepEqual(box, {
    id: 3,
    page: 0,
    x: 0,
    y: 5,
    text: '',
    fontSize: DEFAULT_FONT_SIZE,
    color: '#000000',
  });
});

test('addBox appends a sanitized copy without mutating the input list', () => {
  const before = [];
  const after = addBox(before, base);
  assert.equal(before.length, 0);
  assert.equal(after.length, 1);
  assert.equal(after[0].text, 'Xin chào');
});

test('updateBox changes only the target box and keeps its id', () => {
  const boxes = [base, { ...base, id: 2, page: 1 }];
  const updated = updateBox(boxes, 1, { text: 'Hi', id: 99 });
  assert.equal(updated[0].text, 'Hi');
  assert.equal(updated[0].id, 1);
  assert.equal(updated[1].text, 'Xin chào');
});

test('removeBox and boxesOnPage filter by id and page', () => {
  const boxes = [base, { ...base, id: 2, page: 1 }, { ...base, id: 3, page: 0 }];
  assert.deepEqual(removeBox(boxes, 2).map((b) => b.id), [1, 3]);
  assert.deepEqual(boxesOnPage(boxes, 0).map((b) => b.id), [1, 3]);
});

test('nextId returns one more than the largest existing id', () => {
  assert.equal(nextId([]), 1);
  assert.equal(nextId([base, { ...base, id: 7 }]), 8);
});
