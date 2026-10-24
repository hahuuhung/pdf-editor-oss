// Application Options and PDF Quality Enhancement Engine
// Manages preferences, high-DPI rendering, anti-aliasing, Bézier stroke smoothing,
// measurement conversions, and persistent storage.

import { el, icon, openDialog } from './dom.js';

export const STORAGE_KEY = 'pdfEditor.options';

export const DEFAULT_APP_OPTIONS = Object.freeze({
  // Quality & Rendering
  renderDpi: 150, // 96, 150, 300
  exportDpi: 300, // 150, 300, 600
  imageQuality: 0.92, // 0.75, 0.85, 0.92, 1.0 (lossless)
  antiAliasing: true,
  strokeSmoothing: true,
  redactionDpi: 300, // 150, 300, 600

  // Editing & Fonts
  defaultFont: 'DejaVuSans', // 'DejaVuSans', 'Helvetica', 'TimesRoman'
  defaultFontSize: 14, // 8 - 72
  defaultFontColor: '#000000',
  autoEmbedVietnamese: true,

  // View & Measurement
  unit: 'mm', // 'mm', 'cm', 'in', 'pt'
  snapEnabled: true,
  snapThreshold: 8, // 4 - 24 px
  continuousScroll: true,

  // Storage & Security
  autoBackup: true,
  backupIntervalSeconds: 30,
  sanitizeOnExport: false,
});

// In-memory fallback if localStorage is disabled or sandboxed
let memoryOptions = null;

// ---------- Pure Calculation & Conversion Helpers ----------

// Converts a length between 'pt', 'mm', 'cm', and 'in'.
export function unitConvert(value, fromUnit = 'pt', toUnit = 'pt', decimals = 2) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  if (fromUnit === toUnit) return v;

  // Convert from source to points (pt)
  let pt = v;
  switch (fromUnit) {
    case 'mm': pt = (v * 72) / 25.4; break;
    case 'cm': pt = (v * 72) / 2.54; break;
    case 'in': pt = v * 72; break;
    case 'pt': default: pt = v; break;
  }

  // Convert from points to target unit
  let target = pt;
  switch (toUnit) {
    case 'mm': target = (pt * 25.4) / 72; break;
    case 'cm': target = (pt * 2.54) / 72; break;
    case 'in': target = pt / 72; break;
    case 'pt': default: target = pt; break;
  }

  return decimals >= 0 ? Number(target.toFixed(decimals)) : target;
}

// Computes the scale multiplier for a given DPI relative to standard 72 DPI PDF space.
export function getQualityScale(dpi = 150) {
  const validDpi = Math.max(72, Math.min(Number(dpi) || 150, 1200));
  return validDpi / 72;
}

// Catmull-Rom Bézier spline smoothing for ink drawings and digital signatures.
// Turns discrete polyline points into smooth, calligraphy-grade curves.
// Supports both [x, y] pairs and {x, y} objects.
export function smoothStrokePoints(points, tension = 0.25) {
  if (!Array.isArray(points) || points.length <= 2) return points ? [...points] : [];

  const isArrayFormat = Array.isArray(points[0]);
  const pts = points.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }));

  const out = [{ ...pts[0] }];
  const len = pts.length;

  for (let i = 0; i < len - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i < len - 2 ? pts[i + 2] : p2;

    // Catmull-Rom to cubic Bézier control points
    const cp1x = p1.x + ((p2.x - p0.x) * tension) / 2;
    const cp1y = p1.y + ((p2.y - p0.y) * tension) / 2;
    const cp2x = p2.x - ((p3.x - p1.x) * tension) / 2;
    const cp2y = p2.y - ((p3.y - p1.y) * tension) / 2;

    // Subdivide curve into interpolated points
    const steps = Math.max(2, Math.min(8, Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 4)));
    for (let t = 1; t <= steps; t++) {
      const u = t / steps;
      const u2 = u * u;
      const u3 = u2 * u;
      const omt = 1 - u;
      const omt2 = omt * omt;
      const omt3 = omt2 * omt;

      const x = omt3 * p1.x + 3 * omt2 * u * cp1x + 3 * omt * u2 * cp2x + u3 * p2.x;
      const y = omt3 * p1.y + 3 * omt2 * u * cp1y + 3 * omt * u2 * cp2y + u3 * p2.y;
      out.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
    }
  }

  return isArrayFormat ? out.map((p) => [p.x, p.y]) : out;
}

// Sanitizes and clamps options safely to prevent corrupt settings.
export function sanitizeAppOptions(raw = {}) {
  const o = typeof raw === 'object' && raw !== null ? raw : {};

  const renderDpi = [96, 150, 300].includes(Number(o.renderDpi)) ? Number(o.renderDpi) : DEFAULT_APP_OPTIONS.renderDpi;
  const exportDpi = [150, 300, 600].includes(Number(o.exportDpi)) ? Number(o.exportDpi) : DEFAULT_APP_OPTIONS.exportDpi;
  const imageQuality = Math.max(0.5, Math.min(Number(o.imageQuality) || DEFAULT_APP_OPTIONS.imageQuality, 1.0));
  const redactionDpi = [150, 300, 600].includes(Number(o.redactionDpi)) ? Number(o.redactionDpi) : DEFAULT_APP_OPTIONS.redactionDpi;

  const defaultFont = ['DejaVuSans', 'Helvetica', 'TimesRoman'].includes(o.defaultFont) ? o.defaultFont : DEFAULT_APP_OPTIONS.defaultFont;
  const defaultFontSize = Math.max(8, Math.min(Number(o.defaultFontSize) || DEFAULT_APP_OPTIONS.defaultFontSize, 72));
  const defaultFontColor = /^#[0-9a-fA-F]{6}$/.test(o.defaultFontColor ?? '') ? o.defaultFontColor.toLowerCase() : DEFAULT_APP_OPTIONS.defaultFontColor;

  const unit = ['mm', 'cm', 'in', 'pt'].includes(o.unit) ? o.unit : DEFAULT_APP_OPTIONS.unit;
  const snapThreshold = Math.max(2, Math.min(Number(o.snapThreshold) || DEFAULT_APP_OPTIONS.snapThreshold, 32));
  const backupIntervalSeconds = Math.max(10, Math.min(Number(o.backupIntervalSeconds) || DEFAULT_APP_OPTIONS.backupIntervalSeconds, 300));

  return {
    renderDpi,
    exportDpi,
    imageQuality,
    antiAliasing: Boolean(o.antiAliasing ?? DEFAULT_APP_OPTIONS.antiAliasing),
    strokeSmoothing: Boolean(o.strokeSmoothing ?? DEFAULT_APP_OPTIONS.strokeSmoothing),
    redactionDpi,
    defaultFont,
    defaultFontSize,
    defaultFontColor,
    autoEmbedVietnamese: Boolean(o.autoEmbedVietnamese ?? DEFAULT_APP_OPTIONS.autoEmbedVietnamese),
    unit,
    snapEnabled: Boolean(o.snapEnabled ?? DEFAULT_APP_OPTIONS.snapEnabled),
    snapThreshold,
    continuousScroll: Boolean(o.continuousScroll ?? DEFAULT_APP_OPTIONS.continuousScroll),
    autoBackup: Boolean(o.autoBackup ?? DEFAULT_APP_OPTIONS.autoBackup),
    backupIntervalSeconds,
    sanitizeOnExport: Boolean(o.sanitizeOnExport ?? DEFAULT_APP_OPTIONS.sanitizeOnExport),
  };
}

// ---------- Storage & Persistence ----------

export function loadAppOptions() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return sanitizeAppOptions(parsed);
    }
  } catch {
    // LocalStorage blocked (private browsing, etc.)
  }
  return memoryOptions ? { ...memoryOptions } : { ...DEFAULT_APP_OPTIONS };
}

export function saveAppOptions(options) {
  const sanitized = sanitizeAppOptions(options);
  memoryOptions = { ...sanitized };
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // In-memory fallback
  }

  // Notify listeners across the app
  globalThis.dispatchEvent?.(new CustomEvent('app:options-changed', { detail: sanitized }));
  return sanitized;
}

export function resetAppOptions() {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
  memoryOptions = null;
  const defaults = { ...DEFAULT_APP_OPTIONS };
  globalThis.dispatchEvent?.(new CustomEvent('app:options-changed', { detail: defaults }));
  return defaults;
}

// Applies rendering optimizations to canvas 2D context.
export function applyContextQuality(ctx, options = {}) {
  if (!ctx) return;
  const opts = sanitizeAppOptions(options);
  ctx.imageSmoothingEnabled = opts.antiAliasing;
  ctx.imageSmoothingQuality = opts.antiAliasing ? 'high' : 'low';
}

// ---------- Modern Options / Preferences Dialog (White Theme) ----------

export function openOptionsDialog({ currentOptions, onSave, onReset } = {}) {
  let activeTab = 'quality';
  let draft = { ...(currentOptions || loadAppOptions()) };

  // Helper builder for switch toggles
  function toggleRow(label, desc, checked, onChange) {
    const input = el('input', { type: 'checkbox', checked });
    input.addEventListener('change', () => onChange(input.checked));
    const slider = el('span', { class: 'opt-slider' });
    const switchLabel = el('label', { class: 'opt-switch' }, input, slider);

    return el('div', { class: 'opt-item' },
      el('div', { class: 'opt-item-row' },
        el('div', {},
          el('div', { class: 'opt-item-label' }, label),
          desc ? el('div', { class: 'opt-item-desc' }, desc) : null,
        ),
        switchLabel,
      ),
    );
  }

  // Helper builder for select rows
  function selectRow(label, desc, value, optionsList, onChange) {
    const select = el('select', { class: 'opt-control-select' },
      ...optionsList.map(([val, text]) => el('option', { value: String(val), selected: String(val) === String(value) }, text))
    );
    select.addEventListener('change', () => onChange(select.value));

    return el('div', { class: 'opt-item' },
      el('div', { class: 'opt-item-row' },
        el('div', {},
          el('div', { class: 'opt-item-label' }, label),
          desc ? el('div', { class: 'opt-item-desc' }, desc) : null,
        ),
        select,
      ),
    );
  }

  // --- TAB 1: Chất lượng & Kết xuất (Quality & Rendering) ---
  const panelQuality = el('div', { class: 'opt-panel' },
    el('div', { class: 'opt-section-header' },
      el('div', { class: 'opt-section-title' }, 'Độ phân giải & Hiển thị màn hình'),
      el('div', { class: 'opt-section-desc' }, 'Kiểm soát độ nét và khử răng cưa khi đọc và chỉnh sửa PDF.'),
    ),
    selectRow(
      'Độ phân giải màn hình (Render DPI)',
      '150 DPI là chuẩn nét cao; 300 DPI tối ưu cho màn hình Retina/4K.',
      draft.renderDpi,
      [
        [96, '96 DPI (Tiết kiệm bộ nhớ)'],
        [150, '150 DPI (Sắc nét - Khuyên dùng)'],
        [300, '300 DPI (Siêu nét - Retina / 4K)'],
      ],
      (v) => (draft.renderDpi = Number(v)),
    ),
    toggleRow(
      'Khử răng cưa văn bản & vector (Anti-Aliasing)',
      'Làm mịn nét chữ và đường cong hình học khi thu phóng.',
      draft.antiAliasing,
      (c) => (draft.antiAliasing = c),
    ),
    toggleRow(
      'Làm mượt nét vẽ & chữ ký (Bézier Stroke Smoothing)',
      'Tự động làm trơn mượt các nét vẽ tự do bằng thuật toán Catmull-Rom spline.',
      draft.strokeSmoothing,
      (c) => (draft.strokeSmoothing = c),
    ),
    el('div', { class: 'opt-section-header', style: 'margin-top: 10px;' },
      el('div', { class: 'opt-section-title' }, 'Chất lượng xuất file & In ấn (Export Engine)'),
      el('div', { class: 'opt-section-desc' }, 'Chất lượng nén hình ảnh và độ phân giải của tài liệu xuất ra.'),
    ),
    selectRow(
      'Độ phân giải xuất bản in (Export DPI)',
      'Mức 300 DPI là tiêu chuẩn công nghiệp cho in ấn sắc nét.',
      draft.exportDpi,
      [
        [150, '150 DPI (File nhẹ)'],
        [300, '300 DPI (In ấn chất lượng cao)'],
        [600, '600 DPI (Lưu trữ ấn phẩm chuyên nghiệp)'],
      ],
      (v) => (draft.exportDpi = Number(v)),
    ),
    selectRow(
      'Chất lượng hình ảnh nhúng',
      'Tỷ lệ nén JPEG/PNG khi chèn ảnh vào tài liệu.',
      draft.imageQuality,
      [
        [0.75, 'Trung bình - 75% (Dung lượng nhỏ)'],
        [0.85, 'Cao - 85% (Cân bằng)'],
        [0.92, 'Rất cao - 92% (Khuyên dùng)'],
        [1.0, 'Tối đa - 100% (Không nén)'],
      ],
      (v) => (draft.imageQuality = Number(v)),
    ),
    selectRow(
      'Độ phân giải che nội dung (Redaction DPI)',
      'Độ sắc nét khi làm phẳng và che vĩnh viễn thông tin bảo mật.',
      draft.redactionDpi,
      [
        [150, '150 DPI'],
        [300, '300 DPI (Chuẩn in ấn)'],
        [600, '600 DPI'],
      ],
      (v) => (draft.redactionDpi = Number(v)),
    ),
    el('div', { class: 'opt-callout' },
      '💡 Mẹo: Thiết lập 300 DPI mang lại độ sắc nét hoàn hảo khi in hoặc gửi hợp đồng, tự động giải phóng RAM ngay sau khi hoàn tất tác vụ xuất.',
    ),
  );

  // --- TAB 2: Soạn thảo & Phông chữ (Editing & Fonts) ---
  const panelFonts = el('div', { class: 'opt-panel hidden' },
    el('div', { class: 'opt-section-header' },
      el('div', { class: 'opt-section-title' }, 'Phông chữ mặc định'),
      el('div', { class: 'opt-section-desc' }, 'Cấu hình mặc định khi thêm văn bản mới vào tài liệu PDF.'),
    ),
    selectRow(
      'Phông chữ mặc định',
      'DejaVu Sans hỗ trợ đầy đủ tiếng Việt có dấu (Unicode dựng sẵn).',
      draft.defaultFont,
      [
        ['DejaVuSans', 'DejaVu Sans (Chuẩn tiếng Việt)'],
        ['Helvetica', 'Helvetica / Arial'],
        ['TimesRoman', 'Times New Roman'],
      ],
      (v) => (draft.defaultFont = v),
    ),
    selectRow(
      'Cỡ chữ mặc định',
      'Kích thước phông chữ ban đầu cho hộp văn bản mới.',
      draft.defaultFontSize,
      [
        [10, '10 pt (Nhỏ)'],
        [12, '12 pt (Tiêu chuẩn tài liệu)'],
        [14, '14 pt (Dễ đọc - Mặc định)'],
        [16, '16 pt (Tiêu đề phụ)'],
        [18, '18 pt (Tiêu đề)'],
      ],
      (v) => (draft.defaultFontSize = Number(v)),
    ),
    toggleRow(
      'Tự động nhúng phông chữ tiếng Việt Unicode',
      'Tự động nạp và nhúng tập con (subset) DejaVu Sans khi phát hiện chữ có dấu.',
      draft.autoEmbedVietnamese,
      (c) => (draft.autoEmbedVietnamese = c),
    ),
  );

  // --- TAB 3: Hiển thị & Bắt dính (View & Measurement) ---
  const panelView = el('div', { class: 'opt-panel hidden' },
    el('div', { class: 'opt-section-header' },
      el('div', { class: 'opt-section-title' }, 'Đơn vị đo lường & Căn lề'),
      el('div', { class: 'opt-section-desc' }, 'Quy định đơn vị hiển thị kích thước trang và thước đo.'),
    ),
    selectRow(
      'Đơn vị đo lường',
      'Đơn vị hiển thị kích thước trang, lề in và hộp văn bản.',
      draft.unit,
      [
        ['mm', 'Milimét (mm)'],
        ['cm', 'Centimét (cm)'],
        ['in', 'Inch (in)'],
        ['pt', 'Điểm (pt)'],
      ],
      (v) => (draft.unit = v),
    ),
    toggleRow(
      'Bật bắt dính thông minh (Smart Snapping)',
      'Tự động căn thẳng hàng với các đối tượng khác và mép trang khi kéo thả.',
      draft.snapEnabled,
      (c) => (draft.snapEnabled = c),
    ),
    selectRow(
      'Khoảng cách bắt dính (Snap Threshold)',
      'Độ nhạy bắt dính khi con trỏ di chuyển đến gần đường gióng.',
      draft.snapThreshold,
      [
        [4, '4 px (Nhẹ)'],
        [8, '8 px (Tiêu chuẩn)'],
        [16, '16 px (Mạnh)'],
      ],
      (v) => (draft.snapThreshold = Number(v)),
    ),
    toggleRow(
      'Cuộn trang liên tục (Continuous Scroll)',
      'Hiển thị các trang nối tiếp nhau theo chiều dọc.',
      draft.continuousScroll,
      (c) => (draft.continuousScroll = c),
    ),
  );

  // --- TAB 4: Bảo mật & Sao lưu (Storage & Security) ---
  const panelSecurity = el('div', { class: 'opt-panel hidden' },
    el('div', { class: 'opt-section-header' },
      el('div', { class: 'opt-section-title' }, 'Tự động sao lưu & Phục hồi'),
      el('div', { class: 'opt-section-desc' }, 'Lưu bản sao lưu phục hồi để tránh mất dữ liệu khi trình duyệt bị đóng.'),
    ),
    toggleRow(
      'Tự động sao lưu bản nháp',
      'Lưu tạm thời bản chỉnh sửa vào bộ nhớ trình duyệt để khôi phục khi cần.',
      draft.autoBackup,
      (c) => (draft.autoBackup = c),
    ),
    selectRow(
      'Tần suất sao lưu',
      'Chu kỳ lưu bản sao nháp tự động.',
      draft.backupIntervalSeconds,
      [
        [15, '15 giây'],
        [30, '30 giây (Khuyên dùng)'],
        [60, '1 phút'],
      ],
      (v) => (draft.backupIntervalSeconds = Number(v)),
    ),
    el('div', { class: 'opt-section-header', style: 'margin-top: 10px;' },
      el('div', { class: 'opt-section-title' }, 'Bảo mật tài liệu khi xuất'),
      el('div', { class: 'opt-section-desc' }, 'Xóa thông tin ẩn và metadata khỏi tệp PDF khi lưu.'),
    ),
    toggleRow(
      'Tự động xóa thông tin ẩn (Sanitize Metadata)',
      'Gỡ bỏ tác giả, lịch sử chỉnh sửa và dữ liệu nhúng ẩn mỗi khi bấm Xuất PDF.',
      draft.sanitizeOnExport,
      (c) => (draft.sanitizeOnExport = c),
    ),
  );

  // Tab buttons
  const tabs = [
    { id: 'quality', label: 'Chất lượng & Kết xuất', iconName: 'zap', panel: panelQuality },
    { id: 'fonts', label: 'Soạn thảo & Phông chữ', iconName: 'text', panel: panelFonts },
    { id: 'view', label: 'Hiển thị & Bắt dính', iconName: 'fitWidth', panel: panelView },
    { id: 'security', label: 'Bảo mật & Sao lưu', iconName: 'shield', panel: panelSecurity },
  ];

  const tabButtons = tabs.map((t) => {
    const btn = el('button', {
      type: 'button',
      class: `opt-tab-btn ${t.id === activeTab ? 'active' : ''}`,
      onclick: () => switchTab(t.id),
    },
      el('span', { class: 'opt-tab-icon' }, icon(t.iconName, 16)),
      el('span', {}, t.label),
    );
    return { id: t.id, btn, panel: t.panel };
  });

  function switchTab(targetId) {
    activeTab = targetId;
    tabButtons.forEach((t) => {
      t.btn.classList.toggle('active', t.id === targetId);
      t.panel.classList.toggle('hidden', t.id !== targetId);
    });
  }

  const sidebar = el('div', { class: 'opt-sidebar' }, ...tabButtons.map((t) => t.btn));
  const content = el('div', { class: 'opt-content' }, panelQuality, panelFonts, panelView, panelSecurity);
  const container = el('div', { class: 'opt-container' }, sidebar, content);

  const handleSave = () => {
    const saved = saveAppOptions(draft);
    onSave?.(saved);
    return true;
  };

  const handleReset = () => {
    if (confirm('Khôi phục toàn bộ cài đặt về giá trị mặc định ban đầu?')) {
      const defaults = resetAppOptions();
      draft = { ...defaults };
      onReset?.(defaults);
      return true;
    }
    return false;
  };

  openDialog({
    title: 'Tùy chọn & Cài đặt hệ thống (Preferences)',
    subtitle: 'Tối ưu chất lượng kết xuất, độ phân giải in ấn và trải nghiệm biên tập.',
    icon: 'settings',
    width: 780,
    body: container,
    actions: [
      { label: 'Khôi phục mặc định', danger: true, run: handleReset },
      { label: 'Hủy bỏ', run: () => true },
      { label: 'Lưu thay đổi', primary: true, run: handleSave },
    ],
  });
}
