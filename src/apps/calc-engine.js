// Spreadsheet engine for the Bảng tính app (and table objects on PDF pages): A1 references,
// formulas with OpenOffice Calc / Excel syntax, recalculation and error values. Pure, no DOM.
//
//   const sheet = new CalcSheet();
//   sheet.set('B2', '10'); sheet.set('C2', '=B2*2'); sheet.value('C2') // 20
//
// Formula syntax follows Calc: + - * / ^ & % and = <> < > <= >=, ranges A1:B3, absolute refs $A$1,
// arguments separated by ',' or ';' (Calc's own separator). Function names are case-insensitive.
// Errors are values ({ error: '#DIV/0!' }) that spread through the formulas that use them.

export const ERRORS = Object.freeze({ div0: '#DIV/0!', ref: '#REF!', name: '#NAME?', value: '#VALUE!', cycle: '#CYCLE!', na: '#N/A', parse: '#ERR!' });

const err = (code) => ({ error: code });
export const isError = (v) => v !== null && typeof v === 'object' && 'error' in v;

// ---------- references ----------

export const MAX_COLS = 702; // A … ZZ
export const MAX_ROWS = 100000;

export function colName(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colIndex(name) {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// 'B12' or '$B$12' → { c: 1, r: 11 }; null when it is not a cell reference.
export function parseRef(text) {
  const m = /^\$?([A-Za-z]{1,2})\$?([1-9][0-9]*)$/.exec(String(text).trim());
  if (!m) return null;
  const c = colIndex(m[1]);
  const r = Number(m[2]) - 1;
  return c < MAX_COLS && r < MAX_ROWS ? { c, r } : null;
}

export const refName = (c, r) => `${colName(c)}${r + 1}`;

// ---------- input ----------

// What a typed entry is: a formula, a number ("12", "-3.5", "1,5", "1.234,5", "12%") or text.
export function parseInput(raw) {
  const s = String(raw ?? '');
  if (s.startsWith('=') && s.length > 1) return { formula: s.slice(1) };
  const t = s.trim();
  if (!t) return { value: null };
  if (/^(true|false|đúng|sai)$/i.test(t)) return { value: /^(true|đúng)$/i.test(t) };
  const pct = t.endsWith('%');
  const body = pct ? t.slice(0, -1).trim() : t;
  let num = null;
  if (/^[-+]?\d+(\.\d+)?$/.test(body)) num = Number(body);
  else if (/^[-+]?\d+,\d+$/.test(body)) num = Number(body.replace(',', '.'));
  else if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(body)) num = Number(body.replace(/\./g, '').replace(',', '.'));
  else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(body)) num = Number(body.replace(/,/g, ''));
  if (num === null || Number.isNaN(num)) return { value: s };
  return { value: pct ? num / 100 : num };
}

// ---------- tokenizer and parser ----------

const TOKEN = /\s*(?:(\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|("(?:[^"]|"")*")|(\$?[A-Za-z]{1,2}\$?[1-9][0-9]*(?::\$?[A-Za-z]{1,2}\$?[1-9][0-9]*)?)(?![A-Za-z0-9_(])|([A-Za-z_][A-Za-z0-9_.]*)|(<>|<=|>=|[-+*/^&%=<>(),;]))/y;

export function tokenize(src) {
  const out = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new SyntaxError(`Ký tự không hợp lệ ở vị trí ${pos + 1}`);
    pos = TOKEN.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'str', v: m[2].slice(1, -1).replace(/""/g, '"') });
    else if (m[3] !== undefined) out.push({ t: 'ref', v: m[3] });
    else if (m[4] !== undefined) out.push({ t: 'name', v: m[4] });
    else out.push({ t: 'op', v: m[5] });
  }
  return out;
}

// Formula text (without '=') → AST: { k: 'num'|'str'|'bool'|'ref'|'range'|'call'|'bin'|'neg'|'pct', … }
export function parseFormula(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => peek()?.t === 'op' && peek().v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new SyntaxError(`Thiếu "${v}"`);
    i++;
  };
  const binary = (next, ops) => () => {
    let left = next();
    while (peek()?.t === 'op' && ops.includes(peek().v)) {
      const op = toks[i++].v;
      left = { k: 'bin', op, a: left, b: next() };
    }
    return left;
  };
  const primary = () => {
    const tok = toks[i++];
    if (!tok) throw new SyntaxError('Công thức chưa hết');
    if (tok.t === 'num') return { k: 'num', v: tok.v };
    if (tok.t === 'str') return { k: 'str', v: tok.v };
    if (tok.t === 'ref') {
      const [a, b] = tok.v.split(':');
      const ra = parseRef(a);
      if (!ra) throw new SyntaxError(`Tham chiếu sai: ${tok.v}`);
      if (b === undefined) return { k: 'ref', ...ra };
      const rb = parseRef(b);
      if (!rb) throw new SyntaxError(`Tham chiếu sai: ${tok.v}`);
      return { k: 'range', c0: Math.min(ra.c, rb.c), r0: Math.min(ra.r, rb.r), c1: Math.max(ra.c, rb.c), r1: Math.max(ra.r, rb.r) };
    }
    if (tok.t === 'name') {
      const name = tok.v.toUpperCase();
      if (isOp('(')) {
        i++;
        const args = [];
        if (!isOp(')')) {
          for (;;) {
            args.push(expr());
            if (isOp(',') || isOp(';')) i++;
            else break;
          }
        }
        expect(')');
        return { k: 'call', name, args };
      }
      if (name === 'TRUE' || name === 'FALSE') return { k: 'bool', v: name === 'TRUE' };
      return { k: 'name', name };
    }
    if (tok.v === '(') {
      const e = expr();
      expect(')');
      return e;
    }
    if (tok.v === '-' || tok.v === '+') {
      const e = unary();
      return tok.v === '-' ? { k: 'neg', a: e } : e;
    }
    throw new SyntaxError(`Không mong đợi "${tok.v}"`);
  };
  const postfix = () => {
    let e = primary();
    while (isOp('%')) {
      i++;
      e = { k: 'pct', a: e };
    }
    return e;
  };
  const unary = () => {
    if (isOp('-') || isOp('+')) {
      const op = toks[i++].v;
      const e = unary();
      return op === '-' ? { k: 'neg', a: e } : e;
    }
    return postfix();
  };
  const power = binary(unary, ['^']);
  const term = binary(power, ['*', '/']);
  const additive = binary(term, ['+', '-']);
  const concat = binary(additive, ['&']);
  const expr = binary(concat, ['=', '<>', '<', '>', '<=', '>=']);
  const ast = expr();
  if (i < toks.length) throw new SyntaxError(`Thừa "${toks[i].v}"`);
  return ast;
}

// Every cell a formula reads (ranges expanded), as 'A1' names.
export function references(ast, out = new Set()) {
  if (!ast) return out;
  if (ast.k === 'ref') out.add(refName(ast.c, ast.r));
  else if (ast.k === 'range') {
    for (let r = ast.r0; r <= ast.r1; r++) for (let c = ast.c0; c <= ast.c1; c++) out.add(refName(c, r));
  } else for (const child of [ast.a, ast.b, ...(ast.args ?? [])]) references(child, out);
  return out;
}

// ---------- values ----------

function toNumber(v) {
  if (isError(v)) return v;
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const p = parseInput(v);
  return typeof p.value === 'number' ? p.value : err(ERRORS.value);
}

const toText = (v) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));
const toBool = (v) => (isError(v) ? v : typeof v === 'string' ? v.length > 0 && v.toUpperCase() !== 'FALSE' : !!v);

const flat = (args) => args.flat(Infinity);
const firstError = (list) => list.find(isError);
// Numbers of the arguments: ranges skip text and blanks (as Calc does), direct values are converted.
function numbers(args) {
  const out = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const v of flat(a)) {
        if (isError(v)) return v;
        if (typeof v === 'number') out.push(v);
      }
    } else {
      const n = toNumber(a);
      if (isError(n)) return n;
      out.push(n);
    }
  }
  return out;
}

const withNumbers = (fn) => (args) => {
  const ns = numbers(args);
  return isError(ns) ? ns : fn(ns);
};
const scalar = (fn) => (args) => {
  const e = firstError(args.filter((a) => !Array.isArray(a)));
  return e ?? fn(...args);
};
const num1 = (fn) => scalar((a, ...rest) => {
  const n = toNumber(a);
  return isError(n) ? n : fn(n, ...rest.map(toNumber));
});

export const FUNCTIONS = {
  SUM: withNumbers((ns) => ns.reduce((s, n) => s + n, 0)),
  PRODUCT: withNumbers((ns) => ns.reduce((s, n) => s * n, 1)),
  AVERAGE: withNumbers((ns) => (ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : err(ERRORS.div0))),
  MIN: withNumbers((ns) => (ns.length ? Math.min(...ns) : 0)),
  MAX: withNumbers((ns) => (ns.length ? Math.max(...ns) : 0)),
  COUNT: (args) => flat(args).filter((v) => typeof v === 'number').length,
  COUNTA: (args) => flat(args).filter((v) => v !== null && v !== undefined && v !== '').length,
  ROUND: num1((n, d = 0) => (isError(d) ? d : Math.round(n * 10 ** d) / 10 ** d)),
  INT: num1((n) => Math.floor(n)),
  ABS: num1((n) => Math.abs(n)),
  SQRT: num1((n) => (n < 0 ? err(ERRORS.value) : Math.sqrt(n))),
  POWER: num1((n, p) => (isError(p) ? p : n ** p)),
  MOD: num1((n, d) => (isError(d) ? d : d === 0 ? err(ERRORS.div0) : n - d * Math.floor(n / d))),
  IF: (args) => {
    const c = toBool(Array.isArray(args[0]) ? flat(args[0])[0] : args[0]);
    if (isError(c)) return c;
    return c ? (args[1] ?? true) : (args[2] ?? false);
  },
  IFERROR: (args) => (isError(args[0]) ? (args[1] ?? '') : args[0]),
  AND: (args) => {
    const bs = flat(args).map(toBool);
    return firstError(bs) ?? bs.every(Boolean);
  },
  OR: (args) => {
    const bs = flat(args).map(toBool);
    return firstError(bs) ?? bs.some(Boolean);
  },
  NOT: scalar((a) => {
    const b = toBool(a);
    return isError(b) ? b : !b;
  }),
  CONCATENATE: (args) => firstError(flat(args)) ?? flat(args).map(toText).join(''),
  LEN: scalar((a) => [...toText(a)].length),
  UPPER: scalar((a) => toText(a).toLocaleUpperCase('vi')),
  LOWER: scalar((a) => toText(a).toLocaleLowerCase('vi')),
  TODAY: () => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  },
  PI: () => Math.PI,
};
FUNCTIONS.CONCAT = FUNCTIONS.CONCATENATE;
// Common Vietnamese spellings people type in Calc/Excel localized to Vietnamese.
FUNCTIONS.TONG = FUNCTIONS.SUM;
FUNCTIONS.TRUNGBINH = FUNCTIONS.AVERAGE;

function compare(op, a, b) {
  const an = typeof a === 'number' || typeof a === 'boolean';
  const bn = typeof b === 'number' || typeof b === 'boolean';
  let x = a ?? 0;
  let y = b ?? 0;
  if (!(an && bn)) {
    x = toText(a).toLocaleLowerCase('vi');
    y = toText(b).toLocaleLowerCase('vi');
  }
  switch (op) {
    case '=': return x === y;
    case '<>': return x !== y;
    case '<': return x < y;
    case '>': return x > y;
    case '<=': return x <= y;
    default: return x >= y;
  }
}

// Evaluates an AST. `cell(c, r)` returns the value of a cell (already evaluated).
export function evaluate(ast, cell) {
  switch (ast.k) {
    case 'num': case 'str': case 'bool': return ast.v;
    case 'ref': return cell(ast.c, ast.r) ?? null;
    case 'range': {
      const rows = [];
      for (let r = ast.r0; r <= ast.r1; r++) {
        const row = [];
        for (let c = ast.c0; c <= ast.c1; c++) row.push(cell(c, r) ?? null);
        rows.push(row);
      }
      return rows;
    }
    case 'name': return err(ERRORS.name);
    case 'neg': {
      const n = toNumber(evaluate(ast.a, cell));
      return isError(n) ? n : -n;
    }
    case 'pct': {
      const n = toNumber(evaluate(ast.a, cell));
      return isError(n) ? n : n / 100;
    }
    case 'call': {
      const fn = FUNCTIONS[ast.name];
      if (!fn) return err(ERRORS.name);
      // IF and IFERROR only evaluate the branch they return.
      if (ast.name === 'IF') {
        const c = evaluate(ast.args[0] ?? { k: 'bool', v: false }, cell);
        const b = toBool(Array.isArray(c) ? flat(c)[0] : c);
        if (isError(b)) return b;
        const pick = b ? ast.args[1] : ast.args[2];
        return pick ? scalarOf(evaluate(pick, cell)) : b;
      }
      if (ast.name === 'IFERROR') {
        const v = scalarOf(evaluate(ast.args[0], cell));
        return isError(v) ? (ast.args[1] ? scalarOf(evaluate(ast.args[1], cell)) : '') : v;
      }
      const out = fn(ast.args.map((a) => evaluate(a, cell)));
      return typeof out === 'number' && !Number.isFinite(out) ? err(ERRORS.value) : out;
    }
    case 'bin': {
      const a = scalarOf(evaluate(ast.a, cell));
      const b = scalarOf(evaluate(ast.b, cell));
      if (isError(a)) return a;
      if (isError(b)) return b;
      if (ast.op === '&') return toText(a) + toText(b);
      if (['=', '<>', '<', '>', '<=', '>='].includes(ast.op)) return compare(ast.op, a, b);
      const x = toNumber(a);
      const y = toNumber(b);
      if (isError(x)) return x;
      if (isError(y)) return y;
      if (ast.op === '+') return x + y;
      if (ast.op === '-') return x - y;
      if (ast.op === '*') return x * y;
      if (ast.op === '/') return y === 0 ? err(ERRORS.div0) : x / y;
      const p = x ** y;
      return Number.isFinite(p) ? p : err(ERRORS.value);
    }
    default: return err(ERRORS.parse);
  }
}

// A range used where one value is expected gives its first cell.
const scalarOf = (v) => (Array.isArray(v) ? (flat(v)[0] ?? null) : v);

// ---------- sheet ----------

// One sheet: raw entries by 'A1' name, values computed on demand and cached until an edit.
export class CalcSheet {
  #raw = new Map();
  #parsed = new Map(); // name → { formula, ast?, error? } | { value }
  #cache = new Map();

  constructor(entries = {}) {
    for (const [ref, raw] of Object.entries(entries)) this.set(ref, raw);
  }

  set(ref, raw) {
    const p = parseRef(ref);
    if (!p) throw new Error(`Ô không hợp lệ: ${ref}`);
    const name = refName(p.c, p.r);
    const text = raw === null || raw === undefined ? '' : String(raw);
    if (text === '') {
      this.#raw.delete(name);
      this.#parsed.delete(name);
    } else {
      this.#raw.set(name, text);
      const input = parseInput(text);
      if ('formula' in input) {
        try {
          this.#parsed.set(name, { formula: input.formula, ast: parseFormula(input.formula) });
        } catch (e) {
          this.#parsed.set(name, { formula: input.formula, error: e.message });
        }
      } else this.#parsed.set(name, input);
    }
    this.#cache.clear();
  }

  raw(ref) {
    const p = parseRef(ref);
    return p ? (this.#raw.get(refName(p.c, p.r)) ?? '') : '';
  }

  // The computed value: number, string, boolean, null (blank) or { error }.
  value(ref) {
    const p = parseRef(ref);
    return p ? this.#valueAt(p.c, p.r, new Set()) : err(ERRORS.ref);
  }

  #valueAt(c, r, visiting) {
    const name = refName(c, r);
    if (this.#cache.has(name)) return this.#cache.get(name);
    const p = this.#parsed.get(name);
    if (!p) return null;
    if (!('formula' in p)) return p.value;
    if (p.error) return err(ERRORS.parse);
    if (visiting.has(name)) return err(ERRORS.cycle);
    visiting.add(name);
    let v = scalarOf(evaluate(p.ast, (cc, rr) => this.#valueAt(cc, rr, visiting)));
    visiting.delete(name);
    if (v === null) v = 0; // a formula pointing at a blank cell shows 0, as in Calc
    this.#cache.set(name, v);
    return v;
  }

  // Parse error message of a formula cell, for the formula bar.
  problem(ref) {
    const p = parseRef(ref);
    return p ? (this.#parsed.get(refName(p.c, p.r))?.error ?? null) : null;
  }

  // Every non-empty cell: [[name, raw], …].
  entries() {
    return [...this.#raw.entries()];
  }

  // Last used column and row (0-based), or -1 for an empty sheet.
  extent() {
    let c = -1;
    let r = -1;
    for (const name of this.#raw.keys()) {
      const p = parseRef(name);
      c = Math.max(c, p.c);
      r = Math.max(r, p.r);
    }
    return { cols: c, rows: r };
  }
}

// Display text for a value: numbers in Vietnamese style (1.234,5), errors as their code.
export function formatValue(v, { decimals = null } = {}) {
  if (v === null || v === undefined) return '';
  if (isError(v)) return v.error;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    const opts = decimals === null ? { maximumFractionDigits: 10 } : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
    return v.toLocaleString('vi-VN', opts);
  }
  return String(v);
}
