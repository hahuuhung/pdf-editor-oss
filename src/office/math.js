// Formula editor: the markup language of Apache OpenOffice Math (starmath) parsed and laid out as
// text runs and lines, so a formula can be drawn on screen (SVG) and in the PDF. Pure functions;
// text widths come from a `measure(text, size, { bold, italic })` callback.
//
// The grammar follows starmath/source/parse.cxx (Expression → Relation → Sum → Product → Power →
// Term) and its keyword table: "a over b", "sqrt{x}", "nroot{3}{x}", "x^2", "x_i", "sum from{i=1}
// to{n} i", "int from a to b f(x) dx", "left( ... right)", "%alpha", "bold", "color red", "matrix{a # b
// ## c # d}", "binom a b", "stack{a # b}". See THIRD_PARTY.md (Apache-2.0).

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ',
  sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
};
for (const [name, ch] of Object.entries({ ...GREEK })) GREEK[name.toUpperCase()] = ch.toUpperCase();

// Words that stand for one symbol.
const SYMBOLS = {
  infinity: '∞', infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃', emptyset: '∅', aleph: 'ℵ',
  dotsaxis: '⋯', dotslow: '…', dotsvert: '⋮', dotsup: '⋰', dotsdown: '⋱', dotsdiag: '⋰', setn: 'ℕ', setz: 'ℤ', setq: 'ℚ', setr: 'ℝ', setc: 'ℂ',
  hbar: 'ℏ', lambdabar: 'ƛ', wp: '℘', re: 'ℜ', im: 'ℑ', backepsilon: '϶', leftarrow: '←', rightarrow: '→', uparrow: '↑', downarrow: '↓',
  dlarrow: '⇐', drarrow: '⇒', dlrarrow: '⇔',
};

// Binary operators by precedence group, with the character drawn.
const RELATIONS = {
  '=': '=', '<>': '≠', neq: '≠', '<': '<', lt: '<', '>': '>', gt: '>', '<=': '≤', le: '≤', '>=': '≥', ge: '≥', leslant: '≤', geslant: '≥',
  '<<': '≪', ll: '≪', '>>': '≫', gg: '≫', approx: '≈', sim: '∼', simeq: '≃', equiv: '≡', prop: '∝', parallel: '∥', ortho: '⊥',
  divides: '∣', ndivides: '∤', toward: '→', in: '∈', notin: '∉', owns: '∋', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇',
  nsubset: '⊄', nsupset: '⊅', nsubseteq: '⊈', nsupseteq: '⊉', def: '≝', transl: '⊷', transr: '⊶', dlarrow: '⇐', drarrow: '⇒', dlrarrow: '⇔',
};
const SUMS = { '+': '+', '-': '−', '+-': '±', plusminus: '±', '-+': '∓', minusplus: '∓', or: '∨', '|': '∨', union: '∪', oplus: '⊕', ominus: '⊖' };
const PRODUCTS = {
  '*': '∗', cdot: '·', times: '×', div: '÷', '/': '/', slash: '/', and: '∧', '&': '∧', intersection: '∩', setminus: '∖', bslash: '∖',
  otimes: '⊗', odot: '⊙', odivide: '⊘', circ: '∘', wideslash: '∕', widebslash: '∖',
};
const UNARY = { '+': '+', '-': '−', '+-': '±', plusminus: '±', '-+': '∓', minusplus: '∓', neg: '¬' };
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sinh', 'cosh', 'tanh', 'coth', 'arcsin', 'arccos', 'arctan', 'arccot', 'arsinh', 'arcosh', 'artanh',
  'arcoth', 'exp', 'ln', 'log', 'lg', 'det', 'max', 'min', 'gcd', 'mod', 'deg', 'sup', 'inf',
]);
const BIG_OPERATORS = {
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', lint: '∮', llint: '∯', lllint: '∰',
  lim: 'lim', liminf: 'lim inf', limsup: 'lim sup',
};
const INTEGRALS = new Set(['int', 'iint', 'iiint', 'lint', 'llint', 'lllint']);
const ATTRIBUTES = {
  hat: '^', widehat: '^', tilde: '~', widetilde: '~', bar: '¯', overline: 'overline', underline: 'underline', overstrike: 'overstrike',
  vec: '→', widevec: '→', dot: '˙', ddot: '¨', dddot: '⃛', acute: '´', grave: '`', breve: '˘', check: 'ˇ', circle: '˚',
};
const BRACKETS = {
  '(': '(', ')': ')', '[': '[', ']': ']', lbrace: '{', rbrace: '}', '{': '{', '}': '}', langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉',
  lfloor: '⌊', rfloor: '⌋', lline: '|', rline: '|', ldline: '‖', rdline: '‖', ldbracket: '⟦', rdbracket: '⟧', '|': '|', none: '',
};
export const COLORS = {
  black: '#000000', blue: '#0000ff', green: '#008000', red: '#ff0000', cyan: '#00ffff', magenta: '#ff00ff', yellow: '#ffff00',
  white: '#ffffff', gray: '#808080', lime: '#00ff00', maroon: '#800000', navy: '#000080', olive: '#808000', purple: '#800080',
  silver: '#c0c0c0', teal: '#008080', aqua: '#00ffff', fuchsia: '#ff00ff',
};

// ---------- tokens ----------

const MULTI = ['<=', '>=', '<>', '<<', '>>', '+-', '-+', '##'];

export function tokenize(src) {
  const tokens = [];
  const s = String(src ?? '');
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      const end = s.indexOf('"', i + 1);
      const text = s.slice(i + 1, end < 0 ? s.length : end);
      tokens.push({ type: 'text', value: text, at: i });
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    if (ch === '%') {
      const m = /^%(i?)([A-Za-z]+)/.exec(s.slice(i));
      if (m) {
        tokens.push({ type: 'symbol', value: GREEK[m[2]] ?? `%${m[2]}`, italic: !!m[1], at: i });
        i += m[0].length;
        continue;
      }
    }
    const num = /^\d+(?:[.,]\d+)?/.exec(s.slice(i));
    if (num) {
      tokens.push({ type: 'number', value: num[0], at: i });
      i += num[0].length;
      continue;
    }
    const word = /^[\p{L}][\p{L}\p{N}]*/u.exec(s.slice(i));
    if (word) {
      tokens.push({ type: 'word', value: word[0], at: i });
      i += word[0].length;
      continue;
    }
    const multi = MULTI.find((m) => s.startsWith(m, i));
    tokens.push({ type: 'char', value: multi ?? ch, at: i });
    i += multi ? multi.length : 1;
  }
  tokens.push({ type: 'end', value: '', at: s.length });
  return tokens;
}

// ---------- parser ----------

export class FormulaError extends Error {
  constructor(message, at) {
    super(message);
    this.at = at;
  }
}

// Parses OpenOffice Math markup into a tree of nodes:
// { k: 'row', items } | { k: 'atom', text, italic?, upright? } | { k: 'op', text } | { k: 'frac', num, den }
// | { k: 'script', base, sup, sub, lsup, lsub, csup, csub } | { k: 'sqrt', body, index } | { k: 'big', text, from, to, body, limits }
// | { k: 'fence', left, right, body } | { k: 'attr', name, body } | { k: 'style', bold, italic, color, size, body }
// | { k: 'stack', rows: [[node]] } (matrix rows, binom and stack)
export function parseFormula(src) {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const is = (value) => peek().type !== 'text' && peek().value === value;
  const accept = (value) => (is(value) ? next() : null);
  const expect = (value, message) => {
    if (!is(value)) throw new FormulaError(message ?? `Thiếu "${value}".`, peek().at);
    return next();
  };
  const row = (items) => (items.length === 1 ? items[0] : { k: 'row', items });
  const keyOf = (t) => (t.type === 'word' || t.type === 'char' ? t.value : null);

  // Expression: relations written next to each other, until a closing token.
  function expression(stop = []) {
    const items = [];
    while (peek().type !== 'end' && !stop.some((v) => is(v)) && !is('}') && !is('#') && !is('##') && !is('right')) {
      items.push(relation());
    }
    return row(items);
  }

  function binary(sub, table) {
    let left = sub();
    for (;;) {
      const key = keyOf(peek());
      if (!key || !(key in table)) return left;
      // "-" etc. at the start of a term is unary; here it follows an operand, so it is binary.
      next();
      const right = sub();
      left = { k: 'row', items: [left, { k: 'op', text: table[key] }, right] };
    }
  }

  function relation() {
    return binary(sum, RELATIONS);
  }

  function sum() {
    return binary(product, SUMS);
  }

  function product() {
    let left = power();
    for (;;) {
      if (accept('over')) {
        left = { k: 'frac', num: left, den: power() };
        continue;
      }
      const key = keyOf(peek());
      if (!key || !(key in PRODUCTS)) return left;
      next();
      left = { k: 'row', items: [left, { k: 'op', text: PRODUCTS[key] }, power()] };
    }
  }

  const SCRIPTS = { '^': 'sup', sup: 'sup', rsup: 'sup', _: 'sub', sub: 'sub', rsub: 'sub', lsup: 'lsup', lsub: 'lsub', csup: 'csup', csub: 'csub' };

  function scripts(base) {
    let node = null;
    for (;;) {
      const key = keyOf(peek());
      if (!key || !(key in SCRIPTS)) return node ?? base;
      next();
      node ??= { k: 'script', base };
      const slot = SCRIPTS[key];
      if (node[slot]) throw new FormulaError('Chỉ số trên/dưới bị lặp lại.', peek().at);
      node[slot] = term();
    }
  }

  function power() {
    return scripts(term());
  }

  function group() {
    expect('{');
    const body = expression();
    expect('}', 'Thiếu dấu "}".');
    return body;
  }

  // Items of matrix{...}, stack{...}: "#" separates columns (or rows of a stack), "##" separates rows.
  function grid() {
    expect('{');
    const rows = [[]];
    for (;;) {
      rows[rows.length - 1].push(expression());
      if (accept('##')) rows.push([]);
      else if (!accept('#')) break;
    }
    expect('}', 'Thiếu dấu "}".');
    return rows;
  }

  function bracketToken() {
    const t = next();
    const key = t.type === 'char' || t.type === 'word' ? t.value : '';
    if (key === '\\') return bracketToken(); // \( in OpenOffice: a literal bracket
    if (!(key in BRACKETS)) throw new FormulaError(`"${t.value}" không phải là ngoặc.`, t.at);
    return BRACKETS[key];
  }

  function term() {
    const t = peek();
    if (t.type === 'end') throw new FormulaError('Công thức chưa kết thúc.', t.at);
    if (t.type === 'number') return { ...next(), k: 'atom', text: t.value, upright: true };
    if (t.type === 'text') return { ...next(), k: 'atom', text: t.value, upright: true };
    if (t.type === 'symbol') return { ...next(), k: 'atom', text: t.value, italic: t.italic, upright: !t.italic };
    const key = t.value;
    if (key === '{') return group();
    if (key === '(' || key === '[') {
      next();
      const body = expression([key === '(' ? ')' : ']']);
      expect(key === '(' ? ')' : ']', `Thiếu dấu "${key === '(' ? ')' : ']'}".`);
      return { k: 'fence', left: key, right: key === '(' ? ')' : ']', body };
    }
    if (key === 'lbrace' || key === 'langle' || key === 'lceil' || key === 'lfloor' || key === 'lline' || key === 'ldline' || key === 'ldbracket') {
      next();
      const close = { lbrace: 'rbrace', langle: 'rangle', lceil: 'rceil', lfloor: 'rfloor', lline: 'rline', ldline: 'rdline', ldbracket: 'rdbracket' }[key];
      const body = expression([close]);
      expect(close, `Thiếu "${close}".`);
      return { k: 'fence', left: BRACKETS[key], right: BRACKETS[close], body };
    }
    if (key === 'left') {
      next();
      const left = bracketToken();
      const body = expression();
      expect('right', 'Thiếu "right" cho "left".');
      return { k: 'fence', left, right: bracketToken(), body };
    }
    if (t.type === 'char' && key in UNARY && key !== '|') {
      next();
      return { k: 'row', items: [{ k: 'op', text: UNARY[key], unary: true }, power()] };
    }
    if (t.type === 'char') {
      next();
      return { k: 'atom', text: key, upright: true };
    }
    // words
    next();
    if (key === 'neg') return { k: 'row', items: [{ k: 'op', text: '¬', unary: true }, power()] };
    if (key === 'sqrt') return { k: 'sqrt', body: term() };
    if (key === 'nroot') return { k: 'sqrt', index: term(), body: term() };
    if (key === 'abs') return { k: 'fence', left: '|', right: '|', body: term() };
    if (key === 'fact') return { k: 'row', items: [term(), { k: 'atom', text: '!', upright: true }] };
    if (key === 'binom') return { k: 'fence', left: '(', right: ')', body: { k: 'stack', rows: [[term()], [term()]] } };
    if (key === 'stack') return { k: 'stack', rows: grid().flat().map((cell) => [cell]) };
    if (key === 'matrix') return { k: 'stack', rows: grid(), matrix: true };
    if (key === 'func') return { k: 'atom', text: next().value, upright: true };
    if (FUNCTIONS.has(key)) return { k: 'row', items: [{ k: 'atom', text: key, upright: true, func: true }, power()] };
    if (key in BIG_OPERATORS) {
      const node = { k: 'big', text: BIG_OPERATORS[key], limits: !INTEGRALS.has(key), word: key.startsWith('lim') };
      for (;;) {
        if (accept('from') || accept('csub') || accept('_') || accept('sub')) node.from = term();
        else if (accept('to') || accept('csup') || accept('^') || accept('sup')) node.to = term();
        else break;
      }
      node.body = power();
      return node;
    }
    if (key in ATTRIBUTES) return { k: 'attr', name: key, mark: ATTRIBUTES[key], body: term() };
    if (key === 'bold' || key === 'nbold') return { k: 'style', bold: key === 'bold', body: term() };
    if (key === 'ital' || key === 'italic' || key === 'nitalic') return { k: 'style', italic: key !== 'nitalic', body: term() };
    if (key === 'color') {
      const name = next();
      if (!(name.value in COLORS)) throw new FormulaError(`Màu "${name.value}" không có. Dùng: ${Object.keys(COLORS).join(', ')}.`, name.at);
      return { k: 'style', color: COLORS[name.value], body: term() };
    }
    if (key === 'size') {
      const n = next();
      const value = Number(String(n.value).replace(',', '.'));
      if (!Number.isFinite(value) || value <= 0) throw new FormulaError('Sau "size" cần một số cỡ chữ.', n.at);
      return { k: 'style', size: value, body: term() };
    }
    if (key === 'phantom') return { k: 'style', hidden: true, body: term() };
    if (key in SYMBOLS) return { k: 'atom', text: SYMBOLS[key], upright: true };
    if (key in GREEK) return { k: 'atom', text: GREEK[key], italic: true };
    if (key === 'newline') return { k: 'atom', text: ' ', upright: true };
    // Any other word is a variable name, set in italics as OpenOffice does.
    return { k: 'atom', text: key, italic: true };
  }

  const tree = expression();
  if (peek().type !== 'end') throw new FormulaError(`Không hiểu "${peek().value}" ở đây.`, peek().at);
  return tree;
}

// ---------- layout ----------

// A laid-out box: width, height above the baseline (asc) and below it (desc), and drawing ops with
// coordinates relative to the box's left end of the baseline (y grows downward).
function box(w, asc, desc, ops = []) {
  return { w, asc, desc, ops };
}

function shift(ops, dx, dy) {
  return ops.map((op) => (op.kind === 'text' ? { ...op, x: op.x + dx, y: op.y + dy } : { ...op, points: op.points.map(([x, y]) => [x + dx, y + dy]) }));
}

// Puts boxes next to each other on one baseline.
function hbox(boxes, gap = 0) {
  let x = 0;
  let asc = 0;
  let desc = 0;
  const ops = [];
  boxes.forEach((b, i) => {
    if (i) x += gap;
    ops.push(...shift(b.ops, x, 0));
    x += b.w;
    asc = Math.max(asc, b.asc);
    desc = Math.max(desc, b.desc);
  });
  return box(x, asc, desc, ops);
}

// Lays out a formula. Returns { w, h, ascent, ops } with ops relative to the top-left corner.
export function layoutFormula(src, { size = 14, color = '#000000', measure }) {
  const tree = parseFormula(src);
  const b = layoutNode(tree, { size, color, bold: false, italic: null, measure });
  const pad = size * 0.1;
  return { w: b.w + 2 * pad, h: b.asc + b.desc + 2 * pad, ascent: b.asc + pad, ops: shift(b.ops, pad, b.asc + pad) };
}

function textBox(text, style, { italic = false } = {}) {
  const { size, color, bold, measure } = style;
  const it = style.italic ?? italic;
  const w = measure(text, size, { bold, italic: it });
  const ops = style.hidden ? [] : [{ kind: 'text', text, x: 0, y: 0, size, bold, italic: it, color }];
  return box(w + (it ? size * 0.04 : 0), size * 0.76, size * 0.24, ops);
}

function line(x1, y1, x2, y2, style, width = style.size * 0.055) {
  return style.hidden ? [] : [{ kind: 'path', points: [[x1, y1], [x2, y2]], closed: false, stroke: style.color, width }];
}

// A stretchy bracket drawn as lines that spans `asc` above and `desc` below the baseline.
function bracketBox(ch, asc, desc, style, side) {
  const s = style.size;
  const h = asc + desc;
  const w = ch ? Math.max(s * 0.32, h * 0.12) : 0;
  if (!ch || style.hidden) return box(w, asc, desc);
  const top = -asc;
  const bot = desc;
  const mid = (top + bot) / 2;
  const lw = s * 0.06;
  const L = side === 'left';
  const x0 = L ? w * 0.85 : w * 0.15; // outer end of a stroke
  const x1 = L ? w * 0.2 : w * 0.8; // inner end
  let points;
  switch (ch) {
    case '(': case ')': {
      points = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const y = top + h * t;
        const bulge = Math.sin(Math.PI * t);
        points.push([x0 + (x1 - x0) * bulge, y]);
      }
      break;
    }
    case '[': case ']': case '⌈': case '⌉': case '⌊': case '⌋': case '⟦': case '⟧': {
      const capTop = ch !== '⌊' && ch !== '⌋';
      const capBottom = ch !== '⌈' && ch !== '⌉';
      points = [...(capTop ? [[x0, top]] : []), [x1, top], [x1, bot], ...(capBottom ? [[x0, bot]] : [])];
      break;
    }
    case '{': case '}': {
      const xm = (x0 + x1) / 2;
      points = [[x0, top], [xm, top + h * 0.06], [xm, mid - h * 0.06], [x1, mid], [xm, mid + h * 0.06], [xm, bot - h * 0.06], [x0, bot]];
      break;
    }
    case '⟨': case '⟩':
      points = [[x0, top], [x1, mid], [x0, bot]];
      break;
    case '‖':
      return box(w, asc, desc, [...line(w * 0.35, top, w * 0.35, bot, style, lw), ...line(w * 0.65, top, w * 0.65, bot, style, lw)]);
    default: // '|'
      points = [[w / 2, top], [w / 2, bot]];
  }
  return box(w, asc, desc, [{ kind: 'path', points, closed: false, stroke: style.color, width: lw }]);
}

function layoutNode(node, style) {
  const s = style.size;
  switch (node.k) {
    case 'row': {
      const parts = node.items.map((item, i) => {
        if (item.k === 'op') {
          const b = textBox(item.text, { ...style, italic: false });
          const pad = item.unary || i === 0 ? s * 0.05 : s * 0.22;
          return hbox([box(pad, 0, 0), b, box(item.unary || i === 0 ? 0 : pad, 0, 0)]);
        }
        if (item.func) return hbox([layoutNode(item, style), box(s * 0.12, 0, 0)]);
        return layoutNode(item, style);
      });
      return hbox(parts);
    }
    case 'atom':
      return textBox(node.text, style, { italic: !!node.italic && !node.upright });
    case 'op':
      return textBox(node.text, { ...style, italic: false });
    case 'frac': {
      const inner = { ...style, size: s * (s > 10 ? 0.85 : 1) };
      const num = layoutNode(node.num, inner);
      const den = layoutNode(node.den, inner);
      const w = Math.max(num.w, den.w) + s * 0.3;
      const axis = s * 0.3; // the fraction bar sits on the math axis, above the baseline
      const gap = s * 0.12;
      const ops = [
        ...shift(num.ops, (w - num.w) / 2, -axis - gap - num.desc),
        ...line(s * 0.05, -axis, w - s * 0.05, -axis, style),
        ...shift(den.ops, (w - den.w) / 2, -axis + gap + den.asc),
      ];
      return box(w, axis + gap + num.desc + num.asc, -axis + gap + den.asc + den.desc, ops);
    }
    case 'script': {
      const base = layoutNode(node.base, style);
      const small = { ...style, size: s * 0.7 };
      const sup = node.sup && layoutNode(node.sup, small);
      const sub = node.sub && layoutNode(node.sub, small);
      const lsup = node.lsup && layoutNode(node.lsup, small);
      const lsub = node.lsub && layoutNode(node.lsub, small);
      const csup = node.csup && layoutNode(node.csup, small);
      const csub = node.csub && layoutNode(node.csub, small);
      const left = Math.max(lsup?.w ?? 0, lsub?.w ?? 0);
      const center = Math.max(base.w, csup?.w ?? 0, csub?.w ?? 0);
      const right = Math.max(sup?.w ?? 0, sub?.w ?? 0);
      const supY = -Math.max(base.asc - s * 0.25, s * 0.45);
      const subY = Math.max(base.desc + s * 0.05, s * 0.22);
      const ops = [];
      const bx = left + (center - base.w) / 2;
      ops.push(...shift(base.ops, bx, 0));
      let asc = base.asc;
      let desc = base.desc;
      const place = (b, x, y) => {
        if (!b) return;
        ops.push(...shift(b.ops, x, y));
        asc = Math.max(asc, -y + b.asc);
        desc = Math.max(desc, y + b.desc);
      };
      place(sup, left + center + s * 0.04, supY);
      place(sub, left + center + s * 0.04, subY);
      place(lsup, left - lsup?.w, supY);
      place(lsub, left - lsub?.w, subY);
      if (csup) place(csup, left + (center - csup.w) / 2, -base.asc - s * 0.05 - csup.desc);
      if (csub) place(csub, left + (center - csub.w) / 2, base.desc + s * 0.05 + csub.asc);
      return box(left + center + (right ? right + s * 0.08 : 0), asc, desc, ops);
    }
    case 'sqrt': {
      const body = layoutNode(node.body, style);
      const gap = s * 0.12;
      const lw = s * 0.06;
      const top = -body.asc - gap;
      const hook = s * 0.55; // width of the radical sign
      const index = node.index && layoutNode(node.index, { ...style, size: s * 0.6 });
      const ix = index ? Math.max(0, index.w - hook * 0.45) : 0;
      const sign = [[ix, body.desc * 0.1 - s * 0.25], [ix + hook * 0.25, -s * 0.3], [ix + hook * 0.55, body.desc], [ix + hook, top], [ix + hook + body.w + s * 0.1, top]];
      const ops = [
        ...(style.hidden ? [] : [{ kind: 'path', points: sign, closed: false, stroke: style.color, width: lw }]),
        ...shift(body.ops, ix + hook + s * 0.05, 0),
      ];
      let asc = -top + lw;
      if (index) {
        const iy = -s * 0.45 - index.desc;
        ops.push(...shift(index.ops, 0, iy));
        asc = Math.max(asc, -iy + index.asc);
      }
      return box(ix + hook + body.w + s * 0.15, asc, Math.max(body.desc, s * 0.1), ops);
    }
    case 'big': {
      const big = { ...style, size: node.word ? s : s * (node.limits ? 1.5 : 1.6) };
      const sym = textBox(node.text, { ...big, italic: false });
      // Large symbols are centred on the math axis (0.3 em above the baseline); "lim" stays on it.
      const symY = node.word ? 0 : -s * 0.3 - (sym.desc - sym.asc) / 2;
      const opBox = box(sym.w, sym.asc - symY, sym.desc + symY, shift(sym.ops, 0, symY));
      const small = { ...style, size: s * 0.7 };
      const from = node.from && layoutNode(node.from, small);
      const to = node.to && layoutNode(node.to, small);
      let head;
      if (node.limits) {
        const w = Math.max(opBox.w, from?.w ?? 0, to?.w ?? 0);
        const ops = [...shift(opBox.ops, (w - opBox.w) / 2, 0)];
        let asc = opBox.asc;
        let desc = opBox.desc;
        if (to) {
          const y = -opBox.asc - s * 0.08 - to.desc;
          ops.push(...shift(to.ops, (w - to.w) / 2, y));
          asc = -y + to.asc;
        }
        if (from) {
          const y = opBox.desc + s * 0.08 + from.asc;
          ops.push(...shift(from.ops, (w - from.w) / 2, y));
          desc = y + from.desc;
        }
        head = box(w, asc, desc, ops);
      } else {
        const ops = [...opBox.ops];
        let asc = opBox.asc;
        let desc = opBox.desc;
        let w = opBox.w;
        if (to) {
          const y = -opBox.asc + to.asc * 0.6;
          ops.push(...shift(to.ops, opBox.w, y));
          asc = Math.max(asc, -y + to.asc);
          w = Math.max(w, opBox.w + to.w);
        }
        if (from) {
          const y = opBox.desc - from.desc * 0.3;
          ops.push(...shift(from.ops, opBox.w - s * 0.25, y));
          desc = Math.max(desc, y + from.desc);
          w = Math.max(w, opBox.w - s * 0.25 + from.w);
        }
        head = box(w, asc, desc, ops);
      }
      return hbox([head, box(s * 0.15, 0, 0), layoutNode(node.body, style)]);
    }
    case 'fence': {
      const body = layoutNode(node.body, style);
      const asc = Math.max(body.asc, s * 0.76) + s * 0.05;
      const desc = Math.max(body.desc, s * 0.24) + s * 0.05;
      return hbox([bracketBox(node.left, asc, desc, style, 'left'), box(s * 0.05, 0, 0), body, box(s * 0.05, 0, 0), bracketBox(node.right, asc, desc, style, 'right')]);
    }
    case 'attr': {
      const body = layoutNode(node.body, style);
      const ops = [...body.ops];
      let asc = body.asc;
      let desc = body.desc;
      if (node.mark === 'overline') {
        ops.push(...line(0, -body.asc - s * 0.08, body.w, -body.asc - s * 0.08, style));
        asc += s * 0.12;
      } else if (node.mark === 'underline') {
        ops.push(...line(0, body.desc + s * 0.06, body.w, body.desc + s * 0.06, style));
        desc += s * 0.1;
      } else if (node.mark === 'overstrike') {
        ops.push(...line(0, -s * 0.3, body.w, -s * 0.3, style));
      } else if (node.mark === '→') {
        const y = -body.asc - s * 0.12;
        ops.push(...line(0, y, body.w, y, style), { kind: 'path', points: [[body.w - s * 0.15, y - s * 0.08], [body.w, y], [body.w - s * 0.15, y + s * 0.08]], closed: false, stroke: style.color, width: s * 0.055 });
        asc += s * 0.22;
      } else {
        const accent = textBox(node.mark, { ...style, italic: false });
        ops.push(...shift(accent.ops, (body.w - accent.w) / 2, -body.asc + s * 0.62));
        asc += s * 0.3;
      }
      return box(body.w, asc, desc, ops);
    }
    case 'style': {
      const next = { ...style };
      if (node.bold !== undefined) next.bold = node.bold;
      if (node.italic !== undefined) next.italic = node.italic;
      if (node.color) next.color = node.color;
      if (node.size) next.size = node.size;
      if (node.hidden) next.hidden = true;
      return layoutNode(node.body, next);
    }
    case 'stack': {
      const cells = node.rows.map((r) => r.map((cell) => layoutNode(cell, style)));
      const cols = Math.max(...cells.map((r) => r.length));
      const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...cells.map((r) => r[c]?.w ?? 0)));
      const gapX = s * 0.6;
      const gapY = s * 0.25;
      const rowAsc = cells.map((r) => Math.max(s * 0.76, ...r.map((b) => b.asc)));
      const rowDesc = cells.map((r) => Math.max(s * 0.24, ...r.map((b) => b.desc)));
      const total = rowAsc.reduce((a, v, i) => a + v + rowDesc[i], 0) + gapY * (cells.length - 1);
      const w = colW.reduce((a, v) => a + v, 0) + gapX * (cols - 1);
      let y = -total / 2 - s * 0.3; // centred on the math axis
      const ops = [];
      cells.forEach((r, ri) => {
        y += rowAsc[ri];
        let x = 0;
        r.forEach((b, c) => {
          ops.push(...shift(b.ops, x + (colW[c] - b.w) / 2, y));
          x += colW[c] + gapX;
        });
        y += rowDesc[ri] + gapY;
      });
      return box(w, total / 2 + s * 0.3, total / 2 - s * 0.3, ops);
    }
    default:
      return box(0, 0, 0);
  }
}

// Plain-language list of the markup for the editor's help panel.
export const FORMULA_EXAMPLES = [
  ['a over b', 'phân số'], ['sqrt{x}', 'căn bậc hai'], ['nroot{3}{x}', 'căn bậc n'], ['x^2', 'mũ'], ['x_i', 'chỉ số dưới'],
  ['sum from{i=1} to{n} i', 'tổng'], ['int from a to b f(x) dx', 'tích phân'], ['lim from{x toward 0} {sin x} over x', 'giới hạn'],
  ['left( a over b right)', 'ngoặc co giãn'], ['%alpha + %beta', 'chữ Hy Lạp'], ['x <= y', 'so sánh'], ['a cdot b, a times b', 'nhân'],
  ['matrix{a # b ## c # d}', 'ma trận'], ['binom n k', 'tổ hợp'], ['bold x, color red x', 'đậm, màu'], ['vec v, hat a, overline{AB}', 'dấu trên'],
];


// ---------- LaTeX ----------

const LATEX_CHARS = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta', 'ι': '\\iota',
  'κ': '\\kappa', 'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ρ': '\\rho', 'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon',
  'φ': '\\varphi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega', 'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi',
  'Π': '\\Pi', 'Σ': '\\Sigma', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega', '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla', '∀': '\\forall',
  '∃': '\\exists', '∅': '\\emptyset', '·': '\\cdot', '×': '\\times', '÷': '\\div', '±': '\\pm', '∓': '\\mp', '−': '-', '≠': '\\neq', '≤': '\\leq',
  '≥': '\\geq', '≈': '\\approx', '∼': '\\sim', '≃': '\\simeq', '≡': '\\equiv', '∝': '\\propto', '∈': '\\in', '∉': '\\notin', '⊂': '\\subset',
  '⊃': '\\supset', '⊆': '\\subseteq', '⊇': '\\supseteq', '∪': '\\cup', '∩': '\\cap', '→': '\\to', '∧': '\\wedge', '∨': '\\vee', '¬': '\\neg',
  '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '≪': '\\ll', '≫': '\\gg',
  '⋯': '\\cdots', '…': '\\ldots', '⋮': '\\vdots', '∥': '\\parallel', '⊥': '\\perp', '∘': '\\circ', '⊕': '\\oplus', '⊗': '\\otimes',
  '⟨': '\\langle', '⟩': '\\rangle', '⌈': '\\lceil', '⌉': '\\rceil', '⌊': '\\lfloor', '⌋': '\\rfloor', '‖': '\\|', '{': '\\{', '}': '\\}',
};
const LATEX_ACCENTS = {
  hat: 'hat', widehat: 'widehat', tilde: 'tilde', widetilde: 'widetilde', bar: 'bar', overline: 'overline', underline: 'underline',
  vec: 'vec', widevec: 'overrightarrow', dot: 'dot', ddot: 'ddot', acute: 'acute', grave: 'grave', breve: 'breve', check: 'check', overstrike: 'cancel',
};

const latexText = (s) => [...s].map((ch) => (LATEX_CHARS[ch] ? `${LATEX_CHARS[ch]} ` : ch)).join('').trim();
const latexArg = (node) => `{${toLatex(node)}}`;

// LaTeX for a formula tree from parseFormula, or for OpenOffice Math markup text.
export function toLatex(node) {
  if (typeof node === 'string') return toLatex(parseFormula(node));
  switch (node.k) {
    case 'row':
      return node.items.map(toLatex).join(' ');
    case 'atom':
      if (node.func) return `\\${node.text}`;
      if (node.upright && /^[A-Za-z]{2,}$/.test(node.text)) return `\\text{${node.text}}`;
      return latexText(node.text);
    case 'op':
      return latexText(node.text);
    case 'frac':
      return `\\frac${latexArg(node.num)}${latexArg(node.den)}`;
    case 'script': {
      let s = node.lsup || node.lsub ? `{}${node.lsub ? `_${latexArg(node.lsub)}` : ''}${node.lsup ? `^${latexArg(node.lsup)}` : ''}` : '';
      let base = latexArg(node.base);
      if (node.csup) base = `\\overset${latexArg(node.csup)}${base}`;
      if (node.csub) base = `\\underset${latexArg(node.csub)}${base}`;
      s += base;
      if (node.sub) s += `_${latexArg(node.sub)}`;
      if (node.sup) s += `^${latexArg(node.sup)}`;
      return s;
    }
    case 'sqrt':
      return node.index ? `\\sqrt[${toLatex(node.index)}]${latexArg(node.body)}` : `\\sqrt${latexArg(node.body)}`;
    case 'big': {
      const op = node.word ? `\\operatorname{${node.text}}` : latexText(node.text);
      return `${op}${node.limits ? '\\limits' : ''}${node.from ? `_${latexArg(node.from)}` : ''}${node.to ? `^${latexArg(node.to)}` : ''} ${toLatex(node.body)}`;
    }
    case 'fence': {
      const b = (ch) => (ch ? (LATEX_CHARS[ch] ?? ch) : '.');
      return `\\left${b(node.left)} ${toLatex(node.body)} \\right${b(node.right)}`;
    }
    case 'attr':
      return `\\${LATEX_ACCENTS[node.name] ?? 'hat'}${latexArg(node.body)}`;
    case 'style': {
      let s = toLatex(node.body);
      if (node.bold) s = `\\mathbf{${s}}`;
      if (node.italic === false) s = `\\mathrm{${s}}`;
      if (node.color) s = `\\textcolor{${node.color}}{${s}}`;
      if (node.hidden) s = `\\phantom{${s}}`;
      return s;
    }
    case 'stack': {
      const env = node.matrix ? 'matrix' : 'array';
      const open = node.matrix ? '\\begin{matrix}' : '\\begin{array}{c}';
      return `${open} ${node.rows.map((r) => r.map(toLatex).join(' & ')).join(' \\\\ ')} \\end{${env}}`;
    }
    default:
      return '';
  }
}
