import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, groupLines, pagesToHtml, pagesToText, stripDiacritics } from '../src/textlayout.js';
import { compressArgs, decryptArgs, encryptArgs, qpdfErrorMessage } from '../src/protect.js';
import { wordsFromTesseract } from '../src/ocr.js';

test('groupLines orders runs into lines and inserts spaces only at visible gaps', () => {
  const items = [
    { str: 'world', x: 60, y: 10, w: 30, h: 10 },
    { str: 'Second line', x: 10, y: 30, w: 80, h: 10 },
    { str: 'Hello', x: 10, y: 11, w: 30, h: 10 },
    { str: 'tail', x: 40, y: 10.5, w: 18, h: 10 }, // touches "Hello": no space
    { str: '   ', x: 0, y: 50, w: 5, h: 10 },
  ];
  assert.deepEqual(groupLines(items), ['Hellotail world', 'Second line']);
});

test('groupLines also accepts OCR words with a text field', () => {
  const words = [
    { text: 'Việt', x: 50, y: 100, w: 30, h: 12 },
    { text: 'Xin', x: 0, y: 101, w: 20, h: 12 },
    { text: 'chào', x: 24, y: 99, w: 22, h: 12 },
  ];
  assert.deepEqual(groupLines(words), ['Xin chào Việt']);
});

test('stripDiacritics keeps Vietnamese readable in basic Latin', () => {
  assert.equal(stripDiacritics('Đường phố Hà Nội đẹp'), 'Duong pho Ha Noi dep');
});

test('pagesToText and pagesToHtml mark pages and escape markup', () => {
  assert.equal(pagesToText([['a', 'b'], []]), '--- Trang 1 ---\na\nb\n\n--- Trang 2 ---\n\n');
  const html = pagesToHtml('Hợp đồng <1>', [['x < y & z']]);
  assert.match(html, /<title>Hợp đồng &lt;1&gt;<\/title>/);
  assert.match(html, /<p>x &lt; y &amp; z<\/p>/);
  assert.equal(escapeHtml(`"'`), '&quot;&#39;');
});

test('encryptArgs builds an AES-256 QPDF command with permissions', () => {
  const args = encryptArgs({ userPassword: 'mo', ownerPassword: 'chu', allowPrint: false, allowCopy: true, allowModify: false });
  assert.deepEqual(args, ['/in.pdf', '--encrypt', 'mo', 'chu', '256', '--print=none', '--extract=y', '--modify=none', '--', '/out.pdf']);
});

test('encryptArgs never leaves the owner password empty', () => {
  const owner = encryptArgs({ userPassword: '' })[3];
  assert.ok(owner.length >= 32);
  assert.notEqual(owner, encryptArgs({ userPassword: '' })[3]);
});

test('decrypt and compress commands', () => {
  assert.deepEqual(decryptArgs('p@ss word'), ['--password=p@ss word', '--decrypt', '/in.pdf', '/out.pdf']);
  assert.ok(compressArgs().includes('--object-streams=generate'));
  assert.equal(compressArgs().at(-1), '/out.pdf');
});

test('qpdfErrorMessage explains wrong passwords and falls back to the last log line', () => {
  assert.equal(qpdfErrorMessage('qpdf: /in.pdf: invalid password'), 'Mật khẩu không đúng.');
  assert.equal(qpdfErrorMessage('warning\nqpdf: something broke'), 'QPDF báo lỗi: qpdf: something broke');
  assert.equal(qpdfErrorMessage(''), 'QPDF không xử lý được tệp này.');
});

test('wordsFromTesseract reads the blocks tree, scales to view space and drops low confidence', () => {
  const data = {
    blocks: [{ paragraphs: [{ lines: [{ words: [
      { text: 'Xin', bbox: { x0: 25, y0: 50, x1: 75, y1: 80 }, confidence: 91 },
      { text: '??', bbox: { x0: 80, y0: 50, x1: 90, y1: 80 }, confidence: 12 },
      { text: ' ', bbox: { x0: 95, y0: 50, x1: 99, y1: 80 }, confidence: 99 },
    ] }] }] }],
  };
  assert.deepEqual(wordsFromTesseract(data, 2.5), [{ text: 'Xin', x: 10, y: 20, w: 20, h: 12, confidence: 91 }]);
  assert.equal(wordsFromTesseract({ words: [{ text: 'A', bbox: { x0: 0, y0: 0, x1: 5, y1: 5 }, confidence: 80 }] }, 1).length, 1);
  assert.deepEqual(wordsFromTesseract(null, 1), []);
});
