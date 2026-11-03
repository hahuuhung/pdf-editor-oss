import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTextLines,
  diffTextLines,
  computePixelDiff,
  summarizeDocumentChanges,
} from '../src/compare.js';

describe('normalizeTextLines & diffTextLines', () => {
  it('normalizes whitespace and drops blank lines', () => {
    assert.deepEqual(
      normalizeTextLines('  Điều 1:   Phạm vi  \n\n  Điều 2: Giá trị \r\n '),
      ['Điều 1: Phạm vi', 'Điều 2: Giá trị'],
    );
  });

  it('computes order-preserving LCS diff for Vietnamese contract clauses', () => {
    const docA = [
      'Điều 1: Đối tượng hợp đồng',
      'Điều 2: Giá trị 100.000.000 VNĐ',
      'Điều 3: Hiệu lực thi hành',
    ];
    const docB = [
      'Điều 1: Đối tượng hợp đồng',
      'Điều 2: Giá trị 125.000.000 VNĐ',
      'Điều 2b: Phạt chậm thanh toán 8%',
      'Điều 3: Hiệu lực thi hành',
    ];
    const res = diffTextLines(docA, docB);
    assert.equal(res.removed, 1);
    assert.equal(res.added, 2);
    assert.deepEqual(
      res.entries.filter((e) => e.type !== 'same').map((e) => `${e.type}:${e.text}`),
      [
        'removed:Điều 2: Giá trị 100.000.000 VNĐ',
        'added:Điều 2: Giá trị 125.000.000 VNĐ',
        'added:Điều 2b: Phạt chậm thanh toán 8%',
      ],
    );
  });

  it('handles empty pages cleanly', () => {
    const res = diffTextLines([], []);
    assert.equal(res.added, 0);
    assert.equal(res.removed, 0);
    assert.equal(res.entries.length, 0);
  });
});

describe('computePixelDiff', () => {
  it('colors removed ink Red, added ink Green, and leaves unchanged pixels faded', () => {
    // 4 pixels (2x2):
    // px 0: white in both -> unchanged
    // px 1: black in A, white in B -> removed (Red: 239, 68, 68)
    // px 2: white in A, black in B -> added (Green: 22, 163, 74)
    // px 3: blue in A, red in B (similar lum) -> modified (Amber: 245, 158, 11)
    const rgbaA = new Uint8ClampedArray([
      255, 255, 255, 255,
      10, 10, 10, 255,
      255, 255, 255, 255,
      0, 110, 220, 255,
    ]);
    const rgbaB = new Uint8ClampedArray([
      255, 255, 255, 255,
      255, 255, 255, 255,
      15, 15, 15, 255,
      220, 50, 40, 255,
    ]);

    const res = computePixelDiff(rgbaA, rgbaB, 2, 2);
    assert.equal(res.totalPixels, 4);
    assert.equal(res.changedPixels, 3);
    assert.equal(res.mismatchPct, 75);

    // px 0 unchanged white
    assert.deepEqual([...res.diffRgba.slice(0, 4)], [255, 255, 255, 255]);
    // px 1 removed -> Red
    assert.deepEqual([...res.diffRgba.slice(4, 8)], [239, 68, 68, 255]);
    // px 2 added -> Green
    assert.deepEqual([...res.diffRgba.slice(8, 12)], [22, 163, 74, 255]);
    // px 3 color shift -> Amber
    assert.deepEqual([...res.diffRgba.slice(12, 16)], [245, 158, 11, 255]);
  });
});

describe('summarizeDocumentChanges', () => {
  it('classifies unchanged, modified, and added/removed pages across two PDFs', () => {
    const pagesA = [['Trang 1 giữ nguyên'], ['Trang 2 bản cũ']];
    const pagesB = [['Trang 1 giữ nguyên'], ['Trang 2 bản mới'], ['Phụ lục thêm mới']];
    const pixelStats = [{ mismatchPct: 0 }, { mismatchPct: 4.25 }, { mismatchPct: 18.5 }];

    const summary = summarizeDocumentChanges(pagesA, pagesB, pixelStats);
    assert.equal(summary.totalPages, 3);
    assert.equal(summary.changedPages, 2);
    assert.equal(summary.unchangedPages, 1);
    assert.equal(summary.pages[0].status, 'unchanged');
    assert.equal(summary.pages[1].status, 'modified');
    assert.equal(summary.pages[2].status, 'added-page');
    assert.equal(summary.totalAddedLines, 2);
    assert.equal(summary.totalRemovedLines, 1);
  });
});

