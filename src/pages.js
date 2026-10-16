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
