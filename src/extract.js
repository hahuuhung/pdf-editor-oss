// Content extraction: embedded images (via pdf.js), Word documents (docx) and zip archives (JSZip).
// Browser-only; the libraries load on first use.

import { LIB_URLS, loadScript } from './libs.js';

function objectOf(page, id) {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => store.get(id, resolve));
}

// Draws a pdf.js decoded image (ImageBitmap or raw pixels) onto a canvas.
function imageToCanvas(img) {
  if (!img || !img.width || !img.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0);
    return canvas;
  }
  if (!img.data) return null;
  const { ImageKind } = pdfjsLib;
  const out = ctx.createImageData(img.width, img.height);
  const src = img.data;
  const dst = out.data;
  const n = img.width * img.height;
  if (img.kind === ImageKind.RGBA_32BPP) dst.set(src.subarray(0, dst.length));
  else if (img.kind === ImageKind.RGB_24BPP) {
    for (let i = 0; i < n; i++) {
      dst[i * 4] = src[i * 3];
      dst[i * 4 + 1] = src[i * 3 + 1];
      dst[i * 4 + 2] = src[i * 3 + 2];
      dst[i * 4 + 3] = 255;
    }
  } else if (img.kind === ImageKind.GRAYSCALE_1BPP) {
    const rowBytes = (img.width + 7) >> 3;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const on = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const i = (y * img.width + x) * 4;
        dst[i] = dst[i + 1] = dst[i + 2] = on ? 255 : 0;
        dst[i + 3] = 255;
      }
    }
  } else return null;
  ctx.putImageData(out, 0, 0);
  return canvas;
}

// Every distinct image drawn on the pages, as PNG blobs. Very small images (icons, dots) are skipped.
export async function extractImages(pdfDoc, onPage) {
  const { OPS } = pdfjsLib;
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintJpegXObject, OPS.paintInlineImageXObject].filter((v) => v !== undefined));
  const files = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    onPage?.(p, pdfDoc.numPages);
    const page = await pdfDoc.getPage(p);
    const ops = await page.getOperatorList();
    const seen = new Set();
    for (let k = 0; k < ops.fnArray.length; k++) {
      if (!imageOps.has(ops.fnArray[k])) continue;
      const arg = ops.argsArray[k][0];
      const key = typeof arg === 'string' ? arg : `inline-${k}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const img = typeof arg === 'string' ? await objectOf(page, arg) : arg;
      if (!img || img.width < 8 || img.height < 8) continue;
      const canvas = imageToCanvas(img);
      if (!canvas) continue;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      files.push({ name: `trang-${p}-anh-${seen.size}.png`, blob });
    }
  }
  return files;
}

export async function zipFiles(files) {
  await loadScript(LIB_URLS.jszip);
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob ?? f.data);
  return zip.generateAsync({ type: 'blob' });
}

// pages: [[line, …], …]; one paragraph per line, a page break between pages.
export async function buildDocx(title, pages) {
  await loadScript(LIB_URLS.docx);
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } = docx;
  const children = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })];
  pages.forEach((lines, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    for (const line of lines) children.push(new Paragraph({ children: [new TextRun(line)] }));
    if (!lines.length) children.push(new Paragraph({ children: [new TextRun({ text: '(Trang không có chữ)', italics: true })] }));
  });
  const doc = new Document({ creator: 'PDF Editor', title, sections: [{ children }] });
  return Packer.toBlob(doc);
}
