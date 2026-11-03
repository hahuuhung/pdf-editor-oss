// 2-Mode Flatten PDF (Vector Searchable Flatten + Hard Raster 150-300 DPI Flatten)
// and Sequential Memory-Safe Multi-File Batch Pipeline (Watermark -> Bates -> Flatten -> Compress/AES-256 -> ZIP).

import { el, field, icon, openDialog } from './dom.js';
import { batesLabel, sanitizeHeaderFooter, sanitizeWatermark, todayLabel } from './docsettings.js';
import { zipFiles } from './extract.js';
import { compressPdf, encryptPdf } from './protect.js';

export const FLATTEN_MODES = Object.freeze(['vector', 'raster']);
export const RASTER_DPIS = Object.freeze([150, 200, 300]);
export const BATES_SLOTS = Object.freeze(['footerRight', 'footerCenter', 'footerLeft', 'headerRight', 'headerCenter', 'headerLeft']);

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function sanitizeFlattenOptions(raw = {}) {
  const mode = FLATTEN_MODES.includes(raw?.mode) ? raw.mode : 'vector';
  const dpiNum = Number(raw?.dpi) || 200;
  const dpi = RASTER_DPIS.includes(dpiNum) ? dpiNum : 200;
  const jpegQuality = clamp(Number(raw?.jpegQuality) || 0.88, 0.5, 1);
  return {
    mode,
    dpi,
    jpegQuality,
    keepLinks: raw?.keepLinks !== false,
    target: raw?.target === 'replace' ? 'replace' : 'download',
  };
}

export function sanitizeBatchPipeline(raw = {}) {
  const wm = raw?.watermark ?? {};
  const bt = raw?.bates ?? {};
  const fl = raw?.flatten ?? {};
  const pr = raw?.protect ?? {};
  const slot = BATES_SLOTS.includes(bt.position) ? bt.position : 'footerRight';

  return {
    watermark: {
      enabled: Boolean(wm.enabled && String(wm.text ?? '').trim()),
      text: String(wm.text ?? 'BẢN SAO KIỂM SOÁT').trim().slice(0, 120),
      fontSize: clamp(Number(wm.fontSize) || 52, 10, 160),
      color: /^#[0-9a-fA-F]{6}$/.test(wm.color ?? '') ? wm.color.toLowerCase() : '#64748b',
      opacity: clamp(Number(wm.opacity) || 0.22, 0.05, 1),
      angle: clamp(Number(wm.angle ?? 45), -90, 90),
    },
    bates: {
      enabled: Boolean(bt.enabled),
      prefix: String(bt.prefix ?? 'HS-').slice(0, 32),
      start: Math.max(0, Math.floor(Number(bt.start ?? 1) || 0)),
      digits: clamp(Math.floor(Number(bt.digits ?? 6) || 6), 1, 12),
      continuousAcrossFiles: bt.continuousAcrossFiles !== false,
      position: slot,
      fontSize: clamp(Number(bt.fontSize) || 10, 6, 28),
      color: /^#[0-9a-fA-F]{6}$/.test(bt.color ?? '') ? bt.color.toLowerCase() : '#1e293b',
    },
    flatten: {
      enabled: Boolean(fl.enabled),
      mode: FLATTEN_MODES.includes(fl.mode) ? fl.mode : 'vector',
      dpi: RASTER_DPIS.includes(Number(fl.dpi)) ? Number(fl.dpi) : 150,
    },
    compress: {
      enabled: Boolean(raw?.compress?.enabled),
    },
    protect: {
      enabled: Boolean(pr.enabled && String(pr.userPassword ?? '').length > 0),
      userPassword: String(pr.userPassword ?? ''),
      allowPrint: pr.allowPrint !== false,
      allowCopy: Boolean(pr.allowCopy),
    },
    fileNameSuffix: String(raw?.fileNameSuffix ?? '-batch').replace(/[\\/:*?"<>|]/g, '').slice(0, 40),
  };
}

// Plans starting and ending Bates numbers per file, supporting continuous cross-file sequences.
export function computeBatchBatesPlan(filePageCounts = [], batesOpts = {}) {
  const prefix = String(batesOpts.prefix ?? 'HS-');
  const baseStart = Math.max(0, Math.floor(Number(batesOpts.start ?? 1) || 0));
  const digits = clamp(Math.floor(Number(batesOpts.digits ?? 6) || 6), 1, 12);
  const continuous = batesOpts.continuousAcrossFiles !== false;

  let cursor = baseStart;
  return filePageCounts.map((rawCount, fileIndex) => {
    const pageCount = Math.max(0, Math.floor(Number(rawCount) || 0));
    const startNumber = continuous ? cursor : baseStart;
    const endNumber = pageCount > 0 ? startNumber + pageCount - 1 : startNumber;
    if (continuous) cursor += pageCount;
    return {
      fileIndex,
      pageCount,
      startNumber,
      endNumber,
      firstLabel: batesLabel(prefix, startNumber, digits, 0),
      lastLabel: batesLabel(prefix, startNumber, digits, Math.max(0, pageCount - 1)),
    };
  });
}

// Deduplicates output filenames inside a ZIP archive so identical basenames never overwrite each other.
export function buildOutputFileName(originalName, suffix = '', usedNames = new Set()) {
  const cleanBase = String(originalName || 'document.pdf')
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim() || 'document';
  const cleanSuffix = String(suffix ?? '').replace(/[\\/:*?"<>|]/g, '');

  let candidate = `${cleanBase}${cleanSuffix}.pdf`;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${cleanBase}${cleanSuffix} (${counter}).pdf`;
    counter++;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

// Strips interactive annotations (optionally preserving safe Link annotations) and flattens AcroForm fields.
export async function vectorFlattenPdfBytes(pdfBytes, { keepLinks = true } = {}) {
  const doc = await PDFLib.PDFDocument.load(pdfBytes);
  try {
    doc.getForm().flatten();
  } catch {
    // Document may have no AcroForm dictionary or non-standard widgets
  }

  const annotsKey = PDFLib.PDFName.of('Annots');
  const subtypeKey = PDFLib.PDFName.of('Subtype');
  const linkName = PDFLib.PDFName.of('Link');

  for (const page of doc.getPages()) {
    if (!keepLinks) {
      page.node.delete(annotsKey);
      continue;
    }
    const rawAnnots = page.node.lookupMaybe(annotsKey, PDFLib.PDFArray);
    if (!rawAnnots) continue;
    const kept = [];
    for (let i = 0; i < rawAnnots.size(); i++) {
      const ref = rawAnnots.get(i);
      const dict = doc.context.lookupMaybe(ref, PDFLib.PDFDict);
      const subtype = dict?.lookup(subtypeKey);
      if (subtype === linkName || subtype?.toString?.() === '/Link') kept.push(ref);
    }
    if (kept.length) {
      page.node.set(annotsKey, doc.context.obj(kept));
    } else {
      page.node.delete(annotsKey);
    }
  }

  return doc.save();
}

// Renders each page sequentially to a high-DPI JPEG and rebuilds an uneditable image-only PDF without OOM.
export async function rasterFlattenPdfBytes(pdfBytes, { dpi = 200, jpegQuality = 0.88, onPage } = {}) {
  const scale = clamp(Number(dpi) || 200, 72, 300) / 72;
  const srcDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
  const outDoc = await PDFLib.PDFDocument.create();

  try {
    for (let p = 1; p <= srcDoc.numPages; p++) {
      onPage?.(p, srcDoc.numPages);
      const page = await srcDoc.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      const vpRender = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(vpRender.width));
      canvas.height = Math.max(1, Math.round(vpRender.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport: vpRender }).promise;
      const jpgDataUrl = canvas.toDataURL('image/jpeg', clamp(jpegQuality, 0.5, 1));

      // Release backing bitmap memory immediately before moving to next page
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup?.();

      const jpgImg = await outDoc.embedJpg(jpgDataUrl);
      const outPage = outDoc.addPage([vp1.width, vp1.height]);
      outPage.drawImage(jpgImg, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    }
  } finally {
    srcDoc.destroy();
  }

  return outDoc.save();
}

export async function flattenPdfBytes(pdfBytes, rawOptions = {}, onPage) {
  const opts = sanitizeFlattenOptions(rawOptions);
  if (opts.mode === 'raster') {
    return rasterFlattenPdfBytes(pdfBytes, { dpi: opts.dpi, jpegQuality: opts.jpegQuality, onPage });
  }
  return vectorFlattenPdfBytes(pdfBytes, { keepLinks: opts.keepLinks });
}

// Executes the sequential batch pipeline over an array of { name, bytes, pageCount } items safely.
export async function executeBatchPipeline(items, rawPipeline, { fontBytes = null, onProgress, isCancelled } = {}) {
  const pipe = sanitizeBatchPipeline(rawPipeline);
  const batesPlan = computeBatchBatesPlan(items.map((it) => it.pageCount ?? 0), pipe.bates);
  const usedNames = new Set();
  const outputs = [];

  for (let i = 0; i < items.length; i++) {
    if (isCancelled?.()) throw new Error('Đã dừng tiến trình xử lý hàng loạt.');
    const item = items[i];
    onProgress?.({ fileIndex: i, totalFiles: items.length, fileName: item.name, step: 'Đang đóng dấu & biểu mẫu…' });

    let bytes = item.bytes;

    // Step 1 & 2: Watermark + Cross-file / Per-file Bates Stamp via vector exporter
    const watermark = pipe.watermark.enabled ? sanitizeWatermark(pipe.watermark) : null;
    let headerFooter = null;
    if (pipe.bates.enabled) {
      const startNum = batesPlan[i]?.startNumber ?? pipe.bates.start;
      headerFooter = sanitizeHeaderFooter({
        [pipe.bates.position]: '{bates}',
        batesPrefix: pipe.bates.prefix,
        batesStart: startNum,
        batesDigits: pipe.bates.digits,
        fontSize: pipe.bates.fontSize,
        color: pipe.bates.color,
        margin: 22,
      });
    }

    if (watermark || headerFooter) {
      const { exportPdf } = await import('./export.js');
      bytes = await exportPdf(bytes, [], {
        fontBytes,
        marks: [],
        settings: { watermark, headerFooter },
        context: { file: item.name, date: todayLabel() },
      });
    }

    // Step 3: Vector or Raster Flatten
    if (pipe.flatten.enabled) {
      onProgress?.({ fileIndex: i, totalFiles: items.length, fileName: item.name, step: 'Đang làm phẳng trang…' });
      bytes = await flattenPdfBytes(bytes, { mode: pipe.flatten.mode, dpi: pipe.flatten.dpi });
    }

    // Step 4a: Lossless QPDF stream compression (skipped if AES-256 encrypt runs right after, or run before encrypt)
    if (pipe.compress.enabled) {
      onProgress?.({ fileIndex: i, totalFiles: items.length, fileName: item.name, step: 'Đang tối ưu dung lượng…' });
      bytes = await compressPdf(bytes);
    }

    // Step 4b: AES-256 Password Encryption
    if (pipe.protect.enabled) {
      onProgress?.({ fileIndex: i, totalFiles: items.length, fileName: item.name, step: 'Đang mã hóa AES-256…' });
      bytes = await encryptPdf(bytes, {
        userPassword: pipe.protect.userPassword,
        allowPrint: pipe.protect.allowPrint,
        allowCopy: pipe.protect.allowCopy,
        allowModify: false,
      });
    }

    outputs.push({
      name: buildOutputFileName(item.name, pipe.fileNameSuffix, usedNames),
      data: bytes,
    });
  }

  return outputs;
}

// Modal dialog for 2-Mode Flatten PDF on the currently open document.
export function openFlattenDialog({ fileName, onRun }) {
  let mode = 'vector';
  const dpiSel = el('select', {},
    el('option', { value: '150' }, '150 DPI (Nhẹ, gửi email nhanh)'),
    el('option', { value: '200', selected: true }, '200 DPI (Cân bằng sắc nét & dung lượng)'),
    el('option', { value: '300' }, '300 DPI (Chuẩn in ấn lưu trữ)'),
  );
  const keepLinksChk = el('input', { type: 'checkbox', checked: true });
  const targetSel = el('select', {},
    el('option', { value: 'download', selected: true }, 'Xuất thành tệp PDF mới (Giữ nguyên bản đang sửa)'),
    el('option', { value: 'replace' }, 'Áp dụng trực tiếp vào tài liệu đang mở (Có thể Ctrl+Z)'),
  );

  const vectorOptsBox = el('div', { style: 'margin-bottom:10px' },
    el('label', { style: 'display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer' },
      keepLinksChk,
      'Giữ lại các liên kết web (Hyperlinks) trên trang',
    ),
  );
  const rasterOptsBox = el('div', { class: 'hidden', style: 'margin-bottom:10px' },
    field('Độ phân giải ảnh hóa (Raster DPI)', dpiSel, 'Mỗi trang sẽ được chuyển thành một lớp ảnh phẳng duy nhất, chống sao chép hay bóc tách chữ/chữ ký.'),
  );

  const vecCard = el('div', { class: 'flt-card active' },
    el('div', { class: 'flt-card-title' }, icon('check', 16), 'Làm phẳng Vector (Khuyên dùng)'),
    el('div', { class: 'flt-card-desc' }, 'Hàn cứng ô biểu mẫu AcroForm, chữ ký, hộp chữ và chú thích vào trang nhưng vẫn giữ văn bản gốc sắc nét, tìm kiếm (Ctrl+F) được.'),
  );
  const rasCard = el('div', { class: 'flt-card' },
    el('div', { class: 'flt-card-title' }, icon('lock', 16), 'Làm phẳng Ảnh cứng (Hard Raster)'),
    el('div', { class: 'flt-card-desc' }, 'Biến toàn bộ trang thành ảnh phẳng 150–300 DPI. Chống chỉnh sửa nội dung, chống tách lớp con dấu & chữ ký tuyệt đối.'),
  );

  const selectMode = (next) => {
    mode = next;
    vecCard.classList.toggle('active', mode === 'vector');
    rasCard.classList.toggle('active', mode === 'raster');
    vectorOptsBox.classList.toggle('hidden', mode !== 'vector');
    rasterOptsBox.classList.toggle('hidden', mode !== 'raster');
  };
  vecCard.onclick = () => selectMode('vector');
  rasCard.onclick = () => selectMode('raster');

  openDialog({
    title: 'Làm phẳng tài liệu PDF (Flatten)',
    subtitle: fileName || 'Khóa cố định biểu mẫu, chữ ký và lớp chú thích',
    icon: 'flatten',
    width: 540,
    body: el('div', {},
      el('div', { class: 'flt-modes' }, vecCard, rasCard),
      vectorOptsBox,
      rasterOptsBox,
      field('Đích xuất kết quả', targetSel),
    ),
    actions: [
      { label: 'Hủy' },
      {
        label: 'Làm phẳng ngay',
        primary: true,
        run: () => onRun?.(sanitizeFlattenOptions({
          mode,
          dpi: Number(dpiSel.value),
          keepLinks: keepLinksChk.checked,
          target: targetSel.value,
        })),
      },
    ],
  });
}

// Modal dialog for Multi-PDF Sequential Batch Pipeline.
export function openBatchDialog({ getOpenPdf, getFontBytes, downloadFn, onStatus }) {
  const queue = []; // Array<{ name, bytes, pageCount }>
  let running = false;
  let cancelled = false;

  const listEl = el('div', { class: 'batch-file-list' });
  const batesPreviewHint = el('span', { class: 'dlg-hint' });
  const errEl = el('p', { class: 'dlg-error' });
  const progWrap = el('div', { class: 'batch-progress-wrap hidden' });
  const progFill = el('div', { class: 'batch-progress-fill' });
  const progText = el('span', { class: 'dlg-hint' }, 'Đang chuẩn bị…');
  progWrap.append(progText, el('div', { class: 'batch-progress-bar' }, progFill));

  // Pipeline controls
  const wmEnable = el('input', { type: 'checkbox' });
  const wmText = el('input', { type: 'text', value: 'BẢN SAO KIỂM SOÁT' });
  const wmColor = el('input', { type: 'color', value: '#64748b' });
  const wmOpacity = el('input', { type: 'number', min: 0.05, max: 1, step: 0.05, value: '0.22' });

  const btEnable = el('input', { type: 'checkbox', checked: true });
  const btPrefix = el('input', { type: 'text', value: 'HS-' });
  const btStart = el('input', { type: 'number', min: 0, step: 1, value: '1' });
  const btDigits = el('input', { type: 'number', min: 1, max: 12, step: 1, value: '6' });
  const btCont = el('input', { type: 'checkbox', checked: true });
  const btPos = el('select', {},
    el('option', { value: 'footerRight', selected: true }, 'Chân trang - Góc phải'),
    el('option', { value: 'footerCenter' }, 'Chân trang - Chính giữa'),
    el('option', { value: 'headerRight' }, 'Đầu trang - Góc phải'),
    el('option', { value: 'headerLeft' }, 'Đầu trang - Góc trái'),
  );

  const flEnable = el('input', { type: 'checkbox', checked: true });
  const flMode = el('select', {},
    el('option', { value: 'vector', selected: true }, 'Vector Flatten (Giữ chữ tìm kiếm, khóa form & chú thích)'),
    el('option', { value: 'raster' }, 'Hard Raster 150 DPI (Ảnh hóa toàn trang chống sửa)'),
  );

  const cmpEnable = el('input', { type: 'checkbox' });
  const prEnable = el('input', { type: 'checkbox' });
  const prPass = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Nhập mật khẩu mở tệp AES-256…' });
  const suffixInput = el('input', { type: 'text', value: '-da-xu-ly' });

  function updateBatesPreview() {
    if (!queue.length || !btEnable.checked) {
      batesPreviewHint.textContent = '';
      return;
    }
    const plan = computeBatchBatesPlan(
      queue.map((f) => f.pageCount),
      {
        prefix: btPrefix.value,
        start: Number(btStart.value),
        digits: Number(btDigits.value),
        continuousAcrossFiles: btCont.checked,
      },
    );
    const first = plan[0]?.firstLabel ?? '';
    const last = plan.at(-1)?.lastLabel ?? '';
    batesPreviewHint.textContent = btCont.checked
      ? `Dải số liên tục xuyên ${queue.length} tệp: ${first} → ${last}`
      : `Đánh lại từ ${first} cho mỗi tệp.`;
  }

  for (const ctrl of [btEnable, btPrefix, btStart, btDigits, btCont]) {
    ctrl.addEventListener('input', updateBatesPreview);
    ctrl.addEventListener('change', updateBatesPreview);
  }

  function renderQueue() {
    listEl.replaceChildren();
    if (!queue.length) {
      listEl.append(el('p', { class: 'dlg-hint', style: 'padding:12px;margin:0;text-align:center' }, 'Chưa có tệp PDF nào trong danh sách chờ.'));
      updateBatesPreview();
      return;
    }
    queue.forEach((item, idx) => {
      listEl.append(
        el('div', { class: 'batch-file-row' },
          el('span', { style: 'color:var(--muted);width:20px' }, `${idx + 1}.`),
          el('span', { class: 'batch-file-name' }, item.name),
          el('span', { class: 'badge' }, `${item.pageCount} trang`),
          el('button', {
            type: 'button',
            title: 'Đưa lên',
            disabled: idx === 0 || running,
            onclick: () => {
              [queue[idx - 1], queue[idx]] = [queue[idx], queue[idx - 1]];
              renderQueue();
            },
          }, '▲'),
          el('button', {
            type: 'button',
            title: 'Đưa xuống',
            disabled: idx === queue.length - 1 || running,
            onclick: () => {
              [queue[idx + 1], queue[idx]] = [queue[idx], queue[idx + 1]];
              renderQueue();
            },
          }, '▼'),
          el('button', {
            type: 'button',
            title: 'Bỏ khỏi danh sách',
            disabled: running,
            style: 'color:var(--danger)',
            onclick: () => {
              queue.splice(idx, 1);
              renderQueue();
            },
          }, '✕'),
        ),
      );
    });
    updateBatesPreview();
  }

  async function addRawBytes(name, bytes) {
    try {
      const doc = await PDFLib.PDFDocument.load(bytes);
      queue.push({ name, bytes, pageCount: doc.getPageCount() });
      errEl.textContent = '';
      renderQueue();
    } catch {
      errEl.textContent = `Không đọc được "${name}" (tệp bị hỏng hoặc đang khóa mật khẩu).`;
    }
  }

  async function addFiles(fileList) {
    for (const f of fileList) {
      const buf = new Uint8Array(await f.arrayBuffer());
      await addRawBytes(f.name, buf);
    }
  }

  const openDoc = getOpenPdf?.();
  if (openDoc?.bytes) {
    addRawBytes(openDoc.fileName || 'document.pdf', openDoc.bytes);
  } else {
    renderQueue();
  }

  const picker = el('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    multiple: true,
    hidden: true,
    onchange: () => {
      if (picker.files?.length) addFiles([...picker.files]);
      picker.value = '';
    },
  });

  const dropBox = el(
    'div',
    {
      class: 'batch-drop',
      onclick: () => !running && picker.click(),
      ondragover: (e) => {
        e.preventDefault();
        dropBox.classList.add('dragover');
      },
      ondragleave: () => dropBox.classList.remove('dragover'),
      ondrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropBox.classList.remove('dragover');
        if (!running && e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]);
      },
    },
    el('strong', { style: 'font-size:13px' }, '+ Nhấp hoặc kéo thả nhiều tệp PDF vào đây'),
    el('div', { class: 'dlg-hint' }, 'Xử lý tuần tự từng tệp an toàn bộ nhớ RAM — đóng gói kết quả thành 1 tệp .zip'),
  );

  function makeStepCard(chk, titleText, bodyNode) {
    const bodyWrap = el('div', { class: `batch-step-body ${chk.checked ? '' : 'hidden'}` }, bodyNode);
    chk.addEventListener('change', () => bodyWrap.classList.toggle('hidden', !chk.checked));
    return el('div', { class: 'batch-step' },
      el('label', { class: 'batch-step-head' },
        el('span', { style: 'display:flex;align-items:center;gap:8px' }, chk, titleText),
      ),
      bodyWrap,
    );
  }

  const stepsEl = el(
    'div',
    { class: 'batch-steps' },
    makeStepCard(
      wmEnable,
      'Bước 1: Đóng dấu mờ (Watermark)',
      el('div', { class: 'dlg-grid' },
        field('Nội dung chữ chìm', wmText),
        field('Màu chữ', wmColor),
        field('Độ mờ (0.05 – 1.0)', wmOpacity),
      ),
    ),
    makeStepCard(
      btEnable,
      'Bước 2: Đánh số nhảy hồ sơ Bates',
      el('div', {},
        el('div', { class: 'dlg-grid' },
          field('Tiền tố', btPrefix),
          field('Số bắt đầu', btStart),
          field('Số chữ số', btDigits),
          field('Vị trí đóng số', btPos),
        ),
        el('label', { style: 'display:flex;align-items:center;gap:7px;font-size:12px;margin-top:6px;cursor:pointer' },
          btCont,
          'Đánh số liên tục xuyên suốt từ tệp 1 sang tệp cuối (thay vì đếm lại cho từng tệp)',
        ),
        batesPreviewHint,
      ),
    ),
    makeStepCard(
      flEnable,
      'Bước 3: Làm phẳng tài liệu (Flatten)',
      field('Chế độ làm phẳng', flMode),
    ),
    makeStepCard(
      cmpEnable,
      'Bước 4a: Nén giảm dung lượng cấu trúc (QPDF)',
      el('p', { class: 'dlg-hint', style: 'margin:0' }, 'Nén luồng đối tượng không suy giảm chất lượng chữ/ảnh.'),
    ),
    makeStepCard(
      prEnable,
      'Bước 4b: Khóa mật khẩu chuẩn AES-256',
      field('Mật khẩu mở tệp áp dụng chung', prPass),
    ),
    el('div', { class: 'dlg-grid', style: 'padding:4px 2px' },
      field('Hậu tố tên tệp xuất ra', suffixInput),
    ),
  );

  let closeDlg = () => {};
  closeDlg = openDialog({
    title: 'Xử lý Hàng loạt PDF (Batch Pipeline)',
    subtitle: 'Chuỗi tác vụ tự động tuần tự cho bộ hồ sơ nhiều tệp',
    icon: 'layers',
    width: 620,
    onClose: () => {
      cancelled = true;
    },
    body: el('div', {}, picker, dropBox, listEl, stepsEl, progWrap, errEl),
    actions: [
      {
        label: 'Đóng',
        run: () => {
          cancelled = true;
        },
      },
      {
        label: 'Chạy Batch & Tải về',
        primary: true,
        run: async () => {
          if (running) return false;
          if (!queue.length) {
            errEl.textContent = 'Hãy thêm ít nhất 1 tệp PDF vào danh sách.';
            return false;
          }
          if (prEnable.checked && !prPass.value) {
            errEl.textContent = 'Hãy nhập mật khẩu AES-256 hoặc tắt Bước 4b.';
            return false;
          }
          running = true;
          cancelled = false;
          errEl.textContent = '';
          progWrap.classList.remove('hidden');

          try {
            const needUnicode = (wmEnable.checked && wmText.value) || (btEnable.checked && btPrefix.value);
            const fontBytes = needUnicode && getFontBytes ? await getFontBytes() : null;
            const outputs = await executeBatchPipeline(
              queue,
              {
                watermark: {
                  enabled: wmEnable.checked,
                  text: wmText.value,
                  color: wmColor.value,
                  opacity: Number(wmOpacity.value),
                },
                bates: {
                  enabled: btEnable.checked,
                  prefix: btPrefix.value,
                  start: Number(btStart.value),
                  digits: Number(btDigits.value),
                  continuousAcrossFiles: btCont.checked,
                  position: btPos.value,
                },
                flatten: {
                  enabled: flEnable.checked,
                  mode: flMode.value,
                  dpi: 150,
                },
                compress: { enabled: cmpEnable.checked },
                protect: {
                  enabled: prEnable.checked,
                  userPassword: prPass.value,
                  allowPrint: true,
                  allowCopy: false,
                },
                fileNameSuffix: suffixInput.value,
              },
              {
                fontBytes,
                isCancelled: () => cancelled,
                onProgress: ({ fileIndex, totalFiles, fileName, step }) => {
                  const pct = Math.round(((fileIndex + 0.5) / totalFiles) * 100);
                  progFill.style.width = `${pct}%`;
                  progText.textContent = `[${fileIndex + 1}/${totalFiles}] ${fileName} — ${step}`;
                },
              },
            );

            progFill.style.width = '100%';
            if (outputs.length === 1) {
              downloadFn?.(outputs[0].data, outputs[0].name, 'application/pdf');
              onStatus?.(`Đã xử lý xong "${outputs[0].name}".`);
            } else {
              progText.textContent = `Đang đóng gói ${outputs.length} tệp vào gói .zip…`;
              const zipBlob = await zipFiles(outputs);
              downloadFn?.(zipBlob, `Ho-so-batch-${outputs.length}-tep.zip`, 'application/zip');
              onStatus?.(`Đã xử lý hàng loạt ${outputs.length} tệp PDF và tải xuống gói .zip!`);
            }
          } catch (err) {
            running = false;
            errEl.textContent = err.message;
            return false;
          }
          running = false;
          return true;
        },
      },
    ],
  });
}
