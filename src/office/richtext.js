// Rich text boxes: paragraphs of styled runs (bold, italic, underline, colour) with alignment,
// bullet or numbered lists and line spacing, wrapped to the box width. Pure layout functions; the
// HTML helpers use the DOM only when called.
//
// Modelled on Apache OpenOffice Writer's paragraph and character attributes (sw, editeng): runs
// carry the character attributes, paragraphs carry alignment, numbering and line spacing.
// See THIRD_PARTY.md (Apache-2.0).

const HEX = /^#[0-9a-f]{6}$/i;
export const ALIGNS = ['left', 'center', 'right', 'justify'];

function sanitizeRun(run) {
  return {
    text: String(run?.text ?? '').replace(/\r/g, '').slice(0, 5000),
    bold: !!run?.bold,
    italic: !!run?.italic,
    underline: !!run?.underline,
    color: HEX.test(run?.color ?? '') ? run.color.toLowerCase() : null,
  };
}

export function sanitizeRichText(d = {}) {
  const paragraphs = (Array.isArray(d.paragraphs) ? d.paragraphs : [{ runs: [] }]).slice(0, 500).map((p) => ({
    align: ALIGNS.includes(p?.align) ? p.align : 'left',
    list: p?.list === 'bullet' || p?.list === 'number' ? p.list : null,
    runs: (Array.isArray(p?.runs) ? p.runs : []).map(sanitizeRun).filter((r) => r.text),
  }));
  return {
    paragraphs: paragraphs.length ? paragraphs : [{ align: 'left', list: null, runs: [] }],
    fontSize: Math.min(72, Math.max(5, Number(d.fontSize) || 12)),
    lineHeight: Math.min(3, Math.max(1, Number(d.lineHeight) || 1.25)),
  };
}

export function plainText(d) {
  return sanitizeRichText(d).paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
}

const sameStyle = (a, b) => a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.color === b.color;

// Words of a paragraph: each word is a list of pieces (a word may change style inside), with the
// trailing space (if any) in its last piece.
function words(runs) {
  const out = [];
  let word = [];
  for (const run of runs) {
    for (const part of run.text.split(/( +)/)) {
      if (!part) continue;
      if (/^ +$/.test(part)) {
        if (word.length) {
          word[word.length - 1] = { ...word[word.length - 1], space: true };
          out.push(word);
          word = [];
        }
        continue;
      }
      word.push({ ...run, text: part });
    }
  }
  if (word.length) out.push(word);
  return out;
}

// Lays the text out in a box `width` wide. Returns { h, ops } with ops relative to the box's
// top-left corner. `measure(text, size, { bold, italic })` gives text widths.
export function layoutRichText(data, width, { color = '#000000', measure }) {
  const d = sanitizeRichText(data);
  const size = d.fontSize;
  const lineH = size * d.lineHeight;
  const pad = size * 0.2;
  const ops = [];
  let y = pad;
  let number = 0;
  const textW = (p) => measure(p.text, size, p);
  const spaceW = (p) => measure(' ', size, p);

  for (const para of d.paragraphs) {
    number = para.list === 'number' ? number + 1 : 0;
    const indent = para.list ? size * 1.5 : 0;
    const room = Math.max(size, width - 2 * pad - indent);
    // Build lines of words.
    const lines = [];
    let line = [];
    let used = 0;
    for (const w of words(para.runs.length ? para.runs : [])) {
      const ww = w.reduce((s, p) => s + textW(p), 0);
      const gap = line.length ? spaceW(line[line.length - 1].at(-1)) : 0;
      if (line.length && used + gap + ww > room) {
        lines.push(line);
        line = [];
        used = 0;
      }
      if (!line.length && ww > room) {
        // A word longer than the line is cut between characters.
        let piece = [];
        let pw = 0;
        for (const p of w) {
          for (const ch of p.text) {
            const cw = measure(ch, size, p);
            if (pw + cw > room && piece.length) {
              lines.push([piece]);
              piece = [];
              pw = 0;
            }
            const last = piece[piece.length - 1];
            if (last && sameStyle(last, p)) piece[piece.length - 1] = { ...last, text: last.text + ch };
            else piece.push({ ...p, text: ch, space: false });
            pw += cw;
          }
        }
        if (piece.length) piece[piece.length - 1].space = !!w.at(-1).space;
        line = [piece];
        used = pw;
        continue;
      }
      used += gap + ww;
      line.push(w);
    }
    lines.push(line); // also an empty paragraph keeps its line

    lines.forEach((ws, li) => {
      const baseline = y + size * 0.8;
      if (li === 0 && para.list) {
        const marker = para.list === 'bullet' ? '•' : `${number}.`;
        const first = ws[0]?.[0] ?? { bold: false, italic: false, color: null };
        ops.push({ kind: 'text', text: marker, x: pad + indent - size * 0.35 - measure(marker, size, { bold: first.bold, italic: false }), y: baseline, size, bold: first.bold, italic: false, color: first.color ?? color });
      }
      const widths = ws.map((w) => w.reduce((s, p) => s + textW(p), 0));
      const gaps = ws.slice(0, -1).map((w) => spaceW(w.at(-1)));
      const natural = widths.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
      const last = li === lines.length - 1;
      let x = pad + indent;
      let extra = 0;
      if (para.align === 'center') x += (room - natural) / 2;
      else if (para.align === 'right') x += room - natural;
      else if (para.align === 'justify' && !last && gaps.length) extra = (room - natural) / gaps.length;
      ws.forEach((w, wi) => {
        for (const p of w) {
          const pw = textW(p);
          ops.push({ kind: 'text', text: p.text, x, y: baseline, size, bold: p.bold, italic: p.italic, color: p.color ?? color });
          if (p.underline) ops.push({ kind: 'path', points: [[x, baseline + size * 0.12], [x + pw, baseline + size * 0.12]], closed: false, stroke: p.color ?? color, width: Math.max(0.5, size * 0.06) });
          x += pw;
        }
        if (wi < gaps.length) {
          const g = gaps[wi] + extra;
          const tail = w.at(-1);
          if (tail.underline && ws[wi + 1]?.[0]?.underline) ops.push({ kind: 'path', points: [[x, baseline + size * 0.12], [x + g, baseline + size * 0.12]], closed: false, stroke: tail.color ?? color, width: Math.max(0.5, size * 0.06) });
          x += g;
        }
      });
      y += lineH;
    });
  }
  return { h: y + pad, ops };
}

// ---------- HTML for the editor (browser only) ----------

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// HTML for a contenteditable editor: one <div> per paragraph (bullets and numbers as data attributes).
export function richTextToHtml(data) {
  return sanitizeRichText(data).paragraphs.map((p) => {
    const inner = p.runs.map((r) => {
      let h = escapeHtml(r.text);
      if (r.bold) h = `<b>${h}</b>`;
      if (r.italic) h = `<i>${h}</i>`;
      if (r.underline) h = `<u>${h}</u>`;
      if (r.color) h = `<span style="color:${r.color}">${h}</span>`;
      return h;
    }).join('');
    const attrs = `style="text-align:${p.align}"${p.list ? ` data-list="${p.list}"` : ''}`;
    return `<div ${attrs}>${inner || '<br>'}</div>`;
  }).join('');
}

function cssColor(value) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value ?? '');
  if (m) return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  return HEX.test(value ?? '') ? value : null;
}

// Paragraphs read back from a contenteditable editor. Only text and the four character attributes
// survive; pasted markup, scripts and images are dropped.
export function richTextFromElement(root, { fontSize, lineHeight } = {}) {
  const paragraphs = [];
  let para = null;
  const startPara = (node) => {
    const block = node?.closest?.('[data-list], div, p, li') ?? null;
    para = {
      align: ALIGNS.includes(block?.style?.textAlign) ? block.style.textAlign : 'left',
      list: block?.dataset?.list ?? (block?.tagName === 'LI' ? (block.parentElement?.tagName === 'OL' ? 'number' : 'bullet') : null),
      runs: [],
    };
    paragraphs.push(para);
  };
  const walk = (node, style) => {
    if (node.nodeType === 3) {
      if (!para) startPara(node.parentElement);
      const text = node.nodeValue.replace(/\s+/g, ' ');
      if (text) para.runs.push({ ...style, text });
      return;
    }
    if (node.nodeType !== 1 || ['SCRIPT', 'STYLE', 'IMG', 'IFRAME', 'OBJECT'].includes(node.tagName)) return;
    const tag = node.tagName;
    if (tag === 'BR') {
      // A line break inside text starts a paragraph; the <br> that keeps an empty line open does not.
      if (!para) startPara(node.parentElement);
      else if (para.runs.length && node.nextSibling) startPara(node.parentElement);
      return;
    }
    const block = ['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag);
    if (block) startPara(node);
    const s = node.style;
    const next = {
      bold: style.bold || tag === 'B' || tag === 'STRONG' || /^(bold|[6-9]00)$/.test(s?.fontWeight ?? ''),
      italic: style.italic || tag === 'I' || tag === 'EM' || s?.fontStyle === 'italic',
      underline: style.underline || tag === 'U' || /underline/.test(s?.textDecoration ?? ''),
      color: cssColor(s?.color) ?? style.color,
    };
    for (const child of node.childNodes) walk(child, next);
    if (block) para = null;
  };
  for (const child of root.childNodes) walk(child, { bold: false, italic: false, underline: false, color: null });
  // Merge neighbouring runs of the same style, drop the empty paragraph a trailing <br> leaves.
  for (const p of paragraphs) {
    const merged = [];
    for (const r of p.runs) {
      const last = merged[merged.length - 1];
      if (last && sameStyle(last, r)) last.text += r.text;
      else merged.push({ ...r });
    }
    p.runs = merged;
  }
  while (paragraphs.length > 1 && !paragraphs.at(-1).runs.length) paragraphs.pop();
  return sanitizeRichText({ paragraphs, fontSize, lineHeight });
}
