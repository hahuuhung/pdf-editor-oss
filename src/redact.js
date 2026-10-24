// True redaction. A page with redaction boxes is rendered to an image with the boxes burned in, and
// the exporter replaces the original page with that image, so the text, vectors and images under
// the boxes are removed from the file instead of only being covered.

export async function rasterizeRedactions(pdfDoc, marks, scale = 300 / 72) {
  const out = new Map();
  const pages = [...new Set(marks.filter((m) => m.type === 'redact').map((m) => m.page))];
  for (const index of pages) {
    const page = await pdfDoc.getPage(index + 1);
    const view = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(view.width);
    canvas.height = Math.ceil(view.height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: view }).promise;
    ctx.fillStyle = '#000000';
    for (const m of marks) {
      if (m.type === 'redact' && m.page === index) ctx.fillRect(m.x * scale, m.y * scale, m.w * scale, m.h * scale);
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    out.set(index, { png: new Uint8Array(await blob.arrayBuffer()), width: view.width / scale, height: view.height / scale });
    canvas.width = 0;
    canvas.height = 0;
  }
  return out;
}
