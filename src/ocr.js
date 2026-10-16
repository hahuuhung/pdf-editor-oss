// Optical character recognition with Tesseract.js. A page is rendered by pdf.js at OCR resolution,
// recognized, and returned as words in view space so the editor can search them and the exporter
// can write them as an invisible text layer.

import { LIB_URLS, loadScript } from './libs.js';

export const OCR_LANGUAGES = [
  { id: 'vie+eng', label: 'Tiếng Việt + Tiếng Anh' },
  { id: 'vie', label: 'Tiếng Việt' },
  { id: 'eng', label: 'Tiếng Anh' },
];

const MIN_CONFIDENCE = 30;

// Words from a Tesseract result, scaled from image pixels back to view space. Handles both the
// flat `words` list of older versions and the `blocks` tree of tesseract.js 6.
export function wordsFromTesseract(data, scale) {
  const out = [];
  const push = (w) => {
    const text = (w?.text ?? '').trim();
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
export async function ocrPage(pdfDoc, index, lang, progress, scale = 2.5) {
  onProgress = progress;
  const worker = await getWorker(lang);
  const page = await pdfDoc.getPage(index + 1);
  const view = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(view.width);
  canvas.height = Math.ceil(view.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: view }).promise;
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  return wordsFromTesseract(data, scale);
}
