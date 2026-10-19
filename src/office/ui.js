// User interface of the office tools: drawing shapes and connectors with the pointer, the editors
// for formulas, tables and rich text, and their controls in the properties bar. app.js passes an
// `api` with the editor functions these need, so this module never reaches into app.js state directly
// except through it.

import { el, field, icon, openDialog, svgEl } from '../dom.js';
import { markBounds } from '../marks.js';
import { SHAPE_PRESETS, nearestGlue, rerouteConnectors, shapeOutline } from './shapes.js';
import { FORMULA_EXAMPLES, FormulaError, layoutFormula } from './math.js';
import { TABLE_LIMITS, columnName, evaluateTable, layoutTable, newTable, sanitizeTable } from './table.js';
import { ALIGNS, richTextFromElement, richTextToHtml, sanitizeRichText } from './richtext.js';
import { CONNECTOR_STYLES, OFFICE_TYPES, connectorPoints, fitOffice, officeOps, opsToSvg } from './index.js';
import { measure, officeFontFamily } from './measure.js';

export const OFFICE_DRAG_TOOLS = new Set(['shape', 'connector', 'richtext']);
// Marks a connector can be glued to.
const GLUE_TYPES = new Set(['shape', 'rect', 'oval', 'stamp', 'image', 'formula', 'table', 'richtext', 'note']);
const GLUE_REACH = 14; // points

export function createOfficeUi(api) {
  const { state } = api;
  let shapePreset = 'rect';
  let connectorStyle = 'elbow';

  // ---------- drawing on the page ----------

  const boxOf = (id, page) => {
    const m = state.marks.find((k) => k.id === id);
    return m && m.page === page && GLUE_TYPES.has(m.type) ? markBounds(m) : null;
  };

  // The glue point under p on `page`, if any.
  function glueAt(page, p, skip) {
    let best = null;
    for (const m of state.marks) {
      if (m.page !== page || m.id === skip || !GLUE_TYPES.has(m.type)) continue;
      const g = nearestGlue(markBounds(m), p, GLUE_REACH);
      if (g && (!best || g.d < best.d)) best = { ...g, id: m.id };
    }
    return best;
  }

  // Draft of a mark from a pointer gesture of an office tool, or null when the gesture is too small.
  function draft(g) {
    if (g.tool === 'connector') {
      if (Math.hypot(g.x - g.x0, g.y - g.y0) < 3) return null;
      const a = glueAt(g.page, [g.x0, g.y0]);
      const b = glueAt(g.page, [g.x, g.y], a?.id);
      const data = { style: connectorStyle, arrowEnd: true, from: a && { id: a.id, site: a.site }, to: b && { id: b.id, site: b.site } };
      const points = connectorPoints(a?.point ?? [g.x0, g.y0], b?.point ?? [g.x, g.y], data);
      return { type: 'connector', page: g.page, points, data };
    }
    const x = Math.min(g.x0, g.x);
    const y = Math.min(g.y0, g.y);
    const w = Math.abs(g.x - g.x0);
    const h = Math.abs(g.y - g.y0);
    if (g.tool === 'richtext') {
      if (w < 3 && h < 3) return { type: 'richtext', page: g.page, x, y, w: 200, h: 40, data: sanitizeRichText({}) };
      return { type: 'richtext', page: g.page, x, y, w: Math.max(40, w), h: Math.max(20, h), data: sanitizeRichText({}) };
    }
    if (w < 3 && h < 3) return null;
    return { type: 'shape', page: g.page, x, y, w, h, data: { preset: shapePreset } };
  }

  // Glue points of the shapes on the page, shown while a connector is drawn.
  function glueHints(svg, page) {
    for (const m of state.marks) {
      if (m.page !== page || !GLUE_TYPES.has(m.type)) continue;
      const b = markBounds(m);
      for (const site of ['top', 'right', 'bottom', 'left']) {
        const [x, y] = { top: [b.x + b.w / 2, b.y], right: [b.x + b.w, b.y + b.h / 2], bottom: [b.x + b.w / 2, b.y + b.h], left: [b.x, b.y + b.h / 2] }[site];
        svg.append(svgEl('circle', { class: 'glue-hint preview', cx: x, cy: y, r: 3 }));
      }
    }
  }

  // Draws an office mark into its <g>. A formula that does not parse shows its error instead.
  function drawMark(g, m) {
    let ops;
    try {
      ops = officeOps(m, measure);
    } catch (err) {
      const t = svgEl('text', { x: m.x, y: m.y + 12, 'font-size': 10, fill: '#c62828', class: 'office-error' });
      t.textContent = `Lỗi công thức: ${err.message}`;
      g.append(t);
      ops = [];
    }
    const b = markBounds(m);
    if (m.type === 'connector') {
      // A wider invisible stroke makes the thin line easy to pick.
      g.append(svgEl('polyline', { points: m.points.map((p) => p.join(',')).join(' '), fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(8, m.width + 6) }));
    } else {
      g.append(svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent' }));
    }
    g.append(opsToSvg(ops, officeFontFamily()));
    if (m.type === 'richtext' && !m.data.paragraphs.some((p) => p.runs.length)) {
      g.append(svgEl('rect', { x: m.x, y: m.y, width: m.w, height: m.h, class: 'office-empty' }));
    }
    if (OFFICE_TYPES.has(m.type) && m.type !== 'shape' && m.type !== 'connector') {
      g.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        edit(m.id);
      });
    }
  }

  // Connectors follow the shapes they are glued to. Returns the marks to keep.
  const reroute = (marks) => rerouteConnectors(marks, boxOf);

  // ---------- creating and editing ----------

  // Places a new office mark in the middle of the visible page.
  function place(type, data) {
    const page = state.current;
    const size = state.pageSizes[page];
    const m = fitOffice({ type, page, x: 0, y: 0, w: 220, h: 40, color: '#000000', data }, measure);
    m.x = Math.max(0, (size.width - m.w) / 2);
    m.y = Math.max(0, (size.height - m.h) / 3);
    // Step down past items already there, so a new formula or table does not cover them.
    const overlaps = (b) => b.x < m.x + m.w && m.x < b.x + b.w && b.y < m.y + m.h && m.y < b.y + b.h;
    for (let guard = 0; guard < 50; guard++) {
      const hit = state.marks.filter((k) => k.page === page).map(markBounds).find(overlaps);
      if (!hit) break;
      m.y = hit.y + hit.h + 12;
    }
    m.y = Math.min(m.y, Math.max(0, size.height - m.h));
    return api.commitMark(m);
  }

  function edit(id) {
    const m = state.marks.find((k) => k.id === id);
    if (m?.type === 'formula') formulaDialog(m);
    else if (m?.type === 'table') tableDialog(m);
    else if (m?.type === 'richtext') richTextDialog(m);
  }

  function save(m, data) {
    if (m) api.updateMark(m.id, fitOffice({ ...m, data }, measure));
  }

  // ---------- formula editor ----------

  function formulaDialog(m = null) {
    const src = el('textarea', { class: 'office-code', rows: 4, spellcheck: 'false', autofocus: true, placeholder: 'Ví dụ: x = {-b +- sqrt{b^2 - 4ac}} over {2a}' });
    src.value = m?.data.src ?? '';
    const size = el('input', { type: 'number', min: 6, max: 96, value: Math.round(m?.data.size ?? 16) });
    const preview = el('div', { class: 'office-preview' });
    const error = el('p', { class: 'dlg-error' });
    const draw = () => {
      preview.replaceChildren();
      error.textContent = '';
      if (!src.value.trim()) return;
      try {
        const f = layoutFormula(src.value, { size: Number(size.value) || 16, measure });
        const svg = svgEl('svg', { viewBox: `0 0 ${f.w} ${f.h}`, width: f.w, height: f.h });
        svg.append(opsToSvg(f.ops, officeFontFamily()));
        preview.append(svg);
      } catch (err) {
        if (!(err instanceof FormulaError)) throw err;
        error.textContent = err.message;
      }
    };
    src.addEventListener('input', draw);
    size.addEventListener('input', draw);
    const insert = (text) => {
      const at = src.selectionStart ?? src.value.length;
      src.setRangeText(`${text} `, at, src.selectionEnd ?? at, 'end');
      src.focus();
      draw();
    };
    const examples = el('div', { class: 'office-examples' },
      FORMULA_EXAMPLES.map(([code, label]) => el('button', { type: 'button', title: code, onclick: () => insert(code.split(',')[0]) }, el('code', {}, code.split(',')[0]), el('span', {}, label))),
    );
    openDialog({
      title: m ? 'Sửa công thức' : 'Chèn công thức',
      subtitle: 'Cú pháp OpenOffice Math',
      icon: 'formula',
      width: 640,
      body: el('div', {}, field('Công thức', src), preview, error, field('Cỡ chữ (pt)', size), el('p', { class: 'dlg-label' }, 'Mẫu (bấm để chèn):'), examples),
      actions: [
        { label: 'Hủy' },
        {
          label: m ? 'Lưu' : 'Chèn',
          primary: true,
          run: () => {
            try {
              layoutFormula(src.value, { size: 16, measure });
            } catch (err) {
              if (!(err instanceof FormulaError)) throw err;
              error.textContent = err.message;
              return false;
            }
            if (!src.value.trim()) {
              error.textContent = 'Hãy nhập công thức.';
              return false;
            }
            const data = { src: src.value, size: Number(size.value) || 16 };
            if (m) save(m, data);
            else place('formula', data);
          },
        },
      ],
    });
    draw();
  }

  // ---------- table editor ----------

  function tableDialog(m = null) {
    let t = sanitizeTable(m?.data ?? newTable(3, 3));
    const grid = el('div', { class: 'office-grid' });
    const preview = el('div', { class: 'office-preview' });
    const rows = el('input', { type: 'number', min: 1, max: TABLE_LIMITS.rows, value: t.rows });
    const cols = el('input', { type: 'number', min: 1, max: TABLE_LIMITS.cols, value: t.cols });
    const fontSize = el('input', { type: 'number', min: 5, max: 48, value: t.fontSize });
    const header = el('input', { type: 'checkbox', checked: t.header });
    const drawPreview = () => {
      const lay = layoutTable(t, { measure });
      const svg = svgEl('svg', { viewBox: `-1 -1 ${lay.w + 2} ${lay.h + 2}`, width: Math.min(560, lay.w + 2) });
      svg.append(opsToSvg(lay.ops, officeFontFamily()));
      preview.replaceChildren(svg);
      const values = evaluateTable(t);
      grid.querySelectorAll('input[data-r]').forEach((input) => {
        const v = values[input.dataset.r][input.dataset.c];
        input.title = input.value.startsWith('=') ? `= ${v.text}` : '';
        input.classList.toggle('error', !!v.error);
      });
    };
    const drawGrid = () => {
      grid.replaceChildren();
      grid.style.gridTemplateColumns = `28px repeat(${t.cols}, minmax(70px, 1fr))`;
      grid.append(el('span'), ...Array.from({ length: t.cols }, (_, c) => el('span', { class: 'office-head' }, columnName(c))));
      t.cells.forEach((row, r) => {
        grid.append(el('span', { class: 'office-head' }, `${r + 1}`));
        row.forEach((text, c) => {
          const input = el('input', { type: 'text', value: text, 'data-r': r, 'data-c': c, 'aria-label': `${columnName(c)}${r + 1}` });
          input.addEventListener('input', () => {
            t.cells[r][c] = input.value;
            drawPreview();
          });
          grid.append(input);
        });
      });
      drawPreview();
    };
    const resize = () => {
      t = sanitizeTable({ ...t, rows: rows.value, cols: cols.value, fontSize: fontSize.value, header: header.checked });
      drawGrid();
    };
    for (const input of [rows, cols, fontSize, header]) input.addEventListener('change', resize);
    openDialog({
      title: m ? 'Sửa bảng' : 'Chèn bảng',
      subtitle: 'Công thức như bảng tính: =SUM(B2:B4), =AVERAGE(...), =B2*C2',
      icon: 'table',
      width: 720,
      body: el('div', {},
        el('div', { class: 'dlg-grid' }, field('Số hàng', rows), field('Số cột', cols), field('Cỡ chữ', fontSize)),
        el('label', { class: 'lbl small' }, header, 'Hàng đầu là tiêu đề (chữ đậm, có nền)'),
        el('div', { class: 'office-grid-wrap' }, grid),
        el('p', { class: 'dlg-label' }, 'Xem trước:'),
        preview,
      ),
      actions: [
        { label: 'Hủy' },
        {
          label: m ? 'Lưu' : 'Chèn',
          primary: true,
          run: () => {
            const data = sanitizeTable({ ...t, fontSize: fontSize.value, header: header.checked });
            if (m) save(m, data);
            else place('table', data);
          },
        },
      ],
    });
    drawGrid();
  }

  // ---------- rich text editor ----------

  function richTextDialog(m) {
    const d = sanitizeRichText(m.data);
    const editor = el('div', { class: 'office-richtext', contenteditable: 'true', spellcheck: 'false', role: 'textbox', 'aria-multiline': 'true', autofocus: true });
    editor.innerHTML = richTextToHtml(d);
    editor.style.fontSize = `${d.fontSize}px`;
    editor.style.fontFamily = officeFontFamily();
    editor.style.lineHeight = String(d.lineHeight);
    const fontSize = el('input', { type: 'number', min: 5, max: 72, value: d.fontSize, title: 'Cỡ chữ' });
    const lineHeight = el('select', { title: 'Giãn dòng' }, [1, 1.15, 1.25, 1.5, 2].map((v) => el('option', { value: v, selected: v === d.lineHeight }, `${v}`)));
    const color = el('input', { type: 'color', value: '#c62828', title: 'Màu chữ' });
    fontSize.addEventListener('input', () => (editor.style.fontSize = `${Number(fontSize.value) || 12}px`));
    lineHeight.addEventListener('change', () => (editor.style.lineHeight = lineHeight.value));
    const exec = (cmd, value) => {
      editor.focus();
      document.execCommand(cmd, false, value);
    };
    // The paragraph blocks the selection touches.
    const blocks = () => {
      const sel = window.getSelection();
      if (!sel.rangeCount) return [];
      if (!editor.firstElementChild) editor.innerHTML = '<div><br></div>';
      const range = sel.getRangeAt(0);
      return [...editor.children].filter((b) => range.intersectsNode(b));
    };
    const setList = (list) => {
      const bs = blocks();
      const all = bs.every((b) => b.dataset.list === list);
      for (const b of bs) {
        if (all) delete b.dataset.list;
        else b.dataset.list = list;
      }
    };
    const setAlign = (align) => {
      for (const b of blocks()) b.style.textAlign = align;
    };
    const tb = (iconName, label, run) => el('button', { type: 'button', class: 'icon', title: label, 'aria-label': label, onmousedown: (e) => e.preventDefault(), onclick: run }, icon(iconName, 16));
    const toolbar = el('div', { class: 'office-toolbar' },
      tb('bold', 'Đậm (Ctrl+B)', () => exec('bold')),
      tb('italic', 'Nghiêng (Ctrl+I)', () => exec('italic')),
      tb('underline', 'Gạch chân (Ctrl+U)', () => exec('underline')),
      el('label', { class: 'office-color', title: 'Màu chữ' }, color, el('button', { type: 'button', class: 'icon', onmousedown: (e) => e.preventDefault(), onclick: () => exec('foreColor', color.value) }, icon('textColor', 16))),
      el('span', { class: 'sep' }),
      ...ALIGNS.map((a) => tb(`align${a[0].toUpperCase()}${a.slice(1)}`, { left: 'Căn trái', center: 'Căn giữa', right: 'Căn phải', justify: 'Căn đều' }[a], () => setAlign(a))),
      el('span', { class: 'sep' }),
      tb('listBullet', 'Danh sách dấu chấm', () => setList('bullet')),
      tb('listNumber', 'Danh sách đánh số', () => setList('number')),
      el('span', { class: 'sep' }),
      el('label', { class: 'lbl' }, 'Cỡ', fontSize),
      el('label', { class: 'lbl' }, 'Giãn dòng', lineHeight),
    );
    // Pasted text keeps only plain text; formatting is applied with the toolbar.
    editor.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    document.execCommand('defaultParagraphSeparator', false, 'div');
    openDialog({
      title: 'Hộp chữ định dạng',
      subtitle: 'Chữ đậm, nghiêng, gạch chân, màu, căn lề và danh sách',
      icon: 'text',
      width: 640,
      body: el('div', {}, toolbar, editor),
      actions: [
        { label: 'Hủy' },
        {
          label: 'Lưu',
          primary: true,
          run: () => save(m, richTextFromElement(editor, { fontSize: Number(fontSize.value), lineHeight: Number(lineHeight.value) })),
        },
      ],
    });
  }

  // ---------- properties bar ----------

  // Extra controls for the properties bar: `type` is the selected mark's (or tool's) type.
  function props(type, item, { setTool }) {
    const row = [];
    if (type === 'shape') {
      const current = item?.data.preset ?? shapePreset;
      const picker = el('select', { 'aria-label': 'Kiểu hình' }, SHAPE_PRESETS.map(([id, label]) => el('option', { value: id, selected: id === current }, label)));
      picker.addEventListener('change', () => {
        if (item) api.updateMark(item.id, { ...item, data: { ...item.data, preset: picker.value } });
        else shapePreset = picker.value;
      });
      row.push(el('label', { class: 'lbl' }, 'Hình', picker), shapeGallery(current, (id) => {
        picker.value = id;
        picker.dispatchEvent(new Event('change'));
      }));
    }
    if (type === 'connector') {
      const current = item?.data.style ?? connectorStyle;
      const style = el('select', { 'aria-label': 'Kiểu đường nối' }, CONNECTOR_STYLES.map((s) => el('option', { value: s, selected: s === current }, s === 'elbow' ? 'Gấp khúc' : 'Thẳng')));
      style.addEventListener('change', () => {
        if (!item) {
          connectorStyle = style.value;
          return;
        }
        const data = { ...item.data, style: style.value };
        api.updateMark(item.id, { ...item, data, points: connectorPoints(item.points[0], item.points.at(-1), data) });
      });
      row.push(el('label', { class: 'lbl' }, 'Kiểu', style));
      if (item) {
        const arrow = (key, label) => {
          const box = el('input', { type: 'checkbox', checked: key === 'arrowEnd' ? item.data.arrowEnd !== false : !!item.data.arrowStart });
          box.addEventListener('change', () => api.updateMark(item.id, { ...item, data: { ...item.data, [key]: box.checked } }));
          return el('label', { class: 'lbl' }, box, label);
        };
        row.push(arrow('arrowStart', 'Mũi tên đầu'), arrow('arrowEnd', 'Mũi tên cuối'));
      } else {
        row.push(el('span', { class: 'lbl' }, 'Kéo từ hình này sang hình khác để nối; đầu đường nối bám vào các điểm nối của hình.'));
      }
    }
    if (item && (type === 'formula' || type === 'table' || type === 'richtext')) {
      row.push(el('button', { type: 'button', onclick: () => edit(item.id) }, icon('edit', 16), type === 'formula' ? 'Sửa công thức…' : type === 'table' ? 'Sửa bảng…' : 'Sửa chữ…'));
    }
    if (!item && type === 'richtext') row.push(el('span', { class: 'lbl' }, 'Kéo một khung trên trang, rồi gõ chữ trong hộp thoại.'));
    void setTool;
    return row;
  }

  // Small buttons with each preset's outline.
  function shapeGallery(current, pick) {
    const wrap = el('span', { class: 'shape-gallery' });
    for (const [id, label] of SHAPE_PRESETS) {
      const svg = svgEl('svg', { viewBox: '-1 -1 22 22', width: 18, height: 18, 'aria-hidden': 'true' });
      svg.append(svgEl('polygon', { points: shapeOutline(id, 0, 0, 20, 20).map((p) => p.join(',')).join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
      wrap.append(el('button', { type: 'button', class: `icon${id === current ? ' on' : ''}`, title: label, 'aria-label': label, onclick: () => pick(id) }, svg));
    }
    return wrap;
  }

  return {
    draft,
    drawMark,
    glueHints,
    reroute,
    edit,
    props,
    afterCommit(id, type) {
      if (type === 'richtext') edit(id);
    },
    insertFormula: () => formulaDialog(),
    insertTable: () => tableDialog(),
  };
}
