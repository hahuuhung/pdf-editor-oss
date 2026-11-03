// Công cụ Sửa văn bản gốc trực tiếp trên trang PDF (Inline PDF Text Edit).
// Cơ chế Smart Mask + Unicode Overlay:
// 1. Gom các text run trên trang thành từng cụm dòng/cột độc lập (clusterEditableLines).
// 2. Khi nhấp sửa, tự động lấy mẫu màu nền giấy (sampleBackgroundHex) và màu mực chữ gốc (sampleForegroundHex).
// 3. Nếu nội dung thay đổi, phủ sạch chữ gốc bằng hình chữ nhật cùng màu nền và đặt hộp chữ Unicode mới lên trên.

import { el } from './dom.js';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function rgbToHex(r, g, b) {
  const hex = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hexToRgbTuple(hex) {
  if (!HEX_RE.test(hex ?? '')) return [255, 255, 255];
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function medianOf(arr) {
  if (!arr.length) return 255;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Gom các mảnh văn bản PDF (view space: { str, x, y, w, h }) thành các khối dòng có thể nhấp sửa.
 * Tự động tách riêng các cột nằm xa nhau trên cùng một hàng ngang để không đè nhầm cột bên cạnh.
 */
export function clusterEditableLines(items = []) {
  const valid = items
    .map((it) => ({
      str: String(it.str ?? it.text ?? ''),
      x: Number(it.x) || 0,
      y: Number(it.y) || 0,
      w: Math.max(0, Number(it.w) || 0),
      h: Math.max(2, Number(it.h) || 12),
    }))
    .filter((it) => it.str.trim().length > 0)
    .sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);

  // Gom theo hàng ngang có cùng tâm dọc
  const rows = [];
  for (const it of valid) {
    const mid = it.y + it.h / 2;
    const row = rows.find((r) => Math.abs(r.mid - mid) < Math.max(r.h, it.h) * 0.48);
    if (row) {
      row.items.push(it);
      row.h = Math.max(row.h, it.h);
      row.mid = (row.mid * (row.items.length - 1) + mid) / row.items.length;
    } else {
      rows.push({ mid, h: it.h, items: [it] });
    }
  }

  // Tách từng hàng thành các cụm cột nếu khoảng cách ngang quá lớn (> 2.2 lần chiều cao dòng hoặc > 26pt)
  const blocks = [];
  let seq = 1;
  for (const row of rows.sort((a, b) => a.mid - b.mid)) {
    const sortedRow = row.items.sort((a, b) => a.x - b.x);
    const segments = [];
    for (const it of sortedRow) {
      const prev = segments.at(-1);
      const maxGap = Math.max(row.h * 2.2, 26);
      if (prev && it.x - prev.right <= maxGap) {
        const gap = it.x - prev.right;
        if (gap > row.h * 0.14 && !prev.text.endsWith(' ') && !it.str.startsWith(' ')) {
          prev.text += ' ';
        }
        prev.text += it.str;
        prev.x = Math.min(prev.x, it.x);
        prev.y = Math.min(prev.y, it.y);
        prev.right = Math.max(prev.right, it.x + it.w);
        prev.bottom = Math.max(prev.bottom, it.y + it.h);
        prev.heights.push(it.h);
      } else {
        segments.push({
          text: it.str,
          x: it.x,
          y: it.y,
          right: it.x + it.w,
          bottom: it.y + it.h,
          heights: [it.h],
        });
      }
    }

    for (const seg of segments) {
      const cleanText = seg.text.replace(/\s+/g, ' ').trim();
      if (!cleanText) continue;
      const medH = medianOf(seg.heights);
      // textItemsOf nhân chiều cao với 1.15, nên chia 1.15 để khôi phục đúng cỡ chữ pt gốc
      const fontSize = Math.round(clamp(medH / 1.15, 6, 72) * 2) / 2;
      blocks.push({
        id: `inl-${seq++}`,
        text: cleanText,
        x: Math.round(seg.x * 100) / 100,
        y: Math.round(seg.y * 100) / 100,
        w: Math.max(8, Math.round((seg.right - seg.x) * 100) / 100),
        h: Math.max(6, Math.round((seg.bottom - seg.y) * 100) / 100),
        fontSize,
      });
    }
  }
  return blocks;
}

/**
 * Lấy mẫu màu nền trung vị (Median RGB) từ viền ngoài vùng chữ trên bộ đệm ảnh RGBA của Canvas.
 */
export function sampleBackgroundHex(rgbaData, imgWidth, imgHeight, rectPx) {
  if (!rgbaData || !imgWidth || !imgHeight || !rectPx) return '#ffffff';
  const x0 = clamp(Math.floor(rectPx.x) - 2, 0, imgWidth - 1);
  const y0 = clamp(Math.floor(rectPx.y) - 2, 0, imgHeight - 1);
  const x1 = clamp(Math.ceil(rectPx.x + rectPx.w) + 2, 0, imgWidth - 1);
  const y1 = clamp(Math.ceil(rectPx.y + rectPx.h) + 2, 0, imgHeight - 1);

  const rs = [];
  const gs = [];
  const bs = [];
  const pushPixel = (px, py) => {
    const idx = (py * imgWidth + px) * 4;
    if (rgbaData[idx + 3] < 16) return; // Bỏ qua điểm trong suốt
    rs.push(rgbaData[idx]);
    gs.push(rgbaData[idx + 1]);
    bs.push(rgbaData[idx + 2]);
  };

  for (let x = x0; x <= x1; x += 2) {
    pushPixel(x, y0);
    pushPixel(x, y1);
  }
  for (let y = y0 + 1; y < y1; y += 2) {
    pushPixel(x0, y);
    pushPixel(x1, y);
  }

  if (!rs.length) return '#ffffff';
  return rgbToHex(medianOf(rs), medianOf(gs), medianOf(bs));
}

/**
 * Lấy mẫu màu chữ gốc (Foreground Ink Color) bằng cách tìm nhóm điểm ảnh tương phản mạnh nhất với nền.
 */
export function sampleForegroundHex(rgbaData, imgWidth, imgHeight, rectPx, bgHex = '#ffffff') {
  if (!rgbaData || !imgWidth || !imgHeight || !rectPx) return '#000000';
  const [br, bg, bb] = hexToRgbTuple(bgHex);
  const x0 = clamp(Math.floor(rectPx.x), 0, imgWidth - 1);
  const y0 = clamp(Math.floor(rectPx.y), 0, imgHeight - 1);
  const x1 = clamp(Math.ceil(rectPx.x + rectPx.w), 0, imgWidth - 1);
  const y1 = clamp(Math.ceil(rectPx.y + rectPx.h), 0, imgHeight - 1);

  const candidates = [];
  const stepX = Math.max(1, Math.floor((x1 - x0) / 40));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 12));

  for (let y = y0; y <= y1; y += stepY) {
    for (let x = x0; x <= x1; x += stepX) {
      const idx = (y * imgWidth + x) * 4;
      if (rgbaData[idx + 3] < 128) continue;
      const r = rgbaData[idx];
      const g = rgbaData[idx + 1];
      const b = rgbaData[idx + 2];
      const dist = Math.hypot(r - br, g - bg, b - bb);
      if (dist > 65) candidates.push({ r, g, b, dist });
    }
  }

  if (!candidates.length) return '#000000';
  candidates.sort((a, b) => b.dist - a.dist);
  const top = candidates.slice(0, Math.max(1, Math.ceil(candidates.length * 0.35)));
  return rgbToHex(
    medianOf(top.map((c) => c.r)),
    medianOf(top.map((c) => c.g)),
    medianOf(top.map((c) => c.b)),
  );
}

/**
 * Xây dựng dữ liệu thay thế (Smart Mask rect + Hộp chữ Unicode mới) khi người dùng sửa một khối dòng.
 * Trả về null nếu văn bản không thay đổi so với gốc.
 */
export function buildInlineReplacement({
  page,
  block,
  newText,
  bgHex = '#ffffff',
  fgHex = '#000000',
  markId = 'm1',
  boxId = 1,
}) {
  const cleanedNew = String(newText ?? '').replace(/\r/g, '');
  if (cleanedNew.trim() === block.text.trim() && !cleanedNew.includes('\n')) {
    return null;
  }

  const padX = 1.8;
  const padY = 1.2;
  const maskMark = {
    id: markId,
    type: 'rect',
    page,
    x: Math.max(0, Math.round((block.x - padX) * 100) / 100),
    y: Math.max(0, Math.round((block.y - padY) * 100) / 100),
    w: Math.round((block.w + padX * 2) * 100) / 100,
    h: Math.round((block.h + padY * 2) * 100) / 100,
    color: HEX_RE.test(bgHex) ? bgHex : '#ffffff',
    fill: HEX_RE.test(bgHex) ? bgHex : '#ffffff',
    width: 0.5,
    opacity: 1,
    text: '',
    label: 'inline-mask',
  };

  if (!cleanedNew.trim()) {
    // Người dùng xóa trắng dòng chữ gốc -> chỉ đặt lớp phủ màu nền để xóa sạch chữ cũ
    return { maskMark, textBox: null };
  }

  const textBox = {
    id: boxId,
    page,
    x: block.x,
    y: Math.max(0, Math.round((block.y + (block.h - block.fontSize * 1.15) * 0.35) * 100) / 100),
    text: cleanedNew,
    fontSize: block.fontSize,
    color: HEX_RE.test(fgHex) ? fgHex : '#000000',
  };

  return { maskMark, textBox };
}

/**
 * Bộ điều khiển giao diện cho công cụ `editPdfText` trên các trang PDF.
 */
export function createInlineTextEditor({
  state,
  getPageTextItems,
  applyInlineReplacement,
  onStatus,
}) {
  const lineCache = new Map(); // pageIndex -> blocks[]
  let activeSession = null;

  function clearCache() {
    lineCache.clear();
    activeSession = null;
  }

  function sampleColorsFromPageCanvas(pageDiv, block, pageSize) {
    const canvas = pageDiv?.querySelector('canvas');
    if (!canvas || !canvas.width || !canvas.height) {
      return { bgHex: '#ffffff', fgHex: '#000000' };
    }
    try {
      const ctx = canvas.getContext('2d');
      const scaleX = canvas.width / pageSize.width;
      const scaleY = canvas.height / pageSize.height;
      const rx = Math.max(0, Math.floor((block.x - 4) * scaleX));
      const ry = Math.max(0, Math.floor((block.y - 4) * scaleY));
      const rw = Math.min(canvas.width - rx, Math.ceil((block.w + 8) * scaleX));
      const rh = Math.min(canvas.height - ry, Math.ceil((block.h + 8) * scaleY));
      if (rw <= 2 || rh <= 2) return { bgHex: '#ffffff', fgHex: '#000000' };

      const img = ctx.getImageData(rx, ry, rw, rh);
      const localRect = {
        x: block.x * scaleX - rx,
        y: block.y * scaleY - ry,
        w: block.w * scaleX,
        h: block.h * scaleY,
      };
      const bgHex = sampleBackgroundHex(img.data, rw, rh, localRect);
      const fgHex = sampleForegroundHex(img.data, rw, rh, localRect, bgHex);
      return { bgHex, fgHex };
    } catch {
      return { bgHex: '#ffffff', fgHex: '#000000' };
    }
  }

  // Kiểm tra xem khối dòng gốc này đã bị che bởi một inline-mask trước đó chưa
  function isBlockAlreadyMasked(pageIndex, block) {
    const cx = block.x + block.w / 2;
    const cy = block.y + block.h / 2;
    return state.marks.some(
      (m) =>
        m.page === pageIndex &&
        m.type === 'rect' &&
        m.label === 'inline-mask' &&
        cx >= m.x &&
        cx <= m.x + m.w &&
        cy >= m.y &&
        cy <= m.y + m.h,
    );
  }

  function openBlockEditor(pageIndex, pageDiv, slotEl, block) {
    if (activeSession) activeSession.finish(true);
    const pageSize = state.pageSizes[pageIndex];
    const { bgHex, fgHex } = sampleColorsFromPageCanvas(pageDiv, block, pageSize);
    const z = state.zoom;

    const editor = el('div', {
      class: 'inline-edit-active',
      contenteditable: 'true',
      spellcheck: 'false',
      style: [
        `left:${(block.x - 2) * z}px`,
        `top:${(block.y - 1.5) * z}px`,
        `min-width:${(block.w + 8) * z}px`,
        `min-height:${(block.h + 3) * z}px`,
        `font-size:${block.fontSize * z}px`,
        `background:${bgHex}`,
        `color:${fgHex}`,
      ].join(';'),
    }, block.text);

    slotEl.classList.add('hidden');
    pageDiv.append(editor);

    let closed = false;
    const finish = (commit) => {
      if (closed) return;
      closed = true;
      activeSession = null;
      const nextText = editor.innerText;
      editor.remove();
      slotEl.classList.remove('hidden');
      if (!commit) return;
      const committed = applyInlineReplacement({
        page: pageIndex,
        block,
        newText: nextText,
        bgHex,
        fgHex,
      });
      if (committed) {
        onStatus?.(
          nextText.trim()
            ? 'Đã cập nhật dòng văn bản gốc (Ctrl+Z để hoàn tác).'
            : 'Đã xóa dòng văn bản gốc khỏi trang (Ctrl+Z để hoàn tác).',
        );
      }
    };

    editor.addEventListener('pointerdown', (e) => e.stopPropagation());
    editor.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finish(true);
      }
    });
    editor.addEventListener('blur', () => finish(true));

    activeSession = { finish };
    editor.focus();
    // Đặt con trỏ chọn toàn bộ dòng để dễ sửa ngay
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      // Bỏ qua nếu trình duyệt không hỗ trợ Selection API
    }
  }

  async function renderPageSlots(pageIndex, pageDiv) {
    pageDiv?.querySelectorAll('.inline-edit-layer, .inline-edit-active').forEach((n) => n.remove());
    if (state.tool !== 'editPdfText' || !state.doc || !pageDiv) return;

    let blocks = lineCache.get(pageIndex);
    if (!blocks) {
      try {
        const rawItems = await getPageTextItems(pageIndex);
        blocks = clusterEditableLines(rawItems);
        lineCache.set(pageIndex, blocks);
      } catch {
        blocks = [];
      }
    }
    // Kiểm tra lại nếu người dùng đã chuyển công cụ khác trong lúc chờ đọc text
    if (state.tool !== 'editPdfText' || !pageDiv.isConnected) return;
    pageDiv.querySelectorAll('.inline-edit-layer').forEach((n) => n.remove());

    const layer = el('div', { class: 'inline-edit-layer' });
    const z = state.zoom;

    for (const block of blocks) {
      if (isBlockAlreadyMasked(pageIndex, block)) continue;
      const slot = el('div', {
        class: 'inline-edit-slot',
        title: `Nhấp để sửa: "${block.text}"`,
        style: `left:${(block.x - 2) * z}px;top:${(block.y - 1) * z}px;width:${(block.w + 4) * z}px;height:${(block.h + 2) * z}px`,
      });
      slot.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        openBlockEditor(pageIndex, pageDiv, slot, block);
      });
      layer.append(slot);
    }
    pageDiv.append(layer);
  }

  function syncPages() {
    state.pageEls.forEach((div, idx) => {
      if (div) renderPageSlots(idx, div);
    });
  }

  return {
    clearCache,
    renderPageSlots,
    syncPages,
  };
}
