// Entry point: builds the editor shell (title bar, ribbon, properties bar, status bar, thumbnails,
// side panels, dialogs, command palette) and wires it to the PDF.js page view, the item models,
// page operations and the pdf-lib exporter. The ribbon layout is in ribbon.js, its DOM in
// ribbonbar.js; every button runs a command of ACTIONS or TOOL_INFO through commandInfo().
//
// Every item is stored in view space: PDF points at scale 1 with the page's rotation applied,
// origin top-left (see geometry.js). Text boxes are scaled by the zoom factor; markup is drawn in an
// SVG whose viewBox is the page size, so zooming never changes stored coordinates.
//
// Undo snapshots hold { boxes, marks, settings, pdfBytes }. All four are replaced, never mutated,
// so a snapshot is just four references. Page operations produce new bytes and reload the view.
//
// The state lives in an EditorStore (store.js) that also carries the undo history and the events
// the components render from; components ask for changes with intents handled at the end of this file.

import { EVENTS, EditorStore } from './store.js';
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
import { formatPageRange, isIdentityOrder, moveSelectionOrder, parsePageRange, remapInserted, remapOrder } from './pages.js';
import { snapLines, snapRect } from './snap.js';
import { boundingBox } from './geometry.js';
import './components/thumbnail-sidebar.js';
import './components/canvas-view.js';
import {
  HEADER_FOOTER_SLOTS,
  batesLabel,
  formatTokens,
  headerFooterContext,
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
  readFormFields,
  reorderPages,
  rotatePages,
} from './pdfops.js';
import { cropPages, mergePdfs, pageBoxes } from './pdfops.js';
import { reverseOrder, splitPlan } from './pages.js';
import { contentBounds, croppedBox, marginsFromBounds, mmToPt, ptToMm, unionRects } from './crop.js';
import { loadUnicodeFont, needsUnicodeFont } from './fonts.js';
import { quickToolsGrid } from './quicktools.js';
import { bookmarkSlot, flattenOutline, indentBookmark, insertBookmark, moveBookmark, nextBookmarkId, remapBookmarks, removeBookmark, renameBookmark, visibleIndices } from './bookmarks.js';
import { rasterizeRedactions } from './redact.js';
import { compressPdf, decryptPdf, encryptPdf, isEncrypted } from './protect.js';
import { OCR_LANGUAGES, ocrPage } from './ocr.js';
import { buildDocx, extractImages, zipFiles } from './extract.js';
import { groupLines, pagesToHtml, pagesToText } from './textlayout.js';
import {
  clusterTextToGrid,
  docxToPdf,
  excelToPdf,
  exportPagesToImages,
  exportToExcel,
  imagesToPdfAdvanced,
  parseUserPageRange,
} from './converter.js';
import {
  AccountClient,
  VETVIRAL_URL,
  clientNameFrom,
  isSessionExpired,
  planLabel,
  resolveVetviralUrl,
  safeStorage,
  unreadCount,
} from './account.js';
import { exportPdf } from './export.js';
import { OFFICE_TYPES, resizeOffice } from './office/index.js';
import { OFFICE_DRAG_TOOLS, createOfficeUi } from './office/ui.js';
import { loadOfficeFonts, measure as officeMeasure, officeFontBytes } from './office/measure.js';
import { confirmDialog, el, field, icon, iconButton, isDialogOpen, openDialog, svgEl } from './dom.js';
import { openPrintDialog } from './print.js';
import { loadAppOptions, openOptionsDialog, saveAppOptions } from './options.js';
import { RIBBON_TABS, commandTool, detectPlatform, formatShortcut, ribbonCommandIds, tabForCommand, toolCommand } from './ribbon.js';
import { closeContextMenus, createPanelLayout, createRibbon, createStatusBar, openContextMenu } from './ribbonbar.js';

const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const HISTORY_LIMIT = 100;
// Shortcut labels follow the platform: ⌘K on Apple devices, Ctrl+K elsewhere.
const PLATFORM = detectPlatform({ platform: navigator.userAgentData?.platform ?? navigator.platform, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
const keyLabel = (key) => formatShortcut(key, PLATFORM);
const EMPTY_SETTINGS = Object.freeze({
  watermark: null,
  headerFooter: null,
  meta: null,
  formValues: {},
  flattenForm: false,
  protection: null, // { userPassword, ownerPassword, allowPrint, allowCopy, allowModify } applied on save
  sanitize: false,
  ocrWords: [], // [{ page, text, x, y, w, h }] written as an invisible text layer
  bookmarks: null, // edited outline (bookmarks.js) written on export; null keeps the file's own outline
});

// ---------- tools, actions, modes ----------

const TOOL_INFO = {
  select: { label: 'Chọn', icon: 'cursor' },
  hand: { label: 'Bàn tay (kéo để cuộn trang)', icon: 'hand' },
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
  // Office tools (src/office/): drawn with the pointer; formulas and tables come from ACTIONS.
  shape: { label: 'Hình vẽ', icon: 'shape' },
  connector: { label: 'Đường nối', icon: 'connector' },
  richtext: { label: 'Hộp chữ định dạng', icon: 'richtext' },
};
const TYPE_LABELS = { text: 'Chữ', image: 'Hình ảnh', symbol: 'Ký hiệu', formula: 'Công thức', table: 'Bảng' };
const DRAG_TOOLS = new Set(['highlight', 'underline', 'strike', 'squiggly', 'rect', 'oval', 'line', 'arrow', 'ink', 'link', 'redact', ...OFFICE_DRAG_TOOLS]);
const STROKE_TYPES = new Set(['underline', 'strike', 'squiggly', 'rect', 'oval', 'line', 'arrow', 'ink', 'stamp', 'symbol', 'shape', 'connector']);

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
  exportExcel: { label: 'Xuất Excel (.xlsx)', icon: 'excel', needsDoc: true, run: () => exportExcelCurrent() },
  exportImagesDpi: { label: 'Xuất ảnh chất lượng cao…', icon: 'png', needsDoc: true, run: () => openExportImagesDialog() },
  convertHub: { label: 'Trung tâm chuyển đổi…', icon: 'sync', run: () => openConversionHub() },
  excelToPdf: { label: 'Tạo PDF từ Excel…', icon: 'excel', run: () => els.excelPdfInput.click() },
  docxToPdf: { label: 'Tạo PDF từ Word…', icon: 'word', run: () => els.docxPdfInput.click() },
  exportHtml: { label: 'Xuất trang web (.html)', icon: 'html', needsDoc: true, run: () => exportContent('html') },
  extractImages: { label: 'Tách tất cả ảnh (.zip)', icon: 'images', needsDoc: true, run: extractAllImages },
  compress: { label: 'Giảm dung lượng', icon: 'compress', needsDoc: true, run: compressDocument },
  protect: { label: 'Đặt mật khẩu…', icon: 'lock', needsDoc: true, run: openProtectDialog },
  sanitize: { label: 'Xóa thông tin ẩn…', icon: 'sanitize', needsDoc: true, checked: () => state.settings.sanitize, run: openSanitizeDialog },
  quickTools: { label: 'Công cụ nhanh…', icon: 'bolt', run: openQuickTools },
  closeDoc: { label: 'Đóng tài liệu', icon: 'cross', needsDoc: true, run: closeDocument },
  merge: { label: 'Gộp nhiều PDF…', icon: 'merge', run: openMergeDialog },
  split: { label: 'Tách PDF…', icon: 'split', needsDoc: true, run: openSplitDialog },
  crop: { label: 'Cắt lề trang…', icon: 'crop', needsDoc: true, run: openCropDialog },
  pageNumbers: { label: 'Đánh số trang…', icon: 'hash', needsDoc: true, run: openPageNumbersDialog },
  organizePages: { label: 'Sắp xếp trang', icon: 'pages', needsDoc: true, run: () => setMode('organize') },
  unlock: { label: 'Gỡ mật khẩu tệp PDF…', icon: 'unlock', run: unlockQuick },
  outline: { label: 'Mục lục (bookmark)', icon: 'bookmark', needsDoc: true, run: () => showPanel('outline') },
  commentsPanel: { label: 'Danh sách chú thích', icon: 'comments', run: () => showPanel('comments') },
  toggleThumbs: { label: 'Hiện/ẩn ảnh thu nhỏ trang', icon: 'panelLeft', checked: () => !!layout?.isShown('left'), run: () => layout.toggle('left') },
  toggleSidebar: { label: 'Hiện/ẩn bảng bên', icon: 'panelRight', checked: () => !!layout?.isShown('right'), run: () => layout.toggle('right') },
  ribbonClassic: { label: 'Ribbon đầy đủ', icon: 'ribbon', checked: () => ribbon?.mode === 'classic', run: () => ribbon.setMode('classic') },
  ribbonSimple: { label: 'Ribbon gọn (một hàng)', icon: 'ribbonSimple', checked: () => ribbon?.mode === 'simple', run: () => ribbon.setMode('simple') },
  ribbonTabs: { label: 'Thu gọn ribbon (chỉ hiện tab)', icon: 'chevronUp', key: PLATFORM === 'mac' || PLATFORM === 'ios' ? 'Ctrl+Alt+R' : 'Ctrl+F1', checked: () => ribbon?.mode === 'tabs', run: () => ribbon.toggleCollapsed() },
  themeSystem: { label: 'Chủ đề theo hệ thống', icon: 'info', checked: () => state.theme === 'system', run: () => applyTheme('system') },
  themeLight: { label: 'Chủ đề sáng', icon: 'info', checked: () => state.theme === 'light', run: () => applyTheme('light') },
  themeDark: { label: 'Chủ đề tối', icon: 'info', checked: () => state.theme === 'dark', run: () => applyTheme('dark') },
  shortcuts: { label: 'Phím tắt', icon: 'command', run: showShortcuts },
  options: { label: 'Tùy chọn & Cài đặt…', icon: 'settings', key: 'Ctrl+,', run: showOptions },
  login: { label: 'Đăng nhập VET VIRAL…', icon: 'user', enabled: () => !account.signedIn, run: openLoginDialog },
  news: { label: 'Thông báo VET VIRAL', icon: 'bell', run: () => showPanel('news') },
  manageAccount: { label: 'Quản lý tài khoản VET VIRAL', icon: 'external', enabled: () => account.signedIn, run: () => openExternal(`${VETVIRAL_URL}/settings`) },
  logout: { label: 'Đăng xuất VET VIRAL', icon: 'logout', enabled: () => account.signedIn, run: logoutAccount },
  insertFormula: { label: 'Chèn công thức…', icon: 'formula', needsDoc: true, run: () => office.insertFormula() },
  insertTable: { label: 'Chèn bảng…', icon: 'table', needsDoc: true, run: () => office.insertTable() },
  reversePages: { label: 'Đảo ngược thứ tự trang', icon: 'swap', needsDoc: true, run: reversePages },
  addBookmark: { label: 'Thêm mục lục tại chỗ đang xem', icon: 'bookmark', needsDoc: true, run: addBookmarkHere },
};

// ---------- DOM and state ----------

const $ = (id) => document.getElementById(id);
const els = {
  titlebar: $('titlebar'),
  ribbon: $('ribbon'),
  statusbar: $('statusbar'),
  propsbar: $('propsbar'),
  panelLeft: document.querySelector('.panel.left'),
  thumbs: $('thumbs'),
  thumbActions: $('thumb-actions'),
  view: $('pages'),
  panelTabs: $('panel-tabs'),
  comments: $('comments'),
  searchPanel: $('search-panel'),
  formsPanel: $('forms-panel'),
  newsPanel: $('news-panel'),
  outlinePanel: $('outline-panel'),
  start: $('start'),
  newsCount: $('news-count'),
  status: $('status'),
  pdfInput: $('pdf-input'),
  fontInput: $('font-input'),
  imageInput: $('image-input'),
  combineInput: $('combine-input'),
  imagesPdfInput: $('images-pdf-input'),
  excelPdfInput: $('excel-pdf-input'),
  docxPdfInput: $('docx-pdf-input'),
};

pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

const store = new EditorStore({
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
  mode: 'home', // the ribbon tab on screen
  tool: 'select',
  zoom: 1,
  fit: null,
  current: 0,
  theme: 'system',
  defaults: {}, // per type overrides from the properties bar
  stampLabel: STAMP_LABELS[0],
  gesture: null,
  panel: 'comments',
  search: { query: '', caseSensitive: false, hits: [], index: -1 },
  textCache: new Map(),
  formFields: [],
  outline: null, // pdf.js outline (bookmarks) of the open document
  docInfo: null,
  busy: false,
  showOcr: false,
  // VET VIRAL account: signed-in user and announcements (null user = not signed in or not loaded yet).
  vv: { user: null, announcements: [], loaded: false },
}, { historyLimit: HISTORY_LIMIT });
const state = store.state;

const account = new AccountClient({ storage: safeStorage() });

// Shapes, connectors, formulas, tables and rich text (src/office/). `updateMark` replaces one mark as
// an undo step.
const office = createOfficeUi({
  state,
  commitMark: (draft) => commitMark(draft),
  updateMark(id, next) {
    const before = snap();
    state.marks = state.marks.map((m) => (m.id === id ? sanitizeMark({ ...next, id }) : m));
    pushHistory(before);
    refresh();
  },
});

let renderTimer = null;
let ribbon = null; // created at startup (ribbonbar.js)
let layout = null; // side-panel columns and drawers
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
  if (a.enabled && !a.enabled()) return setStatus(account.signedIn ? 'Bạn đã đăng nhập VET VIRAL.' : 'Bạn chưa đăng nhập VET VIRAL.');
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
  store.record(before);
}

function endEdit(before) {
  if (before && changedSince(before)) pushHistory(before);
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
  const target = store.undo(snap());
  if (!target) return setStatus('Không còn thao tác để hoàn tác.');
  withBusy('Đang hoàn tác…', async () => {
    await restore(target);
    setStatus('Đã hoàn tác.');
  });
}

function redo() {
  if (state.busy) return;
  const target = store.redo(snap());
  if (!target) return setStatus('Không còn thao tác để làm lại.');
  withBusy('Đang làm lại…', async () => {
    await restore(target);
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
  updateQuick();
}

// ---------- ribbon, status bar, panels ----------

// A ribbon/QAT/status-bar command: an ACTIONS id or 'tool:<name>'. Null for an unknown id.
function commandInfo(id) {
  const tool = commandTool(id);
  if (tool) {
    const info = TOOL_INFO[tool];
    return info && { label: info.label, icon: info.icon, toggle: true, on: () => state.tool === tool, enabled: () => true, run: () => setTool(tool) };
  }
  const a = ACTIONS[id];
  if (!a) return null;
  const available = { undo: () => store.canUndo, redo: () => store.canRedo }[id];
  return {
    label: a.label,
    icon: a.icon,
    key: a.key,
    toggle: !!a.checked,
    on: () => !!a.checked?.(),
    enabled: () => !(a.needsDoc && !state.pdfBytes) && !(a.enabled && !a.enabled()) && (available?.() ?? true),
    run: () => runAction(id),
  };
}

function docInfo() {
  if (!state.pdfBytes) return null;
  return { name: state.fileName, meta: `${state.pageSizes.length} trang · ${sizeLabel(state.pdfBytes.length)}` };
}

// Button states follow the document, the history, the tool, the theme and the account.
function updateQuick() {
  ribbon?.refresh();
}

function applyToolClasses() {
  const textTool = state.tool === 'text' || state.tool === 'date';
  state.pageEls.forEach((div) => {
    div.classList.toggle('tool-select', state.tool === 'select');
    div.classList.toggle('tool-text', textTool);
    div.classList.toggle('tool-create', state.tool !== 'select' && state.tool !== 'hand' && !textTool);
  });
}

// Shows a ribbon tab. Changing tabs keeps the current tool, as in an office suite.
function setMode(mode) {
  state.mode = mode;
  ribbon?.selectTab(mode);
  if (mode === 'sign' && state.formFields.length) showPanel('forms');
}

function setTool(tool) {
  const tab = tabForCommand(RIBBON_TABS, toolCommand(tool), state.mode);
  if (tab !== state.mode) {
    state.mode = tab;
    ribbon?.selectTab(tab);
  }
  if (state.gesture) cancelGesture();
  select(null);
  state.tool = tool;
  applyToolClasses();
  updateQuick();
  renderProps();
  store.emit(EVENTS.toolChanged, { mode: state.mode, tool });
}

// The status bar shows "/ 12" next to the page field, and the zoom only while a document is open.
function updateStatusBar() {
  const field = $('page-field');
  const total = state.pageSizes.length;
  if (field) {
    field.value = total ? state.current + 1 : '';
    field.max = Math.max(1, total);
    field.disabled = !total;
  }
  const count = $('pageinfo');
  const zoom = $('zoominfo');
  if (count) count.textContent = `/ ${total}`;
  if (zoom) zoom.textContent = state.doc ? `${Math.round(state.zoom * 100)}%` : '—';
}

// Right-click (or long-press) on a page: the item under the pointer, that page, the view.
function pageContextMenu(e) {
  const pageEl = e.target.closest?.('.page');
  if (!pageEl || !state.doc) return;
  e.preventDefault();
  const page = Number(pageEl.dataset.page);
  const markId = e.target.closest('g.mark')?.dataset.id;
  const boxId = e.target.closest('.tbox')?.dataset.id;
  if (markId) select({ kind: 'mark', id: markId });
  else if (boxId) select({ kind: 'box', id: Number(boxId) });
  const item = (id, extra = {}) => {
    const c = commandInfo(id);
    return c && { label: c.label, icon: c.icon, key: c.key && keyLabel(c.key), disabled: !c.enabled(), run: c.run, ...extra };
  };
  const onPage = (run) => () => {
    setCurrentPage(page);
    run();
  };
  openContextMenu(e.clientX, e.clientY, [
    state.selected && item('delete'),
    state.selected && '-',
    item('rotateLeft', { run: () => store.dispatch('page:rotate', { pages: [page], delta: -90 }) }),
    item('rotateRight', { run: () => store.dispatch('page:rotate', { pages: [page], delta: 90 }) }),
    item('insertBlank', { run: onPage(insertBlankAfter) }),
    item('duplicatePage', { run: onPage(duplicateCurrent) }),
    item('deletePage', { run: () => store.dispatch('page:delete', { pages: [page] }) }),
    '-',
    item('zoomIn'),
    item('zoomOut'),
    item('fitWidth'),
    '-',
    item('find'),
    item('tool:select'),
  ]);
}

// Right-click on a thumbnail: page actions for the selected pages, or for that page alone.
function thumbContextMenu(e) {
  const card = e.target.closest?.('.thumb');
  if (!card || !state.doc) return;
  e.preventDefault();
  const index = Number(card.dataset.page);
  const chosen = els.thumbs.selection ?? [];
  const pages = chosen.includes(index) ? chosen : [index];
  const label = pages.length > 1 ? ` (${pages.length} trang)` : '';
  openContextMenu(e.clientX, e.clientY, [
    { label: `Xoay trái${label}`, icon: 'rotateLeft', run: () => store.dispatch('page:rotate', { pages, delta: -90 }) },
    { label: `Xoay phải${label}`, icon: 'rotateRight', run: () => store.dispatch('page:rotate', { pages, delta: 90 }) },
    pages.length === 1 && { label: 'Chèn trang trắng phía sau', icon: 'pageAdd', run: () => { setCurrentPage(index); insertBlankAfter(); } },
    pages.length === 1 && { label: 'Nhân bản trang', icon: 'pageCopy', run: () => { setCurrentPage(index); duplicateCurrent(); } },
    '-',
    { label: `Xóa trang${label}`, icon: 'trash', run: () => store.dispatch('page:delete', { pages }) },
  ]);
}

// ---------- zoom, navigation, rendering ----------

// `anchor` (from the page view) keeps one point of a page under the same screen point.
let zoomAnchor = null;
function setZoom(z, fit = null, anchor = null) {
  state.zoom = clamp(z, 0.25, 4);
  state.fit = fit;
  zoomAnchor = anchor;
  updateStatusBar();
  store.emit(EVENTS.zoomChanged, { zoom: state.zoom });
  if (state.doc) scheduleRender();
}

function zoomBy(dir) {
  const z = state.zoom;
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 1e-6) : [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6);
  if (next) setZoom(next, null, els.view.centerAnchor());
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
  updateStatusBar();
  store.emit(EVENTS.pageChanged, { index: i, count: state.pageSizes.length });
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

// Lays out every page at the current zoom; the page view paints the canvases lazily. When only
// the zoom changed, the old pictures stay in place (stretched) until the new ones are painted.
let renderedDoc = null;
function renderDocument() {
  if (!state.doc) return;
  const doc = state.doc;
  const keep = state.current;
  const old = renderedDoc === doc ? state.pageEls.map((div) => div?.querySelector('canvas')) : [];
  renderedDoc = doc;
  els.view.replaceChildren();
  state.pageEls = [];
  for (let i = 0; i < doc.numPages; i++) {
    const size = state.pageSizes[i];
    const div = el('div', { class: 'page', 'data-page': i, style: `width:${size.width * state.zoom}px;height:${size.height * state.zoom}px` }, old[i] ?? null);
    div.addEventListener('pointerdown', (e) => onPagePointerDown(e, i));
    els.view.append(div);
    state.pageEls[i] = div;
  }
  renderOverlays();
  els.view.paintPages(doc, state.pageEls, state.zoom);
  if (zoomAnchor) {
    els.view.restoreAnchor(zoomAnchor);
    zoomAnchor = null;
    navTarget = null;
    updatePageFromScroll();
  } else {
    scrollToPage(keep, false);
  }
}

// ---------- overlays ----------

function renderOverlays() {
  state.marks = office.reroute(state.marks); // connectors follow the shapes they are glued to
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
  const ctx = hf && headerFooterContext(hf, i, state.pageSizes.length, { file: state.fileName, date: todayLabel() });
  if (ctx) {
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
  if (OFFICE_TYPES.has(m.type)) office.drawMark(g, m);
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
    const rect = { x: current.x, y: current.y, w: node.offsetWidth / state.zoom, h: node.offsetHeight / state.zoom };
    drag = { id: box.id, page: current.page, el: node, rect, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, ox: current.x, oy: current.y, x: current.x, y: current.y, moved: false };
    capturePointer(grip, e.pointerId);
    cancelDrag = () => {
      node.style.left = `${current.x * state.zoom}px`;
      node.style.top = `${current.y * state.zoom}px`;
      els.view.clearGuides();
      drag = null;
      dragSnap = null;
      cancelDrag = null;
    };
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = (e.clientX - drag.startX) / state.zoom;
    const dy = (e.clientY - drag.startY) / state.zoom;
    drag.moved = drag.moved || Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
    if (!drag.moved) return;
    const snapped = snapMove(drag.page, drag.rect, dx, dy, drag.id, e);
    drag.x = drag.ox + snapped.dx;
    drag.y = drag.oy + snapped.dy;
    drag.el.style.left = `${drag.x * state.zoom}px`;
    drag.el.style.top = `${drag.y * state.zoom}px`;
  });
  const endDrag = (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.moved) state.boxes = updateBox(state.boxes, drag.id, { x: drag.x, y: drag.y });
    endEdit(drag.moved ? dragSnap : null);
    els.view.clearGuides();
    drag = null;
    dragSnap = null;
    cancelDrag = null;
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
  store.emit(EVENTS.selectionChanged, { selected: sel });
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
  if (OFFICE_DRAG_TOOLS.has(g.tool)) return office.draft(g);
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
  if (g.tool === 'connector') office.glueHints(svg, g.page);
}

function commitMark(draft) {
  const before = snap();
  const style = styleFor(draft.type);
  const fill = draft.type === 'rect' || draft.type === 'oval' || draft.type === 'shape' ? style.fill : null;
  const id = nextMarkId(state.marks);
  state.marks = addMark(state.marks, { ...style, text: '', ...draft, fill, id });
  pushHistory(before);
  state.selected = { kind: 'mark', id };
  refresh();
  if (draft.type === 'link') openLinkDialog(id);
  office.afterCommit(id, draft.type);
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

// ---------- smart snapping ----------

const SNAP_PX = 6; // screen pixels within which a dragged item snaps to a guide

// Size of a text box in page points, measured from its element; null when it is not shown.
function boxRect(box) {
  const node = document.querySelector(`.tbox[data-id="${box.id}"]`);
  return node ? { x: box.x, y: box.y, w: node.offsetWidth / state.zoom, h: node.offsetHeight / state.zoom } : null;
}

// Guide lines for an item dragged on `page`: the page edges and centre, the edges and centre of
// the other items, and of the page's text block (its margins). Text is read in the background the
// first time, so the margins join a drag a moment after it starts.
function snapLinesFor(page, skipId) {
  const rects = [
    ...state.marks.filter((m) => m.page === page && m.id !== skipId).map(markBounds),
    ...state.boxes.filter((b) => b.page === page && b.id !== skipId).map(boxRect).filter(Boolean),
  ];
  if (!state.textCache.has(page) && state.doc) pdfTextItems(page).catch(() => {});
  const text = boundingBox([
    ...(state.textCache.get(page) ?? []).filter((t) => t.str.trim()),
    ...state.settings.ocrWords.filter((w) => w.page === page),
  ].map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h })));
  if (text) rects.push(text);
  return snapLines(state.pageSizes[page], rects);
}

// Snaps `rect` moved by (dx, dy) and shows the guides; Ctrl/⌘ held turns snapping off.
function snapMove(page, rect, dx, dy, skipId, ev) {
  if (ev.ctrlKey || ev.metaKey) {
    els.view.clearGuides();
    return { dx, dy };
  }
  const s = snapRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, snapLinesFor(page, skipId), SNAP_PX / state.zoom);
  els.view.showGuides(state.pageEls[page], state.pageSizes[page], s.guides);
  return { dx: dx + s.dx, dy: dy + s.dy };
}

// The item drag in progress, cancelled when a pinch or a pan takes over the pointer.
let cancelDrag = null;

function beginMarkMove(e, id) {
  const m = findMark(id);
  if (!m || e.button !== 0) return;
  select({ kind: 'mark', id });
  const g = pageSvg(m.page)?.querySelector(`g.mark[data-id="${id}"]`);
  const bounds = markBounds(m);
  const move = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false, before: snap() };
  const onMove = (ev) => {
    if (ev.pointerId !== move.pointerId) return;
    const rect = state.pageEls[m.page].getBoundingClientRect();
    const size = state.pageSizes[m.page];
    const dx = (ev.clientX - move.startX) * (size.width / rect.width);
    const dy = (ev.clientY - move.startY) * (size.height / rect.height);
    move.moved = move.moved || Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
    if (!move.moved) return;
    ({ dx: move.dx, dy: move.dy } = snapMove(m.page, bounds, dx, dy, id, ev));
    g?.setAttribute('transform', `translate(${move.dx} ${move.dy})`);
  };
  const stop = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    g?.removeAttribute('transform');
    els.view.clearGuides();
    cancelDrag = null;
  };
  const onUp = (ev) => {
    if (ev.pointerId !== move.pointerId) return;
    stop();
    if (move.moved) {
      state.marks = state.marks.map((mk) => (mk.id === id ? moveMark(mk, move.dx, move.dy) : mk));
      pushHistory(move.before);
      refresh();
    }
  };
  cancelDrag = stop;
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
    const w = m0.w + (ev.clientX - start.x) * k;
    const h = m0.h + (ev.clientY - start.y) * k;
    const next = OFFICE_TYPES.has(m0.type) ? sanitizeMark(resizeOffice(m0, w, h, officeMeasure)) : resizeMark(m0, w, h, { keepAspect });
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
  row.push(...office.props(type, item, { setTool }));
  if (type === 'rect' || type === 'oval' || type === 'shape') {
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
  layout?.show('right');
  renderPanel();
}

function renderPanel() {
  els.panelTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.panel === state.panel));
  els.comments.classList.toggle('hidden', state.panel !== 'comments');
  els.searchPanel.classList.toggle('hidden', state.panel !== 'search');
  els.formsPanel.classList.toggle('hidden', state.panel !== 'forms');
  els.newsPanel.classList.toggle('hidden', state.panel !== 'news');
  els.outlinePanel.classList.toggle('hidden', state.panel !== 'outline');
  if (state.panel === 'comments') renderComments();
  if (state.panel === 'search') renderSearchResults();
  if (state.panel === 'forms') renderForms();
  if (state.panel === 'news') renderNews();
  if (state.panel === 'outline') renderOutline();
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
  const appOpts = loadAppOptions();
  const settings = { ...state.settings, options: appOpts, ...overrides };
  const rasterScale = (appOpts.redactionDpi || 300) / 72;
  const raster = await rasterizeRedactions(state.doc, state.marks, rasterScale);
  return exportPdf(state.pdfBytes.slice(), state.boxes, {
    fontBytes: await fontFor(exportTexts(state.boxes, state.marks, settings)),
    marks: state.marks,
    settings,
    rasterPages: raster,
    context: settingsContext(),
    officeFonts: await officeFontBytes(state.marks),
  });
}

// Writes the items of one page into the PDF bytes (used before rotating that page).
async function bakePage(indices) {
  const pages = new Set(indices);
  const boxes = state.boxes.filter((b) => pages.has(b.page));
  const marks = state.marks.filter((m) => pages.has(m.page));
  if (!boxes.length && !marks.length) return state.pdfBytes;
  const raster = await rasterizeRedactions(state.doc, marks);
  return exportPdf(state.pdfBytes.slice(), boxes, { fontBytes: await fontFor(exportTexts(boxes, marks)), marks, rasterPages: raster, officeFonts: await officeFontBytes(marks) });
}

// Replaces the document bytes as one undo step. `remap` re-indexes everything tied to a page
// (text boxes, marks, OCR words) to follow inserted, deleted or moved pages; `order` and
// `changed` describe the new pages for the thumbnails (see loadDocument).
async function applyBytes(bytes, before, { remap, current, order, changed } = {}) {
  pushHistory(before);
  state.pdfBytes = bytes;
  if (remap) {
    state.boxes = remap(state.boxes);
    state.marks = remap(state.marks);
    state.settings = { ...state.settings, ocrWords: remap(state.settings.ocrWords) };
  }
  // Edited bookmarks follow their pages; the file's own outline follows them by itself.
  if (order && state.settings.bookmarks) state.settings = { ...state.settings, bookmarks: remapBookmarks(state.settings.bookmarks, order) };
  if (current !== undefined) state.current = current;
  state.selected = null;
  await loadDocument(bytes, { order, changed });
}

// Pages the page commands act on: the pages selected in the thumbnails (the current page by default).
function selectedPages() {
  const pages = els.thumbs.selection ?? [];
  return pages.length ? pages : [state.current];
}

const pageList = (pages) => (pages.length === 1 ? `trang ${pages[0] + 1}` : `${pages.length} trang (${formatPageRange(pages)})`);
const keptOrder = (count) => Array.from({ length: count }, (_, i) => i);

function rotateCurrent(delta) {
  return rotateDocPages(selectedPages(), delta);
}

function rotateDocPages(pages, delta) {
  return withBusy('Đang xoay trang…', async () => {
    const turned = new Set(pages);
    const before = snap();
    const baked = state.boxes.some((b) => turned.has(b.page)) || state.marks.some((m) => turned.has(m.page));
    const hadOcr = state.settings.ocrWords.some((w) => turned.has(w.page));
    const bytes = await rotatePages(await bakePage(pages), pages, delta);
    // Items on the pages were written into the PDF; OCR boxes no longer match the turned pages.
    await applyBytes(bytes, before, { remap: (items) => items.filter((it) => !turned.has(it.page)), order: keptOrder(state.pageSizes.length), changed: pages });
    setStatus(`Đã xoay ${pageList(pages)}.${baked ? ' Các mục trên trang đã được gộp vào PDF trước khi xoay.' : ''}${hadOcr ? ' Hãy chạy lại OCR cho các trang này.' : ''}`);
  });
}

// Puts the pages in `order` (the old index of the page at each new position) as one undo step.
function reorderDocPages(order, message) {
  if (isIdentityOrder(order)) return;
  return withBusy('Đang sắp xếp trang…', async () => {
    const before = snap();
    const bytes = await reorderPages(state.pdfBytes, order);
    await applyBytes(bytes, before, { remap: (items) => remapOrder(items, order), current: order.indexOf(state.current), order });
    setStatus(message ?? 'Đã sắp xếp lại trang. Nhấn Ctrl+Z để hoàn tác.');
  });
}

// Moves the selected pages one place earlier (-1) or later (+1).
function moveCurrent(dir) {
  const pages = selectedPages();
  const first = pages[0];
  const last = pages[pages.length - 1];
  if (dir < 0 && first === 0) return setStatus('Đây đã là trang đầu.');
  if (dir > 0 && last === state.pageSizes.length - 1) return setStatus('Đây đã là trang cuối.');
  const order = moveSelectionOrder(state.pageSizes.length, pages, dir < 0 ? first - 1 : last + 2);
  return reorderDocPages(order, `Đã chuyển ${pageList(pages)} ${dir < 0 ? 'lên trước' : 'ra sau'}.`);
}

function insertBlankAfter() {
  return withBusy('Đang chèn trang…', async () => {
    const i = state.current;
    const at = i + 1;
    const size = state.pageSizes[i];
    const before = snap();
    const bytes = await insertBlankPage(state.pdfBytes, at, [size.width, size.height]);
    const order = keptOrder(state.pageSizes.length);
    order.splice(at, 0, -1);
    await applyBytes(bytes, before, { remap: (items) => remapInserted(items, at), current: at, order });
    setStatus(`Đã chèn trang trắng ở vị trí ${at + 1}.`);
  });
}

function duplicateCurrent() {
  return withBusy('Đang nhân bản trang…', async () => {
    const i = state.current;
    const before = snap();
    const bytes = await duplicatePage(state.pdfBytes, i);
    const order = keptOrder(state.pageSizes.length);
    order.splice(i + 1, 0, -1);
    await applyBytes(bytes, before, { remap: (items) => remapInserted(items, i + 1), current: i + 1, order });
    setStatus(`Đã nhân bản trang ${i + 1}.`);
  });
}

function deleteCurrentPage() {
  return deleteDocPages(selectedPages());
}

function deleteDocPages(pages) {
  const count = state.pageSizes.length;
  if (pages.length >= count) return setStatus(count === 1 ? 'Không thể xóa trang duy nhất của tài liệu.' : 'Không thể xóa mọi trang của tài liệu.', true);
  return withBusy('Đang xóa trang…', async () => {
    const gone = new Set(pages);
    const order = keptOrder(count).filter((i) => !gone.has(i));
    const before = snap();
    const bytes = await deletePages(state.pdfBytes, pages);
    // The view stays on the first page left at or after the current one.
    const next = order.findIndex((old) => old >= state.current);
    await applyBytes(bytes, before, { remap: (items) => remapOrder(items, order), current: next < 0 ? order.length - 1 : next, order });
    setStatus(`Đã xóa ${pageList(pages)}. Nhấn Ctrl+Z để hoàn tác.`);
  });
}

function openExtractDialog() {
  const input = el('input', { type: 'text', value: formatPageRange(selectedPages()), placeholder: 'Ví dụ 1-3, 5', autofocus: true });
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
  if (!state.pdfBytes || !store.canUndo) return true;
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

// Opens the advanced print suite with live interactive preview, N-up layout,
// paper dimensions, grayscale eco mode, watermarks, and direct browser printing.
function printDocument() {
  openPrintDialog({
    state,
    buildOutput,
    renderOutputPage,
    onStatus: (msg) => setStatus(msg),
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
function exportContent(format, pageRange = '') {
  return withBusy('Đang trích xuất nội dung…', async () => {
    const doc = await pdfjsLib.getDocument({ data: await buildOutput({ watermark: null, headerFooter: null }) }).promise;
    const pages = [];
    let numbers;
    try {
      numbers = parseUserPageRange(pageRange, doc.numPages);
      for (const [k, n] of numbers.entries()) {
        setStatus(`Đang đọc chữ trang ${n} (${k + 1}/${numbers.length})…`);
        pages.push(groupLines(await textItemsOf(await doc.getPage(n))));
      }
    } finally {
      doc.destroy();
    }
    if (!pages.some((lines) => lines.length)) {
      return setStatus('Tài liệu không có chữ để xuất. Nếu là bản quét, hãy chạy Nhận dạng chữ (OCR) trước.', true);
    }
    const base = baseName(state.fileName);
    const title = state.settings.meta?.title || state.docInfo?.Title || base;
    if (format === 'txt') download(new Blob(['﻿', pagesToText(pages, numbers)], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
    else if (format === 'html') download(new Blob([pagesToHtml(title, pages, numbers)], { type: 'text/html;charset=utf-8' }), `${base}.html`);
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

async function exportExcelCurrent({ separateSheets = true, pageRange = '' } = {}) {
  if (!state.doc) return setStatus('Hãy mở một tệp PDF trước.', true);
  return withBusy('Đang xuất bảng tính Excel…', async () => {
    const doc = await pdfjsLib.getDocument({ data: await buildOutput({ watermark: null, headerFooter: null }) }).promise;
    const pagesData = [];
    try {
      const pageNumbers = parseUserPageRange(pageRange, doc.numPages);
      for (let i = 0; i < pageNumbers.length; i++) {
        const pageNum = pageNumbers[i];
        setStatus(`Đang đọc bảng trang ${pageNum} (${i + 1}/${pageNumbers.length})…`);
        const page = await doc.getPage(pageNum);
        const items = await textItemsOf(page);
        pagesData.push(items);
      }
    } finally {
      doc.destroy();
    }
    const base = baseName(state.fileName);
    const blob = await exportToExcel(pagesData, { separateSheets, title: base });
    download(blob, `${base}.xlsx`);
    setStatus(`Đã xuất ${base}.xlsx (${pagesData.length} trang) thành công.`);
  });
}

function openExportImagesDialog() {
  if (!state.doc) return setStatus('Hãy mở một tệp PDF trước.', true);
  const total = state.pageSizes.length;
  const rangeInput = el('input', { type: 'text', value: `1-${total}`, placeholder: `Ví dụ 1-${total}` });
  const dpiSelect = el('select', {},
    el('option', { value: '72' }, '72 DPI (Màn hình nhẹ)'),
    el('option', { value: '150', selected: true }, '150 DPI (Tiêu chuẩn tài liệu)'),
    el('option', { value: '300' }, '300 DPI (In ấn chất lượng cao)'),
  );
  const fmtSelect = el('select', {},
    el('option', { value: 'png' }, 'PNG (Độ nét cao, không nén)'),
    el('option', { value: 'jpg' }, 'JPG (Dung lượng nhẹ)'),
  );
  const qualityRange = el('input', { type: 'range', min: '50', max: '100', value: '90' });
  const qualityVal = el('output', { text: '90%' });
  qualityRange.oninput = () => { qualityVal.textContent = `${qualityRange.value}%`; };
  const qualityRow = el('div', { class: 'form-field inline hidden' }, qualityVal, qualityRange, el('span', { class: 'lbl' }, 'Chất lượng JPG:'));

  fmtSelect.onchange = () => {
    qualityRow.classList.toggle('hidden', fmtSelect.value !== 'jpg');
  };

  const error = el('p', { class: 'dlg-error' });

  openDialog({
    title: 'Xuất ảnh các trang chất lượng cao',
    width: 440,
    body: el('div', {},
      field(`Dải trang cần xuất (1-${total})`, rangeInput, 'Để trống hoặc ghi 1-3, 5 để xuất các trang tùy chọn.'),
      field('Độ phân giải (DPI)', dpiSelect, 'DPI càng cao thì ảnh càng sắc nét.'),
      field('Định dạng ảnh', fmtSelect),
      qualityRow,
      error,
    ),
    actions: [
      { label: 'Hủy' },
      {
        label: 'Bắt đầu xuất ảnh',
        primary: true,
        run: async () => {
          try {
            await exportImagesWithSettings({
              format: fmtSelect.value,
              dpi: Number(dpiSelect.value),
              quality: Number(qualityRange.value) / 100,
              pageRange: rangeInput.value,
            });
          } catch (err) {
            error.textContent = err.message;
            return false;
          }
        },
      },
    ],
  });
}

async function exportImagesWithSettings({ format = 'png', dpi = 150, quality = 0.9, pageRange = '' } = {}) {
  return withBusy('Đang kết xuất ảnh…', async () => {
    const doc = await pdfjsLib.getDocument({ data: await buildOutput() }).promise;
    try {
      const pageNumbers = parseUserPageRange(pageRange, doc.numPages);
      const base = baseName(state.fileName);
      const result = await exportPagesToImages(doc, {
        format,
        dpi,
        quality,
        pageNumbers,
        baseFileName: base,
        onProgress: (cur, total, pageNum) => {
          setStatus(`Đang kết xuất ảnh trang ${pageNum} (${cur}/${total})…`);
        },
      });
      download(result.blob, result.fileName);
      setStatus(`Đã xuất ${result.fileName} thành công.`);
    } finally {
      doc.destroy();
    }
  });
}

async function convertExcelFileToPdf(file) {
  return withBusy('Đang chuyển đổi Excel sang PDF…', async () => {
    const buf = await file.arrayBuffer();
    fontError = null;
    const pdfBytes = await excelToPdf(buf, { title: file.name.replace(/\.[^.]+$/, ''), loadFont: fontFor });
    await openBytes(pdfBytes, file.name.replace(/\.[^.]+$/, '.pdf'));
    if (fontError) setStatus(`Đã tạo PDF từ bảng tính ${file.name}, nhưng chữ đã bỏ dấu: ${fontError}`, true);
    else setStatus(`Đã tạo PDF thành công từ bảng tính ${file.name}.`);
  });
}

async function convertDocxFileToPdf(file) {
  return withBusy('Đang chuyển đổi Word sang PDF…', async () => {
    const buf = await file.arrayBuffer();
    fontError = null;
    const pdfBytes = await docxToPdf(buf, { title: file.name.replace(/\.[^.]+$/, ''), loadFont: fontFor });
    await openBytes(pdfBytes, file.name.replace(/\.[^.]+$/, '.pdf'));
    if (fontError) setStatus(`Đã tạo PDF từ tài liệu Word ${file.name}, nhưng chữ đã bỏ dấu: ${fontError}`, true);
    else setStatus(`Đã tạo PDF thành công từ tài liệu Word ${file.name}.`);
  });
}

function openConversionHub() {
  let activeTab = 'export';
  let selectedExportFormat = 'xlsx';

  const tabExport = el('button', { class: 'hub-tab on', type: 'button' }, 'Xuất PDF sang định dạng khác');
  const tabImport = el('button', { class: 'hub-tab', type: 'button' }, 'Tạo PDF từ tệp khác');
  const tabsBar = el('div', { class: 'hub-tabs' }, tabExport, tabImport);

  const formatCards = [
    { id: 'xlsx', badge: 'XLSX', title: 'Excel Bảng tính', desc: 'Tự động nhận diện cột, hàng & số' },
    { id: 'docx', badge: 'DOCX', title: 'Word Văn bản', desc: 'Giữ cấu trúc đoạn & tiêu đề' },
    { id: 'images', badge: 'IMG', title: 'Ảnh (PNG/JPG)', desc: 'Tùy chọn DPI 72 / 150 / 300' },
    { id: 'txt', badge: 'TXT', title: 'Văn bản thuần', desc: 'Trích xuất chữ UTF-8 / HTML' },
  ];

  const cardEls = {};
  const gridEl = el('div', { class: 'format-grid' });

  formatCards.forEach((c) => {
    const card = el('div', { class: `format-card ${c.id === selectedExportFormat ? 'on' : ''}` },
      el('span', { class: 'f-badge' }, c.badge),
      el('span', { class: 'f-title' }, c.title),
      el('span', { class: 'f-desc' }, c.desc),
    );
    card.onclick = () => {
      selectedExportFormat = c.id;
      Object.values(cardEls).forEach((cardNode) => cardNode.classList.remove('on'));
      card.classList.add('on');
      renderExportOptions();
    };
    cardEls[c.id] = card;
    gridEl.append(card);
  });

  const exportOptsContainer = el('div', { class: 'conv-box' });
  const total = state.pageSizes.length || 1;
  const pageRangeInput = el('input', { type: 'text', value: state.pageSizes.length ? `1-${state.pageSizes.length}` : '1', placeholder: 'Ví dụ 1-3, 5' });
  const sheetSepCheckbox = el('input', { type: 'checkbox', checked: true });
  const dpiSelect = el('select', {},
    el('option', { value: '72' }, '72 DPI (Màn hình nhẹ)'),
    el('option', { value: '150', selected: true }, '150 DPI (Tiêu chuẩn)'),
    el('option', { value: '300' }, '300 DPI (In ấn chất lượng cao)'),
  );
  const imgFormatSelect = el('select', {},
    el('option', { value: 'png' }, 'PNG (Chất lượng gốc)'),
    el('option', { value: 'jpg' }, 'JPG (Dung lượng nhẹ)'),
  );
  const textFormatSelect = el('select', {},
    el('option', { value: 'txt' }, 'Văn bản thuần (.txt)'),
    el('option', { value: 'html' }, 'Trang web (.html)'),
  );

  function renderExportOptions() {
    exportOptsContainer.innerHTML = '';
    if (selectedExportFormat === 'xlsx') {
      exportOptsContainer.append(
        field('Dải trang trích xuất bảng', pageRangeInput, 'Để trống hoặc nhập khoảng trang cần xuất.'),
        el('label', { class: 'lbl small' }, sheetSepCheckbox, 'Tách mỗi trang PDF thành một trang tính (Sheet) riêng'),
      );
    } else if (selectedExportFormat === 'docx') {
      exportOptsContainer.append(
        field('Dải trang cần xuất Word', pageRangeInput),
        el('p', { class: 'dlg-hint' }, 'Hệ thống sẽ giữ lại cấu trúc tiêu đề, phân đoạn và dòng chữ.'),
      );
    } else if (selectedExportFormat === 'images') {
      exportOptsContainer.append(
        field('Dải trang kết xuất ảnh', pageRangeInput),
        field('Độ phân giải ảnh (DPI)', dpiSelect),
        field('Định dạng ảnh', imgFormatSelect, 'Nếu xuất nhiều hơn 1 trang, tệp ZIP sẽ được tự động đóng gói.'),
      );
    } else if (selectedExportFormat === 'txt') {
      exportOptsContainer.append(
        field('Định dạng văn bản', textFormatSelect),
        el('p', { class: 'dlg-hint' }, 'Bảo toàn tiếng Việt có dấu chuẩn Unicode UTF-8.'),
      );
    }
  }
  renderExportOptions();

  const exportView = el('div', {},
    el('p', { class: 'dlg-label', style: 'margin-bottom:6px' }, '1. Chọn định dạng đích:'),
    gridEl,
    el('p', { class: 'dlg-label', style: 'margin-bottom:6px' }, '2. Tùy chọn chuyển đổi:'),
    exportOptsContainer,
  );

  // --- TAB 2: IMPORT VIEW ---
  let selectedFiles = [];
  const fileListEl = el('div', { style: 'margin-top:10px' });
  const pageSizeSelect = el('select', {},
    el('option', { value: 'a4' }, 'Khổ A4 (210 x 297 mm)'),
    el('option', { value: 'fit' }, 'Khớp kích thước ảnh gốc'),
    el('option', { value: 'letter' }, 'Khổ Letter'),
  );
  const orientSelect = el('select', {},
    el('option', { value: 'auto' }, 'Tự động theo ảnh/bảng'),
    el('option', { value: 'portrait' }, 'Hướng dọc (Portrait)'),
    el('option', { value: 'landscape' }, 'Hướng ngang (Landscape)'),
  );
  const marginSelect = el('select', {},
    el('option', { value: '0' }, 'Không lề (0 pt)'),
    el('option', { value: '20', selected: true }, 'Lề chuẩn (20 pt)'),
    el('option', { value: '36' }, 'Lề rộng (36 pt)'),
  );

  const dropzoneEl = el('div', { class: 'dropzone' },
    el('strong', { text: 'Kéo và thả tệp Word (.docx), Excel (.xlsx/.csv) hoặc Ảnh vào đây' }),
    el('p', { class: 'dlg-hint', text: 'hoặc nhấn để chọn tệp từ máy tính' }),
  );
  const filePickerInput = el('input', { type: 'file', accept: '.docx,.xlsx,.xls,.csv,image/*', multiple: true, hidden: true });

  dropzoneEl.onclick = () => filePickerInput.click();
  dropzoneEl.ondragover = (e) => { e.preventDefault(); dropzoneEl.classList.add('dragover'); };
  dropzoneEl.ondragleave = () => dropzoneEl.classList.remove('dragover');
  dropzoneEl.ondrop = (e) => {
    e.preventDefault();
    e.stopPropagation(); // not the window drop that opens a PDF
    dropzoneEl.classList.remove('dragover');
    if (e.dataTransfer.files?.length) {
      handleFilesSelected(Array.from(e.dataTransfer.files));
    }
  };
  filePickerInput.onchange = () => {
    if (filePickerInput.files?.length) {
      handleFilesSelected(Array.from(filePickerInput.files));
    }
  };

  function renderFileList() {
    fileListEl.innerHTML = '';
    if (!selectedFiles.length) return;
    selectedFiles.forEach((file, idx) => {
      const row = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:var(--hover);border-radius:4px;margin-bottom:4px;' },
        el('span', { text: `${idx + 1}. ${file.name} (${sizeLabel(file.size)})` }),
        el('button', {
          type: 'button',
          style: 'color:var(--danger);padding:2px 6px;',
          onclick: () => {
            selectedFiles.splice(idx, 1);
            renderFileList();
          },
        }, 'Xóa'),
      );
      fileListEl.append(row);
    });
  }

  function handleFilesSelected(files) {
    selectedFiles = [...selectedFiles, ...files];
    renderFileList();
  }

  const importView = el('div', { class: 'hidden' },
    dropzoneEl,
    filePickerInput,
    fileListEl,
    el('div', { class: 'conv-box', style: 'margin-top:12px' },
      field('Khổ giấy trang PDF tạo ra', pageSizeSelect),
      field('Hướng giấy', orientSelect),
      field('Căn lề trang', marginSelect),
    ),
  );

  const hubError = el('p', { class: 'dlg-error' });
  const mainContainer = el('div', {}, tabsBar, exportView, importView, hubError);

  tabExport.onclick = () => {
    activeTab = 'export';
    tabExport.classList.add('on');
    tabImport.classList.remove('on');
    exportView.classList.remove('hidden');
    importView.classList.add('hidden');
  };
  tabImport.onclick = () => {
    activeTab = 'import';
    tabImport.classList.add('on');
    tabExport.classList.remove('on');
    exportView.classList.add('hidden');
    importView.classList.remove('hidden');
  };

  openDialog({
    title: 'Trung tâm Chuyển đổi Tài liệu',
    width: 580,
    body: mainContainer,
    actions: [
      { label: 'Đóng' },
      {
        label: 'Thực hiện chuyển đổi',
        primary: true,
        run: async () => {
          if (activeTab === 'export') {
            if (!state.doc) {
              hubError.textContent = 'Hãy mở một tệp PDF trước khi xuất.';
              return false;
            }
            if (selectedExportFormat === 'xlsx') {
              await exportExcelCurrent({ separateSheets: sheetSepCheckbox.checked, pageRange: pageRangeInput.value });
            } else if (selectedExportFormat === 'docx') {
              await exportContent('docx', pageRangeInput.value);
            } else if (selectedExportFormat === 'images') {
              await exportImagesWithSettings({
                format: imgFormatSelect.value,
                dpi: Number(dpiSelect.value),
                pageRange: pageRangeInput.value,
              });
            } else if (selectedExportFormat === 'txt') {
              await exportContent(textFormatSelect.value);
            }
          } else {
            if (!selectedFiles.length) {
              hubError.textContent = 'Hãy chọn hoặc kéo thả ít nhất 1 tệp tin.';
              return false;
            }
            if (!(await confirmReplace())) return false;

            const firstFile = selectedFiles[0];
            const ext = firstFile.name.split('.').pop().toLowerCase();

            if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
              await convertExcelFileToPdf(firstFile);
            } else if (ext === 'docx') {
              await convertDocxFileToPdf(firstFile);
            } else {
              const images = [];
              for (const f of selectedFiles) {
                const { src } = await toEmbeddableImage(f);
                images.push({ bytes: dataUrlToBytes(src), type: src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg' });
              }
              const pdfBytes = await imagesToPdfAdvanced(images, {
                pageSize: pageSizeSelect.value,
                orientation: orientSelect.value,
                margin: Number(marginSelect.value),
              });
              await openBytes(pdfBytes, 'anh-chuyen-doi.pdf');
              setStatus(`Đã tạo PDF từ ${images.length} ảnh.`);
            }
          }
        },
      },
    ],
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
  const show = el('input', { type: 'checkbox', onchange: (e) => [user, again, owner].forEach((i) => (i.type = e.target.checked ? 'text' : 'password')) });
  openDialog({
    title: 'Đặt mật khẩu',
    subtitle: 'Mã hóa AES-256 ngay trong trình duyệt',
    icon: 'lock',
    body: el('div', {},
      el('p', { class: 'dlg-hint' }, 'Mật khẩu chỉ giữ trong phiên làm việc này và không gửi đi đâu. Bảo vệ được áp dụng khi xuất PDF.'),
      field('Mật khẩu mở tệp', user, 'Để trống nếu chỉ muốn hạn chế quyền.'),
      field('Nhập lại', again),
      field('Mật khẩu chủ sở hữu (đổi quyền)', owner),
      el('label', { class: 'lbl small' }, show, 'Hiện mật khẩu'),
      el('fieldset', { class: 'dlg-group' }, el('legend', {}, 'Quyền của người mở tệp'), printRow, copyRow, modifyRow),
      error,
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

// ---------- VET VIRAL account ----------

function openExternal(url) {
  window.open(url, '_blank', 'noopener');
}

function initials(user) {
  const source = (user?.name || user?.email || '?').trim();
  return source.split(/\s+/).slice(-1)[0].charAt(0).toUpperCase();
}

// Menu-bar area: bell with unread count, then the account button (or a sign-in button).
function renderAccountArea() {
  if (!els.accountArea) return;
  const { user, announcements } = state.vv;
  const unread = unreadCount(announcements);
  els.newsCount.textContent = unread ? `${unread}` : '';
  const bell = el('button', { class: 'icon bell', title: unread ? `Thông báo VET VIRAL (${unread} chưa đọc)` : 'Thông báo VET VIRAL', 'aria-label': 'Thông báo VET VIRAL', onclick: () => showPanel('news') },
    icon('bell', 16),
    unread ? el('span', { class: 'count' }, unread > 9 ? '9+' : `${unread}`) : null,
  );
  const wrap = el('div', { class: 'menu' });
  if (account.signedIn) {
    const avatarUrl = resolveVetviralUrl(user?.avatar);
    const avatar = avatarUrl ? el('img', { class: 'avatar', src: avatarUrl, alt: '' }) : el('span', { class: 'avatar' }, initials(user));
    wrap.append(el('button', { class: 'account-btn', title: 'Tài khoản VET VIRAL', onclick: (e) => { e.stopPropagation(); openAccountMenu(wrap); } }, avatar, el('span', { class: 'label' }, user?.name || user?.email || 'VET VIRAL')));
  } else {
    wrap.append(el('button', { class: 'account-btn', title: 'Đăng nhập bằng tài khoản VET VIRAL', onclick: () => runAction('login') }, el('span', { class: 'avatar' }, icon('user', 12)), el('span', { class: 'label' }, 'Đăng nhập')));
  }
  els.accountArea.replaceChildren(bell, wrap);
  updateQuick();
}

function openAccountMenu(wrap) {
  const had = wrap.querySelector('.dropdown');
  closeContextMenus();
  if (had) return;
  const { user } = state.vv;
  const item = (iconName, label, run) => el('button', { role: 'menuitem', onclick: () => { closeContextMenus(); run(); } }, el('span', { class: 'dd-check' }), icon(iconName, 16), el('span', { class: 'grow' }, label));
  wrap.append(el('div', { class: 'dropdown right', role: 'menu', onclick: (e) => e.stopPropagation() },
    el('div', { class: 'acct-head' },
      el('div', { class: 'name' }, user?.name || 'Tài khoản VET VIRAL'),
      user ? el('div', { class: 'acct-sub' }, user.email) : null,
      user ? el('div', { class: 'acct-sub' }, `Gói: ${planLabel(user)} · ${Number(user.credits ?? 0).toLocaleString('vi-VN')} điểm`) : null,
    ),
    item('external', 'Quản lý tài khoản trên vetviral.com', () => runAction('manageAccount')),
    item('bell', 'Thông báo', () => runAction('news')),
    el('div', { class: 'dd-sep' }),
    item('logout', 'Đăng xuất', () => runAction('logout')),
  ));
}

function renderNews() {
  const panel = els.newsPanel;
  panel.replaceChildren();
  if (!account.signedIn) {
    panel.append(
      el('p', { class: 'lbl empty-note' }, 'Đăng nhập bằng tài khoản VET VIRAL để nhận thông báo tính năng mới và khuyến mãi. PDF Editor chỉ đọc tên, gói và thông báo; tài liệu của bạn không được gửi đi.'),
      el('button', { class: 'primary', onclick: () => runAction('login') }, icon('user', 16), 'Đăng nhập VET VIRAL'),
    );
    return;
  }
  const { announcements, loaded } = state.vv;
  const unread = unreadCount(announcements);
  panel.append(el('div', { class: 'news-head' },
    el('span', { class: 'lbl' }, unread ? `${unread} tin chưa đọc` : 'Đã đọc hết'),
    el('span', {},
      iconButton('refresh', 'Tải lại thông báo', () => refreshAccount()),
      unread ? el('button', { onclick: markAllNewsRead }, 'Đọc hết') : null,
    ),
  ));
  if (!loaded) {
    panel.append(el('p', { class: 'lbl empty-note' }, 'Đang tải thông báo…'));
    return;
  }
  if (!announcements.length) {
    panel.append(el('p', { class: 'lbl empty-note' }, 'Chưa có thông báo nào.'));
    return;
  }
  for (const item of announcements) panel.append(newsItem(item));
}

function newsItem(item) {
  const image = resolveVetviralUrl(item.imageUrl);
  const action = resolveVetviralUrl(item.actionUrl);
  const date = item.publishAt ? new Date(item.publishAt).toLocaleDateString('vi-VN') : '';
  return el('article', { class: `news-item${item.read ? '' : ' unread'}` },
    el('div', { class: 'news-meta' }, item.badge ? el('span', { class: 'news-badge' }, item.badge) : null, el('span', {}, date)),
    el('h3', {}, item.title),
    el('p', { class: 'news-body' }, item.body),
    image ? el('img', { src: image, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null,
    el('div', { class: 'news-actions' },
      action ? el('a', { class: 'go', href: action, target: '_blank', rel: 'noopener', onclick: () => readAnnouncement(item) }, 'Xem chi tiết') : null,
      item.read ? null : el('button', { onclick: () => readAnnouncement(item) }, 'Đánh dấu đã đọc'),
      el('button', { onclick: () => dismissNews(item) }, 'Ẩn'),
    ),
  );
}

// Errors from the account API: an expired session signs out quietly; others go to the status bar.
function accountFailed(err) {
  if (isSessionExpired(err)) {
    state.vv = { user: null, announcements: [], loaded: false };
    setStatus('Phiên đăng nhập VET VIRAL đã hết hiệu lực. Hãy đăng nhập lại.', true);
  } else {
    setStatus(err.message, true);
  }
  renderAccountArea();
  if (state.panel === 'news') renderNews();
}

async function refreshAccount({ silent = false } = {}) {
  if (!account.signedIn) {
    state.vv = { user: null, announcements: [], loaded: false };
    renderAccountArea();
    if (state.panel === 'news') renderNews();
    return;
  }
  try {
    const [user, announcements] = await Promise.all([account.me(), account.announcements()]);
    state.vv = { user, announcements, loaded: true };
  } catch (err) {
    if (silent && !isSessionExpired(err)) return; // offline at startup: keep quiet, keep the session
    return accountFailed(err);
  }
  renderAccountArea();
  if (state.panel === 'news') renderNews();
}

async function readAnnouncement(item) {
  if (item.read) return;
  try {
    await account.markRead(item.id);
    state.vv.announcements = state.vv.announcements.map((a) => (a.id === item.id ? { ...a, read: true } : a));
    renderAccountArea();
    renderNews();
  } catch (err) {
    accountFailed(err);
  }
}

async function dismissNews(item) {
  try {
    await account.dismiss(item.id);
    state.vv.announcements = state.vv.announcements.filter((a) => a.id !== item.id);
    renderAccountArea();
    renderNews();
  } catch (err) {
    accountFailed(err);
  }
}

async function markAllNewsRead() {
  try {
    await account.markAllRead();
    state.vv.announcements = state.vv.announcements.map((a) => ({ ...a, read: true }));
    renderAccountArea();
    renderNews();
  } catch (err) {
    accountFailed(err);
  }
}

// Sign-in with a confirmation code: show the code, the user approves on vetviral.com, this dialog
// waits and closes by itself. Closing the dialog cancels the wait.
async function openLoginDialog() {
  const code = el('div', { class: 'login-code', 'aria-live': 'polite' }, '····-····');
  const link = el('a', { class: 'button-link', href: `${VETVIRAL_URL}/connect`, target: '_blank', rel: 'noopener' }, icon('external', 16), 'Mở vetviral.com để xác nhận');
  const status = el('p', { class: 'dlg-hint', role: 'status' }, 'Đang lấy mã…');
  const controller = new AbortController();
  const close = openDialog({
    title: 'Đăng nhập bằng tài khoản VET VIRAL',
    body: el('div', {},
      el('p', { class: 'dlg-text' }, 'Mở vetviral.com, đăng nhập rồi bấm "Cho phép" khi thấy đúng mã dưới đây.'),
      code,
      link,
      status,
      el('p', { class: 'dlg-hint' }, 'PDF Editor chỉ đọc tên, email, gói và thông báo của bạn. Không dùng được điểm, không thanh toán, không gửi tài liệu. Thu hồi bất cứ lúc nào trong Cài đặt › Bảo mật của VET VIRAL.'),
    ),
    actions: [{ label: 'Hủy' }],
    onClose: () => controller.abort(),
  });
  try {
    const started = await account.startLogin(clientNameFrom(navigator.userAgent));
    code.textContent = started.userCode;
    link.href = started.verificationUrl;
    status.textContent = 'Bấm nút trên. Hộp thoại này tự đóng khi bạn đã cho phép.';
    const user = await account.waitForApproval(started, {
      signal: controller.signal,
      onPending: () => (status.textContent = 'Đang chờ bạn xác nhận trên vetviral.com…'),
    });
    state.vv = { user, announcements: [], loaded: false };
    close();
    renderAccountArea();
    setStatus(`Đã đăng nhập VET VIRAL: ${user?.name || user?.email || ''}.`);
    showPanel('news');
    await refreshAccount();
  } catch (err) {
    if (err.code === 'aborted') return;
    status.textContent = err.message;
    status.classList.add('dlg-error');
  }
}

async function logoutAccount() {
  try {
    await account.logout();
    setStatus('Đã đăng xuất VET VIRAL.');
  } catch {
    setStatus('Đã đăng xuất trên máy này. Không liên lạc được VET VIRAL; bạn có thể thu hồi kết nối trong Cài đặt › Bảo mật.', true);
  }
  state.vv = { user: null, announcements: [], loaded: false };
  renderAccountArea();
  if (state.panel === 'news') renderNews();
}

// ---------- quick tools, start screen ----------

// Runs a quick-tool card (quicktools.js). A job that needs a document asks for a PDF first.
function runQuickTool(card) {
  const needsDoc = card.tool ? true : !!ACTIONS[card.action]?.needsDoc;
  const go = () => (card.tool ? setTool(card.tool) : runAction(card.action));
  return needsDoc && !state.pdfBytes ? pickPdfThen(go) : go();
}

function openQuickTools() {
  let close = () => {};
  close = openDialog({
    title: 'Công cụ nhanh',
    width: 900,
    body: quickToolsGrid((card) => {
      close();
      runQuickTool(card);
    }),
    actions: [{ label: 'Đóng' }],
  });
}

// The start screen (quick tools and a drop area) replaces the page view while no document is open.
function showStart(on) {
  els.start.classList.toggle('hidden', !on);
  els.view.classList.toggle('hidden', on);
  if (!on || els.start.childElementCount) return;
  els.start.append(
    el('div', { class: 'start-hero' },
      el('h1', {}, 'PDF Editor', el('span', { class: 'pro' }, 'PRO')),
      el('p', { class: 'start-sub' }, 'Chỉnh sửa, chuyển đổi và bảo vệ PDF ngay trong trình duyệt. Tệp của bạn không rời khỏi máy.'),
      el('div', { class: 'start-drop' },
        icon('upload', 22),
        el('span', { class: 'grow' }, 'Kéo thả tệp PDF vào đây để mở'),
        el('button', { class: 'primary', onclick: () => runAction('open') }, icon('open', 16), 'Mở PDF'),
        el('button', { onclick: () => runAction('newBlank') }, icon('file', 16), 'Tài liệu trống'),
      ),
    ),
    quickToolsGrid(runQuickTool),
  );
}

// Asks for a PDF, opens it, then runs `next` with what openPdfFile reports ({ encrypted }).
function pickPdfThen(next) {
  const input = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
  input.addEventListener('cancel', () => input.remove());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.remove();
    const opened = file ? await openPdfFile(file) : null;
    if (opened) await next(opened);
  });
  document.body.append(input);
  input.click();
}

// Quick tool: open a protected PDF and save it without its password and restrictions.
function unlockQuick() {
  pickPdfThen(async ({ encrypted }) => {
    if (!encrypted) return setStatus('Tệp này không có mật khẩu hay hạn chế quyền, không cần gỡ.');
    state.settings = { ...state.settings, protection: null };
    await exportCurrent();
  });
}

async function closeDocument() {
  if (!(await confirmReplace())) return;
  state.doc?.destroy();
  Object.assign(state, {
    pdfBytes: null,
    doc: null,
    fileName: 'document.pdf',
    pageSizes: [],
    pageEls: [],
    boxes: [],
    marks: [],
    settings: EMPTY_SETTINGS,
    selected: null,
    current: 0,
    formFields: [],
    docInfo: null,
    outline: null,
    textCache: new Map(),
    search: { query: '', caseSensitive: false, hits: [], index: -1 },
  });
  store.clearHistory();
  els.view.replaceChildren();
  store.emit(EVENTS.pagesUpdated, { doc: null, pageSizes: [], current: 0, order: null, changed: [] });
  setCurrentPage(0);
  updateQuick();
  renderProps();
  renderPanel();
  updateQuick();
  showStart(true);
  setStatus('Đã đóng tài liệu.');
}

// ---------- fonts for export ----------

let fontError = null; // why the Unicode font could not be loaded, for the next status message

// Font for text that Helvetica cannot write (most Vietnamese): the font chosen in Tệp › Chọn font,
// else DejaVu Sans in `variant` (regular, bold, italic, boldItalic) fetched on first need. Null when
// Helvetica is enough or the download failed. A chosen font serves every variant.
async function fontFor(texts, variant = 'regular') {
  if (state.fontBytes) return state.fontBytes;
  if (!needsUnicodeFont(texts)) return null;
  const status = els.status.textContent;
  const style = { regular: '', bold: ' Bold', italic: ' Oblique', boldItalic: ' Bold Oblique' }[variant] ?? '';
  setStatus(`Đang tải font tiếng Việt (DejaVu Sans${style}, khoảng 700 KB, chỉ lần đầu)…`);
  try {
    const bytes = await loadUnicodeFont(variant);
    setStatus(status);
    return bytes;
  } catch (err) {
    fontError = err.message;
    return null;
  }
}

// Every text the exporter draws with a font: text boxes, stamps, watermark, header/footer, OCR
// words and filled form fields.
function exportTexts(boxes, marks, settings = {}) {
  const hf = sanitizeHeaderFooter(settings.headerFooter);
  const ctx = { file: state.fileName, date: todayLabel(), page: 1, total: 1, bates: hf ? batesLabel(hf.batesPrefix, 0, 1, 0) : '' };
  const formTouched = Object.keys(settings.formValues ?? {}).length > 0 || settings.flattenForm;
  return [
    ...boxes.map((b) => b.text),
    ...marks.filter((m) => m.type === 'stamp').map((m) => m.label),
    settings.watermark?.text,
    ...(hf ? HEADER_FOOTER_SLOTS.map((s) => formatTokens(hf[s], ctx)) : []),
    ...(settings.ocrWords ?? []).map((w) => w.text),
    ...(formTouched ? [...state.formFields.map((f) => f.value), ...Object.values(settings.formValues)].filter((v) => typeof v === 'string') : []),
  ];
}

// ---------- split, merge, crop, page numbers ----------

function openSplitDialog() {
  const total = state.pageSizes.length;
  const half = Math.ceil(total / 2);
  const mode = el('select', {},
    el('option', { value: 'ranges' }, 'Theo các phần tự chọn'),
    el('option', { value: 'every' }, 'Mỗi N trang một tệp'),
    el('option', { value: 'each' }, 'Mỗi trang một tệp'),
  );
  const ranges = el('input', { type: 'text', value: total > 1 ? `1-${half}; ${half + 1}-${total}` : '1', placeholder: '1-3; 4-6; 7-' });
  const every = el('input', { type: 'number', min: 1, max: total, value: Math.max(1, half) });
  const rangesRow = field('Các phần (cách nhau bằng dấu ;)', ranges, 'Mỗi phần là một tệp. Trong một phần dùng dấu phẩy: 1-2, 5.');
  const everyRow = field('Số trang mỗi tệp', every);
  const preview = el('p', { class: 'split-preview' });
  const error = el('p', { class: 'dlg-error' });
  const plan = () => splitPlan(mode.value, total, mode.value === 'every' ? every.value : ranges.value);
  const update = () => {
    rangesRow.classList.toggle('hidden', mode.value !== 'ranges');
    everyRow.classList.toggle('hidden', mode.value !== 'every');
    try {
      const parts = plan();
      const list = parts.slice(0, 6).map((p) => formatPageRange(p)).join(' · ');
      preview.textContent = `Sẽ tạo ${parts.length} tệp: ${list}${parts.length > 6 ? ' · …' : ''}${parts.length > 1 ? ' (đóng gói .zip)' : ''}`;
      error.textContent = '';
    } catch (err) {
      preview.textContent = '';
      error.textContent = err.message;
    }
  };
  for (const input of [mode, ranges, every]) input.addEventListener('input', update);
  update();
  openDialog({
    title: 'Tách PDF',
    body: el('div', {},
      el('p', { class: 'dlg-hint' }, `Tài liệu có ${total} trang. Mỗi tệp mới giữ mọi chỉnh sửa và mật khẩu đã đặt.`),
      field('Cách tách', mode), rangesRow, everyRow, preview, error,
    ),
    actions: [
      { label: 'Hủy' },
      {
        label: 'Tách',
        primary: true,
        run: () => {
          let parts;
          try {
            parts = plan();
          } catch (err) {
            error.textContent = err.message;
            return false;
          }
          splitDocument(parts);
        },
      },
    ],
  });
}

function splitDocument(parts) {
  return withBusy('Đang tách PDF…', async () => {
    const full = await buildOutput();
    const base = baseName(state.fileName);
    const files = [];
    for (const [k, part] of parts.entries()) {
      setStatus(`Đang tạo phần ${k + 1}/${parts.length}…`);
      files.push({ name: `${base}-phan-${k + 1}-trang-${formatPageRange(part)}.pdf`, data: await protectOutput(await extractPages(full, part)) });
    }
    if (files.length === 1) {
      download(files[0].data, files[0].name);
      return setStatus(`Đã tách thành ${files[0].name}.`);
    }
    setStatus(`Đang nén ${files.length} tệp…`);
    download(await zipFiles(files), `${base}-tach-${files.length}-phan.zip`, 'application/zip');
    setStatus(`Đã tách thành ${files.length} tệp trong ${base}-tach-${files.length}-phan.zip.`);
  });
}

function openMergeDialog() {
  const files = []; // { name, size, bytes, pages }
  const list = el('div', { class: 'merge-list' });
  const summary = el('p', { class: 'dlg-hint' });
  const error = el('p', { class: 'dlg-error' });
  const withCurrent = state.pdfBytes ? el('input', { type: 'checkbox', checked: true }) : null;
  const picker = el('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true });
  const drop = el('div', { class: 'dropzone', role: 'button', tabindex: 0 },
    el('strong', {}, 'Kéo thả các tệp PDF vào đây'),
    el('p', { class: 'dlg-hint' }, 'hoặc bấm để chọn nhiều tệp cùng lúc'),
  );
  const move = (k, d) => {
    const [f] = files.splice(k, 1);
    files.splice(k + d, 0, f);
    render();
  };
  const render = () => {
    list.replaceChildren(...files.map((f, k) => el('div', { class: 'merge-row' },
      el('span', { class: 'merge-num' }, `${k + 1}`),
      icon('file', 16),
      el('span', { class: 'merge-name', title: f.name }, f.name),
      el('span', { class: 'faint' }, `${f.pages} trang · ${sizeLabel(f.size)}`),
      iconButton('up', 'Đưa lên', () => move(k, -1), { disabled: k === 0 }),
      iconButton('down', 'Đưa xuống', () => move(k, 1), { disabled: k === files.length - 1 }),
      iconButton('trash', 'Bỏ khỏi danh sách', () => {
        files.splice(k, 1);
        render();
      }),
    )));
    const current = withCurrent?.checked ? state.pageSizes.length : 0;
    const pages = files.reduce((n, f) => n + f.pages, current);
    summary.textContent = files.length || current ? `${files.length} tệp${current ? ' + tài liệu đang mở' : ''} · tổng ${pages} trang` : 'Chưa chọn tệp nào.';
  };
  const add = async (picked) => {
    error.textContent = '';
    for (const file of picked) {
      if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
        error.textContent = `Bỏ qua ${file.name}: không phải tệp PDF.`;
        continue;
      }
      try {
        let bytes = await readFile(file);
        if (await isEncrypted(bytes)) {
          if ((await checkPassword(bytes, '')) !== 'ok') throw new Error('tệp có mật khẩu, hãy dùng Gỡ mật khẩu trước');
          bytes = await decryptPdf(bytes, '');
        }
        files.push({ name: file.name, size: file.size, bytes, pages: (await PDFLib.PDFDocument.load(bytes)).getPageCount() });
      } catch (err) {
        error.textContent = `Không thêm được ${file.name}: ${err.message}`;
      }
    }
    render();
  };
  drop.addEventListener('click', () => picker.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    picker.click();
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragover');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation(); // not the window drop that opens a PDF
    drop.classList.remove('dragover');
    add([...(e.dataTransfer?.files ?? [])]);
  });
  picker.addEventListener('change', () => {
    add([...picker.files]);
    picker.value = '';
  });
  withCurrent?.addEventListener('change', render);
  render();

  const merge = (open) => {
    if (files.length + (withCurrent?.checked ? 1 : 0) < 2) {
      error.textContent = 'Cần ít nhất hai tệp để gộp.';
      return false;
    }
    mergeFiles(files.map((f) => f.bytes), { open, withCurrent: !!withCurrent?.checked, name: files[0]?.name });
  };
  openDialog({
    title: 'Gộp nhiều PDF',
    width: 560,
    body: el('div', {},
      drop, picker, list, summary,
      withCurrent ? el('label', { class: 'lbl small' }, withCurrent, 'Đặt tài liệu đang mở (kèm chỉnh sửa) lên đầu') : null,
      error,
    ),
    actions: [
      { label: 'Hủy' },
      { label: 'Gộp và tải về', run: () => merge(false) },
      { label: 'Gộp và mở', primary: true, run: () => merge(true) },
    ],
  });
}

async function mergeFiles(list, { open, withCurrent, name }) {
  if (open && !withCurrent && !(await confirmReplace())) return;
  await withBusy('Đang gộp tệp…', async () => {
    const all = withCurrent ? [await buildOutput(), ...list] : list;
    const fileName = `${baseName(withCurrent ? state.fileName : name ?? 'tai-lieu.pdf')}-gop.pdf`;
    const bytes = await mergePdfs(all);
    if (open) {
      await openBytes(bytes, fileName);
      return setStatus(`Đã gộp ${all.length} tệp thành ${fileName} (${state.pageSizes.length} trang). Nhấn Ctrl+S để lưu.`);
    }
    download(withCurrent ? await protectOutput(bytes) : bytes, fileName);
    setStatus(`Đã gộp ${all.length} tệp và tải về ${fileName}.`);
  });
}

// Bounding box of a text box as displayed (its DOM size), in view points.
function textBoxBounds(b) {
  const node = document.querySelector(`.tbox[data-id="${b.id}"]`);
  return node ? { x: b.x, y: b.y, w: node.offsetWidth / state.zoom, h: node.offsetHeight / state.zoom } : { x: b.x, y: b.y, w: 1, h: b.fontSize * 1.2 };
}

// Margins that keep what is drawn on page `i` (the PDF and the editor's items) plus `pad` points.
async function autoMargins(i, pad) {
  const scale = 0.75;
  const page = await state.doc.getPage(i + 1);
  const view = page.getViewport({ scale });
  const canvas = el('canvas', { width: Math.ceil(view.width), height: Math.ceil(view.height) });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: view }).promise;
  const px = contentBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  canvas.width = canvas.height = 0;
  const drawn = px && { x: px.x / scale, y: px.y / scale, w: px.w / scale, h: px.h / scale };
  const items = [...marksOnPage(state.marks, i).map(markBounds), ...state.boxes.filter((b) => b.page === i).map(textBoxBounds)];
  return marginsFromBounds(unionRects([drawn, ...items]), state.pageSizes[i], pad);
}

function openCropDialog() {
  const total = state.pageSizes.length;
  const scope = el('select', {},
    el('option', { value: 'current' }, `Trang hiện tại (${state.current + 1})`),
    el('option', { value: 'all' }, `Tất cả ${total} trang`),
    el('option', { value: 'range' }, 'Dãy trang…'),
  );
  const range = el('input', { type: 'text', placeholder: 'Ví dụ 1-3, 5', disabled: true });
  const manual = el('input', { type: 'radio', name: 'crop-mode', checked: true });
  const auto = el('input', { type: 'radio', name: 'crop-mode' });
  const mm = (v) => el('input', { type: 'number', min: 0, step: 1, value: v });
  const sides = { top: mm(10), right: mm(10), bottom: mm(10), left: mm(10) };
  const pad = mm(3);
  const measure = el('button', { type: 'button', class: 'dlg-btn' }, icon('scan', 16), 'Đo lề trắng trang hiện tại');
  const manualBox = el('div', {},
    el('div', { class: 'crop-sides' }, field('Trên (mm)', sides.top), field('Phải (mm)', sides.right), field('Dưới (mm)', sides.bottom), field('Trái (mm)', sides.left)),
    measure,
  );
  const autoBox = el('div', { class: 'hidden' }, field('Chừa thêm quanh nội dung (mm)', pad, 'Mỗi trang được đo riêng; trang trắng giữ nguyên.'));
  const error = el('p', { class: 'dlg-error' });
  const toPt = (input) => mmToPt(Math.max(0, Number(input.value) || 0));
  const manualMargins = () => Object.fromEntries(Object.entries(sides).map(([k, input]) => [k, toPt(input)]));

  // Preview on the current page: the part that will be cut is shaded.
  const drawPreview = (m) => {
    const svg = pageSvg(state.current);
    svg?.querySelectorAll('.crop-shade').forEach((n) => n.remove());
    if (!svg || !m) return;
    const { width: W, height: H } = state.pageSizes[state.current];
    const d = `M0 0H${W}V${H}H0Z M${m.left} ${m.top}V${H - m.bottom}H${W - m.right}V${m.top}Z`;
    svg.append(svgEl('path', { class: 'crop-shade', d, 'fill-rule': 'evenodd' }));
  };
  let previewToken = 0;
  const update = async () => {
    const token = ++previewToken;
    range.disabled = scope.value !== 'range';
    manualBox.classList.toggle('hidden', auto.checked);
    autoBox.classList.toggle('hidden', !auto.checked);
    const m = auto.checked ? await autoMargins(state.current, toPt(pad)) : manualMargins();
    if (token === previewToken) drawPreview(m);
  };
  measure.addEventListener('click', async () => {
    const m = await autoMargins(state.current, 0);
    for (const k of Object.keys(sides)) sides[k].value = Math.floor(ptToMm(m[k]));
    update();
  });
  for (const input of [scope, manual, auto, pad, ...Object.values(sides)]) input.addEventListener('input', update);
  scope.addEventListener('change', () => {
    if (!range.disabled) range.focus();
  });
  update();

  openDialog({
    title: 'Cắt lề trang',
    width: 480,
    body: el('div', {},
      field('Áp dụng cho', scope), range,
      el('div', { class: 'radio-row' },
        el('label', { class: 'lbl' }, manual, 'Lề cố định'),
        el('label', { class: 'lbl' }, auto, 'Tự động theo nội dung'),
      ),
      manualBox, autoBox,
      el('p', { class: 'dlg-hint' }, 'Vùng tô xám trên trang là phần bị cắt. Các mục đã thêm giữ nguyên vị trí so với nội dung.'),
      error,
    ),
    onClose: () => {
      previewToken++;
      drawPreview(null);
    },
    actions: [
      { label: 'Hủy' },
      {
        label: 'Cắt lề',
        primary: true,
        run: async () => {
          let pages;
          try {
            pages = scope.value === 'current' ? [state.current] : scope.value === 'all' ? state.pageSizes.map((_, i) => i) : parsePageRange(range.value, total);
          } catch (err) {
            error.textContent = err.message;
            return false;
          }
          const boxes = await pageBoxes(state.pdfBytes);
          const fixed = auto.checked ? null : manualMargins();
          if (fixed) {
            try {
              for (const i of pages) croppedBox(boxes[i].rotation, boxes[i].box, fixed);
            } catch (err) {
              error.textContent = err.message;
              return false;
            }
          }
          cropDocument(pages, boxes, fixed, toPt(pad));
        },
      },
    ],
  });
}

// Crops `pages` with fixed margins, or with margins measured per page when `fixed` is null.
// Every item on a cropped page moves with the content, so it stays where it was on the paper.
function cropDocument(pages, boxes, fixed, pad) {
  return withBusy('Đang cắt lề…', async () => {
    const crops = new Map();
    const shifts = new Map();
    let tooSmall = 0;
    for (const [k, i] of pages.entries()) {
      if (!fixed) setStatus(`Đang đo lề trang ${i + 1} (${k + 1}/${pages.length})…`);
      const m = fixed ?? (await autoMargins(i, pad));
      if (!m.top && !m.right && !m.bottom && !m.left) continue;
      try {
        crops.set(i, croppedBox(boxes[i].rotation, boxes[i].box, m));
        shifts.set(i, m);
      } catch {
        tooSmall++;
      }
    }
    if (!crops.size) return setStatus(tooSmall ? 'Nội dung quá nhỏ để cắt lề tự động.' : 'Không có lề nào cần cắt.');
    const before = snap();
    const bytes = await cropPages(state.pdfBytes, crops);
    const shift = (it) => {
      const m = shifts.get(it.page);
      if (!m) return it;
      return Array.isArray(it.points) ? moveMark(it, -m.left, -m.top) : { ...it, x: it.x - m.left, y: it.y - m.top };
    };
    await applyBytes(bytes, before, { remap: (items) => items.map(shift), changed: [...crops.keys()] });
    setStatus(`Đã cắt lề ${crops.size} trang${tooSmall ? `, bỏ qua ${tooSmall} trang quá ít nội dung` : ''}. Ctrl+Z để hoàn tác.`);
  });
}

const PAGE_NUMBER_FORMATS = ['Trang {page} / {total}', 'Trang {page}', '{page} / {total}', '{page}', '- {page} -'];
const SLOT_LABELS = {
  headerLeft: 'Đầu trang, bên trái',
  headerCenter: 'Đầu trang, ở giữa',
  headerRight: 'Đầu trang, bên phải',
  footerLeft: 'Chân trang, bên trái',
  footerCenter: 'Chân trang, ở giữa',
  footerRight: 'Chân trang, bên phải',
};
const hasPageToken = (s) => /\{page\}/.test(s ?? '');

// Page numbers are a header/footer slot holding {page}; size and margin are shared with Đầu/chân trang.
function openPageNumbersDialog() {
  const hf = state.settings.headerFooter ?? {};
  const used = HEADER_FOOTER_SLOTS.find((s) => hasPageToken(hf[s]));
  const slot = el('select', {}, HEADER_FOOTER_SLOTS.map((s) => el('option', { value: s, selected: s === (used ?? 'footerCenter') }, SLOT_LABELS[s])));
  const formats = used && !PAGE_NUMBER_FORMATS.includes(hf[used]) ? [hf[used], ...PAGE_NUMBER_FORMATS] : PAGE_NUMBER_FORMATS;
  const sample = (f) => f.replace('{page}', '1').replace('{total}', `${state.pageSizes.length}`);
  const format = el('select', {}, formats.map((f) => el('option', { value: f, selected: f === (used ? hf[used] : PAGE_NUMBER_FORMATS[0]) }, sample(f))));
  const start = el('input', { type: 'number', min: 0, value: hf.pageStart ?? 1 });
  const skip = el('input', { type: 'checkbox', checked: !!hf.skipFirst });
  const size = el('input', { type: 'number', min: 6, max: 36, value: hf.fontSize ?? 10 });
  const margin = el('input', { type: 'number', min: 6, max: 144, value: hf.margin ?? 24 });
  const actions = [
    { label: 'Hủy' },
    {
      label: 'Áp dụng',
      primary: true,
      run: () => {
        const next = { color: '#000000', ...hf, fontSize: size.value, margin: margin.value, pageStart: start.value, skipFirst: skip.checked };
        for (const s of HEADER_FOOTER_SLOTS) if (hasPageToken(next[s])) next[s] = '';
        next[slot.value] = format.value;
        updateSettings({ headerFooter: sanitizeHeaderFooter(next) });
        setStatus('Đã đánh số trang. Số trang được ghi vào tệp khi xuất.');
      },
    },
  ];
  if (used) {
    actions.unshift({
      label: 'Gỡ số trang',
      danger: true,
      run: () => {
        const next = { ...hf };
        for (const s of HEADER_FOOTER_SLOTS) if (hasPageToken(next[s])) next[s] = '';
        updateSettings({ headerFooter: sanitizeHeaderFooter(next) });
      },
    });
  }
  openDialog({
    title: 'Đánh số trang',
    body: el('div', {},
      field('Vị trí', slot), field('Mẫu', format),
      el('div', { class: 'dlg-grid' }, field('Bắt đầu từ số', start), field('Cỡ chữ', size), field('Lề (pt)', margin)),
      el('label', { class: 'lbl small' }, skip, 'Không đánh số trang đầu (trang bìa); trang thứ hai mang số bắt đầu'),
      el('p', { class: 'dlg-hint' }, 'Cỡ chữ và lề dùng chung với Đầu/chân trang & số Bates.'),
    ),
    actions,
  });
}

// ---------- outline (bookmarks) ----------

// The panel shows the file's own outline (state.outline) until the first edit; from then on the edited
// list lives in state.settings.bookmarks (undoable, written into the PDF on export). See bookmarks.js.
let outlineSelected = null; // id of the selected entry
let outlineEditing = null; // id of the entry being renamed
const outlineCollapsed = new Set();
const bookmarksNow = () => state.settings.bookmarks ?? state.outline ?? [];

// Page and point of a pdf.js destination ({ page: null } when it cannot be resolved).
async function resolveDest(doc, dest) {
  try {
    const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(d) || !d.length) return { page: null };
    const page = typeof d[0] === 'object' ? await doc.getPageIndex(d[0]) : Number(d[0]);
    const kind = d[1]?.name;
    if (kind === 'XYZ') return { page, left: d[2], top: d[3] };
    if (kind === 'FitH' || kind === 'FitBH') return { page, top: d[2] };
    return { page };
  } catch {
    return { page: null };
  }
}

// The file's outline as editable entries, every destination resolved to a page and a point.
async function loadOutline(doc) {
  let items = null;
  try {
    items = await doc.getOutline();
  } catch {
    items = null;
  }
  const resolve = (list) => Promise.all((list ?? []).map(async (it) => ({ title: it.title, url: safeUrl(it.url ?? ''), ...(await resolveDest(doc, it.dest)), items: await resolve(it.items) })));
  const flat = flattenOutline(await resolve(items));
  if (doc !== state.doc) return; // another document was opened meanwhile
  state.outline = flat;
  if (state.panel === 'outline') renderOutline();
}

// One undo step; the first edit starts from a copy of the file's outline.
function editBookmarks(next) {
  if (next === bookmarksNow()) return renderOutline();
  updateSettings({ bookmarks: next });
}

const bookmarkIndex = (id) => bookmarksNow().findIndex((b) => b.id === id);

// The page and the PDF point at the top of the view, where a new bookmark points. The page comes
// from the scroll offset, which is up to date even while the current page is still following a scroll.
async function viewPosition() {
  const scrolled = els.view.scrollTop;
  let i = 0;
  state.pageEls.forEach((div, k) => {
    if (div.offsetTop <= scrolled + 1) i = k;
  });
  const div = state.pageEls[i];
  const y = div ? clamp((scrolled - div.offsetTop) / state.zoom, 0, state.pageSizes[i].height) : 0;
  const [left, top] = (await state.doc.getPage(i + 1)).getViewport({ scale: 1 }).convertToPdfPoint(0, y);
  return { page: i, left: Math.round(left * 100) / 100, top: Math.round(top * 100) / 100 };
}

// Adds a bookmark to the place being viewed, after the selected one (else in page order), and opens
// it for renaming.
async function addBookmarkHere() {
  if (!state.doc) return;
  const pos = await viewPosition();
  const list = bookmarksNow();
  const selected = bookmarkIndex(outlineSelected);
  const id = nextBookmarkId(list);
  outlineSelected = id;
  outlineEditing = id;
  if (state.panel !== 'outline') showPanel('outline');
  editBookmarks(insertBookmark(list, { id, title: `Trang ${pos.page + 1}`, ...pos, depth: 0, url: '' }, selected >= 0 ? selected : bookmarkSlot(list, pos.page)));
  setStatus('Đã thêm mục lục. Gõ tên rồi nhấn Enter; mục lục được ghi vào tệp khi xuất.');
}

// Scrolls to a bookmark's page and point, or opens its web link.
async function goToBookmark(b) {
  if (b.url) {
    const url = safeUrl(b.url);
    return url ? openExternal(url) : setStatus('Liên kết trong mục lục không an toàn, đã bỏ qua.', true);
  }
  const div = b.page === null ? null : state.pageEls[b.page];
  if (!div) return setStatus('Mục này không trỏ tới trang nào trong tài liệu.');
  let y = 0;
  if (b.top !== null) {
    const page = await state.doc.getPage(b.page + 1);
    y = Math.max(0, page.getViewport({ scale: 1 }).convertToViewportPoint(b.left ?? 0, b.top)[1]);
  }
  scrollViewTo(div.offsetTop + y * state.zoom - 12, b.page);
}

function renderOutline() {
  const panel = els.outlinePanel;
  panel.replaceChildren();
  if (!state.doc) return panel.append(el('p', { class: 'lbl empty-note' }, 'Mở một tệp PDF để xem và sửa mục lục.'));
  const list = bookmarksNow();
  panel.append(el('div', { class: 'ol-head' },
    el('button', { class: 'ol-add', title: 'Thêm mục trỏ tới chỗ đang xem', onclick: addBookmarkHere }, icon('bookmark', 15), 'Thêm mục'),
    state.settings.bookmarks ? el('span', { class: 'faint ol-note' }, 'Ghi vào tệp khi xuất') : null,
  ));
  if (!list.length) return panel.append(el('p', { class: 'lbl empty-note' }, 'Tài liệu chưa có mục lục. Cuộn tới chỗ cần đánh dấu rồi bấm Thêm mục.'));
  const tree = el('div', { class: 'ol-tree', role: 'tree', 'aria-label': 'Mục lục' });
  for (const i of visibleIndices(list, outlineCollapsed)) tree.append(outlineRow(list, i));
  panel.append(tree);
  const input = panel.querySelector('.ol-input');
  if (input) {
    input.focus();
    input.select();
  }
}

function outlineRow(list, i) {
  const b = list[i];
  const parent = list[i + 1]?.depth > b.depth;
  const folded = outlineCollapsed.has(b.id);
  const row = el('div', { class: `ol-row${b.id === outlineSelected ? ' on' : ''}`, role: 'treeitem', 'aria-level': b.depth + 1, 'aria-expanded': parent ? String(!folded) : null, style: `--depth:${b.depth}` });
  const caret = parent
    ? el('button', { class: 'ol-caret', title: folded ? 'Mở rộng' : 'Thu gọn', 'aria-label': folded ? 'Mở rộng' : 'Thu gọn', onclick: () => {
      if (folded) outlineCollapsed.delete(b.id);
      else outlineCollapsed.add(b.id);
      renderOutline();
    } }, folded ? '▸' : '▾')
    : el('span', { class: 'ol-caret' });
  const startRename = () => {
    outlineSelected = b.id;
    outlineEditing = b.id;
    renderOutline();
  };

  let label;
  if (b.id === outlineEditing) {
    label = el('input', { class: 'ol-input', type: 'text', value: b.title, 'aria-label': 'Tên mục lục' });
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      outlineEditing = null;
      const title = label.value.trim();
      if (save && title && title !== b.title) editBookmarks(renameBookmark(bookmarksNow(), bookmarkIndex(b.id), title));
      else renderOutline();
    };
    label.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keys belong to the text field, not the editor shortcuts
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    label.addEventListener('blur', () => finish(true));
  } else {
    label = el('button', { class: 'ol-item', title: b.url || b.title, ondblclick: startRename, onclick: () => {
      outlineSelected = b.id;
      renderOutline();
      goToBookmark(b);
    } }, b.title || '(không tên)');
  }

  // Each tool acts on this entry, found again by id since the list may have changed.
  const tool = (name, title, edit) => iconButton(name, title, (e) => {
    e.stopPropagation();
    outlineSelected = b.id;
    editBookmarks(edit(bookmarksNow(), bookmarkIndex(b.id)));
  });
  const tools = el('span', { class: 'ol-tools' },
    iconButton('pencil', 'Đổi tên (F2)', startRename),
    tool('up', 'Đưa lên', (l, k) => moveBookmark(l, k, -1)),
    tool('down', 'Đưa xuống', (l, k) => moveBookmark(l, k, 1)),
    tool('prev', 'Lên một cấp', (l, k) => indentBookmark(l, k, -1)),
    tool('next', 'Thành mục con của mục trên', (l, k) => indentBookmark(l, k, 1)),
    tool('trash', 'Xóa mục và các mục con (Del)', removeBookmark),
  );
  row.addEventListener('keydown', (e) => {
    if (b.id === outlineEditing || (e.key !== 'F2' && e.key !== 'Delete')) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'F2') startRename();
    else editBookmarks(removeBookmark(bookmarksNow(), bookmarkIndex(b.id)));
  });
  row.append(caret, label, tools);
  return row;
}

// Reverses the order of the pages selected in the thumbnails, or of the whole document.
function reversePages() {
  const picked = selectedPages();
  const pages = picked.length > 1 ? picked : state.pageSizes.map((_, i) => i);
  if (pages.length < 2) return setStatus('Tài liệu chỉ có một trang.');
  const order = reverseOrder(state.pageSizes.length, pages);
  return withBusy('Đang đảo thứ tự trang…', async () => {
    const before = snap();
    const bytes = await reorderPages(state.pdfBytes, order);
    await applyBytes(bytes, before, { remap: (items) => remapOrder(items, order), current: order.indexOf(state.current), order });
    setStatus(`Đã đảo thứ tự ${picked.length > 1 ? `${pages.length} trang đã chọn` : `cả ${pages.length} trang`}. Ctrl+Z để hoàn tác.`);
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
  // Live preview on the current page's shape, drawn the way renderDecorations draws it.
  const { width: W, height: H } = state.pageSizes[state.current] ?? { width: 595.28, height: 841.89 };
  const label = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'deco' });
  const preview = svgEl('svg', { class: 'dlg-preview', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Xem trước hình mờ' });
  preview.append(svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff' }), label);
  const update = () => {
    const wm = sanitizeWatermark({ text: text.value, fontSize: size.value, color: color.value, opacity: Number(opacity.value) / 100, angle: angle.value });
    label.textContent = wm?.text ?? '';
    if (!wm) return;
    for (const [k, v] of Object.entries({ 'font-size': wm.fontSize, fill: wm.color, 'fill-opacity': wm.opacity, transform: `rotate(${-wm.angle} ${W / 2} ${H / 2})` })) label.setAttribute(k, v);
  };
  for (const input of [text, size, color, opacity, angle]) input.addEventListener('input', update);
  update();
  openDialog({
    title: 'Hình mờ',
    subtitle: 'Chữ in chìm trên mọi trang khi xuất',
    icon: 'watermark',
    width: 520,
    body: el('div', {}, preview, el('div', { class: 'dlg-grid' }, field('Nội dung', text), field('Cỡ chữ', size), field('Màu', color), field('Độ mờ (%)', opacity), field('Góc xoay (độ)', angle))),
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
  const pageStart = el('input', { type: 'number', min: 0, value: hf.pageStart ?? 1 });
  const skipFirst = el('input', { type: 'checkbox', checked: !!hf.skipFirst });
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
          pageStart: pageStart.value,
          skipFirst: skipFirst.checked,
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
      el('div', { class: 'dlg-grid' }, field('Cỡ chữ', size), field('Màu', color), field('Lề (pt)', margin), field('Tiền tố Bates', prefix), field('Bates bắt đầu', start), field('Số chữ số', digits), field('{page} bắt đầu từ', pageStart)),
      el('label', { class: 'lbl small' }, skipFirst, 'Không hiện trên trang đầu (trang bìa)'),
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
  const k = keyLabel;
  const apple = PLATFORM === 'mac' || PLATFORM === 'ios';
  const rows = [
    [k('Ctrl+K'), 'Tìm công cụ và lệnh'], [k('Ctrl+O'), 'Mở PDF'], [k('Ctrl+S'), 'Xuất PDF'], [k('Ctrl+P'), 'In'], [k('Ctrl+F'), 'Tìm văn bản'],
    [`${k('Ctrl+Z')} / ${k('Ctrl+Y')}`, 'Hoàn tác / làm lại'], [k('Del'), 'Xóa mục đã chọn'], ['Mũi tên', 'Dịch mục 1 pt (Shift: 10 pt)'],
    [`${k('Ctrl++')} / ${k('Ctrl+-')}`, 'Phóng to / thu nhỏ'], [`${k('Ctrl+0')} / 1 / 2`, '100% / vừa trang / vừa chiều rộng'], ['Esc', 'Về công cụ Chọn, đóng ngăn kéo'],
    [apple ? '⌥ (nhấn rồi thả)' : 'Alt (nhấn rồi thả)', 'Hiện phím truy cập (KeyTips) trên ribbon, rồi gõ chữ cái'],
    [apple ? '⌥⌘R' : 'Ctrl+F1', 'Thu gọn / hiện ribbon (hoặc nhấp đúp tên tab)'],
    ['Chuột phải, nhấn giữ', 'Menu nhanh trên trang, ảnh thu nhỏ và nút ribbon'],
    [`${apple ? '⌘' : 'Ctrl'}+lăn chuột, chụm 2 ngón`, 'Phóng to tại vị trí con trỏ'], ['Space+kéo, chuột giữa, H', 'Kéo để cuộn trang (H: công cụ Bàn tay)'],
    [`${apple ? '⌘' : 'Ctrl'} khi kéo mục`, 'Tắt bắt dính vào lề, tâm trang và mục khác'],
    [`Danh sách trang: ${apple ? '⌘' : 'Ctrl'}/Shift+bấm`, 'Chọn nhiều trang, rồi kéo thả để sắp xếp'], [`Danh sách trang: ${apple ? '⌥' : 'Alt'}+↑/↓, Del`, 'Di chuyển / xóa các trang đã chọn'],
  ];
  openDialog({
    title: 'Phím tắt',
    body: el('table', { class: 'keys' }, rows.map(([k, d]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, d)))),
    actions: [{ label: 'Đóng', primary: true }],
  });
}

function showOptions() {
  openOptionsDialog({
    currentOptions: loadAppOptions(),
    onSave: (saved) => {
      setStatus('Đã lưu tùy chọn hệ thống.');
      if (state.doc) renderCurrentPage();
    },
    onReset: () => {
      setStatus('Đã khôi phục tùy chọn mặc định.');
      if (state.doc) renderCurrentPage();
    },
  });
}

function openPalette() {
  const fold = (s) => s.toLocaleLowerCase('vi').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  const entries = [
    ...Object.entries(TOOL_INFO).map(([t, info]) => ({ label: info.label, icon: info.icon, detail: 'Công cụ', run: () => setTool(t) })),
    ...Object.entries(ACTIONS).filter(([id]) => id !== 'palette').map(([id, a]) => ({ label: a.label, icon: a.icon, detail: a.key ? keyLabel(a.key) : 'Lệnh', run: () => runAction(id) })),
    ...RIBBON_TABS.filter((t) => !t.backstage).map((t) => ({ label: `Tab: ${t.label}`, icon: 'ribbon', detail: 'Ribbon', run: () => setMode(t.id) })),
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

// Loads `bytes` into the view. `order` (the old index of each page, -1 for a new page) and
// `changed` (pages whose content changed) tell the thumbnails which pictures they can keep.
async function loadDocument(bytes, { fresh = false, order = null, changed = [] } = {}) {
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
  loadOutline(doc);
  if (fresh) {
    state.current = 0;
    state.zoom = clamp(fitZoom('width'), 0.25, 4);
    state.fit = 'width';
    try {
      state.docInfo = (await doc.getMetadata()).info ?? null;
    } catch {
      state.docInfo = null;
    }
  }
  state.current = clamp(state.current, 0, doc.numPages - 1);
  updateStatusBar();
  updateQuick();
  if (fresh) store.emit(EVENTS.loaded, { fileName: state.fileName, pageCount: doc.numPages });
  store.emit(EVENTS.pagesUpdated, { doc, pageSizes: state.pageSizes, current: state.current, order, changed });
  renderDocument();
}

// Opens PDF bytes as a new document. If they cannot be read, the document that was open stays open.
async function openBytes(bytes, name) {
  const previous = { pdfBytes: state.pdfBytes, fileName: state.fileName, boxes: state.boxes, marks: state.marks, settings: state.settings, selected: state.selected, search: state.search };
  Object.assign(state, { pdfBytes: bytes, fileName: name, boxes: [], marks: [], settings: EMPTY_SETTINGS, selected: null, search: { query: '', caseSensitive: false, hits: [], index: -1 } });
  showStart(false); // the page view must have its size before fitting the zoom
  try {
    await loadDocument(bytes, { fresh: true });
  } catch (err) {
    Object.assign(state, previous);
    showStart(!state.doc);
    throw err;
  }
  store.clearHistory();
  setStatus(`Đã mở ${name} (${state.pageSizes.length} trang).`);
}

// Opens a PDF file, asking for its password if needed. Returns { encrypted } once it is open, else null.
async function openPdfFile(file) {
  if (!(await confirmReplace())) return null;
  let bytes = await readFile(file);
  let protection = null;
  const encrypted = await isEncrypted(bytes);
  if (encrypted) {
    let unlocked;
    try {
      unlocked = await unlockPdf(bytes, file.name);
    } catch (err) {
      setStatus(err.message, true);
      return null;
    }
    if (!unlocked) {
      setStatus('Đã hủy mở tệp có mật khẩu.');
      return null;
    }
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
  return state.pdfBytes === bytes ? { encrypted } : null;
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

store.on(EVENTS.historyChanged, updateQuick);
store.on(EVENTS.selectionChanged, () => {
  paintSelection();
  renderProps();
  renderComments();
});
// Panning or pinching takes over: drop a programmatic scroll and any drawing or drag in progress.
store.on(EVENTS.pan, ({ active }) => {
  if (!active) return;
  navTarget = null;
  if (state.gesture) cancelGesture();
  cancelDrag?.();
});

// Intents from the thumbnails, the page view and the ribbon.
store.handle('page:select', ({ index }) => scrollToPage(index));
store.handle('page:reorder', ({ order }) => reorderDocPages(order));
store.handle('page:rotate', ({ pages, delta }) => rotateDocPages(pages, delta));
store.handle('page:delete', ({ pages }) => deleteDocPages(pages));
store.handle('view:zoom', ({ zoom, anchor }) => setZoom(zoom, null, anchor));

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
onFiles(els.excelPdfInput, async ([file]) => {
  if (!(await confirmReplace())) return;
  await convertExcelFileToPdf(file);
});
onFiles(els.docxPdfInput, async ([file]) => {
  if (!(await confirmReplace())) return;
  await convertDocxFileToPdf(file);
});
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
  if (mod && (key === ',' || e.key === '<')) return go(() => runAction('options'));
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
  if (!mod && !e.altKey && key === 'h' && state.doc) return go(() => setTool(state.tool === 'hand' ? 'select' : 'hand'));
  if (e.key === 'Escape') {
    closeContextMenus();
    if (layout?.close()) return;
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

els.thumbs.store = store;
// The office tools measure text in the export font; redraw once it has loaded.
loadOfficeFonts().then((ok) => ok && state.doc && state.marks.some((m) => OFFICE_TYPES.has(m.type)) && refresh());
els.view.store = store;
store.on(EVENTS.pagesUpdated, ({ pageSizes }) => {
  const count = document.getElementById('page-count');
  if (count) count.textContent = pageSizes.length ? `(${pageSizes.length})` : '';
});

// Shell: side panels first (ribbon buttons show their state), then the ribbon and the status bar.
const prefs = safeStorage();
document.documentElement.dataset.platform = PLATFORM;
layout = createPanelLayout({
  storage: prefs,
  left: els.panelLeft,
  onChange: () => {
    updateQuick();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.fit && fitTo(state.fit), 150);
  },
});
els.accountArea = el('div', { class: 'account-area' });
ribbon = createRibbon({
  titlebar: els.titlebar,
  host: els.ribbon,
  command: commandInfo,
  platform: PLATFORM,
  storage: prefs,
  tab: state.mode,
  onTab: setMode,
  accountArea: els.accountArea,
  docInfo,
});
createStatusBar({
  host: els.statusbar,
  status: els.status,
  command: commandInfo,
  platform: PLATFORM,
  zoomSteps: ZOOM_STEPS,
  onPage: (to) => scrollToPage(to === 'prev' ? state.current - 1 : to === 'next' ? state.current + 1 : to),
  onZoom: (z) => setZoom(z, null, els.view.centerAnchor?.()),
  onToggle: (side) => layout.toggle(side),
});
const missing = ribbonCommandIds().filter((id) => !commandInfo(id));
if (missing.length) console.info('Ribbon: các lệnh chưa có trong bản này được ẩn:', missing.join(', '));
els.view.addEventListener('contextmenu', pageContextMenu);
els.thumbs.addEventListener('contextmenu', thumbContextMenu);
for (const ev of [EVENTS.toolChanged, EVENTS.selectionChanged, EVENTS.pagesUpdated, EVENTS.loaded]) store.on(ev, updateQuick);

renderAccountArea();
buildSearchPanel();
updateStatusBar();
renderProps();
renderPanel();
showStart(!state.doc);
store.handle('quick:run', ({ card }) => runQuickTool(card));

// VET VIRAL account: restore a saved session, then check announcements every 30 minutes.
refreshAccount({ silent: true });
setInterval(() => {
  if (account.signedIn) refreshAccount({ silent: true });
}, 30 * 60_000);
