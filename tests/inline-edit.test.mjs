import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInlineReplacement,
  clusterEditableLines,
  sampleBackgroundHex,
  sampleForegroundHex,
} from '../src/inline-edit.js';
import { RIBBON_TABS, ribbonCommandIds } from '../src/ribbon.js';

test('clusterEditableLines groups words on the same line and estimates font size', () => {
  const items = [
    { str: 'CỘNG', x: 120, y: 50, w: 36, h: 13.8 },
    { str: 'HÒA', x: 160, y: 50.2, w: 28, h: 13.8 },
    { str: 'XÃ HỘI', x: 192, y: 49.9, w: 46, h: 13.8 },
    { str: '   ', x: 300, y: 50, w: 10, h: 13.8 },
  ];
  const blocks = clusterEditableLines(items);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, 'CỘNG HÒA XÃ HỘI');
  assert.equal(blocks[0].x, 120);
  assert.equal(blocks[0].w, 118); // 238 - 120
  assert.equal(blocks[0].fontSize, 12); // 13.8 / 1.15 = 12
});

test('clusterEditableLines splits two table columns on the same horizontal row', () => {
  const items = [
    { str: 'Họ và tên:', x: 48, y: 120, w: 62, h: 13.8 },
    { str: 'Nguyễn Văn A', x: 115, y: 120, w: 80, h: 13.8 },
    // Cột thứ 2 cách xa > 26pt (x = 340, cách right=195 tới 145pt)
    { str: 'Mã NV:', x: 340, y: 120, w: 42, h: 13.8 },
    { str: 'NV-2026', x: 386, y: 120, w: 50, h: 13.8 },
  ];
  const blocks = clusterEditableLines(items);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, 'Họ và tên: Nguyễn Văn A');
  assert.equal(blocks[1].text, 'Mã NV: NV-2026');
  assert.ok(blocks[0].x + blocks[0].w < blocks[1].x);
});

test('sampleBackgroundHex and sampleForegroundHex extract paper tint and ink color accurately', () => {
  const W = 40;
  const H = 20;
  const rgba = new Uint8Array(W * H * 4);
  // Nền giấy kem (#fef3c7 -> 254, 243, 199)
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = 254;
    rgba[i * 4 + 1] = 243;
    rgba[i * 4 + 2] = 199;
    rgba[i * 4 + 3] = 255;
  }
  // Vẽ nét mực xanh đậm (#1e3a8a -> 30, 58, 138) bên trong vùng chữ (x: 8..30, y: 6..13)
  for (let y = 7; y <= 12; y++) {
    for (let x = 10; x <= 28; x += 2) {
      const idx = (y * W + x) * 4;
      rgba[idx] = 30;
      rgba[idx + 1] = 58;
      rgba[idx + 2] = 138;
      rgba[idx + 3] = 255;
    }
  }

  const rect = { x: 6, y: 5, w: 28, h: 10 };
  const bg = sampleBackgroundHex(rgba, W, H, rect);
  const fg = sampleForegroundHex(rgba, W, H, rect, bg);
  assert.equal(bg, '#fef3c7');
  assert.equal(fg, '#1e3a8a');
});

test('buildInlineReplacement returns null when unchanged, mask+box on edit, and mask-only on delete', () => {
  const block = { id: 'inl-1', text: 'Báo cáo quý I', x: 72, y: 100, w: 95, h: 16, fontSize: 14 };

  assert.equal(
    buildInlineReplacement({ page: 0, block, newText: '  Báo cáo quý I  ' }),
    null,
  );

  const edited = buildInlineReplacement({
    page: 2,
    block,
    newText: 'Báo cáo quý II - 2026',
    bgHex: '#f8fafc',
    fgHex: '#0f172a',
    markId: 'm9',
    boxId: 4,
  });
  assert.ok(edited);
  assert.equal(edited.maskMark.id, 'm9');
  assert.equal(edited.maskMark.type, 'rect');
  assert.equal(edited.maskMark.page, 2);
  assert.equal(edited.maskMark.fill, '#f8fafc');
  assert.equal(edited.maskMark.color, '#f8fafc');
  assert.equal(edited.maskMark.label, 'inline-mask');
  assert.ok(edited.textBox);
  assert.equal(edited.textBox.id, 4);
  assert.equal(edited.textBox.page, 2);
  assert.equal(edited.textBox.text, 'Báo cáo quý II - 2026');
  assert.equal(edited.textBox.color, '#0f172a');
  assert.equal(edited.textBox.fontSize, 14);

  const deleted = buildInlineReplacement({
    page: 2,
    block,
    newText: '   ',
    bgHex: '#ffffff',
  });
  assert.ok(deleted);
  assert.ok(deleted.maskMark);
  assert.equal(deleted.textBox, null);
});

test('Ribbon exposes editPdfText and all 5 office tools', () => {
  const allCmds = new Set(ribbonCommandIds(RIBBON_TABS));
  for (const cmd of [
    'tool:editPdfText',
    'tool:shape',
    'tool:connector',
    'tool:richtext',
    'insertTable',
    'insertFormula',
  ]) {
    assert.ok(allCmds.has(cmd), `Expected ${cmd} to be present on RIBBON_TABS`);
  }
});

