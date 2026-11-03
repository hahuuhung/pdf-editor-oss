// Bộ công cụ Đóng dấu Mã QR, Barcode 128B, Số nhảy Bates (Bates Numbering) & Con dấu chứng từ.
// Chạy hoàn toàn tại trình duyệt (100% Client-side, không phụ thuộc mạng CDN bên ngoài).

import { el, field, icon, openDialog } from './dom.js';
import { HEADER_FOOTER_SLOTS, sanitizeHeaderFooter, todayLabel } from './docsettings.js';
import { parsePageRange } from './pages.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function cleanStr(v, max = 300) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

// Chuyển chuỗi tiếng Việt có dấu sang ASCII chuẩn cho Barcode 128B (chỉ hỗ trợ mã ASCII 32..126).
export function toBarcodeAscii(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

// ============================================================================
// 1. MÃ VẠCH 1D CODE-128B (Tiêu chuẩn ISO/IEC 15417)
// ============================================================================

// Bảng 107 mẫu vạch của Code 128 (mỗi mẫu gồm 6 độ rộng vạch/khoảng trắng, tổng 11 mô-đun; mã Stop 106 có 7 phần tử = 13 mô-đun).
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function patternToBits(pattern) {
  let bits = '';
  for (let i = 0; i < pattern.length; i++) {
    const count = Number(pattern[i]);
    bits += (i % 2 === 0 ? '1' : '0').repeat(count);
  }
  return bits;
}

/**
 * Mã hóa chuỗi văn bản thành dãy bit vạch (1) / khoảng trắng (0) chuẩn Code 128B.
 */
export function encodeCode128B(rawText) {
  const clean = toBarcodeAscii(rawText);
  if (!clean) {
    return { valid: false, bits: '', text: '', checksum: 0, error: 'Nội dung Barcode cần ít nhất 1 ký tự chữ hoặc số.' };
  }
  const values = [104]; // Start Code B
  let checksum = 104;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i) - 32;
    if (code < 0 || code > 95) continue;
    values.push(code);
    checksum += code * (i + 1);
  }
  checksum %= 103;
  values.push(checksum, 106); // Checksum + Stop

  const quiet = '0'.repeat(10);
  const body = values.map((v) => patternToBits(CODE128_PATTERNS[v])).join('');
  return {
    valid: true,
    bits: quiet + body + quiet,
    text: clean,
    checksum,
  };
}

// ============================================================================
// 2. MÃ QR 2D (Tiêu chuẩn ISO/IEC 18004 - Byte Mode, ECC Level L, Version 1..10)
// ============================================================================

// Thông số Version 1..10 ở mức sửa lỗi L (Low ~7%): [tổng số byte dữ liệu, số khối, số byte EC mỗi khối, vị trí tâm Alignment]
const QR_VERSIONS_L = [
  null,
  { totalData: 19, blocks: 1, ecPerBlock: 7, align: [] },
  { totalData: 34, blocks: 1, ecPerBlock: 10, align: [6, 18] },
  { totalData: 55, blocks: 1, ecPerBlock: 15, align: [6, 22] },
  { totalData: 80, blocks: 1, ecPerBlock: 20, align: [6, 26] },
  { totalData: 108, blocks: 1, ecPerBlock: 26, align: [6, 30] },
  { totalData: 136, blocks: 2, ecPerBlock: 18, align: [6, 34] },
  { totalData: 156, blocks: 2, ecPerBlock: 20, align: [6, 22, 38] },
  { totalData: 194, blocks: 2, ecPerBlock: 24, align: [6, 24, 42] },
  { totalData: 232, blocks: 2, ecPerBlock: 30, align: [6, 26, 46] },
  { totalData: 274, blocks: 4, ecPerBlock: 18, align: [6, 28, 50] },
];

// Trường hữu hạn GF(256) với đa thức sinh x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function bchFormatBits(ecLevelBits, mask) {
  const data = (ecLevelBits << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function bchVersionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rem;
}

/**
 * Tạo ma trận điểm ảnh QR Code (ISO/IEC 18004) từ chuỗi UTF-8 bất kỳ.
 */
export function encodeQrMatrix(rawText) {
  const text = String(rawText ?? '').trim();
  if (!text) {
    return { valid: false, matrix: [], size: 0, version: 0, error: 'Hãy nhập nội dung cho mã QR.' };
  }
  const utf8 = new TextEncoder().encode(text);

  // Tìm version nhỏ nhất chứa vừa chuỗi UTF-8
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const countBits = v <= 9 ? 8 : 16;
    const capBytes = QR_VERSIONS_L[v].totalData - Math.ceil((4 + countBits) / 8);
    if (utf8.length <= capBytes) {
      version = v;
      break;
    }
  }
  if (!version) {
    return { valid: false, matrix: [], size: 0, version: 0, error: 'Nội dung quá dài cho một mã QR (tối đa khoảng 270 byte UTF-8).' };
  }

  const spec = QR_VERSIONS_L[version];
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  // Mode 0100 (Byte mode) + Độ dài byte + Dữ liệu
  pushBits(0b0100, 4);
  pushBits(utf8.length, version <= 9 ? 8 : 16);
  for (const b of utf8) pushBits(b, 8);

  const maxBits = spec.totalData * 8;
  const term = Math.min(4, maxBits - bits.length);
  pushBits(0, term);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(spec.totalData);
  for (let i = 0; i < bits.length / 8; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    dataBytes[i] = b;
  }
  const pads = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < spec.totalData; i++, p ^= 1) {
    dataBytes[i] = pads[p];
  }

  // Chia khối & tính Reed-Solomon EC
  const blocksData = [];
  const blocksEc = [];
  const baseLen = Math.floor(spec.totalData / spec.blocks);
  const extra = spec.totalData % spec.blocks;
  let offset = 0;
  for (let b = 0; b < spec.blocks; b++) {
    const len = baseLen + (b >= spec.blocks - extra ? 1 : 0);
    const slice = dataBytes.subarray(offset, offset + len);
    offset += len;
    blocksData.push(slice);
    blocksEc.push(rsEncode(slice, spec.ecPerBlock));
  }

  // Đan xen (interleave) các codeword dữ liệu và EC
  const codewords = [];
  const maxDataLen = baseLen + (extra > 0 ? 1 : 0);
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < spec.blocks; b++) {
      if (i < blocksData[b].length) codewords.push(blocksData[b][i]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (let b = 0; b < spec.blocks; b++) codewords.push(blocksEc[b][i]);
  }

  const size = 17 + version * 4;
  const grid = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setModule = (r, c, dark, isReserved = true) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    grid[r][c] = dark ? 1 : 0;
    if (isReserved) reserved[r][c] = 1;
  };

  // 3 cụm Finder Pattern (7x7) + viền trắng phân cách
  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setModule(r0 + dr, c0 + dc, inOuter && (onBorder || inInner), true);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Cụm Alignment Pattern (5x5)
  const align = spec.align;
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
      const cr = align[i];
      const cc = align[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setModule(cr + dr, cc + dc, dark, true);
        }
      }
    }
  }

  // Đường Timing Pattern
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setModule(6, i, i % 2 === 0, true);
    if (!reserved[i][6]) setModule(i, 6, i % 2 === 0, true);
  }

  // Dark module cố định & vùng dự trữ Format Info
  setModule(4 * version + 9, 8, true, true);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) setModule(8, i, false, true);
    if (!reserved[i][8]) setModule(i, 8, false, true);
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) setModule(8, size - 1 - i, false, true);
    if (!reserved[size - 1 - i][8]) setModule(size - 1 - i, 8, false, true);
  }

  // Vùng Version Info (cho version >= 7)
  if (version >= 7) {
    const vBits = bchVersionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >> i) & 1) === 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      setModule(r, c, bit, true);
      setModule(c, r, bit, true);
    }
  }

  // Đổ dòng bit dữ liệu theo đường zíc-zắc 2 cột từ phải sang trái
  const stream = [];
  for (const cw of codewords) {
    for (let b = 7; b >= 0; b--) stream.push((cw >> b) & 1);
  }
  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // Bỏ qua cột timing
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!reserved[r][c]) {
          const bit = bitIdx < stream.length ? stream[bitIdx++] : 0;
          // Áp dụng mặt nạ Mask 0: (r + c) % 2 === 0
          const masked = (r + c) % 2 === 0 ? bit ^ 1 : bit;
          grid[r][c] = masked;
        }
      }
    }
    upward = !upward;
  }

  // Ghi 15 bit Format Info cho ECC Level L (01) và Mask 0 (000)
  const fBits = bchFormatBits(0b01, 0);
  const formatCoords1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  const formatCoords2 = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ];
  for (let i = 0; i < 15; i++) {
    const bit = (fBits >> i) & 1;
    const [r1, c1] = formatCoords1[i];
    const [r2, c2] = formatCoords2[i];
    grid[r1][c1] = bit;
    grid[r2][c2] = bit;
  }

  return { valid: true, matrix: grid, size, version };
}

// ============================================================================
// 3. ĐÁNH SỐ NHẢY BATES NUMBERING & TÍNH TOÁN VỊ TRÍ ĐÓNG DẤU
// ============================================================================

export const STAMP_POSITIONS = [
  { id: 'bottom-right', label: 'Góc dưới bên phải' },
  { id: 'bottom-left', label: 'Góc dưới bên trái' },
  { id: 'bottom-center', label: 'Chân trang ở giữa' },
  { id: 'top-right', label: 'Góc trên bên phải' },
  { id: 'top-left', label: 'Góc trên bên trái' },
  { id: 'top-center', label: 'Đầu trang ở giữa' },
  { id: 'center', label: 'Chính giữa trang' },
];

export const BATES_PRESETS = [
  { id: 'bates_only', label: 'Chỉ số Bates (VD: HS-000001)', template: '{bates}' },
  { id: 'bates_page', label: 'Số Bates + Trang (VD: HS-000001 · Trang 1/10)', template: '{bates} · Trang {page}/{total}' },
  { id: 'bates_date', label: 'Số Bates + Ngày (VD: HS-000001 · 28/10/2026)', template: '{bates} · {date}' },
  { id: 'bates_file', label: 'Tên hồ sơ + Số Bates (VD: hop-dong.pdf #HS-000001)', template: '{file} #{bates}' },
];

export const OFFICIAL_STAMP_TEMPLATES = [
  { id: 'paid', title: 'ĐÃ THU TIỀN', subtitle: 'Kế toán thanh toán', color: '#b42318', shape: 'rect' },
  { id: 'disbursed', title: 'ĐÃ CHI TIỀN', subtitle: 'Chứng từ quỹ', color: '#b42318', shape: 'rect' },
  { id: 'certified', title: 'SAO Y BẢN CHÍNH', subtitle: 'Đúng với bản gốc', color: '#1d4ed8', shape: 'rect' },
  { id: 'approved', title: 'ĐÃ PHÊ DUYỆT', subtitle: 'Hồ sơ hợp lệ', color: '#15803d', shape: 'rect' },
  { id: 'checked', title: 'ĐÃ KIỂM TRA', subtitle: 'Bộ phận Kiểm soát', color: '#0f766e', shape: 'rect' },
  { id: 'confidential', title: 'TÀI LIỆU MẬT', subtitle: 'Cấm sao chép phát tán', color: '#b42318', shape: 'rect' },
  { id: 'round_seal', title: 'ĐÃ ĐỐI CHIẾU', subtitle: 'CHỨNG TỪ HỢP LỆ', color: '#b42318', shape: 'circle' },
];

/**
 * Định dạng một số nhảy Bates tại trang `index` (0-based) với tiền tố, hậu tố, bước nhảy.
 */
export function formatBatesItem({ prefix = '', suffix = '', start = 1, digits = 6, step = 1 } = {}, index = 0) {
  const safeStart = Math.max(0, Math.floor(clampNum(start, 0, 1e9, 1)));
  const safeStep = Math.max(1, Math.floor(clampNum(step, 1, 1000, 1)));
  const safeDigits = Math.floor(clampNum(digits, 1, 12, 6));
  const num = safeStart + Math.max(0, Math.floor(index)) * safeStep;
  return `${cleanStr(prefix, 40)}${String(num).padStart(safeDigits, '0')}${cleanStr(suffix, 40)}`;
}

/**
 * Tạo danh sách xem trước chuỗi số Bates cho `count` trang.
 */
export function generateBatesPreviewList(config, totalPages = 5, maxPreview = 5) {
  const total = Math.max(1, Math.floor(Number(totalPages) || 1));
  const limit = Math.min(total, Math.max(1, maxPreview));
  const skipFirst = config?.skipFirst === true;
  const pageStart = Math.max(1, Math.floor(clampNum(config?.pageStart, 0, 1e6, 1)));
  const template = cleanStr(config?.template || '{bates}', 200) || '{bates}';
  const dateStr = config?.date || todayLabel();
  const fileStr = config?.file || 'ho-so.pdf';

  const items = [];
  for (let i = 0; i < limit; i++) {
    if (skipFirst && i === 0) {
      items.push({ pageNumber: 1, skipped: true, text: '(Bỏ qua trang bìa)' });
      continue;
    }
    const batesIndex = skipFirst ? i - 1 : i;
    const bates = formatBatesItem(config, batesIndex);
    const page = pageStart + batesIndex;
    const totalCount = pageStart + total - (skipFirst ? 1 : 0) - 1;
    const text = template.replace(/\{(bates|page|total|date|file)\}/g, (_, k) => {
      if (k === 'bates') return bates;
      if (k === 'page') return String(page);
      if (k === 'total') return String(totalCount);
      if (k === 'date') return dateStr;
      if (k === 'file') return fileStr;
      return '';
    });
    items.push({ pageNumber: i + 1, skipped: false, bates, text });
  }
  return items;
}

/**
 * Tính toán tọa độ đặt con dấu / mã QR / Barcode trên trang PDF (View coordinates).
 */
export function computeStampPlacement(pageSize, stampSize, position = 'bottom-right', marginPt = 24) {
  const W = Math.max(50, Number(pageSize?.width) || 595.28);
  const H = Math.max(50, Number(pageSize?.height) || 841.89);
  const w = Math.min(W - 12, Math.max(16, Number(stampSize?.width) || 90));
  const h = Math.min(H - 12, Math.max(16, Number(stampSize?.height) || 90));
  const m = clampNum(marginPt, 4, 144, 24);

  let x = W - w - m;
  let y = H - h - m;

  switch (position) {
    case 'top-left':
      x = m;
      y = m;
      break;
    case 'top-center':
      x = (W - w) / 2;
      y = m;
      break;
    case 'top-right':
      x = W - w - m;
      y = m;
      break;
    case 'bottom-left':
      x = m;
      y = H - h - m;
      break;
    case 'bottom-center':
      x = (W - w) / 2;
      y = H - h - m;
      break;
    case 'center':
      x = (W - w) / 2;
      y = (H - h) / 2;
      break;
    case 'bottom-right':
    default:
      x = W - w - m;
      y = H - h - m;
      break;
  }

  return {
    x: Math.max(0, Math.round(x * 100) / 100),
    y: Math.max(0, Math.round(y * 100) / 100),
    w: Math.round(w * 100) / 100,
    h: Math.round(h * 100) / 100,
  };
}

/**
 * Thay thế các biến động {page}, {total}, {date}, {file} trong nội dung QR/Barcode khi đóng hàng loạt.
 */
export function resolveCodeDynamicText(template, { page = 1, total = 1, date = '', file = '' } = {}) {
  return String(template ?? '').replace(/\{(page|total|date|file)\}/g, (_, k) => {
    if (k === 'page') return String(page);
    if (k === 'total') return String(total);
    if (k === 'date') return String(date || todayLabel());
    if (k === 'file') return String(file || 'document.pdf');
    return '';
  });
}

// ============================================================================
// 4. KẾT XUẤT CANVAS CHẤT LƯỢNG CAO CHO QR CODE, BARCODE & CON DẤU CHỨNG TỪ
// ============================================================================

/**
 * Vẽ Mã QR hoặc Barcode 128B lên Canvas và trả về PNG DataURL sắc nét (DPI cao).
 */
export function renderCodeCanvas({
  mode = 'qr',
  text = 'https://vetviral.com',
  caption = '',
  color = '#0f172a',
  showBorder = true,
  sizePt = 96,
} = {}) {
  const fg = HEX_COLOR.test(color ?? '') ? color : '#0f172a';
  const scale = 3; // Kết xuất độ nét 3x (~216-300 DPI)
  const label = cleanStr(caption, 80).trim();

  if (mode === 'barcode') {
    const encoded = encodeCode128B(text);
    if (!encoded.valid) return { valid: false, error: encoded.error };

    const displayCaption = label || encoded.text;
    const widthPt = Math.max(110, clampNum(sizePt, 60, 260, 140) * 1.45);
    const heightPt = Math.round(widthPt * 0.46);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(widthPt * scale);
    canvas.height = Math.round(heightPt * scale);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (showBorder) {
      ctx.strokeStyle = '#e4e4e7';
      ctx.lineWidth = 1.2 * scale;
      ctx.strokeRect(scale, scale, canvas.width - 2 * scale, canvas.height - 2 * scale);
    }

    const padX = 8 * scale;
    const padTop = 7 * scale;
    const textSpace = displayCaption ? 16 * scale : 6 * scale;
    const barAreaW = canvas.width - padX * 2;
    const barAreaH = canvas.height - padTop - textSpace;
    const moduleW = barAreaW / encoded.bits.length;

    ctx.fillStyle = fg;
    for (let i = 0; i < encoded.bits.length; i++) {
      if (encoded.bits[i] === '1') {
        const x0 = padX + i * moduleW;
        ctx.fillRect(x0, padTop, Math.ceil(moduleW), barAreaH);
      }
    }

    if (displayCaption) {
      ctx.fillStyle = fg;
      ctx.font = `600 ${Math.round(9.5 * scale)}px ui-monospace, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(displayCaption.slice(0, 38), canvas.width / 2, canvas.height - 3.5 * scale);
    }

    return {
      valid: true,
      canvas,
      dataUrl: canvas.toDataURL('image/png'),
      width: widthPt,
      height: heightPt,
    };
  }

  // Chế độ QR Code 2D
  const qr = encodeQrMatrix(text);
  if (!qr.valid) return { valid: false, error: qr.error };

  const boxPt = clampNum(sizePt, 48, 220, 92);
  const extraH = label ? 16 : 0;
  const widthPt = boxPt;
  const heightPt = boxPt + extraH;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthPt * scale);
  canvas.height = Math.round(heightPt * scale);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (showBorder) {
    ctx.strokeStyle = '#e4e4e7';
    ctx.lineWidth = 1.2 * scale;
    ctx.strokeRect(scale, scale, canvas.width - 2 * scale, canvas.height - 2 * scale);
  }

  const quietModules = 3;
  const totalModules = qr.size + quietModules * 2;
  const qrBoxPx = boxPt * scale;
  const modPx = qrBoxPx / totalModules;

  ctx.fillStyle = fg;
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.matrix[r][c]) {
        const x = (c + quietModules) * modPx;
        const y = (r + quietModules) * modPx;
        ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(modPx), Math.ceil(modPx));
      }
    }
  }

  if (label) {
    ctx.fillStyle = fg;
    ctx.font = `600 ${Math.round(8.5 * scale)}px Inter, system-ui, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.slice(0, 26), canvas.width / 2, qrBoxPx + (extraH * scale) / 2 - 2 * scale);
  }

  return {
    valid: true,
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    width: widthPt,
    height: heightPt,
  };
}

/**
 * Kết xuất Con dấu Chứng từ / Pháp lý / Kế toán (Hộp chữ nhật 2 viền hoặc Mộc tròn) ra PNG DataURL.
 */
export function renderOfficialStampCanvas({
  title = 'ĐÃ THU TIỀN',
  subtitle = 'Kế toán thanh toán',
  dateText = todayLabel(),
  signer = '',
  color = '#b42318',
  shape = 'rect',
} = {}) {
  const stroke = HEX_COLOR.test(color ?? '') ? color : '#b42318';
  const scale = 3;
  const mainTitle = cleanStr(title, 40).trim().toUpperCase() || 'ĐÃ DUYỆT';
  const sub = cleanStr(subtitle, 50).trim();
  const dateLine = cleanStr(dateText, 40).trim();
  const byLine = cleanStr(signer, 40).trim();

  if (shape === 'circle') {
    const sizePt = 112;
    const canvas = document.createElement('canvas');
    canvas.width = sizePt * scale;
    canvas.height = sizePt * scale;
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const rOuter = (sizePt / 2 - 4) * scale;
    const rInner = (sizePt / 2 - 8) * scale;

    ctx.strokeStyle = stroke;
    ctx.fillStyle = stroke;

    // Vòng tròn kép chuẩn mộc dấu
    ctx.lineWidth = 2.4 * scale;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.1 * scale;
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
    ctx.stroke();

    // Ngôi sao 5 cánh nhỏ hai bên
    ctx.font = `700 ${Math.round(9 * scale)}px Inter, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', cx - rInner + 10 * scale, cy);
    ctx.fillText('★', cx + rInner - 10 * scale, cy);

    if (sub) {
      ctx.font = `700 ${Math.round(7.5 * scale)}px Inter, Arial, sans-serif`;
      ctx.fillText(sub.toUpperCase().slice(0, 22), cx, cy - 19 * scale);
    }

    ctx.font = `800 ${Math.round(10.5 * scale)}px Inter, Arial, sans-serif`;
    ctx.fillText(mainTitle.slice(0, 16), cx, cy);

    if (dateLine || byLine) {
      ctx.font = `600 ${Math.round(7.5 * scale)}px Inter, Arial, sans-serif`;
      ctx.fillText((byLine || dateLine).slice(0, 22), cx, cy + 18 * scale);
    }

    return {
      canvas,
      dataUrl: canvas.toDataURL('image/png'),
      width: sizePt,
      height: sizePt,
    };
  }

  // Mộc vuông / chữ nhật kế toán - hành chính
  const widthPt = Math.max(150, Math.min(230, mainTitle.length * 9 + 54));
  const lines = [sub, dateLine ? `Ngày: ${dateLine}` : '', byLine ? `Người ký: ${byLine}` : ''].filter(Boolean);
  const heightPt = 42 + lines.length * 13;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthPt * scale);
  canvas.height = Math.round(heightPt * scale);
  const ctx = canvas.getContext('2d');

  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;

  // Viền ngoài đậm & viền trong mảnh
  const m1 = 2.5 * scale;
  const m2 = 5.5 * scale;
  ctx.lineWidth = 2.2 * scale;
  ctx.strokeRect(m1, m1, canvas.width - m1 * 2, canvas.height - m1 * 2);
  ctx.lineWidth = 0.9 * scale;
  ctx.strokeRect(m2, m2, canvas.width - m2 * 2, canvas.height - m2 * 2);

  // Tiêu đề chính
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `800 ${Math.round(13.5 * scale)}px Inter, Arial, sans-serif`;
  ctx.fillText(mainTitle, canvas.width / 2, 10 * scale);

  // Đường kẻ ngang phân cách nếu có dòng phụ
  if (lines.length) {
    ctx.lineWidth = 0.8 * scale;
    ctx.beginPath();
    ctx.moveTo(12 * scale, 27.5 * scale);
    ctx.lineTo(canvas.width - 12 * scale, 27.5 * scale);
    ctx.stroke();

    ctx.font = `600 ${Math.round(8.8 * scale)}px Inter, Arial, sans-serif`;
    lines.forEach((line, idx) => {
      ctx.fillText(line, canvas.width / 2, (31.5 + idx * 12) * scale);
    });
  }

  return {
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    width: widthPt,
    height: heightPt,
  };
}

// ============================================================================
// 5. HỘP THOẠI GIAO DIỆN NGƯỜI DÙNG (WHITE THEME)
// ============================================================================

/**
 * Mở hộp thoại Tạo & Đóng dấu Mã QR / Barcode (Kèm chế độ đóng dấu con dấu chứng từ).
 */
export function openQrBarcodeDialog({ state, onInsertSingle, onInsertBatch, onStatus }) {
  let activeTab = 'qr'; // 'qr' | 'barcode' | 'stamp'

  // Điều khiển Tab
  const tabQr = el('button', { type: 'button', class: 'st-tab on' }, icon('qrcode', 16), 'Mã QR (2D)');
  const tabBarcode = el('button', { type: 'button', class: 'st-tab' }, icon('barcode', 16), 'Barcode 128 (1D)');
  const tabStamp = el('button', { type: 'button', class: 'st-tab' }, icon('stamp', 16), 'Con dấu chứng từ');
  const tabsBar = el('div', { class: 'st-tabs' }, tabQr, tabBarcode, tabStamp);

  // Trường nhập cho QR / Barcode
  const codeText = el('input', {
    type: 'text',
    value: `https://vetviral.com/verify?doc=${encodeURIComponent(state.fileName || 'tai-lieu.pdf')}`,
    placeholder: 'Nhập liên kết URL, mã hồ sơ, số hóa đơn… (hỗ trợ {page}, {date})',
    autofocus: true,
  });
  const codeCaption = el('input', {
    type: 'text',
    value: 'Quét để xác thực',
    placeholder: 'Nhãn hiển thị dưới mã (để trống nếu không cần)',
  });
  const codeSize = el('select', {},
    el('option', { value: '72' }, 'Nhỏ gọn (72 pt)'),
    el('option', { value: '96', selected: true }, 'Tiêu chuẩn (96 pt)'),
    el('option', { value: '128' }, 'Lớn rõ nét (128 pt)'),
  );
  const codeColor = el('input', { type: 'color', value: '#0f172a' });
  const codeBorder = el('input', { type: 'checkbox', checked: true });

  // Trường nhập cho Con dấu chứng từ
  const stampPreset = el('select', {},
    OFFICIAL_STAMP_TEMPLATES.map((t) => el('option', { value: t.id }, `${t.title} — ${t.subtitle}`)),
  );
  const stampTitle = el('input', { type: 'text', value: OFFICIAL_STAMP_TEMPLATES[0].title });
  const stampSub = el('input', { type: 'text', value: OFFICIAL_STAMP_TEMPLATES[0].subtitle });
  const stampDate = el('input', { type: 'text', value: todayLabel() });
  const stampSigner = el('input', { type: 'text', value: '', placeholder: 'VD: Nguyễn Văn A' });
  const stampShape = el('select', {},
    el('option', { value: 'rect' }, 'Dấu hộp chữ nhật (Kế toán / Hành chính)'),
    el('option', { value: 'circle' }, 'Dấu mộc tròn (Đối chiếu / Xác nhận)'),
  );
  const stampColor = el('input', { type: 'color', value: '#b42318' });

  stampPreset.addEventListener('change', () => {
    const found = OFFICIAL_STAMP_TEMPLATES.find((t) => t.id === stampPreset.value);
    if (!found) return;
    stampTitle.value = found.title;
    stampSub.value = found.subtitle;
    stampColor.value = found.color;
    stampShape.value = found.shape;
    updatePreview();
  });

  // Phạm vi & vị trí đóng dấu
  const total = state.pageSizes.length || 1;
  const scopeSelect = el('select', {},
    el('option', { value: 'current' }, `Chỉ trang hiện tại (Trang ${state.current + 1}) — Tự do kéo thả`),
    el('option', { value: 'all' }, `Đóng hàng loạt: Tất cả ${total} trang`),
    el('option', { value: 'range' }, 'Đóng hàng loạt: Dãy trang tùy chọn…'),
  );
  const rangeInput = el('input', { type: 'text', value: `1-${total}`, placeholder: 'VD: 1-3, 5', disabled: true });
  const posSelect = el('select', {}, STAMP_POSITIONS.map((p) => el('option', { value: p.id }, p.label)));
  const marginInput = el('input', { type: 'number', min: 6, max: 120, value: 24 });

  scopeSelect.addEventListener('change', () => {
    rangeInput.disabled = scopeSelect.value !== 'range';
    if (!rangeInput.disabled) rangeInput.focus();
  });

  const codeFieldsBox = el('div', { class: 'st-form-section' },
    field('Nội dung mã (URL, Mã số chứng từ, Văn bản)', codeText, 'Mẹo: Có thể dùng biến {page}, {total}, {date}, {file} khi đóng hàng loạt.'),
    field('Nhãn chú thích bên dưới', codeCaption),
    el('div', { class: 'dlg-grid' },
      field('Kích thước', codeSize),
      field('Màu sắc mã', codeColor),
    ),
    el('label', { class: 'lbl small' }, codeBorder, 'Hiển thị khung viền mảnh quanh mã'),
  );

  const stampFieldsBox = el('div', { class: 'st-form-section hidden' },
    field('Mẫu con dấu nhanh', stampPreset),
    el('div', { class: 'dlg-grid' },
      field('Dòng tiêu đề chính', stampTitle),
      field('Dòng phụ đề / Bộ phận', stampSub),
    ),
    el('div', { class: 'dlg-grid' },
      field('Ngày tháng đóng dấu', stampDate),
      field('Người ký / Kiểm duyệt', stampSigner),
    ),
    el('div', { class: 'dlg-grid' },
      field('Kiểu dáng mộc', stampShape),
      field('Màu mực dấu', stampColor),
    ),
  );

  const placementBox = el('div', { class: 'st-placement-box' },
    el('div', { class: 'st-section-title' }, 'Vị trí & Phạm vi áp dụng'),
    field('Phạm vi trang', scopeSelect),
    rangeInput,
    el('div', { class: 'dlg-grid' },
      field('Vị trí đặt trên trang', posSelect),
      field('Cách lề (pt)', marginInput),
    ),
  );

  // Cột Xem trước trực tiếp (Live Preview)
  const previewHolder = el('div', { class: 'st-preview-canvas-wrap' });
  const previewMeta = el('div', { class: 'st-preview-meta' });
  const errorEl = el('p', { class: 'dlg-error' });

  function renderCurrentGraphic(pageIndex = state.current) {
    if (activeTab === 'stamp') {
      return renderOfficialStampCanvas({
        title: stampTitle.value,
        subtitle: stampSub.value,
        dateText: stampDate.value,
        signer: stampSigner.value,
        color: stampColor.value,
        shape: stampShape.value,
      });
    }
    const resolvedText = resolveCodeDynamicText(codeText.value, {
      page: pageIndex + 1,
      total,
      date: todayLabel(),
      file: state.fileName,
    });
    const resolvedCaption = resolveCodeDynamicText(codeCaption.value, {
      page: pageIndex + 1,
      total,
      date: todayLabel(),
      file: state.fileName,
    });
    return renderCodeCanvas({
      mode: activeTab,
      text: resolvedText,
      caption: resolvedCaption,
      color: codeColor.value,
      showBorder: codeBorder.checked,
      sizePt: Number(codeSize.value),
    });
  }

  function updatePreview() {
    errorEl.textContent = '';
    const res = renderCurrentGraphic(state.current);
    previewHolder.replaceChildren();
    if (!res.valid && res.error) {
      previewHolder.append(el('p', { class: 'dlg-error' }, res.error));
      previewMeta.textContent = '';
      return;
    }
    const img = el('img', {
      src: res.dataUrl,
      alt: 'Xem trước mã / con dấu',
      class: 'st-preview-img',
    });
    previewHolder.append(img);
    previewMeta.textContent = `Kích thước thực tế: ${Math.round(res.width)} × ${Math.round(res.height)} pt (Độ nét cao 300 DPI)`;
  }

  const switchTab = (tab) => {
    activeTab = tab;
    tabQr.classList.toggle('on', tab === 'qr');
    tabBarcode.classList.toggle('on', tab === 'barcode');
    tabStamp.classList.toggle('on', tab === 'stamp');
    codeFieldsBox.classList.toggle('hidden', tab === 'stamp');
    stampFieldsBox.classList.toggle('hidden', tab !== 'stamp');
    if (tab === 'barcode' && codeText.value.startsWith('https://')) {
      codeText.value = 'HS-2026-00108';
      codeCaption.value = 'HS-2026-00108';
    } else if (tab === 'qr' && codeText.value === 'HS-2026-00108') {
      codeText.value = `https://vetviral.com/verify?doc=${encodeURIComponent(state.fileName || 'tai-lieu.pdf')}`;
      codeCaption.value = 'Quét để xác thực';
    }
    updatePreview();
  };

  tabQr.onclick = () => switchTab('qr');
  tabBarcode.onclick = () => switchTab('barcode');
  tabStamp.onclick = () => switchTab('stamp');

  for (const input of [
    codeText, codeCaption, codeSize, codeColor, codeBorder,
    stampTitle, stampSub, stampDate, stampSigner, stampShape, stampColor,
  ]) {
    input.addEventListener('input', updatePreview);
    input.addEventListener('change', updatePreview);
  }

  updatePreview();

  const layoutBody = el('div', { class: 'st-dialog-layout' },
    el('div', { class: 'st-left-col' },
      tabsBar,
      codeFieldsBox,
      stampFieldsBox,
      placementBox,
      errorEl,
    ),
    el('div', { class: 'st-right-col' },
      el('div', { class: 'st-preview-title' }, 'XEM TRƯỚC TRỰC TIẾP'),
      previewHolder,
      previewMeta,
      el('div', { class: 'st-preview-tips' },
        el('strong', {}, '💡 Gợi ý sử dụng:'),
        el('ul', {},
          el('li', {}, 'Chọn "Chỉ trang hiện tại" để chèn và kéo thả tự do tới vị trí bất kỳ.'),
          el('li', {}, 'Chọn "Đóng hàng loạt" để gắn mã QR / con dấu đồng bộ ở cùng một góc trên mọi trang.'),
        ),
      ),
    ),
  );

  openDialog({
    title: 'Mã QR, Barcode & Con dấu Chứng từ',
    subtitle: 'Tạo mã xác thực chuẩn ISO và đóng dấu hồ sơ 100% trên trình duyệt',
    icon: 'qrcode',
    width: 720,
    body: layoutBody,
    actions: [
      { label: 'Hủy' },
      {
        label: 'Chèn vào tài liệu',
        primary: true,
        run: () => {
          const check = renderCurrentGraphic(state.current);
          if (check.valid === false) {
            errorEl.textContent = check.error || 'Dữ liệu không hợp lệ.';
            return false;
          }
          let pages;
          try {
            pages = scopeSelect.value === 'current'
              ? [state.current]
              : scopeSelect.value === 'all'
                ? state.pageSizes.map((_, i) => i)
                : parsePageRange(rangeInput.value, total);
          } catch (err) {
            errorEl.textContent = err.message;
            return false;
          }

          const marginPt = Number(marginInput.value) || 24;
          const pos = posSelect.value;

          if (pages.length === 1 && scopeSelect.value === 'current') {
            const pIdx = pages[0];
            const graphic = renderCurrentGraphic(pIdx);
            const box = computeStampPlacement(
              state.pageSizes[pIdx],
              { width: graphic.width, height: graphic.height },
              pos,
              marginPt,
            );
            onInsertSingle?.({
              page: pIdx,
              src: graphic.dataUrl,
              x: box.x,
              y: box.y,
              w: box.w,
              h: box.h,
              label: activeTab === 'qr' ? 'Mã QR' : activeTab === 'barcode' ? 'Mã Barcode' : 'Con dấu chứng từ',
            });
          } else {
            const items = pages.map((pIdx) => {
              const graphic = renderCurrentGraphic(pIdx);
              const box = computeStampPlacement(
                state.pageSizes[pIdx],
                { width: graphic.width, height: graphic.height },
                pos,
                marginPt,
              );
              return {
                page: pIdx,
                src: graphic.dataUrl,
                x: box.x,
                y: box.y,
                w: box.w,
                h: box.h,
              };
            });
            onInsertBatch?.(items, activeTab === 'qr' ? 'Mã QR' : activeTab === 'barcode' ? 'Mã Barcode' : 'Con dấu chứng từ');
          }
          onStatus?.(`Đã đóng ${activeTab === 'qr' ? 'Mã QR' : activeTab === 'barcode' ? 'Mã Barcode' : 'con dấu'} lên ${pages.length} trang.`);
        },
      },
    ],
  });
}

/**
 * Mở hộp thoại Đóng số nhảy chứng từ (Bates Numbering) chuyên nghiệp với bảng xem trước trực quan.
 */
export function openBatesDialog({ state, onApply, onStatus }) {
  const hf = state.settings.headerFooter ?? {};
  const SLOT_NAMES = {
    headerRight: 'Đầu trang — Góc phải (Khuyên dùng cho Hồ sơ)',
    headerLeft: 'Đầu trang — Góc trái',
    headerCenter: 'Đầu trang — Ở giữa',
    footerRight: 'Chân trang — Góc phải',
    footerLeft: 'Chân trang — Góc trái',
    footerCenter: 'Chân trang — Ở giữa',
  };

  const existingSlot = HEADER_FOOTER_SLOTS.find((s) => /\{bates\}/.test(hf[s] ?? '')) ?? 'headerRight';
  const slotSelect = el('select', {},
    Object.entries(SLOT_NAMES).map(([k, label]) => el('option', { value: k, selected: k === existingSlot }, label)),
  );

  const prefixInput = el('input', { type: 'text', value: hf.batesPrefix || 'HS-2026-', placeholder: 'VD: HS-2026-', autofocus: true });
  const suffixInput = el('input', { type: 'text', value: '', placeholder: 'VD: /KT (Tùy chọn)' });
  const startInput = el('input', { type: 'number', min: 0, max: 999999999, value: hf.batesStart ?? 1 });
  const digitsInput = el('input', { type: 'number', min: 1, max: 12, value: hf.batesDigits ?? 6 });
  const presetSelect = el('select', {},
    BATES_PRESETS.map((p) => el('option', { value: p.template }, p.label)),
  );
  const customTemplate = el('input', { type: 'text', value: hf[existingSlot] && /\{bates\}/.test(hf[existingSlot]) ? hf[existingSlot] : '{bates}' });

  const fontSizeInput = el('input', { type: 'number', min: 6, max: 36, value: hf.fontSize ?? 10 });
  const colorInput = el('input', { type: 'color', value: hf.color ?? '#1e3a8a' });
  const marginInput = el('input', { type: 'number', min: 6, max: 144, value: hf.margin ?? 24 });
  const skipFirstBox = el('input', { type: 'checkbox', checked: !!hf.skipFirst });

  presetSelect.addEventListener('change', () => {
    const suffix = suffixInput.value.trim();
    const baseTpl = presetSelect.value;
    customTemplate.value = suffix ? baseTpl.replace('{bates}', `{bates}${suffix}`) : baseTpl;
    updateBatesPreview();
  });

  suffixInput.addEventListener('input', () => {
    const suffix = suffixInput.value.trim();
    const baseTpl = presetSelect.value;
    customTemplate.value = suffix ? baseTpl.replace('{bates}', `{bates}${suffix}`) : baseTpl;
    updateBatesPreview();
  });

  const previewListEl = el('div', { class: 'st-bates-preview-list' });
  const total = state.pageSizes.length || 1;

  function updateBatesPreview() {
    const list = generateBatesPreviewList({
      prefix: prefixInput.value,
      suffix: '',
      start: Number(startInput.value),
      digits: Number(digitsInput.value),
      step: 1,
      skipFirst: skipFirstBox.checked,
      pageStart: hf.pageStart ?? 1,
      template: customTemplate.value,
      date: todayLabel(),
      file: state.fileName,
    }, total, 5);

    previewListEl.replaceChildren(
      ...list.map((item) => el('div', { class: `st-bates-row${item.skipped ? ' skipped' : ''}` },
        el('span', { class: 'st-bates-page' }, `Trang ${item.pageNumber}`),
        el('span', { class: 'st-bates-val', style: item.skipped ? '' : `color:${colorInput.value}` }, item.text),
      )),
    );
    if (total > 5) {
      const lastIdx = skipFirstBox.checked ? total - 2 : total - 1;
      const lastBates = formatBatesItem({
        prefix: prefixInput.value,
        start: Number(startInput.value),
        digits: Number(digitsInput.value),
      }, Math.max(0, lastIdx));
      previewListEl.append(
        el('div', { class: 'st-bates-row faint' },
          el('span', { class: 'st-bates-page' }, `… Trang ${total}`),
          el('span', { class: 'st-bates-val' }, `Kết thúc tại: ${lastBates}`),
        ),
      );
    }
  }

  for (const input of [prefixInput, startInput, digitsInput, customTemplate, colorInput, skipFirstBox]) {
    input.addEventListener('input', updateBatesPreview);
    input.addEventListener('change', updateBatesPreview);
  }
  updateBatesPreview();

  const actions = [
    { label: 'Hủy' },
    {
      label: 'Áp dụng số Bates',
      primary: true,
      run: () => {
        const next = {
          color: colorInput.value,
          ...hf,
          fontSize: Number(fontSizeInput.value) || 10,
          color: colorInput.value,
          margin: Number(marginInput.value) || 24,
          batesPrefix: prefixInput.value,
          batesStart: Number(startInput.value) || 1,
          batesDigits: Number(digitsInput.value) || 6,
          skipFirst: skipFirstBox.checked,
        };
        for (const s of HEADER_FOOTER_SLOTS) {
          if (/\{bates\}/.test(next[s] ?? '')) next[s] = '';
        }
        next[slotSelect.value] = customTemplate.value.trim() || '{bates}';
        onApply?.(sanitizeHeaderFooter(next));
        onStatus?.(`Đã đóng số nhảy Bates (${formatBatesItem({ prefix: prefixInput.value, start: startInput.value, digits: digitsInput.value }, 0)}…) cho tài liệu.`);
      },
    },
  ];

  if (HEADER_FOOTER_SLOTS.some((s) => /\{bates\}/.test(hf[s] ?? ''))) {
    actions.unshift({
      label: 'Gỡ số Bates',
      danger: true,
      run: () => {
        const next = { ...hf };
        for (const s of HEADER_FOOTER_SLOTS) {
          if (/\{bates\}/.test(next[s] ?? '')) next[s] = '';
        }
        onApply?.(sanitizeHeaderFooter(next));
        onStatus?.('Đã gỡ số nhảy Bates khỏi tài liệu.');
      },
    });
  }

  openDialog({
    title: 'Đóng Số Nhảy Chứng Từ (Bates Numbering)',
    subtitle: 'Đánh mã số định danh tự động tăng dần cho hồ sơ pháp lý, hợp đồng & kế toán',
    icon: 'hash',
    width: 660,
    body: el('div', { class: 'st-dialog-layout' },
      el('div', { class: 'st-left-col' },
        field('Vị trí đóng số trên trang', slotSelect),
        el('div', { class: 'dlg-grid' },
          field('Tiền tố hồ sơ (Prefix)', prefixInput),
          field('Hậu tố (Suffix)', suffixInput),
        ),
        el('div', { class: 'dlg-grid' },
          field('Số bắt đầu', startInput),
          field('Số chữ số (Padding)', digitsInput),
        ),
        field('Mẫu hiển thị nhanh', presetSelect),
        field('Mẫu tùy chỉnh (có chứa {bates})', customTemplate),
        el('div', { class: 'dlg-grid' },
          field('Cỡ chữ (pt)', fontSizeInput),
          field('Màu chữ số', colorInput),
          field('Cách lề (pt)', marginInput),
        ),
        el('label', { class: 'lbl small' }, skipFirstBox, 'Bỏ qua trang đầu tiên (trang bìa hồ sơ)'),
      ),
      el('div', { class: 'st-right-col' },
        el('div', { class: 'st-preview-title' }, 'XEM TRƯỚC DÃY SỐ NHẢY'),
        previewListEl,
        el('div', { class: 'st-preview-tips' },
          el('strong', {}, '📌 Chuẩn số hóa chứng từ:'),
          el('p', { class: 'dlg-hint', style: 'margin:4px 0 0' }, 'Số Bates được vẽ dạng vector trực tiếp lên từng trang khi xuất và hiển thị ngay trên màn hình soạn thảo.'),
        ),
      ),
    ),
    actions,
  });
}

