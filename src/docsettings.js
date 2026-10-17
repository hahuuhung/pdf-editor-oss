// Document-wide settings applied on export: watermark, header/footer with Bates numbering, and
// document properties. Pure functions; the exporter and the page preview both use them.

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function num(v, lo, hi, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function str(v, max = 500) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

export const HEADER_FOOTER_SLOTS = ['headerLeft', 'headerCenter', 'headerRight', 'footerLeft', 'footerCenter', 'footerRight'];

// A watermark without text is no watermark.
export function sanitizeWatermark(w) {
  if (!w || !str(w.text).trim()) return null;
  return {
    text: str(w.text, 200),
    fontSize: num(w.fontSize, 8, 200, 60),
    color: HEX_COLOR.test(w.color ?? '') ? w.color.toLowerCase() : '#888888',
    opacity: num(w.opacity, 0.05, 1, 0.25),
    angle: num(w.angle, -90, 90, 45),
  };
}

// A header/footer with every slot empty is no header/footer.
export function sanitizeHeaderFooter(h) {
  if (!h) return null;
  const out = {
    fontSize: num(h.fontSize, 6, 36, 10),
    color: HEX_COLOR.test(h.color ?? '') ? h.color.toLowerCase() : '#000000',
    margin: num(h.margin, 6, 144, 24),
    batesPrefix: str(h.batesPrefix, 40),
    batesStart: Math.floor(num(h.batesStart, 0, 1e9, 1)),
    batesDigits: Math.floor(num(h.batesDigits, 1, 12, 6)),
    pageStart: Math.floor(num(h.pageStart, 0, 1e6, 1)),
    skipFirst: h.skipFirst === true,
  };
  for (const slot of HEADER_FOOTER_SLOTS) out[slot] = str(h[slot], 200);
  return HEADER_FOOTER_SLOTS.some((s) => out[s].trim()) ? out : null;
}

// Token values for the header/footer of page `index` (0-based) of `total`, or null when the page
// gets none (the cover page with `skipFirst`). Numbering starts at `pageStart` on the first page
// that carries a header/footer, and {total} is the last number. Bates numbers count every page.
export function headerFooterContext(hf, index, total, base = {}) {
  const first = hf.skipFirst ? 1 : 0;
  if (index < first) return null;
  const start = hf.pageStart ?? 1;
  return {
    ...base,
    page: start + index - first,
    total: start + total - first - 1,
    bates: batesLabel(hf.batesPrefix, hf.batesStart, hf.batesDigits, index),
  };
}

export function sanitizeMeta(m) {
  if (!m) return null;
  return { title: str(m.title), author: str(m.author), subject: str(m.subject), keywords: str(m.keywords) };
}

// Bates number for the page at 0-based `index`, e.g. ("ABC", 1, 6, 0) -> "ABC000001".
export function batesLabel(prefix, start, digits, index) {
  const n = Math.max(0, Math.floor(Number(start) || 0)) + index;
  return `${prefix ?? ''}${String(n).padStart(Math.min(12, Math.max(1, digits | 0)), '0')}`;
}

// Replaces {page} {total} {date} {file} {bates} in a header/footer template.
export function formatTokens(template, ctx) {
  return String(template ?? '').replace(/\{(page|total|date|file|bates)\}/g, (_, key) => String(ctx[key] ?? ''));
}

export function todayLabel(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}
