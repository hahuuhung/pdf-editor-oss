import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookmarkSlot,
  flattenOutline,
  indentBookmark,
  insertBookmark,
  moveBookmark,
  nextBookmarkId,
  normalizeDepths,
  outlineTree,
  remapBookmarks,
  removeBookmark,
  renameBookmark,
  subtreeEnd,
  visibleIndices,
} from '../src/bookmarks.js';
import { reverseOrder } from '../src/pages.js';
import { wrapRuns } from '../src/textlayout.js';
import { fontVariant } from '../src/fonts.js';

const b = (id, depth, page = 0, title = id) => ({ id, title, page, left: null, top: null, depth, url: '' });
const ids = (list) => list.map((x) => `${x.id}:${x.depth}`).join(' ');

// A: chapter 1 with sections 1.1, 1.2 (1.2 has 1.2.1); B: chapter 2 with 2.1.
const sample = () => [b('c1', 0, 0), b('s11', 1, 0), b('s12', 1, 1), b('s121', 2, 1), b('c2', 0, 2), b('s21', 1, 3)];

test('flattenOutline turns a resolved pdf.js outline into depth-tagged entries', () => {
  const flat = flattenOutline([
    { title: 'Một', page: 0, top: 700, items: [{ title: 'Một.Một', page: 1, left: 10, top: 500, items: [] }] },
    { title: 'Web', url: 'https://example.com' },
    { title: 'Lỗi', page: -1 },
  ]);
  assert.deepEqual(flat.map((x) => [x.id, x.title, x.page, x.left, x.top, x.depth, x.url]), [
    ['b1', 'Một', 0, null, 700, 0, ''],
    ['b2', 'Một.Một', 1, 10, 500, 1, ''],
    ['b3', 'Web', null, null, null, 0, 'https://example.com'],
    ['b4', 'Lỗi', null, null, null, 0, ''],
  ]);
  assert.equal(nextBookmarkId(flat), 'b5');
});

test('outlineTree nests entries and repairs impossible depths', () => {
  const tree = outlineTree(sample());
  assert.deepEqual(tree.map((n) => [n.id, n.children.map((c) => [c.id, c.children.map((g) => g.id)])]), [
    ['c1', [['s11', []], ['s12', ['s121']]]],
    ['c2', [['s21', []]]],
  ]);
  // A first entry at depth 2 and a jump from 0 to 3 are clamped.
  assert.equal(ids(normalizeDepths([b('x', 2), b('y', 0), b('z', 3)])), 'x:0 y:0 z:1');
});

test('subtreeEnd, moveBookmark and indentBookmark move whole branches among siblings', () => {
  const list = sample();
  assert.equal(subtreeEnd(list, 0), 4);
  assert.equal(subtreeEnd(list, 2), 4);
  // Moving chapter 2 up puts it, with 2.1, before chapter 1 and its sections.
  assert.equal(ids(moveBookmark(list, 4, -1)), 'c2:0 s21:1 c1:0 s11:1 s12:1 s121:2');
  // Moving 1.1 down swaps it with 1.2 and 1.2.1.
  assert.equal(ids(moveBookmark(list, 1, 1)), 'c1:0 s12:1 s121:2 s11:1 c2:0 s21:1');
  // No previous sibling for the first section, no next sibling for the last chapter.
  assert.equal(moveBookmark(list, 1, -1), list);
  assert.equal(moveBookmark(list, 4, 1), list);
  // Indenting 1.2 makes it (and 1.2.1) children of 1.1; the first entry of a level cannot indent.
  assert.equal(ids(indentBookmark(list, 2, 1)), 'c1:0 s11:1 s12:2 s121:3 c2:0 s21:1');
  assert.equal(indentBookmark(list, 1, 1), list);
  assert.equal(ids(indentBookmark(list, 3, -1)), 'c1:0 s11:1 s12:1 s121:1 c2:0 s21:1');
  assert.equal(indentBookmark(list, 0, -1), list);
});

test('insert, remove and rename bookmarks', () => {
  const list = sample();
  const added = insertBookmark(list, b('n', 0, 1), 1);
  assert.equal(ids(added), 'c1:0 s11:1 n:1 s12:1 s121:2 c2:0 s21:1');
  assert.equal(ids(insertBookmark(list, b('n', 3), -1)).split(' ')[0], 'n:0');
  assert.equal(ids(removeBookmark(list, 2)), 'c1:0 s11:1 c2:0 s21:1');
  assert.equal(renameBookmark(list, 4, 'Chương 2').at(4).title, 'Chương 2');
  // A new entry for page 2 goes after the last top-level entry on page 2 or earlier.
  assert.equal(bookmarkSlot(list, 2), 4);
  assert.equal(bookmarkSlot(list, 1), 0);
  assert.equal(bookmarkSlot([], 3), -1);
});

test('remapBookmarks follows moved pages and drops entries on removed pages', () => {
  const list = sample(); // pages 0,0,1,1,2,3
  // Page order reversed: old page 3 is now first.
  assert.deepEqual(remapBookmarks(list, [3, 2, 1, 0]).map((x) => x.page), [3, 3, 2, 2, 1, 0]);
  // Page 1 deleted: 1.2 and 1.2.1 go, later pages shift up.
  const kept = remapBookmarks(list, [0, 2, 3]);
  assert.equal(ids(kept), 'c1:0 s11:1 c2:0 s21:1');
  assert.deepEqual(kept.map((x) => x.page), [0, 0, 1, 2]);
  // Deleting a chapter's page lifts its sections to the top level.
  assert.equal(ids(remapBookmarks([b('c', 0, 0), b('s', 1, 1)], [1])), 's:0');
  const link = { ...b('w', 0, null), url: 'https://example.com' };
  assert.equal(remapBookmarks([link], [1, 0])[0], link);
});

test('visibleIndices hides the descendants of folded entries', () => {
  const list = sample();
  assert.deepEqual(visibleIndices(list, new Set()), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(visibleIndices(list, new Set(['c1'])), [0, 4, 5]);
  assert.deepEqual(visibleIndices(list, new Set(['s12'])), [0, 1, 2, 4, 5]);
  assert.deepEqual(visibleIndices(list, new Set(['s11'])), [0, 1, 2, 3, 4, 5]); // no children to hide
});

test('reverseOrder reverses all pages or only the picked ones in place', () => {
  assert.deepEqual(reverseOrder(4, [0, 1, 2, 3]), [3, 2, 1, 0]);
  // Picked pages 1, 2, 4 trade places among positions 1, 2, 4.
  assert.deepEqual(reverseOrder(6, [4, 1, 2]), [0, 4, 2, 3, 1, 5]);
  assert.deepEqual(reverseOrder(3, []), [0, 1, 2]);
});

test('wrapRuns wraps styled runs by width and keeps words split across styles together', () => {
  // Bold characters are twice as wide as regular ones.
  const measure = (t, s) => t.length * (s.bold ? 2 : 1);
  const r = (text, bold = false) => ({ text, bold, italic: false });
  const lines = wrapRuns([r('Hợp '), r('đồng', true), r(' số 104 năm 2026')], 12, measure);
  assert.deepEqual(lines.map((l) => l.map((p) => (p.bold ? `*${p.text}*` : p.text)).join('')), ['Hợp *đồng*', 'số 104 năm', '2026']);
  // "ab" + bold "cd" is one word; a newline forces a break and two newlines leave a blank line.
  // The space between two words belongs to the piece before it.
  assert.deepEqual(wrapRuns([r('x ab'), r('cd', true), r(' y\n\nz')], 100, measure).map((l) => l.map((p) => p.text).join('|')), ['x ab|cd |y', '', 'z']);
  // A word wider than the line is cut between characters.
  assert.deepEqual(wrapRuns([r('abcdefg')], 3, measure).map((l) => l.map((p) => p.text).join('')), ['abc', 'def', 'g']);
  assert.deepEqual(wrapRuns([r('   ')], 10, measure), []);
});

test('fontVariant names the font style of a run', () => {
  assert.equal(fontVariant({}), 'regular');
  assert.equal(fontVariant({ bold: true }), 'bold');
  assert.equal(fontVariant({ italic: true }), 'italic');
  assert.equal(fontVariant({ bold: true, italic: true }), 'boldItalic');
});
