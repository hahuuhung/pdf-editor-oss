// Multi-format two-way converter for PDF Editor:
// PDF <-> Excel (.xlsx, .csv), Word (.docx), Images (PNG, JPG, WebP), and Text/HTML.
// 100% Client-side in browser; heavy external libraries (SheetJS, Mammoth, JSZip) are lazy-loaded.

import { LIB_URLS, loadScript } from './libs.js';

// ---------- Pure Helper Functions (Unit-Testable in Node & Browser) ----------

/**
 * Parses numeric strings in Vietnamese/European format (e.g. "1.250,50") or standard format ("1250.50").
 */
export function detectCellType(val) {
  if (val === null || val === undefined) return { value: '', type: 's' };
  const str = String(val).trim();
  if (!str) return { value: '', type: 's' };

  // Date check YYYY-MM-DD or DD/MM/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(str) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    return { value: str, type: 's' };
  }

  // European / Vietnamese format: 1.250,50 or 500.000 or 1250,5
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(str) || /^-?\d+,\d+$/.test(str)) {
    const normalized = str.replace(/\./g, '').replace(',', '.');
    if (!isNaN(normalized)) {
      return { value: Number(normalized), type: 'n' };
    }
  }

  // US / Standard format: 1,250.50 or 1250.50 or -123
  if (/^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$/.test(str) || /^-?\d+(?:\.\d+)?$/.test(str)) {
    const cleanStandard = str.replace(/,/g, '');
    if (!isNaN(cleanStandard) && cleanStandard !== '' && !/\s/.test(cleanStandard)) {
      return { value: Number(cleanStandard), type: 'n' };
    }
  }

  return { value: str, type: 's' };
}

/**
 * Clusters extracted text items into a 2D table grid based on spatial coordinates (x, y, w, h).
 * Items format: [{ str: "...", x: 10, y: 50, w: 30, h: 10 }]
 */
export function clusterTextToGrid(items, { yTolerance = 4, xTolerance = 12 } = {}) {
  if (!items || !items.length) return [];

  // Filter out whitespace-only items
  const validItems = items
    .filter((it) => it && it.str && it.str.trim() !== '')
    .map((it) => ({
      str: it.str.trim(),
      x: Number(it.x ?? 0),
      y: Number(it.y ?? 0),
      w: Number(it.w ?? it.width ?? 0),
      h: Number(it.h ?? it.height ?? 0),
    }));

  if (!validItems.length) return [];

  // 1. Sort items by Y (top to bottom), then by X (left to right)
  validItems.sort((a, b) => {
    if (Math.abs(a.y - b.y) <= yTolerance) {
      return a.x - b.x;
    }
    return a.y - b.y;
  });

  // 2. Group into Rows
  const rows = [];
  let currentRow = [];
  let currentY = null;

  for (const item of validItems) {
    if (currentY === null || Math.abs(item.y - currentY) <= yTolerance) {
      currentRow.push(item);
      if (currentY === null) currentY = item.y;
      else currentY = (currentY * (currentRow.length - 1) + item.y) / currentRow.length; // running avg
    } else {
      if (currentRow.length) rows.push(currentRow);
      currentRow = [item];
      currentY = item.y;
    }
  }
  if (currentRow.length) rows.push(currentRow);

  // 3. Find unique Column Boundaries across all rows
  const allX = validItems.map((it) => it.x).sort((a, b) => a - b);
  const colBoundaries = [];

  for (const x of allX) {
    const existing = colBoundaries.find((col) => Math.abs(col - x) <= xTolerance);
    if (!existing && existing !== 0) {
      colBoundaries.push(x);
    }
  }
  colBoundaries.sort((a, b) => a - b);

  // 4. Map each row's items into the 2D grid
  const grid = [];
  for (const rowItems of rows) {
    const rowCells = new Array(colBoundaries.length).fill('');
    for (const item of rowItems) {
      // Find closest column boundary
      let closestColIdx = 0;
      let minDiff = Infinity;
      for (let c = 0; c < colBoundaries.length; c++) {
        const diff = Math.abs(colBoundaries[c] - item.x);
        if (diff < minDiff) {
          minDiff = diff;
          closestColIdx = c;
        }
      }

      if (rowCells[closestColIdx]) {
        rowCells[closestColIdx] += ' ' + item.str;
      } else {
        rowCells[closestColIdx] = item.str;
      }
    }
    grid.push(rowCells);
  }

  return grid;
}

/**
 * Calculates optimal column widths (in characters) for a 2D table grid.
 */
export function calculateColumnWidths(grid, { minWidth = 10, maxWidth = 60 } = {}) {
  if (!grid || !grid.length) return [];
  const numCols = Math.max(...grid.map((r) => r.length));
  const widths = new Array(numCols).fill(minWidth);

  for (const row of grid) {
    for (let c = 0; c < row.length; c++) {
      const cellLen = String(row[c] ?? '').length;
      if (cellLen > widths[c]) {
        widths[c] = Math.min(cellLen + 2, maxWidth);
      }
    }
  }
  return widths;
}

/**
 * Parses user input page range like "1, 3-5, 8" into 1-based page numbers.
 */
export function parseUserPageRange(inputStr, maxPages) {
  if (!inputStr || !inputStr.trim()) {
    return Array.from({ length: maxPages }, (_, i) => i + 1);
  }
  const parts = inputStr.split(',').map((p) => p.trim()).filter(Boolean);
  const result = new Set();

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Math.max(1, Math.min(Number(rangeMatch[1]), maxPages));
      const end = Math.max(1, Math.min(Number(rangeMatch[2]), maxPages));
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      for (let p = min; p <= max; p++) result.add(p);
    } else {
      const num = Number(part);
      if (!isNaN(num) && num >= 1 && num <= maxPages) {
        result.add(num);
      }
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}

// ---------- Browser-Only Conversion Engines (Lazy-loaded) ----------

/**
 * Exports multiple pages of extracted text items to an Excel (.xlsx) file blob.
 * @param {Array<Array<Object>>} pagesData Array of page text items
 * @param {Object} options { separateSheets, title }
 */
export async function exportToExcel(pagesData, { separateSheets = true, title = 'Bảng tính' } = {}) {
  await loadScript(LIB_URLS.xlsx);
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error('Không khởi tạo được thư viện SheetJS (XLSX).');

  const wb = XLSX.utils.book_new();

  if (separateSheets) {
    pagesData.forEach((pageItems, idx) => {
      const grid = clusterTextToGrid(pageItems);
      const rows = grid.map((row) =>
        row.map((cell) => {
          const { value, type } = detectCellType(cell);
          return { v: value, t: type };
        }),
      );
      const ws = XLSX.utils.aoa_to_sheet(
        rows.length ? rows.map((r) => r.map((c) => c.v)) : [['(Trang không có nội dung bảng)']],
      );
      // Auto column widths
      const colWidths = calculateColumnWidths(grid);
      ws['!cols'] = colWidths.map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, `Trang ${idx + 1}`);
    });
  } else {
    // Stack all pages vertically
    const combinedGrid = [];
    pagesData.forEach((pageItems, idx) => {
      combinedGrid.push([`--- TRANG ${idx + 1} ---`]);
      const grid = clusterTextToGrid(pageItems);
      grid.forEach((row) => combinedGrid.push(row));
      combinedGrid.push([]); // blank line between pages
    });

    const rows = combinedGrid.map((row) =>
      row.map((cell) => {
        const { value, type } = detectCellType(cell);
        return value;
      }),
    );
    const ws = XLSX.utils.aoa_to_sheet(rows.length ? rows : [['(Tài liệu không có nội dung)']]);
    const colWidths = calculateColumnWidths(combinedGrid);
    ws['!cols'] = colWidths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  }

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Exports pages from PDF.js document to high quality PNG or JPG images, with custom DPI and multi-page ZIP.
 * @param {Object} pdfDoc PDF.js document proxy
 * @param {Object} options { format, dpi, quality, pageNumbers, onProgress }
 */
export async function exportPagesToImages(
  pdfDoc,
  { format = 'png', dpi = 150, quality = 0.9, pageNumbers = null, baseFileName = 'tailieu', onProgress = null } = {},
) {
  const total = pdfDoc.numPages;
  const targetPages = pageNumbers && pageNumbers.length ? pageNumbers : Array.from({ length: total }, (_, i) => i + 1);

  const scale = dpi / 72;
  const mimeType = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = format === 'jpg' || format === 'jpeg' ? 'jpg' : 'png';

  const renderedFiles = [];

  for (let idx = 0; idx < targetPages.length; idx++) {
    const pageNum = targetPages[idx];
    onProgress?.(idx + 1, targetPages.length, pageNum);

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');

    // White background for JPEG export
    if (ext === 'jpg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));

    // Release canvas memory immediately to prevent browser OOM!
    canvas.width = 0;
    canvas.height = 0;

    const fileName = `${baseFileName}-trang-${String(pageNum).padStart(2, '0')}.${ext}`;
    renderedFiles.push({ name: fileName, blob });
  }

  // If only 1 page was exported, return the single blob directly
  if (renderedFiles.length === 1) {
    return {
      fileName: renderedFiles[0].name,
      blob: renderedFiles[0].blob,
      isZip: false,
    };
  }

  // Pack multiple files into a zip archive
  await loadScript(LIB_URLS.jszip);
  const JSZip = globalThis.JSZip;
  if (!JSZip) throw new Error('Không khởi tạo được thư viện nén JSZip.');

  const zip = new JSZip();
  renderedFiles.forEach((f) => zip.file(f.name, f.blob));
  const zipBlob = await zip.generateAsync({ type: 'blob' });

  return {
    fileName: `${baseFileName}-anh-${dpi}dpi.zip`,
    blob: zipBlob,
    isZip: true,
  };
}

/**
 * Converts Excel (.xlsx, .xls, .csv) data into a multi-page formatted PDF table.
 * @param {ArrayBuffer|Uint8Array} fileData Excel file bytes
 * @param {Object} options { title }
 */
export async function excelToPdf(fileData, { title = 'Bảng tính Excel' } = {}) {
  await loadScript(LIB_URLS.xlsx);
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error('Không tải được thư viện đọc Excel.');

  const wb = XLSX.read(fileData, { type: 'array' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error('Tệp Excel không có trang tính (sheet) nào.');

  const ws = wb.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows || !rows.length) throw new Error('Trang tính trống, không có dữ liệu để chuyển sang PDF.');

  const PDFLib = globalThis.PDFLib;
  if (!PDFLib) throw new Error('Thư viện PDFLib chưa sẵn sàng.');

  const pdfDoc = await PDFLib.PDFDocument.create();
  const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);

  // A4 dimensions in points
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 36;
  const usableWidth = pageWidth - 2 * margin;

  const numCols = Math.max(...rows.map((r) => r.length));
  if (numCols === 0) throw new Error('Không tìm thấy cột dữ liệu hợp lệ.');

  const colWidth = usableWidth / Math.min(numCols, 10); // max 10 visible columns per page
  const rowHeight = 22;
  const fontSize = 9;

  let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let currentY = pageHeight - margin - 30;

  // Title
  currentPage.drawText(title, {
    x: margin,
    y: pageHeight - margin - 15,
    size: 14,
    font: boldFont,
    color: PDFLib.rgb(0.1, 0.1, 0.1),
  });

  const drawRow = (page, rowData, yPos, isHeader = false) => {
    // Header background
    if (isHeader) {
      page.drawRectangle({
        x: margin,
        y: yPos - 5,
        width: usableWidth,
        height: rowHeight,
        color: PDFLib.rgb(0.93, 0.94, 0.96),
      });
    }

    // Border line bottom
    page.drawLine({
      start: { x: margin, y: yPos - 5 },
      end: { x: margin + usableWidth, y: yPos - 5 },
      thickness: 0.5,
      color: PDFLib.rgb(0.8, 0.8, 0.8),
    });

    for (let c = 0; c < Math.min(rowData.length, 10); c++) {
      const cellText = String(rowData[c] ?? '').trim().slice(0, 30);
      if (!cellText) continue;

      page.drawText(cellText, {
        x: margin + c * colWidth + 4,
        y: yPos + 4,
        size: fontSize,
        font: isHeader ? boldFont : font,
        color: PDFLib.rgb(0.15, 0.15, 0.15),
      });
    }
  };

  // Draw Header
  const headerRow = rows[0];
  drawRow(currentPage, headerRow, currentY, true);
  currentY -= rowHeight;

  // Draw Body Rows
  for (let r = 1; r < rows.length; r++) {
    if (currentY <= margin + rowHeight) {
      // New Page
      currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      currentY = pageHeight - margin - 20;
      // Re-draw header on next page
      drawRow(currentPage, headerRow, currentY, true);
      currentY -= rowHeight;
    }

    drawRow(currentPage, rows[r], currentY, false);
    currentY -= rowHeight;
  }

  return pdfDoc.save();
}

/**
 * Creates a professional PDF from multiple images with page size and margin choices.
 * @param {Array<{ bytes: Uint8Array, type: string }>} images Array of image objects
 * @param {Object} options { pageSize: 'a4'|'fit'|'letter', orientation: 'auto'|'portrait'|'landscape', margin: number }
 */
export async function imagesToPdfAdvanced(
  images,
  { pageSize = 'a4', orientation = 'auto', margin = 20 } = {},
) {
  if (!images || !images.length) throw new Error('Cần chọn ít nhất một ảnh để tạo PDF.');

  const PDFLib = globalThis.PDFLib;
  if (!PDFLib) throw new Error('Thư viện PDFLib chưa sẵn sàng.');

  const doc = await PDFLib.PDFDocument.create();

  const standardSizes = {
    a4: { w: 595.28, h: 841.89 },
    letter: { w: 612.0, h: 792.0 },
  };

  for (const img of images) {
    const isPng = img.type === 'image/png' || img.bytes[0] === 0x89;
    const embedded = isPng ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    const { width: imgW, height: imgH } = embedded;

    let pW, pH;

    if (pageSize === 'fit') {
      pW = imgW + 2 * margin;
      pH = imgH + 2 * margin;
    } else {
      const base = standardSizes[pageSize] ?? standardSizes.a4;
      const isImgLandscape = imgW > imgH;

      let isLandscape = false;
      if (orientation === 'landscape') isLandscape = true;
      else if (orientation === 'auto') isLandscape = isImgLandscape;

      pW = isLandscape ? base.h : base.w;
      pH = isLandscape ? base.w : base.h;
    }

    const page = doc.addPage([pW, pH]);

    // Scale image into printable area preserving aspect ratio
    const availW = Math.max(10, pW - 2 * margin);
    const availH = Math.max(10, pH - 2 * margin);
    const scale = Math.min(availW / imgW, availH / imgH);

    const drawW = imgW * scale;
    const drawH = imgH * scale;

    // Center image on page
    const drawX = margin + (availW - drawW) / 2;
    const drawY = margin + (availH - drawH) / 2;

    page.drawImage(embedded, {
      x: drawX,
      y: drawY,
      width: drawW,
      height: drawH,
    });
  }

  return doc.save();
}

/**
 * Converts Word (.docx) file data to PDF using Mammoth to parse structure and pdf-lib to render.
 */
export async function docxToPdf(fileData, { title = 'Tài liệu Word' } = {}) {
  await loadScript(LIB_URLS.mammoth);
  const mammoth = globalThis.mammoth;
  if (!mammoth) throw new Error('Không tải được thư viện Mammoth để đọc Word.');

  const result = await mammoth.extractRawText({ arrayBuffer: fileData });
  const rawText = result.value || '';
  if (!rawText.trim()) throw new Error('Tài liệu Word không có văn bản hoặc nội dung được bảo vệ.');

  const PDFLib = globalThis.PDFLib;
  const pdfDoc = await PDFLib.PDFDocument.create();
  const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;
  const usableWidth = pageWidth - 2 * margin;
  const lineHeight = 16;
  const fontSize = 10;

  const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);

  let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let currentY = pageHeight - margin - 20;

  // Title
  currentPage.drawText(title, {
    x: margin,
    y: currentY,
    size: 14,
    font: boldFont,
    color: PDFLib.rgb(0.1, 0.1, 0.1),
  });
  currentY -= 30;

  for (const line of lines) {
    if (currentY <= margin + lineHeight) {
      currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      currentY = pageHeight - margin - 20;
    }

    // Rough wrap for long lines
    const maxChars = Math.floor(usableWidth / 5.5);
    let remaining = line.trim();
    while (remaining.length > 0) {
      if (currentY <= margin + lineHeight) {
        currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        currentY = pageHeight - margin - 20;
      }
      const chunk = remaining.slice(0, maxChars);
      remaining = remaining.slice(maxChars);

      currentPage.drawText(chunk, {
        x: margin,
        y: currentY,
        size: fontSize,
        font: font,
        color: PDFLib.rgb(0.2, 0.2, 0.2),
      });
      currentY -= lineHeight;
    }
    currentY -= 4; // paragraph spacing
  }

  return pdfDoc.save();
}
