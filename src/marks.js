// Pure model for markup: highlights, underlines, shapes, ink and sticky notes. No DOM, no PDF library.
// Coordinates are PDF points at scale 1, origin at the page's top-left corner (same as model.js).
// Default colors and widths follow the comment styles of PDF-XChange-like editors; see THIRD_PARTY.md.

export const MARK_TYPES = [
  'note', 'highlight', 'underline', 'strike', 'squiggly', 'rect', 'oval', 'line', 'arrow', 'ink',
  'stamp', 'image', 'link', 'redact', 'symbol',
];
export const NOTE_SIZE = 18;

// Marks drawn inside an x/y/w/h box; these can be resized from their bottom-right corner.
export const RESIZABLE_TYPES = ['highlight', 'underline', 'strike', 'squiggly', 'rect', 'oval', 'stamp', 'image', 'link', 'redact', 'symbol'];
export const SYMBOLS = ['check', 'cross', 'dot'];
export const STAMP_LABELS = ['APPROVED', 'DRAFT', 'CONFIDENTIAL', 'FINAL', 'NOT APPROVED', 'ĐÃ DUYỆT', 'BẢN NHÁP', 'MẬT', 'ĐÃ KÝ'];

export const MARK_DEFAULTS = {
  note: { color: '#ffd100', width: 1, opacity: 1, fill: null },
  highlight: { color: '#fff000', width: 1, opacity: 0.5, fill: null },
  underline: { color: '#0078d6', width: 1, opacity: 1, fill: null },
  strike: { color: '#e32121', width: 1, opacity: 1, fill: null },
  squiggly: { color: '#2e9e5c', width: 1, opacity: 1, fill: null },
  rect: { color: '#e32121', width: 2, opacity: 1, fill: null },
  oval: { color: '#e32121', width: 2, opacity: 1, fill: null },
  line: { color: '#e32121', width: 2, opacity: 1, fill: null },
  arrow: { color: '#e32121', width: 2, opacity: 1, fill: null },
  ink: { color: '#0066de', width: 2, opacity: 1, fill: null },
  stamp: { color: '#c62828', width: 2, opacity: 1, fill: null },
  image: { color: '#000000', width: 1, opacity: 1, fill: null },
  link: { color: '#1b63e0', width: 1, opacity: 1, fill: null },
  redact: { color: '#000000', width: 1, opacity: 1, fill: null },
  symbol: { color: '#000000', width: 1.5, opacity: 1, fill: null },
};

const IMAGE_SRC = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

// Only web and mail links are kept; anything else (javascript:, file:, …) becomes empty.
export function safeUrl(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function clamp(value, lo, hi, fallback) {
  return Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;
}

// Returns a mark with every field valid, filling defaults for missing or invalid values.
export function sanitizeMark(m) {
  const type = MARK_TYPES.includes(m.type) ? m.type : 'rect';
  const d = MARK_DEFAULTS[type];
  const points = Array.isArray(m.points)
    ? m.points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([x, y]) => [x, y])
    : [];
  const num = (v) => (Number.isFinite(v) ? v : 0);
  return {
    id: m.id,
    type,
    page: Math.max(0, Math.floor(num(Number(m.page)))),
    x: num(m.x),
    y: num(m.y),
    w: Math.max(0, num(m.w)),
    h: Math.max(0, num(m.h)),
    points,
    text: typeof m.text === 'string' ? m.text : '',
    color: HEX_COLOR.test(m.color ?? '') ? m.color.toLowerCase() : d.color,
    width: clamp(Number(m.width), 0.5, 12, d.width),
    opacity: clamp(Number(m.opacity), 0.05, 1, d.opacity),
    fill: HEX_COLOR.test(m.fill ?? '') ? m.fill.toLowerCase() : null,
    label: type === 'symbol' ? (SYMBOLS.includes(m.label) ? m.label : 'check') : typeof m.label === 'string' ? m.label.slice(0, 80) : '',
    src: typeof m.src === 'string' && IMAGE_SRC.test(m.src) ? m.src : '',
    url: safeUrl(m.url),
  };
}

// Returns the mark with a new box size, at least 4 points each way. `keepAspect` keeps w:h.
export function resizeMark(m, w, h, { keepAspect = false } = {}) {
  let width = Math.max(4, Number(w) || 0);
  let height = Math.max(4, Number(h) || 0);
  if (keepAspect && m.w > 0 && m.h > 0) height = Math.max(4, width * (m.h / m.w));
  return sanitizeMark({ ...m, w: width, h: height });
}

// Rectangle spanned by two corners, always with positive width and height.
export function normalizeRect(x1, y1, x2, y2) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

// Axis-aligned box that contains a mark, used for selection outlines.
export function markBounds(m) {
  if (m.type === 'note') return { x: m.x, y: m.y, w: NOTE_SIZE, h: NOTE_SIZE };
  if (m.type === 'line' || m.type === 'arrow' || m.type === 'ink') {
    if (m.points.length === 0) return { x: m.x, y: m.y, w: 0, h: 0 };
    const xs = m.points.map((p) => p[0]);
    const ys = m.points.map((p) => p[1]);
    const x = xs.reduce((a, b) => Math.min(a, b));
    const y = ys.reduce((a, b) => Math.min(a, b));
    return { x, y, w: xs.reduce((a, b) => Math.max(a, b)) - x, h: ys.reduce((a, b) => Math.max(a, b)) - y };
  }
  return { x: m.x, y: m.y, w: m.w, h: m.h };
}

// Points on the ellipse inscribed in the rectangle (x, y, w, h). The ellipse is not closed in the output.
export function ellipsePoints(x, y, w, h, n = 48) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

// Zig-zag along a horizontal line, used for the squiggly underline.
export function zigzagPoints(x1, x2, y, amp = 1.5, step = 3) {
  const pts = [];
  let i = 0;
  for (let x = x1; x < x2; x += step, i++) pts.push([x, y + (i % 2 ? amp : -amp)]);
  pts.push([x2, y + (i % 2 ? amp : -amp)]);
  return pts;
}

// Two wings and the tip of an arrow head at (x2, y2), pointing away from (x1, y1).
export function arrowHeadPoints(x1, y1, x2, y2, size = 8, spread = Math.PI / 7) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  return [
    [x2 - size * Math.cos(ang - spread), y2 - size * Math.sin(ang - spread)],
    [x2, y2],
    [x2 - size * Math.cos(ang + spread), y2 - size * Math.sin(ang + spread)],
  ];
}

// Drops freehand points closer than minDist to the last kept point, keeping the final point.
export function simplifyInk(points, minDist = 1.5) {
  if (points.length === 0) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [px, py] = out[out.length - 1];
    if (Math.hypot(points[i][0] - px, points[i][1] - py) >= minDist) out.push(points[i]);
  }
  const last = points[points.length - 1];
  const kept = out[out.length - 1];
  if (out.length > 1 && (kept[0] !== last[0] || kept[1] !== last[1])) out.push(last);
  return out;
}

export function nextMarkId(marks) {
  const max = marks.reduce((m, k) => Math.max(m, Number(String(k.id).slice(1)) || 0), 0);
  return `m${max + 1}`;
}

export function addMark(marks, m) {
  return [...marks, sanitizeMark(m)];
}

export function updateMark(marks, id, patch) {
  return marks.map((m) => (m.id === id ? sanitizeMark({ ...m, ...patch, id }) : m));
}

export function removeMark(marks, id) {
  return marks.filter((m) => m.id !== id);
}

// Returns the mark translated by (dx, dy) points, including every vertex of line, arrow and ink marks.
export function moveMark(m, dx, dy) {
  return sanitizeMark({ ...m, x: m.x + dx, y: m.y + dy, points: m.points.map(([x, y]) => [x + dx, y + dy]) });
}

export function marksOnPage(marks, page) {
  return marks.filter((m) => m.page === page);
}
