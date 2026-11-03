// Page-level operations on PDF bytes with pdf-lib (loaded as the global `PDFLib`).
// Each function returns new bytes and never modifies its input.

import { normalizeRotation, rectPdfToView } from './geometry.js';

function load(bytes) {
  return PDFLib.PDFDocument.load(bytes);
}

export async function rotatePages(bytes, indices, delta) {
  const doc = await load(bytes);
  for (const i of indices) {
    const page = doc.getPage(i);
    page.setRotation(PDFLib.degrees((((page.getRotation().angle + delta) % 360) + 360) % 360));
  }
  return doc.save();
}

export async function deletePages(bytes, indices) {
  const doc = await load(bytes);
  if (indices.length >= doc.getPageCount()) throw new Error('Không thể xóa mọi trang của tài liệu.');
  [...indices].sort((a, b) => b - a).forEach((i) => doc.removePage(i));
  return doc.save();
}

// Inserts a blank page of `size` [width, height] points before position `at`.
export async function insertBlankPage(bytes, at, size) {
  const doc = await load(bytes);
  doc.insertPage(at, size);
  return doc.save();
}

export async function movePage(bytes, from, to) {
  const doc = await load(bytes);
  const page = doc.getPage(from);
  doc.removePage(from);
  doc.insertPage(to, page);
  return doc.save();
}

// Puts the pages in a new order: order[k] is the old index of the page that goes to position k.
// Pages move inside the same document, so form fields, bookmarks and metadata are kept.
export async function reorderPages(bytes, order) {
  const doc = await load(bytes);
  const n = doc.getPageCount();
  if (order.length !== n || new Set(order).size !== n || order.some((i) => !Number.isInteger(i) || i < 0 || i >= n)) {
    throw new Error('Thứ tự trang không hợp lệ.');
  }
  const pages = doc.getPages();
  const positions = [...pages.keys()]; // old index of the page at each position
  order.forEach((from, k) => {
    const at = positions.indexOf(from);
    if (at === k) return;
    doc.removePage(at);
    doc.insertPage(k, pages[from]);
    positions.splice(at, 1);
    positions.splice(k, 0, from);
  });
  return doc.save();
}

// Crop box and rotation of every page, in PDF space.
export async function pageBoxes(bytes) {
  const doc = await load(bytes);
  return doc.getPages().map((p) => {
    const b = p.getCropBox();
    return { box: { x: b.x, y: b.y, width: b.width, height: b.height }, rotation: p.getRotation().angle };
  });
}

// Sets new crop boxes: `boxes` maps a page index to { x, y, width, height } in PDF space.
export async function cropPages(bytes, boxes) {
  const doc = await load(bytes);
  for (const [i, b] of boxes) doc.getPage(i).setCropBox(b.x, b.y, b.width, b.height);
  return doc.save();
}

// One document with every page of each file in `list`, in order. The first file is the base, so
// its form fields, bookmarks and properties are kept.
export async function mergePdfs(list) {
  if (!list.length) throw new Error('Chưa có tệp nào để gộp.');
  const doc = await load(list[0]);
  for (const other of list.slice(1)) {
    const src = await load(other);
    for (const page of await doc.copyPages(src, src.getPageIndices())) doc.addPage(page);
  }
  return doc.save();
}

export async function duplicatePage(bytes, index) {
  const doc = await load(bytes);
  const [copy] = await doc.copyPages(doc, [index]);
  doc.insertPage(index + 1, copy);
  return doc.save();
}

// A new document holding copies of the given pages, in the given order.
export async function extractPages(bytes, indices) {
  const src = await load(bytes);
  const out = await PDFLib.PDFDocument.create();
  for (const page of await out.copyPages(src, indices)) out.addPage(page);
  return out.save();
}

// Appends every page of `other` after the last page of `bytes`.
export async function appendPdf(bytes, other) {
  const doc = await load(bytes);
  const src = await load(other);
  for (const page of await doc.copyPages(src, src.getPageIndices())) doc.addPage(page);
  return doc.save();
}

// One page per image, sized to the image at 96 dpi (1 px = 0.75 pt).
export async function imagesToPdf(images) {
  const doc = await PDFLib.PDFDocument.create();
  for (const { bytes, type } of images) {
    const img = type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const w = img.width * 0.75;
    const h = img.height * 0.75;
    doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return doc.save();
}

export async function blankPdf(size = [595.28, 841.89]) {
  const doc = await PDFLib.PDFDocument.create();
  doc.addPage(size);
  return doc.save();
}

// Reads the AcroForm fields that this editor can fill: text, checkbox, dropdown and radio group,
// along with each widget's page index and view-space rectangle for on-page interactive filling.
export async function readFormFields(bytes) {
  let doc;
  let form;
  try {
    doc = await load(bytes);
    form = doc.getForm();
  } catch {
    return [];
  }
  const pages = doc.getPages();
  const pageByRef = new Map(pages.map((p, idx) => [p.ref.toString(), idx]));
  const pageAnnots = pages.map((p) => {
    try {
      const annots = p.node.Annots();
      return annots ? new Set(annots.asArray().map((r) => r.toString())) : new Set();
    } catch {
      return new Set();
    }
  });
  const resolveWidgetPage = (w) => {
    try {
      const pRef = w.P?.();
      if (pRef && pageByRef.has(pRef.toString())) return pageByRef.get(pRef.toString());
    } catch {
      // Fall back to scanning page annotation arrays below.
    }
    try {
      const dictStr = doc.context.getObjectRef?.(w.dict)?.toString();
      if (dictStr) {
        const idx = pageAnnots.findIndex((set) => set.has(dictStr));
        if (idx >= 0) return idx;
      }
    } catch {
      // Ignore if widget dict has no indirect ref.
    }
    return 0;
  };
  const extractWidgets = (f) => {
    try {
      const rawWidgets = f.acroField?.getWidgets?.() ?? [];
      return rawWidgets.map((w, idx) => {
        const pageIdx = resolveWidgetPage(w);
        const p = pages[pageIdx] ?? pages[0];
        const crop = p.getCropBox();
        const rot = normalizeRotation(p.getRotation().angle);
        const r = w.getRectangle();
        const vr = rectPdfToView(rot, crop, r.x, r.y, r.width, r.height);
        let exportValue = '';
        try {
          exportValue = w.getOnValue?.()?.decodeText?.() ?? String(w.getOnValue?.() ?? '').replace(/^\//, '');
        } catch {
          exportValue = `${idx + 1}`;
        }
        return {
          page: pageIdx,
          x: Math.round(vr.x * 100) / 100,
          y: Math.round(vr.y * 100) / 100,
          w: Math.max(8, Math.round(vr.w * 100) / 100),
          h: Math.max(8, Math.round(vr.h * 100) / 100),
          exportValue,
        };
      });
    } catch {
      return [];
    }
  };

  const out = [];
  for (const f of form.getFields()) {
    const name = f.getName();
    try {
      const widgets = extractWidgets(f);
      const required = !!f.isRequired?.();
      const readOnly = !!f.isReadOnly?.();
      if (f instanceof PDFLib.PDFTextField) out.push({ name, kind: 'text', value: f.getText() ?? '', multiline: f.isMultiline(), required, readOnly, widgets });
      else if (f instanceof PDFLib.PDFCheckBox) out.push({ name, kind: 'check', value: f.isChecked(), required, readOnly, widgets });
      else if (f instanceof PDFLib.PDFDropdown) out.push({ name, kind: 'choice', value: f.getSelected()[0] ?? '', options: f.getOptions(), required, readOnly, widgets });
      else if (f instanceof PDFLib.PDFRadioGroup) out.push({ name, kind: 'radio', value: f.getSelected() ?? '', options: f.getOptions(), required, readOnly, widgets });
    } catch {
      // A malformed field is skipped rather than blocking the whole form.
    }
  }
  return out;
}
