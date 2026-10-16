// Page-level operations on PDF bytes with pdf-lib (loaded as the global `PDFLib`).
// Each function returns new bytes and never modifies its input.

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

// Reads the AcroForm fields that this editor can fill: text, checkbox, dropdown and radio group.
export async function readFormFields(bytes) {
  let form;
  try {
    form = (await load(bytes)).getForm();
  } catch {
    return [];
  }
  const out = [];
  for (const f of form.getFields()) {
    const name = f.getName();
    try {
      if (f instanceof PDFLib.PDFTextField) out.push({ name, kind: 'text', value: f.getText() ?? '', multiline: f.isMultiline() });
      else if (f instanceof PDFLib.PDFCheckBox) out.push({ name, kind: 'check', value: f.isChecked() });
      else if (f instanceof PDFLib.PDFDropdown) out.push({ name, kind: 'choice', value: f.getSelected()[0] ?? '', options: f.getOptions() });
      else if (f instanceof PDFLib.PDFRadioGroup) out.push({ name, kind: 'radio', value: f.getSelected() ?? '', options: f.getOptions() });
    } catch {
      // A malformed field is skipped rather than blocking the whole form.
    }
  }
  return out;
}
