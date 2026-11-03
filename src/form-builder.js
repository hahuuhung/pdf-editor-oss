// Interactive 3-in-1 AcroForm suite:
// 1. On-page interactive form filling with natural top-to-bottom Tab order.
// 2. Visual Form Builder for TextField, CheckBox, Dropdown and RadioGroup.
// 3. One-click auto-detection of dotted/underlined blanks and empty checkboxes.

import { el, field, icon, openDialog } from './dom.js';

export const FORM_FIELD_KINDS = Object.freeze(['text', 'check', 'choice', 'radio']);

const KIND_LABELS = Object.freeze({
  text: 'Ô nhập chữ (TextField)',
  check: 'Hộp kiểm (CheckBox)',
  choice: 'Danh sách chọn (Dropdown)',
  radio: 'Nút chọn đơn (Radio)',
});

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// Converts a human label (including Vietnamese diacritics) into an ASCII AcroForm field name.
export function slugifyFieldName(raw, fallback = 'truong') {
  const folded = String(raw ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return folded || fallback;
}

// Ensures a unique AcroForm field name unless a RadioGroup intentionally shares its group name.
export function uniqueFieldName(desired, existingNames = [], { allowExisting = false } = {}) {
  const base = slugifyFieldName(desired, 'truong');
  if (allowExisting) return base;
  const taken = new Set(existingNames.map((n) => String(n)));
  if (!taken.has(base)) return base;
  let seq = 2;
  while (taken.has(`${base}_${seq}`)) seq++;
  return `${base}_${seq}`;
}

export function nextCustomFieldId(fields = []) {
  const max = fields.reduce((m, f) => Math.max(m, Number(String(f.id ?? '').replace(/^cf/, '')) || 0), 0);
  return `cf${max + 1}`;
}

// Normalizes a user-created AcroForm field definition stored in `state.settings.customFormFields`.
export function sanitizeCustomField(raw = {}, index = 1) {
  const kind = FORM_FIELD_KINDS.includes(raw.kind) ? raw.kind : 'text';
  const defaultSizes = {
    text: { w: 150, h: 22 },
    check: { w: 16, h: 16 },
    choice: { w: 140, h: 22 },
    radio: { w: 16, h: 16 },
  }[kind];
  const rawOptions = Array.isArray(raw.options)
    ? raw.options
    : typeof raw.options === 'string'
      ? raw.options.split(/[\n,;]+/)
      : [];
  const options = [...new Set(rawOptions.map((o) => String(o).trim()).filter(Boolean))];
  if (kind === 'choice' && !options.length) options.push('Lựa chọn 1', 'Lựa chọn 2');

  const optionValue = kind === 'radio'
    ? String(raw.optionValue || options[0] || `opt_${index}`).trim()
    : '';

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `cf${index}`,
    name: slugifyFieldName(raw.name, `${kind}_${index}`),
    label: String(raw.label ?? '').trim().slice(0, 80),
    kind,
    page: Math.max(0, Math.floor(Number(raw.page) || 0)),
    x: Math.round((Number.isFinite(Number(raw.x)) ? Number(raw.x) : 72) * 100) / 100,
    y: Math.round((Number.isFinite(Number(raw.y)) ? Number(raw.y) : 72) * 100) / 100,
    w: Math.max(10, Math.round((Number(raw.w) || defaultSizes.w) * 100) / 100),
    h: Math.max(10, Math.round((Number(raw.h) || defaultSizes.h) * 100) / 100),
    defaultValue: kind === 'check' ? !!raw.defaultValue : String(raw.defaultValue ?? ''),
    options,
    optionValue,
    multiline: kind === 'text' ? !!raw.multiline : false,
    required: !!raw.required,
    readOnly: !!raw.readOnly,
    fontSize: clamp(Math.round(Number(raw.fontSize) || 11), 7, 36),
  };
}

// Sorts widgets in reading order (row-major with 6pt vertical tolerance) for smooth Tab navigation.
export function sortWidgetsForTabOrder(widgets = []) {
  return [...widgets].sort((a, b) => {
    if ((a.page ?? 0) !== (b.page ?? 0)) return (a.page ?? 0) - (b.page ?? 0);
    if (Math.abs(a.y - b.y) > 6) return a.y - b.y;
    return a.x - b.x;
  });
}

export function rectsOverlap(a, b, pad = 1) {
  return (
    a.x < b.x + b.w - pad &&
    a.x + a.w > b.x + pad &&
    a.y < b.y + b.h - pad &&
    a.y + a.h > b.y + pad
  );
}

const BLANK_LINE_RE = /(\.{5,}|_{4,}|…{3,})/g;
const CHECKBOX_GLYPH_RE = /(☐|□|\[\s*\]|\(\s*\))/g;

// Scans PDF text items on a page to auto-detect fill-in dotted/underlined blanks and empty checkboxes.
export function detectCandidateFields(textItems = [], existingRects = [], { page = 0, existingNames = [] } = {}) {
  const valid = textItems
    .map((it) => ({
      str: String(it.str ?? it.text ?? ''),
      x: Number(it.x) || 0,
      y: Number(it.y) || 0,
      w: Math.max(0, Number(it.w) || 0),
      h: Math.max(6, Number(it.h) || 12),
    }))
    .filter((it) => it.str.length > 0)
    .sort((a, b) => (Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x));

  // Merge adjacent runs on the same row so split "Họ tên:" + "............" runs stay connected.
  const lines = [];
  for (const it of valid) {
    const prev = lines.at(-1);
    if (prev && Math.abs(prev.y - it.y) <= Math.max(prev.h, it.h) * 0.45 && it.x - prev.right <= 24) {
      if (it.x - prev.right > 2 && !prev.text.endsWith(' ') && !it.str.startsWith(' ')) prev.text += ' ';
      prev.text += it.str;
      prev.right = Math.max(prev.right, it.x + it.w);
      prev.h = Math.max(prev.h, it.h);
    } else {
      lines.push({ text: it.str, x: it.x, y: it.y, right: it.x + it.w, h: it.h });
    }
  }

  const usedNames = [...existingNames];
  const occupied = [...existingRects];
  const candidates = [];
  let seq = 1;

  for (const ln of lines) {
    const lineW = Math.max(12, ln.right - ln.x);
    const charW = lineW / Math.max(1, ln.text.length);

    // 1. Empty checkboxes: ☐, □, [ ], ( )
    CHECKBOX_GLYPH_RE.lastIndex = 0;
    let cm;
    while ((cm = CHECKBOX_GLYPH_RE.exec(ln.text)) !== null) {
      const boxSize = clamp(Math.round(ln.h * 0.95), 12, 20);
      const cx = ln.x + cm.index * charW;
      const cy = ln.y + (ln.h - boxSize) / 2;
      const rect = { x: Math.round(cx * 100) / 100, y: Math.round(cy * 100) / 100, w: boxSize, h: boxSize };
      if (occupied.some((r) => rectsOverlap(rect, r))) continue;
      const afterLabel = ln.text.slice(cm.index + cm[0].length, cm.index + cm[0].length + 28).trim();
      const name = uniqueFieldName(afterLabel || `chon_${page + 1}_${seq}`, usedNames);
      usedNames.push(name);
      occupied.push(rect);
      candidates.push(sanitizeCustomField({
        id: `auto_${page}_${seq++}`,
        name,
        label: afterLabel,
        kind: 'check',
        page,
        ...rect,
      }));
    }

    // 2. Dotted or underlined blanks: ........ or ________
    BLANK_LINE_RE.lastIndex = 0;
    let bm;
    while ((bm = BLANK_LINE_RE.exec(ln.text)) !== null) {
      const startRatio = bm.index / Math.max(1, ln.text.length);
      const spanRatio = bm[0].length / Math.max(1, ln.text.length);
      const fx = ln.x + lineW * startRatio;
      const fw = Math.max(36, lineW * spanRatio);
      const fh = clamp(Math.round(ln.h * 1.25), 16, 26);
      const fy = Math.max(0, ln.y - fh * 0.15);
      const rect = {
        x: Math.round(fx * 100) / 100,
        y: Math.round(fy * 100) / 100,
        w: Math.round(fw * 100) / 100,
        h: fh,
      };
      if (occupied.some((r) => rectsOverlap(rect, r))) continue;
      const prefix = ln.text.slice(Math.max(0, bm.index - 32), bm.index).replace(/[:\-–—.]+$/g, '').trim();
      const shortLabel = prefix.split(/[,;|]/).at(-1)?.trim() || '';
      const name = uniqueFieldName(shortLabel || `o_nhap_${page + 1}_${seq}`, usedNames);
      usedNames.push(name);
      occupied.push(rect);
      candidates.push(sanitizeCustomField({
        id: `auto_${page}_${seq++}`,
        name,
        label: shortLabel,
        kind: 'text',
        page,
        ...rect,
        fontSize: clamp(Math.round(ln.h / 1.15), 9, 14),
      }));
    }
  }

  return candidates;
}

// Modal dialog for creating or editing a custom AcroForm field.
export function openFormFieldDialog({ initial = {}, existingNames = [], isEdit = false, onSave, onDelete }) {
  const f = sanitizeCustomField(initial);
  const kindSel = el('select', {},
    FORM_FIELD_KINDS.map((k) => el('option', { value: k, selected: k === f.kind }, KIND_LABELS[k])),
  );
  const nameInput = el('input', { type: 'text', value: f.name, placeholder: 'VD: ho_va_ten', autofocus: true });
  const labelInput = el('input', { type: 'text', value: f.label, placeholder: 'VD: Họ và tên người nộp' });
  const defaultTextInput = el('input', { type: 'text', value: typeof f.defaultValue === 'string' ? f.defaultValue : '' });
  const defaultCheckInput = el('input', { type: 'checkbox', checked: f.defaultValue === true });
  const optionsArea = el('textarea', { rows: 3, placeholder: 'Mỗi dòng hoặc dấu phẩy một lựa chọn (VD: Nam, Nữ)' });
  optionsArea.value = f.options.join('\n');
  const radioValInput = el('input', { type: 'text', value: f.optionValue || 'lua_chon_1', placeholder: 'Giá trị của nút chọn này (VD: nam)' });
  const fontSizeInput = el('input', { type: 'number', min: 7, max: 36, value: f.fontSize });
  const multilineCheck = el('input', { type: 'checkbox', checked: f.multiline });
  const requiredCheck = el('input', { type: 'checkbox', checked: f.required });
  const readOnlyCheck = el('input', { type: 'checkbox', checked: f.readOnly });
  const errorEl = el('p', { class: 'dlg-error' });

  const defaultTextRow = field('Giá trị mặc định', defaultTextInput);
  const defaultCheckRow = el('label', { class: 'lbl small' }, defaultCheckInput, 'Đánh dấu sẵn mặc định');
  const optionsRow = field('Danh sách lựa chọn', optionsArea, 'Áp dụng cho hộp chọn Dropdown.');
  const radioRow = field('Giá trị nút Radio này', radioValInput, 'Đặt cùng "Tên trường định danh" cho các nút Radio thuộc cùng một nhóm.');
  const fontRow = field('Cỡ chữ (pt)', fontSizeInput);
  const multiRow = el('label', { class: 'lbl small' }, multilineCheck, 'Cho phép nhập nhiều dòng (Multiline)');

  const syncKindVisibility = () => {
    const k = kindSel.value;
    defaultTextRow.classList.toggle('hidden', k === 'check' || k === 'radio');
    defaultCheckRow.classList.toggle('hidden', k !== 'check');
    optionsRow.classList.toggle('hidden', k !== 'choice');
    radioRow.classList.toggle('hidden', k !== 'radio');
    fontRow.classList.toggle('hidden', k === 'check' || k === 'radio');
    multiRow.classList.toggle('hidden', k !== 'text');
  };
  kindSel.addEventListener('change', syncKindVisibility);
  syncKindVisibility();

  const actions = [
    { label: 'Hủy' },
    {
      label: isEdit ? 'Cập nhật trường' : 'Tạo trường',
      primary: true,
      run: () => {
        const k = kindSel.value;
        const rawName = nameInput.value.trim() || labelInput.value.trim();
        if (!rawName) {
          errorEl.textContent = 'Hãy nhập tên định danh cho trường biểu mẫu.';
          return false;
        }
        const otherNames = existingNames.filter((n) => n !== f.name);
        const finalName = uniqueFieldName(rawName, otherNames, { allowExisting: k === 'radio' });
        const saved = sanitizeCustomField({
          ...f,
          kind: k,
          name: finalName,
          label: labelInput.value,
          defaultValue: k === 'check' ? defaultCheckInput.checked : defaultTextInput.value,
          options: optionsArea.value,
          optionValue: radioValInput.value,
          fontSize: Number(fontSizeInput.value),
          multiline: multilineCheck.checked,
          required: requiredCheck.checked,
          readOnly: readOnlyCheck.checked,
        });
        onSave?.(saved);
      },
    },
  ];
  if (isEdit && onDelete) {
    actions.unshift({ label: 'Xóa trường', danger: true, run: () => onDelete(f.id) });
  }

  openDialog({
    title: isEdit ? 'Thuộc tính trường biểu mẫu' : 'Tạo trường biểu mẫu AcroForm',
    subtitle: 'Chuẩn PDF AcroForm tương thích Adobe Reader, Chrome & Edge',
    icon: 'form',
    width: 500,
    body: el('div', { class: 'fb-dlg' },
      el('div', { class: 'dlg-grid' },
        field('Loại trường', kindSel),
        field('Tên định danh (ID)', nameInput),
      ),
      field('Nhãn gợi nhớ (tùy chọn)', labelInput),
      defaultTextRow,
      defaultCheckRow,
      optionsRow,
      radioRow,
      fontRow,
      el('div', { class: 'fb-checks' },
        multiRow,
        el('label', { class: 'lbl small' }, requiredCheck, 'Bắt buộc điền (Required)'),
        el('label', { class: 'lbl small' }, readOnlyCheck, 'Chỉ đọc (Read-only)'),
      ),
      errorEl,
    ),
    actions,
  });
}

// Renders on-page AcroForm interactive inputs & visual designer handles on every PDF page.
export function createFormOverlayController({
  state,
  onLiveValue,
  onCommitValue,
  onEditCustomField,
  onMoveCustomField,
  onResizeCustomField,
}) {
  function isOverlayInteractive() {
    // Allow interacting with form widgets when using Select, FormField, or when viewing the Sign/Forms tab.
    return state.tool === 'select' || state.tool === 'formField';
  }

  function collectPageWidgets(pageIndex) {
    const out = [];
    // 1. Native AcroForm fields from the loaded PDF
    for (const f of state.formFields ?? []) {
      const widgets = f.widgets ?? [];
      widgets.forEach((w, idx) => {
        if (w.page !== pageIndex) return;
        out.push({
          key: `nat-${f.name}-${idx}`,
          custom: false,
          field: f,
          page: pageIndex,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
          optionValue: w.exportValue || f.options?.[idx] || `${idx + 1}`,
        });
      });
    }
    // 2. User-designed custom AcroForm fields from `state.settings.customFormFields`
    for (const cf of state.settings?.customFormFields ?? []) {
      if (cf.page !== pageIndex) continue;
      out.push({
        key: `cus-${cf.id}`,
        custom: true,
        customId: cf.id,
        field: {
          name: cf.name,
          label: cf.label,
          kind: cf.kind,
          value: cf.defaultValue,
          options: cf.options,
          multiline: cf.multiline,
          required: cf.required,
          readOnly: cf.readOnly,
          fontSize: cf.fontSize,
        },
        page: pageIndex,
        x: cf.x,
        y: cf.y,
        w: cf.w,
        h: cf.h,
        optionValue: cf.optionValue,
      });
    }
    return sortWidgetsForTabOrder(out);
  }

  function attachDesignerHandles(wrapper, item, pageDiv) {
    const badge = el('button', {
      type: 'button',
      class: 'acro-badge',
      title: `Kéo để di chuyển · Nhấp đúp để sửa "${item.field.name}"`,
    }, item.field.name);

    const editBtn = el('button', {
      type: 'button',
      class: 'acro-edit-btn',
      title: 'Cấu hình thuộc tính trường',
      onclick: (e) => {
        e.stopPropagation();
        onEditCustomField?.(item.customId);
      },
    }, icon('settings', 12));

    const resizeHandle = el('span', { class: 'acro-resize', title: 'Kéo để đổi kích thước ô' });

    badge.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      onEditCustomField?.(item.customId);
    });

    badge.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const z = state.zoom;
      const pageSize = state.pageSizes[item.page];
      let dx = 0;
      let dy = 0;
      let moved = false;

      const onMove = (ev) => {
        dx = (ev.clientX - startX) / z;
        dy = (ev.clientY - startY) / z;
        if (Math.abs(dx) > 0.6 || Math.abs(dy) > 0.6) moved = true;
        if (!moved) return;
        const nx = clamp(item.x + dx, 0, Math.max(0, pageSize.width - item.w));
        const ny = clamp(item.y + dy, 0, Math.max(0, pageSize.height - item.h));
        wrapper.style.left = `${nx * z}px`;
        wrapper.style.top = `${ny * z}px`;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) {
          const nx = clamp(item.x + dx, 0, Math.max(0, pageSize.width - item.w));
          const ny = clamp(item.y + dy, 0, Math.max(0, pageSize.height - item.h));
          onMoveCustomField?.(item.customId, nx, ny);
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    resizeHandle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const z = state.zoom;
      let nw = item.w;
      let nh = item.h;

      const onMove = (ev) => {
        nw = Math.max(12, item.w + (ev.clientX - startX) / z);
        nh = Math.max(12, item.h + (ev.clientY - startY) / z);
        wrapper.style.width = `${nw * z}px`;
        wrapper.style.height = `${nh * z}px`;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        onResizeCustomField?.(item.customId, nw, nh);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    wrapper.append(badge, editBtn, resizeHandle);
  }

  function renderPageFormLayer(pageIndex, pageDiv) {
    pageDiv?.querySelectorAll('.acroform-layer').forEach((n) => n.remove());
    if (!state.doc || !pageDiv) return;
    const widgets = collectPageWidgets(pageIndex);
    if (!widgets.length) return;

    const interactive = isOverlayInteractive();
    const designMode = state.tool === 'formField';
    const z = state.zoom;
    const values = state.settings?.formValues ?? {};

    const layer = el('div', {
      class: `acroform-layer${interactive ? ' interactive' : ''}${designMode ? ' design-mode' : ''}`,
    });

    for (const item of widgets) {
      const f = item.field;
      const curVal = values[f.name] !== undefined ? values[f.name] : f.value;
      const fontPx = Math.max(8, (f.fontSize || 11) * z);
      const wrapper = el('div', {
        class: `acro-widget kind-${f.kind}${item.custom ? ' is-custom' : ''}${f.required ? ' is-required' : ''}`,
        style: `left:${item.x * z}px;top:${item.y * z}px;width:${item.w * z}px;height:${item.h * z}px`,
      });

      wrapper.addEventListener('pointerdown', (e) => e.stopPropagation());

      let control;
      if (f.kind === 'check') {
        control = el('input', {
          type: 'checkbox',
          class: 'acro-input-check',
          checked: !!curVal,
          disabled: !!f.readOnly && !designMode,
          'aria-label': f.label || f.name,
          onchange: (e) => onCommitValue?.(f.name, e.target.checked),
        });
      } else if (f.kind === 'radio') {
        const optVal = item.optionValue || '1';
        control = el('input', {
          type: 'radio',
          name: `pdf-radio-${f.name}`,
          class: 'acro-input-radio',
          checked: String(curVal) === String(optVal),
          disabled: !!f.readOnly && !designMode,
          'aria-label': `${f.label || f.name}: ${optVal}`,
          onchange: (e) => {
            if (e.target.checked) onCommitValue?.(f.name, optVal);
          },
        });
      } else if (f.kind === 'choice') {
        control = el('select', {
          class: 'acro-input-select',
          style: `font-size:${fontPx}px`,
          disabled: !!f.readOnly && !designMode,
          'aria-label': f.label || f.name,
          onchange: (e) => onCommitValue?.(f.name, e.target.value),
        },
          el('option', { value: '' }, '— Chọn —'),
          (f.options ?? []).map((o) => el('option', { value: o, selected: o === curVal }, o)),
        );
      } else {
        control = el(f.multiline ? 'textarea' : 'input', {
          type: f.multiline ? undefined : 'text',
          class: 'acro-input-text',
          style: `font-size:${fontPx}px`,
          placeholder: f.label || (item.custom ? f.name : ''),
          readonly: f.readOnly && !designMode ? 'readonly' : undefined,
          'aria-label': f.label || f.name,
        });
        control.value = String(curVal ?? '');
        let initialVal = control.value;
        control.addEventListener('focus', () => {
          initialVal = control.value;
        });
        control.addEventListener('input', () => {
          onLiveValue?.(f.name, control.value);
        });
        control.addEventListener('blur', () => {
          if (control.value !== initialVal) onCommitValue?.(f.name, control.value, { alreadyUpdated: true });
        });
      }

      wrapper.append(control);
      if (item.custom && (designMode || state.tool === 'select')) {
        attachDesignerHandles(wrapper, item, pageDiv);
      }
      layer.append(wrapper);
    }

    pageDiv.append(layer);
  }

  function syncAllPages() {
    state.pageEls.forEach((div, i) => {
      if (div) renderPageFormLayer(i, div);
    });
  }

  return {
    renderPageFormLayer,
    syncAllPages,
  };
}
