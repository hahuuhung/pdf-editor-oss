import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PRINT_OPTIONS,
  PAPER_DIMENSIONS,
  MARGIN_VALUES,
  resolvePrintPages,
  validateCustomRange,
  getSheetDimensions,
  computeNUpLayout,
  computePageFit,
  sanitizePrintOptions,
} from '../src/print.js';

test('resolvePrintPages handles all, current and custom ranges correctly', () => {
  // All pages
  assert.deepEqual(resolvePrintPages({ pageRange: 'all' }, 5, 2), [0, 1, 2, 3, 4]);

  // Current page
  assert.deepEqual(resolvePrintPages({ pageRange: 'current' }, 5, 2), [2]);
  assert.deepEqual(resolvePrintPages({ pageRange: 'current' }, 5, 0), [0]);
  assert.deepEqual(resolvePrintPages({ pageRange: 'current' }, 5, 10), [4]); // clamped

  // Custom pages
  assert.deepEqual(resolvePrintPages({ pageRange: 'custom', customPages: '1-3, 5' }, 5, 0), [0, 1, 2, 4]);
  assert.deepEqual(resolvePrintPages({ pageRange: 'custom', customPages: '4-' }, 5, 0), [3, 4]);

  // Fallback on invalid or empty custom range
  assert.deepEqual(resolvePrintPages({ pageRange: 'custom', customPages: '' }, 3, 0), [0, 1, 2]);
  assert.deepEqual(resolvePrintPages({ pageRange: 'custom', customPages: 'invalid' }, 3, 0), [0, 1, 2]);

  // Zero pages
  assert.deepEqual(resolvePrintPages({ pageRange: 'all' }, 0, 0), []);
});

test('validateCustomRange validates and parses cleanly without throwing', () => {
  const v1 = validateCustomRange('1-3, 5', 10);
  assert.equal(v1.valid, true);
  assert.deepEqual(v1.pages, [0, 1, 2, 4]);
  assert.equal(v1.count, 4);

  const v2 = validateCustomRange('', 10);
  assert.equal(v2.valid, false);

  const v3 = validateCustomRange('abc', 10);
  assert.equal(v3.valid, false);

  const v4 = validateCustomRange('1-20', 10);
  assert.equal(v4.valid, false); // out of range
});

test('getSheetDimensions returns correct width and height for paper and orientation', () => {
  // A4 portrait
  const a4Port = getSheetDimensions('a4', 'portrait');
  assert.equal(a4Port.width, PAPER_DIMENSIONS.a4.width);
  assert.equal(a4Port.height, PAPER_DIMENSIONS.a4.height);
  assert.equal(a4Port.orientation, 'portrait');

  // A4 landscape
  const a4Land = getSheetDimensions('a4', 'landscape');
  assert.equal(a4Land.width, PAPER_DIMENSIONS.a4.height);
  assert.equal(a4Land.height, PAPER_DIMENSIONS.a4.width);
  assert.equal(a4Land.orientation, 'landscape');

  // Auto orientation: sample page is landscape (800 x 600) -> landscape sheet
  const autoLand = getSheetDimensions('a4', 'auto', { width: 800, height: 600 });
  assert.equal(autoLand.orientation, 'landscape');

  // Auto orientation: sample page is portrait (500 x 700) -> portrait sheet
  const autoPort = getSheetDimensions('a4', 'auto', { width: 500, height: 700 });
  assert.equal(autoPort.orientation, 'portrait');
});

test('computeNUpLayout calculates correct grid, sheet count and slot positions', () => {
  const sheetW = 600;
  const sheetH = 800;
  const margin = 20;

  // 1-up layout: 5 pages -> 5 sheets
  const n1 = computeNUpLayout({ nUp: 1, sheetWidth: sheetW, sheetHeight: sheetH, marginPt: margin, pagesCount: 5 });
  assert.equal(n1.rows, 1);
  assert.equal(n1.cols, 1);
  assert.equal(n1.sheetsCount, 5);
  assert.equal(n1.slotW, 600 - 40);
  assert.equal(n1.slotH, 800 - 40);

  const s0 = n1.getSlot(0);
  assert.equal(s0.x, 20);
  assert.equal(s0.y, 20);
  assert.equal(s0.width, 560);
  assert.equal(s0.height, 760);

  // 2-up layout on portrait sheet: 2 rows x 1 col, 5 pages -> 3 sheets
  const n2 = computeNUpLayout({ nUp: 2, sheetWidth: sheetW, sheetHeight: sheetH, marginPt: margin, pagesCount: 5 });
  assert.equal(n2.rows, 2);
  assert.equal(n2.cols, 1);
  assert.equal(n2.sheetsCount, 3);
  assert.equal(n2.slotW, 560);
  assert.equal(n2.slotH, 380);

  const s2_0 = n2.getSlot(0);
  assert.equal(s2_0.y, 20);
  const s2_1 = n2.getSlot(1);
  assert.equal(s2_1.y, 20 + 380);

  // 4-up layout: 2 rows x 2 cols, 8 pages -> 2 sheets
  const n4 = computeNUpLayout({ nUp: 4, sheetWidth: sheetW, sheetHeight: sheetH, marginPt: margin, pagesCount: 8 });
  assert.equal(n4.rows, 2);
  assert.equal(n4.cols, 2);
  assert.equal(n4.sheetsCount, 2);
  assert.equal(n4.slotW, 280);
  assert.equal(n4.slotH, 380);

  const s4_3 = n4.getSlot(3); // row 1, col 1
  assert.equal(s4_3.x, 20 + 280);
  assert.equal(s4_3.y, 20 + 380);
});

test('computePageFit computes scale and offsets to center page in slot', () => {
  // Page 500x1000 in slot 400x400 with 'fit'
  // Aspect ratio is 1:2, so it fits by height: scale = 400 / 1000 = 0.4
  // drawW = 200, drawH = 400
  // offsetX = (400 - 200) / 2 = 100, offsetY = 0
  const fit = computePageFit({ pageWidth: 500, pageHeight: 1000, slotW: 400, slotH: 400, scaleMode: 'fit' });
  assert.equal(fit.scale, 0.4);
  assert.equal(fit.drawW, 200);
  assert.equal(fit.drawH, 400);
  assert.equal(fit.offsetX, 100);
  assert.equal(fit.offsetY, 0);

  // Actual size: scale = 1
  const actual = computePageFit({ pageWidth: 200, pageHeight: 300, slotW: 400, slotH: 400, scaleMode: 'actual' });
  assert.equal(actual.scale, 1);
  assert.equal(actual.drawW, 200);
  assert.equal(actual.drawH, 300);
  assert.equal(actual.offsetX, 100);
  assert.equal(actual.offsetY, 50);

  // Custom scale: 50%
  const custom = computePageFit({ pageWidth: 200, pageHeight: 300, slotW: 400, slotH: 400, scaleMode: 'custom', customScale: 50 });
  assert.equal(custom.scale, 0.5);
  assert.equal(custom.drawW, 100);
  assert.equal(custom.drawH, 150);
});

test('sanitizePrintOptions cleans and clamps values safely', () => {
  const opt = sanitizePrintOptions({
    copies: 500, // should clamp to 99
    paperSize: 'invalid-paper', // fallback to 'a4'
    orientation: 'diagonal', // fallback to 'auto'
    nUp: 8, // fallback to 1
    customScale: 9999, // clamp to 400
    colorMode: 'neon', // fallback to 'color'
    watermark: '  BẢN NHÁP  ',
    watermarkOpacity: 2.5, // clamp to 0.8
  });

  assert.equal(opt.copies, 99);
  assert.equal(opt.paperSize, 'a4');
  assert.equal(opt.orientation, 'auto');
  assert.equal(opt.nUp, 1);
  assert.equal(opt.customScale, 400);
  assert.equal(opt.colorMode, 'color');
  assert.equal(opt.watermark, 'BẢN NHÁP');
  assert.equal(opt.watermarkOpacity, 0.8);
});
