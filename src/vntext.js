// Vietnamese text clean-up for OCR output, so recognized words search, export and compare like
// typed text (Unicode dựng sẵn, NFC).
//
// - NFC: "ê" + U+0301 becomes the single code point "ế". Typed queries are NFC, so search would miss
//   decomposed words otherwise; the deprecated tone marks U+0340/U+0341 fold to U+0300/U+0301 too.
// - Look-alikes: OCR sometimes reads "Đ/đ" as Icelandic eth "Ð/ð" (U+00D0/U+00F0) or African "Ɖ/ɖ".
// - Leftovers: zero-width characters, soft hyphens and combining marks that ended up on a
//   consonant, digit or punctuation (no Vietnamese letter carries those).

const LOOKALIKES = { Ð: 'Đ', ð: 'đ', Ɖ: 'Đ', ɖ: 'đ' };
const INVISIBLE = /[­​-‍⁠﻿]/g;
const COMBINING = /[̀-ͯ]/;
// Letters a Vietnamese tone or vowel mark can sit on, before composition (NFD base letters).
const MARKABLE = /[aeiouyAEIOUY]/;

export function normalizeVietnamese(text) {
  const clean = String(text ?? '')
    .replace(INVISIBLE, '')
    .replace(/[ÐðƉɖ]/g, (c) => LOOKALIKES[c])
    .normalize('NFD');
  let out = '';
  let base = '';
  for (const ch of clean) {
    if (COMBINING.test(ch)) {
      if (MARKABLE.test(base)) out += ch;
      continue;
    }
    base = ch;
    out += ch;
  }
  return out.normalize('NFC');
}

// The letters of `text` without tone and vowel marks, lower-cased: "Đồng Ý" → "dong y".
export function foldVietnamese(text) {
  return normalizeVietnamese(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi');
}
