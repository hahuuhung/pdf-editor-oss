import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPageRange, movedIndex, parsePageRange, remapDeleted, remapInserted, remapMoved } from '../src/pages.js';
import {
  batesLabel,
  formatTokens,
  sanitizeHeaderFooter,
  sanitizeWatermark,
  todayLabel,
} from '../src/docsettings.js';
import { findInItems } from '../src/search.js';

test('parsePageRange reads lists, ranges and open ends into sorted 0-based indices', () => {
  assert.deepEqual(parsePageRange('1-3, 5', 10), [0, 1, 2, 4]);
  assert.deepEqual(parsePageRange('8-', 10), [7, 8, 9]);
  assert.deepEqual(parsePageRange('3,1,3', 5), [0, 2]);
});

test('parsePageRange rejects empty, malformed and out-of-range input', () => {
  assert.throws(() => parsePageRange('', 5));
  assert.throws(() => parsePageRange('a-b', 5));
  assert.throws(() => parsePageRange('0-2', 5));
  assert.throws(() => parsePageRange('4-9', 5));
  assert.throws(() => parsePageRange('3-1', 5));
});

test('formatPageRange compacts consecutive pages', () => {
  assert.equal(formatPageRange([0, 1, 2, 4, 6, 7]), '1-3,5,7-8');
});

test('remapDeleted drops items on the deleted page and shifts later ones up', () => {
  const items = [{ id: 1, page: 0 }, { id: 2, page: 1 }, { id: 3, page: 2 }];
  assert.deepEqual(remapDeleted(items, 1), [{ id: 1, page: 0 }, { id: 3, page: 1 }]);
});

test('remapInserted shifts the insertion page and later ones down', () => {
  const items = [{ id: 1, page: 0 }, { id: 2, page: 1 }];
  assert.deepEqual(remapInserted(items, 1), [{ id: 1, page: 0 }, { id: 2, page: 2 }]);
});

test('movedIndex and remapMoved follow a page moved forward or backward', () => {
  // order 0 1 2 3, move 0 to 2 -> 1 2 0 3
  assert.deepEqual([0, 1, 2, 3].map((p) => movedIndex(p, 0, 2)), [2, 0, 1, 3]);
  // move 3 to 1 -> 0 3 1 2
  assert.deepEqual([0, 1, 2, 3].map((p) => movedIndex(p, 3, 1)), [0, 2, 3, 1]);
  assert.deepEqual(remapMoved([{ page: 0 }, { page: 3 }], 3, 1), [{ page: 0 }, { page: 1 }]);
});

test('watermark and header/footer sanitizers drop empty settings and clamp values', () => {
  assert.equal(sanitizeWatermark({ text: '  ' }), null);
  const w = sanitizeWatermark({ text: 'MẬT', fontSize: 999, opacity: 2, angle: 200, color: 'x' });
  assert.deepEqual(w, { text: 'MẬT', fontSize: 200, color: '#888888', opacity: 1, angle: 90 });
  assert.equal(sanitizeHeaderFooter({ fontSize: 10 }), null);
  const h = sanitizeHeaderFooter({ footerCenter: 'Trang {page}/{total}', batesDigits: 40 });
  assert.equal(h.footerCenter, 'Trang {page}/{total}');
  assert.equal(h.batesDigits, 12);
  assert.equal(h.headerLeft, '');
});

test('formatTokens and batesLabel fill page numbers and Bates numbers', () => {
  const ctx = { page: 2, total: 9, date: '01/02/2026', file: 'a.pdf', bates: batesLabel('VN', 7, 4, 1) };
  assert.equal(formatTokens('{bates} · {page}/{total} · {date} · {file} · {other}', ctx), 'VN0008 · 2/9 · 01/02/2026 · a.pdf · {other}');
  assert.equal(todayLabel(new Date(2026, 0, 5)), '05/01/2026');
});

test('findInItems finds every case-insensitive occurrence with proportional rectangles', () => {
  const items = [{ str: 'Hợp đồng số 1 — HỢP ĐỒNG', x: 100, y: 50, w: 240, h: 12 }];
  const hits = findInItems(items, 'hợp đồng');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].x, 100);
  assert.ok(Math.abs(hits[0].w - 240 * (8 / 24)) < 1e-9);
  assert.ok(hits[1].x > hits[0].x);
  assert.deepEqual(findInItems(items, '  '), []);
  assert.equal(findInItems(items, 'HỢP', { caseSensitive: true }).length, 1);
});
