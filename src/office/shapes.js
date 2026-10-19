// Draw tools: preset shapes, glue points and connectors. Pure functions; coordinates are page
// points in view space (see geometry.js).
//
// Modelled on Apache OpenOffice Draw (svx/source/customshapes/EnhancedCustomShapeGeometry.cxx):
// the five-point star and the lightning bolt use its vertex tables (21600-unit grid); the other
// presets are drawn from the same proportions. Like OpenOffice, every shape has four glue points
// (top, right, bottom, left) and a connector keeps its ends on the glue points it is attached to.
// See THIRD_PARTY.md (Apache-2.0).

const GRID = 21600; // OpenOffice custom shape coordinate space

// Points of a closed outline in a unit box (0..1), flattened to straight segments.
const unit = (pairs) => pairs.map(([x, y]) => [x / GRID, y / GRID]);
const ring = (n, start = -Math.PI / 2) => Array.from({ length: n }, (_, i) => {
  const a = start + (2 * Math.PI * i) / n;
  return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)];
});
const star = (n, inner) => Array.from({ length: n * 2 }, (_, i) => {
  const a = -Math.PI / 2 + (Math.PI * i) / n;
  const r = i % 2 ? inner / 2 : 0.5;
  return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)];
});
const arc = (cx, cy, rx, ry, from, to, steps = 10) =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });

// Outlines that do not depend on the box's aspect ratio.
const UNIT_SHAPES = {
  triangle: [[0.5, 0], [1, 1], [0, 1]],
  rightTriangle: [[0, 0], [1, 1], [0, 1]],
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  parallelogram: [[0.25, 0], [1, 0], [0.75, 1], [0, 1]],
  trapezoid: [[0.25, 0], [0.75, 0], [1, 1], [0, 1]],
  pentagon: ring(5),
  hexagon: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
  octagon: [[0.29, 0], [0.71, 0], [1, 0.29], [1, 0.71], [0.71, 1], [0.29, 1], [0, 0.71], [0, 0.29]],
  star4: star(4, 0.38),
  star5: unit([[10797, 0], [8278, 8256], [0, 8256], [6722, 13405], [4198, 21600], [10797, 16580], [17401, 21600], [14878, 13405], [21600, 8256], [13321, 8256]]),
  star6: star(6, 0.58),
  rightArrow: [[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]],
  leftArrow: [[1, 0.25], [0.4, 0.25], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.75], [1, 0.75]],
  upArrow: [[0.25, 1], [0.25, 0.4], [0, 0.4], [0.5, 0], [1, 0.4], [0.75, 0.4], [0.75, 1]],
  downArrow: [[0.25, 0], [0.25, 0.6], [0, 0.6], [0.5, 1], [1, 0.6], [0.75, 0.6], [0.75, 0]],
  leftRightArrow: [[0, 0.5], [0.25, 0], [0.25, 0.25], [0.75, 0.25], [0.75, 0], [1, 0.5], [0.75, 1], [0.75, 0.75], [0.25, 0.75], [0.25, 1]],
  chevron: [[0, 0], [0.7, 0], [1, 0.5], [0.7, 1], [0, 1], [0.3, 0.5]],
  plus: [[0.33, 0], [0.67, 0], [0.67, 0.33], [1, 0.33], [1, 0.67], [0.67, 0.67], [0.67, 1], [0.33, 1], [0.33, 0.67], [0, 0.67], [0, 0.33], [0.33, 0.33]],
  lightning: unit([[8458, 0], [0, 3923], [7564, 8416], [4993, 9720], [12197, 13904], [9987, 14934], [21600, 21600], [14768, 12911], [16558, 12016], [11030, 6840], [12831, 6120]]),
  heart: (() => {
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const t = (2 * Math.PI * i) / 48;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      pts.push([0.5 + x / 34, 0.42 - y / 30]);
    }
    return pts;
  })(),
  document: [[0, 0], [1, 0], [1, 0.85], ...arc(0.75, 0.85, 0.25, 0.1, 0, Math.PI, 8), ...arc(0.25, 0.85, 0.25, 0.1, 0, -Math.PI, 8).slice(1), [0, 0.85]],
};

// Presets offered in the shape picker, in order: [id, Vietnamese label].
export const SHAPE_PRESETS = [
  ['rect', 'Hình chữ nhật'], ['roundRect', 'Chữ nhật bo góc'], ['ellipse', 'Elip'],
  ['triangle', 'Tam giác'], ['rightTriangle', 'Tam giác vuông'], ['diamond', 'Hình thoi'],
  ['parallelogram', 'Hình bình hành'], ['trapezoid', 'Hình thang'], ['pentagon', 'Ngũ giác'],
  ['hexagon', 'Lục giác'], ['octagon', 'Bát giác'], ['star4', 'Sao 4 cánh'], ['star5', 'Sao 5 cánh'],
  ['star6', 'Sao 6 cánh'], ['rightArrow', 'Mũi tên phải'], ['leftArrow', 'Mũi tên trái'],
  ['upArrow', 'Mũi tên lên'], ['downArrow', 'Mũi tên xuống'], ['leftRightArrow', 'Mũi tên hai chiều'],
  ['chevron', 'Chữ V'], ['plus', 'Dấu cộng'], ['heart', 'Trái tim'], ['lightning', 'Tia sét'],
  ['callout', 'Khung lời thoại'], ['terminator', 'Lưu đồ: bắt đầu/kết thúc'], ['document', 'Lưu đồ: tài liệu'],
];
export const SHAPE_IDS = SHAPE_PRESETS.map(([id]) => id);

// Closed outline of a preset in the box (x, y, w, h).
export function shapeOutline(preset, x, y, w, h) {
  const scale = (pts) => pts.map(([u, v]) => [x + u * w, y + v * h]);
  if (UNIT_SHAPES[preset]) return scale(UNIT_SHAPES[preset]);
  if (preset === 'ellipse') return scale(arc(0.5, 0.5, 0.5, 0.5, 0, 2 * Math.PI, 48).slice(0, -1));
  if (preset === 'roundRect' || preset === 'terminator') {
    // OpenOffice's rounded rectangle uses a corner of 1/6 of the shorter side; a terminator is fully round.
    const r = preset === 'terminator' ? Math.min(w, h) / 2 : Math.min(w, h) / 6;
    const c = (cx, cy, from) => arc(cx, cy, r, r, from, from + Math.PI / 2, 6);
    return [
      ...c(x + w - r, y + r, -Math.PI / 2), ...c(x + w - r, y + h - r, 0),
      ...c(x + r, y + h - r, Math.PI / 2), ...c(x + r, y + r, Math.PI),
    ];
  }
  if (preset === 'callout') {
    // A rectangle on the top 80% with a tail from the bottom edge, like OpenOffice's rectangular callout.
    const b = y + h * 0.8;
    return [[x, y], [x + w, y], [x + w, b], [x + w * 0.45, b], [x + w * 0.2, y + h], [x + w * 0.3, b], [x, b]];
  }
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; // 'rect' and unknown presets
}

// ---------- glue points and connectors ----------

export const GLUE_SITES = ['top', 'right', 'bottom', 'left'];
const SITE_DIRECTION = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

// Glue point `site` of a box { x, y, w, h }.
export function gluePoint(box, site) {
  const { x, y, w, h } = box;
  return { top: [x + w / 2, y], right: [x + w, y + h / 2], bottom: [x + w / 2, y + h], left: [x, y + h / 2] }[site] ?? [x + w / 2, y + h / 2];
}

// The glue site of `box` nearest to point p, if it is within `reach`.
export function nearestGlue(box, p, reach) {
  let best = null;
  for (const site of GLUE_SITES) {
    const [gx, gy] = gluePoint(box, site);
    const d = Math.hypot(gx - p[0], gy - p[1]);
    if (d <= reach && (!best || d < best.d)) best = { site, d, point: [gx, gy] };
  }
  return best;
}

function simplify(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((Math.abs(prev[0] - last[0]) < 1e-6 && Math.abs(last[0] - p[0]) < 1e-6) || (Math.abs(prev[1] - last[1]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6))) {
      out[out.length - 1] = p; // the middle point lies on a straight run
      continue;
    }
    out.push(p);
  }
  return out;
}

// Route of a connector from `a` to `b`. 'straight' is one segment; 'elbow' (OpenOffice's standard
// connector) leaves and enters along the glue sites' directions with right-angle bends.
export function routeConnector(a, b, { style = 'elbow', fromSite = null, toSite = null, margin = 12 } = {}) {
  if (style !== 'elbow') return [a, b];
  const horizontal = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
  const d1 = SITE_DIRECTION[fromSite] ?? (horizontal ? [Math.sign(b[0] - a[0]) || 1, 0] : [0, Math.sign(b[1] - a[1]) || 1]);
  const d2 = SITE_DIRECTION[toSite] ?? [-d1[0], -d1[1]];
  const p1 = [a[0] + d1[0] * margin, a[1] + d1[1] * margin];
  const p3 = [b[0] + d2[0] * margin, b[1] + d2[1] * margin];
  let middle;
  if (d1[0] !== 0 && d2[0] !== 0) {
    const mx = (p1[0] + p3[0]) / 2;
    middle = [[mx, p1[1]], [mx, p3[1]]];
  } else if (d1[1] !== 0 && d2[1] !== 0) {
    const my = (p1[1] + p3[1]) / 2;
    middle = [[p1[0], my], [p3[0], my]];
  } else if (d1[0] !== 0) {
    middle = [[p3[0], p1[1]]];
  } else {
    middle = [[p1[0], p3[1]]];
  }
  return simplify([a, p1, ...middle, p3, b]);
}

// Connectors whose ends are glued to a box follow that box. `boxOf(id)` gives the current box of
// a mark (or null when it is gone, which unglues that end). Returns the same array when nothing moved.
export function rerouteConnectors(marks, boxOf) {
  let changed = false;
  const next = marks.map((m) => {
    if (m.type !== 'connector' || !m.data) return m;
    const ends = { from: m.data.from, to: m.data.to };
    const a = [...m.points[0]];
    const b = [...m.points[m.points.length - 1]];
    const data = { ...m.data };
    for (const [key, point] of [['from', a], ['to', b]]) {
      const glue = ends[key];
      if (!glue) continue;
      const box = boxOf(glue.id, m.page);
      if (!box) {
        data[key] = null;
        continue;
      }
      const [gx, gy] = gluePoint(box, glue.site);
      point[0] = gx;
      point[1] = gy;
    }
    const points = routeConnector(a, b, { style: data.style, fromSite: data.from?.site, toSite: data.to?.site });
    const same = points.length === m.points.length && points.every((p, i) => Math.abs(p[0] - m.points[i][0]) < 1e-6 && Math.abs(p[1] - m.points[i][1]) < 1e-6);
    if (same && data.from === m.data.from && data.to === m.data.to) return m;
    changed = true;
    return { ...m, points, data };
  });
  return changed ? next : marks;
}

// Filled head at the end of a polyline (the last segment points into it).
export function arrowHead(points, size) {
  const [x2, y2] = points[points.length - 1];
  const [x1, y1] = points[points.length - 2] ?? [x2 - 1, y2];
  const a = Math.atan2(y2 - y1, x2 - x1);
  const s = Math.PI / 7;
  return [[x2, y2], [x2 - size * Math.cos(a - s), y2 - size * Math.sin(a - s)], [x2 - size * Math.cos(a + s), y2 - size * Math.sin(a + s)]];
}
