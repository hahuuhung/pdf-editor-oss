// Page cropping. Margins are given in view space (the page as the user sees it, after rotation) and
// become a new crop box in PDF space. The border around the content of a rendered page can be
// measured to suggest margins. Pure functions.

import { rectViewToPdf, viewSize } from './geometry.js';

export const MIN_CROP_SIZE = 36; // points left on each side after cropping

export const mmToPt = (mm) => (Number(mm) * 72) / 25.4;
export const ptToMm = (pt) => (Number(pt) * 25.4) / 72;

// New crop box { x, y, width, height } for a page whose current crop box is `box`, after cutting
// margins { top, right, bottom, left } (points, view space).
export function croppedBox(rotation, box, m) {
  const sides = [m.top, m.right, m.bottom, m.left];
  if (sides.some((v) => !Number.isFinite(v) || v < 0)) throw new Error('Lề cắt phải là số không âm.');
  const view = viewSize(rotation, box);
  const w = view.width - m.left - m.right;
  const h = view.height - m.top - m.bottom;
  if (w < MIN_CROP_SIZE || h < MIN_CROP_SIZE) throw new Error('Lề cắt quá lớn: phần trang còn lại quá nhỏ.');
  return rectViewToPdf(rotation, box, m.left, m.top, w, h);
}

// Bounding box { x, y, w, h } (pixels) of the content in RGBA `data`, or null for a blank page.
// A pixel is content when it is not transparent and one of its channels is darker than `threshold`.
export function contentBounds(data, width, height, threshold = 245) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      if (data[i + 3] < 16) continue;
      if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Margins (points) that keep `bounds` ({ x, y, w, h } in points) plus `pad` points on each side of a
// page of size `view`. No content means no cut.
export function marginsFromBounds(bounds, view, pad = 0) {
  if (!bounds) return { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    top: Math.max(0, bounds.y - pad),
    right: Math.max(0, view.width - bounds.x - bounds.w - pad),
    bottom: Math.max(0, view.height - bounds.y - bounds.h - pad),
    left: Math.max(0, bounds.x - pad),
  };
}

// Smallest rectangle containing every rectangle in `rects` (null entries are skipped).
export function unionRects(rects) {
  const list = rects.filter(Boolean);
  if (!list.length) return null;
  const x = Math.min(...list.map((r) => r.x));
  const y = Math.min(...list.map((r) => r.y));
  return { x, y, w: Math.max(...list.map((r) => r.x + r.w)) - x, h: Math.max(...list.map((r) => r.y + r.h)) - y };
}
