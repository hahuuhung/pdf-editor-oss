// Converts between the editor's view space and PDF user space.
// View space is the page as displayed at scale 1 with its rotation applied: origin top-left, y down,
// exactly like a pdf.js viewport at scale 1. PDF space is the unrotated page, origin bottom-left.
// `box` is the page's crop box { x, y, width, height } in PDF space.

export function normalizeRotation(deg) {
  return (((Math.round((Number(deg) || 0) / 90) * 90) % 360) + 360) % 360;
}

// Size of the page as displayed: width and height swap for 90 and 270 degrees.
export function viewSize(rotation, box) {
  return normalizeRotation(rotation) % 180 === 0
    ? { width: box.width, height: box.height }
    : { width: box.height, height: box.width };
}

// Inverse of the pdf.js viewport transform at scale 1.
export function viewToPdf(rotation, box, vx, vy) {
  const { x, y, width: W, height: H } = box;
  switch (normalizeRotation(rotation)) {
    case 90:
      return [x + vy, y + vx];
    case 180:
      return [x + W - vx, y + vy];
    case 270:
      return [x + W - vy, y + H - vx];
    default:
      return [x + vx, y + H - vy];
  }
}

// Axis-aligned view rectangle as a PDF rectangle (quarter-turn rotations keep rectangles axis-aligned).
export function rectViewToPdf(rotation, box, vx, vy, w, h) {
  const [ax, ay] = viewToPdf(rotation, box, vx, vy);
  const [bx, by] = viewToPdf(rotation, box, vx + w, vy + h);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

// Smallest rectangle { x, y, w, h } holding every rectangle in `rects`; null when there are none.
export function boundingBox(rects) {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}
