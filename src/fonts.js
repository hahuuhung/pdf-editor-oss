// Unicode font for text the standard PDF fonts cannot write. pdf-lib's Helvetica uses WinAnsi
// encoding (Latin-1 plus a few symbols), which has no ă, đ, ơ, ư and none of the Vietnamese letters
// with stacked tone marks. When the text needs more, a Unicode TrueType font is fetched once per
// session. Only the font is downloaded; no document data leaves the browser.

import { LIB_URLS } from './libs.js';
import { stripDiacritics } from './textlayout.js';

// WinAnsi characters outside ASCII and Latin-1: € ‚ ƒ „ … † ‡ ˆ ‰ Š ‹ Œ Ž ‘ ’ “ ” • – — ˜ ™ š › œ ž Ÿ
const WINANSI_EXTRA = new Set(
  '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ',
);

// Whether Helvetica can write `ch`. Line breaks count, since pdf-lib splits lines before encoding.
export function isWinAnsi(ch) {
  const c = ch.codePointAt(0);
  return c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch);
}

export function needsUnicodeFont(texts) {
  for (const t of texts) for (const ch of String(t ?? '')) if (!isWinAnsi(ch)) return true;
  return false;
}

// Text that Helvetica can write: missing accents are dropped ("Hợp đồng" -> "Hop dong"), tabs become
// spaces and anything else unsupported becomes "?".
export function toWinAnsi(text) {
  let out = '';
  for (const ch of String(text ?? '')) {
    if (isWinAnsi(ch)) out += ch;
    else if (ch === '\t') out += ' ';
    else for (const c of stripDiacritics(ch)) out += isWinAnsi(c) ? c : '?';
  }
  return out;
}

export const FONT_VARIANTS = ['regular', 'bold', 'italic', 'boldItalic'];

// The variant of a styled run { bold, italic }.
export function fontVariant(style) {
  return style?.bold ? (style.italic ? 'boldItalic' : 'bold') : style?.italic ? 'italic' : 'regular';
}

const FONT_URLS = {
  regular: LIB_URLS.unicodeFont,
  bold: LIB_URLS.unicodeFontBold,
  italic: LIB_URLS.unicodeFontItalic,
  boldItalic: LIB_URLS.unicodeFontBoldItalic,
};
const fontPromises = new Map();

// Bytes of a variant of the default Unicode font (DejaVu Sans), fetched on first use and kept for the session.
export function loadUnicodeFont(variant = 'regular') {
  if (!fontPromises.has(variant)) {
    const url = FONT_URLS[variant] ?? FONT_URLS.regular;
    fontPromises.set(
      variant,
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((b) => new Uint8Array(b))
        .catch((err) => {
          fontPromises.delete(variant);
          throw new Error(`Không tải được font tiếng Việt (${err.message}). Hãy kiểm tra mạng, hoặc chọn font .ttf tại Tệp › Chọn font.`);
        }),
    );
  }
  return fontPromises.get(variant);
}
