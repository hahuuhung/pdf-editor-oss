import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIdentityOrder, moveSelectionOrder, pageSizeLabel, paperName, remapOrder, splitPlan } from '../src/pages.js';
import { snapLines, snapRect } from '../src/snap.js';
import { contentBounds, croppedBox, marginsFromBounds, mmToPt, ptToMm, unionRects } from '../src/crop.js';
import { isWinAnsi, needsUnicodeFont, toWinAnsi } from '../src/fonts.js';
import { fitText, pagesToHtml, pagesToText, wrapText } from '../src/textlayout.js';
import { formatTokens, headerFooterContext, sanitizeHeaderFooter } from '../src/docsettings.js';

// ---------- page order ----------

test('moveSelectionOrder moves one page forward, backward and to the end', () => {
  assert.deepEqual(moveSelectionOrder(5, [3], 0), [3, 0, 1, 2, 4]);
  assert.deepEqual(moveSelectionOrder(5, [0], 3), [1, 2, 0, 3, 4]);
  assert.deepEqual(moveSelectionOrder(5, [1], 5), [0, 2, 3, 4, 1]);
});

test('moveSelectionOrder keeps a picked group together in document order', () => {
  assert.deepEqual(moveSelectionOrder(6, [4, 1], 6), [0, 2, 3, 5, 1, 4]);
  assert.deepEqual(moveSelectionOrder(6, [5, 3], 1), [0, 3, 5, 1, 2, 4]);
  // Dropping a group inside itself leaves the order unchanged.
  assert.ok(isIdentityOrder(moveSelectionOrder(4, [1, 2], 2)));
  assert.ok(!isIdentityOrder([1, 0, 2]));
});

test('remapOrder sends items to their page and drops items on removed pages', () => {
  const items = [{ id: 'a', page: 0 }, { id: 'b', page: 2 }, { id: 'c', page: 1 }];
  assert.deepEqual(remapOrder(items, [2, 0, 1]), [{ id: 'a', page: 1 }, { id: 'b', page: 0 }, { id: 'c', page: 2 }]);
  assert.deepEqual(remapOrder(items, [0, 2]), [{ id: 'a', page: 0 }, { id: 'b', page: 1 }]);
  const kept = remapOrder(items, [0, 1, 2]);
  assert.equal(kept[0], items[0]); // unchanged items keep their identity
});

test('splitPlan builds parts for each page, every N pages and custom ranges', () => {
  assert.deepEqual(splitPlan('each', 3), [[0], [1], [2]]);
  assert.deepEqual(splitPlan('every', 5, 2), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(splitPlan('ranges', 8, '1-3; 4-5\n7-'), [[0, 1, 2], [3, 4], [6, 7]]);
  assert.throws(() => splitPlan('every', 5, 0));
  assert.throws(() => splitPlan('ranges', 5, ' ; '));
  assert.throws(() => splitPlan('ranges', 5, '1-9'));
});

test('paperName and pageSizeLabel recognise common sizes in either orientation', () => {
  assert.equal(paperName(595.28, 841.89), 'A4');
  assert.equal(paperName(841.89, 595.28), 'A4');
  assert.equal(paperName(612, 792), 'Letter');
  assert.equal(paperName(500, 500), '');
  assert.equal(pageSizeLabel(595.28, 841.89), '210 × 297 mm (A4)');
  assert.equal(pageSizeLabel(283.46, 283.46), '100 × 100 mm');
});

// ---------- smart snapping ----------

test('snapRect snaps the nearest edge or centre within the threshold', () => {
  const lines = snapLines({ width: 600, height: 800 }, [{ x: 100, y: 100, w: 50, h: 20 }]);
  // Centre of a 40-wide rect at x=278 is 298, two points from the page centre (300).
  const s = snapRect({ x: 278, y: 500, w: 40, h: 10 }, lines, 4);
  assert.equal(s.dx, 2);
  assert.equal(s.guides.x, 300);
  assert.equal(s.dy, 0);
  assert.equal(s.guides.y, null);
  // Top edge 3 points below another item's top edge (its centre and bottom are far from any guide).
  const t = snapRect({ x: 400, y: 103, w: 30, h: 50 }, lines, 4);
  assert.equal(t.dy, -3);
  assert.equal(t.guides.y, 100);
});

test('snapRect leaves a rectangle alone when nothing is close', () => {
  const lines = snapLines({ width: 600, height: 800 });
  assert.deepEqual(snapRect({ x: 50, y: 60, w: 10, h: 10 }, lines, 4), { dx: 0, dy: 0, guides: { x: null, y: null } });
});

// ---------- crop ----------

test('croppedBox cuts view margins on unrotated and rotated pages', () => {
  const box = { x: 0, y: 0, width: 600, height: 800 };
  assert.deepEqual(croppedBox(0, box, { top: 10, right: 20, bottom: 30, left: 40 }), { x: 40, y: 30, width: 540, height: 760 });
  // On a page turned 90°, the view is 800 wide and 600 tall; the top view margin is the PDF left side.
  const r = croppedBox(90, box, { top: 10, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(r, { x: 10, y: 0, width: 590, height: 800 });
  assert.throws(() => croppedBox(0, box, { top: 400, right: 0, bottom: 400, left: 0 }));
  assert.throws(() => croppedBox(0, box, { top: -1, right: 0, bottom: 0, left: 0 }));
});

test('contentBounds finds dark pixels and reports blank pages as null', () => {
  const w = 10;
  const h = 6;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  assert.equal(contentBounds(data, w, h), null);
  const ink = (x, y) => data.set([0, 0, 0, 255], (y * w + x) * 4);
  ink(2, 1);
  ink(7, 4);
  assert.deepEqual(contentBounds(data, w, h), { x: 2, y: 1, w: 6, h: 4 });
});

test('marginsFromBounds keeps the content plus padding, never negative', () => {
  const view = { width: 600, height: 800 };
  assert.deepEqual(marginsFromBounds({ x: 50, y: 60, w: 400, h: 600 }, view, 10), { top: 50, right: 140, bottom: 130, left: 40 });
  assert.deepEqual(marginsFromBounds({ x: 2, y: 0, w: 598, h: 800 }, view, 10), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(marginsFromBounds(null, view), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(unionRects([{ x: 10, y: 10, w: 5, h: 5 }, null, { x: 0, y: 20, w: 2, h: 2 }]), { x: 0, y: 10, w: 15, h: 12 });
  assert.ok(Math.abs(mmToPt(25.4) - 72) < 1e-9);
  assert.ok(Math.abs(ptToMm(72) - 25.4) < 1e-9);
});

// ---------- fonts ----------

test('needsUnicodeFont spots Vietnamese letters that Helvetica cannot write', () => {
  assert.ok(isWinAnsi('é') && isWinAnsi('€') && isWinAnsi('“') && isWinAnsi('\n'));
  assert.ok(!isWinAnsi('đ') && !isWinAnsi('ư') && !isWinAnsi('ế') && !isWinAnsi('\t'));
  assert.equal(needsUnicodeFont(['APPROVED', 'Café – 5 €']), false);
  assert.equal(needsUnicodeFont(['ok', 'ĐÃ DUYỆT']), true);
  assert.equal(needsUnicodeFont([null, undefined, 12]), false);
});

test('toWinAnsi drops missing accents and replaces other characters', () => {
  assert.equal(toWinAnsi('Hợp đồng số 5'), 'Hop dong so 5');
  assert.equal(toWinAnsi('Hóa đơn'), 'Hóa don'); // ó is Latin-1 and stays
  assert.equal(toWinAnsi('a\tb'), 'a b');
  assert.equal(toWinAnsi('漢'), '?');
});

// ---------- text layout ----------

const mono = (s) => s.length; // every character is 1 wide

test('wrapText breaks between words and cuts over-long words', () => {
  assert.deepEqual(wrapText('một hai ba bốn năm', 7, mono), ['một hai', 'ba bốn', 'năm']);
  assert.deepEqual(wrapText('abcdefghij', 4, mono), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrapText('   ', 5, mono), []);
});

test('fitText shortens with an ellipsis only when needed', () => {
  assert.equal(fitText('ngắn', 10, mono), 'ngắn');
  assert.equal(fitText('Thành tiền', 6, mono), 'Thành…');
  assert.equal(fitText('abc', 0.5, mono), '');
});

test('pagesToText and pagesToHtml use the given page numbers', () => {
  assert.equal(pagesToText([['a'], ['b']], [3, 7]), '--- Trang 3 ---\na\n\n--- Trang 7 ---\nb\n');
  assert.match(pagesToHtml('T', [['x']], [5]), /<h2>Trang 5<\/h2>/);
});

// ---------- page numbers ----------

test('headerFooterContext numbers from pageStart and can skip the cover page', () => {
  const plain = sanitizeHeaderFooter({ footerCenter: 'Trang {page} / {total}' });
  assert.equal(plain.pageStart, 1);
  assert.equal(plain.skipFirst, false);
  assert.equal(formatTokens(plain.footerCenter, headerFooterContext(plain, 0, 10)), 'Trang 1 / 10');

  const cover = sanitizeHeaderFooter({ footerCenter: '{page}/{total}', skipFirst: true });
  assert.equal(headerFooterContext(cover, 0, 10), null);
  assert.equal(formatTokens(cover.footerCenter, headerFooterContext(cover, 1, 10)), '1/9');
  assert.equal(formatTokens(cover.footerCenter, headerFooterContext(cover, 9, 10)), '9/9');

  const from5 = sanitizeHeaderFooter({ footerRight: '{page}', pageStart: 5, batesPrefix: 'B', batesDigits: 3 });
  const ctx = headerFooterContext(from5, 2, 4, { file: 'a.pdf' });
  assert.deepEqual([ctx.page, ctx.total, ctx.bates, ctx.file], [7, 8, 'B003', 'a.pdf']);
});
