import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAPE_IDS, gluePoint, nearestGlue, rerouteConnectors, routeConnector, shapeOutline } from '../src/office/shapes.js';
import { FormulaError, layoutFormula, parseFormula, toLatex, tokenize } from '../src/office/math.js';
import { columnName, evaluateTable, layoutTable, newTable, parseRef, sanitizeTable, toNumber } from '../src/office/table.js';
import { layoutRichText, plainText, sanitizeRichText } from '../src/office/richtext.js';
import { fitOffice, officeOps, resizeOffice, sanitizeOfficeData } from '../src/office/index.js';

// Every character is half the font size wide (bold a little wider), like a monospaced font.
const measure = (text, size, style = {}) => [...String(text)].length * size * (style.bold ? 0.55 : 0.5);

test('every shape preset gives a closed outline inside its box', () => {
  for (const id of SHAPE_IDS) {
    const pts = shapeOutline(id, 10, 20, 100, 50);
    assert.ok(pts.length >= 3, id);
    for (const [x, y] of pts) {
      assert.ok(x >= 10 - 1e-6 && x <= 110 + 1e-6 && y >= 20 - 1e-6 && y <= 70 + 1e-6, `${id} ${x},${y}`);
    }
  }
  // OpenOffice's star: the top point is centred.
  assert.ok(Math.abs(shapeOutline('star5', 0, 0, 216, 216)[0][0] - 107.97) < 0.01);
});

test('glue points sit on the box sides and the nearest one is found within reach', () => {
  const box = { x: 0, y: 0, w: 100, h: 40 };
  assert.deepEqual(gluePoint(box, 'right'), [100, 20]);
  assert.equal(nearestGlue(box, [98, 22], 10).site, 'right');
  assert.equal(nearestGlue(box, [50, 20], 10), null);
});

test('elbow connectors bend at right angles between glue sites', () => {
  const pts = routeConnector([0, 0], [100, 50], { style: 'elbow', fromSite: 'right', toSite: 'left' });
  assert.deepEqual(pts[0], [0, 0]);
  assert.deepEqual(pts.at(-1), [100, 50]);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] === pts[i - 1][0] || pts[i][1] === pts[i - 1][1], 'axis-aligned segment');
  assert.deepEqual(routeConnector([0, 0], [10, 10], { style: 'straight' }), [[0, 0], [10, 10]]);
});

test('glued connectors follow their shapes and unglue when a shape is gone', () => {
  const shape = { id: 'm1', type: 'shape', page: 0, x: 0, y: 0, w: 100, h: 40 };
  const conn = { id: 'm2', type: 'connector', page: 0, points: [[100, 20], [200, 20]], data: { style: 'straight', from: { id: 'm1', site: 'right' }, to: null } };
  const boxes = { m1: { x: 50, y: 0, w: 100, h: 40 } };
  const moved = rerouteConnectors([shape, conn], (id) => boxes[id] ?? null);
  assert.deepEqual(moved[1].points, [[150, 20], [200, 20]]);
  assert.equal(rerouteConnectors(moved, (id) => boxes[id] ?? null), moved, 'nothing changes the second time');
  const gone = rerouteConnectors([conn], () => null);
  assert.equal(gone[0].data.from, null);
});

test('the formula parser follows OpenOffice Math precedence', () => {
  assert.equal(tokenize('a <= b').map((t) => t.value).join('|'), 'a|<=|b|');
  const frac = parseFormula('a + b over c');
  assert.equal(frac.k, 'row');
  assert.equal(frac.items[2].k, 'frac', '"over" binds tighter than "+"');
  const sup = parseFormula('x^2_i');
  assert.equal(sup.k, 'script');
  assert.equal(sup.sup.text, '2');
  assert.equal(sup.sub.text, 'i');
  const sum = parseFormula('sum from{i=1} to n i');
  assert.equal(sum.k, 'big');
  assert.ok(sum.from && sum.to && sum.body);
  assert.equal(parseFormula('%alpha').text, 'α');
  assert.equal(parseFormula('left( a right)').k, 'fence');
  assert.equal(parseFormula('matrix{a # b ## c # d}').rows.length, 2);
  assert.throws(() => parseFormula('{a + b'), FormulaError);
  assert.throws(() => parseFormula('left( a'), FormulaError);
  assert.throws(() => parseFormula('color pink x'), /Màu/);
});

test('formula layout stacks fractions and raises superscripts', () => {
  const f = layoutFormula('a over b', { size: 20, measure });
  const [a, b] = f.ops.filter((op) => op.kind === 'text');
  assert.ok(a.y < b.y, 'numerator above denominator');
  assert.ok(f.ops.some((op) => op.kind === 'path'), 'fraction bar');
  const s = layoutFormula('x^2', { size: 20, measure }).ops.filter((op) => op.kind === 'text');
  assert.ok(s[1].y < s[0].y && s[1].size < s[0].size, 'superscript smaller and raised');
  const r = layoutFormula('sqrt{x}', { size: 20, measure });
  assert.ok(r.w > 20 && r.h > 20);
});

test('table references, numbers and formulas follow Calc', () => {
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(27), 'AB');
  assert.deepEqual(parseRef('$B$3'), { r: 2, c: 1 });
  assert.equal(toNumber('1.234,5'), 1234.5);
  assert.equal(toNumber('1,5'), 1.5);
  assert.equal(toNumber('12%'), 0.12);
  assert.equal(toNumber('abc'), null);
  const t = sanitizeTable({
    rows: 4, cols: 3,
    cells: [
      ['Mục', 'SL', 'Giá'],
      ['Bút', '2', '5000'],
      ['Vở', '3', '12000'],
      ['Tổng', '=SUM(B2:B3)', '=B2*C2+B3*C3'],
    ],
  });
  const v = evaluateTable(t);
  assert.equal(v[3][1].value, 5);
  assert.equal(v[3][2].value, 46000);
  assert.equal(v[3][2].text, (46000).toLocaleString('vi-VN'));
  const errors = evaluateTable(sanitizeTable({ rows: 1, cols: 4, cells: [['=1/0', '=B1', '=FOO(1)', '=AVERAGE(2;4)+ROUND(2,567;1)']] }))[0];
  assert.equal(errors[0].text, '#DIV/0!');
  assert.equal(errors[1].text, 'Err:522');
  assert.equal(errors[2].text, '#NAME?');
  assert.equal(errors[3].value, 5.6);
  assert.equal(evaluateTable(sanitizeTable({ rows: 1, cols: 2, cells: [['5', '=IF(A1>3;"lớn";"nhỏ")']] }))[0][1].text, 'lớn');
});

test('table layout draws the grid and right-aligns numbers', () => {
  const t = { ...newTable(2, 2), cells: [['A', 'B'], ['x', '42']] };
  const { w, h, ops } = layoutTable(t, { measure });
  assert.equal(w, 160);
  const lines = ops.filter((op) => op.kind === 'path' && !op.closed);
  assert.equal(lines.length, 6, '3 vertical + 3 horizontal lines');
  const num = ops.find((op) => op.text === '42');
  assert.ok(num.x > 80 + 40, 'number at the right of its cell');
  assert.ok(h > 0);
});

test('rich text wraps words, keeps styles and lays out lists', () => {
  const data = sanitizeRichText({
    fontSize: 10,
    paragraphs: [
      { runs: [{ text: 'Hợp đồng ' }, { text: 'quan trọng', bold: true }, { text: ' cần ký ngay hôm nay' }] },
      { list: 'number', runs: [{ text: 'Một' }] },
      { list: 'number', runs: [{ text: 'Hai', underline: true }] },
    ],
  });
  assert.equal(plainText(data).split('\n').length, 3);
  const { h, ops } = layoutRichText(data, 100, { measure });
  const texts = ops.filter((op) => op.kind === 'text');
  assert.ok(texts.some((op) => op.bold && op.text.startsWith('quan')));
  const lines = new Set(texts.map((op) => op.y));
  assert.ok(lines.size >= 4, 'first paragraph wraps');
  assert.ok(texts.some((op) => op.text === '2.'), 'numbered list counts');
  assert.ok(ops.some((op) => op.kind === 'path'), 'underline drawn');
  assert.ok(h > 40);
  const centred = layoutRichText({ paragraphs: [{ align: 'center', runs: [{ text: 'ab' }] }], fontSize: 10 }, 100, { measure }).ops[0];
  assert.ok(centred.x > 40);
});

test('office marks sanitize, fit and resize', () => {
  assert.deepEqual(sanitizeOfficeData('shape', { preset: 'nope' }), { preset: 'rect' });
  assert.equal(sanitizeOfficeData('connector', { style: 'x' }).style, 'elbow');
  const formula = fitOffice({ type: 'formula', x: 0, y: 0, w: 0, h: 0, color: '#000000', data: { src: 'a over b', size: 20 } }, measure);
  assert.ok(formula.w > 0 && formula.h > 0);
  const bigger = resizeOffice(formula, formula.w * 2, formula.h * 2, measure);
  assert.ok(Math.abs(bigger.data.size - 40) < 1e-6);
  const table = fitOffice({ type: 'table', x: 0, y: 0, w: 0, h: 0, data: newTable(2, 3) }, measure);
  assert.equal(table.w, 240);
  const wide = resizeOffice(table, 480, table.h, measure);
  assert.equal(wide.data.colW[0], 160);
  const ops = officeOps({ type: 'shape', x: 0, y: 0, w: 10, h: 10, color: '#ff0000', fill: '#00ff00', width: 1, opacity: 1, data: { preset: 'diamond' } }, measure);
  assert.equal(ops[0].fill, '#00ff00');
});

test('formulas convert to LaTeX', () => {
  assert.equal(toLatex('a over b'), String.raw`\frac{a}{b}`);
  assert.equal(toLatex('sum from{i=1} to n i'), String.raw`\sum\limits_{i = 1}^{n} i`);
  assert.equal(toLatex('sqrt{x} <= %pi'), String.raw`\sqrt{x} \leq \pi`);
});
