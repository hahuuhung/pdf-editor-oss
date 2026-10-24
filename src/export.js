// Writes the editor's content onto a copy of the PDF using pdf-lib (loaded as the global `PDFLib`).
//
// Items are stored in view space (see geometry.js), so every drawing call converts through the
// page's rotation and crop box; edits land in the same place on rotated pages. Order on each page:
// redaction rasters, marks, text boxes, header/footer, watermark, then PDF annotations.
//
// Pass `fontBytes` (a .ttf/.otf file) to embed a Unicode font, which is needed for Vietnamese
// diacritics. Without it, Helvetica is used, which only covers basic Latin.

import { sanitizeBox } from './model.js';
import { NOTE_SIZE, arrowHeadPoints, ellipsePoints, markBounds, safeUrl, sanitizeMark, zigzagPoints } from './marks.js';
import { normalizeRotation, rectViewToPdf, viewSize, viewToPdf } from './geometry.js';
import { formatTokens, headerFooterContext, sanitizeHeaderFooter, sanitizeMeta, sanitizeWatermark } from './docsettings.js';
import { stripDiacritics } from './textlayout.js';
import { outlineTree } from './bookmarks.js';
import { OFFICE_TYPES, drawOpsPdf, officeOps } from './office/index.js';
import { measure as officeMeasure } from './office/measure.js';
import { smoothStrokePoints } from './options.js';

const LINE_HEIGHT = 1.2;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function fontError(text, err) {
  return new Error(
    `Font hiện tại không hỗ trợ một số ký tự trong "${text}". ` +
      `Hãy chọn font .ttf hỗ trợ tiếng Việt (Tệp › Chọn font) rồi xuất lại. (${err.message})`,
  );
}

function dataUrlBytes(src) {
  const bin = atob(src.slice(src.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Drawing helpers for one page, converting view coordinates to PDF space.
function pageContext(page) {
  const crop = page.getCropBox();
  const box = { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
  const rotation = normalizeRotation(page.getRotation().angle);
  return {
    page,
    rotation,
    view: viewSize(rotation, box),
    pt(vx, vy) {
      const [x, y] = viewToPdf(rotation, box, vx, vy);
      return { x, y };
    },
    rect: (x, y, w, h) => rectViewToPdf(rotation, box, x, y, w, h),
  };
}

function textWidth(font, text, size) {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch (err) {
    throw fontError(text, err);
  }
}

// Draws `text` with its baseline starting at view point (vx, vy); `angle` turns it counterclockwise.
function drawText(pc, text, vx, vy, { font, size, color, opacity = 1, angle = 0 }) {
  const p = pc.pt(vx, vy);
  try {
    pc.page.drawText(text, { x: p.x, y: p.y, size, font, color, opacity, rotate: PDFLib.degrees(pc.rotation + angle) });
  } catch (err) {
    throw fontError(text, err);
  }
}

function drawMark(pc, m, { bold, images, options = {} }) {
  const color = hexToRgb(m.color);
  const seg = (a, b, opts = {}) =>
    pc.page.drawLine({
      start: pc.pt(a[0], a[1]),
      end: pc.pt(b[0], b[1]),
      thickness: m.width,
      color,
      opacity: m.opacity,
      lineCap: PDFLib.LineCapStyle.Round,
      ...opts,
    });
  const polyline = (pts, opts) => {
    for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], opts);
  };
  const bottom = m.y + m.h;

  switch (m.type) {
    case 'note':
      pc.page.drawRectangle({ ...pc.rect(m.x, m.y, NOTE_SIZE, NOTE_SIZE), color, opacity: m.opacity, borderColor: PDFLib.rgb(0, 0, 0), borderWidth: 0.5, borderOpacity: 0.6 });
      break;
    case 'highlight':
      pc.page.drawRectangle({ ...pc.rect(m.x, m.y, m.w, m.h), color, opacity: m.opacity, borderWidth: 0 });
      break;
    case 'redact':
      pc.page.drawRectangle({ ...pc.rect(m.x, m.y, m.w, m.h), color: PDFLib.rgb(0, 0, 0), borderWidth: 0 });
      break;
    case 'underline':
      seg([m.x, bottom], [m.x + m.w, bottom]);
      break;
    case 'strike':
      seg([m.x, m.y + m.h / 2], [m.x + m.w, m.y + m.h / 2]);
      break;
    case 'squiggly':
      polyline(zigzagPoints(m.x, m.x + m.w, bottom, 1.5, 3));
      break;
    case 'rect':
      pc.page.drawRectangle({
        ...pc.rect(m.x, m.y, m.w, m.h),
        borderColor: color,
        borderWidth: m.width,
        borderOpacity: m.opacity,
        ...(m.fill ? { color: hexToRgb(m.fill), opacity: m.opacity } : {}),
      });
      break;
    case 'oval': {
      const pts = ellipsePoints(m.x, m.y, m.w, m.h);
      pts.push(pts[0]);
      polyline(pts);
      break;
    }
    case 'line':
      if (m.points.length >= 2) seg(m.points[0], m.points[1]);
      break;
    case 'arrow':
      if (m.points.length >= 2) {
        seg(m.points[0], m.points[1]);
        polyline(arrowHeadPoints(m.points[0][0], m.points[0][1], m.points[1][0], m.points[1][1]));
      }
      break;
    case 'ink':
      polyline(options.strokeSmoothing !== false ? smoothStrokePoints(m.points) : m.points);
      break;
    case 'symbol': {
      const { x, y, w, h } = m;
      const thick = { thickness: Math.max(1, Math.min(w, h) * 0.12) };
      if (m.label === 'check') polyline([[x + 0.12 * w, y + 0.55 * h], [x + 0.4 * w, y + 0.85 * h], [x + 0.9 * w, y + 0.15 * h]], thick);
      else if (m.label === 'cross') {
        seg([x + 0.15 * w, y + 0.15 * h], [x + 0.85 * w, y + 0.85 * h], thick);
        seg([x + 0.85 * w, y + 0.15 * h], [x + 0.15 * w, y + 0.85 * h], thick);
      } else {
        const c = pc.pt(x + w / 2, y + h / 2);
        pc.page.drawEllipse({ x: c.x, y: c.y, xScale: w * 0.3, yScale: h * 0.3, color, opacity: m.opacity });
      }
      break;
    }
    case 'stamp': {
      pc.page.drawRectangle({ ...pc.rect(m.x, m.y, m.w, m.h), borderColor: color, borderWidth: m.width, borderOpacity: m.opacity });
      const label = m.label || 'STAMP';
      const size = Math.max(4, Math.min(m.h * 0.5, (m.w - 12) / Math.max(1, textWidth(bold, label, 1))));
      const tw = textWidth(bold, label, size);
      drawText(pc, label, m.x + (m.w - tw) / 2, m.y + m.h / 2 + size * 0.35, { font: bold, size, color, opacity: m.opacity });
      break;
    }
    case 'image': {
      const img = images.get(m.src);
      if (!img) break;
      const p = pc.pt(m.x, m.y + m.h); // image bottom-left as displayed
      pc.page.drawImage(img, { x: p.x, y: p.y, width: m.w, height: m.h, opacity: m.opacity, rotate: PDFLib.degrees(pc.rotation) });
      break;
    }
    // 'link' is not drawn; it becomes a Link annotation.
  }
}

function addAnnotation(doc, pc, dict) {
  pc.page.node.addAnnot(doc.context.register(doc.context.obj(dict)));
}

function rectArray(r) {
  return [r.x, r.y, r.x + r.width, r.y + r.height];
}

// Comment text travels as a PDF Text annotation, so other viewers show it as a sticky note.
function addCommentAnnotation(doc, pc, m) {
  if (!m.text.trim()) return;
  const b = markBounds(m);
  const n = parseInt(m.color.slice(1), 16);
  addAnnotation(doc, pc, {
    Type: PDFLib.PDFName.of('Annot'),
    Subtype: PDFLib.PDFName.of('Text'),
    Name: PDFLib.PDFName.of('Comment'),
    Rect: rectArray(pc.rect(b.x, b.y, NOTE_SIZE, NOTE_SIZE)),
    C: [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255),
    Contents: PDFLib.PDFHexString.fromText(m.text),
    T: PDFLib.PDFHexString.fromText('PDF Editor'),
    Open: false,
    F: 4, // print
  });
}

function addLinkAnnotation(doc, pc, m) {
  if (!m.url) return;
  addAnnotation(doc, pc, {
    Type: PDFLib.PDFName.of('Annot'),
    Subtype: PDFLib.PDFName.of('Link'),
    Rect: rectArray(pc.rect(m.x, m.y, m.w, m.h)),
    Border: [0, 0, 0],
    F: 4,
    A: doc.context.obj({ Type: PDFLib.PDFName.of('Action'), S: PDFLib.PDFName.of('URI'), URI: PDFLib.PDFString.of(m.url) }),
  });
}

function drawWatermark(pc, wm, font) {
  const size = wm.fontSize;
  const tw = textWidth(font, wm.text, size);
  const th = (wm.angle * Math.PI) / 180;
  const dir = [Math.cos(th), -Math.sin(th)]; // along the text, in view space (y down)
  const up = [-Math.sin(th), -Math.cos(th)]; // towards the top of the letters
  const cx = pc.view.width / 2;
  const cy = pc.view.height / 2;
  const sx = cx - (dir[0] * tw) / 2 - up[0] * size * 0.35;
  const sy = cy - (dir[1] * tw) / 2 - up[1] * size * 0.35;
  drawText(pc, wm.text, sx, sy, { font, size, color: hexToRgb(wm.color), opacity: wm.opacity, angle: wm.angle });
}

function drawHeaderFooter(pc, hf, font, ctx) {
  const size = hf.fontSize;
  const color = hexToRgb(hf.color);
  const { width: W, height: H } = pc.view;
  for (const [row, baseline] of [['header', hf.margin + size], ['footer', H - hf.margin]]) {
    for (const pos of ['Left', 'Center', 'Right']) {
      const text = formatTokens(hf[row + pos], ctx);
      if (!text) continue;
      const tw = textWidth(font, text, size);
      const x = pos === 'Left' ? hf.margin : pos === 'Center' ? (W - tw) / 2 : W - hf.margin - tw;
      drawText(pc, text, x, baseline, { font, size, color });
    }
  }
}

// OCR words become invisible text (rendering mode 3): not painted, but searchable and selectable
// in any viewer. A word the font cannot encode is written without diacritics, or skipped.
function drawOcrLayer(pc, words, font) {
  if (!words.length) return;
  pc.page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.Invisible));
  for (const w of words) {
    const size = Math.max(2, w.h * 0.82);
    for (const text of [w.text, stripDiacritics(w.text)]) {
      try {
        drawText(pc, text, w.x, w.y + w.h * 0.8, { font, size, color: PDFLib.rgb(0, 0, 0) });
        break;
      } catch {
        // try the next form of the word
      }
    }
  }
  pc.page.pushOperators(PDFLib.popGraphicsState());
}

// Replaces the document outline with `bookmarks` (bookmarks.js). An entry scrolls to its point with an
// XYZ destination, or opens its web link. A non-empty outline opens in the viewer's bookmarks pane.
function writeOutline(doc, bookmarks) {
  const { PDFName, PDFHexString, PDFString } = PDFLib;
  doc.catalog.delete(PDFName.of('Outlines'));
  const tree = outlineTree(bookmarks);
  if (!tree.length) return;
  const ctx = doc.context;
  const pages = doc.getPages();
  const write = (nodes, parentRef) => {
    const refs = nodes.map(() => ctx.nextRef());
    let count = 0;
    nodes.forEach((n, k) => {
      const dict = { Title: PDFHexString.fromText(n.title || '(không tên)'), Parent: parentRef };
      if (k > 0) dict.Prev = refs[k - 1];
      if (k < nodes.length - 1) dict.Next = refs[k + 1];
      const page = pages[n.page];
      const url = safeUrl(n.url);
      if (url) dict.A = ctx.obj({ S: 'URI', URI: PDFString.of(url) });
      else if (page) dict.Dest = ctx.obj([page.ref, PDFName.of('XYZ'), n.left ?? null, n.top ?? null, null]);
      if (n.children.length) {
        const sub = write(n.children, refs[k]);
        Object.assign(dict, { First: sub.first, Last: sub.last, Count: sub.count });
        count += sub.count;
      }
      ctx.assign(refs[k], ctx.obj(dict));
      count++;
    });
    return { first: refs[0], last: refs.at(-1), count };
  };
  const rootRef = ctx.nextRef();
  const top = write(tree, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count }));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

// Removes hidden content: document metadata, JavaScript, embedded files and automatic actions.
function sanitizeDocument(doc) {
  const { PDFName, PDFDict } = PDFLib;
  for (const key of ['OpenAction', 'AA', 'Metadata', 'PieceInfo']) doc.catalog.delete(PDFName.of(key));
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names) for (const key of ['JavaScript', 'EmbeddedFiles']) names.delete(PDFName.of(key));
  for (const page of doc.getPages()) for (const key of ['AA', 'PieceInfo']) page.node.delete(PDFName.of(key));
  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setCreator('');
  doc.setProducer('');
}

function applyForm(doc, values, flatten, font) {
  const names = Object.keys(values ?? {});
  if (!names.length && !flatten) return false;
  let form;
  try {
    form = doc.getForm();
  } catch {
    return false;
  }
  for (const name of names) {
    let field;
    try {
      field = form.getField(name);
    } catch {
      continue; // the field is gone, e.g. its page was deleted
    }
    const v = values[name];
    try {
      if (field instanceof PDFLib.PDFTextField) field.setText(String(v ?? ''));
      else if (field instanceof PDFLib.PDFCheckBox) v ? field.check() : field.uncheck();
      else if ((field instanceof PDFLib.PDFDropdown || field instanceof PDFLib.PDFRadioGroup) && v) field.select(String(v));
    } catch (err) {
      throw new Error(`Không điền được trường "${name}": ${err.message}`);
    }
  }
  try {
    form.updateFieldAppearances(font);
  } catch (err) {
    throw fontError(names.map((n) => values[n]).join(' '), err);
  }
  if (flatten) form.flatten();
  return true;
}

/**
 * @param {Uint8Array} pdfBytes  source PDF
 * @param {Array} boxes          text boxes (model.js)
 * @param {object} options
 *   fontBytes     .ttf/.otf for Unicode text
 *   marks         markup (marks.js)
 *   settings      { watermark, headerFooter, meta, formValues, flattenForm } (docsettings.js)
 *   rasterPages   Map(pageIndex -> { png, width, height }) from redact.js
 *   context       { file, date } for header/footer tokens
 */
export async function exportPdf(pdfBytes, boxes, { fontBytes, marks = [], settings = {}, rasterPages, context = {}, officeFonts = null } = {}) {
  // pdf-lib stamps its own producer and dates on load unless told not to; sanitizing keeps them out.
  const doc = await PDFLib.PDFDocument.load(pdfBytes, { updateMetadata: !settings.sanitize });

  for (const [index, r] of rasterPages ?? []) {
    const img = await doc.embedPng(r.png);
    doc.removePage(index);
    doc.insertPage(index, [r.width, r.height]).drawImage(img, { x: 0, y: 0, width: r.width, height: r.height });
  }

  let regular;
  let bold;
  if (fontBytes) {
    doc.registerFontkit(fontkit);
    regular = await doc.embedFont(fontBytes, { subset: true });
    bold = regular;
  } else {
    regular = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  }

  const clean = marks.map(sanitizeMark);
  const images = new Map();
  for (const m of clean) {
    if (m.type !== 'image' || !m.src || images.has(m.src)) continue;
    const bytes = dataUrlBytes(m.src);
    images.set(m.src, m.src.startsWith('data:image/png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes));
  }

  const pages = doc.getPages().map(pageContext);

  // Shapes, formulas, tables and rich text are drawn from the same ops as on screen, with the
  // DejaVu variants they were measured with (`officeFonts`: variant -> font bytes).
  const office = { regular };
  if (officeFonts) {
    doc.registerFontkit(fontkit);
    for (const [variant, bytes] of Object.entries(officeFonts)) office[variant] = await doc.embedFont(bytes, { subset: true });
  }
  const officeEncode = (text, font) => {
    if (officeFonts) return text;
    try {
      font.encodeText(text);
      return text;
    } catch {
      return stripDiacritics(text); // Helvetica without the Unicode font: keep the letters, drop the accents
    }
  };

  for (const m of clean) {
    const pc = pages[m.page];
    if (!pc) continue;
    if (OFFICE_TYPES.has(m.type)) {
      let ops = [];
      try {
        ops = officeOps(m, officeMeasure);
      } catch {
        // a formula that does not parse is left out, as it shows an error on screen
      }
      drawOpsPdf(pc, ops, office, officeEncode);
    } else {
      drawMark(pc, m, { bold, images, options: settings.options });
    }
  }

  for (const raw of boxes) {
    const box = sanitizeBox(raw);
    const pc = pages[box.page];
    if (!pc || !box.text) continue;
    const color = hexToRgb(box.color);
    box.text.split('\n').forEach((line, i) => {
      if (!line) return;
      const baseline = box.y + box.fontSize + i * box.fontSize * LINE_HEIGHT;
      drawText(pc, line, box.x, baseline, { font: regular, size: box.fontSize, color });
    });
  }

  const hf = sanitizeHeaderFooter(settings.headerFooter);
  const wm = sanitizeWatermark(settings.watermark);
  pages.forEach((pc, i) => {
    const ctx = hf && headerFooterContext(hf, i, pages.length, context);
    if (ctx) drawHeaderFooter(pc, hf, regular, ctx);
    if (wm) drawWatermark(pc, wm, regular);
  });

  // OCR words under a redaction box would put the removed text back as invisible text, so they are dropped.
  const redactions = clean.filter((m) => m.type === 'redact');
  const redacted = (w) => redactions.some((r) => r.page === w.page && w.x < r.x + r.w && w.x + w.w > r.x && w.y < r.y + r.h && w.y + w.h > r.y);
  const ocrWords = (settings.ocrWords ?? []).filter((w) => !redacted(w));
  for (const [i, pc] of pages.entries()) drawOcrLayer(pc, ocrWords.filter((w) => w.page === i), regular);

  for (const m of clean) {
    const pc = pages[m.page];
    if (!pc) continue;
    addCommentAnnotation(doc, pc, m);
    if (m.type === 'link') addLinkAnnotation(doc, pc, m);
  }

  const formTouched = applyForm(doc, settings.formValues, settings.flattenForm, regular);

  // Bookmarks edited in the outline panel replace the document's own outline (null: keep it).
  if (Array.isArray(settings.bookmarks)) writeOutline(doc, settings.bookmarks);
  if (settings.sanitize) sanitizeDocument(doc);
  const meta = sanitizeMeta(settings.meta);
  if (meta) {
    if (meta.title) doc.setTitle(meta.title);
    if (meta.author) doc.setAuthor(meta.author);
    if (meta.subject) doc.setSubject(meta.subject);
    if (meta.keywords) doc.setKeywords(meta.keywords.split(',').map((k) => k.trim()).filter(Boolean));
  }

  // Field appearances were already built with the chosen font above.
  return doc.save(formTouched ? { updateFieldAppearances: false } : {});
}
