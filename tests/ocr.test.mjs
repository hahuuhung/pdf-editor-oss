import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OCR_DPI, OCR_LANGUAGES, ocrScale, wordsFromTesseract } from '../src/ocr.js';
import { foldVietnamese, normalizeVietnamese } from '../src/vntext.js';

test('normalizeVietnamese composes decomposed letters into NFC (Unicode dựng sẵn)', () => {
  const decomposed = 'Hợp đồng'.normalize('NFD');
  assert.notEqual(decomposed, 'Hợp đồng');
  assert.equal(normalizeVietnamese(decomposed), 'Hợp đồng');
  assert.equal(normalizeVietnamese('ế'), 'ế');
  assert.equal(normalizeVietnamese('á'), 'á'); // deprecated combining acute tone mark
});

test('normalizeVietnamese maps eth and African D look-alikes to Đ/đ', () => {
  assert.equal(normalizeVietnamese('ÐỒNG'), 'ĐỒNG');
  assert.equal(normalizeVietnamese('ðiều'), 'điều');
  assert.equal(normalizeVietnamese('Ɖức ɖi'), 'Đức đi');
});

test('normalizeVietnamese drops invisible characters and marks stranded on non-vowels', () => {
  assert.equal(normalizeVietnamese('Việt​Nam­'), 'ViệtNam');
  assert.equal(normalizeVietnamese('ńgày'), 'ngày');
  assert.equal(normalizeVietnamese('12̀,5'), '12,5');
  assert.equal(normalizeVietnamese('́ma'), 'ma');
  assert.equal(normalizeVietnamese('ừ'), 'ừ');
  assert.equal(normalizeVietnamese(null), '');
});

test('normalizeVietnamese leaves correct text unchanged', () => {
  const text = 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM — khuỷu tay, nguệch ngoạc, thuở ấy, 75,5 m²';
  assert.equal(normalizeVietnamese(text), text);
});

test('foldVietnamese removes tone and vowel marks for loose comparison', () => {
  assert.equal(foldVietnamese('Đồng Ý'), 'dong y');
  assert.equal(foldVietnamese('Thủy'.normalize('NFD')), 'thuy');
});

test('Vietnamese is the default OCR language', () => {
  assert.equal(OCR_LANGUAGES[0].id, 'vie');
  assert.ok(OCR_LANGUAGES.some((l) => l.id === 'vie+eng'));
});

test('ocrScale renders at 300 DPI and caps very large pages', () => {
  assert.equal(OCR_DPI, 300);
  assert.equal(ocrScale(595, 842), 300 / 72); // A4
  const s = ocrScale(2384, 3370); // A0
  assert.ok(s < 300 / 72);
  assert.ok(Math.abs(2384 * 3370 * s * s - 24e6) < 1);
  assert.equal(ocrScale(595, 842, 150), 150 / 72);
});

test('wordsFromTesseract normalizes Vietnamese word text', () => {
  const data = { blocks: [{ paragraphs: [{ lines: [{ words: [
    { text: 'ÐỒNG'.normalize('NFD'), bbox: { x0: 0, y0: 0, x1: 30, y1: 10 }, confidence: 88 },
    { text: '​', bbox: { x0: 40, y0: 0, x1: 42, y1: 10 }, confidence: 90 },
  ] }] }] }] };
  assert.deepEqual(wordsFromTesseract(data, 1), [{ text: 'ĐỒNG', x: 0, y: 0, w: 30, h: 10, confidence: 88 }]);
});
