import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARK_DEFAULTS,
  NOTE_SIZE,
  addMark,
  arrowHeadPoints,
  ellipsePoints,
  markBounds,
  marksOnPage,
  moveMark,
  nextMarkId,
  normalizeRect,
  removeMark,
  sanitizeMark,
  simplifyInk,
  updateMark,
  zigzagPoints,
} from '../src/marks.js';

test('normalizeRect returns a positive-size rectangle whatever the drag direction', () => {
  assert.deepEqual(normalizeRect(50, 40, 10, 20), { x: 10, y: 20, w: 40, h: 20 });
  assert.deepEqual(normalizeRect(10, 20, 50, 40), { x: 10, y: 20, w: 40, h: 20 });
});

test('sanitizeMark fills defaults and clamps out-of-range values', () => {
  const m = sanitizeMark({ id: 'm1', type: 'rect', page: -3, x: NaN, y: 5, w: -4, h: 9, color: 'red', width: 99, opacity: 0, fill: '#ABCDEF' });
  assert.equal(m.page, 0);
  assert.equal(m.x, 0);
  assert.equal(m.w, 0);
  assert.equal(m.color, MARK_DEFAULTS.rect.color);
  assert.equal(m.width, 12);
  assert.equal(m.opacity, 0.05);
  assert.equal(m.fill, '#abcdef');
});

test('sanitizeMark falls back to rect for unknown types and drops bad points', () => {
  const m = sanitizeMark({ id: 'm2', type: 'hologram', points: [[1, 2], [NaN, 3], 'x', [4, 5]] });
  assert.equal(m.type, 'rect');
  assert.deepEqual(m.points, [[1, 2], [4, 5]]);
});

test('ellipsePoints lie on the inscribed ellipse', () => {
  const pts = ellipsePoints(10, 20, 40, 20, 32);
  assert.equal(pts.length, 32);
  for (const [px, py] of pts) {
    const nx = (px - 30) / 20;
    const ny = (py - 30) / 10;
    assert.ok(Math.abs(nx * nx + ny * ny - 1) < 1e-9);
  }
});

test('arrowHeadPoints ends at the tip with wings of the requested length', () => {
  const [wing1, tip, wing2] = arrowHeadPoints(0, 0, 100, 0, 8);
  assert.deepEqual(tip, [100, 0]);
  assert.ok(Math.abs(Math.hypot(wing1[0] - 100, wing1[1]) - 8) < 1e-9);
  assert.ok(Math.abs(Math.hypot(wing2[0] - 100, wing2[1]) - 8) < 1e-9);
  assert.ok(wing1[0] < 100 && wing2[0] < 100, 'wings point back toward the start');
});

test('zigzagPoints alternates above and below the baseline and reaches the end', () => {
  const pts = zigzagPoints(0, 10, 50, 1.5, 3);
  assert.equal(pts[pts.length - 1][0], 10);
  for (let i = 1; i < pts.length; i++) assert.notEqual(pts[i][1], pts[i - 1][1]);
});

test('simplifyInk drops points that are too close and keeps the final point', () => {
  const out = simplifyInk([[0, 0], [0.5, 0], [2, 0], [2.2, 0], [5, 0]], 1.5);
  assert.deepEqual(out, [[0, 0], [2, 0], [5, 0]]);
  assert.deepEqual(simplifyInk([]), []);
});

test('markBounds covers points for lines and ink and the note icon size for notes', () => {
  assert.deepEqual(markBounds(sanitizeMark({ type: 'ink', points: [[10, 30], [40, 5], [25, 60]] })), { x: 10, y: 5, w: 30, h: 55 });
  assert.deepEqual(markBounds(sanitizeMark({ type: 'note', x: 7, y: 9 })), { x: 7, y: 9, w: NOTE_SIZE, h: NOTE_SIZE });
});

test('mark collection helpers add, update, remove and filter by page', () => {
  let marks = [];
  const id1 = nextMarkId(marks);
  assert.equal(id1, 'm1');
  marks = addMark(marks, { id: id1, type: 'highlight', page: 0, x: 1, y: 2, w: 3, h: 4 });
  marks = addMark(marks, { id: nextMarkId(marks), type: 'ink', page: 1, points: [[0, 0], [1, 1]] });
  assert.equal(nextMarkId(marks), 'm3');
  assert.equal(updateMark(marks, 'm1', { color: '#00ff00', id: 'zz' })[0].id, 'm1');
  assert.equal(updateMark(marks, 'm1', { color: '#00ff00' })[0].color, '#00ff00');
  assert.deepEqual(marksOnPage(marks, 1).map((m) => m.id), ['m2']);
  assert.deepEqual(removeMark(marks, 'm1').map((m) => m.id), ['m2']);
});

test('moveMark translates position and every vertex without touching style', () => {
  const ink = sanitizeMark({ id: 'm9', type: 'ink', page: 2, points: [[10, 10], [20, 30]], color: '#123456', width: 3 });
  const moved = moveMark(ink, 5, -4);
  assert.deepEqual(moved.points, [[15, 6], [25, 26]]);
  assert.equal(moved.id, 'm9');
  assert.equal(moved.page, 2);
  assert.equal(moved.color, '#123456');
  assert.equal(moved.width, 3);
  const rect = moveMark(sanitizeMark({ id: 'm1', type: 'rect', x: 1, y: 2, w: 3, h: 4 }), -1, 1);
  assert.deepEqual([rect.x, rect.y, rect.w, rect.h], [0, 3, 3, 4]);
});

test('new mark types keep their extra fields and reject unsafe ones', async () => {
  const { safeUrl } = await import('../src/marks.js');
  const link = sanitizeMark({ id: 'm1', type: 'link', url: 'javascript:alert(1)', x: 0, y: 0, w: 10, h: 10 });
  assert.equal(link.url, '');
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('mailto:a@b.vn'), 'mailto:a@b.vn');
  assert.equal(safeUrl('file:///etc/passwd'), '');
  const img = sanitizeMark({ type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.equal(img.src, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(sanitizeMark({ type: 'image', src: 'data:text/html;base64,PHNjcmlwdD4=' }).src, '');
  assert.equal(sanitizeMark({ type: 'symbol', label: 'smile' }).label, 'check');
  assert.equal(sanitizeMark({ type: 'stamp', label: 'ĐÃ DUYỆT' }).label, 'ĐÃ DUYỆT');
});

test('resizeMark enforces a minimum size and can keep the aspect ratio', async () => {
  const { resizeMark } = await import('../src/marks.js');
  const img = sanitizeMark({ id: 'm1', type: 'image', x: 0, y: 0, w: 100, h: 50 });
  assert.deepEqual([resizeMark(img, 1, 1).w, resizeMark(img, 1, 1).h], [4, 4]);
  const kept = resizeMark(img, 200, 999, { keepAspect: true });
  assert.deepEqual([kept.w, kept.h], [200, 100]);
});
