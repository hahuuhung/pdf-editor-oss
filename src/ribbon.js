// Ribbon layout of the editor and the pure helpers behind it: KeyTips, shortcut labels for each
// platform, the quick access toolbar list and the ribbon display mode. No DOM here, so all of it is
// unit tested in Node; src/ribbonbar.js builds the elements.
//
// A command id is an ACTIONS key of app.js ('open', 'export') or 'tool:<name>' for a pointer tool
// ('tool:highlight'). app.js resolves ids to labels, icons and handlers. Ids it does not know are
// left out of the ribbon, so a tab may list a command that the running build does not have yet.

export const TOOL_PREFIX = 'tool:';

export const toolCommand = (tool) => `${TOOL_PREFIX}${tool}`;

// The tool of a 'tool:<name>' id, or null for an action id.
export function commandTool(id) {
  return typeof id === 'string' && id.startsWith(TOOL_PREFIX) ? id.slice(TOOL_PREFIX.length) : null;
}

// ---------- layout ----------

// Ribbon labels are short; tooltips and the command palette keep the full ACTIONS/TOOL_INFO label.
export const SHORT_LABELS = Object.freeze({
  open: 'Mở',
  newBlank: 'Tài liệu mới',
  closeDoc: 'Đóng',
  export: 'Xuất PDF',
  print: 'In',
  properties: 'Thuộc tính',
  chooseFont: 'Font tiếng Việt',
  delete: 'Xóa mục chọn',
  find: 'Tìm',
  palette: 'Tìm lệnh',
  quickTools: 'Công cụ nhanh',
  convertHub: 'Chuyển đổi',
  compress: 'Giảm dung lượng',
  protect: 'Đặt mật khẩu',
  sanitize: 'Xóa thông tin ẩn',
  unlock: 'Gỡ mật khẩu',
  insertImage: 'Chèn ảnh',
  signature: 'Chữ ký',
  watermark: 'Hình mờ',
  headerFooter: 'Đầu/chân trang',
  pageNumbers: 'Đánh số trang',
  forms: 'Điền biểu mẫu',
  rotateLeft: 'Xoay trái',
  rotateRight: 'Xoay phải',
  movePageUp: 'Lên trước',
  movePageDown: 'Ra sau',
  reversePages: 'Đảo thứ tự',
  insertBlank: 'Trang trắng',
  duplicatePage: 'Nhân bản',
  deletePage: 'Xóa trang',
  extractPages: 'Trích xuất',
  split: 'Tách PDF',
  merge: 'Gộp PDF',
  combine: 'Nối thêm PDF',
  crop: 'Cắt trang',
  exportImage: 'Trang thành PNG',
  exportImagesDpi: 'Ảnh chất lượng cao',
  ocr: 'OCR',
  toggleOcr: 'Hiện khung OCR',
  exportWord: 'Sang Word',
  exportExcel: 'Sang Excel',
  exportText: 'Sang văn bản',
  exportHtml: 'Sang trang web',
  extractImages: 'Tách ảnh',
  imagesToPdf: 'Từ ảnh',
  docxToPdf: 'Từ Word',
  excelToPdf: 'Từ Excel',
  zoomIn: 'Phóng to',
  zoomOut: 'Thu nhỏ',
  zoom100: '100%',
  fitPage: 'Vừa trang',
  fitWidth: 'Vừa chiều rộng',
  toggleThumbs: 'Ảnh thu nhỏ',
  toggleSidebar: 'Bảng bên',
  commentsPanel: 'Bảng chú thích',
  outline: 'Mục lục',
  addBookmark: 'Thêm mục lục',
  news: 'Tin',
  ribbonClassic: 'Ribbon đầy đủ',
  ribbonSimple: 'Ribbon gọn',
  ribbonTabs: 'Chỉ hiện tab',
  themeSystem: 'Theo hệ thống',
  themeLight: 'Sáng',
  themeDark: 'Tối',
  shortcuts: 'Phím tắt',
  'tool:select': 'Chọn',
  'tool:hand': 'Tay kéo',
  'tool:text': 'Thêm chữ',
  'tool:date': 'Ngày hôm nay',
  'tool:note': 'Ghi chú',
  'tool:highlight': 'Tô sáng',
  'tool:underline': 'Gạch chân',
  'tool:strike': 'Gạch ngang',
  'tool:squiggly': 'Gạch sóng',
  'tool:rect': 'Chữ nhật',
  'tool:oval': 'Elip',
  'tool:line': 'Đường thẳng',
  'tool:arrow': 'Mũi tên',
  'tool:ink': 'Vẽ tự do',
  'tool:stamp': 'Con dấu',
  'tool:link': 'Liên kết',
  'tool:redact': 'Vùng che',
  'tool:check': 'Dấu tích',
  'tool:cross': 'Dấu chéo',
  'tool:dot': 'Dấu chấm',
});

// Tabs → groups → buttons. A group shows its `large` buttons (icon above a label) first, then its
// `small` buttons (icon beside a label) stacked three to a column. An item is a command id, or
// { cmd, label } to give that button its own label. The 'file' tab opens the backstage instead.
export const RIBBON_TABS = Object.freeze([
  { id: 'file', label: 'Tệp', backstage: true },
  {
    id: 'home',
    label: 'Trang đầu',
    hue: 'var(--blue)',
    groups: [
      { label: 'Tệp', large: ['open', 'export'], small: ['print', 'newBlank', 'closeDoc'] },
      { label: 'Công cụ', large: ['tool:select'], small: ['tool:hand', 'tool:text', 'tool:highlight', 'tool:note', 'tool:ink', 'signature'] },
      { label: 'Trang', small: ['rotateLeft', 'rotateRight', 'deletePage'] },
      { label: 'Tìm kiếm', large: ['find'], small: ['palette'] },
      { label: 'Công cụ nhanh', large: ['quickTools'], small: ['convertHub', 'compress', 'protect'] },
    ],
  },
  {
    id: 'comment',
    label: 'Chú thích',
    hue: 'var(--orange)',
    groups: [
      { label: 'Chọn', large: ['tool:select'] },
      { label: 'Đánh dấu văn bản', large: ['tool:highlight'], small: ['tool:underline', 'tool:strike', 'tool:squiggly'] },
      { label: 'Ghi chú', large: ['tool:note', 'tool:stamp'] },
      { label: 'Hình vẽ', large: ['tool:ink'], small: ['tool:rect', 'tool:oval', 'tool:line', 'tool:arrow'] },
      { label: 'Danh sách', large: ['commentsPanel'], small: ['delete'] },
    ],
  },
  {
    id: 'edit',
    label: 'Chỉnh sửa',
    hue: 'var(--pink)',
    groups: [
      { label: 'Chọn', large: ['tool:select'] },
      { label: 'Chèn', large: ['tool:text', 'insertImage'], small: ['tool:link'] },
      { label: 'Trình bày trang', large: ['watermark', 'headerFooter'], small: ['pageNumbers'] },
      { label: 'Tài liệu', large: ['properties'], small: ['addBookmark', 'chooseFont', 'delete'] },
    ],
  },
  {
    id: 'organize',
    label: 'Trang',
    hue: 'var(--green)',
    groups: [
      { label: 'Xoay', large: ['rotateLeft', 'rotateRight'] },
      { label: 'Sắp xếp', small: ['movePageUp', 'movePageDown', 'reversePages'] },
      { label: 'Thêm & xóa', large: ['insertBlank'], small: ['duplicatePage', 'deletePage'] },
      { label: 'Tách & gộp', large: ['split', 'merge'], small: ['extractPages', 'combine'] },
      { label: 'Cắt', large: ['crop'] },
      { label: 'Xuất', small: ['exportImage', 'exportImagesDpi'] },
    ],
  },
  {
    id: 'sign',
    label: 'Ký & điền',
    hue: 'var(--purple)',
    groups: [
      { label: 'Chọn', large: ['tool:select'] },
      { label: 'Chữ ký', large: ['signature'] },
      { label: 'Điền chữ', large: ['tool:text'], small: ['tool:date'] },
      { label: 'Ký hiệu', small: ['tool:check', 'tool:cross', 'tool:dot'] },
      { label: 'Biểu mẫu', large: ['forms'] },
    ],
  },
  {
    id: 'convert',
    label: 'Chuyển đổi',
    hue: 'var(--teal)',
    groups: [
      { label: 'Trung tâm', large: [{ cmd: 'convertHub', label: 'Trung tâm chuyển đổi' }] },
      { label: 'Nhận dạng chữ', large: ['ocr'], small: ['toggleOcr'] },
      { label: 'PDF sang', small: ['exportWord', 'exportExcel', 'exportText', 'exportHtml'] },
      { label: 'Ảnh', large: ['exportImagesDpi'], small: ['exportImage', 'extractImages'] },
      { label: 'Tạo PDF', small: ['docxToPdf', 'excelToPdf', 'imagesToPdf'] },
      { label: 'Tối ưu', large: ['compress'] },
    ],
  },
  {
    id: 'protect',
    label: 'Bảo vệ',
    hue: 'var(--red)',
    groups: [
      { label: 'Che thông tin', large: ['tool:redact'], small: [{ cmd: 'find', label: 'Tìm để che' }, 'tool:select'] },
      { label: 'Bảo mật', large: ['protect', 'sanitize'], small: ['unlock'] },
    ],
  },
  {
    id: 'view',
    label: 'Xem',
    hue: 'var(--faint)',
    groups: [
      { label: 'Thu phóng', large: ['zoom100'], small: ['zoomIn', 'zoomOut', 'fitPage', 'fitWidth'] },
      { label: 'Hiển thị', large: ['toggleThumbs', 'toggleSidebar'] },
      { label: 'Bảng bên', small: ['commentsPanel', 'outline', 'find', 'forms', 'news'] },
      { label: 'Giao diện', small: ['ribbonClassic', 'ribbonSimple', 'ribbonTabs', 'themeSystem', 'themeLight', 'themeDark'] },
    ],
  },
]);

// The 'file' tab: commands in the left column ('-' is a separator), then labelled sections of
// cards on the right. `hideDisabled` sections show only the commands that can run now.
export const BACKSTAGE = Object.freeze({
  nav: ['open', 'newBlank', 'closeDoc', '-', 'export', 'print', '-', 'quickTools', 'convertHub', '-', 'properties', 'chooseFont', '-', 'shortcuts'],
  sections: [
    { label: 'Tạo PDF từ', items: ['imagesToPdf', 'docxToPdf', 'excelToPdf'] },
    { label: 'Xuất thành', items: ['exportImage', 'exportImagesDpi', 'exportWord', 'exportExcel', 'exportText', 'exportHtml', 'extractImages'] },
    { label: 'Giao diện', items: ['themeSystem', 'themeLight', 'themeDark', 'ribbonClassic', 'ribbonSimple', 'ribbonTabs'] },
    { label: 'Tài khoản VET VIRAL', items: ['login', 'news', 'manageAccount', 'logout'], hideDisabled: true },
  ],
});

export const itemCommand = (item) => (typeof item === 'string' ? item : item.cmd);

export function itemLabel(item, fullLabel = '') {
  if (typeof item !== 'string' && item.label) return item.label;
  return SHORT_LABELS[itemCommand(item)] ?? String(fullLabel).replace(/…$/, '');
}

// Every command id of a tab, in display order (large buttons before small ones, group by group).
export function tabCommands(tab) {
  return (tab.groups ?? []).flatMap((g) => [...(g.large ?? []), ...(g.small ?? [])].map(itemCommand));
}

export function ribbonCommandIds(tabs = RIBBON_TABS) {
  return [...new Set(tabs.flatMap(tabCommands))];
}

// The tab to show for command `id`: the current one when it has the command, else the first tab
// that has it, else the current one.
export function tabForCommand(tabs, id, current) {
  const has = (t) => tabCommands(t).includes(id);
  if (has(tabs.find((t) => t.id === current) ?? {})) return current;
  return tabs.find(has)?.id ?? current;
}

// Splits small buttons into columns of `rows`.
export function columns(items, rows = 3) {
  const out = [];
  for (let i = 0; i < items.length; i += rows) out.push(items.slice(i, i + rows));
  return out;
}

// ---------- ribbon display mode ----------

// 'classic': large buttons and group labels; 'simple': one row; 'tabs': only the tab row, a tab
// opens its commands in a flyout.
export const RIBBON_MODES = Object.freeze(['classic', 'simple', 'tabs']);

export function sanitizeRibbonMode(value, fallback = 'classic') {
  return RIBBON_MODES.includes(value) ? value : fallback;
}

// Ctrl+F1 and double-clicking a tab: collapse to 'tabs', or restore the mode used before.
export function toggledRibbonMode(mode, previous = 'classic') {
  if (mode !== 'tabs') return 'tabs';
  return previous === 'simple' ? 'simple' : 'classic';
}

// ---------- quick access toolbar ----------

export const DEFAULT_QAT = Object.freeze(['open', 'export', 'print', 'undo', 'redo']);
export const QAT_LIMIT = 12;

// Commands offered in the quick access toolbar's customize menu; any ribbon button can be added
// from its context menu too.
export const QAT_CHOICES = Object.freeze([
  'open', 'newBlank', 'export', 'print', 'undo', 'redo', 'find', 'palette', 'quickTools', 'convertHub',
  'tool:select', 'tool:hand', 'tool:text', 'tool:highlight', 'signature', 'protect', 'zoomIn', 'zoomOut', 'fitWidth',
]);

// A stored list: unique known ids, at most `limit`. Anything but an array means "never customized".
export function sanitizeQat(list, isKnown = () => true, limit = QAT_LIMIT) {
  if (!Array.isArray(list)) return [...DEFAULT_QAT];
  const out = [];
  for (const id of list) {
    if (typeof id !== 'string' || out.includes(id) || !isKnown(id)) continue;
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

// Adds `id` (at the end) or removes it; a full toolbar stays unchanged.
export function toggleQat(list, id, limit = QAT_LIMIT) {
  if (list.includes(id)) return list.filter((x) => x !== id);
  return list.length >= limit ? list : [...list, id];
}

export function parseJson(text, fallback) {
  if (text === null || text === undefined) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// ---------- KeyTips ----------

export const KEYTIP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const KEYTIP_DIGITS = '123456789';

// Upper-case ASCII letters, digits and spaces of a Vietnamese label: "Chuyển đổi" → "CHUYEN DOI".
export function foldLabel(label) {
  return String(label ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

// One key per label, unique within the list: the first letter of the label when free, else the
// first letter of a later word, else any letter of the label, else any free key. '' when the
// alphabet runs out. Earlier labels win ties, so the result is stable for a given list.
export function assignKeyTips(labels, { alphabet = KEYTIP_LETTERS + KEYTIP_DIGITS, reserved = [] } = {}) {
  const used = new Set(reserved);
  const keys = labels.map(() => '');
  const words = labels.map((l) => foldLabel(l).split(' ').filter(Boolean));
  const take = (i, candidates) => {
    const key = candidates.find((c) => alphabet.includes(c) && !used.has(c));
    if (!key) return;
    keys[i] = key;
    used.add(key);
  };
  const passes = [
    (w) => w.slice(0, 1).map((x) => x[0]),
    (w) => w.slice(1).map((x) => x[0]),
    (w) => [...w.join('')],
    () => [...alphabet],
  ];
  for (const pass of passes) {
    words.forEach((w, i) => {
      if (!keys[i]) take(i, pass(w));
    });
  }
  return keys;
}

// ---------- platform ----------

// 'mac' | 'ios' | 'android' | 'windows' | 'chromeos' | 'linux' | 'other', from navigator fields.
// iPadOS reports itself as a Mac with touch points.
export function detectPlatform({ platform = '', userAgent = '', maxTouchPoints = 0 } = {}) {
  const both = `${platform} ${userAgent}`;
  if (/iPhone|iPad|iPod/i.test(both) || (/Mac/i.test(platform) && maxTouchPoints > 1)) return 'ios';
  if (/Mac/i.test(both)) return 'mac';
  if (/Android/i.test(both)) return 'android';
  if (/Win/i.test(both)) return 'windows';
  if (/CrOS|Chrome OS/i.test(both)) return 'chromeos';
  if (/Linux|X11/i.test(both)) return 'linux';
  return 'other';
}

export const isApplePlatform = (platform) => platform === 'mac' || platform === 'ios';

const MODIFIERS = ['Ctrl', 'Shift', 'Alt'];
const APPLE_MODIFIERS = { Ctrl: '⌘', Shift: '⇧', Alt: '⌥' };
const APPLE_ORDER = ['Alt', 'Shift', 'Ctrl']; // ⌥⇧⌘, as macOS menus write them
const APPLE_KEYS = { Del: '⌫', Delete: '⌫', Backspace: '⌫', Enter: '↩', Esc: '⎋' };

// 'Ctrl+Shift+Z' → ['Ctrl', 'Shift', 'Z']; 'Ctrl++' → ['Ctrl', '+'].
export function splitShortcut(key) {
  const parts = [];
  let rest = String(key ?? '');
  for (;;) {
    const mod = MODIFIERS.find((m) => rest.startsWith(`${m}+`) && rest.length > m.length + 1);
    if (!mod) break;
    parts.push(mod);
    rest = rest.slice(mod.length + 1);
  }
  if (rest) parts.push(rest);
  return parts;
}

// Shortcut text for the user's platform: 'Ctrl+Shift+Z' stays on Windows/Linux and becomes '⇧⌘Z'
// on Apple devices (the editor accepts ⌘ wherever it accepts Ctrl).
export function formatShortcut(key, platform) {
  const parts = splitShortcut(key);
  if (!parts.length || !isApplePlatform(platform)) return parts.join('+');
  const mods = parts.filter((p) => MODIFIERS.includes(p));
  const main = parts.filter((p) => !MODIFIERS.includes(p)).join('+');
  mods.sort((a, b) => APPLE_ORDER.indexOf(a) - APPLE_ORDER.indexOf(b));
  return mods.map((m) => APPLE_MODIFIERS[m]).join('') + (APPLE_KEYS[main] ?? main);
}
