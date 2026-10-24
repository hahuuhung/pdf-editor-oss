// Advanced Print Suite for PDF Editor OSS
// Handles live print preview, N-up page imposition, custom margins, paper sizing,
// grayscale eco mode, watermarks, vector PDF imposition and browser high-res native printing.

import { el, icon, openDialog } from './dom.js';
import { parsePageRange } from './pages.js';

export const DEFAULT_PRINT_OPTIONS = Object.freeze({
  copies: 1,
  collate: true,
  pageRange: 'all', // 'all', 'current', 'custom'
  customPages: '',
  paperSize: 'a4', // 'a4', 'letter', 'a3', 'legal', 'a5'
  orientation: 'auto', // 'auto', 'portrait', 'landscape'
  nUp: 1, // 1, 2, 4, 6
  scaleMode: 'fit', // 'fit', 'actual', 'custom'
  customScale: 100,
  margin: 'normal', // 'none', 'minimum', 'normal', 'wide'
  colorMode: 'color', // 'color', 'grayscale'
  includeAnnotations: true,
  watermark: '',
  watermarkAngle: -45,
  watermarkOpacity: 0.15,
});

export const PAPER_DIMENSIONS = Object.freeze({
  a4: { name: 'A4', width: 595.28, height: 841.89, label: 'A4 (210 × 297 mm)' },
  letter: { name: 'Letter', width: 612, height: 792, label: 'Letter (8.5 × 11 in)' },
  a3: { name: 'A3', width: 841.89, height: 1190.55, label: 'A3 (297 × 420 mm)' },
  legal: { name: 'Legal', width: 612, height: 1008, label: 'Legal (8.5 × 14 in)' },
  a5: { name: 'A5', width: 419.53, height: 595.28, label: 'A5 (148 × 210 mm)' },
});

export const MARGIN_VALUES = Object.freeze({
  none: 0,
  minimum: 14.17, // ~5mm
  normal: 28.35,  // ~10mm
  wide: 42.52,    // ~15mm
});

// ---------- Pure layout & calculation helpers ----------

// Validates and resolves the list of 0-based page indices to print.
export function resolvePrintPages(options, totalPages, currentPage = 0) {
  if (totalPages <= 0) return [];
  const range = options?.pageRange ?? 'all';
  if (range === 'current') {
    const cur = Math.max(0, Math.min(currentPage, totalPages - 1));
    return [cur];
  }
  if (range === 'custom') {
    const text = String(options.customPages ?? '').trim();
    if (!text) return Array.from({ length: totalPages }, (_, i) => i);
    try {
      return parsePageRange(text, totalPages);
    } catch {
      return Array.from({ length: totalPages }, (_, i) => i);
    }
  }
  return Array.from({ length: totalPages }, (_, i) => i);
}

// Checks if a custom page range string is valid without throwing.
export function validateCustomRange(text, totalPages) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { valid: false, message: 'Nhập dải trang, ví dụ: 1-3, 5' };
  try {
    const pages = parsePageRange(trimmed, totalPages);
    return { valid: true, pages, count: pages.length };
  } catch (err) {
    return { valid: false, message: err.message };
  }
}

// Gets paper width & height in points based on paper size and orientation.
export function getSheetDimensions(paperSizeKey = 'a4', orientation = 'auto', samplePageSize = null) {
  const base = PAPER_DIMENSIONS[paperSizeKey] ?? PAPER_DIMENSIONS.a4;
  let w = base.width;
  let h = base.height;

  let effectiveOrientation = orientation;
  if (orientation === 'auto') {
    if (samplePageSize && samplePageSize.width > samplePageSize.height) {
      effectiveOrientation = 'landscape';
    } else {
      effectiveOrientation = 'portrait';
    }
  }

  if (effectiveOrientation === 'landscape') {
    return { width: Math.max(w, h), height: Math.min(w, h), orientation: 'landscape' };
  }
  return { width: Math.min(w, h), height: Math.max(w, h), orientation: 'portrait' };
}

// Computes the N-up grid and slots for each sheet.
export function computeNUpLayout({ nUp = 1, sheetWidth, sheetHeight, marginPt = 0, pagesCount = 1 }) {
  const n = [1, 2, 4, 6].includes(Number(nUp)) ? Number(nUp) : 1;
  let rows = 1;
  let cols = 1;

  if (n === 2) {
    if (sheetWidth >= sheetHeight) {
      rows = 1;
      cols = 2;
    } else {
      rows = 2;
      cols = 1;
    }
  } else if (n === 4) {
    rows = 2;
    cols = 2;
  } else if (n === 6) {
    if (sheetWidth >= sheetHeight) {
      rows = 2;
      cols = 3;
    } else {
      rows = 3;
      cols = 2;
    }
  }

  const safeMargin = Math.max(0, marginPt);
  const availW = Math.max(20, sheetWidth - 2 * safeMargin);
  const availH = Math.max(20, sheetHeight - 2 * safeMargin);
  const slotW = availW / cols;
  const slotH = availH / rows;

  const sheetsCount = Math.max(1, Math.ceil(pagesCount / n));

  // Function to get slot rectangle (top-left based for canvas / screen)
  const getSlot = (slotIndex) => {
    const idx = slotIndex % n;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    return {
      x: safeMargin + c * slotW,
      y: safeMargin + r * slotH,
      width: slotW,
      height: slotH,
    };
  };

  return {
    nUp: n,
    rows,
    cols,
    slotW,
    slotH,
    marginPt: safeMargin,
    sheetWidth,
    sheetHeight,
    sheetsCount,
    getSlot,
  };
}

// Calculates scaling and centering of a page inside a designated slot.
export function computePageFit({ pageWidth, pageHeight, slotW, slotH, scaleMode = 'fit', customScale = 100 }) {
  const pw = Math.max(1, pageWidth);
  const ph = Math.max(1, pageHeight);
  let scale = 1;

  if (scaleMode === 'actual') {
    scale = 1;
  } else if (scaleMode === 'custom') {
    const s = Math.max(25, Math.min(customScale || 100, 400));
    scale = s / 100;
  } else {
    // 'fit'
    scale = Math.min(slotW / pw, slotH / ph);
  }

  const drawW = pw * scale;
  const drawH = ph * scale;
  const offsetX = (slotW - drawW) / 2;
  const offsetY = (slotH - drawH) / 2;

  return { scale, drawW, drawH, offsetX, offsetY };
}

// Clamps and normalizes print options.
export function sanitizePrintOptions(options = {}, totalPages = 1, currentPage = 0) {
  const paperSize = PAPER_DIMENSIONS[options.paperSize] ? options.paperSize : 'a4';
  const orientation = ['auto', 'portrait', 'landscape'].includes(options.orientation) ? options.orientation : 'auto';
  const nUp = [1, 2, 4, 6].includes(Number(options.nUp)) ? Number(options.nUp) : 1;
  const scaleMode = ['fit', 'actual', 'custom'].includes(options.scaleMode) ? options.scaleMode : 'fit';
  const customScale = Math.max(25, Math.min(Number(options.customScale) || 100, 400));
  const margin = MARGIN_VALUES[options.margin] !== undefined ? options.margin : 'normal';
  const colorMode = ['color', 'grayscale'].includes(options.colorMode) ? options.colorMode : 'color';
  const copies = Math.max(1, Math.min(Number(options.copies) || 1, 99));

  return {
    ...DEFAULT_PRINT_OPTIONS,
    ...options,
    copies,
    paperSize,
    orientation,
    nUp,
    scaleMode,
    customScale,
    margin,
    colorMode,
    includeAnnotations: Boolean(options.includeAnnotations ?? true),
    watermark: String(options.watermark ?? '').trim(),
    watermarkAngle: Number(options.watermarkAngle) || -45,
    watermarkOpacity: Math.max(0.05, Math.min(Number(options.watermarkOpacity) || 0.15, 0.8)),
  };
}

// ---------- PDFLib Vector Imposition Engine ----------

export async function generatePrintPdf({
  pdfBytes,
  options,
  totalPages,
  currentPage,
  pageSizes = [],
}) {
  if (typeof PDFLib === 'undefined') {
    throw new Error('PDFLib chưa được nạp. Không thể tạo bản in vector.');
  }

  const opt = sanitizePrintOptions(options, totalPages, currentPage);
  const printPageIndices = resolvePrintPages(opt, totalPages, currentPage);
  if (!printPageIndices.length) throw new Error('Không có trang nào được chọn để in.');

  const sampleSize = pageSizes[printPageIndices[0]] ?? { width: 595.28, height: 841.89 };
  const sheetDim = getSheetDimensions(opt.paperSize, opt.orientation, sampleSize);
  const marginPt = MARGIN_VALUES[opt.margin] ?? MARGIN_VALUES.normal;

  const layout = computeNUpLayout({
    nUp: opt.nUp,
    sheetWidth: sheetDim.width,
    sheetHeight: sheetDim.height,
    marginPt,
    pagesCount: printPageIndices.length,
  });

  const outDoc = await PDFLib.PDFDocument.create();
  const srcDoc = await PDFLib.PDFDocument.load(pdfBytes);

  // Embed source pages into the new document
  const embeddedPages = await outDoc.embedPdf(srcDoc, printPageIndices);

  const font = opt.watermark ? await outDoc.embedFont(PDFLib.StandardFonts.HelveticaBold) : null;

  for (let s = 0; s < layout.sheetsCount; s++) {
    const sheet = outDoc.addPage([layout.sheetWidth, layout.sheetHeight]);

    // Place N-up pages onto this sheet
    for (let slotIdx = 0; slotIdx < layout.nUp; slotIdx++) {
      const pageIndexInBatch = s * layout.nUp + slotIdx;
      if (pageIndexInBatch >= embeddedPages.length) break;

      const embedded = embeddedPages[pageIndexInBatch];
      const origPageIndex = printPageIndices[pageIndexInBatch];
      const origSize = pageSizes[origPageIndex] ?? { width: embedded.width, height: embedded.height };

      const slot = layout.getSlot(slotIdx);
      const fit = computePageFit({
        pageWidth: origSize.width,
        pageHeight: origSize.height,
        slotW: slot.width,
        slotH: slot.height,
        scaleMode: opt.scaleMode,
        customScale: opt.customScale,
      });

      // PDF coordinate system origin (0, 0) is at Bottom-Left:
      const pdfX = slot.x + fit.offsetX;
      const pdfY = layout.sheetHeight - (slot.y + fit.offsetY + fit.drawH);

      sheet.drawPage(embedded, {
        x: pdfX,
        y: pdfY,
        width: fit.drawW,
        height: fit.drawH,
      });
    }

    // Draw Watermark if specified
    if (opt.watermark && font) {
      const fontSize = Math.min(layout.sheetWidth, layout.sheetHeight) * 0.12;
      const textWidth = font.widthOfTextAtSize(opt.watermark, fontSize);
      const textHeight = font.heightAtSize(fontSize);

      const rad = (opt.watermarkAngle * Math.PI) / 180;
      sheet.drawText(opt.watermark, {
        x: layout.sheetWidth / 2 - (textWidth / 2) * Math.cos(rad) + (textHeight / 2) * Math.sin(rad),
        y: layout.sheetHeight / 2 - (textWidth / 2) * Math.sin(rad) - (textHeight / 2) * Math.cos(rad),
        size: fontSize,
        font,
        color: PDFLib.rgb(0.5, 0.5, 0.5),
        opacity: opt.watermarkOpacity,
        rotate: PDFLib.degrees(opt.watermarkAngle),
      });
    }
  }

  return outDoc.save();
}

// ---------- Browser High-Resolution Direct Print Engine ----------

export function printBlobThroughFrame(blobUrl, { title = 'In tài liệu' } = {}) {
  return new Promise((resolve) => {
    const frame = el('iframe', {
      class: 'print-frame',
      src: blobUrl,
      title,
    });

    let handled = false;
    const cleanup = () => {
      if (handled) return;
      handled = true;
      setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(blobUrl);
      }, 60000);
      resolve(true);
    };

    frame.addEventListener('load', () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        cleanup();
      } catch {
        // Fallback for sandboxed environments or browsers blocking iframe printing
        window.open(blobUrl, '_blank', 'noopener');
        cleanup();
      }
    });

    frame.addEventListener('error', () => {
      window.open(blobUrl, '_blank', 'noopener');
      cleanup();
    });

    document.body.append(frame);
    // Safety timeout in case load never fires
    setTimeout(() => {
      if (!handled) {
        window.open(blobUrl, '_blank', 'noopener');
        cleanup();
      }
    }, 5000);
  });
}

// ---------- Live Print Preview Rendering ----------

export async function renderLivePreview({
  stageEl,
  options,
  sheetIndex = 0,
  totalPages = 1,
  currentPage = 0,
  pageSizes = [],
  renderPageCanvasFn, // async (pageIndex, scale) => HTMLCanvasElement
}) {
  if (!stageEl) return { totalSheets: 1 };

  const opt = sanitizePrintOptions(options, totalPages, currentPage);
  const printPages = resolvePrintPages(opt, totalPages, currentPage);
  const sampleSize = pageSizes[printPages[0]] ?? { width: 595.28, height: 841.89 };
  const sheetDim = getSheetDimensions(opt.paperSize, opt.orientation, sampleSize);
  const marginPt = MARGIN_VALUES[opt.margin] ?? MARGIN_VALUES.normal;

  const layout = computeNUpLayout({
    nUp: opt.nUp,
    sheetWidth: sheetDim.width,
    sheetHeight: sheetDim.height,
    marginPt,
    pagesCount: printPages.length,
  });

  const clampedSheet = Math.max(0, Math.min(sheetIndex, layout.sheetsCount - 1));

  // Determine container fit scale
  const stageRect = stageEl.getBoundingClientRect();
  const maxW = Math.max(200, stageRect.width - 32);
  const maxH = Math.max(200, stageRect.height - 32);
  const previewScale = Math.min(maxW / layout.sheetWidth, maxH / layout.sheetHeight);

  // Setup preview canvas
  let canvas = stageEl.querySelector('.print-paper-canvas');
  if (!canvas) {
    canvas = el('canvas', { class: 'print-paper-canvas' });
    stageEl.replaceChildren(canvas);
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetW = Math.round(layout.sheetWidth * previewScale);
  const targetH = Math.round(layout.sheetHeight * previewScale);

  canvas.width = targetW * dpr;
  canvas.height = targetH * dpr;
  canvas.style.width = `${targetW}px`;
  canvas.style.height = `${targetH}px`;

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr * previewScale, dpr * previewScale);

  // 1. Draw Paper background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, layout.sheetWidth, layout.sheetHeight);

  // 2. Draw Margins guide (subtle dashed line)
  if (layout.marginPt > 0) {
    ctx.strokeStyle = '#e2e8f0';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(layout.marginPt, layout.marginPt, layout.sheetWidth - 2 * layout.marginPt, layout.sheetHeight - 2 * layout.marginPt);
    ctx.setLineDash([]);
  }

  // 3. Render pages onto the sheet slots
  if (renderPageCanvasFn) {
    for (let slotIdx = 0; slotIdx < layout.nUp; slotIdx++) {
      const pageIndexInBatch = clampedSheet * layout.nUp + slotIdx;
      if (pageIndexInBatch >= printPages.length) break;

      const pageIdx = printPages[pageIndexInBatch];
      const slot = layout.getSlot(slotIdx);
      const pageSize = pageSizes[pageIdx] ?? { width: 595.28, height: 841.89 };

      const fit = computePageFit({
        pageWidth: pageSize.width,
        pageHeight: pageSize.height,
        slotW: slot.width,
        slotH: slot.height,
        scaleMode: opt.scaleMode,
        customScale: opt.customScale,
      });

      const drawX = slot.x + fit.offsetX;
      const drawY = slot.y + fit.offsetY;

      // Draw subtle slot separator if multiple pages
      if (layout.nUp > 1) {
        ctx.strokeStyle = '#f1f5f9';
        ctx.strokeRect(slot.x, slot.y, slot.width, slot.height);
      }

      try {
        // Render at fit scale
        const renderScale = (fit.drawW / pageSize.width) * previewScale * dpr;
        const pageCanvas = await renderPageCanvasFn(pageIdx, Math.max(0.5, renderScale));
        if (pageCanvas) {
          ctx.save();
          if (opt.colorMode === 'grayscale') {
            ctx.filter = 'grayscale(100%)';
          }
          ctx.drawImage(pageCanvas, drawX, drawY, fit.drawW, fit.drawH);
          ctx.restore();
        }
      } catch {
        // Fallback placeholder box
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(drawX, drawY, fit.drawW, fit.drawH);
        ctx.strokeStyle = '#cbd5e1';
        ctx.strokeRect(drawX, drawY, fit.drawW, fit.drawH);
        ctx.fillStyle = '#64748b';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Trang ${pageIdx + 1}`, drawX + fit.drawW / 2, drawY + fit.drawH / 2);
      }
    }
  }

  // 4. Draw Watermark if specified
  if (opt.watermark) {
    ctx.save();
    ctx.translate(layout.sheetWidth / 2, layout.sheetHeight / 2);
    ctx.rotate((opt.watermarkAngle * Math.PI) / 180);
    ctx.fillStyle = `rgba(100, 116, 139, ${opt.watermarkOpacity})`;
    const fontSize = Math.min(layout.sheetWidth, layout.sheetHeight) * 0.12;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opt.watermark, 0, 0);
    ctx.restore();
  }

  ctx.restore();

  return {
    totalSheets: layout.sheetsCount,
    currentSheet: clampedSheet,
    dimensions: sheetDim,
    layout,
  };
}

// ---------- Modern Print Dialog (White Theme) ----------

export function openPrintDialog({
  state,
  buildOutput,
  renderOutputPage,
  onStatus,
}) {
  if (!state.doc || !state.pageCount) {
    alert('Vui lòng mở tài liệu PDF trước khi in.');
    return;
  }

  const totalPages = state.pageCount;
  const currentPage = state.current ?? 0;
  let currentSheetIndex = 0;
  let totalSheets = 1;

  // Working state options
  const options = {
    ...DEFAULT_PRINT_OPTIONS,
    customPages: `${currentPage + 1}`,
  };

  // Cached page renders for preview performance
  const pageCache = new Map();
  const getPageCanvas = async (pageIdx, scale) => {
    const key = `${pageIdx}@${scale.toFixed(2)}@${options.includeAnnotations}`;
    if (!pageCache.has(key)) {
      // Build output with or without annotations
      const bytes = options.includeAnnotations ? await buildOutput() : state.pdfBytes;
      const c = await renderOutputPage(bytes, pageIdx, scale);
      pageCache.set(key, c);
    }
    return pageCache.get(key);
  };

  // Preview elements
  const stageEl = el('div', { class: 'print-preview-stage' });
  const sheetLabel = el('span', { class: 'print-preview-badge' }, 'Tờ 1 / 1');
  const sizeBadge = el('span', { class: 'print-preview-badge' }, 'A4');
  const prevBtn = el('button', { type: 'button', disabled: true, title: 'Tờ trước', onclick: () => switchSheet(-1) }, icon('prev', 14));
  const nextBtn = el('button', { type: 'button', disabled: true, title: 'Tờ kế tiếp', onclick: () => switchSheet(1) }, icon('next', 14));

  const previewToolbar = el(
    'div',
    { class: 'print-preview-toolbar' },
    prevBtn,
    sheetLabel,
    nextBtn,
    sizeBadge,
  );

  const previewPane = el('div', { class: 'print-preview-pane' }, stageEl, previewToolbar);

  // Settings form elements
  const copiesInput = el('input', { type: 'number', class: 'print-input', min: '1', max: '99', value: '1', style: 'width: 80px;' });

  // Page range radio group
  const rangeAll = el('input', { type: 'radio', name: 'print-range', value: 'all', checked: true });
  const rangeCur = el('input', { type: 'radio', name: 'print-range', value: 'current' });
  const rangeCus = el('input', { type: 'radio', name: 'print-range', value: 'custom' });
  const customPagesInput = el('input', {
    type: 'text',
    class: 'print-input',
    placeholder: 'Ví dụ: 1-3, 5, 8-',
    value: options.customPages,
    disabled: true,
  });
  const customStatus = el('div', { class: 'print-page-status ok' }, `Tất cả ${totalPages} trang`);

  // Paper & Orientation
  const paperSelect = el('select', { class: 'print-select' },
    ...Object.entries(PAPER_DIMENSIONS).map(([k, v]) => el('option', { value: k, selected: k === 'a4' }, v.label))
  );

  const orientAuto = el('button', { type: 'button', class: 'print-segmented-btn active', onclick: () => setOrientation('auto') }, 'Tự động');
  const orientPort = el('button', { type: 'button', class: 'print-segmented-btn', onclick: () => setOrientation('portrait') }, 'Chiều dọc');
  const orientLand = el('button', { type: 'button', class: 'print-segmented-btn', onclick: () => setOrientation('landscape') }, 'Chiều ngang');
  const orientSegmented = el('div', { class: 'print-segmented' }, orientAuto, orientPort, orientLand);

  // N-up Grid buttons
  const nupButtons = [1, 2, 4, 6].map((n) => {
    const btn = el('button', {
      type: 'button',
      class: `print-nup-btn ${n === 1 ? 'active' : ''}`,
      onclick: () => setNUp(n),
    },
      el('div', { class: `print-nup-icon n${n}` }, ...Array.from({ length: n }, () => el('div', { class: 'print-nup-cell' }))),
      el('span', { class: 'print-nup-label' }, `${n} trang`),
    );
    return btn;
  });
  const nupGrid = el('div', { class: 'print-nup-grid' }, ...nupButtons);

  // Scale & Margins
  const scaleSelect = el('select', { class: 'print-select' },
    el('option', { value: 'fit', selected: true }, 'Vừa trang in (Fit)'),
    el('option', { value: 'actual' }, 'Kích thước thật (100%)'),
    el('option', { value: 'custom' }, 'Tùy chỉnh tỷ lệ (%)'),
  );
  const customScaleInput = el('input', {
    type: 'number',
    class: 'print-input',
    min: '25',
    max: '400',
    value: '100',
    style: 'width: 80px; display: none;',
  });

  const marginSelect = el('select', { class: 'print-select' },
    el('option', { value: 'none' }, 'Không lề (0 mm)'),
    el('option', { value: 'minimum' }, 'Lề hẹp (5 mm)'),
    el('option', { value: 'normal', selected: true }, 'Bình thường (10 mm)'),
    el('option', { value: 'wide' }, 'Lề rộng (15 mm)'),
  );

  // Advanced toggles
  const annotCheckbox = el('input', { type: 'checkbox', checked: true });
  const colorModeColor = el('input', { type: 'radio', name: 'print-color', value: 'color', checked: true });
  const colorModeGray = el('input', { type: 'radio', name: 'print-color', value: 'grayscale' });

  // Watermark
  const watermarkCheckbox = el('input', { type: 'checkbox', checked: false });
  const watermarkTextInput = el('input', {
    type: 'text',
    class: 'print-input',
    placeholder: 'Nội dung (ví dụ: BẢN NHÁP, MẬT, SAO Y)',
    value: 'BẢN NHÁP',
  });
  const watermarkBox = el('div', { class: 'print-watermark-options', style: 'display: none;' },
    watermarkTextInput,
    el('div', { class: 'print-row', style: 'margin-top: 4px; font-size: 12px; color: var(--muted);' },
      'Độ mờ: 15% · Góc xoay: -45°'
    ),
  );

  // Assemble Settings Sections
  const settingsPane = el('div', { class: 'print-settings-pane' },
    // Copies Section
    el('div', { class: 'print-section' },
      el('div', { class: 'print-section-title' }, 'Bản in & Số lượng'),
      el('div', { class: 'print-row' },
        el('label', {}, 'Số bản sao:'),
        copiesInput,
      ),
    ),

    // Pages Section
    el('div', { class: 'print-section' },
      el('div', { class: 'print-section-title' }, 'Trang in'),
      el('div', { class: 'print-row' },
        el('label', {}, rangeAll, `Tất cả (${totalPages} trang)`),
      ),
      el('div', { class: 'print-row' },
        el('label', {}, rangeCur, `Trang hiện tại (Trang ${currentPage + 1})`),
      ),
      el('div', { class: 'print-row' },
        el('label', {}, rangeCus, 'Tùy chọn dãy trang'),
      ),
      el('div', { class: 'print-pages-custom-box' },
        customPagesInput,
        customStatus,
      ),
    ),

    // Paper & Orientation Section
    el('div', { class: 'print-section' },
      el('div', { class: 'print-section-title' }, 'Khổ giấy & Bố cục'),
      el('div', { class: 'print-row' },
        el('label', { style: 'width: 70px;' }, 'Khổ giấy:'),
        paperSelect,
      ),
      el('div', { class: 'print-row', style: 'margin-top: 8px;' },
        orientSegmented,
      ),
      el('div', { class: 'print-row', style: 'margin-top: 10px;' },
        el('label', {}, 'Ghép trang trên tờ (N-up):'),
      ),
      nupGrid,
    ),

    // Scale & Margins Section
    el('div', { class: 'print-section' },
      el('div', { class: 'print-section-title' }, 'Tỷ lệ & Canh lề'),
      el('div', { class: 'print-row' },
        el('label', { style: 'width: 70px;' }, 'Tỷ lệ:'),
        scaleSelect,
        customScaleInput,
      ),
      el('div', { class: 'print-row' },
        el('label', { style: 'width: 70px;' }, 'Lề giấy:'),
        marginSelect,
      ),
    ),

    // Advanced Section
    el('div', { class: 'print-section' },
      el('div', { class: 'print-section-title' }, 'Nâng cao'),
      el('div', { class: 'print-row' },
        el('label', {}, annotCheckbox, 'In kèm Chú thích, Vẽ & Chữ ký'),
      ),
      el('div', { class: 'print-row' },
        el('label', {}, colorModeColor, 'Màu gốc'),
        el('label', { style: 'margin-left: 12px;' }, colorModeGray, 'Thang xám (Grayscale - tiết kiệm mực)'),
      ),
      el('div', { class: 'print-row', style: 'margin-top: 6px;' },
        el('label', {}, watermarkCheckbox, 'Đóng dấu mờ khi in (Watermark)'),
      ),
      watermarkBox,
    ),
  );

  const modalBody = el('div', { class: 'print-modal-body' }, previewPane, settingsPane);

  // Debounced preview updater
  let updateTimer = null;
  const requestUpdate = () => {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(updatePreview, 120);
  };

  const switchSheet = (delta) => {
    currentSheetIndex = Math.max(0, Math.min(currentSheetIndex + delta, totalSheets - 1));
    updatePreview();
  };

  function setOrientation(orient) {
    options.orientation = orient;
    [orientAuto, orientPort, orientLand].forEach((btn) => btn.classList.remove('active'));
    if (orient === 'auto') orientAuto.classList.add('active');
    else if (orient === 'portrait') orientPort.classList.add('active');
    else orientLand.classList.add('active');
    requestUpdate();
  }

  function setNUp(n) {
    options.nUp = n;
    nupButtons.forEach((btn, idx) => {
      btn.classList.toggle('active', [1, 2, 4, 6][idx] === n);
    });
    currentSheetIndex = 0;
    requestUpdate();
  }

  // Event handlers
  copiesInput.addEventListener('input', () => {
    options.copies = Math.max(1, Math.min(Number(copiesInput.value) || 1, 99));
  });

  const onRangeChange = () => {
    if (rangeAll.checked) {
      options.pageRange = 'all';
      customPagesInput.disabled = true;
      customStatus.className = 'print-page-status ok';
      customStatus.textContent = `Tất cả ${totalPages} trang`;
    } else if (rangeCur.checked) {
      options.pageRange = 'current';
      customPagesInput.disabled = true;
      customStatus.className = 'print-page-status ok';
      customStatus.textContent = `Trang hiện tại (1 trang)`;
    } else {
      options.pageRange = 'custom';
      customPagesInput.disabled = false;
      const v = validateCustomRange(customPagesInput.value, totalPages);
      if (v.valid) {
        options.customPages = customPagesInput.value;
        customStatus.className = 'print-page-status ok';
        customStatus.textContent = `Đã chọn ${v.count} / ${totalPages} trang`;
      } else {
        customStatus.className = 'print-page-status err';
        customStatus.textContent = v.message;
      }
    }
    currentSheetIndex = 0;
    requestUpdate();
  };

  rangeAll.addEventListener('change', onRangeChange);
  rangeCur.addEventListener('change', onRangeChange);
  rangeCus.addEventListener('change', onRangeChange);

  customPagesInput.addEventListener('input', () => {
    const v = validateCustomRange(customPagesInput.value, totalPages);
    if (v.valid) {
      options.customPages = customPagesInput.value;
      customStatus.className = 'print-page-status ok';
      customStatus.textContent = `Đã chọn ${v.count} / ${totalPages} trang`;
      requestUpdate();
    } else {
      customStatus.className = 'print-page-status err';
      customStatus.textContent = v.message;
    }
  });

  paperSelect.addEventListener('change', () => {
    options.paperSize = paperSelect.value;
    requestUpdate();
  });

  scaleSelect.addEventListener('change', () => {
    options.scaleMode = scaleSelect.value;
    customScaleInput.style.display = scaleSelect.value === 'custom' ? 'inline-block' : 'none';
    requestUpdate();
  });

  customScaleInput.addEventListener('input', () => {
    options.customScale = Number(customScaleInput.value) || 100;
    requestUpdate();
  });

  marginSelect.addEventListener('change', () => {
    options.margin = marginSelect.value;
    requestUpdate();
  });

  annotCheckbox.addEventListener('change', () => {
    options.includeAnnotations = annotCheckbox.checked;
    pageCache.clear();
    requestUpdate();
  });

  colorModeColor.addEventListener('change', () => {
    options.colorMode = 'color';
    requestUpdate();
  });

  colorModeGray.addEventListener('change', () => {
    options.colorMode = 'grayscale';
    requestUpdate();
  });

  watermarkCheckbox.addEventListener('change', () => {
    watermarkBox.style.display = watermarkCheckbox.checked ? 'flex' : 'none';
    options.watermark = watermarkCheckbox.checked ? watermarkTextInput.value : '';
    requestUpdate();
  });

  watermarkTextInput.addEventListener('input', () => {
    if (watermarkCheckbox.checked) {
      options.watermark = watermarkTextInput.value;
      requestUpdate();
    }
  });

  async function updatePreview() {
    const result = await renderLivePreview({
      stageEl,
      options,
      sheetIndex: currentSheetIndex,
      totalPages,
      currentPage,
      pageSizes: state.pageSizes ?? [],
      renderPageCanvasFn: getPageCanvas,
    });

    if (result) {
      totalSheets = result.totalSheets;
      currentSheetIndex = result.currentSheet;
      sheetLabel.textContent = `Tờ ${currentSheetIndex + 1} / ${totalSheets}`;
      sizeBadge.textContent = `${PAPER_DIMENSIONS[options.paperSize]?.name ?? 'A4'} · ${result.dimensions.orientation === 'landscape' ? 'Ngang' : 'Dọc'}`;
      prevBtn.disabled = currentSheetIndex <= 0;
      nextBtn.disabled = currentSheetIndex >= totalSheets - 1;
    }
  }

  // Initial preview render
  setTimeout(updatePreview, 30);

  // Trigger print logic
  const handlePrint = async () => {
    onStatus?.('Đang kết xuất tài liệu in…');
    try {
      const sourceBytes = options.includeAnnotations ? await buildOutput() : state.pdfBytes;

      const printPdfBytes = await generatePrintPdf({
        pdfBytes: sourceBytes,
        options,
        totalPages,
        currentPage,
        pageSizes: state.pageSizes ?? [],
      });

      const blob = new Blob([printPdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      onStatus?.('Đang gửi lệnh đến máy in…');
      await printBlobThroughFrame(url, { title: state.fileName ? `In - ${state.fileName}` : 'In tài liệu' });
      onStatus?.('Đã mở hộp thoại in của hệ thống.');
      return true;
    } catch (err) {
      console.error('Print failure:', err);
      // Fallback: direct browser print
      try {
        const rawUrl = URL.createObjectURL(new Blob([await buildOutput()], { type: 'application/pdf' }));
        window.open(rawUrl, '_blank', 'noopener');
        onStatus?.('Đã mở file PDF trong thẻ mới để in.');
        return true;
      } catch (fallbackErr) {
        alert(`Không thể in: ${err.message}`);
        return false;
      }
    }
  };

  openDialog({
    title: 'In tài liệu (Print Document)',
    subtitle: `${state.fileName || 'Tài liệu PDF'} (${totalPages} trang)`,
    icon: 'print',
    width: 860,
    body: modalBody,
    actions: [
      { label: 'Hủy bỏ', run: () => true },
      { label: 'In tài liệu', primary: true, run: handlePrint },
    ],
  });
}
