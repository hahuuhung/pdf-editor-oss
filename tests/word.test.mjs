import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countWordsAndChars,
  cleanWordHtml,
  extractTextRunsFromNode,
  parseTableMatrixFromHtml,
} from '../src/word-editor.js';

test('countWordsAndChars counts words, characters and paragraphs accurately', () => {
  const text1 = 'Cộng hòa xã hội chủ nghĩa Việt Nam\nĐộc lập - Tự do - Hạnh phúc';
  const r1 = countWordsAndChars(text1);
  assert.equal(r1.words, 16);
  assert.equal(r1.paragraphs, 2);
  assert.ok(r1.characters > 0);
  assert.ok(r1.charactersNoSpaces < r1.characters);

  // Empty string
  const r0 = countWordsAndChars('');
  assert.equal(r0.words, 0);
  assert.equal(r0.characters, 0);
  assert.equal(r0.paragraphs, 0);

  // Whitespace only
  const rw = countWordsAndChars('   \n\n  ');
  assert.equal(rw.words, 0);
  assert.equal(rw.characters, 7);
  assert.equal(rw.charactersNoSpaces, 0);
});

test('cleanWordHtml strips dangerous tags and normalizes markup', () => {
  const dirty = `
    <div>
      <script>alert('xss')</script>
      <h1 onclick="malicious()">Tiêu đề văn bản</h1>
      <p style="text-align: center;">Nội dung đoạn văn <strong onmouseover="bad()">in đậm</strong>.</p>
      <iframe src="evil.com"></iframe>
    </div>
  `;
  const cleaned = cleanWordHtml(dirty);
  assert.ok(!cleaned.includes('<script>'), 'Strips script tags');
  assert.ok(!cleaned.includes('<iframe'), 'Strips iframe tags');
  assert.ok(!cleaned.includes('onclick='), 'Strips event handlers');
  assert.ok(!cleaned.includes('onmouseover='), 'Strips event handlers');
  assert.ok(cleaned.includes('Tiêu đề văn bản'), 'Preserves safe text');
  assert.ok(cleaned.includes('<strong>'), 'Preserves safe markup');
});

test('extractTextRunsFromNode extracts styled runs from nested markup', () => {
  // Mock a simple DOM-like structure
  const node = {
    nodeType: 1,
    nodeName: 'P',
    childNodes: [
      { nodeType: 3, nodeValue: 'Văn bản ' },
      { nodeType: 1, nodeName: 'B', childNodes: [{ nodeType: 3, nodeValue: 'đậm ' }] },
      { nodeType: 1, nodeName: 'I', childNodes: [{ nodeType: 3, nodeValue: 'nghiêng' }] },
    ],
  };

  const runs = extractTextRunsFromNode(node);
  assert.equal(runs.length, 3);
  assert.equal(runs[0].text, 'Văn bản ');
  assert.equal(runs[0].bold, false);
  assert.equal(runs[1].text, 'đậm ');
  assert.equal(runs[1].bold, true);
  assert.equal(runs[2].text, 'nghiêng');
  assert.equal(runs[2].italic, true);
});

test('parseTableMatrixFromHtml extracts 2D table grid from HTML string', () => {
  const tableHtml = `
    <table>
      <tr><th>STT</th><th>Họ tên</th></tr>
      <tr><td>1</td><td>Nguyễn Văn A</td></tr>
      <tr><td>2</td><td>Trần Thị B</td></tr>
    </table>
  `;

  const matrix = parseTableMatrixFromHtml(tableHtml);
  assert.equal(matrix.length, 3, '3 rows');
  assert.equal(matrix[0].length, 2, '2 columns in header');
  assert.equal(matrix[0][0], 'STT');
  assert.equal(matrix[0][1], 'Họ tên');
  assert.equal(matrix[1][0], '1');
  assert.equal(matrix[1][1], 'Nguyễn Văn A');
  assert.equal(matrix[2][0], '2');
  assert.equal(matrix[2][1], 'Trần Thị B');
});
