// Pure editing model: text boxes placed on PDF pages. No DOM, no PDF library.
// Coordinates are in PDF points at scale 1, origin at the page's top-left corner.

export const DEFAULT_FONT_SIZE = 14;
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 96;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function clampFontSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_FONT_SIZE;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(n)));
}

// Returns a box with every field valid, filling defaults for missing values.
export function sanitizeBox(box) {
  return {
    id: box.id,
    page: Math.max(0, Math.floor(Number(box.page) || 0)),
    x: Number.isFinite(box.x) ? box.x : 0,
    y: Number.isFinite(box.y) ? box.y : 0,
    text: typeof box.text === 'string' ? box.text : '',
    fontSize: clampFontSize(box.fontSize ?? DEFAULT_FONT_SIZE),
    color: HEX_COLOR.test(box.color ?? '') ? box.color : '#000000',
  };
}

export function nextId(boxes) {
  return boxes.reduce((max, b) => Math.max(max, b.id), 0) + 1;
}

export function addBox(boxes, box) {
  return [...boxes, sanitizeBox(box)];
}

export function updateBox(boxes, id, patch) {
  return boxes.map((b) => (b.id === id ? sanitizeBox({ ...b, ...patch, id }) : b));
}

export function removeBox(boxes, id) {
  return boxes.filter((b) => b.id !== id);
}

export function boxesOnPage(boxes, page) {
  return boxes.filter((b) => b.page === page);
}
