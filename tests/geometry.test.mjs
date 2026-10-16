import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRotation, rectViewToPdf, viewSize, viewToPdf } from '../src/geometry.js';

// The pdf.js PageViewport transform at scale 1, used as the reference the inverse must match.
function pdfjsTransform(rotation, box) {
  const [x0, y0, x1, y1] = [box.x, box.y, box.x + box.width, box.y + box.height];
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const [a, b, c, d] = { 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] }[rotation];
  const [ox, oy] = a === 0 ? [Math.abs(cy - y0), Math.abs(cx - x0)] : [Math.abs(cx - x0), Math.abs(cy - y0)];
  return [a, b, c, d, ox - a * cx - c * cy, oy - b * cx - d * cy];
}

const box = { x: 10, y: 20, width: 600, height: 800 };

test('viewToPdf inverts the pdf.js viewport transform for every quarter turn', () => {
  for (const rot of [0, 90, 180, 270]) {
    const [a, b, c, d, e, f] = pdfjsTransform(rot, box);
    for (const [px, py] of [[10, 20], [610, 820], [123.5, 456.25], [300, 21]]) {
      const vx = a * px + c * py + e;
      const vy = b * px + d * py + f;
      const [bx, by] = viewToPdf(rot, box, vx, vy);
      assert.ok(Math.abs(bx - px) < 1e-9 && Math.abs(by - py) < 1e-9, `rotation ${rot}: (${px},${py}) -> (${bx},${by})`);
    }
  }
});

test('normalizeRotation snaps to quarter turns in 0..270', () => {
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(normalizeRotation(undefined), 0);
});

test('viewSize swaps width and height for sideways pages', () => {
  assert.deepEqual(viewSize(0, box), { width: 600, height: 800 });
  assert.deepEqual(viewSize(90, box), { width: 800, height: 600 });
});

test('rectViewToPdf returns a positive rectangle in PDF space', () => {
  assert.deepEqual(rectViewToPdf(0, box, 0, 0, 100, 50), { x: 10, y: 770, width: 100, height: 50 });
  const r = rectViewToPdf(90, box, 0, 0, 100, 50);
  assert.deepEqual(r, { x: 10, y: 20, width: 50, height: 100 });
});
