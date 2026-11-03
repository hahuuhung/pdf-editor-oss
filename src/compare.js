// Full-Screen PDF Compare Workspace:
// - LCS line-level text diffing per page
// - Pixel-level RGBA overlay diff (Red = removed in A, Green = added in B, Amber = modified)
// - Side-by-Side synchronized scrolling & zoom + Overlay flicker/diff viewer
// - Multi-page PDF Comparison Report generator via PDFLib

import { el, icon } from './dom.js';
import { groupLines, stripDiacritics } from './textlayout.js';

const MAX_LCS_LINES = 500;

export function normalizeTextLines(raw) {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  return String(raw ?? '')
    .split(/\r?\n/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Computes an order-preserving line diff using LCS (falling back to linear scan on huge inputs).
export function diffTextLines(rawA, rawB) {
  const a = normalizeTextLines(rawA);
  const b = normalizeTextLines(rawB);
  const n = a.length;
  const m = b.length;

  const entries = [];
  if (n === 0 && m === 0) {
    return { entries, added: 0, removed: 0 };
  }

  if (n * m > MAX_LCS_LINES * MAX_LCS_LINES) {
    // Fast linear fallback for unusually dense pages
    const setB = new Set(b);
    const setA = new Set(a);
    let added = 0;
    let removed = 0;
    a.forEach((line, idx) => {
      if (setB.has(line)) entries.push({ type: 'same', text: line, lineA: idx + 1 });
      else {
        entries.push({ type: 'removed', text: line, lineA: idx + 1 });
        removed++;
      }
    });
    b.forEach((line, idx) => {
      if (!setA.has(line)) {
        entries.push({ type: 'added', text: line, lineB: idx + 1 });
        added++;
      }
    });
    return { entries, added, removed };
  }

  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      entries.push({ type: 'same', text: a[i], lineA: i + 1, lineB: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      entries.push({ type: 'removed', text: a[i], lineA: i + 1 });
      removed++;
      i++;
    } else {
      entries.push({ type: 'added', text: b[j], lineB: j + 1 });
      added++;
      j++;
    }
  }
  while (i < n) {
    entries.push({ type: 'removed', text: a[i], lineA: i + 1 });
    removed++;
    i++;
  }
  while (j < m) {
    entries.push({ type: 'added', text: b[j], lineB: j + 1 });
    added++;
    j++;
  }

  return { entries, added, removed };
}

// Compares two RGBA pixel buffers of size width*height*4 and builds a visual diff buffer.
export function computePixelDiff(rgbaA, rgbaB, width, height, { threshold = 24 } = {}) {
  const totalPixels = Math.max(0, width * height);
  const diffRgba = new Uint8ClampedArray(totalPixels * 4);
  let changedPixels = 0;

  for (let idx = 0; idx < totalPixels; idx++) {
    const o = idx * 4;
    const aAlpha = rgbaA[o + 3] ?? 0;
    const bAlpha = rgbaB[o + 3] ?? 0;
    // Treat transparent pixels as white paper
    const rA = aAlpha === 0 ? 255 : rgbaA[o];
    const gA = aAlpha === 0 ? 255 : rgbaA[o + 1];
    const bA = aAlpha === 0 ? 255 : rgbaA[o + 2];

    const rB = bAlpha === 0 ? 255 : rgbaB[o];
    const gB = bAlpha === 0 ? 255 : rgbaB[o + 1];
    const bB = bAlpha === 0 ? 255 : rgbaB[o + 2];

    const maxDelta = Math.max(Math.abs(rA - rB), Math.abs(gA - gB), Math.abs(bA - bB));
    const lumA = 0.299 * rA + 0.587 * gA + 0.114 * bA;
    const lumB = 0.299 * rB + 0.587 * gB + 0.114 * bB;

    if (maxDelta <= threshold) {
      // Fade unchanged background/text toward white so Red/Green changes stand out sharply
      const faded = Math.round(lumB * 0.35 + 255 * 0.65);
      diffRgba[o] = faded;
      diffRgba[o + 1] = faded;
      diffRgba[o + 2] = faded;
      diffRgba[o + 3] = 255;
    } else {
      changedPixels++;
      if (lumA + 35 < lumB) {
        // Ink existed in A, lighter/gone in B -> Red (Removed)
        diffRgba[o] = 239;
        diffRgba[o + 1] = 68;
        diffRgba[o + 2] = 68;
      } else if (lumB + 35 < lumA) {
        // Ink added/darker in B -> Green (Added)
        diffRgba[o] = 22;
        diffRgba[o + 1] = 163;
        diffRgba[o + 2] = 74;
      } else {
        // Color/tint change of similar luminance -> Amber (Modified)
        diffRgba[o] = 245;
        diffRgba[o + 1] = 158;
        diffRgba[o + 2] = 11;
      }
      diffRgba[o + 3] = 255;
    }
  }

  const mismatchPct = totalPixels > 0 ? Math.round((changedPixels / totalPixels) * 10000) / 100 : 0;
  return { diffRgba, width, height, changedPixels, totalPixels, mismatchPct };
}

// Summarizes text & pixel differences across all pages of Document A and Document B.
export function summarizeDocumentChanges(pagesTextA = [], pagesTextB = [], pixelStats = []) {
  const totalPages = Math.max(pagesTextA.length, pagesTextB.length);
  const pages = [];
  let changedPages = 0;
  let totalAddedLines = 0;
  let totalRemovedLines = 0;

  for (let i = 0; i < totalPages; i++) {
    const hasA = i < pagesTextA.length;
    const hasB = i < pagesTextB.length;
    const diff = diffTextLines(pagesTextA[i] ?? [], pagesTextB[i] ?? []);
    const mismatchPct = Number(pixelStats[i]?.mismatchPct ?? 0);

    let status = 'unchanged';
    if (!hasA && hasB) status = 'added-page';
    else if (hasA && !hasB) status = 'removed-page';
    else if (diff.added > 0 || diff.removed > 0 || mismatchPct >= 0.05) status = 'modified';

    if (status !== 'unchanged') changedPages++;
    totalAddedLines += diff.added;
    totalRemovedLines += diff.removed;

    pages.push({
      page: i + 1,
      status,
      addedLines: diff.added,
      removedLines: diff.removed,
      mismatchPct,
      diffEntries: diff.entries,
    });
  }

  return {
    totalPages,
    changedPages,
    unchangedPages: totalPages - changedPages,
    totalAddedLines,
    totalRemovedLines,
    pages,
  };
}

function safePdfText(font, str) {
  const clean = String(str ?? '').replace(/\s+/g, ' ').trim();
  try {
    font.encodeText(clean);
    return clean;
  } catch {
    return stripDiacritics(clean).replace(/[^\x20-\x7E]/g, '?');
  }
}

// Generates a downloadable PDF Comparison Report summarizing statistics, text diffs, and visual diff snapshots.
export async function buildComparisonReportPdf({
  fileNameA,
  fileNameB,
  summary,
  diffPngDataUrls = [],
  fontBytes = null,
}) {
  const doc = await PDFLib.PDFDocument.create();
  let regFont;
  let boldFont;
  if (fontBytes && typeof fontkit !== 'undefined') {
    doc.registerFontkit(fontkit);
    regFont = await doc.embedFont(fontBytes, { subset: true });
    boldFont = regFont;
  } else {
    regFont = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    boldFont = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  }

  const W = 595.28;
  const H = 841.89;
  const M = 42;

  const cover = doc.addPage([W, H]);
  let y = H - 54;

  const write = (page, text, x, py, { size = 10.5, bold = false, color = [0.06, 0.09, 0.16] } = {}) => {
    const f = bold ? boldFont : regFont;
    page.drawText(safePdfText(f, text), {
      x,
      y: py,
      size,
      font: f,
      color: PDFLib.rgb(color[0], color[1], color[2]),
    });
  };

  write(cover, 'BAO CAO SO SANH TAI LIEU PDF', M, y, { size: 18, bold: true, color: [0.14, 0.39, 0.92] });
  y -= 24;
  write(cover, `Ngay xuat bao cao: ${new Date().toLocaleString('vi-VN')}`, M, y, { size: 9.5, color: [0.39, 0.45, 0.55] });
  y -= 28;

  cover.drawRectangle({
    x: M,
    y: y - 58,
    width: W - M * 2,
    height: 66,
    color: PDFLib.rgb(0.97, 0.98, 0.99),
    borderColor: PDFLib.rgb(0.89, 0.89, 0.91),
    borderWidth: 1,
  });
  write(cover, `Tai lieu goc (A): ${fileNameA || ' A.pdf'}`, M + 12, y - 14, { size: 10.5, bold: true, color: [0.75, 0.14, 0.14] });
  write(cover, `Tai lieu moi (B): ${fileNameB || ' B.pdf'}`, M + 12, y - 32, { size: 10.5, bold: true, color: [0.09, 0.5, 0.24] });
  write(
    cover,
    `Tong so trang: ${summary.totalPages}   |   Trang khac biet: ${summary.changedPages}   |   Dong them: +${summary.totalAddedLines}   |   Dong xoa: -${summary.totalRemovedLines}`,
    M + 12,
    y - 50,
    { size: 9.5 },
  );
  y -= 86;

  write(cover, 'Danh sach trang co thay doi:', M, y, { size: 12, bold: true });
  y -= 18;

  const changedList = summary.pages.filter((p) => p.status !== 'unchanged');
  if (!changedList.length) {
    write(cover, 'Hai tai lieu giong nhau hoan toan tren moi trang.', M, y, { size: 10.5, color: [0.09, 0.5, 0.24] });
  } else {
    for (const p of changedList.slice(0, 26)) {
      write(
        cover,
        `• Trang ${p.page}: +${p.addedLines} dong moi, -${p.removedLines} dong cu, sai khac hinh anh ${p.mismatchPct}%`,
        M + 6,
        y,
        { size: 9.5 },
      );
      y -= 15;
      if (y < 70) break;
    }
  }

  // Detail pages for each modified page
  for (const p of changedList) {
    const pg = doc.addPage([W, H]);
    let py = H - 48;
    write(
      pg,
      `Trang ${p.page} — Chi tiet khac biet (+${p.addedLines} / -${p.removedLines} dong, ${p.mismatchPct}% diem anh)`,
      M,
      py,
      { size: 12.5, bold: true },
    );
    py -= 18;

    const dataUrl = diffPngDataUrls[p.page - 1];
    if (dataUrl) {
      try {
        const png = await doc.embedPng(dataUrl);
        const maxImgW = W - M * 2;
        const maxImgH = 430;
        const scale = Math.min(maxImgW / png.width, maxImgH / png.height, 1);
        const drawW = png.width * scale;
        const drawH = png.height * scale;
        pg.drawImage(png, {
          x: M + (maxImgW - drawW) / 2,
          y: py - drawH,
          width: drawW,
          height: drawH,
        });
        pg.drawRectangle({
          x: M + (maxImgW - drawW) / 2,
          y: py - drawH,
          width: drawW,
          height: drawH,
          borderColor: PDFLib.rgb(0.85, 0.86, 0.89),
          borderWidth: 0.8,
        });
        py -= drawH + 20;
      } catch {
        // Ignore image embedding failure if canvas snapshot was empty
      }
    }

    const diffSnips = p.diffEntries.filter((e) => e.type !== 'same').slice(0, 14);
    for (const snip of diffSnips) {
      if (py < 48) break;
      const prefix = snip.type === 'added' ? '+ ' : '- ';
      const clr = snip.type === 'added' ? [0.09, 0.5, 0.24] : [0.75, 0.14, 0.14];
      const clipped = (prefix + snip.text).slice(0, 95);
      write(pg, clipped, M, py, { size: 9, color: clr });
      py -= 13;
    }
  }

  return doc.save();
}

async function extractLinesFromPage(pdfDoc, pageIndex) {
  const page = await pdfDoc.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const mapped = tc.items
    .filter((it) => typeof it.str === 'string' && it.str.length)
    .map((it) => {
      const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
      const h = Math.hypot(tx[2], tx[3]);
      return { str: it.str, x: tx[4], y: tx[5] - h, w: it.width, h: h * 1.15 };
    });
  return groupLines(mapped);
}

async function renderPageToCanvas(pdfDoc, pageIndex, scale) {
  const page = await pdfDoc.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

// Full-screen interactive Compare Workspace controller.
export function createCompareWorkspace({
  container,
  getOpenPdf,
  getFontBytes,
  downloadFn,
  onStatus,
  onClose,
}) {
  let docA = null;
  let docB = null;
  let nameA = '';
  let nameB = '';
  let mode = 'side'; // 'side' | 'overlay'
  let overlayLayer = 'diff'; // 'diff' | 'a' | 'b'
  let zoom = 1;
  let syncScroll = true;
  let onlyChanged = false;
  let currentSummary = null;
  let diffSnapshots = []; // dataURL per page for PDF report export
  let renderToken = 0;

  let fileInputA = null;
  let fileInputB = null;
  let stageEl = null;
  let sideStatsEl = null;
  let diffListEl = null;
  let btnExportReport = null;
  let nameSpanA = null;
  let nameSpanB = null;
  let overlaySubSeg = null;

  async function loadPdfFromBytes(bytes) {
    return pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  }

  async function pickFile(which) {
    const inp = which === 'a' ? fileInputA : fileInputB;
    inp?.click();
  }

  async function handlePickedFile(which, file) {
    if (!file) return;
    try {
      onStatus?.(`Đang nạp ${file.name}…`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const loaded = await loadPdfFromBytes(bytes);
      if (which === 'a') {
        docA?.destroy();
        docA = loaded;
        nameA = file.name;
        if (nameSpanA) nameSpanA.textContent = nameA;
      } else {
        docB?.destroy();
        docB = loaded;
        nameB = file.name;
        if (nameSpanB) nameSpanB.textContent = nameB;
      }
      await runComparison();
    } catch (err) {
      onStatus?.(`Không đọc được tệp ${file.name}: ${err.message}`, true);
    }
  }

  function wireSyncScroll(paneA, paneB) {
    let syncing = false;
    const sync = (src, dst) => () => {
      if (!syncScroll || syncing) return;
      syncing = true;
      dst.scrollTop = src.scrollTop;
      dst.scrollLeft = src.scrollLeft;
      requestAnimationFrame(() => {
        syncing = false;
      });
    };
    paneA.addEventListener('scroll', sync(paneA, paneB), { passive: true });
    paneB.addEventListener('scroll', sync(paneB, paneA), { passive: true });
  }

  function scrollToPage(pageNumber) {
    const card = stageEl?.querySelector(`[data-cmp-page="${pageNumber}"]`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderSidebar() {
    if (!sideStatsEl || !diffListEl) return;
    sideStatsEl.replaceChildren();
    diffListEl.replaceChildren();

    if (!currentSummary) {
      diffListEl.append(el('p', { class: 'dlg-hint' }, 'Chọn đủ Tài liệu A và Tài liệu B để xem thống kê thay đổi từng trang.'));
      return;
    }

    sideStatsEl.append(
      el('div', { class: 'cmp-stat-box' },
        el('span', { class: 'cmp-stat-val' }, `${currentSummary.changedPages}/${currentSummary.totalPages}`),
        el('span', { class: 'cmp-stat-lbl' }, 'Trang khác'),
      ),
      el('div', { class: 'cmp-stat-box' },
        el('span', { class: 'cmp-stat-val', style: 'color:#16a34a' }, `+${currentSummary.totalAddedLines}`),
        el('span', { class: 'cmp-stat-lbl' }, 'Dòng thêm'),
      ),
      el('div', { class: 'cmp-stat-box' },
        el('span', { class: 'cmp-stat-val', style: 'color:#dc2626' }, `-${currentSummary.totalRemovedLines}`),
        el('span', { class: 'cmp-stat-lbl' }, 'Dòng xóa'),
      ),
    );

    const pagesToShow = onlyChanged
      ? currentSummary.pages.filter((p) => p.status !== 'unchanged')
      : currentSummary.pages;

    if (!pagesToShow.length) {
      diffListEl.append(el('p', { class: 'dlg-hint' }, 'Không có trang nào khác biệt. Hai tài liệu khớp nhau 100%!'));
      return;
    }

    for (const p of pagesToShow) {
      const changed = p.status !== 'unchanged';
      const badge = el(
        'span',
        { class: `cmp-badge ${changed ? 'diff' : 'same'}` },
        changed ? `+${p.addedLines} / -${p.removedLines} · ${p.mismatchPct}%` : 'Khớp 100%',
      );
      const snips = p.diffEntries
        .filter((e) => e.type !== 'same')
        .slice(0, 3)
        .map((e) => el('div', { class: `cmp-line-snip ${e.type}` }, `${e.type === 'added' ? '+' : '−'} ${e.text}`));

      const item = el(
        'button',
        {
          type: 'button',
          class: 'cmp-diff-item',
          onclick: () => scrollToPage(p.page),
        },
        el('div', { class: 'cmp-page-head', style: 'width:100%' }, el('span', {}, `Trang ${p.page}`), badge),
        ...snips,
      );
      diffListEl.append(item);
    }
  }

  async function runComparison() {
    if (!stageEl) return;
    const token = ++renderToken;
    stageEl.replaceChildren();

    if (!docA || !docB) {
      currentSummary = null;
      diffSnapshots = [];
      if (btnExportReport) btnExportReport.disabled = true;
      renderSidebar();
      stageEl.append(
        el('div', { class: 'cmp-empty' },
          el('h3', { style: 'margin:0 0 8px' }, 'So sánh 2 phiên bản PDF'),
          el('p', { class: 'dlg-hint', style: 'margin:0 0 16px' },
            docA
              ? `Đã nạp "${nameA}". Hãy chọn Tài liệu B (phiên bản mới) để đối chiếu tự động.`
              : 'Chọn Tài liệu gốc (A) và Tài liệu mới (B) để xem đối chiếu song song và khác biệt điểm ảnh Đỏ / Xanh.'),
          el('div', { style: 'display:flex;gap:8px;justify-content:center' },
            el('button', { type: 'button', class: 'cmp-btn', onclick: () => pickFile('a') }, icon('open', 15), docA ? 'Đổi PDF A' : 'Chọn PDF A'),
            el('button', { type: 'button', class: 'cmp-btn primary', onclick: () => pickFile('b') }, icon('open', 15), 'Chọn PDF B'),
          ),
        ),
      );
      return;
    }

    onStatus?.('Đang phân tích văn bản và điểm ảnh giữa 2 phiên bản PDF…');
    const total = Math.max(docA.numPages, docB.numPages);
    const pagesTextA = [];
    const pagesTextB = [];
    const pixelStats = [];
    const canvasesA = [];
    const canvasesB = [];
    const canvasesDiff = [];
    diffSnapshots = [];

    const renderScale = 1.15 * zoom;

    for (let i = 0; i < total; i++) {
      if (token !== renderToken) return;
      const [linesA, linesB, cA, cB] = await Promise.all([
        i < docA.numPages ? extractLinesFromPage(docA, i) : Promise.resolve([]),
        i < docB.numPages ? extractLinesFromPage(docB, i) : Promise.resolve([]),
        i < docA.numPages ? renderPageToCanvas(docA, i, renderScale) : Promise.resolve(null),
        i < docB.numPages ? renderPageToCanvas(docB, i, renderScale) : Promise.resolve(null),
      ]);
      pagesTextA.push(linesA);
      pagesTextB.push(linesB);

      const w = Math.max(cA?.width ?? 0, cB?.width ?? 0, 1);
      const h = Math.max(cA?.height ?? 0, cB?.height ?? 0, 1);

      const normCanvas = (src) => {
        if (src && src.width === w && src.height === h) return src;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        if (src) ctx.drawImage(src, 0, 0);
        return c;
      };

      const normA = normCanvas(cA);
      const normB = normCanvas(cB);
      const dataA = normA.getContext('2d').getImageData(0, 0, w, h).data;
      const dataB = normB.getContext('2d').getImageData(0, 0, w, h).data;
      const pDiff = computePixelDiff(dataA, dataB, w, h);
      pixelStats.push({ mismatchPct: pDiff.mismatchPct, changedPixels: pDiff.changedPixels });

      const diffCanvas = document.createElement('canvas');
      diffCanvas.width = w;
      diffCanvas.height = h;
      diffCanvas.getContext('2d').putImageData(new ImageData(pDiff.diffRgba, w, h), 0, 0);

      canvasesA.push(normA);
      canvasesB.push(normB);
      canvasesDiff.push(diffCanvas);
      if (pDiff.changedPixels > 0 || linesA.join('\n') !== linesB.join('\n')) {
        diffSnapshots[i] = diffCanvas.toDataURL('image/png');
      }
    }

    if (token !== renderToken) return;
    currentSummary = summarizeDocumentChanges(pagesTextA, pagesTextB, pixelStats);
    if (btnExportReport) btnExportReport.disabled = false;
    renderSidebar();

    if (mode === 'side') {
      const paneA = el('div', { class: 'cmp-pane' });
      const paneB = el('div', { class: 'cmp-pane' });
      for (let i = 0; i < total; i++) {
        const info = currentSummary.pages[i];
        const changed = info.status !== 'unchanged';
        paneA.append(
          el('div', { class: `cmp-page-card ${changed ? 'changed' : ''}`, 'data-cmp-page': i + 1 },
            el('div', { class: 'cmp-page-head' },
              el('span', {}, `Bản gốc A · Trang ${i + 1}`),
              el('span', { class: `cmp-badge ${changed ? 'diff' : 'same'}` }, changed ? `-${info.removedLines} dòng` : 'Khớp'),
            ),
            canvasesA[i],
          ),
        );
        paneB.append(
          el('div', { class: `cmp-page-card ${changed ? 'changed' : ''}` },
            el('div', { class: 'cmp-page-head' },
              el('span', {}, `Bản mới B · Trang ${i + 1}`),
              el('span', { class: `cmp-badge ${changed ? 'diff' : 'same'}` }, changed ? `+${info.addedLines} dòng · ${info.mismatchPct}%` : 'Khớp'),
            ),
            canvasesB[i],
          ),
        );
      }
      wireSyncScroll(paneA, paneB);
      stageEl.append(paneA, paneB);
    } else {
      const paneOverlay = el('div', { class: 'cmp-pane' });
      for (let i = 0; i < total; i++) {
        const info = currentSummary.pages[i];
        const changed = info.status !== 'unchanged';
        const chosenCanvas = overlayLayer === 'a' ? canvasesA[i] : overlayLayer === 'b' ? canvasesB[i] : canvasesDiff[i];
        paneOverlay.append(
          el('div', { class: `cmp-page-card ${changed ? 'changed' : ''}`, 'data-cmp-page': i + 1 },
            el('div', { class: 'cmp-page-head' },
              el('span', {}, `Chồng lớp · Trang ${i + 1} (Đỏ = Xóa ở A, Xanh lá = Thêm ở B)`),
              el('span', { class: `cmp-badge ${changed ? 'diff' : 'same'}` }, changed ? `Sai khác ${info.mismatchPct}%` : 'Khớp 100%'),
            ),
            chosenCanvas,
          ),
        );
      }
      stageEl.append(paneOverlay);
    }

    onStatus?.(`Hoàn tất so sánh: ${currentSummary.changedPages}/${currentSummary.totalPages} trang có thay đổi.`);
  }

  async function handleExportReport() {
    if (!currentSummary) return;
    try {
      onStatus?.('Đang kết xuất Báo cáo So sánh PDF…');
      const fontBytes = getFontBytes ? await getFontBytes() : null;
      const pdfBytes = await buildComparisonReportPdf({
        fileNameA: nameA,
        fileNameB: nameB,
        summary: currentSummary,
        diffPngDataUrls: diffSnapshots,
        fontBytes,
      });
      const outName = `Bao-cao-so-sanh-${(nameA || 'A').replace(/\.pdf$/i, '')}-vs-${(nameB || 'B').replace(/\.pdf$/i, '')}.pdf`;
      downloadFn?.(pdfBytes, outName);
      onStatus?.(`Đã xuất báo cáo so sánh "${outName}".`);
    } catch (err) {
      onStatus?.(`Không thể xuất báo cáo so sánh: ${err.message}`, true);
    }
  }

  function buildUi() {
    container.replaceChildren();
    fileInputA = el('input', {
      type: 'file',
      accept: 'application/pdf,.pdf',
      hidden: true,
      onchange: () => {
        const f = fileInputA.files?.[0];
        fileInputA.value = '';
        handlePickedFile('a', f);
      },
    });
    fileInputB = el('input', {
      type: 'file',
      accept: 'application/pdf,.pdf',
      hidden: true,
      onchange: () => {
        const f = fileInputB.files?.[0];
        fileInputB.value = '';
        handlePickedFile('b', f);
      },
    });

    nameSpanA = el('span', { class: 'cmp-file-name' }, nameA || 'Chọn PDF gốc (A)…');
    nameSpanB = el('span', { class: 'cmp-file-name' }, nameB || 'Chọn PDF mới (B)…');

    const btnSide = el('button', {
      type: 'button',
      class: mode === 'side' ? 'active' : '',
      onclick: () => {
        mode = 'side';
        btnSide.classList.add('active');
        btnOverlay.classList.remove('active');
        overlaySubSeg.classList.add('hidden');
        runComparison();
      },
    }, 'Song song');

    const btnOverlay = el('button', {
      type: 'button',
      class: mode === 'overlay' ? 'active' : '',
      onclick: () => {
        mode = 'overlay';
        btnOverlay.classList.add('active');
        btnSide.classList.remove('active');
        overlaySubSeg.classList.remove('hidden');
        runComparison();
      },
    }, 'Chồng lớp Diff');

    const makeLayerBtn = (id, label) => el('button', {
      type: 'button',
      class: overlayLayer === id ? 'active' : '',
      onclick: (e) => {
        overlayLayer = id;
        overlaySubSeg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        runComparison();
      },
    }, label);

    overlaySubSeg = el(
      'div',
      { class: `cmp-seg ${mode === 'overlay' ? '' : 'hidden'}` },
      makeLayerBtn('diff', 'Đỏ/Xanh'),
      makeLayerBtn('a', 'Chỉ bản A'),
      makeLayerBtn('b', 'Chỉ bản B'),
    );

    const zoomSel = el(
      'select',
      {
        class: 'cmp-btn',
        onchange: (e) => {
          zoom = Number(e.target.value) || 1;
          runComparison();
        },
      },
      [0.75, 1, 1.25, 1.5].map((z) => el('option', { value: z, selected: z === zoom }, `${Math.round(z * 100)}%`)),
    );

    const syncChk = el('input', {
      type: 'checkbox',
      checked: syncScroll,
      onchange: (e) => {
        syncScroll = e.target.checked;
      },
    });

    btnExportReport = el(
      'button',
      { type: 'button', class: 'cmp-btn primary', disabled: !currentSummary, onclick: handleExportReport },
      icon('download', 15),
      'Xuất Báo cáo PDF',
    );

    const topbar = el(
      'div',
      { class: 'cmp-topbar' },
      el('button', { type: 'button', class: 'cmp-file-pill', onclick: () => pickFile('a'), title: 'Chọn Tài liệu gốc (A)' },
        el('span', { class: 'cmp-file-tag tag-a' }, 'A'),
        nameSpanA,
      ),
      el('button', { type: 'button', class: 'cmp-file-pill', onclick: () => pickFile('b'), title: 'Chọn Tài liệu đối chiếu (B)' },
        el('span', { class: 'cmp-file-tag tag-b' }, 'B'),
        nameSpanB,
      ),
      el('div', { class: 'cmp-seg' }, btnSide, btnOverlay),
      overlaySubSeg,
      zoomSel,
      el('label', { style: 'display:inline-flex;align-items:center;gap:5px;font-size:12px;cursor:pointer' }, syncChk, 'Khóa cuộn'),
      el('span', { style: 'flex:1' }),
      btnExportReport,
      el('button', { type: 'button', class: 'cmp-btn', onclick: close }, icon('close', 15), 'Đóng'),
      fileInputA,
      fileInputB,
    );

    stageEl = el('div', { class: 'cmp-stage' });
    sideStatsEl = el('div', { class: 'cmp-stats-grid' });
    diffListEl = el('div', { class: 'cmp-diff-list' });

    const filterChk = el('input', {
      type: 'checkbox',
      checked: onlyChanged,
      onchange: (e) => {
        onlyChanged = e.target.checked;
        renderSidebar();
      },
    });

    const sidebar = el(
      'aside',
      { class: 'cmp-sidebar' },
      el('div', { class: 'cmp-side-head' },
        el('strong', { style: 'font-size:13px' }, 'Tóm tắt thay đổi'),
        sideStatsEl,
        el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);cursor:pointer' },
          filterChk,
          'Chỉ hiện trang có thay đổi',
        ),
      ),
      diffListEl,
    );

    container.append(topbar, el('div', { class: 'cmp-body' }, stageEl, sidebar));
  }

  async function open() {
    container.classList.remove('hidden');
    buildUi();

    const currentOpen = getOpenPdf?.();
    if (currentOpen?.bytes && !docA) {
      try {
        docA = await loadPdfFromBytes(currentOpen.bytes);
        nameA = currentOpen.fileName || 'Tai-lieu-hien-tai.pdf';
        if (nameSpanA) nameSpanA.textContent = nameA;
      } catch {
        // Ignore if open PDF cannot be cloned
      }
    }
    await runComparison();
  }

  function close() {
    renderToken++;
    docA?.destroy();
    docB?.destroy();
    docA = null;
    docB = null;
    nameA = '';
    nameB = '';
    currentSummary = null;
    diffSnapshots = [];
    container.classList.add('hidden');
    container.replaceChildren();
    onClose?.();
  }

  return {
    open,
    close,
    get isOpen() {
      return !container.classList.contains('hidden');
    },
  };
}
