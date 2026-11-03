import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pdfToView,
  rectPdfToView,
  rectViewToPdf,
  viewToPdf,
} from '../src/geometry.js';
import {
  detectCandidateFields,
  nextCustomFieldId,
  sanitizeCustomField,
  slugifyFieldName,
  sortWidgetsForTabOrder,
  uniqueFieldName,
} from '../src/form-builder.js';

test('pdfToView and rectPdfToView invert viewToPdf and rectViewToPdf for all quarter-turn rotations', () => {
  const box = { x: 18, y: 24, width: 595, height: 842 };
  for (const rot of [0, 90, 180, 270]) {
    const [px, py] = viewToPdf(rot, box, 125.5, 310.25);
    const [vx, vy] = pdfToView(rot, box, px, py);
    assert.ok(Math.abs(vx - 125.5) < 1e-9, `rot=${rot} vx`);
    assert.ok(Math.abs(vy - 310.25) < 1e-9, `rot=${rot} vy`);

    const pdfRect = rectViewToPdf(rot, box, 80, 140, 160, 24);
    const viewRect = rectPdfToView(rot, box, pdfRect.x, pdfRect.y, pdfRect.width, pdfRect.height);
    assert.ok(Math.abs(viewRect.x - 80) < 1e-9);
    assert.ok(Math.abs(viewRect.y - 140) < 1e-9);
    assert.ok(Math.abs(viewRect.w - 160) < 1e-9);
    assert.ok(Math.abs(viewRect.h - 24) < 1e-9);
  }
});

test('slugifyFieldName and uniqueFieldName normalize Vietnamese labels and prevent collisions', () => {
  assert.equal(slugifyFieldName('Họ và tên người nộp:'), 'ho_va_ten_nguoi_nop');
  assert.equal(slugifyFieldName('   ---   ', 'mac_dinh'), 'mac_dinh');
  assert.equal(uniqueFieldName('Họ và tên', ['ho_va_ten', 'ho_va_ten_2']), 'ho_va_ten_3');
  assert.equal(uniqueFieldName('gioi_tinh', ['gioi_tinh'], { allowExisting: true }), 'gioi_tinh');
});

test('sanitizeCustomField validates types, options, dimensions and radio values', () => {
  const dropdown = sanitizeCustomField({
    id: 'cf3',
    name: 'Phòng ban',
    kind: 'choice',
    page: 1,
    x: 100,
    y: 200,
    w: 4,
    h: 5,
    options: 'Kế toán, Nhân sự\nKỹ thuật, Kế toán',
    fontSize: 99,
  });
  assert.equal(dropdown.name, 'phong_ban');
  assert.deepEqual(dropdown.options, ['Kế toán', 'Nhân sự', 'Kỹ thuật']);
  assert.equal(dropdown.w, 10);
  assert.equal(dropdown.h, 10);
  assert.equal(dropdown.fontSize, 36);

  const radio = sanitizeCustomField({ kind: 'radio', name: 'gioi_tinh', optionValue: 'nu' }, 2);
  assert.equal(radio.optionValue, 'nu');
  assert.equal(nextCustomFieldId([{ id: 'cf1' }, { id: 'cf7' }]), 'cf8');
});

test('sortWidgetsForTabOrder orders widgets top-to-bottom with horizontal row tolerance', () => {
  const sorted = sortWidgetsForTabOrder([
    { id: 'c', page: 0, x: 300, y: 102 },
    { id: 'a', page: 0, x: 60, y: 100 },
    { id: 'd', page: 0, x: 60, y: 145 },
    { id: 'e', page: 1, x: 20, y: 30 },
  ]);
  assert.deepEqual(sorted.map((w) => w.id), ['a', 'c', 'd', 'e']);
});

test('detectCandidateFields detects dotted lines and checkboxes while skipping occupied areas', () => {
  const textItems = [
    { str: 'Họ và tên:', x: 50, y: 80, w: 60, h: 13 },
    { str: '...........................', x: 114, y: 80, w: 180, h: 13 },
    { str: '☐ Đồng ý điều khoản', x: 50, y: 120, w: 130, h: 14 },
    { str: 'Địa chỉ: ___________________', x: 50, y: 160, w: 220, h: 13 },
  ];
  // Giả lập vùng Địa chỉ ở y=160 đã có sẵn 1 trường AcroForm
  const existing = [{ x: 100, y: 155, w: 170, h: 22 }];

  const candidates = detectCandidateFields(textItems, existing, { page: 0, existingNames: ['ho_va_ten'] });
  assert.equal(candidates.length, 2);

  const textCand = candidates.find((c) => c.kind === 'text');
  const checkCand = candidates.find((c) => c.kind === 'check');
  assert.ok(textCand);
  assert.equal(textCand.name, 'ho_va_ten_2');
  assert.ok(textCand.x >= 100 && textCand.w >= 120);

  assert.ok(checkCand);
  assert.equal(checkCand.name, 'dong_y_dieu_khoan');
});

