import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateColumnWidths,
  clusterTextToGrid,
  detectCellType,
  parseUserPageRange,
} from '../src/converter.js';

test('detectCellType detects numbers, formatted currency, dates, and strings', () => {
  // Pure integers and decimals
  assert.deepEqual(detectCellType('123'), { value: 123, type: 'n' });
  assert.deepEqual(detectCellType('-45.67'), { value: -45.67, type: 'n' });
  assert.deepEqual(detectCellType('1,250.50'), { value: 1250.5, type: 'n' });

  // European / Vietnamese format (dot for thousand, comma for decimal)
  assert.deepEqual(detectCellType('1.250,50'), { value: 1250.5, type: 'n' });
  assert.deepEqual(detectCellType('500.000'), { value: 500000, type: 'n' });

  // Dates
  assert.deepEqual(detectCellType('2026-10-16'), { value: '2026-10-16', type: 's' });
  assert.deepEqual(detectCellType('16/10/2026'), { value: '16/10/2026', type: 's' });

  // Regular strings
  assert.deepEqual(detectCellType('Hóa đơn số 104'), { value: 'Hóa đơn số 104', type: 's' });
  assert.deepEqual(detectCellType(''), { value: '', type: 's' });
  assert.deepEqual(detectCellType(null), { value: '', type: 's' });
});

test('clusterTextToGrid clusters text items into a 2D table by spatial coordinates', () => {
  // Simulating a 3-column, 2-row table:
  // Row 1 (y ≈ 50): Header ["STT", "Mặt hàng", "Thành tiền"]
  // Row 2 (y ≈ 75): Data ["1", "Màn hình Dell", "4.500.000"]
  const sampleItems = [
    { str: 'STT', x: 20, y: 50, w: 20, h: 10 },
    { str: 'Mặt hàng', x: 100, y: 51, w: 50, h: 10 },
    { str: 'Thành tiền', x: 250, y: 49, w: 60, h: 10 },

    { str: '1', x: 20, y: 74, w: 10, h: 10 },
    { str: 'Màn hình Dell', x: 100, y: 75, w: 70, h: 10 },
    { str: '4.500.000', x: 250, y: 76, w: 50, h: 10 },
  ];

  const grid = clusterTextToGrid(sampleItems, { yTolerance: 4, xTolerance: 15 });

  assert.equal(grid.length, 2, 'Should detect 2 rows');
  assert.equal(grid[0].length, 3, 'Row 1 should have 3 columns');
  assert.equal(grid[1].length, 3, 'Row 2 should have 3 columns');

  assert.equal(grid[0][0], 'STT');
  assert.equal(grid[0][1], 'Mặt hàng');
  assert.equal(grid[0][2], 'Thành tiền');

  assert.equal(grid[1][0], '1');
  assert.equal(grid[1][1], 'Màn hình Dell');
  assert.equal(grid[1][2], '4.500.000');
});

test('clusterTextToGrid handles empty and unordered inputs gracefully', () => {
  assert.deepEqual(clusterTextToGrid([]), []);
  assert.deepEqual(clusterTextToGrid(null), []);
  assert.deepEqual(clusterTextToGrid([{ str: '   ', x: 10, y: 10 }]), []);

  // Out of order items
  const unordered = [
    { str: 'B2', x: 100, y: 60 },
    { str: 'A1', x: 20, y: 20 },
    { str: 'B1', x: 100, y: 20 },
    { str: 'A2', x: 20, y: 60 },
  ];
  const grid = clusterTextToGrid(unordered, { yTolerance: 5, xTolerance: 10 });
  assert.equal(grid.length, 2);
  assert.deepEqual(grid[0], ['A1', 'B1']);
  assert.deepEqual(grid[1], ['A2', 'B2']);
});

test('calculateColumnWidths computes max character widths per column', () => {
  const grid = [
    ['Mã', 'Tên sản phẩm', 'Giá'],
    ['SP01', 'Bàn phím cơ không dây', '1.200.000 đ'],
  ];
  const widths = calculateColumnWidths(grid, { minWidth: 6, maxWidth: 40 });
  assert.equal(widths.length, 3);
  assert.ok(widths[0] >= 6);
  assert.ok(widths[1] >= 'Bàn phím cơ không dây'.length);
});

test('parseUserPageRange parses user input page ranges and clamps to maxPages', () => {
  // Empty or whitespace returns all pages
  assert.deepEqual(parseUserPageRange('', 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseUserPageRange('  ', 3), [1, 2, 3]);

  // Valid comma and range syntax
  assert.deepEqual(parseUserPageRange('1, 3-5, 8', 10), [1, 3, 4, 5, 8]);
  assert.deepEqual(parseUserPageRange('3 - 1', 5), [1, 2, 3]); // handles reversed ranges

  // Clamping to maxPages
  assert.deepEqual(parseUserPageRange('1-20', 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseUserPageRange('0, 2, 99', 4), [2]);
});
