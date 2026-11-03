import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toBarcodeAscii,
  encodeCode128B,
  encodeQrMatrix,
  formatBatesItem,
  generateBatesPreviewList,
  computeStampPlacement,
  resolveCodeDynamicText,
} from '../src/stamping.js';

test('toBarcodeAscii folds Vietnamese diacritics to printable ASCII', () => {
  assert.equal(toBarcodeAscii('Hồ sơ ĐÃ DUYỆT #2026'), 'Ho so DA DUYET #2026');
  assert.equal(toBarcodeAscii('   HS-000123   '), 'HS-000123');
  assert.equal(toBarcodeAscii(''), '');
});

test('encodeCode128B generates valid ISO/IEC 15417 bitstreams and checksums', () => {
  const empty = encodeCode128B('   ');
  assert.equal(empty.valid, false);
  assert.ok(empty.error);

  const res = encodeCode128B('HS-2026');
  assert.equal(res.valid, true);
  assert.equal(res.text, 'HS-2026');
  assert.match(res.bits, /^0{10}11010010000/); // 10 quiet 0s + Start Code B (211214 -> 11010010000)
  assert.match(res.bits, /11000111010110{10}$/); // Stop pattern (2331112) + 10 quiet 0s
  // Total length = 10 (quiet) + 11 (start) + 7 * 11 (data) + 11 (checksum) + 13 (stop) + 10 (quiet) = 132
  assert.equal(res.bits.length, 132);
  assert.ok(res.checksum >= 0 && res.checksum < 103);
});

test('encodeQrMatrix builds valid ISO/IEC 18004 QR matrices with finder patterns', () => {
  const empty = encodeQrMatrix('');
  assert.equal(empty.valid, false);

  // Version 1 short string
  const v1 = encodeQrMatrix('HS-000001');
  assert.equal(v1.valid, true);
  assert.equal(v1.version, 1);
  assert.equal(v1.size, 21);
  assert.equal(v1.matrix.length, 21);

  // Top-left finder pattern center (3,3) and corners (0,0), (6,6) must be dark (1)
  assert.equal(v1.matrix[0][0], 1);
  assert.equal(v1.matrix[3][3], 1);
  assert.equal(v1.matrix[6][6], 1);
  // Top-right finder pattern center (3, size - 4)
  assert.equal(v1.matrix[3][21 - 4], 1);
  // Bottom-left finder pattern center (size - 4, 3)
  assert.equal(v1.matrix[21 - 4][3], 1);

  // Multi-block UTF-8 Vietnamese string (Version 6+)
  const longText = 'https://vetviral.com/verify?ho-so=Chứng-từ-kế-toán-số-2026-000123-đã-kiểm-duyệt-chính-thức-bởi-phòng-tài-chính';
  const vMulti = encodeQrMatrix(longText);
  assert.equal(vMulti.valid, true);
  assert.ok(vMulti.version >= 6);
  assert.equal(vMulti.size, 17 + vMulti.version * 4);

  // Too long string (> 274 bytes) returns graceful error
  const huge = encodeQrMatrix('A'.repeat(400));
  assert.equal(huge.valid, false);
  assert.ok(huge.error);
});

test('formatBatesItem and generateBatesPreviewList format sequential Bates numbers accurately', () => {
  assert.equal(formatBatesItem({ prefix: 'HS-', suffix: '/KT', start: 1, digits: 6, step: 1 }, 0), 'HS-000001/KT');
  assert.equal(formatBatesItem({ prefix: 'HS-', suffix: '/KT', start: 10, digits: 4, step: 5 }, 3), 'HS-0025/KT');

  const preview = generateBatesPreviewList({
    prefix: 'CT-',
    start: 100,
    digits: 5,
    skipFirst: true,
    pageStart: 1,
    template: '{bates} (Trang {page}/{total})',
  }, 4, 4);

  assert.equal(preview.length, 4);
  assert.equal(preview[0].skipped, true);
  assert.equal(preview[1].text, 'CT-00100 (Trang 1/3)');
  assert.equal(preview[2].text, 'CT-00101 (Trang 2/3)');
  assert.equal(preview[3].text, 'CT-00102 (Trang 3/3)');
});

test('computeStampPlacement and resolveCodeDynamicText calculate coordinates and tokens properly', () => {
  const page = { width: 600, height: 800 };
  const stamp = { width: 100, height: 50 };

  assert.deepEqual(computeStampPlacement(page, stamp, 'top-left', 20), { x: 20, y: 20, w: 100, h: 50 });
  assert.deepEqual(computeStampPlacement(page, stamp, 'bottom-right', 20), { x: 480, y: 730, w: 100, h: 50 });
  assert.deepEqual(computeStampPlacement(page, stamp, 'center', 20), { x: 250, y: 375, w: 100, h: 50 });
  assert.deepEqual(computeStampPlacement(page, stamp, 'bottom-center', 30), { x: 250, y: 720, w: 100, h: 50 });

  const resolved = resolveCodeDynamicText('Doc:{file}|P:{page}/{total}|D:{date}', {
    page: 2,
    total: 10,
    date: '28/10/2026',
    file: 'hop-dong.pdf',
  });
  assert.equal(resolved, 'Doc:hop-dong.pdf|P:2/10|D:28/10/2026');
});

