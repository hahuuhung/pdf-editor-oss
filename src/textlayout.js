// Turns positioned text runs or OCR words into plain lines, and those lines into text or HTML.
// Pure functions. Items are { str | text, x, y, w, h } in view space (see geometry.js).

const textOf = (it) => it.str ?? it.text ?? '';

// Groups items into lines by vertical overlap, in reading order (top to bottom, left to right).
// A space is inserted between neighbours separated by a visible gap.
export function groupLines(items) {
  const lines = [];
  const sorted = items.filter((it) => textOf(it).trim()).sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
  for (const it of sorted) {
    const mid = it.y + it.h / 2;
    const line = lines.find((l) => Math.abs(l.mid - mid) < Math.max(l.h, it.h) * 0.5);
    if (line) {
      line.items.push(it);
      line.h = Math.max(line.h, it.h);
    } else {
      lines.push({ mid, h: it.h, items: [it] });
    }
  }
  return lines
    .sort((a, b) => a.mid - b.mid)
    .map((l) => {
      const row = l.items.sort((a, b) => a.x - b.x);
      let out = '';
      let end = null;
      for (const it of row) {
        const t = textOf(it);
        const gap = end === null ? 0 : it.x - end;
        if (out && gap > l.h * 0.15 && !out.endsWith(' ') && !t.startsWith(' ')) out += ' ';
        out += t;
        end = it.x + it.w;
      }
      return out.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

// Removes Vietnamese (and other Latin) diacritics, for fonts that only cover basic Latin.
export function stripDiacritics(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Splits `text` into lines no wider than `maxWidth`, breaking between words; `measure(s)` gives the
// width of a string. A word longer than a whole line is cut between characters.
export function wrapText(text, maxWidth, measure) {
  const lines = [];
  let line = '';
  for (let word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    const joined = line ? `${line} ${word}` : word;
    if (measure(joined) <= maxWidth) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    while (word.length > 1 && measure(word) > maxWidth) {
      let k = word.length - 1;
      while (k > 1 && measure(word.slice(0, k)) > maxWidth) k--;
      lines.push(word.slice(0, k));
      word = word.slice(k);
    }
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

// `text` shortened with an ellipsis so that it fits in `maxWidth`.
export function fitText(text, maxWidth, measure, ellipsis = '…') {
  const s = String(text ?? '');
  if (measure(s) <= maxWidth) return s;
  let k = s.length - 1;
  while (k > 0 && measure(s.slice(0, k) + ellipsis) > maxWidth) k--;
  return k > 0 ? s.slice(0, k) + ellipsis : '';
}

// pages: [[line, line, …], …]; `numbers` gives each page's number when only some pages are exported.
export function pagesToText(pages, numbers = null) {
  return pages.map((lines, i) => `--- Trang ${numbers?.[i] ?? i + 1} ---\n${lines.join('\n')}`).join('\n\n') + '\n';
}

export function pagesToHtml(title, pages, numbers = null) {
  const body = pages
    .map((lines, i) => {
      const n = numbers?.[i] ?? i + 1;
      return `<section id="trang-${n}">\n<h2>Trang ${n}</h2>\n${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n')}\n</section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.55}section{border-top:1px solid #ddd;padding-top:1rem}h2{font-size:.9rem;color:#666}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>
`;
}
