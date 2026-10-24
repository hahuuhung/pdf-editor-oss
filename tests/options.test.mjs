import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APP_OPTIONS,
  unitConvert,
  getQualityScale,
  smoothStrokePoints,
  sanitizeAppOptions,
  loadAppOptions,
  saveAppOptions,
  resetAppOptions,
} from '../src/options.js';

test('DEFAULT_APP_OPTIONS provides balanced high quality defaults', () => {
  assert.equal(DEFAULT_APP_OPTIONS.renderDpi, 150);
  assert.equal(DEFAULT_APP_OPTIONS.exportDpi, 300);
  assert.equal(DEFAULT_APP_OPTIONS.imageQuality, 0.92);
  assert.equal(DEFAULT_APP_OPTIONS.antiAliasing, true);
  assert.equal(DEFAULT_APP_OPTIONS.strokeSmoothing, true);
  assert.equal(DEFAULT_APP_OPTIONS.redactionDpi, 300);
  assert.equal(DEFAULT_APP_OPTIONS.unit, 'mm');
  assert.equal(DEFAULT_APP_OPTIONS.snapEnabled, true);
});

test('unitConvert converts lengths accurately between mm, cm, in and pt', () => {
  // 72 pt = 1 in
  assert.equal(unitConvert(72, 'pt', 'in'), 1);
  assert.equal(unitConvert(1, 'in', 'pt'), 72);

  // 1 in = 25.4 mm
  assert.equal(unitConvert(1, 'in', 'mm'), 25.4);
  assert.equal(unitConvert(25.4, 'mm', 'in'), 1);

  // 1 in = 2.54 cm
  assert.equal(unitConvert(1, 'in', 'cm'), 2.54);
  assert.equal(unitConvert(2.54, 'cm', 'in'), 1);

  // A4 dimensions: 210 x 297 mm to pt (approx 595.28 x 841.89)
  const a4WidthPt = unitConvert(210, 'mm', 'pt');
  assert.ok(Math.abs(a4WidthPt - 595.28) < 0.1);

  // Same unit returns value
  assert.equal(unitConvert(42, 'mm', 'mm'), 42);

  // Fallback for invalid input
  assert.equal(unitConvert('invalid', 'pt', 'mm'), 0);
});

test('getQualityScale returns correct multiplier for DPI', () => {
  assert.equal(getQualityScale(72), 1);
  assert.ok(Math.abs(getQualityScale(150) - 150 / 72) < 1e-6);
  assert.ok(Math.abs(getQualityScale(300) - 300 / 72) < 1e-6);
  assert.ok(Math.abs(getQualityScale(600) - 600 / 72) < 1e-6);

  // Clamps out of range DPI
  assert.equal(getQualityScale(10), 1); // min 72
  assert.equal(getQualityScale(5000), 1200 / 72); // max 1200
});

test('smoothStrokePoints smooths polylines with Catmull-Rom Bézier spline', () => {
  // Short arrays return untouched
  assert.deepEqual(smoothStrokePoints([]), []);
  assert.deepEqual(smoothStrokePoints([[10, 20]]), [[10, 20]]);
  assert.deepEqual(smoothStrokePoints([[10, 20], [30, 40]]), [[10, 20], [30, 40]]);

  // Array points [x, y]
  const rawArray = [
    [0, 0],
    [50, 100],
    [100, 0],
    [150, 100],
  ];
  const smoothedArray = smoothStrokePoints(rawArray);
  assert.ok(Array.isArray(smoothedArray[0]), 'Maintains array format');
  assert.ok(smoothedArray.length > rawArray.length, 'Generates subpixel interpolated points');
  assert.deepEqual(smoothedArray[0], [0, 0], 'Preserves starting point');

  // Object points { x, y }
  const rawObj = [
    { x: 0, y: 0 },
    { x: 50, y: 100 },
    { x: 100, y: 0 },
    { x: 150, y: 100 },
  ];
  const smoothedObj = smoothStrokePoints(rawObj);
  assert.equal(typeof smoothedObj[0].x, 'number', 'Maintains object format');
  assert.ok(smoothedObj.length > rawObj.length);
  assert.equal(smoothedObj[0].x, 0);
  assert.equal(smoothedObj[0].y, 0);
});

test('sanitizeAppOptions validates, cleans and clamps all preferences safely', () => {
  const opt = sanitizeAppOptions({
    renderDpi: 9999, // fallback to default
    exportDpi: 600, // valid
    imageQuality: 5.0, // clamp to 1.0
    antiAliasing: 'yes', // coerce to boolean true
    defaultFontSize: 120, // clamp to 72
    defaultFontColor: 'not-a-color', // fallback
    unit: 'meters', // fallback to 'mm'
    snapThreshold: 500, // clamp to 32
  });

  assert.equal(opt.renderDpi, DEFAULT_APP_OPTIONS.renderDpi);
  assert.equal(opt.exportDpi, 600);
  assert.equal(opt.imageQuality, 1.0);
  assert.equal(opt.antiAliasing, true);
  assert.equal(opt.defaultFontSize, 72);
  assert.equal(opt.defaultFontColor, DEFAULT_APP_OPTIONS.defaultFontColor);
  assert.equal(opt.unit, 'mm');
  assert.equal(opt.snapThreshold, 32);
});

test('loadAppOptions, saveAppOptions and resetAppOptions handle storage cleanly', () => {
  // Reset returns defaults
  const def = resetAppOptions();
  assert.equal(def.renderDpi, DEFAULT_APP_OPTIONS.renderDpi);

  // Save updates options
  const updated = saveAppOptions({ renderDpi: 300, exportDpi: 600 });
  assert.equal(updated.renderDpi, 300);
  assert.equal(updated.exportDpi, 600);

  // Load retrieves saved options
  const loaded = loadAppOptions();
  assert.equal(loaded.renderDpi, 300);
  assert.equal(loaded.exportDpi, 600);

  // Reset clears back to default
  const afterReset = resetAppOptions();
  assert.equal(afterReset.renderDpi, DEFAULT_APP_OPTIONS.renderDpi);
});
