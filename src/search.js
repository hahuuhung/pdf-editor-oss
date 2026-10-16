// Text search over positioned text runs. Items are { str, x, y, w, h } in view space (see geometry.js).
// A match gets a rectangle proportional to its character offsets inside one run. Text that spans
// several runs is not matched; pdf.js usually emits one run per line or styled span.

function fold(s, caseSensitive) {
  return caseSensitive ? s : s.toLocaleLowerCase('vi');
}

function snippet(str, at, len) {
  const a = Math.max(0, at - 24);
  const b = Math.min(str.length, at + len + 24);
  return `${a > 0 ? '…' : ''}${str.slice(a, b)}${b < str.length ? '…' : ''}`;
}

export function findInItems(items, query, { caseSensitive = false } = {}) {
  const q = fold(String(query ?? ''), caseSensitive);
  if (!q.trim()) return [];
  const hits = [];
  for (const it of items) {
    const s = fold(it.str ?? '', caseSensitive);
    if (s.length !== (it.str ?? '').length || !s.length) continue; // case folding changed length: skip safely
    for (let at = s.indexOf(q); at >= 0; at = s.indexOf(q, at + q.length)) {
      hits.push({
        x: it.x + it.w * (at / s.length),
        y: it.y,
        w: it.w * (q.length / s.length),
        h: it.h,
        snippet: snippet(it.str, at, q.length),
      });
    }
  }
  return hits;
}
