// Smart guides for moving items. A moving rectangle snaps its left edge, centre or right edge to the
// nearest vertical guide (page edges, page centre, other items' edges and centres) and likewise
// vertically. Pure functions; coordinates are view space (see geometry.js).

// Guide lines of one page: its edges and centre, plus the edges and centres of `others` ({ x, y, w, h }).
export function snapLines(size, others = []) {
  const xs = [0, size.width / 2, size.width];
  const ys = [0, size.height / 2, size.height];
  for (const r of others) {
    xs.push(r.x, r.x + r.w / 2, r.x + r.w);
    ys.push(r.y, r.y + r.h / 2, r.y + r.h);
  }
  return { xs, ys };
}

function nearest(edges, lines, threshold) {
  let best = null;
  for (const e of edges) {
    for (const at of lines) {
      const d = at - e;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at };
    }
  }
  return best;
}

// Offset that moves `rect` onto the closest guide on each axis within `threshold`, and those guides
// (null for an axis that did not snap).
export function snapRect(rect, lines, threshold) {
  const bx = nearest([rect.x, rect.x + rect.w / 2, rect.x + rect.w], lines.xs, threshold);
  const by = nearest([rect.y, rect.y + rect.h / 2, rect.y + rect.h], lines.ys, threshold);
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0, guides: { x: bx?.at ?? null, y: by?.at ?? null } };
}
