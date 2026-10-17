// Page ranges and page-index bookkeeping for items (text boxes and marks) when pages are
// inserted, deleted or moved. Pure functions: items are anything with a numeric `page` field.

// Parses "1-3, 5, 8-" (1-based, inclusive, open end = last page) into sorted 0-based indices.
export function parsePageRange(input, total) {
  const text = String(input ?? '').trim();
  if (!text) throw new Error('Hãy nhập dãy trang, ví dụ 1-3, 5.');
  const out = new Set();
  for (const raw of text.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d+)?\s*(?:(-)\s*(\d+)?)?$/.exec(part);
    if (!m || (!m[1] && !m[2])) throw new Error(`Không hiểu "${part}". Dùng dạng 1-3, 5.`);
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : total) : from;
    if (from < 1 || to > total || from > to) throw new Error(`"${part}" nằm ngoài trang 1–${total}.`);
    for (let p = from; p <= to; p++) out.add(p - 1);
  }
  if (!out.size) throw new Error('Hãy nhập dãy trang, ví dụ 1-3, 5.');
  return [...out].sort((a, b) => a - b);
}

// Formats sorted 0-based indices back to a compact 1-based range, e.g. [0,1,2,4] -> "1-3,5".
export function formatPageRange(indices) {
  const parts = [];
  for (let i = 0; i < indices.length; i++) {
    let j = i;
    while (j + 1 < indices.length && indices[j + 1] === indices[j] + 1) j++;
    parts.push(i === j ? `${indices[i] + 1}` : `${indices[i] + 1}-${indices[j] + 1}`);
    i = j;
  }
  return parts.join(',');
}

// Items on the deleted page are dropped; later pages shift up by one.
export function remapDeleted(items, index) {
  return items.filter((it) => it.page !== index).map((it) => (it.page > index ? { ...it, page: it.page - 1 } : it));
}

// A page inserted at `index` pushes that page and every later one down by one.
export function remapInserted(items, index) {
  return items.map((it) => (it.page >= index ? { ...it, page: it.page + 1 } : it));
}

// New index of page `p` after moving page `from` to position `to`.
export function movedIndex(p, from, to) {
  if (p === from) return to;
  if (from < to && p > from && p <= to) return p - 1;
  if (from > to && p >= to && p < from) return p + 1;
  return p;
}

export function remapMoved(items, from, to) {
  return items.map((it) => {
    const page = movedIndex(it.page, from, to);
    return page === it.page ? it : { ...it, page };
  });
}

// New page order after moving the pages in `picked` (0-based, any order) so they sit together, in
// document order, just before page `before` (0…total; `total` means after the last page).
// The result lists the old index of the page at each new position.
export function moveSelectionOrder(total, picked, before) {
  const moving = [...new Set(picked)].filter((i) => i >= 0 && i < total).sort((a, b) => a - b);
  const set = new Set(moving);
  const rest = [];
  for (let i = 0; i < total; i++) if (!set.has(i)) rest.push(i);
  const at = rest.filter((i) => i < before).length;
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

// Items follow their page to its new position; items on pages left out of `order` are dropped.
// order[k] is the old index of the page now at position k.
export function remapOrder(items, order) {
  const pos = new Map(order.map((old, k) => [old, k]));
  return items
    .filter((it) => pos.has(it.page))
    .map((it) => {
      const page = pos.get(it.page);
      return page === it.page ? it : { ...it, page };
    });
}

export function isIdentityOrder(order) {
  return order.every((old, k) => old === k);
}

// Parts for splitting a document: 'each' (one page per file), 'every' (files of `value` pages) or
// 'ranges' ("1-3; 4-6; 8-": groups separated by semicolons or new lines). Each part lists 0-based indices.
export function splitPlan(mode, total, value) {
  if (mode === 'each') return Array.from({ length: total }, (_, i) => [i]);
  if (mode === 'every') {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) throw new Error('Số trang mỗi tệp phải từ 1 trở lên.');
    const parts = [];
    for (let i = 0; i < total; i += n) parts.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
    return parts;
  }
  const groups = String(value ?? '').split(/[;\n]/).map((g) => g.trim()).filter(Boolean);
  if (!groups.length) throw new Error('Hãy nhập các phần, ví dụ 1-3; 4-6; 7-.');
  return groups.map((g) => parsePageRange(g, total));
}

const PAPERS = [
  ['A3', 841.89, 1190.55],
  ['A4', 595.28, 841.89],
  ['A5', 419.53, 595.28],
  ['Letter', 612, 792],
  ['Legal', 612, 1008],
];

// Name of a common paper size (either orientation) for a page in points, or '' for other sizes.
export function paperName(width, height) {
  const [a, b] = width < height ? [width, height] : [height, width];
  return PAPERS.find(([, w, h]) => Math.abs(a - w) < 2 && Math.abs(b - h) < 2)?.[0] ?? '';
}

// "210 × 297 mm (A4)"
export function pageSizeLabel(width, height) {
  const mm = (pt) => Math.round((pt * 25.4) / 72);
  const name = paperName(width, height);
  return `${mm(width)} × ${mm(height)} mm${name ? ` (${name})` : ''}`;
}
