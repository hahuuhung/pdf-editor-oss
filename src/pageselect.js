// Page selection in the thumbnail panel and where dragged pages land. Pure functions; pages are
// 0-based indices and a selection is a sorted array without duplicates.

function normalize(list) {
  return [...new Set(list)].sort((a, b) => a - b);
}

// Selection after clicking page `index`. A plain click selects only that page, `toggle`
// (Ctrl/Cmd) adds or removes it, `range` (Shift) selects every page from `anchor` to it, added to
// the current selection when combined with `toggle`. Returns the selection and the anchor for the
// next Shift click. The selection is never empty.
export function clickSelection(selection, index, anchor, { toggle = false, range = false } = {}) {
  if (range && Number.isInteger(anchor) && anchor >= 0) {
    const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
    const span = Array.from({ length: b - a + 1 }, (_, k) => a + k);
    return { selection: normalize([...(toggle ? selection : []), ...span]), anchor };
  }
  if (toggle) {
    const next = selection.includes(index) ? selection.filter((i) => i !== index) : [...selection, index];
    return { selection: next.length ? normalize(next) : [index], anchor: index };
  }
  return { selection: [index], anchor: index };
}

// The selected pages at their new positions after the pages were put in `order` (the old index
// of the page at each new position); pages that no longer exist are dropped.
export function followOrder(selection, order) {
  const pos = new Map(order.map((old, k) => [old, k]));
  return normalize(selection.filter((i) => pos.has(i)).map((i) => pos.get(i)));
}

// Gap under the pointer while pages are dragged: 0 = before the first card, n = after the last.
// `midpoints` are the vertical centres of the cards, in page order.
export function dropGap(midpoints, y) {
  let gap = 0;
  while (gap < midpoints.length && y > midpoints[gap]) gap++;
  return gap;
}
