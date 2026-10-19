// Editable bookmarks (the PDF outline), kept as a flat list in reading order:
//   { id, title, page, left, top, depth, url }
// `page` is 0-based (null when the entry points nowhere), `left`/`top` the point in PDF user space the
// entry scrolls to (null: the top of the page), `depth` 0 for the top level, `url` a web link instead
// of a page. PDF coordinates stay valid when a page is rotated or cropped, and a flat list follows
// page moves like other items; the tree is rebuilt when the outline is written. Pure functions.

const num = (v) => (Number.isFinite(v) ? v : null);

export function nextBookmarkId(list) {
  return `b${list.reduce((max, b) => Math.max(max, Number(String(b.id).slice(1)) || 0), 0) + 1}`;
}

// Depths that form a tree: the first entry is top level, each entry at most one level below the one before.
export function normalizeDepths(list) {
  let prev = -1;
  return list.map((b) => {
    const depth = Math.max(0, Math.min(b.depth ?? 0, prev + 1));
    prev = depth;
    return depth === b.depth ? b : { ...b, depth };
  });
}

// Index just past the entry at `index` and its descendants.
export function subtreeEnd(list, index) {
  let k = index + 1;
  while (k < list.length && list[k].depth > list[index].depth) k++;
  return k;
}

// Nested entries for writing the outline: [{ ...entry, children: [...] }].
export function outlineTree(list) {
  const root = [];
  const stack = [{ depth: -1, children: root }];
  for (const b of normalizeDepths(list)) {
    while (stack.at(-1).depth >= b.depth) stack.pop();
    const node = { ...b, children: [] };
    stack.at(-1).children.push(node);
    stack.push(node);
  }
  return root;
}

// Flat entries from a nested outline [{ title, page, left, top, url, items }] (pdf.js, destinations resolved).
export function flattenOutline(items, depth = 0, out = []) {
  for (const it of items ?? []) {
    out.push({
      id: `b${out.length + 1}`,
      title: String(it.title ?? ''),
      page: Number.isInteger(it.page) && it.page >= 0 ? it.page : null,
      left: num(it.left),
      top: num(it.top),
      depth,
      url: typeof it.url === 'string' ? it.url : '',
    });
    flattenOutline(it.items, depth + 1, out);
  }
  return out;
}

// Entries follow their page to its new position (order[k] is the old index of the page now at k);
// entries on removed pages are dropped and their children move up. Links and page-less entries stay.
export function remapBookmarks(list, order) {
  const pos = new Map(order.map((old, k) => [old, k]));
  const out = [];
  for (const b of list) {
    if (b.page === null || b.url) out.push(b);
    else if (pos.has(b.page)) out.push(pos.get(b.page) === b.page ? b : { ...b, page: pos.get(b.page) });
  }
  return normalizeDepths(out);
}

// Moves the entry at `index`, with its descendants, before its previous sibling (dir -1) or after its
// next sibling (dir 1). The list is returned unchanged when there is no such sibling.
export function moveBookmark(list, index, dir) {
  const depth = list[index].depth;
  const end = subtreeEnd(list, index);
  const block = list.slice(index, end);
  if (dir < 0) {
    let p = index - 1;
    while (p >= 0 && list[p].depth > depth) p--;
    if (p < 0 || list[p].depth < depth) return list;
    return [...list.slice(0, p), ...block, ...list.slice(p, index), ...list.slice(end)];
  }
  if (end >= list.length || list[end].depth < depth) return list;
  const nextEnd = subtreeEnd(list, end);
  return [...list.slice(0, index), ...list.slice(end, nextEnd), ...block, ...list.slice(nextEnd)];
}

// Changes the depth of the entry at `index` and its descendants by `delta`: 1 makes it a child of its
// previous sibling, -1 moves it up to its parent's level (the siblings after it become its children).
export function indentBookmark(list, index, delta) {
  const depth = list[index].depth;
  if (delta > 0 && (index === 0 || list[index - 1].depth < depth)) return list;
  if (delta < 0 && depth === 0) return list;
  const end = subtreeEnd(list, index);
  return list.map((b, k) => (k >= index && k < end ? { ...b, depth: b.depth + delta } : b));
}

// Removes the entry at `index` together with its descendants.
export function removeBookmark(list, index) {
  return [...list.slice(0, index), ...list.slice(subtreeEnd(list, index))];
}

export function renameBookmark(list, index, title) {
  return list.map((b, k) => (k === index ? { ...b, title: String(title ?? '').slice(0, 300) } : b));
}

// Inserts `entry` as the next sibling of the entry at `after` (past its descendants), or first when
// `after` is -1.
export function insertBookmark(list, entry, after = -1) {
  if (after < 0) return [{ ...entry, depth: 0 }, ...list];
  const at = subtreeEnd(list, after);
  return [...list.slice(0, at), { ...entry, depth: list[after].depth }, ...list.slice(at)];
}

// The entry a new bookmark for `page` should follow when none is selected: the last top-level entry
// on that page or an earlier one, so top-level entries stay in page order (-1: insert first).
export function bookmarkSlot(list, page) {
  let after = -1;
  list.forEach((b, k) => {
    if (b.depth === 0 && b.page !== null && b.page <= page) after = k;
  });
  return after;
}

// Indices of the entries to show when the entries whose ids are in `collapsed` are folded.
export function visibleIndices(list, collapsed) {
  const out = [];
  let hideBelow = Infinity;
  list.forEach((b, k) => {
    if (b.depth > hideBelow) return;
    hideBelow = Infinity;
    out.push(k);
    if (collapsed.has(b.id) && list[k + 1]?.depth > b.depth) hideBelow = b.depth;
  });
  return out;
}
