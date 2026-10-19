// Table tool: a grid of cells placed on a page, with spreadsheet formulas. Pure functions.
//
// Modelled on Apache OpenOffice Calc (sc/source/core/tool/interpr*.cxx): A1 references and ranges,
// SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, PRODUCT, ROUND, ABS, SQRT, POWER, IF, and Calc's error
// texts (#DIV/0!, #REF!, #NAME?, #VALUE!, Err:502, Err:522 for a circular reference).
// See THIRD_PARTY.md (Apache-2.0).

export const TABLE_LIMITS = { rows: 50, cols: 20 };

// A new table: `rows` × `cols` empty cells, 80 × 20 pt each, with a header row.
export function newTable(rows = 3, cols = 3) {
  return sanitizeTable({ rows, cols, header: true, fontSize: 10, cells: [] });
}

export function sanitizeTable(t = {}) {
  const rows = Math.min(TABLE_LIMITS.rows, Math.max(1, Math.floor(Number(t.rows) || 1)));
  const cols = Math.min(TABLE_LIMITS.cols, Math.max(1, Math.floor(Number(t.cols) || 1)));
  const size = (list, n, fallback) => Array.from({ length: n }, (_, i) => {
    const v = Number(list?.[i]);
    return Number.isFinite(v) && v >= 8 ? Math.min(v, 600) : fallback;
  });
  const fontSize = Math.min(48, Math.max(5, Number(t.fontSize) || 10));
  return {
    rows,
    cols,
    header: t.header !== false,
    fontSize,
    colW: size(t.colW, cols, 80),
    rowH: size(t.rowH, rows, Math.round(fontSize * 2)),
    cells: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => String(t.cells?.[r]?.[c] ?? '').slice(0, 500))),
  };
}

// ---------- references ----------

export function columnName(c) {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// "B3" -> { r: 2, c: 1 }; "$B$3" works too. Null when it is not a reference.
export function parseRef(text) {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,5})$/i.exec(String(text).trim());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

// ---------- numbers ----------

// A cell's own text as a number, accepting "1234.5", "1234,5" and "1.234,5" (Vietnamese style);
// null when it is not a number.
export function toNumber(text) {
  let s = String(text ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.endsWith('%')) {
    const n = toNumber(s.slice(0, -1));
    return n === null ? null : n / 100;
  }
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : null;
}

export function formatNumber(n) {
  if (!Number.isFinite(n)) return '#NUM!';
  const rounded = Math.abs(n) < 1e15 ? Number(n.toPrecision(12)) : n;
  return rounded.toLocaleString('vi-VN', { maximumFractionDigits: 10 });
}

// ---------- formulas ----------

class CalcError extends Error {}
const fail = (code) => {
  throw new CalcError(code);
};

function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\$?[A-Za-z]{1,3}\$?\d{1,5}(?::\$?[A-Za-z]{1,3}\$?\d{1,5})?)(?![A-Za-z(])|(\d+(?:[.,]\d+)?(?:e[-+]?\d+)?%?)|([A-Za-z][A-Za-z0-9.]*)|"([^"]*)"|(<=|>=|<>|[-+*/^(),;:=<>&%]))/gy;
  let m;
  let at = 0;
  while (at < src.length) {
    re.lastIndex = at;
    m = re.exec(src);
    if (!m || m[0].length === 0) {
      if (/^\s*$/.test(src.slice(at))) break;
      fail('Err:501'); // invalid character
    }
    at = re.lastIndex;
    if (m[1]) out.push({ t: 'ref', v: m[1].toUpperCase() });
    else if (m[2]) out.push({ t: 'num', v: m[2] });
    else if (m[3]) out.push({ t: 'name', v: m[3].toUpperCase() });
    else if (m[4] !== undefined) out.push({ t: 'str', v: m[4] });
    else out.push({ t: 'op', v: m[5] });
  }
  return out;
}

const FUNCTIONS = {
  SUM: (args) => numbers(args).reduce((a, b) => a + b, 0),
  AVERAGE: (args) => {
    const n = numbers(args);
    if (!n.length) fail('#DIV/0!');
    return n.reduce((a, b) => a + b, 0) / n.length;
  },
  MIN: (args) => (numbers(args).length ? Math.min(...numbers(args)) : 0),
  MAX: (args) => (numbers(args).length ? Math.max(...numbers(args)) : 0),
  COUNT: (args) => numbers(args).length,
  COUNTA: (args) => args.flat().filter((v) => v !== '' && v !== null).length,
  PRODUCT: (args) => numbers(args).reduce((a, b) => a * b, 1),
  ROUND: (args) => {
    const [x, d = 0] = scalars(args, 1, 2);
    const k = 10 ** Math.trunc(d);
    return Math.sign(x) * Math.round(Math.abs(x) * k) / k;
  },
  ABS: (args) => Math.abs(scalars(args, 1, 1)[0]),
  SQRT: (args) => {
    const [x] = scalars(args, 1, 1);
    if (x < 0) fail('Err:502');
    return Math.sqrt(x);
  },
  POWER: (args) => {
    const [a, b] = scalars(args, 2, 2);
    return a ** b;
  },
  IF: (args) => {
    if (args.length < 2 || args.length > 3) fail('Err:511');
    const cond = toScalar(args[0]);
    return truthy(cond) ? toValue(args[1]) : args.length > 2 ? toValue(args[2]) : false;
  },
};
// Vietnamese spreadsheet users often type these names.
FUNCTIONS.TONG = FUNCTIONS.SUM;
FUNCTIONS.TRUNGBINH = FUNCTIONS.AVERAGE;

function toValue(v) {
  return Array.isArray(v) ? v[0] ?? 0 : v;
}

function toScalar(v) {
  const x = toValue(v);
  if (typeof x === 'number' || typeof x === 'boolean') return x;
  if (x === '' || x === null) return 0;
  const n = toNumber(x);
  if (n === null) fail('#VALUE!');
  return n;
}

function truthy(v) {
  return typeof v === 'boolean' ? v : Number(v) !== 0;
}

// Numbers in the arguments; text and empty cells inside ranges are skipped, like Calc.
function numbers(args) {
  const out = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const v of a) if (typeof v === 'number') out.push(v);
    } else {
      out.push(toScalar(a));
    }
  }
  return out;
}

function scalars(args, min, max) {
  if (args.length < min || args.length > max) fail('Err:511'); // wrong number of arguments
  return args.map((a) => Number(toScalar(a)));
}

// Evaluates every cell. Returns a grid of { text, value, number, error } where `text` is what to show.
export function evaluateTable(table) {
  const { rows, cols, cells } = table;
  const memo = new Map();
  const visiting = new Set();

  function cellValue(r, c) {
    if (r < 0 || c < 0 || r >= rows || c >= cols) fail('#REF!');
    const key = r * cols + c;
    if (memo.has(key)) {
      const v = memo.get(key);
      if (v instanceof CalcError) throw v;
      return v;
    }
    if (visiting.has(key)) fail('Err:522');
    visiting.add(key);
    let value;
    try {
      const raw = cells[r][c];
      if (raw.startsWith('=')) value = formula(raw.slice(1));
      else value = toNumber(raw) ?? raw;
      memo.set(key, value);
    } catch (err) {
      if (!(err instanceof CalcError)) throw err;
      memo.set(key, err);
      throw err;
    } finally {
      visiting.delete(key);
    }
    return value;
  }

  function range(text) {
    const [a, b] = text.split(':').map(parseRef);
    if (!a || !b) fail('#REF!');
    const out = [];
    for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) {
      for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) {
        const v = cellValue(r, c);
        out.push(v === '' ? null : v);
      }
    }
    return out;
  }

  function formula(src) {
    const tokens = tokenize(src);
    let i = 0;
    const peek = () => tokens[i];
    const take = (v) => (peek()?.t === 'op' && peek().v === v ? tokens[i++] : null);

    // compare := concat (( = <> < > <= >= ) concat)*
    function compare() {
      let left = concat();
      for (let op = peek(); op?.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(op.v); op = peek()) {
        i++;
        const right = concat();
        const a = toValue(left);
        const b = toValue(right);
        const [x, y] = typeof a === 'string' || typeof b === 'string' ? [String(a), String(b)] : [Number(a), Number(b)];
        left = { '=': x === y, '<>': x !== y, '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y }[op.v];
      }
      return left;
    }
    function concat() {
      let left = additive();
      while (take('&')) left = String(toValue(left)) + String(toValue(additive()));
      return left;
    }
    function additive() {
      let left = multiplicative();
      for (;;) {
        if (take('+')) left = toScalar(left) + toScalar(multiplicative());
        else if (take('-')) left = toScalar(left) - toScalar(multiplicative());
        else return left;
      }
    }
    function multiplicative() {
      let left = power();
      for (;;) {
        if (take('*')) left = toScalar(left) * toScalar(power());
        else if (take('/')) {
          const d = toScalar(power());
          if (d === 0) fail('#DIV/0!');
          left = toScalar(left) / d;
        } else return left;
      }
    }
    function power() {
      let left = unary();
      while (take('^')) left = toScalar(left) ** toScalar(unary());
      return left;
    }
    function unary() {
      if (take('-')) return -toScalar(unary());
      if (take('+')) return toScalar(unary());
      let v = primary();
      while (take('%')) v = toScalar(v) / 100;
      return v;
    }
    function primary() {
      const t = tokens[i++];
      if (!t) fail('Err:507'); // missing operand
      if (t.t === 'num') {
        // In a formula a comma is the decimal separator (Vietnamese locale), never a thousands mark.
        const n = Number(t.v.replace('%', '').replace(',', '.'));
        return t.v.endsWith('%') ? n / 100 : n;
      }
      if (t.t === 'str') return t.v;
      if (t.t === 'ref') {
        if (t.v.includes(':')) return range(t.v);
        const ref = parseRef(t.v);
        const v = cellValue(ref.r, ref.c);
        return v === '' ? 0 : v;
      }
      if (t.t === 'name') {
        if (t.v === 'TRUE') return true;
        if (t.v === 'FALSE') return false;
        const fn = FUNCTIONS[t.v];
        if (!fn || !take('(')) fail('#NAME?');
        const args = [];
        if (!take(')')) {
          do args.push(compare());
          while (take(';') || take(','));
          if (!take(')')) fail('Err:508'); // missing bracket
        }
        return fn(args);
      }
      if (t.t === 'op' && t.v === '(') {
        const v = compare();
        if (!take(')')) fail('Err:508');
        return v;
      }
      fail('Err:509'); // missing operator or operand
    }

    const value = compare();
    if (i < tokens.length) fail('Err:509');
    return Array.isArray(value) ? fail('#VALUE!') : value;
  }

  return cells.map((row, r) => row.map((raw, c) => {
    try {
      const value = cellValue(r, c);
      if (typeof value === 'number') return { text: raw.startsWith('=') ? formatNumber(value) : raw, value, number: true };
      if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE', value, number: false };
      return { text: String(value), value, number: false };
    } catch (err) {
      if (!(err instanceof CalcError)) throw err;
      return { text: err.message, value: null, number: false, error: true };
    }
  }));
}

// Drawing ops of a table at (0, 0): grid lines and cell texts, clipped by shortening with "…".
// `measure(text, size, style)` gives text widths.
export function layoutTable(table, { color = '#000000', lineColor = '#555555', headerFill = '#eef2f7', measure }) {
  const t = sanitizeTable(table);
  const values = evaluateTable(t);
  const ops = [];
  const w = t.colW.reduce((a, b) => a + b, 0);
  const h = t.rowH.reduce((a, b) => a + b, 0);
  const pad = Math.max(2, t.fontSize * 0.35);
  let y = 0;
  t.rowH.forEach((rh, r) => {
    const header = t.header && r === 0;
    if (header) ops.push({ kind: 'path', points: [[0, 0], [w, 0], [w, rh], [0, rh]], closed: true, fill: headerFill });
    let x = 0;
    t.colW.forEach((cw, c) => {
      const v = values[r][c];
      if (v.text) {
        const style = { bold: header, italic: false };
        const room = cw - 2 * pad;
        let text = v.text;
        if (measure(text, t.fontSize, style) > room) {
          while (text.length > 1 && measure(`${text}…`, t.fontSize, style) > room) text = text.slice(0, -1);
          text += '…';
        }
        const tw = measure(text, t.fontSize, style);
        const tx = v.number && !header ? x + cw - pad - tw : header ? x + (cw - tw) / 2 : x + pad;
        ops.push({ kind: 'text', text, x: tx, y: y + rh / 2 + t.fontSize * 0.35, size: t.fontSize, ...style, color: v.error ? '#c62828' : color });
      }
      x += cw;
    });
    y += rh;
  });
  // Grid: outer border and inner lines.
  const lw = 0.75;
  let gx = 0;
  for (let c = 0; c <= t.cols; c++) {
    ops.push({ kind: 'path', points: [[gx, 0], [gx, h]], closed: false, stroke: lineColor, width: lw });
    gx += t.colW[c] ?? 0;
  }
  let gy = 0;
  for (let r = 0; r <= t.rows; r++) {
    ops.push({ kind: 'path', points: [[0, gy], [w, gy]], closed: false, stroke: lineColor, width: r === 1 && t.header ? lw * 1.6 : lw });
    gy += t.rowH[r] ?? 0;
  }
  return { w, h, ops };
}
