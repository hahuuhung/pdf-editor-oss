// Text measuring for the office tools, in the same font the PDF export writes (DejaVu Sans from
// fonts.js), so what is laid out on screen matches the exported file. Browser only.

import { FONT_VARIANTS, loadUnicodeFont } from '../fonts.js';
import { officeTexts, officeVariants } from './index.js';

export const OFFICE_FONT = 'PdfEditorSans';
const FALLBACK = 'Verdana, "DejaVu Sans", sans-serif'; // close metrics while the font loads
const STYLE = {
  regular: { weight: 'normal', style: 'normal' },
  bold: { weight: 'bold', style: 'normal' },
  italic: { weight: 'normal', style: 'italic' },
  boldItalic: { weight: 'bold', style: 'italic' },
};

let ready = false;
let loading = null;
const ctx = document.createElement('canvas').getContext('2d');
const cache = new Map();

// Loads the four font variants once. Resolves to true when they are in use.
export function loadOfficeFonts() {
  loading ??= Promise.all(FONT_VARIANTS.map(async (variant) => {
    const face = new FontFace(OFFICE_FONT, await loadUnicodeFont(variant), STYLE[variant]);
    document.fonts.add(await face.load());
  })).then(() => {
    ready = true;
    cache.clear();
    return true;
  }).catch((err) => {
    loading = null;
    console.warn('Office fonts', err);
    return false;
  });
  return loading;
}

export const officeFontFamily = () => (ready ? `${OFFICE_FONT}, ${FALLBACK}` : FALLBACK);

// Width of `text` at `size` points in the office font.
export function measure(text, size, style = {}) {
  const key = `${style.bold ? 1 : 0}${style.italic ? 1 : 0}${size}|${text}`;
  let w = cache.get(key);
  if (w === undefined) {
    ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${size}px ${ready ? OFFICE_FONT : FALLBACK}`;
    w = ctx.measureText(text).width;
    if (cache.size > 20000) cache.clear();
    cache.set(key, w);
  }
  return w;
}

// Font bytes for exporting office marks: { regular, bold, italic, boldItalic } with the variants
// the marks use, or null when no office mark writes text.
export async function officeFontBytes(marks) {
  const texts = marks.flatMap(officeTexts).filter((t) => String(t).trim());
  if (!texts.length) return null;
  const variants = new Set(['regular', ...marks.flatMap(officeVariants)]);
  const out = {};
  for (const v of variants) out[v] = await loadUnicodeFont(v);
  return out;
}
