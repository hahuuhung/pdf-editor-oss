// Optical character recognition with Tesseract.js. A page is rendered by pdf.js at OCR resolution,
// recognized, and returned as words in view space so the editor can search them and the exporter
// can write them as an invisible text layer.
//
// Settings were chosen by measuring character error rate (CER) on Vietnamese scans: clean and
// degraded (noise, uneven lighting, skew, JPEG), 8–12 pt, Times and Arial, 150–300 DPI:
// - Sauvola thresholding (adaptive, per neighbourhood) instead of Tesseract's global Otsu: average
//   CER 5.3% → 1.4%; on dim or unevenly lit scans 15% → 3%, and no worse on clean ones.
// - Vietnamese alone beats Vietnamese + English (the English model drops diacritics), so 'vie' is
//   the default and 'vie+eng' is for bilingual documents.
// - 300 DPI rendering, told to Tesseract through user_defined_dpi, so 300 DPI scans are not
//   downsampled; above that, accuracy did not improve.
// - The 'best_int' model that tesseract.js loads by default. The float tessdata_best model does not
//   run in the tesseract.js 7 WebAssembly build.

import { LIB_URLS, loadScript } from './libs.js';
import { normalizeVietnamese } from './vntext.js';

export const OCR_LANGUAGES = [
  { id: 'vie', label: 'Tiếng Việt (khuyên dùng)' },
  { id: 'vie+eng', label: 'Tiếng Việt + Tiếng Anh (tài liệu song ngữ)' },
  { id: 'eng', label: 'Tiếng Anh' },
];

export const OCR_DPI = 300;
const MAX_PIXELS = 24e6; // ~ A3 at 300 DPI; larger pages render at a lower resolution
const MIN_CONFIDENCE = 30;

const OCR_PARAMS = {
  thresholding_method: '2', // Sauvola
  preserve_interword_spaces: '1',
};

// Render scale for a page of `width` × `height` points: `dpi`, capped at MAX_PIXELS.
export function ocrScale(width, height, dpi = OCR_DPI) {
  const scale = dpi / 72;
  const pixels = width * height * scale * scale;
  return pixels > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / (width * height)) : scale;
}

// Words from a Tesseract result, scaled from image pixels back to view space. Handles both the
// flat `words` list of older versions and the `blocks` tree of tesseract.js 6 and later.
export function wordsFromTesseract(data, scale) {
  const out = [];
  const push = (w) => {
    const text = normalizeVietnamese(w?.text ?? '').trim();
    if (!text || !w.bbox) return;
    const { x0, y0, x1, y1 } = w.bbox;
    out.push({ text, x: x0 / scale, y: y0 / scale, w: (x1 - x0) / scale, h: (y1 - y0) / scale, confidence: w.confidence ?? 0 });
  };
  if (Array.isArray(data?.words) && data.words.length) data.words.forEach(push);
  else {
    for (const block of data?.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) (line.words ?? []).forEach(push);
      }
    }
  }
  return out.filter((w) => w.confidence >= MIN_CONFIDENCE);
}

let workerPromise = null;
let workerLang = null;
let onProgress = null;

async function getWorker(lang) {
  if (workerPromise && workerLang === lang) return workerPromise;
  if (workerPromise) await terminateOcr();
  await loadScript(LIB_URLS.tesseract);
  workerLang = lang;
  workerPromise = Tesseract.createWorker(lang.split('+'), 1, { logger: (m) => onProgress?.(m) }).catch((err) => {
    workerPromise = null;
    throw new Error(`Không khởi tạo được OCR (${err?.message ?? err}). Lần đầu cần tải dữ liệu ngôn ngữ qua mạng.`);
  });
  return workerPromise;
}

export async function terminateOcr() {
  const pending = workerPromise;
  workerPromise = null;
  workerLang = null;
  if (pending) (await pending.catch(() => null))?.terminate();
}

// Recognizes one page (0-based) of a pdf.js document. `progress` receives tesseract log messages.
export async function ocrPage(pdfDoc, index, lang, progress, { dpi = OCR_DPI } = {}) {
  onProgress = progress;
  const worker = await getWorker(lang);
  const page = await pdfDoc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = ocrScale(base.width, base.height, dpi);
  const view = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(view.width);
  canvas.height = Math.ceil(view.height);
  try {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: view }).promise;
    await worker.setParameters({ ...OCR_PARAMS, user_defined_dpi: String(Math.round(scale * 72)) });
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
    return wordsFromTesseract(data, scale);
  } finally {
    canvas.width = canvas.height = 0; // free the bitmap now; a 300 DPI page is tens of MB
  }
}
