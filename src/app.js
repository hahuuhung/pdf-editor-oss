// Entry point: builds the editor shell (menu bar, mode tabs, toolbar, properties bar, thumbnails,
// side panels, dialogs, command palette) and wires it to the PDF.js page view, the item models,
// page operations and the pdf-lib exporter.
//
// Every item is stored in view space: PDF points at scale 1 with the page's rotation applied,
// origin top-left (see geometry.js). Text boxes are scaled by the zoom factor; markup is drawn in an
// SVG whose viewBox is the page size, so zooming never changes stored coordinates.
//
// Undo snapshots hold { boxes, marks, settings, pdfBytes }. All four are replaced, never mutated,
// so a snapshot is just four references. Page operations produce new bytes and reload the view.

import { addBox, clampFontSize, nextId, removeBox, updateBox } from './model.js';
import {
  MARK_DEFAULTS,
  NOTE_SIZE,
  RESIZABLE_TYPES,
  STAMP_LABELS,
  addMark,
  arrowHeadPoints,
  markBounds,
  marksOnPage,
  moveMark,
  nextMarkId,
  normalizeRect,
  removeMark,
  resizeMark,
  safeUrl,
  sanitizeMark,
  simplifyInk,
  updateMark,
  zigzagPoints,
} from './marks.js';
import { formatPageRange, parsePageRange, remapDeleted, remapInserted, remapMoved } from './pages.js';
import {
  HEADER_FOOTER_SLOTS,
  batesLabel,
  formatTokens,
  sanitizeHeaderFooter,
  sanitizeMeta,
  sanitizeWatermark,
  todayLabel,
} from './docsettings.js';
import { findInItems } from './search.js';
import {
  appendPdf,
  blankPdf,
  deletePages,
  duplicatePage,
  extractPages,
  imagesToPdf,
  insertBlankPage,
  movePage,
  readFormFields,
  rotatePages,
} from './pdfops.js';
import { rasterizeRedactions } from './redact.js';
import { compressPdf, decryptPdf, encryptPdf, isEncrypted } from './protect.js';
import { OCR_LANGUAGES, ocrPage } from './ocr.js';
import { buildDocx, extractImages, zipFiles } from './extract.js';
import { groupLines, pagesToHtml, pagesToText } from './textlayout.js';
import { exportPdf } from './export.js';
import { confirmDialog, el, field, icon, iconButton, isDialogOpen, openDialog, svgEl } from './dom.js';

const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const HISTORY_LIMIT = 100;
const EMPTY_SETTINGS = Object.freeze({
  watermark: null,
  headerFooter: null,
  meta: null,
  formValues: {},
  flattenForm: false,
  protection: null, // { userPassword, ownerPassword, allowPrint, allowCopy, allowModify } applied on save
  sanitize: false,
  ocrWords: [], // [{ page, text, x, y, w, h }] written as an invisible text layer
});

// ---------- tools, actions, modes ----------

const TOOL_INFO = {
  select: { label: 'Chọn', icon: 'cursor' },
  text: { label: 'Thêm chữ', icon: 'text' },
  date: { label: 'Ngày hôm nay', icon: 'date', type: 'text' },
  note: { label: 'Ghi chú', icon: 'note' },
  highlight: { label: 'Tô sáng', icon: 'highlight' },
  underline: { label: 'Gạch chân', icon: 'underline' },
  strike: { label: 'Gạch ngang', icon: 'strike' },
  squiggly: { label: 'Gạch sóng', icon: 'squiggly' },
  rect: { label: 'Hình chữ nhật', icon: 'rect' },
  oval: { label: 'Hình elip', icon: 'oval' },
  line: { label: 'Đường thẳng', icon: 'line' },
  arrow: { label: 'Mũi tên', icon: 'arrow' },
  ink: { label: 'Vẽ tự do', icon: 'ink' },
  stamp: { label: 'Con dấu', icon: 'stamp' },
  link: { label: 'Liên kết', icon: 'link' },
  redact: { label: 'Vùng che', icon: 'redact' },
  check: { label: 'Dấu tích', icon: 'check', type: 'symbol', symbol: 'check' },
  cross: { label: 'Dấu chéo', icon: 'cross', type: 'symbol', symbol: 'cross' },
  dot: { label: 'Dấu chấm', icon: 'dot', type: 'symbol', symbol: 'dot' },
};
const TYPE_LABELS = { text: 'Chữ', image: 'Hình ảnh', symbol: 'Ký hiệu' };
const DRAG_TOOLS = new Set(['highlight', 'underline', 'strike', 'squiggly', 'rect', 'oval', 'line', 'arrow', 'ink', 'link', 'redact']);
const STROKE_TYPES = new Set(['underline', 'strike', 'squiggly', 'rect', 'oval', 'line', 'arrow', 'ink', 'stamp', 'symbol']);

const typeLabel = (type) => TYPE_LABELS[type] ?? TOOL_INFO[type]?.label ?? type;
const toolType = (tool) => TOOL_INFO[tool]?.type ?? tool;

// Commands shared by menus, toolbars, the command palette and shortcuts.
const ACTIONS = {
  open: { label: 'Mở PDF…', icon: 'open', key: 'Ctrl+O', run: () => els.pdfInput.click() },
  newBlank: { label: 'Tài liệu trống mới', icon: 'file', run: newBlankDocument },
  imagesToPdf: { label: 'Tạo PDF từ ảnh…', icon: 'image', run: () => els.imagesPdfInput.click() },
  export: { label: 'Xuất PDF', icon: 'save', key: 'Ctrl+S', needsDoc: true, run: exportCurrent },
  exportImage: { label: 'Xuất trang thành ảnh PNG', icon: 'png', needsDoc: true, run: exportPageImage },
  print: { label: 'In…', icon: 'print', key: 'Ctrl+P', needsDoc: true, run: printDocument },
  chooseFont: { label: 'Chọn font .ttf…', icon: 'text', run: () => els.fontInput.click() },
  properties: { label: 'Thuộc tính tài liệu…', icon: 'info', needsDoc: true, run: openPropertiesDialog },
  undo: { label: 'Hoàn tác', icon: 'undo', key: 'Ctrl+Z', run: undo },
  redo: { label: 'Làm lại', icon: 'redo', key: 'Ctrl+Y', run: redo },
  delete: { label: 'Xóa mục đã chọn', icon: 'trash', key: 'Del', needsDoc: true, run: deleteSelected },
  find: { label: 'Tìm trong tài liệu', icon: 'search', key: 'Ctrl+F', needsDoc: true, run: openSearch },
  palette: { label: 'Tìm công cụ và lệnh…', icon: 'command', key: 'Ctrl+K', run: openPalette },
  zoomIn: { label: 'Phóng to', icon: 'zoomIn', key: 'Ctrl++', run: () => zoomBy(1) },
  zoomOut: { label: 'Thu nhỏ', icon: 'zoomOut', key: 'Ctrl+-', run: () => zoomBy(-1) },
  zoom100: { label: 'Thực tế 100%', icon: 'fitPage', key: 'Ctrl+0', run: () => setZoom(1) },
  fitPage: { label: 'Vừa trang', icon: 'fitPage', key: 'Ctrl+1', run: () => fitTo('page') },
  fitWidth: { label: 'Vừa chiều rộng', icon: 'fitWidth', key: 'Ctrl+2', run: () => fitTo('width') },
  rotateLeft: { label: 'Xoay trang sang trái', icon: 'rotateLeft', needsDoc: true, run: () => rotateCurrent(-90) },
  rotateRight: { label: 'Xoay trang sang phải', icon: 'rotateRight', needsDoc: true, run: () => rotateCurrent(90) },
  movePageUp: { label: 'Đưa trang lên trước', icon: 'up', needsDoc: true, run: () => moveCurrent(-1) },
  movePageDown: { label: 'Đưa trang ra sau', icon: 'down', needsDoc: true, run: () => moveCurrent(1) },
  insertBlank: { label: 'Chèn trang trắng', icon: 'pageAdd', needsDoc: true, run: insertBlankAfter },
  duplicatePage: { label: 'Nhân bản trang', icon: 'pageCopy', needsDoc: true, run: duplicateCurrent },
  deletePage: { label: 'Xóa trang', icon: 'trash', needsDoc: true, run: deleteCurrentPage },
  extractPages: { label: 'Trích xuất trang…', icon: 'extract', needsDoc: true, run: openExtractDialog },
  combine: { label: 'Kết hợp thêm tệp PDF…', icon: 'merge', needsDoc: true, run: () => els.combineInput.click() },
  insertImage: { label: 'Chèn ảnh…', icon: 'image', needsDoc: true, run: () => els.imageInput.click() },
  signature: { label: 'Chữ ký…', icon: 'signature', needsDoc: true, run: openSignaturePad },
  watermark: { label: 'Hình mờ…', icon: 'watermark', needsDoc: true, run: openWatermarkDialog },
  headerFooter: { label: 'Đầu/chân trang & số Bates…', icon: 'header', needsDoc: true, run: openHeaderFooterDialog },
  forms: { label: 'Điền biểu mẫu', icon: 'form', needsDoc: true, run: () => showPanel('forms') },
  ocr: { label: 'Nhận dạng chữ (OCR)…', icon: 'scan', needsDoc: true, run: openOcrDialog },
  toggleOcr: { label: 'Hiện/ẩn khung chữ OCR', icon: 'scan', needsDoc: true, checked: () => state.showOcr, run: toggleOcrBoxes },
  exportText: { label: 'Xuất văn bản (.txt)', icon: 'file', needsDoc: true, run: () => exportContent('txt') },
  exportWord: { label: 'Xuất Word (.docx)', icon: 'word', needsDoc: true, run: () => exportContent('docx') },
  exportHtml: { label: 'Xuất trang web (.html)', icon: 'html', needsDoc: true, run: () => exportContent('html') },
  extractImages: { label: 'Tách tất cả ảnh (.zip)', icon: 'images', needsDoc: true, run: extractAllImages },
  compress: { label: 'Giảm dung lượng', icon: 'compress', needsDoc: true, run: compressDocument },
  protect: { label: 'Đặt mật khẩu…', icon: 'lock', needsDoc: true, run: openProtectDialog },
  sanitize: { label: 'Xóa thông tin ẩn…', icon: 'sanitize', needsDoc: true, checked: () => state.settings.sanitize, run: openSanitizeDialog },
  themeSystem: { label: 'Chủ đề theo hệ thống', icon: 'info', checked: () => state.theme === 'system', run: () => applyTheme('system') },
  themeLight: { label: 'Chủ đề sáng', icon: 'info', checked: () => state.theme === 'light', run: () => applyTheme('light') },
  themeDark: { label: 'Chủ đề tối', icon: 'info', checked: () => state.theme === 'dark', run: () => applyTheme('dark') },
  shortcuts: { label: 'Phím tắt', icon: 'command', run: showShortcuts },
};

const MENUS = [
  { label: 'Tệp', items: ['open', 'newBlank', 'imagesToPdf', '-', 'export', 'exportImage', 'print', '-', 'chooseFont', 'properties'] },
  { label: 'Sửa', items: ['undo', 'redo', '-', 'delete', '-', 'find', 'palette'] },
  { label: 'Xem', items: ['zoomIn', 'zoomOut', 'zoom100', 'fitPage', 'fitWidth', '-', 'themeSystem', 'themeLight', 'themeDark'] },
  { label: 'Trang', items: ['rotateLeft', 'rotateRight', 'movePageUp', 'movePageDown', '-', 'insertBlank', 'duplicatePage', 'deletePage', '-', 'extractPages', 'combine'] },
  {
    label: 'Công cụ',
    items: [
      { tool: 'note' }, { tool: 'highlight' }, { tool: 'underline' }, { tool: 'strike' }, { tool: 'rect' }, { tool: 'ink' }, { tool: 'stamp' },
      '-', { tool: 'text' }, 'insertImage', { tool: 'link' }, 'watermark', 'headerFooter',
      '-', 'signature', { tool: 'check' }, { tool: 'date' }, 'forms',
      '-', { tool: 'redact' },
    ],
  },
  { label: 'Chuyển đổi', items: ['ocr', 'toggleOcr', '-', 'exportText', 'exportWord', 'exportHtml', 'extractImages', 'exportImage', '-', 'compress'] },
  { label: 'Bảo vệ', items: ['protect', 'sanitize', '-', { tool: 'redact' }] },
  { label: 'Trợ giúp', items: ['shortcuts', 'palette'] },
];

// Mode tabs use the tool-group hues of the reference app (pdfcraft catalog).
const MODES = {
  read: { label: 'Đọc', hue: 'var(--blue)', groups: [['select'], [{ action: 'find' }, { action: 'print' }]], defaultTool: 'select' },
  comment: {
    label: 'Chú thích',
    hue: 'var(--orange)',
    groups: [['select'], ['note', 'highlight', 'underline', 'strike', 'squiggly'], ['rect', 'oval', 'line', 'arrow', 'ink', 'stamp']],
    defaultTool: 'highlight',
  },
  edit: {
    label: 'Chỉnh sửa',
    hue: 'var(--pink)',
    groups: [['select', 'text', 'link'], [{ action: 'insertImage' }, { action: 'watermark' }, { action: 'headerFooter' }, { action: 'properties' }]],
    defaultTool: 'select',
  },
  organize: {
    label: 'Trang',
    hue: 'var(--green)',
    groups: [
      ['select'],
      [{ action: 'rotateLeft' }, { action: 'rotateRight' }, { action: 'movePageUp' }, { action: 'movePageDown' }],
      [{ action: 'insertBlank' }, { action: 'duplicatePage' }, { action: 'deletePage' }],
      [{ action: 'extractPages' }, { action: 'combine' }, { action: 'exportImage' }],
    ],
    defaultTool: 'select',
  },
  sign: {
    label: 'Ký & điền',
    hue: 'var(--purple)',
    groups: [['select', 'text', 'date'], ['check', 'cross', 'dot'], [{ action: 'signature' }, { action: 'forms' }]],
    defaultTool: 'select',
  },
  convert: {
    label: 'Chuyển đổi',
    hue: 'var(--teal)',
    groups: [
      ['select'],
      [{ action: 'ocr' }, { action: 'toggleOcr' }],
      [{ action: 'exportWord' }, { action: 'exportText' }, { action: 'exportHtml' }, { action: 'extractImages' }, { action: 'exportImage' }],
      [{ action: 'compress' }],
    ],
    defaultTool: 'select',
  },
  protect: {
    label: 'Bảo vệ',
    hue: 'var(--red)',
    groups: [['select', 'redact'], [{ action: 'find' }], [{ action: 'protect' }, { action: 'sanitize' }]],
    defaultTool: 'redact',
  },
};

// ---------- DOM and state ----------

const $ = (id) => document.getElementById(id);
const els = {
  menubar: $('menubar'),
  modebar: $('modebar'),
  toolbar: $('toolbar'),
  propsbar: $('propsbar'),
  thumbs: $('thumbs'),
  thumbActions: $('thumb-actions'),
  view: $('pages'),
  panelTabs: $('panel-tabs'),
  comments: $('comments'),
  searchPanel: $('search-panel'),
  formsPanel: $('forms-panel'),
  status: $('status'),
  pageinfo: $('pageinfo'),
  zoominfo: $('zoominfo'),
  pdfInput: $('pdf-input'),
  fontInput: $('font-input'),
  imageInput: $('image-input'),
  combineInput: $('combine-input'),
  imagesPdfInput: $('images-pdf-input'),
};

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

const state = {
  pdfBytes: null,
  doc: null, // pdf.js document for pdfBytes
  fileName: 'document.pdf',
  fontBytes: null,
  pageSizes: [], // view size of each page at scale 1
  pageEls: [],
  boxes: [],
  marks: [],
  settings: EMPTY_SETTINGS,
  selected: null, // { kind: 'box' | 'mark', id }
  mode: 'read',
  tool: 'select',
  zoom: 1,
  fit: null,
  current: 0,
  theme: 'system',
  defaults: {}, // per type overrides from the properties bar
  stampLabel: STAMP_LABELS[0],
  history: [],
  future: [],
  gesture: null,
  panel: 'comments',
  search: { query: '', caseSensitive: false, hits: [], index: -1 },
  textCache: new Map(),
  formFields: [],
  docInfo: null,
  busy: false,
  showOcr: false,
};

const quick = {};
let renderToken = 0;
let renderTimer = null;
let thumbToken = 0;
let propEdit = null;
let textEdit = null;
let dragSnap = null;
let drag = null;

// ---------- helpers ----------

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function baseName(name) {
  return name.replace(/\.pdf$/i, '') || 'document';
}

function download(bytes, name, type = 'application/pdf') {
  const url = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function readFile(file, as = 'arrayBuffer') {
  return as === 'dataURL'
    ? new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      })
    : file.arrayBuffer().then((b) => new Uint8Array(b));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không đọc được ảnh.'));
    img.src = src;
  });
}

// Returns a PNG or JPEG data URL; other formats (WebP, GIF, BMP…) are converted to PNG.
async function toEmbeddableImage(file) {
  const src = await readFile(file, 'dataURL');
  const img = await loadImage(src);
  if (/^data:image\/(png|jpeg);/.test(src)) return { src, width: img.naturalWidth, height: img.naturalHeight };
  const canvas = el('canvas', { width: img.naturalWidth, height: img.naturalHeight });
  canvas.getContext('2d').drawImage(img, 0, 0);
  return { src: canvas.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight };
}

function dataUrlToBytes(src) {
  const bin = atob(src.slice(src.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Pointer capture keeps a drag alive outside the element. It throws when the pointer is already
// gone (released, or synthetic), and the drag still works without it, so failure is ignored.
function capturePointer(node, pointerId) {
  try {
    node.setPointerCapture(pointerId);
  } catch {
    // no active pointer with that id
  }
}

function withScheme(url) {
  const u = String(url ?? '').trim();
  if (!u) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  return u.includes('@') && !u.includes('/') ? `mailto:${u}` : `https://${u}`;
}

const findBox = (id) => state.boxes.find((b) => b.id === id);
const findMark = (id) => state.marks.find((m) => m.id === id);
const findItem = (sel) => (!sel ? null : sel.kind === 'box' ? findBox(sel.id) : findMark(sel.id));
const pageSvg = (page) => state.pageEls[page]?.querySelector('svg.overlay') ?? null;

function styleFor(type) {
  const base = type === 'text' ? { color: '#000000', fontSize: 14, width: 0, opacity: 1, fill: null } : { ...(MARK_DEFAULTS[type] ?? MARK_DEFAULTS.rect) };
  return { ...base, ...(state.defaults[type] ?? {}) };
}

async function withBusy(message, fn) {
  if (state.busy) return setStatus('Đang xử lý, vui lòng đợi…');
  state.busy = true;
  document.body.classList.add('busy');
  setStatus(message);
  try {
    await fn();
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), true);
  } finally {
    state.busy = false;
    document.body.classList.remove('busy');
  }
}

function runAction(id) {
  const a = ACTIONS[id];
  if (!a) return;
  if (a.needsDoc && !state.pdfBytes) return setStatus('Hãy mở một tệp PDF trước.', true);
  return a.run();
}

// ---------- history ----------

function snap() {
  return { boxes: state.boxes, marks: state.marks, settings: state.settings, pdfBytes: state.pdfBytes };
}

function changedSince(s) {
  return s.boxes !== state.boxes || s.marks !== state.marks || s.settings !== state.settings || s.pdfBytes !== state.pdfBytes;
}

function pushHistory(before) {
  state.history.push(before);
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  state.future = [];
}

function endEdit(before) {
  if (before && changedSince(before)) pushHistory(before);
  updateQuick();
}

async function restore(s) {
  const bytesChanged = s.pdfBytes !== state.pdfBytes;
  state.boxes = s.boxes;
  state.marks = s.marks;
  state.settings = s.settings;
  state.pdfBytes = s.pdfBytes;
  state.selected = null;
  if (bytesChanged) await loadDocument(state.pdfBytes);
  else refresh();
}

function undo() {
  if (state.busy) return;
  if (!state.history.length) return setStatus('Không còn thao tác để hoàn tác.');
  state.future.push(snap());
  withBusy('Đang hoàn tác…', async () => {
    await restore(state.history.pop());
    setStatus('Đã hoàn tác.');
  });
}

function redo() {
  if (state.busy) return;
  if (!state.future.length) return setStatus('Không còn thao tác để làm lại.');
  state.history.push(snap());
  withBusy('Đang làm lại…', async () => {
    await restore(state.future.pop());
    setStatus('Đã làm lại.');
  });
}

function updateSettings(patch) {
  const before = snap();
  state.settings = { ...state.settings, ...patch };
  pushHistory(before);
  refresh();
}

// ---------- theme ----------

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme === 'system' ? '' : theme;
  try {
    localStorage.setItem('pdfEditor.theme', theme);
  } catch {
    // Storage can be blocked; the theme simply resets next visit.
  }
}

// ---------- menus ----------

function closeMenus() {
  document.querySelectorAll('.dropdown').forEach((d) => d.remove());
}

function menuEntry(item) {
  if (item.tool) {
    const info = TOOL_INFO[item.tool];
    return { label: info.label, icon: info.icon, checked: state.tool === item.tool, run: () => setTool(item.tool) };
  }
  const a = ACTIONS[item];
  return { label: a.label, icon: a.icon, key: a.key, checked: a.checked?.(), disabled: a.needsDoc && !state.pdfBytes, run: () => runAction(item) };
}

function openMenu(wrap, menu) {
  const had = wrap.querySelector('.dropdown');
  closeMenus();
  if (had) return;
  const dd = el('div', { class: 'dropdown', role: 'menu', onclick: (e) => e.stopPropagation() });
  for (const item of menu.items) {
    if (item === '-') {
      dd.append(el('div', { class: 'dd-sep' }));
      continue;
    }
    const e = menuEntry(item);
    dd.append(
      el('button', { role: 'menuitem', disabled: e.disabled, onclick: () => { closeMenus(); e.run(); } },
        el('span', { class: 'dd-check' }, e.checked ? '✓' : ''),
        icon(e.icon, 16),
        el('span', { class: 'grow' }, e.label),
        e.key ? el('span', { class: 'key' }, e.key) : null,
      ),
    );
  }
  wrap.append(dd);
}

function buildMenubar() {
  for (const menu of MENUS) {
    const wrap = el('div', { class: 'menu' });
    wrap.append(el('button', { onclick: (e) => { e.stopPropagation(); openMenu(wrap, menu); } }, menu.label));
    els.menubar.append(wrap);
  }
  els.menubar.append(
    el('span', { class: 'grow' }),
    el('button', { class: 'search-cmd', onclick: () => runAction('palette'), title: 'Tìm công cụ và lệnh (Ctrl+K)' }, icon('search', 15), 'Tìm công cụ và lệnh…', el('span', { class: 'key' }, 'Ctrl+K')),
  );
  document.addEventListener('click', closeMenus);
}

// ---------- mode bar, toolbar ----------

function renderModebar() {
  els.modebar.replaceChildren();
  for (const [key, m] of Object.entries(MODES)) {
    els.modebar.append(el('button', { class: `mode${state.mode === key ? ' on' : ''}`, style: `--hue:${m.hue}`, onclick: () => setMode(key) }, m.label));
  }
  quick.save = iconButton('save', 'Xuất PDF (Ctrl+S)', () => runAction('export'));
  quick.print = iconButton('print', 'In (Ctrl+P)', () => runAction('print'));
  quick.undo = iconButton('undo', 'Hoàn tác (Ctrl+Z)', undo);
  quick.redo = iconButton('redo', 'Làm lại (Ctrl+Y)', redo);
  els.modebar.append(el('span', { class: 'grow' }), iconButton('open', 'Mở PDF (Ctrl+O)', () => runAction('open')), quick.save, quick.print, el('span', { class: 'sep' }), quick.undo, quick.redo);
  updateQuick();
}

function updateQuick() {
  if (!quick.undo) return;
  quick.undo.disabled = !state.history.length;
  quick.redo.disabled = !state.future.length;
  quick.save.disabled = !state.pdfBytes;
  quick.print.disabled = !state.pdfBytes;
}

function renderToolbar() {
  els.toolbar.replaceChildren();
  MODES[state.mode].groups.forEach((group, gi) => {
    if (gi > 0) els.toolbar.append(el('span', { class: 'sep' }));
    for (const item of group) {
      if (typeof item === 'string') {
        const info = TOOL_INFO[item];
        els.toolbar.append(el('button', { class: 'tool', 'data-tool': item, title: info.label, 'aria-label': info.label, onclick: () => setTool(item) }, icon(info.icon)));
      } else {
        const a = ACTIONS[item.action];
        els.toolbar.append(el('button', { class: 'act', title: a.key ? `${a.label} (${a.key})` : a.label, onclick: () => runAction(item.action) }, icon(a.icon), el('span', {}, a.label.replace(/…$/, ''))));
      }
    }
  });
  els.toolbar.append(
    el('span', { class: 'grow' }),
    iconButton('zoomOut', 'Thu nhỏ (Ctrl+-)', () => zoomBy(-1)),
    el('button', { class: 'zoomtxt', title: 'Thực tế 100% (Ctrl+0)', onclick: () => setZoom(1) }, `${Math.round(state.zoom * 100)}%`),
    iconButton('zoomIn', 'Phóng to (Ctrl++)', () => zoomBy(1)),
    el('span', { class: 'sep' }),
    iconButton('fitWidth', 'Vừa chiều rộng (Ctrl+2)', () => fitTo('width')),
    iconButton('fitPage', 'Vừa trang (Ctrl+1)', () => fitTo('page')),
    el('span', { class: 'sep' }),
    iconButton('prev', 'Trang trước', () => scrollToPage(state.current - 1)),
    el('input', { type: 'number', min: 1, id: 'page-field', 'aria-label': 'Số trang', style: 'width:56px', value: state.current + 1, onchange: (e) => scrollToPage(Number(e.target.value) - 1) }),
    el('span', { class: 'lbl' }, `/ ${state.pageSizes.length || 0}`),
    iconButton('next', 'Trang sau', () => scrollToPage(state.current + 1)),
  );
  applyToolClasses();
}

function applyToolClasses() {
  els.toolbar.querySelectorAll('button[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === state.tool));
  const textTool = state.tool === 'text' || state.tool === 'date';
  state.pageEls.forEach((div) => {
    div.classList.toggle('tool-select', state.tool === 'select');
    div.classList.toggle('tool-text', textTool);
    div.classList.toggle('tool-create', state.tool !== 'select' && !textTool);
  });
}

function setMode(mode) {
  state.mode = mode;
  setTool(MODES[mode].defaultTool);
  renderModebar();
  renderToolbar();
  if (mode === 'sign' && state.formFields.length) showPanel('forms');
}

function setTool(tool) {
  if (!MODES[state.mode].groups.flat().includes(tool)) {
    state.mode = Object.keys(MODES).find((k) => MODES[k].groups.flat().includes(tool)) ?? state.mode;
    renderModebar();
  }
  if (state.gesture) cancelGesture();
  select(null);
  state.tool = tool;
  renderToolbar();
  renderProps();
}

// ---------- zoom, navigation, rendering ----------

function setZoom(z, fit = null) {
  state.zoom = clamp(z, 0.25, 4);
  state.fit = fit;
  const label = `${Math.round(state.zoom * 100)}%`;
  els.zoominfo.textContent = label;
  els.toolbar.querySelectorAll('.zoomtxt').forEach((b) => (b.textContent = label));
  if (state.doc) scheduleRender();
}

function zoomBy(dir) {
  const z = state.zoom;
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 1e-6) : [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6);
  if (next) setZoom(next);
}

function fitZoom(kind) {
  const size = state.pageSizes[state.current] ?? state.pageSizes[0];
  if (!size) return 1;
  const w = (els.view.clientWidth - 40) / size.width;
  return kind === 'width' ? w : Math.min(w, (els.view.clientHeight - 40) / size.height);
}

function fitTo(kind) {
  if (state.pageSizes.length) setZoom(fitZoom(kind), kind);
}

// Scrolls the view and makes `page` current. While the smooth scroll runs, scroll events would
// report the pages passed on the way, so the target page stays current until the scroll ends.
let navTarget = null;
let navTimer = null;
function scrollViewTo(top, page, smooth = true) {
  navTarget = page;
  clearTimeout(navTimer);
  navTimer = setTimeout(() => (navTarget = null), 1200);
  setCurrentPage(page);
  els.view.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}

function scrollToPage(index, smooth = true) {
  if (!state.pageEls.length) return;
  const i = clamp(index, 0, state.pageEls.length - 1);
  scrollViewTo(state.pageEls[i].offsetTop - 12, i, smooth);
}

function setCurrentPage(i) {
  state.current = i;
  els.pageinfo.textContent = state.pageSizes.length ? `Trang ${i + 1} / ${state.pageSizes.length}` : '';
  const f = $('page-field');
  if (f) f.value = i + 1;
  els.thumbs.querySelectorAll('.thumb').forEach((t, k) => t.classList.toggle('on', k === i));
  els.thumbs.querySelector('.thumb.on')?.scrollIntoView({ block: 'nearest' });
}

function updatePageFromScroll() {
  if (!state.pageEls.length || navTarget !== null) return;
  const top = els.view.scrollTop + 60;
  let current = 0;
  state.pageEls.forEach((div, i) => {
    if (div.offsetTop <= top) current = i;
  });
  if (current !== state.current) setCurrentPage(current);
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderDocument, 60);
}

async function renderDocument() {
  if (!state.doc) return;
  const token = ++renderToken;
  const doc = state.doc;
  const dpr = window.devicePixelRatio || 1;
  const keep = state.current;
  els.view.replaceChildren();
  state.pageEls = [];
  for (let i = 0; i < doc.numPages; i++) {
    const size = state.pageSizes[i];
    const canvas = el('canvas', { width: Math.floor(size.width * state.zoom * dpr), height: Math.floor(size.height * state.zoom * dpr) });
    const div = el('div', { class: 'page', 'data-page': i, style: `width:${size.width * state.zoom}px;height:${size.height * state.zoom}px` }, canvas);
    div.addEventListener('pointerdown', (e) => onPagePointerDown(e, i));
    els.view.append(div);
    state.pageEls[i] = div;
  }
  renderOverlays();
  scrollToPage(keep, false);
  // Paint canvases after the layout exists, so the view is usable while pages render.
  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1);
    if (token !== renderToken) return;
    const canvas = state.pageEls[i].querySelector('canvas');
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: state.zoom * dpr }) }).promise;
    if (token !== renderToken) return;
  }
}

async function buildThumbnails(doc) {
  const token = ++thumbToken;
  els.thumbs.replaceChildren();
  const buttons = state.pageSizes.map((size, i) => {
    const canvas = el('canvas', { width: 130, height: Math.round((130 * size.height) / size.width) });
    const b = el('button', { class: `thumb${i === state.current ? ' on' : ''}`, title: `Trang ${i + 1}`, onclick: () => scrollToPage(i) }, canvas, `${i + 1}`);
    els.thumbs.append(b);
    return b;
  });
  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1);
    if (token !== thumbToken) return;
    const canvas = buttons[i].querySelector('canvas');
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: 130 / state.pageSizes[i].width }) }).promise;
  }
}

// ---------- overlays ----------

function renderOverlays() {
  state.pageEls.forEach((_, i) => renderPageOverlay(i));
  paintSelection();
  renderProps();
  renderPanel();
  updateQuick();
  applyToolClasses();
}

function renderPageOverlay(i) {
  const div = state.pageEls[i];
  if (!div) return;
  div.querySelectorAll('.tbox, svg.overlay').forEach((n) => n.remove());
  const size = state.pageSizes[i];
  const svg = svgEl('svg', { class: 'overlay', viewBox: `0 0 ${size.width} ${size.height}`, preserveAspectRatio: 'none' });
  renderDecorations(svg, i, size);
  if (state.showOcr) {
    for (const w of state.settings.ocrWords) {
      if (w.page === i) svg.append(svgEl('rect', { class: 'ocr-word', x: w.x, y: w.y, width: w.w, height: w.h }));
    }
  }
  for (const m of marksOnPage(state.marks, i)) svg.append(markElement(m));
  state.search.hits.forEach((h, k) => {
    if (h.page === i) svg.append(svgEl('rect', { class: `search-hit${k === state.search.index ? ' cur' : ''}`, 'data-index': k, x: h.x, y: h.y, width: h.w, height: h.h }));
  });
  div.append(svg);
  for (const b of state.boxes) if (b.page === i) div.append(boxElement(b));
}

// Watermark and header/footer preview, drawn the same way the exporter places them.
function renderDecorations(svg, i, size) {
  const { width: W, height: H } = size;
  const hf = sanitizeHeaderFooter(state.settings.headerFooter);
  if (hf) {
    const ctx = { file: state.fileName, date: todayLabel(), page: i + 1, total: state.pageSizes.length, bates: batesLabel(hf.batesPrefix, hf.batesStart, hf.batesDigits, i) };
    for (const [row, y] of [['header', hf.margin + hf.fontSize], ['footer', H - hf.margin]]) {
      for (const [pos, x, anchor] of [['Left', hf.margin, 'start'], ['Center', W / 2, 'middle'], ['Right', W - hf.margin, 'end']]) {
        const text = formatTokens(hf[row + pos], ctx);
        if (!text) continue;
        const t = svgEl('text', { class: 'deco', x, y, 'font-size': hf.fontSize, fill: hf.color, 'text-anchor': anchor });
        t.textContent = text;
        svg.append(t);
      }
    }
  }
  const wm = sanitizeWatermark(state.settings.watermark);
  if (wm) {
    const t = svgEl('text', {
      class: 'deco',
      x: W / 2,
      y: H / 2,
      'font-size': wm.fontSize,
      fill: wm.color,
      'fill-opacity': wm.opacity,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      transform: `rotate(${-wm.angle} ${W / 2} ${H / 2})`,
    });
    t.textContent = wm.text;
    svg.append(t);
  }
}

function markElement(m) {
  const common = { stroke: m.color, 'stroke-width': m.width, 'stroke-opacity': m.opacity, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const polyline = (pts, extra = {}) => svgEl('polyline', { ...common, ...extra, points: pts.map((p) => p.join(',')).join(' ') });
  const line = (a, b, extra = {}) => svgEl('line', { ...common, ...extra, x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
  const hitArea = () => svgEl('rect', { x: m.x, y: m.y, width: m.w, height: m.h, fill: 'transparent' });
  const { x, y, w, h } = m;
  const bottom = y + h;
  const g = svgEl('g', { class: 'mark', 'data-id': m.id });
  switch (m.type) {
    case 'note':
      g.append(svgEl('rect', { x, y, width: NOTE_SIZE, height: NOTE_SIZE, rx: 2, fill: m.color, 'fill-opacity': m.opacity, stroke: '#000', 'stroke-opacity': 0.5, 'stroke-width': 0.5 }));
      for (const dy of [6, 9, 12]) g.append(svgEl('line', { x1: x + 4, y1: y + dy, x2: x + NOTE_SIZE - 4, y2: y + dy, stroke: '#000', 'stroke-opacity': 0.5, 'stroke-width': 0.8 }));
      break;
    case 'highlight':
      g.append(svgEl('rect', { x, y, width: w, height: h, fill: m.color, 'fill-opacity': m.opacity, class: 'hl' }));
      break;
    case 'underline':
      g.append(hitArea(), line([x, bottom], [x + w, bottom]));
      break;
    case 'strike':
      g.append(hitArea(), line([x, y + h / 2], [x + w, y + h / 2]));
      break;
    case 'squiggly':
      g.append(hitArea(), polyline(zigzagPoints(x, x + w, bottom, 1.5, 3)));
      break;
    case 'rect':
      g.append(svgEl('rect', { x, y, width: w, height: h, ...common, fill: m.fill ?? 'none', 'fill-opacity': m.fill ? m.opacity : 1 }));
      break;
    case 'oval':
      g.append(svgEl('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...common, fill: m.fill ?? 'none', 'fill-opacity': m.fill ? m.opacity : 1 }));
      break;
    case 'line':
      if (m.points.length >= 2) g.append(line(m.points[0], m.points[1]));
      break;
    case 'arrow':
      if (m.points.length >= 2) {
        g.append(line(m.points[0], m.points[1]));
        g.append(polyline(arrowHeadPoints(m.points[0][0], m.points[0][1], m.points[1][0], m.points[1][1])));
      }
      break;
    case 'ink':
      g.append(polyline(m.points));
      break;
    case 'stamp': {
      const label = m.label || 'STAMP';
      const size = Math.max(4, Math.min(h * 0.5, (w - 12) / (Math.max(1, label.length) * 0.62)));
      g.append(svgEl('rect', { x, y, width: w, height: h, rx: 3, ...common }));
      const t = svgEl('text', { x: x + w / 2, y: y + h / 2 + size * 0.35, 'text-anchor': 'middle', 'font-size': size, 'font-weight': 700, fill: m.color, 'fill-opacity': m.opacity, class: 'stamp-text' });
      t.textContent = label;
      g.append(t);
      break;
    }
    case 'image':
      g.append(hitArea(), svgEl('image', { href: m.src, x, y, width: w, height: h, preserveAspectRatio: 'none', opacity: m.opacity }));
      break;
    case 'link':
      g.append(svgEl('rect', { x, y, width: w, height: h, fill: m.color, 'fill-opacity': 0.08, stroke: m.color, 'stroke-width': 1, 'stroke-dasharray': '4 3', class: 'link-box' }));
      break;
    case 'redact':
      g.append(svgEl('rect', { x, y, width: w, height: h, fill: '#000', 'fill-opacity': 0.8, stroke: '#e03e3e', 'stroke-width': 1, 'stroke-dasharray': '4 2' }));
      break;
    case 'symbol': {
      const sw = Math.max(1, Math.min(w, h) * 0.12);
      g.append(hitArea());
      if (m.label === 'check') g.append(polyline([[x + 0.12 * w, y + 0.55 * h], [x + 0.4 * w, y + 0.85 * h], [x + 0.9 * w, y + 0.15 * h]], { 'stroke-width': sw }));
      else if (m.label === 'cross') g.append(line([x + 0.15 * w, y + 0.15 * h], [x + 0.85 * w, y + 0.85 * h], { 'stroke-width': sw }), line([x + 0.85 * w, y + 0.15 * h], [x + 0.15 * w, y + 0.85 * h], { 'stroke-width': sw }));
      else g.append(svgEl('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w * 0.3, ry: h * 0.3, fill: m.color, 'fill-opacity': m.opacity }));
      break;
    }
  }
  g.addEventListener('pointerdown', (e) => {
    if (state.tool !== 'select') return;
    e.stopPropagation();
    beginMarkMove(e, m.id);
  });
  return g;
}

function boxElement(box) {
  const grip = el('span', { class: 'grip', title: 'Kéo để di chuyển' });
  const node = el('div', {
    class: 'tbox',
    'data-id': box.id,
    contenteditable: 'true',
    spellcheck: 'false',
    style: `left:${box.x * state.zoom}px;top:${box.y * state.zoom}px;font-size:${box.fontSize * state.zoom}px;color:${box.color}`,
  }, box.text, grip);

  node.addEventListener('pointerdown', () => {
    if (['select', 'text', 'date'].includes(state.tool)) select({ kind: 'box', id: box.id });
  });
  node.addEventListener('focus', () => (textEdit = snap()));
  node.addEventListener('input', () => {
    state.boxes = updateBox(state.boxes, box.id, { text: node.innerText });
  });
  node.addEventListener('blur', () => {
    endEdit(textEdit);
    textEdit = null;
    renderComments();
  });

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    select({ kind: 'box', id: box.id });
    const current = findBox(box.id);
    dragSnap = snap();
    drag = { id: box.id, el: node, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, ox: current.x, oy: current.y, x: current.x, y: current.y, moved: false };
    capturePointer(grip, e.pointerId);
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    drag.x = drag.ox + (e.clientX - drag.startX) / state.zoom;
    drag.y = drag.oy + (e.clientY - drag.startY) / state.zoom;
    drag.moved = drag.moved || Math.abs(drag.x - drag.ox) > 0.5 || Math.abs(drag.y - drag.oy) > 0.5;
    drag.el.style.left = `${drag.x * state.zoom}px`;
    drag.el.style.top = `${drag.y * state.zoom}px`;
  });
  const endDrag = (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.moved) state.boxes = updateBox(state.boxes, drag.id, { x: drag.x, y: drag.y });
    endEdit(drag.moved ? dragSnap : null);
    drag = null;
    dragSnap = null;
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);
  return node;
}

function paintSelection() {
  const sel = state.selected;
  document.querySelectorAll('.tbox').forEach((n) => n.classList.toggle('selected', sel?.kind === 'box' && Number(n.dataset.id) === sel.id));
  document.querySelectorAll('svg.overlay').forEach((svg) => {
    svg.querySelectorAll('.sel-box, .sel-handle').forEach((n) => n.remove());
    svg.querySelectorAll('g.mark').forEach((g) => g.classList.toggle('selected', sel?.kind === 'mark' && g.dataset.id === sel.id));
  });
  if (sel?.kind !== 'mark') return;
  const m = findMark(sel.id);
  const svg = m && pageSvg(m.page);
  if (!svg) return;
  const b = markBounds(m);
  svg.append(svgEl('rect', { class: 'sel-box', x: b.x - 2, y: b.y - 2, width: b.w + 4, height: b.h + 4 }));
  if (RESIZABLE_TYPES.includes(m.type)) {
    const hs = 9 / state.zoom;
    const handle = svgEl('rect', { class: 'sel-handle', x: m.x + m.w - hs / 2, y: m.y + m.h - hs / 2, width: hs, height: hs });
    handle.addEventListener('pointerdown', (e) => beginResize(e, m.id));
    svg.append(handle);
  }
}

function select(sel) {
  const prev = state.selected;
  const same = prev && sel && prev.kind === sel.kind && prev.id === sel.id;
  if (!same && prev?.kind === 'box') {
    const box = findBox(prev.id);
    if (box && !box.text) {
      state.boxes = removeBox(state.boxes, prev.id);
      document.querySelector(`.tbox[data-id="${prev.id}"]`)?.remove();
    }
  }
  state.selected = sel;
  paintSelection();
  renderProps();
  renderComments();
  updateQuick();
}

function refresh() {
  renderOverlays();
}

// ---------- pointer tools ----------

function toPoint(e, page) {
  const rect = state.pageEls[page].getBoundingClientRect();
  const size = state.pageSizes[page];
  return {
    x: clamp((e.clientX - rect.left) * (size.width / rect.width), 0, size.width),
    y: clamp((e.clientY - rect.top) * (size.height / rect.height), 0, size.height),
  };
}

function onPagePointerDown(e, page) {
  if (e.button !== 0 || e.target.closest('.tbox')) return;
  if (page !== state.current) setCurrentPage(page);
  const tool = state.tool;
  if (tool === 'select') return select(null);
  const p = toPoint(e, page);
  if (tool === 'text') return addTextBox(page, p.x, p.y);
  if (tool === 'date') return addTextBox(page, p.x, p.y, todayLabel());
  if (tool === 'note') return addNote(page, p.x, p.y);
  if (tool === 'stamp') return addStamp(page, p.x, p.y);
  if (TOOL_INFO[tool]?.symbol) return addSymbol(page, p.x, p.y, TOOL_INFO[tool].symbol);
  if (!DRAG_TOOLS.has(tool)) return;
  state.gesture = { tool, page, x0: p.x, y0: p.y, x: p.x, y: p.y, pts: [[p.x, p.y]], pointerId: e.pointerId };
  window.addEventListener('pointermove', onGestureMove);
  window.addEventListener('pointerup', onGestureEnd);
  window.addEventListener('pointercancel', onGestureEnd);
  showPreview();
}

function onGestureMove(e) {
  const g = state.gesture;
  if (!g || e.pointerId !== g.pointerId) return;
  const p = toPoint(e, g.page);
  g.x = p.x;
  g.y = p.y;
  if (g.tool === 'ink') g.pts.push([p.x, p.y]);
  showPreview();
}

function onGestureEnd(e) {
  const g = state.gesture;
  if (!g || e.pointerId !== g.pointerId) return;
  cancelGesture();
  const draft = draftFromGesture(g);
  if (draft) commitMark(draft);
}

function cancelGesture() {
  window.removeEventListener('pointermove', onGestureMove);
  window.removeEventListener('pointerup', onGestureEnd);
  window.removeEventListener('pointercancel', onGestureEnd);
  state.gesture = null;
  document.querySelectorAll('.preview').forEach((n) => n.remove());
}

function draftFromGesture(g) {
  if (g.tool === 'ink') {
    const points = simplifyInk(g.pts);
    return points.length >= 2 ? { type: 'ink', page: g.page, points } : null;
  }
  if (g.tool === 'line' || g.tool === 'arrow') {
    if (Math.hypot(g.x - g.x0, g.y - g.y0) < 3) return null;
    return { type: g.tool, page: g.page, points: [[g.x0, g.y0], [g.x, g.y]] };
  }
  const r = normalizeRect(g.x0, g.y0, g.x, g.y);
  if (r.w < 3 && r.h < 3) return null;
  return { type: g.tool, page: g.page, ...r };
}

function showPreview() {
  const g = state.gesture;
  const svg = g && pageSvg(g.page);
  if (!svg) return;
  svg.querySelectorAll('.preview').forEach((n) => n.remove());
  const draft = draftFromGesture(g);
  if (!draft) return;
  const node = markElement(sanitizeMark({ ...styleFor(draft.type), ...draft, id: 'preview' }));
  node.classList.add('preview');
  svg.append(node);
}

function commitMark(draft) {
  const before = snap();
  const style = styleFor(draft.type);
  const fill = draft.type === 'rect' || draft.type === 'oval' ? style.fill : null;
  const id = nextMarkId(state.marks);
  state.marks = addMark(state.marks, { ...style, text: '', ...draft, fill, id });
  pushHistory(before);
  state.selected = { kind: 'mark', id };
  refresh();
  if (draft.type === 'link') openLinkDialog(id);
  return id;
}

function addTextBox(page, x, y, text = '') {
  const before = snap();
  const style = styleFor('text');
  const id = nextId(state.boxes);
  state.boxes = addBox(state.boxes, { id, page, x, y, text, fontSize: clampFontSize(style.fontSize), color: style.color });
  pushHistory(before);
  state.selected = { kind: 'box', id };
  refresh();
  if (!text) document.querySelector(`.tbox[data-id="${id}"]`)?.focus();
}

function addNote(page, x, y) {
  const id = commitMark({ type: 'note', page, x: x - NOTE_SIZE / 2, y: y - NOTE_SIZE / 2 });
  showPanel('comments');
  els.comments.querySelector(`textarea[data-id="${id}"]`)?.focus();
}

function stampWidth(label) {
  return Math.max(70, label.length * 12 + 28);
}

function addStamp(page, x, y) {
  const label = state.stampLabel;
  const w = stampWidth(label);
  const h = 34;
  commitMark({ type: 'stamp', page, x: x - w / 2, y: y - h / 2, w, h, label });
}

function addSymbol(page, x, y, symbol) {
  const s = symbol === 'dot' ? 10 : 16;
  commitMark({ type: 'symbol', page, x: x - s / 2, y: y - s / 2, w: s, h: s, label: symbol });
}

// Places an image centred on the current page, at most `maxW` points wide.
function placeImage(src, natW, natH, maxW = 220) {
  const page = state.current;
  const size = state.pageSizes[page];
  const w = Math.min(maxW, natW * 0.75, size.width * 0.8);
  const h = w * (natH / natW);
  const id = commitMark({ type: 'image', page, x: (size.width - w) / 2, y: (size.height - h) / 2, w, h, src });
  setTool('select');
  select({ kind: 'mark', id });
  return id;
}

function deleteSelected() {
  const sel = state.selected;
  if (!sel) return setStatus('Chưa chọn mục nào để xóa.');
  const before = snap();
  if (sel.kind === 'box') state.boxes = removeBox(state.boxes, sel.id);
  else state.marks = removeMark(state.marks, sel.id);
  pushHistory(before);
  state.selected = null;
  refresh();
}

function beginMarkMove(e, id) {
  const m = findMark(id);
  if (!m || e.button !== 0) return;
  select({ kind: 'mark', id });
  const g = pageSvg(m.page)?.querySelector(`g.mark[data-id="${id}"]`);
  const move = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false, before: snap() };
  const onMove = (ev) => {
    if (ev.pointerId !== move.pointerId) return;
    const rect = state.pageEls[m.page].getBoundingClientRect();
    const size = state.pageSizes[m.page];
    move.dx = (ev.clientX - move.startX) * (size.width / rect.width);
    move.dy = (ev.clientY - move.startY) * (size.height / rect.height);
    move.moved = move.moved || Math.abs(move.dx) > 0.5 || Math.abs(move.dy) > 0.5;
    g?.setAttribute('transform', `translate(${move.dx} ${move.dy})`);
  };
  const onUp = (ev) => {
    if (ev.pointerId !== move.pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    g?.removeAttribute('transform');
    if (move.moved) {
      state.marks = state.marks.map((mk) => (mk.id === id ? moveMark(mk, move.dx, move.dy) : mk));
      pushHistory(move.before);
      refresh();
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

// Drag the bottom-right handle to resize; images and symbols keep their aspect ratio.
function beginResize(e, id) {
  e.stopPropagation();
  e.preventDefault();
  const m0 = findMark(id);
  if (!m0) return;
  const before = snap();
  const keepAspect = m0.type === 'image' || m0.type === 'symbol';
  const start = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  const onMove = (ev) => {
    if (ev.pointerId !== start.pointerId) return;
    const rect = state.pageEls[m0.page].getBoundingClientRect();
    const k = state.pageSizes[m0.page].width / rect.width;
    const next = resizeMark(m0, m0.w + (ev.clientX - start.x) * k, m0.h + (ev.clientY - start.y) * k, { keepAspect });
    state.marks = state.marks.map((mk) => (mk.id === id ? next : mk));
    renderPageOverlay(m0.page);
    paintSelection();
  };
  const onUp = (ev) => {
    if (ev.pointerId !== start.pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    endEdit(before);
    refresh();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function nudgeSelected(dx, dy) {
  const sel = state.selected;
  if (!sel) return;
  const before = snap();
  if (sel.kind === 'box') {
    const b = findBox(sel.id);
    state.boxes = updateBox(state.boxes, sel.id, { x: b.x + dx, y: b.y + dy });
  } else {
    state.marks = state.marks.map((mk) => (mk.id === sel.id ? moveMark(mk, dx, dy) : mk));
  }
  pushHistory(before);
  refresh();
}

// ---------- properties bar ----------

function currentType() {
  const sel = state.selected;
  if (sel) return sel.kind === 'box' ? 'text' : findItem(sel)?.type;
  return toolType(state.tool);
}

function propControl(label, input) {
  return el('label', { class: 'lbl' }, label, input);
}

function bindEdit(input, onInput) {
  input.addEventListener('focus', () => (propEdit = snap()));
  input.addEventListener('input', (e) => onInput(e.target));
  input.addEventListener('change', () => endPropEdit());
  return input;
}

function renderProps() {
  const sel = state.selected;
  const item = findItem(sel);
  const type = currentType();
  if (!type || (!sel && type === 'select')) {
    els.propsbar.classList.add('hidden');
    els.propsbar.replaceChildren();
    return;
  }
  const v = item ?? styleFor(type);
  const title = sel ? `Đã chọn: ${typeLabel(type)}` : TOOL_INFO[state.tool]?.label ?? typeLabel(type);
  const row = [el('span', { class: 'title' }, title)];

  if (type !== 'redact' && type !== 'image') {
    row.push(propControl('Màu', bindEdit(el('input', { type: 'color', value: v.color ?? '#000000' }), (t) => applyProp('color', t.value))));
  }
  if (STROKE_TYPES.has(type)) {
    const out = el('output', {}, `${v.width}`);
    row.push(propControl('Độ dày', bindEdit(el('input', { type: 'range', min: 0.5, max: 12, step: 0.5, value: v.width }), (t) => {
      out.textContent = t.value;
      applyProp('width', Number(t.value));
    })), out);
  }
  if (type !== 'text' && type !== 'redact') {
    const out = el('output', {}, `${Math.round((v.opacity ?? 1) * 100)}%`);
    row.push(propControl('Độ mờ', bindEdit(el('input', { type: 'range', min: 5, max: 100, step: 5, value: Math.round((v.opacity ?? 1) * 100) }), (t) => {
      out.textContent = `${t.value}%`;
      applyProp('opacity', Number(t.value) / 100);
    })), out);
  }
  if (type === 'rect' || type === 'oval') {
    const fillColor = bindEdit(el('input', { type: 'color', value: v.fill ?? '#ffffff', disabled: !v.fill, 'aria-label': 'Màu nền' }), (t) => applyProp('fill', t.value));
    const toggle = el('input', { type: 'checkbox', checked: !!v.fill });
    toggle.addEventListener('focus', () => (propEdit = snap()));
    toggle.addEventListener('change', (e) => {
      applyProp('fill', e.target.checked ? fillColor.value : null);
      endPropEdit();
      renderProps();
    });
    row.push(el('label', { class: 'lbl' }, toggle, 'Tô nền', fillColor));
  }
  if (type === 'text') {
    row.push(propControl('Cỡ', bindEdit(el('input', { type: 'number', min: 6, max: 96, value: v.fontSize }), (t) => applyProp('fontSize', clampFontSize(t.value)))));
  }
  if (type === 'stamp') {
    const current = item ? item.label : state.stampLabel;
    const options = STAMP_LABELS.includes(current) ? STAMP_LABELS : [current, ...STAMP_LABELS];
    const picker = bindEdit(el('select', {}, options.map((l) => el('option', { value: l, selected: l === current }, l))), (t) => applyProp('label', t.value));
    row.push(propControl('Nội dung', picker));
  }
  if (type === 'link' && item) {
    row.push(propControl('URL', bindEdit(el('input', { type: 'url', value: item.url, placeholder: 'https://…', style: 'width:220px' }), (t) => applyProp('url', t.value))));
  }
  if (type === 'redact') row.push(el('span', { class: 'lbl' }, 'Vùng che được áp dụng khi xuất: trang đó chuyển thành ảnh, nội dung bên dưới bị xóa.'));
  row.push(el('span', { style: 'flex:1' }));
  if (sel) row.push(el('button', { onclick: deleteSelected, title: 'Xóa (Del)' }, icon('trash', 16), 'Xóa'));

  els.propsbar.replaceChildren(...row);
  els.propsbar.classList.remove('hidden');
}

function endPropEdit() {
  endEdit(propEdit);
  propEdit = null;
  renderComments();
}

function applyProp(prop, value) {
  const sel = state.selected;
  const type = currentType();
  if (!type) return;
  if (prop === 'label' && !sel) {
    state.stampLabel = value;
    return;
  }
  if (prop !== 'url' && prop !== 'label') state.defaults[type] = { ...(state.defaults[type] ?? {}), [prop]: value };
  if (sel?.kind === 'box') {
    if (prop === 'color') state.boxes = updateBox(state.boxes, sel.id, { color: value });
    if (prop === 'fontSize') state.boxes = updateBox(state.boxes, sel.id, { fontSize: clampFontSize(value) });
  } else if (sel?.kind === 'mark') {
    const patch = { [prop]: value };
    if (prop === 'url') patch.url = safeUrl(withScheme(value));
    if (prop === 'label') {
      state.stampLabel = value;
      patch.w = stampWidth(value);
    }
    state.marks = updateMark(state.marks, sel.id, patch);
  }
  const page = findItem(sel)?.page;
  if (page !== undefined) {
    renderPageOverlay(page);
    paintSelection();
  }
}

// ---------- side panels ----------

function showPanel(name) {
  state.panel = name;
  renderPanel();
}

function renderPanel() {
  els.panelTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.panel === state.panel));
  els.comments.classList.toggle('hidden', state.panel !== 'comments');
  els.searchPanel.classList.toggle('hidden', state.panel !== 'search');
  els.formsPanel.classList.toggle('hidden', state.panel !== 'forms');
  if (state.panel === 'comments') renderComments();
  if (state.panel === 'search') renderSearchResults();
  if (state.panel === 'forms') renderForms();
}

function renderComments() {
  if (state.panel !== 'comments') return;
  const items = [
    ...state.boxes.map((b) => ({ kind: 'box', id: b.id, page: b.page, x: b.x, y: b.y, type: 'text', color: b.color, text: b.text })),
    ...state.marks.map((m) => ({ kind: 'mark', id: m.id, page: m.page, x: m.x, y: m.y, type: m.type, color: m.color, text: m.text, extra: m.type === 'link' ? m.url : m.type === 'stamp' ? m.label : '' })),
  ].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const count = $('comment-count');
  if (count) count.textContent = items.length ? `${items.length}` : '';
  els.comments.replaceChildren();
  if (!items.length) {
    els.comments.append(el('p', { class: 'lbl empty-note' }, state.pdfBytes ? 'Chưa có chú thích. Chọn một công cụ ở chế độ Chú thích để bắt đầu.' : 'Mở một tệp PDF để xem chú thích.'));
    return;
  }
  for (const it of items) {
    const selected = state.selected?.kind === it.kind && state.selected?.id === it.id;
    const card = el('div', { class: `c-item${selected ? ' on' : ''}`, onclick: () => focusItem(it) },
      el('div', { class: 'meta' },
        el('span', { class: 'dot', style: `background:${it.type === 'redact' ? '#000' : it.color}` }),
        el('span', { class: 'grow' }, `${typeLabel(it.type)} · trang ${it.page + 1}`),
        el('button', { class: 'icon', title: 'Xóa', onclick: (e) => { e.stopPropagation(); select({ kind: it.kind, id: it.id }); deleteSelected(); } }, icon('trash', 14)),
      ),
      it.extra ? el('div', { class: 'body faint' }, it.extra) : null,
    );
    if (it.kind === 'box') {
      card.append(el('div', { class: 'body' }, it.text || '(trống)'));
    } else {
      const area = el('textarea', {
        'data-id': it.id,
        rows: 2,
        placeholder: 'Ghi chú…',
        onclick: (e) => e.stopPropagation(),
        onfocus: () => (textEdit = snap()),
        oninput: (e) => (state.marks = updateMark(state.marks, it.id, { text: e.target.value })),
        onblur: () => {
          endEdit(textEdit);
          textEdit = null;
        },
      });
      area.value = it.text ?? '';
      card.append(area);
    }
    els.comments.append(card);
  }
}

function focusItem(it) {
  select({ kind: it.kind, id: it.id });
  const item = findItem(it);
  const div = state.pageEls[it.page];
  if (div && item) scrollViewTo(div.offsetTop + (item.y ?? 0) * state.zoom - 120, it.page);
}

// Search panel: the input row is built once; results are refreshed separately.
function buildSearchPanel() {
  const input = el('input', { type: 'search', id: 'search-input', placeholder: 'Tìm văn bản…', 'aria-label': 'Tìm văn bản' });
  const caseBox = el('input', { type: 'checkbox', id: 'search-case' });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (state.search.query === input.value && state.search.hits.length) goToHit(state.search.index + (e.shiftKey ? -1 : 1));
      else runSearch(input.value, caseBox.checked);
    }
  });
  els.searchPanel.append(
    el('div', { class: 'search-row' }, input, el('button', { class: 'primary', onclick: () => runSearch(input.value, caseBox.checked) }, 'Tìm')),
    el('label', { class: 'lbl small' }, caseBox, 'Phân biệt chữ hoa/thường'),
    el('div', { class: 'search-nav' },
      el('span', { id: 'search-count', class: 'lbl' }),
      el('span', { class: 'grow' }),
      iconButton('up', 'Kết quả trước (Shift+Enter)', () => goToHit(state.search.index - 1)),
      iconButton('down', 'Kết quả sau (Enter)', () => goToHit(state.search.index + 1)),
    ),
    el('div', { class: 'search-actions' },
      el('button', { onclick: () => marksFromHits('highlight') }, icon('highlight', 16), 'Tô sáng tất cả'),
      el('button', { onclick: () => marksFromHits('redact') }, icon('redact', 16), 'Che tất cả'),
    ),
    el('div', { id: 'search-results' }),
  );
}

function openSearch() {
  showPanel('search');
  const input = $('search-input');
  input?.focus();
  input?.select();
}

// Text runs of a page from the PDF itself, plus any OCR words recognized on it.
async function pageTextItems(i) {
  const ocr = state.settings.ocrWords.filter((w) => w.page === i).map((w) => ({ str: w.text, x: w.x, y: w.y, w: w.w, h: w.h }));
  return [...(await pdfTextItems(i)), ...ocr];
}

async function pdfTextItems(i) {
  if (!state.textCache.has(i)) state.textCache.set(i, await textItemsOf(await state.doc.getPage(i + 1)));
  return state.textCache.get(i);
}

// Text runs of a pdf.js page in view space.
async function textItemsOf(page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  return tc.items
    .filter((it) => typeof it.str === 'string' && it.str.length)
    .map((it) => {
      const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
      const h = Math.hypot(tx[2], tx[3]);
      return { str: it.str, x: tx[4], y: tx[5] - h, w: it.width, h: h * 1.15 };
    });
}

async function runSearch(query, caseSensitive) {
  if (!state.doc) return setStatus('Hãy mở một tệp PDF trước.', true);
  const q = String(query ?? '').trim();
  state.search = { query, caseSensitive, hits: [], index: -1 };
  if (!q) {
    refresh();
    return;
  }
  setStatus('Đang tìm…');
  const hits = [];
  for (let i = 0; i < state.pageSizes.length; i++) {
    for (const h of findInItems(await pageTextItems(i), q, { caseSensitive })) hits.push({ ...h, page: i });
  }
  state.search = { query, caseSensitive, hits, index: hits.length ? 0 : -1 };
  state.pageEls.forEach((_, i) => renderPageOverlay(i));
  paintSelection();
  renderSearchResults();
  if (hits.length) goToHit(0);
  setStatus(hits.length ? `Tìm thấy ${hits.length} kết quả cho "${q}".` : `Không tìm thấy "${q}". Văn bản dạng ảnh (bản quét) không tìm được.`);
}

function goToHit(k) {
  const { hits } = state.search;
  if (!hits.length) return;
  const index = ((k % hits.length) + hits.length) % hits.length;
  state.search.index = index;
  const hit = hits[index];
  document.querySelectorAll('.search-hit').forEach((r) => r.classList.toggle('cur', Number(r.dataset.index) === index));
  const div = state.pageEls[hit.page];
  if (div) scrollViewTo(div.offsetTop + hit.y * state.zoom - 140, hit.page);
  renderSearchResults();
}

function renderSearchResults() {
  const box = $('search-results');
  const count = $('search-count');
  if (!box || !count) return;
  const { hits, index, query } = state.search;
  count.textContent = hits.length ? `${index + 1} / ${hits.length}` : query ? '0 kết quả' : '';
  box.replaceChildren(...hits.slice(0, 300).map((h, k) => el('button', { class: `hit${k === index ? ' on' : ''}`, onclick: () => goToHit(k) }, el('span', { class: 'faint' }, `Trang ${h.page + 1}`), el('span', {}, h.snippet))));
  if (hits.length > 300) box.append(el('p', { class: 'lbl' }, `… và ${hits.length - 300} kết quả khác`));
}

function marksFromHits(type) {
  const { hits } = state.search;
  if (!hits.length) return setStatus('Chưa có kết quả tìm kiếm.', true);
  const before = snap();
  const style = styleFor(type);
  let marks = state.marks;
  for (const h of hits) marks = addMark(marks, { ...style, type, page: h.page, x: h.x, y: h.y, w: h.w, h: h.h, id: nextMarkId(marks), text: '' });
  state.marks = marks;
  pushHistory(before);
  refresh();
  setStatus(type === 'redact' ? `Đã đánh dấu che ${hits.length} vị trí. Nội dung bị xóa khi xuất.` : `Đã tô sáng ${hits.length} vị trí.`);
}

function renderForms() {
  els.formsPanel.replaceChildren();
  if (!state.formFields.length) {
    els.formsPanel.append(el('p', { class: 'lbl empty-note' }, state.pdfBytes ? 'Tài liệu không có trường biểu mẫu nào. Dùng chế độ Ký & điền để thêm chữ, dấu tích hoặc chữ ký lên trang.' : 'Mở một tệp PDF để điền biểu mẫu.'));
    return;
  }
  const values = state.settings.formValues;
  const setValue = (name, value) => updateSettings({ formValues: { ...state.settings.formValues, [name]: value } });
  for (const f of state.formFields) {
    const value = values[f.name] ?? f.value;
    let input;
    if (f.kind === 'check') input = el('input', { type: 'checkbox', checked: !!value, onchange: (e) => setValue(f.name, e.target.checked) });
    else if (f.kind === 'choice' || f.kind === 'radio')
      input = el('select', { onchange: (e) => setValue(f.name, e.target.value) }, el('option', { value: '' }, '—'), f.options.map((o) => el('option', { value: o, selected: o === value }, o)));
    else input = el(f.multiline ? 'textarea' : 'input', { type: 'text', value, onchange: (e) => setValue(f.name, e.target.value) });
    if (f.multiline) input.value = value;
    els.formsPanel.append(el('label', { class: `form-field${f.kind === 'check' ? ' inline' : ''}` }, el('span', { class: 'lbl' }, f.name), input));
  }
  els.formsPanel.append(
    el('label', { class: 'lbl small form-flatten' }, el('input', { type: 'checkbox', checked: state.settings.flattenForm, onchange: (e) => updateSettings({ flattenForm: e.target.checked }) }), 'Làm phẳng biểu mẫu khi xuất (không sửa được nữa)'),
    el('button', { onclick: () => updateSettings({ formValues: Object.fromEntries(state.formFields.map((f) => [f.name, f.kind === 'check' ? false : ''])) }) }, 'Xóa dữ liệu đã điền'),
  );
}

// ---------- document and page operations ----------

function settingsContext() {
  return { file: state.fileName, date: todayLabel() };
}

// The full export: redaction rasters, every item and document setting. `overrides` replaces
// settings for this build only, e.g. no watermark when extracting text.
async function buildOutput(overrides = {}) {
  const raster = await rasterizeRedactions(state.doc, state.marks);
  return exportPdf(state.pdfBytes.slice(), state.boxes, {
    fontBytes: state.fontBytes,
    marks: state.marks,
    settings: { ...state.settings, ...overrides },
    rasterPages: raster,
    context: settingsContext(),
  });
}

// Writes the items of one page into the PDF bytes (used before rotating that page).
async function bakePage(index) {
  const boxes = state.boxes.filter((b) => b.page === index);
  const marks = state.marks.filter((m) => m.page === index);
  if (!boxes.length && !marks.length) return state.pdfBytes;
  const raster = await rasterizeRedactions(state.doc, marks);
  return exportPdf(state.pdfBytes.slice(), boxes, { fontBytes: state.fontBytes, marks, rasterPages: raster });
}

// Replaces the document bytes as one undo step. `remap` re-indexes everything tied to a page
// (text boxes, marks, OCR words) to follow inserted, deleted or moved pages.
async function applyBytes(bytes, before, { remap, current } = {}) {
  pushHistory(before);
  state.pdfBytes = bytes;
  if (remap) {
    state.boxes = remap(state.boxes);
    state.marks = remap(state.marks);
    state.settings = { ...state.settings, ocrWords: remap(state.settings.ocrWords) };
  }
  if (current !== undefined) state.current = current;
  state.selected = null;
  await loadDocument(bytes);
}

function rotateCurrent(delta) {
  return withBusy('Đang xoay trang…', async () => {
    const i = state.current;
    const before = snap();
    const baked = state.boxes.some((b) => b.page === i) || state.marks.some((m) => m.page === i);
    const bytes = await rotatePages(await bakePage(i), [i], delta);
    const hadOcr = state.settings.ocrWords.some((w) => w.page === i);
    // Items on the page were written into the PDF; OCR boxes no longer match the turned page.
    await applyBytes(bytes, before, { remap: (items) => items.filter((it) => it.page !== i) });
    setStatus(`Đã xoay trang ${i + 1}.${baked ? ' Các mục trên trang đã được gộp vào PDF trước khi xoay.' : ''}${hadOcr ? ' Hãy chạy lại OCR cho trang này.' : ''}`);
  });
}

function moveCurrent(dir) {
  const i = state.current;
  const to = i + dir;
  if (to < 0 || to >= state.pageSizes.length) return setStatus(dir < 0 ? 'Đây đã là trang đầu.' : 'Đây đã là trang cuối.');
  return withBusy('Đang di chuyển trang…', async () => {
    const before = snap();
    const bytes = await movePage(state.pdfBytes, i, to);
    await applyBytes(bytes, before, { remap: (items) => remapMoved(items, i, to), current: to });
    setStatus(`Đã chuyển trang ${i + 1} thành trang ${to + 1}.`);
  });
}

function insertBlankAfter() {
  return withBusy('Đang chèn trang…', async () => {
    const i = state.current;
    const at = i + 1;
    const size = state.pageSizes[i];
    const before = snap();
    const bytes = await insertBlankPage(state.pdfBytes, at, [size.width, size.height]);
    await applyBytes(bytes, before, { remap: (items) => remapInserted(items, at), current: at });
    setStatus(`Đã chèn trang trắng ở vị trí ${at + 1}.`);
  });
}

function duplicateCurrent() {
  return withBusy('Đang nhân bản trang…', async () => {
    const i = state.current;
    const before = snap();
    const bytes = await duplicatePage(state.pdfBytes, i);
    await applyBytes(bytes, before, { remap: (items) => remapInserted(items, i + 1), current: i + 1 });
    setStatus(`Đã nhân bản trang ${i + 1}.`);
  });
}

function deleteCurrentPage() {
  if (state.pageSizes.length <= 1) return setStatus('Không thể xóa trang duy nhất của tài liệu.', true);
  return withBusy('Đang xóa trang…', async () => {
    const i = state.current;
    const before = snap();
    const bytes = await deletePages(state.pdfBytes, [i]);
    await applyBytes(bytes, before, { remap: (items) => remapDeleted(items, i), current: Math.min(i, state.pageSizes.length - 2) });
    setStatus(`Đã xóa trang ${i + 1}. Nhấn Ctrl+Z để hoàn tác.`);
  });
}

function openExtractDialog() {
  const input = el('input', { type: 'text', value: `${state.current + 1}`, placeholder: 'Ví dụ 1-3, 5', autofocus: true });
  const error = el('p', { class: 'dlg-error' });
  openDialog({
    title: 'Trích xuất trang',
    body: el('div', {}, field(`Trang (1–${state.pageSizes.length})`, input, 'Tệp mới gồm các trang đã chọn, kèm mọi chỉnh sửa.'), error),
    actions: [
      { label: 'Hủy' },
      {
        label: 'Trích xuất',
        primary: true,
        run: async () => {
          let indices;
          try {
            indices = parsePageRange(input.value, state.pageSizes.length);
          } catch (err) {
            error.textContent = err.message;
            return false;
          }
          await withBusy('Đang trích xuất…', async () => {
            const out = await protectOutput(await extractPages(await buildOutput(), indices));
            const name = `${baseName(state.fileName)}-trang-${formatPageRange(indices)}.pdf`;
            download(out, name);
            setStatus(`Đã trích xuất ${indices.length} trang vào ${name}.`);
          });
        },
      },
    ],
  });
}

function combineFiles(files) {
  return withBusy('Đang kết hợp tệp…', async () => {
    const before = snap();
    let bytes = state.pdfBytes;
    for (const f of files) bytes = await appendPdf(bytes, await readFile(f));
    const added = state.pageSizes.length;
    await applyBytes(bytes, before);
    setStatus(`Đã thêm ${files.length} tệp vào cuối tài liệu (${state.pageSizes.length - added} trang).`);
  });
}

async function confirmReplace() {
  if (!state.pdfBytes || !state.history.length) return true;
  return confirmDialog('Mở tài liệu mới?', 'Các chỉnh sửa chưa xuất của tài liệu hiện tại sẽ mất.', 'Tiếp tục');
}

async function newBlankDocument() {
  if (!(await confirmReplace())) return;
  await withBusy('Đang tạo tài liệu…', async () => openBytes(await blankPdf(), 'tai-lieu-moi.pdf'));
}

async function createFromImages(files) {
  if (!(await confirmReplace())) return;
  await withBusy('Đang tạo PDF từ ảnh…', async () => {
    const images = [];
    for (const f of files) {
      const { src } = await toEmbeddableImage(f);
      images.push({ bytes: dataUrlToBytes(src), type: src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg' });
    }
    await openBytes(await imagesToPdf(images), 'anh.pdf');
    setStatus(`Đã tạo PDF ${images.length} trang từ ảnh.`);
  });
}

async function exportCurrent() {
  if (!state.pdfBytes) return;
  select(null);
  await withBusy('Đang xuất PDF…', async () => {
    const out = await protectOutput(await buildOutput());
    const name = `${baseName(state.fileName)}-edited.pdf`;
    download(out, name);
    const notes = [];
    if (state.marks.some((m) => m.type === 'redact')) notes.push('Các trang có vùng che đã chuyển thành ảnh.');
    if (state.settings.protection) notes.push(state.settings.protection.userPassword ? 'Tệp cần mật khẩu để mở.' : 'Tệp đã đặt hạn chế quyền.');
    if (state.settings.ocrWords.length) notes.push('Có lớp chữ OCR, tìm kiếm được.');
    setStatus(`Đã xuất ${name}. ${notes.join(' ')}`.trim());
  });
}

// Saved files get the password protection set in Bảo vệ › Đặt mật khẩu; previews and prints do not.
async function protectOutput(bytes) {
  const p = state.settings.protection;
  if (!p) return bytes;
  setStatus('Đang mã hóa AES-256…');
  return encryptPdf(bytes, p);
}

async function renderOutputPage(bytes, index, scale) {
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  try {
    const page = await doc.getPage(index + 1);
    const view = page.getViewport({ scale });
    const canvas = el('canvas', { width: Math.ceil(view.width), height: Math.ceil(view.height) });
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: view }).promise;
    return canvas;
  } finally {
    doc.destroy();
  }
}

function exportPageImage() {
  return withBusy('Đang xuất ảnh…', async () => {
    const i = state.current;
    const canvas = await renderOutputPage(await buildOutput(), i, 2);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const name = `${baseName(state.fileName)}-trang-${i + 1}.png`;
    download(blob, name);
    setStatus(`Đã xuất ${name}.`);
  });
}

// Prints the exported PDF (with every edit) through the browser's PDF viewer in a hidden frame.
function printDocument() {
  return withBusy('Đang chuẩn bị in…', async () => {
    const url = URL.createObjectURL(new Blob([await buildOutput()], { type: 'application/pdf' }));
    const frame = el('iframe', { class: 'print-frame', src: url, title: 'In' });
    frame.addEventListener('load', () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setStatus('Đã mở hộp thoại in.');
      } catch {
        window.open(url, '_blank', 'noopener');
        setStatus('Trình duyệt chặn in trực tiếp; tệp đã mở trong thẻ mới để in.');
      }
    });
    document.body.append(frame);
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 120000);
  });
}

// ---------- OCR, conversion, protection ----------

function sizeLabel(n) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

const OCR_STATUS = {
  'loading tesseract core': 'đang tải bộ nhận dạng',
  'initializing tesseract': 'đang khởi tạo',
  'loading language traineddata': 'đang tải dữ liệu ngôn ngữ',
  'initializing api': 'đang khởi tạo',
  'recognizing text': 'đang nhận dạng',
};

function openOcrDialog() {
  const lang = el('select', {}, OCR_LANGUAGES.map((l) => el('option', { value: l.id }, l.label)));
  const scope = el('select', {},
    el('option', { value: 'current' }, `Trang hiện tại (${state.current + 1})`),
    el('option', { value: 'all' }, `Tất cả ${state.pageSizes.length} trang`),
    el('option', { value: 'range' }, 'Dãy trang…'),
  );
  const range = el('input', { type: 'text', placeholder: 'Ví dụ 1-3, 5', disabled: true });
  scope.addEventListener('change', () => {
    range.disabled = scope.value !== 'range';
    if (!range.disabled) range.focus();
  });
  const skip = el('input', { type: 'checkbox', checked: true });
  const error = el('p', { class: 'dlg-error' });
  openDialog({
    title: 'Nhận dạng chữ (OCR)',
    body: el('div', {},
      el('p', { class: 'dlg-hint' }, 'Dành cho bản quét và ảnh chụp. Chữ nhận dạng dùng được để tìm kiếm, xuất văn bản, và được ghi thành lớp chữ ẩn khi xuất PDF. Lần đầu cần tải dữ liệu ngôn ngữ (vài MB).'),
      field('Ngôn ngữ', lang), field('Trang', scope), range,
      el('label', { class: 'lbl small' }, skip, 'Bỏ qua trang đã có chữ'),
      error,
    ),
    actions: [
      { label: 'Hủy' },
      {
        label: 'Bắt đầu',
        primary: true,
        run: () => {
          let pages;
          try {
            pages = scope.value === 'current' ? [state.current] : scope.value === 'all' ? state.pageSizes.map((_, i) => i) : parsePageRange(range.value, state.pageSizes.length);
          } catch (err) {
            error.textContent = err.message;
            return false;
          }
          runOcr(pages, lang.value, skip.checked);
        },
      },
    ],
  });
}

function runOcr(pages, lang, skipTextPages) {
  return withBusy('Đang chuẩn bị OCR…', async () => {
    const before = snap();
    let words = state.settings.ocrWords;
    let done = 0;
    let skipped = 0;
    let found = 0;
    for (const [k, i] of pages.entries()) {
      if (skipTextPages && (await pdfTextItems(i)).some((it) => it.str.trim())) {
        skipped++;
        continue;
      }
      const label = `OCR trang ${i + 1} (${k + 1}/${pages.length})`;
      setStatus(`${label}…`);
      const pageWords = await ocrPage(state.doc, i, lang, (m) => {
        const pct = typeof m.progress === 'number' ? ` ${Math.round(m.progress * 100)}%` : '';
        setStatus(`${label}: ${OCR_STATUS[m.status] ?? m.status ?? ''}${pct}`);
      });
      // Re-running OCR on a page replaces its earlier words.
      words = [...words.filter((w) => w.page !== i), ...pageWords.map(({ confidence, ...w }) => ({ ...w, page: i }))];
      found += pageWords.length;
      done++;
    }
    if (done) {
      state.settings = { ...state.settings, ocrWords: words };
      pushHistory(before);
      refresh();
    }
    const skipNote = skipped ? `, bỏ qua ${skipped} trang đã có chữ` : '';
    setStatus(done ? `Đã nhận dạng ${found} từ trên ${done} trang${skipNote}. Tìm kiếm được ngay; khi xuất PDF sẽ có lớp chữ ẩn.` : `Không có trang nào cần OCR (${skipped} trang đã có chữ). Bỏ chọn "Bỏ qua trang đã có chữ" để chạy lại.`);
  });
}

function toggleOcrBoxes() {
  state.showOcr = !state.showOcr;
  refresh();
  const n = state.settings.ocrWords.length;
  setStatus(!state.showOcr ? 'Đã ẩn khung chữ OCR.' : n ? `Đang hiện ${n} khung chữ OCR.` : 'Chưa có chữ OCR. Hãy chạy Chuyển đổi › Nhận dạng chữ trước.');
}

// Text, Word and HTML are built from the exported PDF, so redacted text never leaks into them and
// OCR text is included. Watermark and header/footer are left out of the content.
function exportContent(format) {
  return withBusy('Đang trích xuất nội dung…', async () => {
    const doc = await pdfjsLib.getDocument({ data: await buildOutput({ watermark: null, headerFooter: null }) }).promise;
    const pages = [];
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        setStatus(`Đang đọc chữ trang ${i}/${doc.numPages}…`);
        pages.push(groupLines(await textItemsOf(await doc.getPage(i))));
      }
    } finally {
      doc.destroy();
    }
    if (!pages.some((lines) => lines.length)) {
      return setStatus('Tài liệu không có chữ để xuất. Nếu là bản quét, hãy chạy Nhận dạng chữ (OCR) trước.', true);
    }
    const base = baseName(state.fileName);
    const title = state.settings.meta?.title || state.docInfo?.Title || base;
    if (format === 'txt') download(new Blob(['﻿', pagesToText(pages)], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
    else if (format === 'html') download(new Blob([pagesToHtml(title, pages)], { type: 'text/html;charset=utf-8' }), `${base}.html`);
    else download(await buildDocx(title, pages), `${base}.docx`);
    const lines = pages.reduce((n, l) => n + l.length, 0);
    setStatus(`Đã xuất ${base}.${format} (${pages.length} trang, ${lines} dòng). Chỉ giữ chữ, không giữ bố cục và hình.`);
  });
}

function extractAllImages() {
  return withBusy('Đang tách ảnh…', async () => {
    const doc = await pdfjsLib.getDocument({ data: await buildOutput({ watermark: null, headerFooter: null }) }).promise;
    let files;
    try {
      files = await extractImages(doc, (p, n) => setStatus(`Đang tách ảnh trang ${p}/${n}…`));
    } finally {
      doc.destroy();
    }
    if (!files.length) return setStatus('Tài liệu không có ảnh nào đủ lớn để tách.');
    setStatus(`Đang nén ${files.length} ảnh…`);
    const name = `${baseName(state.fileName)}-anh.zip`;
    download(await zipFiles(files), name, 'application/zip');
    setStatus(`Đã tách ${files.length} ảnh vào ${name}.`);
  });
}

function compressDocument() {
  return withBusy('Đang giảm dung lượng…', async () => {
    const before = snap();
    const oldSize = state.pdfBytes.length;
    const bytes = await compressPdf(state.pdfBytes);
    if (bytes.length >= oldSize) return setStatus(`Tệp đã gọn (${sizeLabel(oldSize)}), không giảm thêm được.`);
    await applyBytes(bytes, before);
    setStatus(`Đã giảm từ ${sizeLabel(oldSize)} xuống ${sizeLabel(bytes.length)} (−${Math.round((1 - bytes.length / oldSize) * 100)}%). Ctrl+Z để hoàn tác.`);
  });
}

function openProtectDialog() {
  const p = state.settings.protection ?? { userPassword: '', ownerPassword: '', allowPrint: true, allowCopy: true, allowModify: false };
  const pw = (value, extra = {}) => el('input', { type: 'password', value, autocomplete: 'new-password', ...extra });
  const user = pw(p.userPassword, { autofocus: true });
  const again = pw(p.userPassword);
  const owner = pw(p.ownerPassword, { placeholder: 'Để trống: tạo ngẫu nhiên' });
  const box = (checked, label) => {
    const input = el('input', { type: 'checkbox', checked });
    return [input, el('label', { class: 'lbl small' }, input, label)];
  };
  const [print, printRow] = box(p.allowPrint, 'Cho phép in');
  const [copy, copyRow] = box(p.allowCopy, 'Cho phép sao chép chữ và ảnh');
  const [modify, modifyRow] = box(p.allowModify, 'Cho phép chỉnh sửa');
  const error = el('p', { class: 'dlg-error' });
  const actions = [
    { label: 'Hủy' },
    {
      label: 'Áp dụng',
      primary: true,
      run: () => {
        if (user.value !== again.value) {
          error.textContent = 'Hai lần nhập mật khẩu mở tệp không khớp.';
          return false;
        }
        if (!user.value && print.checked && copy.checked && modify.checked) {
          error.textContent = 'Hãy đặt mật khẩu mở tệp, hoặc bỏ ít nhất một quyền.';
          return false;
        }
        updateSettings({ protection: { userPassword: user.value, ownerPassword: owner.value, allowPrint: print.checked, allowCopy: copy.checked, allowModify: modify.checked } });
        setStatus('Đã đặt bảo vệ. Áp dụng khi xuất PDF (mã hóa AES-256).');
      },
    },
  ];
  if (state.settings.protection) actions.unshift({ label: 'Gỡ bảo vệ', danger: true, run: () => { updateSettings({ protection: null }); setStatus('Đã gỡ bảo vệ; tệp xuất ra sẽ không có mật khẩu.'); } });
  openDialog({
    title: 'Đặt mật khẩu',
    body: el('div', {},
      el('p', { class: 'dlg-hint' }, 'Mã hóa AES-256 bằng QPDF ngay trong trình duyệt. Mật khẩu chỉ giữ trong phiên làm việc này và không gửi đi đâu.'),
      field('Mật khẩu mở tệp', user, 'Để trống nếu chỉ muốn hạn chế quyền.'),
      field('Nhập lại', again),
      field('Mật khẩu chủ sở hữu (đổi quyền)', owner),
      printRow, copyRow, modifyRow, error,
    ),
    actions,
  });
}

function openSanitizeDialog() {
  const on = state.settings.sanitize;
  const items = ['Thông tin tài liệu và metadata XMP (tác giả, phần mềm tạo, ngày tạo…)', 'Mã JavaScript cấp tài liệu', 'Tệp đính kèm nhúng', 'Hành động tự chạy khi mở tài liệu hoặc trang'];
  openDialog({
    title: 'Xóa thông tin ẩn',
    body: el('div', {},
      el('p', { class: 'dlg-text' }, on ? 'Đang bật. Khi xuất, tệp sẽ được làm sạch:' : 'Khi bật, tệp xuất ra sẽ được làm sạch:'),
      el('ul', { class: 'dlg-list' }, items.map((t) => el('li', {}, t))),
      el('p', { class: 'dlg-hint' }, 'Không gỡ được JavaScript gắn trong từng trường biểu mẫu hay liên kết. Thuộc tính bạn tự đặt trong Thuộc tính tài liệu vẫn được giữ.'),
    ),
    actions: on
      ? [{ label: 'Tắt làm sạch', danger: true, run: () => updateSettings({ sanitize: false }) }, { label: 'Đóng', primary: true }]
      : [{ label: 'Hủy' }, { label: 'Bật khi xuất', primary: true, run: () => { updateSettings({ sanitize: true }); setStatus('Đã bật xóa thông tin ẩn khi xuất.'); } }],
  });
}

// ---------- dialogs ----------

function openLinkDialog(id) {
  const m = findMark(id);
  if (!m) return;
  const input = el('input', { type: 'url', value: m.url, placeholder: 'https://example.com hoặc email', autofocus: true });
  const error = el('p', { class: 'dlg-error' });
  openDialog({
    title: 'Liên kết',
    body: el('div', {}, field('Địa chỉ', input, 'Chỉ nhận liên kết web (http, https) và email.'), error),
    actions: [
      { label: 'Bỏ qua' },
      {
        label: 'Lưu',
        primary: true,
        run: () => {
          const url = safeUrl(withScheme(input.value));
          if (!url) {
            error.textContent = 'Địa chỉ không hợp lệ.';
            return false;
          }
          const before = snap();
          state.marks = updateMark(state.marks, id, { url });
          pushHistory(before);
          refresh();
        },
      },
    ],
  });
}

function openWatermarkDialog() {
  const wm = state.settings.watermark ?? { text: 'BẢN NHÁP', fontSize: 60, color: '#888888', opacity: 0.25, angle: 45 };
  const text = el('input', { type: 'text', value: wm.text, autofocus: true });
  const size = el('input', { type: 'number', min: 8, max: 200, value: wm.fontSize });
  const color = el('input', { type: 'color', value: wm.color });
  const opacity = el('input', { type: 'range', min: 5, max: 100, step: 5, value: Math.round(wm.opacity * 100) });
  const angle = el('input', { type: 'number', min: -90, max: 90, value: wm.angle });
  const actions = [
    { label: 'Hủy' },
    {
      label: 'Áp dụng',
      primary: true,
      run: () => {
        const next = sanitizeWatermark({ text: text.value, fontSize: size.value, color: color.value, opacity: Number(opacity.value) / 100, angle: angle.value });
        if (!next) {
          setStatus('Hãy nhập nội dung hình mờ.', true);
          return false;
        }
        updateSettings({ watermark: next });
        setStatus('Đã đặt hình mờ cho mọi trang.');
      },
    },
  ];
  if (state.settings.watermark) actions.unshift({ label: 'Gỡ hình mờ', danger: true, run: () => updateSettings({ watermark: null }) });
  openDialog({
    title: 'Hình mờ',
    body: el('div', { class: 'dlg-grid' }, field('Nội dung', text), field('Cỡ chữ', size), field('Màu', color), field('Độ mờ (%)', opacity), field('Góc xoay (độ)', angle)),
    actions,
  });
}

function openHeaderFooterDialog() {
  const hf = state.settings.headerFooter ?? { footerCenter: 'Trang {page} / {total}', fontSize: 10, color: '#000000', margin: 24, batesPrefix: '', batesStart: 1, batesDigits: 6 };
  const inputs = Object.fromEntries(HEADER_FOOTER_SLOTS.map((s) => [s, el('input', { type: 'text', value: hf[s] ?? '' })]));
  const size = el('input', { type: 'number', min: 6, max: 36, value: hf.fontSize ?? 10 });
  const color = el('input', { type: 'color', value: hf.color ?? '#000000' });
  const margin = el('input', { type: 'number', min: 6, max: 144, value: hf.margin ?? 24 });
  const prefix = el('input', { type: 'text', value: hf.batesPrefix ?? '', placeholder: 'VD: HSO-' });
  const start = el('input', { type: 'number', min: 0, value: hf.batesStart ?? 1 });
  const digits = el('input', { type: 'number', min: 1, max: 12, value: hf.batesDigits ?? 6 });
  const actions = [
    { label: 'Hủy' },
    {
      label: 'Áp dụng',
      primary: true,
      run: () => {
        const next = sanitizeHeaderFooter({
          ...Object.fromEntries(HEADER_FOOTER_SLOTS.map((s) => [s, inputs[s].value])),
          fontSize: size.value,
          color: color.value,
          margin: margin.value,
          batesPrefix: prefix.value,
          batesStart: start.value,
          batesDigits: digits.value,
        });
        if (!next) {
          setStatus('Hãy nhập nội dung cho ít nhất một vị trí.', true);
          return false;
        }
        updateSettings({ headerFooter: next });
        setStatus('Đã đặt đầu/chân trang cho mọi trang.');
      },
    },
  ];
  if (state.settings.headerFooter) actions.unshift({ label: 'Gỡ đầu/chân trang', danger: true, run: () => updateSettings({ headerFooter: null }) });
  openDialog({
    title: 'Đầu trang, chân trang & số Bates',
    width: 620,
    body: el('div', {},
      el('div', { class: 'hf-grid' },
        el('span'), el('span', { class: 'lbl' }, 'Trái'), el('span', { class: 'lbl' }, 'Giữa'), el('span', { class: 'lbl' }, 'Phải'),
        el('span', { class: 'lbl' }, 'Đầu trang'), inputs.headerLeft, inputs.headerCenter, inputs.headerRight,
        el('span', { class: 'lbl' }, 'Chân trang'), inputs.footerLeft, inputs.footerCenter, inputs.footerRight,
      ),
      el('p', { class: 'dlg-hint' }, 'Mã thay thế: {page} số trang, {total} tổng số trang, {date} ngày, {file} tên tệp, {bates} số Bates.'),
      el('div', { class: 'dlg-grid' }, field('Cỡ chữ', size), field('Màu', color), field('Lề (pt)', margin), field('Tiền tố Bates', prefix), field('Bates bắt đầu', start), field('Số chữ số', digits)),
    ),
    actions,
  });
}

function openPropertiesDialog() {
  const info = state.docInfo ?? {};
  const meta = state.settings.meta ?? { title: info.Title ?? '', author: info.Author ?? '', subject: info.Subject ?? '', keywords: info.Keywords ?? '' };
  const inputs = {
    title: el('input', { type: 'text', value: meta.title, autofocus: true }),
    author: el('input', { type: 'text', value: meta.author }),
    subject: el('input', { type: 'text', value: meta.subject }),
    keywords: el('input', { type: 'text', value: meta.keywords, placeholder: 'cách nhau bằng dấu phẩy' }),
  };
  const kb = Math.round(state.pdfBytes.length / 1024);
  openDialog({
    title: 'Thuộc tính tài liệu',
    body: el('div', {},
      el('dl', { class: 'props-info' },
        el('dt', {}, 'Tệp'), el('dd', {}, state.fileName),
        el('dt', {}, 'Số trang'), el('dd', {}, `${state.pageSizes.length}`),
        el('dt', {}, 'Dung lượng'), el('dd', {}, `${kb.toLocaleString('vi-VN')} KB`),
        el('dt', {}, 'Phiên bản PDF'), el('dd', {}, info.PDFFormatVersion ?? '—'),
        el('dt', {}, 'Ứng dụng tạo'), el('dd', {}, info.Producer ?? info.Creator ?? '—'),
        el('dt', {}, 'Biểu mẫu'), el('dd', {}, state.formFields.length ? `${state.formFields.length} trường` : 'Không có'),
      ),
      field('Tiêu đề', inputs.title), field('Tác giả', inputs.author), field('Chủ đề', inputs.subject), field('Từ khóa', inputs.keywords),
    ),
    actions: [
      { label: 'Hủy' },
      { label: 'Lưu', primary: true, run: () => updateSettings({ meta: sanitizeMeta(Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]))) }) },
    ],
  });
}

// Signature pad: draw with mouse, pen or finger; the result is cropped to the ink and placed as an image.
function openSignaturePad() {
  const canvas = el('canvas', { class: 'sigpad', width: 560, height: 200 });
  const ctx = canvas.getContext('2d');
  let color = '#000000';
  let drawn = false;
  let drawing = null;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height];
  };
  canvas.addEventListener('pointerdown', (e) => {
    capturePointer(canvas, e.pointerId);
    drawing = e.pointerId;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(...pos(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drawing !== e.pointerId) return;
    ctx.lineTo(...pos(e));
    ctx.stroke();
    drawn = true;
  });
  const stop = () => (drawing = null);
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  const colors = el('div', { class: 'sig-colors' },
    ['#000000', '#1b3fa0', '#c62828'].map((c) => el('button', { class: `swatch${c === color ? ' on' : ''}`, style: `background:${c}`, 'aria-label': `Màu ${c}`, onclick: (e) => {
      color = c;
      colors.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s === e.currentTarget));
    } })),
  );
  openDialog({
    title: 'Chữ ký',
    width: 620,
    body: el('div', {}, el('p', { class: 'dlg-hint' }, 'Ký vào khung bên dưới bằng chuột, bút hoặc ngón tay.'), canvas, colors),
    actions: [
      { label: 'Xóa nét', run: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); drawn = false; return false; } },
      { label: 'Hủy' },
      {
        label: 'Thêm chữ ký',
        primary: true,
        run: () => {
          if (!drawn) {
            setStatus('Hãy ký vào khung trước.', true);
            return false;
          }
          const crop = cropToInk(canvas);
          placeImage(crop.toDataURL('image/png'), crop.width, crop.height, 160);
          setStatus('Đã thêm chữ ký. Kéo để đặt đúng chỗ, kéo góc phải dưới để đổi cỡ.');
        },
      },
    ],
  });
}

function cropToInk(canvas) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const pad = 4;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  const w = Math.min(width, x1 + pad) - x0;
  const h = Math.min(height, y1 + pad) - y0;
  const out = el('canvas', { width: w, height: h });
  out.getContext('2d').drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
  return out;
}

function showShortcuts() {
  const rows = [
    ['Ctrl+K', 'Tìm công cụ và lệnh'], ['Ctrl+O', 'Mở PDF'], ['Ctrl+S', 'Xuất PDF'], ['Ctrl+P', 'In'], ['Ctrl+F', 'Tìm văn bản'],
    ['Ctrl+Z / Ctrl+Y', 'Hoàn tác / làm lại'], ['Del', 'Xóa mục đã chọn'], ['Mũi tên', 'Dịch mục 1 pt (Shift: 10 pt)'],
    ['Ctrl+ + / −', 'Phóng to / thu nhỏ'], ['Ctrl+0 / 1 / 2', '100% / vừa trang / vừa chiều rộng'], ['Esc', 'Về công cụ Chọn'],
  ];
  openDialog({
    title: 'Phím tắt',
    body: el('table', { class: 'keys' }, rows.map(([k, d]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, d)))),
    actions: [{ label: 'Đóng', primary: true }],
  });
}

function openPalette() {
  const fold = (s) => s.toLocaleLowerCase('vi').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  const entries = [
    ...Object.entries(TOOL_INFO).map(([t, info]) => ({ label: info.label, icon: info.icon, detail: 'Công cụ', run: () => setTool(t) })),
    ...Object.entries(ACTIONS).filter(([id]) => id !== 'palette').map(([id, a]) => ({ label: a.label, icon: a.icon, detail: a.key ?? 'Lệnh', run: () => runAction(id) })),
    ...Object.entries(MODES).map(([k, m]) => ({ label: `Chế độ: ${m.label}`, icon: 'command', detail: 'Chế độ', run: () => setMode(k) })),
  ];
  const score = (label, q) => {
    if (!q) return 0;
    const h = fold(label);
    const at = h.indexOf(q);
    if (at >= 0) return at;
    let k = 0;
    for (const c of h) if (c === q[k]) k++;
    return k === q.length ? 100 : -1;
  };
  const input = el('input', { type: 'search', class: 'pal-input', placeholder: 'Tìm công cụ và lệnh…', autofocus: true, 'aria-label': 'Tìm công cụ và lệnh' });
  const list = el('div', { class: 'pal-list', role: 'listbox' });
  let shown = [];
  let sel = 0;
  let close = () => {};
  const run = (entry) => {
    close();
    entry.run();
  };
  const draw = () => {
    const q = fold(input.value.trim());
    shown = entries.map((e) => ({ e, s: score(e.label, q) })).filter((x) => x.s >= 0).sort((a, b) => a.s - b.s).slice(0, 12).map((x) => x.e);
    sel = clamp(sel, 0, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((e, i) => el('button', { class: `pal-item${i === sel ? ' on' : ''}`, role: 'option', onclick: () => run(e) }, icon(e.icon, 17), el('span', { class: 'grow' }, e.label), el('span', { class: 'key' }, e.detail))));
    if (!shown.length) list.append(el('p', { class: 'lbl', style: 'padding:8px' }, 'Không có lệnh phù hợp'));
  };
  input.addEventListener('input', () => {
    sel = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = clamp(sel + (e.key === 'ArrowDown' ? 1 : -1), 0, Math.max(0, shown.length - 1));
      draw();
    } else if (e.key === 'Enter' && shown[sel]) {
      e.preventDefault();
      run(shown[sel]);
    }
  });
  close = openDialog({ title: 'Tìm công cụ và lệnh', width: 560, body: el('div', {}, input, list) });
  draw();
}

// ---------- loading ----------

async function loadDocument(bytes, { fresh = false } = {}) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const old = state.doc;
  state.doc = doc;
  if (old && old !== doc) old.destroy();
  state.pageSizes = [];
  for (let i = 0; i < doc.numPages; i++) {
    const { width, height } = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
    state.pageSizes.push({ width, height });
  }
  state.textCache = new Map();
  state.search = { ...state.search, hits: [], index: -1 };
  state.formFields = await readFormFields(bytes);
  if (fresh) {
    state.current = 0;
    state.zoom = clamp(fitZoom('width'), 0.25, 4);
    state.fit = 'width';
    els.zoominfo.textContent = `${Math.round(state.zoom * 100)}%`;
    try {
      state.docInfo = (await doc.getMetadata()).info ?? null;
    } catch {
      state.docInfo = null;
    }
  }
  state.current = clamp(state.current, 0, doc.numPages - 1);
  renderToolbar();
  updateQuick();
  buildThumbnails(doc);
  await renderDocument();
}

async function openBytes(bytes, name) {
  state.pdfBytes = bytes;
  state.fileName = name;
  state.boxes = [];
  state.marks = [];
  state.settings = EMPTY_SETTINGS;
  state.history = [];
  state.future = [];
  state.selected = null;
  state.search = { query: '', caseSensitive: false, hits: [], index: -1 };
  await loadDocument(bytes, { fresh: true });
  setStatus(`Đã mở ${name} (${state.pageSizes.length} trang).`);
}

async function openPdfFile(file) {
  if (!(await confirmReplace())) return;
  let bytes = await readFile(file);
  let protection = null;
  if (await isEncrypted(bytes)) {
    let unlocked;
    try {
      unlocked = await unlockPdf(bytes, file.name);
    } catch (err) {
      return setStatus(err.message, true);
    }
    if (!unlocked) return setStatus('Đã hủy mở tệp có mật khẩu.');
    ({ bytes, protection } = unlocked);
  }
  await withBusy('Đang mở tệp…', async () => {
    try {
      await openBytes(bytes, file.name);
    } catch (err) {
      throw new Error(`Không mở được PDF: ${err.message}`);
    }
    if (protection) {
      state.settings = { ...state.settings, protection };
      setStatus(`Đã mở khóa ${file.name}. Khi xuất, tệp vẫn cần mật khẩu cũ (đổi ở Bảo vệ › Đặt mật khẩu).`);
    }
  });
}

// Whether `password` opens the file: 'ok', 'need' (none given) or 'wrong'. pdf.js reports this
// precisely; this QPDF build does not pass its error text back.
async function checkPassword(bytes, password) {
  try {
    (await pdfjsLib.getDocument({ data: bytes.slice(), password }).promise).destroy();
    return 'ok';
  } catch (err) {
    if (err?.name !== 'PasswordException') throw err;
    return err.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD ? 'wrong' : 'need';
  }
}

// Encrypted files: permission-only protection opens without a password; otherwise ask for it.
async function unlockPdf(bytes, name) {
  setStatus('Tệp được mã hóa, đang mở khóa…');
  if ((await checkPassword(bytes, '')) === 'ok') {
    const plain = await decryptPdf(bytes, '');
    setStatus(`${name} có hạn chế quyền (in, sao chép, sửa); đã gỡ để chỉnh sửa.`);
    return { bytes: plain, protection: null };
  }
  return new Promise((resolve) => {
    let result = null;
    const input = el('input', { type: 'password', autofocus: true, autocomplete: 'off', 'aria-label': 'Mật khẩu' });
    const error = el('p', { class: 'dlg-error' });
    openDialog({
      title: 'Tệp có mật khẩu',
      body: el('div', {}, el('p', { class: 'dlg-text' }, `"${name}" cần mật khẩu để mở.`), field('Mật khẩu', input), error),
      actions: [
        { label: 'Hủy' },
        {
          label: 'Mở khóa',
          primary: true,
          run: async () => {
            error.textContent = 'Đang kiểm tra…';
            try {
              if ((await checkPassword(bytes, input.value)) !== 'ok') throw new Error('Mật khẩu không đúng.');
              const plain = await decryptPdf(bytes, input.value);
              result = { bytes: plain, protection: { userPassword: input.value, ownerPassword: '', allowPrint: true, allowCopy: true, allowModify: false } };
            } catch (err) {
              error.textContent = err.message;
              input.select();
              return false;
            }
          },
        },
      ],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      input.closest('.dlg')?.querySelector('.dlg-actions .primary')?.click();
    });
  });
}

// ---------- events ----------

function onFiles(input, handler) {
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = ''; // allow choosing the same file again
    if (files.length) await handler(files);
  });
}

onFiles(els.pdfInput, (files) => openPdfFile(files[0]));
onFiles(els.combineInput, combineFiles);
onFiles(els.imagesPdfInput, createFromImages);
onFiles(els.imageInput, async ([file]) => {
  try {
    const img = await toEmbeddableImage(file);
    placeImage(img.src, img.width, img.height);
    setStatus('Đã chèn ảnh. Kéo để di chuyển, kéo góc phải dưới để đổi cỡ.');
  } catch (err) {
    setStatus(err.message, true);
  }
});
onFiles(els.fontInput, async ([file]) => {
  state.fontBytes = await readFile(file);
  setStatus(`Đã tải font ${file.name}. Chữ tiếng Việt sẽ dùng font này khi xuất.`);
});

els.view.addEventListener('scroll', updatePageFromScroll, { passive: true });
els.view.addEventListener('scrollend', () => {
  navTarget = null;
});
// The user scrolling by hand takes over from a programmatic scroll.
els.view.addEventListener('wheel', () => (navTarget = null), { passive: true });
els.panelTabs.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-panel]');
  if (b) showPanel(b.dataset.panel);
});

// Drop a PDF to open it, or images to place them on the current page.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files ?? [])];
  const pdf = files.find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (pdf) return openPdfFile(pdf);
  const image = files.find((f) => f.type.startsWith('image/'));
  if (image && state.pdfBytes) {
    const img = await toEmbeddableImage(image);
    placeImage(img.src, img.width, img.height);
  }
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.fit && fitTo(state.fit), 150);
});

document.addEventListener('keydown', (e) => {
  if (isDialogOpen()) return;
  const typing = e.target.closest?.('[contenteditable="true"], textarea, input, select');
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const go = (fn) => {
    e.preventDefault();
    fn();
  };
  if (mod && key === 'k') return go(() => runAction('palette'));
  if (mod && key === 'o') return go(() => runAction('open'));
  if (mod && key === 's') return go(() => runAction('export'));
  if (mod && key === 'p') return go(() => runAction('print'));
  if (mod && key === 'f') return go(() => runAction('find'));
  if (mod && !typing && key === 'z' && !e.shiftKey) return go(undo);
  if (mod && !typing && (key === 'y' || (key === 'z' && e.shiftKey))) return go(redo);
  if (mod && (e.key === '=' || e.key === '+')) return go(() => zoomBy(1));
  if (mod && e.key === '-') return go(() => zoomBy(-1));
  if (mod && e.key === '0') return go(() => setZoom(1));
  if (mod && e.key === '1') return go(() => fitTo('page'));
  if (mod && e.key === '2') return go(() => fitTo('width'));
  if (typing) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) return go(deleteSelected);
  if (state.selected && e.key.startsWith('Arrow')) {
    const step = e.shiftKey ? 10 : 1;
    const dir = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (dir) return go(() => nudgeSelected(...dir));
  }
  if (e.key === 'Escape') {
    closeMenus();
    if (state.gesture) cancelGesture();
    else if (state.tool !== 'select') setTool('select');
    else select(null);
  }
});

// ---------- startup ----------

try {
  const saved = localStorage.getItem('pdfEditor.theme');
  if (saved) applyTheme(saved);
} catch {
  // Storage can be blocked; fall back to the system theme.
}

for (const id of ['rotateLeft', 'rotateRight', 'movePageUp', 'movePageDown', 'insertBlank', 'deletePage']) {
  const a = ACTIONS[id];
  els.thumbActions.append(iconButton(a.icon, a.label, () => runAction(id)));
}

buildMenubar();
buildSearchPanel();
renderModebar();
renderToolbar();
renderProps();
renderPanel();
