// Multi-format two-way converter for PDF Editor:
// PDF <-> Excel (.xlsx, .csv), Word (.docx), Images (PNG, JPG, WebP), and Text/HTML.
// 100% Client-side in browser; heavy external libraries (SheetJS, Mammoth, JSZip) are lazy-loaded.

import { LIB_URLS, loadScript } from './libs.js';
import { fontVariant, toWinAnsi } from './fonts.js';
import { fitText, wrapRuns, wrapText } from './textlayout.js';

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

// Font files for a generated PDF: `loadFont(texts, variant)` gives Unicode font bytes or null (null
// for 'regular' means the standard fonts suffice). Only the variants in `used` are asked for.
async function loadFonts(loadFont, texts, used) {
  const regular = (await loadFont?.(texts, 'regular')) ?? null;
  if (!regular) return null;
  const files = { regular };
  for (const v of ['bold', 'italic', 'boldItalic']) if (used.has(v)) files[v] = (await loadFont(texts, v)) ?? null;
  return files;
}

// Fonts for a generated PDF, in four styles. With Unicode font files every character is kept (a
// missing style falls back to regular, bold-italic to bold); without them the standard Helvetica
// family is used and `clean` reduces text to what it can write (Vietnamese accents are dropped).
// `clean` collapses spaces but keeps line breaks; `styled(run)` picks the font of a { bold, italic } run.
async function embedFonts(pdfDoc, files) {
  const { StandardFonts } = globalThis.PDFLib;
  const spaces = (s) => String(s ?? '').replace(/[^\S\n]+/g, ' ');
  let fonts;
  if (files?.regular) {
    pdfDoc.registerFontkit(globalThis.fontkit);
    const cache = new Map();
    const embed = (bytes) => {
      if (!cache.has(bytes)) cache.set(bytes, pdfDoc.embedFont(bytes, { subset: true }));
      return cache.get(bytes);
    };
    const regular = await embed(files.regular);
    const bold = files.bold ? await embed(files.bold) : regular;
    fonts = {
      regular,
      bold,
      italic: files.italic ? await embed(files.italic) : regular,
      boldItalic: files.boldItalic ? await embed(files.boldItalic) : bold,
      clean: spaces,
    };
  } else {
    const [regular, bold, italic, boldItalic] = await Promise.all(
      [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique].map((f) => pdfDoc.embedFont(f)),
    );
    fonts = { regular, bold, italic, boldItalic, clean: (s) => toWinAnsi(spaces(s)) };
  }
  fonts.styled = (style) => fonts[fontVariant(style)];
  return fonts;
}

const A4 = [595.28, 841.89];

/**
 * Converts every non-empty sheet of an Excel (.xlsx, .xls, .csv) file into PDF tables. Column widths
 * follow the content, wide sheets are laid out landscape, the header row repeats on each page and
 * numbers are right-aligned.
 * @param {ArrayBuffer|Uint8Array} fileData Excel file bytes
 * @param {Object} options { title, loadFont(texts, variant) -> Promise<Uint8Array|null> for Unicode text }
 */
export async function excelToPdf(fileData, { title = 'Bảng tính Excel', loadFont = null } = {}) {
  await loadScript(LIB_URLS.xlsx);
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error('Không tải được thư viện đọc Excel.');
  const PDFLib = globalThis.PDFLib;
  if (!PDFLib) throw new Error('Thư viện PDFLib chưa sẵn sàng.');

  const wb = XLSX.read(fileData, { type: 'array' });
  const sheets = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false }).filter((r) => r.some((c) => String(c).trim())),
  })).filter((s) => s.rows.length);
  if (!sheets.length) throw new Error('Bảng tính trống, không có dữ liệu để chuyển sang PDF.');

  const texts = [title, ...sheets.flatMap((s) => [s.name, ...s.rows.flat()])];
  const pdfDoc = await PDFLib.PDFDocument.create();
  pdfDoc.setTitle(title);
  const { regular: font, bold, clean } = await embedFonts(pdfDoc, await loadFonts(loadFont, texts, new Set(['regular', 'bold'])));
  const cell = (v) => clean(String(v ?? '').replace(/\s+/g, ' ')).trim();

  const MAX_COLS = 12;
  const margin = 36;
  const rowHeight = 18;
  const fontSize = 8.5;
  const pad = 4;
  const ink = PDFLib.rgb(0.15, 0.15, 0.17);
  const grid = PDFLib.rgb(0.85, 0.85, 0.88);

  for (const sheet of sheets) {
    const allCols = Math.max(...sheet.rows.map((r) => r.length));
    const numCols = Math.min(MAX_COLS, allCols);
    const rows = sheet.rows.map((r) => Array.from({ length: numCols }, (_, c) => cell(r[c])));
    const [pageWidth, pageHeight] = numCols > 6 ? [A4[1], A4[0]] : A4;
    const usable = pageWidth - 2 * margin;
    const chars = calculateColumnWidths(rows, { minWidth: 4, maxWidth: 40 });
    const sum = chars.reduce((a, b) => a + b, 0);
    const widths = chars.map((c) => (usable * c) / sum);
    const xs = widths.reduce((acc, w) => [...acc, acc.at(-1) + w], [margin]);
    const omitted = allCols > numCols ? ` (${numCols}/${allCols} cột đầu)` : '';
    const heading = cell(`${sheets.length > 1 ? `${title} — ${sheet.name}` : title}${omitted}`);

    let page;
    let y;
    const drawRow = (cells, isHeader) => {
      const top = y;
      if (isHeader) page.drawRectangle({ x: margin, y: top - rowHeight, width: usable, height: rowHeight, color: PDFLib.rgb(0.95, 0.96, 0.98) });
      page.drawLine({ start: { x: margin, y: top - rowHeight }, end: { x: margin + usable, y: top - rowHeight }, thickness: 0.5, color: grid });
      for (let c = 0; c < numCols; c++) {
        const f = isHeader ? bold : font;
        const text = fitText(cells[c], widths[c] - 2 * pad, (s) => f.widthOfTextAtSize(s, fontSize));
        if (!text) continue;
        const tw = f.widthOfTextAtSize(text, fontSize);
        const numeric = !isHeader && detectCellType(cells[c]).type === 'n';
        page.drawText(text, { x: numeric ? xs[c + 1] - pad - tw : xs[c] + pad, y: top - rowHeight + 6, size: fontSize, font: f, color: ink });
      }
      y -= rowHeight;
    };
    const newPage = (withHeading) => {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
      if (withHeading) {
        page.drawText(fitText(heading, usable, (s) => bold.widthOfTextAtSize(s, 13)), { x: margin, y: y - 13, size: 13, font: bold, color: ink });
        y -= 26;
      }
      page.drawLine({ start: { x: margin, y }, end: { x: margin + usable, y }, thickness: 0.5, color: grid });
      drawRow(rows[0], true);
    };

    newPage(true);
    for (let r = 1; r < rows.length; r++) {
      if (y - rowHeight < margin) newPage(false);
      drawRow(rows[r], false);
    }
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

// Inline text of a node as styled runs: bold inside <strong>/<b>, italic inside <em>/<i>, "\n" for
// <br>. Images and nested lists are handled separately.
function inlineRuns(node, style = { bold: false, italic: false }, out = []) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      if (child.textContent) out.push({ text: child.textContent, ...style });
    } else if (child.nodeType === 1 && !['IMG', 'UL', 'OL'].includes(child.tagName)) {
      if (child.tagName === 'BR') out.push({ text: '\n', ...style });
      else {
        const t = child.tagName;
        inlineRuns(child, { bold: style.bold || t === 'STRONG' || t === 'B', italic: style.italic || t === 'EM' || t === 'I' }, out);
      }
    }
  }
  return out;
}

// Block structure of mammoth's HTML: headings, paragraphs and list items (styled runs), images,
// and table rows (plain text). Browser only (DOMParser).
function htmlBlocks(html) {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const text = (n) => n.textContent.replace(/\s+/g, ' ').trim();
  const blocks = [];
  const image = (img) => blocks.push({ kind: 'image', src: img.getAttribute('src') ?? '', alt: img.getAttribute('alt') ?? '' });
  const walkList = (list, depth) => {
    let n = 0;
    for (const li of list.children) {
      if (li.tagName !== 'LI') continue;
      n++;
      blocks.push({ kind: 'item', depth, marker: list.tagName === 'OL' ? `${n}.` : '•', runs: inlineRuns(li) });
      for (const img of li.querySelectorAll('img')) if (img.closest('li') === li) image(img);
      for (const sub of li.children) if (sub.tagName === 'UL' || sub.tagName === 'OL') walkList(sub, depth + 1);
    }
  };
  const walk = (node) => {
    for (const child of node.children) {
      const tag = child.tagName;
      if (/^H[1-6]$/.test(tag)) blocks.push({ kind: 'heading', level: Number(tag[1]), runs: inlineRuns(child, { bold: true, italic: false }) });
      else if (tag === 'P') {
        blocks.push({ kind: 'para', runs: inlineRuns(child) });
        child.querySelectorAll('img').forEach(image);
      } else if (tag === 'UL' || tag === 'OL') walkList(child, 0);
      else if (tag === 'TABLE') {
        for (const tr of child.querySelectorAll('tr')) blocks.push({ kind: 'row', cells: [...tr.children].map(text) });
        blocks.push({ kind: 'gap' });
      } else if (tag === 'IMG') image(child);
      else walk(child);
    }
  };
  walk(body);
  const hasText = (b) => (b.runs ? b.runs.map((r) => r.text).join('') : (b.cells ?? []).join('')).trim();
  return blocks.filter((b) => b.kind === 'gap' || b.kind === 'image' || hasText(b));
}

// PNG or JPEG bytes of an image data URI; other raster formats (GIF, BMP, WebP…) go through a canvas.
// Vector EMF/WMF pictures cannot be drawn by a browser and give null.
async function imageBytes(src) {
  const m = /^data:(image\/[\w.+-]+);base64,(.*)$/is.exec(src);
  if (!m) return null;
  const decode = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const type = m[1].toLowerCase();
  if (type === 'image/png' || type === 'image/jpeg' || type === 'image/jpg') return { bytes: decode(m[2]), png: type === 'image/png' };
  const png = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
  return png ? { bytes: decode(png.slice(png.indexOf(',') + 1)), png: true } : null;
}

const HEADING_SIZES = { 1: 18, 2: 15, 3: 13, 4: 12, 5: 11.5, 6: 11 };

/**
 * Converts Word (.docx) to PDF: Mammoth reads the document structure, pdf-lib lays it out on A4 with
 * headings, paragraphs wrapped by measured width with bold and italic kept, bulleted and numbered
 * lists, tables and pictures (PNG, JPEG and other raster formats). Colours, underline and
 * vector (EMF/WMF) pictures are not carried over; such a picture leaves a short note.
 * @param {Object} options { title, loadFont(texts, variant) -> Promise<Uint8Array|null> for Unicode text }
 */
export async function docxToPdf(fileData, { title = 'Tài liệu Word', loadFont = null } = {}) {
  await loadScript(LIB_URLS.mammoth);
  const mammoth = globalThis.mammoth;
  if (!mammoth) throw new Error('Không tải được thư viện Mammoth để đọc Word.');

  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: fileData });
  const blocks = htmlBlocks(html || '');
  if (!blocks.some((b) => b.kind !== 'gap')) throw new Error('Tài liệu Word không có văn bản hoặc nội dung được bảo vệ.');

  const PDFLib = globalThis.PDFLib;
  const texts = [title, ...blocks.flatMap((b) => b.cells ?? (b.runs ?? []).map((r) => r.text))];
  const used = new Set(['regular', ...blocks.flatMap((b) => (b.runs ?? []).map(fontVariant))]);
  const pdfDoc = await PDFLib.PDFDocument.create();
  pdfDoc.setTitle(title);
  const fonts = await embedFonts(pdfDoc, await loadFonts(loadFont, texts, used));
  const { clean } = fonts;

  const [pageWidth, pageHeight] = A4;
  const margin = 56;
  const usable = pageWidth - 2 * margin;
  const bodySize = 10.5;
  const ink = PDFLib.rgb(0.13, 0.13, 0.16);
  const headingInk = PDFLib.rgb(0.09, 0.2, 0.42);
  const faint = PDFLib.rgb(0.45, 0.45, 0.5);
  const grid = PDFLib.rgb(0.8, 0.8, 0.84);

  let page = pdfDoc.addPage(A4);
  let y = pageHeight - margin;
  const ensure = (h) => {
    if (y - h >= margin) return;
    page = pdfDoc.addPage(A4);
    y = pageHeight - margin;
  };
  const cleanRuns = (runs) => runs.map((r) => ({ ...r, text: clean(r.text) }));

  for (const b of blocks) {
    if (b.kind === 'gap') {
      y -= 8;
      continue;
    }
    if (b.kind === 'image') {
      const data = await imageBytes(b.src);
      const img = data && (await (data.png ? pdfDoc.embedPng(data.bytes) : pdfDoc.embedJpg(data.bytes)).catch(() => null));
      if (!img) {
        ensure(16);
        page.drawText(clean(`[Không chuyển được ảnh${b.alt ? ` "${b.alt}"` : ''}: định dạng không hỗ trợ, ví dụ EMF/WMF]`), { x: margin, y: y - 10, size: 8.5, font: fonts.italic, color: faint });
        y -= 18;
        continue;
      }
      // 96 dpi pixels to points, shrunk to the text width and to 70% of the page height.
      const scale = Math.min(0.75, usable / img.width, (pageHeight - 2 * margin) * 0.7 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ensure(h + 8);
      page.drawImage(img, { x: margin, y: y - h, width: w, height: h });
      y -= h + 10;
      continue;
    }
    if (b.kind === 'row') {
      const cols = Math.max(1, b.cells.length);
      const cw = usable / cols;
      const cellLines = b.cells.map((c) => wrapText(clean(c), cw - 8, (t) => fonts.regular.widthOfTextAtSize(t, 9.5)));
      const h = Math.max(1, ...cellLines.map((l) => l.length)) * 13 + 8;
      ensure(h);
      cellLines.forEach((ls, c) => {
        const x = margin + c * cw;
        page.drawRectangle({ x, y: y - h, width: cw, height: h, borderColor: grid, borderWidth: 0.5 });
        ls.forEach((t, k) => page.drawText(t, { x: x + 4, y: y - 14 - k * 13, size: 9.5, font: fonts.regular, color: ink }));
      });
      y -= h;
      continue;
    }
    const heading = b.kind === 'heading';
    const size = heading ? HEADING_SIZES[b.level] ?? 11 : bodySize;
    const lh = size * 1.4;
    const indent = b.kind === 'item' ? 14 + b.depth * 16 : 0;
    const measure = (t, style) => fonts.styled(style).widthOfTextAtSize(t, size);
    const lines = wrapRuns(cleanRuns(b.runs), usable - indent - (b.kind === 'item' ? 12 : 0), measure);
    if (heading) {
      y -= 8;
      ensure(lh * Math.min(2, lines.length) + lh); // keep a heading with the text after it
    }
    lines.forEach((pieces, k) => {
      ensure(lh);
      if (k === 0 && b.kind === 'item') page.drawText(clean(b.marker), { x: margin + indent - 12, y: y - size, size, font: fonts.regular, color: ink });
      let x = margin + indent + (b.kind === 'item' ? 2 : 0);
      for (const p of pieces) {
        const font = fonts.styled(p);
        page.drawText(p.text, { x, y: y - size, size, font, color: heading ? headingInk : ink });
        x += font.widthOfTextAtSize(p.text, size);
      }
      y -= lh;
    });
    y -= heading ? 4 : b.kind === 'item' ? 2 : 6;
  }

  return pdfDoc.save();
}
