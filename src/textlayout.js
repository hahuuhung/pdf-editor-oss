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

// pages: [[line, line, …], …]
export function pagesToText(pages) {
  return pages.map((lines, i) => `--- Trang ${i + 1} ---\n${lines.join('\n')}`).join('\n\n') + '\n';
}

export function pagesToHtml(title, pages) {
  const body = pages
    .map((lines, i) => `<section id="trang-${i + 1}">\n<h2>Trang ${i + 1}</h2>\n${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n')}\n</section>`)
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
