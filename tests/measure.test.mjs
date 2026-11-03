import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scaleFromPreset,
  calibrateFromSegment,
  sanitizeMeasureScale,
  segmentDistancePt,
  polylineLengthPt,
  polygonAreaPt2,
  angleDegrees,
  formatMeasurementLabel,
  dimensionTicks,
  measurementLabelAnchor,
} from '../src/measure.js';
import { markBounds, moveMark } from '../src/marks.js';

describe('scaleFromPreset & calibrateFromSegment', () => {
  it('computes 1:1 inch scale so 72 PDF points equal 1.00 inch', () => {
    const s = scaleFromPreset(1, 'in');
    assert.equal(s.mode, 'preset');
    assert.equal(s.unit, 'in');
    assert.ok(Math.abs(72 * s.realUnitsPerPt - 1) < 1e-9);
  });

  it('computes 1:100 meter scale accurately (28.3465 pt ~ 1.00 m)', () => {
    const s = scaleFromPreset(100, 'm');
    const oneCmInPt = 72 / 2.54; // 1 cm on paper at 1:100 = 100 cm = 1 m
    assert.ok(Math.abs(oneCmInPt * s.realUnitsPerPt - 1) < 1e-6);
  });

  it('calibrates custom segment and preserves scale through sanitizeMeasureScale', () => {
    const cal = calibrateFromSegment(150, 4.5, 'm');
    assert.equal(cal.mode, 'custom');
    assert.equal(cal.unit, 'm');
    assert.ok(Math.abs(cal.realUnitsPerPt - 0.03) < 1e-9);

    const clean = sanitizeMeasureScale(cal);
    assert.equal(clean.mode, 'custom');
    assert.equal(clean.realUnitsPerPt, cal.realUnitsPerPt);

    const fallback = sanitizeMeasureScale(null);
    assert.equal(fallback.mode, 'preset');
    assert.equal(fallback.ratio, 1);
    assert.equal(fallback.unit, 'mm');
  });
});

describe('measurement geometry (distance, perimeter, Shoelace area, 3-point angle)', () => {
  it('computes segment distance and multi-segment polyline length', () => {
    assert.equal(segmentDistancePt([0, 0], [30, 40]), 50);
    assert.equal(polylineLengthPt([[0, 0], [30, 40], [30, 60]]), 70);
  });

  it('computes polygon area via Shoelace formula regardless of winding order', () => {
    const rectCw = [[0, 0], [100, 0], [100, 50], [0, 50]];
    const rectCcw = [...rectCw].reverse();
    assert.equal(polygonAreaPt2(rectCw), 5000);
    assert.equal(polygonAreaPt2(rectCcw), 5000);

    const rightTriangle = [[0, 0], [60, 0], [0, 80]];
    assert.equal(polygonAreaPt2(rightTriangle), 2400);
    assert.equal(polygonAreaPt2([[0, 0], [10, 10]]), 0);
  });

  it('computes interior angle in degrees at vertex B', () => {
    assert.ok(Math.abs(angleDegrees([100, 0], [0, 0], [0, 100]) - 90) < 1e-6);
    assert.ok(Math.abs(angleDegrees([100, 0], [0, 0], [100, 100]) - 45) < 1e-6);
    assert.ok(Math.abs(angleDegrees([-50, 0], [0, 0], [50, 0]) - 180) < 1e-6);
  });
});

describe('formatMeasurementLabel, dimensionTicks & mark helpers', () => {
  it('formats distance, perimeter, area, and angle labels with configured units', () => {
    const scaleIn = scaleFromPreset(1, 'in');
    assert.equal(
      formatMeasurementLabel({ type: 'measure', label: 'dist', points: [[0, 0], [144, 0]] }, scaleIn),
      '2.00 in',
    );
    assert.equal(
      formatMeasurementLabel({ type: 'measure', label: 'perim', points: [[0, 0], [72, 0], [72, 72]] }, scaleIn),
      '2.00 in',
    );
    assert.equal(
      formatMeasurementLabel({ type: 'measure', label: 'area', points: [[0, 0], [72, 0], [72, 144], [0, 144]] }, scaleIn),
      '2.00 in²',
    );
    assert.equal(
      formatMeasurementLabel({ type: 'measure', label: 'angle', points: [[50, 0], [0, 0], [0, 50]] }, scaleIn),
      '90.0°',
    );
  });

  it('computes perpendicular dimension ticks and bounding/move operations for measure marks', () => {
    const [tA, tB] = dimensionTicks([10, 20], [110, 20], 5);
    assert.deepEqual(tA, [[10, 15], [10, 25]]);
    assert.deepEqual(tB, [[110, 15], [110, 25]]);

    const anchor = measurementLabelAnchor([[10, 20], [110, 20]], 'dist');
    assert.equal(anchor[0], 60);

    const mark = { type: 'measure', label: 'area', points: [[10, 20], [50, 20], [50, 80]] };
    assert.deepEqual(markBounds(mark), { x: 10, y: 20, w: 40, h: 60 });
    const moved = moveMark(mark, 5, -10);
    assert.deepEqual(moved.points[0], [15, 10]);
  });
});

