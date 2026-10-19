// Office tools on the page: Draw shapes and connectors, Math formulas, Calc tables and Writer rich
// text boxes (ported from Apache OpenOffice, see the modules next to this one).
//
// They are marks like the others (marks.js), with their own fields in `m.data`. Every one is laid
// out into drawing ops: { kind: 'path', points, closed, fill, stroke, width } and
// { kind: 'text', text, x, y (baseline), size, bold, italic, color } in page points. The same ops are
// drawn on screen (SVG) and written into the PDF, so the export matches what is shown.

import { SHAPE_IDS, arrowHead, routeConnector, shapeOutline } from './shapes.js';
import { layoutFormula } from './math.js';
import { layoutTable, sanitizeTable } from './table.js';
import { layoutRichText, plainText, sanitizeRichText } from './richtext.js';

export const OFFICE_TYPES = new Set(['shape', 'connector', 'formula', 'table', 'richtext']);
export const OFFICE_RESIZABLE = ['shape', 'formula', 'table', 'richtext'];
export const CONNECTOR_STYLES = ['elbow', 'straight'];

function sanitizeGlue(g) {
  return g && typeof g.id === 'string' && ['top', 'right', 'bottom', 'left'].includes(g.site) ? { id: g.id, site: g.site } : null;
}

// Valid `data` for an office mark of `type`.
export function sanitizeOfficeData(type, data = {}) {
  const d = data ?? {};
  switch (type) {
    case 'shape':
      return { preset: SHAPE_IDS.includes(d.preset) ? d.preset : 'rect' };
    case 'connector':
      return {
        style: CONNECTOR_STYLES.includes(d.style) ? d.style : 'elbow',
        arrowStart: !!d.arrowStart,
        arrowEnd: d.arrowEnd !== false,
        from: sanitizeGlue(d.from),
        to: sanitizeGlue(d.to),
      };
    case 'formula':
      return { src: String(d.src ?? '').slice(0, 4000), size: Math.min(96, Math.max(6, Number(d.size) || 16)) };
    case 'table':
      return sanitizeTable(d);
    case 'richtext':
      return sanitizeRichText(d);
    default:
      return null;
  }
}

const shift = (ops, dx, dy, k = 1) =>
  ops.map((op) => (op.kind === 'text'
    ? { ...op, x: dx + op.x * k, y: dy + op.y * k, size: op.size * k }
    : { ...op, points: op.points.map(([x, y]) => [dx + x * k, dy + y * k]), width: op.width === undefined ? undefined : op.width * k }));

// Drawing ops of an office mark, in page points. Throws a FormulaError for a formula that does not parse.
export function officeOps(m, measure) {
  const color = m.color ?? '#000000';
  switch (m.type) {
    case 'shape': {
      const points = shapeOutline(m.data?.preset, m.x, m.y, m.w, m.h);
      return [{ kind: 'path', points, closed: true, fill: m.fill, stroke: color, width: m.width, opacity: m.opacity }];
    }
    case 'connector': {
      if (m.points.length < 2) return [];
      const ops = [{ kind: 'path', points: m.points, closed: false, stroke: color, width: m.width, opacity: m.opacity }];
      const head = Math.max(6, m.width * 4);
      if (m.data?.arrowEnd !== false) ops.push({ kind: 'path', points: arrowHead(m.points, head), closed: true, fill: color, stroke: color, width: m.width, opacity: m.opacity });
      if (m.data?.arrowStart) ops.push({ kind: 'path', points: arrowHead([...m.points].reverse(), head), closed: true, fill: color, stroke: color, width: m.width, opacity: m.opacity });
      return ops;
    }
    case 'formula': {
      const f = layoutFormula(m.data.src, { size: m.data.size, color, measure });
      return shift(f.ops, m.x, m.y);
    }
    case 'table':
      return shift(layoutTable(m.data, { color, measure }).ops, m.x, m.y);
    case 'richtext':
      return shift(layoutRichText(m.data, m.w, { color, measure }).ops, m.x, m.y);
    default:
      return [];
  }
}

// The mark with its box fitted to its content: formulas and tables take their natural size, a
// rich text box keeps its width and grows to its text.
export function fitOffice(m, measure) {
  switch (m.type) {
    case 'formula': {
      const f = layoutFormula(m.data.src, { size: m.data.size, color: m.color, measure });
      return { ...m, w: f.w, h: f.h };
    }
    case 'table': {
      const t = sanitizeTable(m.data);
      return { ...m, data: t, w: t.colW.reduce((a, b) => a + b, 0), h: t.rowH.reduce((a, b) => a + b, 0) };
    }
    case 'richtext':
      return { ...m, h: Math.max(m.data.fontSize * 1.6, layoutRichText(m.data, m.w, { measure }).h) };
    default:
      return m;
  }
}

// The mark resized to about w × h: a formula scales its font, a table its columns and rows, a rich
// text box rewraps to the new width; other marks simply take the new box.
export function resizeOffice(m, w, h, measure) {
  switch (m.type) {
    case 'formula': {
      const k = Math.max(4, w) / Math.max(1, m.w);
      return fitOffice({ ...m, data: { ...m.data, size: Math.min(96, Math.max(6, m.data.size * k)) } }, measure);
    }
    case 'table': {
      const kx = Math.max(16, w) / Math.max(1, m.w);
      const ky = Math.max(8, h) / Math.max(1, m.h);
      const data = sanitizeTable({ ...m.data, colW: m.data.colW.map((v) => v * kx), rowH: m.data.rowH.map((v) => v * ky) });
      return fitOffice({ ...m, data }, measure);
    }
    case 'richtext':
      return fitOffice({ ...m, w: Math.max(m.data.fontSize * 3, w) }, measure);
    default:
      return { ...m, w: Math.max(4, w), h: Math.max(4, h) };
  }
}

// Text the mark writes, to choose a font that has its letters.
export function officeTexts(m) {
  if (m.type === 'formula') return [m.data?.src ?? ''];
  if (m.type === 'table') return (m.data?.cells ?? []).flat();
  if (m.type === 'richtext') return [plainText(m.data)];
  return [];
}

// Font variants the mark uses (regular is always available).
export function officeVariants(m) {
  const out = new Set();
  if (m.type === 'table' && m.data?.header) out.add('bold');
  if (m.type === 'richtext') for (const p of m.data?.paragraphs ?? []) for (const r of p.runs) if (r.bold || r.italic) out.add(r.bold ? (r.italic ? 'boldItalic' : 'bold') : 'italic');
  if (m.type === 'formula') {
    out.add('italic');
    if (/\bbold\b/.test(m.data?.src ?? '')) out.add('bold').add('boldItalic');
  }
  return [...out];
}

// A new connector between two points, routed by its style.
export function connectorPoints(a, b, data) {
  return routeConnector(a, b, { style: data?.style, fromSite: data?.from?.site, toSite: data?.to?.site });
}

// ---------- drawing ----------

const SVG_NS = 'http://www.w3.org/2000/svg';

// SVG elements for ops (browser only). Text uses the same font family the measurer loaded.
export function opsToSvg(ops, fontFamily) {
  const g = document.createElementNS(SVG_NS, 'g');
  for (const op of ops) {
    let node;
    if (op.kind === 'text') {
      node = document.createElementNS(SVG_NS, 'text');
      node.setAttribute('x', op.x);
      node.setAttribute('y', op.y);
      node.setAttribute('font-size', op.size);
      node.setAttribute('font-family', fontFamily);
      if (op.bold) node.setAttribute('font-weight', 'bold');
      if (op.italic) node.setAttribute('font-style', 'italic');
      node.setAttribute('fill', op.color ?? '#000');
      node.setAttribute('xml:space', 'preserve');
      node.textContent = op.text;
    } else {
      node = document.createElementNS(SVG_NS, op.closed ? 'polygon' : 'polyline');
      node.setAttribute('points', op.points.map((p) => p.join(',')).join(' '));
      node.setAttribute('fill', op.closed && op.fill ? op.fill : 'none');
      node.setAttribute('stroke', op.stroke ?? 'none');
      node.setAttribute('stroke-width', op.width ?? 1);
      node.setAttribute('stroke-linejoin', 'round');
      node.setAttribute('stroke-linecap', 'round');
    }
    if (op.opacity !== undefined && op.opacity < 1) node.setAttribute('opacity', op.opacity);
    g.append(node);
  }
  return g;
}

function hexToRgb(hex) {
  const n = parseInt(String(hex ?? '#000000').slice(1), 16) || 0;
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Writes ops into a PDF page. `pc` is export.js's page context (view→PDF mapping); `fonts` maps
// 'regular' | 'bold' | 'italic' | 'boldItalic' to embedded fonts; `encode(text, font)` returns text
// the font can write.
export function drawOpsPdf(pc, ops, fonts, encode = (t) => t) {
  for (const op of ops) {
    if (op.kind === 'text') {
      const variant = op.bold ? (op.italic ? 'boldItalic' : 'bold') : op.italic ? 'italic' : 'regular';
      const font = fonts[variant] ?? fonts.regular;
      const p = pc.pt(op.x, op.y);
      pc.page.drawText(encode(op.text, font), { x: p.x, y: p.y, size: op.size, font, color: hexToRgb(op.color), opacity: op.opacity ?? 1, rotate: PDFLib.degrees(pc.rotation) });
      continue;
    }
    if (op.points.length < 2) continue;
    // drawSvgPath flips y; feeding it PDF coordinates with y negated draws them where they belong.
    const d = op.points.map((pt, i) => {
      const q = pc.pt(pt[0], pt[1]);
      return `${i ? 'L' : 'M'}${q.x} ${-q.y}`;
    }).join(' ') + (op.closed ? ' Z' : '');
    pc.page.drawSvgPath(d, {
      x: 0,
      y: 0,
      ...(op.closed && op.fill ? { color: hexToRgb(op.fill), opacity: op.opacity ?? 1 } : {}),
      ...(op.stroke ? { borderColor: hexToRgb(op.stroke), borderWidth: op.width ?? 1, borderOpacity: op.opacity ?? 1, borderLineCap: PDFLib.LineCapStyle.Round } : { borderWidth: 0 }),
    });
  }
}
