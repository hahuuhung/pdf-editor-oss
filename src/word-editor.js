// Word Studio - Modern DOCX Reader and Word-like WYSIWYG Document Editor
// Supports loading .docx via Mammoth, full WYSIWYG rich text formatting on A4 pages,
// export to .docx via the docx library, export to PDF, and printing.

import { el, icon } from './dom.js';
import { LIB_URLS, loadScript } from './libs.js';

// ---------- Pure Text & HTML Processing Helpers ----------

// Counts words, total characters, characters without spaces, and paragraphs.
export function countWordsAndChars(text) {
  const rawChars = String(text ?? '');
  const str = rawChars.trim();
  if (!str) {
    return { words: 0, characters: rawChars.length, charactersNoSpaces: 0, paragraphs: 0 };
  }

  const characters = rawChars.length;
  const charactersNoSpaces = rawChars.replace(/\s/g, '').length;

  // Split words by whitespace
  const words = str.split(/\s+/).filter(Boolean).length;

  // Count paragraphs (separated by newlines)
  const paragraphs = str.split(/\n+/).filter((p) => p.trim().length > 0).length;

  return { words, characters, charactersNoSpaces, paragraphs };
}

// Sanitizes and strips unsafe tags and event handlers from HTML.
export function cleanWordHtml(html) {
  let clean = String(html ?? '');

  // Strip scripts, iframes, objects, embeds
  clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  clean = clean.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  clean = clean.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');

  // Strip all on* event handler attributes (e.g. onclick, onmouseover)
  clean = clean.replace(/\s+on[a-z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');

  // Strip javascript: URLs
  clean = clean.replace(/href\s*=\s*(?:'javascript:[^']*'|"javascript:[^"]*")/gi, 'href="#"');

  return clean.trim();
}

// Recursively extracts styled text runs from DOM nodes.
export function extractTextRunsFromNode(node, currentStyle = { bold: false, italic: false, underline: false, color: null }) {
  if (!node) return [];

  // Text node (type 3)
  if (node.nodeType === 3) {
    const text = node.nodeValue ?? '';
    return text ? [{ text, ...currentStyle }] : [];
  }

  // Element node (type 1)
  if (node.nodeType === 1) {
    const tag = (node.nodeName || '').toUpperCase();
    const style = { ...currentStyle };

    if (tag === 'B' || tag === 'STRONG') style.bold = true;
    if (tag === 'I' || tag === 'EM') style.italic = true;
    if (tag === 'U') style.underline = true;
    if (tag === 'FONT' && node.color) style.color = node.color;
    if (node.style?.color) style.color = node.style.color;

    const out = [];
    for (const child of node.childNodes || []) {
      out.push(...extractTextRunsFromNode(child, style));
    }
    return out;
  }

  return [];
}

// Parses table rows and cells into a 2D string matrix from an HTML string.
export function parseTableMatrixFromHtml(tableHtml) {
  const rows = [];
  const trMatches = tableHtml.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi) || [];

  for (const tr of trMatches) {
    const cells = [];
    const cellMatches = tr.match(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi) || [];
    for (const cell of cellMatches) {
      // Strip tags inside cell to get text content
      const text = cell.replace(/<[^>]+>/g, '').trim();
      cells.push(text);
    }
    if (cells.length) rows.push(cells);
  }

  return rows;
}

// Builds a Microsoft Word .docx Blob from the editor's DOM container.
export async function buildDocxFromHtml(containerElement, title = 'Tài liệu Word') {
  await loadScript(LIB_URLS.docx);
  const docxLib = globalThis.docx;
  if (!docxLib) throw new Error('Không tải được thư viện docx.');

  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    BorderStyle,
  } = docxLib;

  const children = [];

  // Helper to map align string to AlignmentType
  const getAlignment = (alignStr) => {
    switch ((alignStr || '').toLowerCase()) {
      case 'center': return AlignmentType.CENTER;
      case 'right': return AlignmentType.RIGHT;
      case 'justify': return AlignmentType.JUSTIFIED;
      case 'left': default: return AlignmentType.LEFT;
    }
  };

  // Traverse direct children of the page container
  const childNodes = Array.from(containerElement.children);

  for (const el of childNodes) {
    const tag = (el.tagName || '').toUpperCase();
    const align = getAlignment(el.style.textAlign);

    if (tag === 'H1') {
      const runs = extractTextRunsFromNode(el).map((r) => new TextRun({ text: r.text, bold: true, size: 36 }));
      children.push(new Paragraph({ children: runs, heading: HeadingLevel.HEADING_1, alignment: align }));
    } else if (tag === 'H2') {
      const runs = extractTextRunsFromNode(el).map((r) => new TextRun({ text: r.text, bold: true, size: 28 }));
      children.push(new Paragraph({ children: runs, heading: HeadingLevel.HEADING_2, alignment: align }));
    } else if (tag === 'H3') {
      const runs = extractTextRunsFromNode(el).map((r) => new TextRun({ text: r.text, bold: true, size: 24 }));
      children.push(new Paragraph({ children: runs, heading: HeadingLevel.HEADING_3, alignment: align }));
    } else if (tag === 'TABLE') {
      const matrix = parseTableMatrixFromHtml(el.outerHTML);
      if (matrix.length) {
        const tableRows = matrix.map((row, rIdx) => {
          const tableCells = row.map((cellText) => new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: cellText, bold: rIdx === 0 })] })],
            width: { size: Math.floor(100 / Math.max(1, row.length)), type: WidthType.PERCENTAGE },
          }));
          return new TableRow({ children: tableCells });
        });
        children.push(new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        }));
      }
    } else if (tag === 'UL' || tag === 'OL') {
      const listItems = Array.from(el.querySelectorAll('li'));
      for (let i = 0; i < listItems.length; i++) {
        const li = listItems[i];
        const runs = extractTextRunsFromNode(li).map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic }));
        children.push(new Paragraph({
          children: runs,
          bullet: tag === 'UL' ? { level: 0 } : undefined,
          numbering: tag === 'OL' ? { reference: 'numbered-list', level: 0 } : undefined,
        }));
      }
    } else if (tag === 'HR') {
      children.push(new Paragraph({
        border: { bottom: { color: 'E2E8F0', space: 1, style: BorderStyle.SINGLE, size: 6 } },
      }));
    } else {
      // Normal paragraph or div
      const rawRuns = extractTextRunsFromNode(el);
      const runs = rawRuns.map((r) => new TextRun({
        text: r.text,
        bold: r.bold,
        italics: r.italic,
        underline: r.underline ? {} : undefined,
      }));
      children.push(new Paragraph({
        children: runs.length ? runs : [new TextRun('')],
        alignment: align,
      }));
    }
  }

  const doc = new Document({
    creator: 'PDF Editor OSS - Word Studio',
    title,
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // 1 inch / 25.4 mm
        },
      },
      children: children.length ? children : [new Paragraph({ text: title })],
    }],
  });

  return Packer.toBlob(doc);
}

// ---------- Word Studio UI Component ----------

export function createWordStudio({
  container,
  onClose,
  onExportPdf,
  onPrint,
  onStatus,
  downloadFn,
}) {
  let currentFileName = 'Tai-lieu-Word.docx';

  // Toolbar Element References
  const fontSelect = el('select', { class: 'word-select', title: 'Phông chữ' },
    el('option', { value: "'Times New Roman', serif", selected: true }, 'Times New Roman'),
    el('option', { value: 'Arial, sans-serif' }, 'Arial'),
    el('option', { value: 'Calibri, sans-serif' }, 'Calibri'),
    el('option', { value: 'Roboto, sans-serif' }, 'Roboto'),
    el('option', { value: "'DejaVu Sans', sans-serif' " }, 'DejaVu Sans'),
  );

  const sizeSelect = el('select', { class: 'word-select', title: 'Cỡ chữ' },
    ...[10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32].map((s) =>
      el('option', { value: `${s}pt`, selected: s === 13 }, `${s} pt`)
    ),
  );

  const btnBold = el('button', { type: 'button', class: 'word-tool-btn', title: 'In đậm (Ctrl+B)' }, icon('bold', 15));
  const btnItalic = el('button', { type: 'button', class: 'word-tool-btn', title: 'In nghiêng (Ctrl+I)' }, icon('italic', 15));
  const btnUnderline = el('button', { type: 'button', class: 'word-tool-btn', title: 'Gạch chân (Ctrl+U)' }, icon('underline', 15));
  const btnStrike = el('button', { type: 'button', class: 'word-tool-btn', title: 'Gạch ngang' }, icon('strike', 15));

  // Color Pickers
  const textColorInput = el('input', { type: 'color', class: 'word-color-input', value: '#111827', title: 'Màu chữ' });
  const btnTextColor = el('div', { class: 'word-color-picker-wrap word-tool-btn', title: 'Màu văn bản' },
    icon('textColor', 15),
    textColorInput,
  );

  const highlightColorInput = el('input', { type: 'color', class: 'word-color-input', value: '#fef08a', title: 'Màu nền tô sáng' });
  const btnHighlight = el('div', { class: 'word-color-picker-wrap word-tool-btn', title: 'Màu đánh dấu highlight' },
    icon('highlight', 15),
    highlightColorInput,
  );

  // Alignment Buttons
  const btnAlignLeft = el('button', { type: 'button', class: 'word-tool-btn active', title: 'Căn trái (Ctrl+L)' }, icon('alignLeft', 15));
  const btnAlignCenter = el('button', { type: 'button', class: 'word-tool-btn', title: 'Căn giữa (Ctrl+E)' }, icon('alignCenter', 15));
  const btnAlignRight = el('button', { type: 'button', class: 'word-tool-btn', title: 'Căn phải (Ctrl+R)' }, icon('alignRight', 15));
  const btnAlignJustify = el('button', { type: 'button', class: 'word-tool-btn', title: 'Căn đều hai bên (Ctrl+J)' }, icon('alignJustify', 15));

  // Lists & Indent
  const btnBulletList = el('button', { type: 'button', class: 'word-tool-btn', title: 'Danh sách dấu chấm' }, icon('note', 15));
  const btnNumberList = el('button', { type: 'button', class: 'word-tool-btn', title: 'Danh sách đánh số' }, icon('listNumber', 15));
  const btnOutdent = el('button', { type: 'button', class: 'word-tool-btn', title: 'Giảm thụt lề' }, icon('prev', 14));
  const btnIndent = el('button', { type: 'button', class: 'word-tool-btn', title: 'Tăng thụt lề' }, icon('next', 14));

  // Insert Objects
  const btnInsertTable = el('button', { type: 'button', class: 'word-tool-btn', title: 'Chèn bảng biểu' }, icon('grid', 15));
  const btnInsertImage = el('button', { type: 'button', class: 'word-tool-btn', title: 'Chèn hình ảnh' }, icon('images', 15));
  const btnInsertHr = el('button', { type: 'button', class: 'word-tool-btn', title: 'Chèn đường kẻ ngang' }, icon('line', 15));

  // Undo / Redo
  const btnUndo = el('button', { type: 'button', class: 'word-tool-btn', title: 'Hoàn tác (Ctrl+Z)' }, icon('undo', 15));
  const btnRedo = el('button', { type: 'button', class: 'word-tool-btn', title: 'Làm lại (Ctrl+Y)' }, icon('redo', 15));

  // Top action buttons
  const btnSaveDocx = el('button', { type: 'button', class: 'word-action-btn primary', title: 'Lưu thành tệp Word' },
    icon('save', 14),
    el('span', {}, 'Lưu .docx'),
  );
  const btnExportPdf = el('button', { type: 'button', class: 'word-action-btn', title: 'Xuất văn bản sang PDF' },
    icon('file', 14),
    el('span', {}, 'Xuất PDF'),
  );
  const btnPrintDoc = el('button', { type: 'button', class: 'word-action-btn', title: 'In văn bản' },
    icon('print', 14),
    el('span', {}, 'In'),
  );
  const btnCloseStudio = el('button', { type: 'button', class: 'word-action-btn', title: 'Đóng chế độ Word' },
    icon('cross', 14),
    el('span', {}, 'Đóng Word'),
  );

  // Hidden Image File Picker
  const imagePicker = el('input', { type: 'file', accept: 'image/*', hidden: true });

  // Toolbar Assembly
  const toolbar = el('div', { class: 'word-toolbar' },
    el('div', { class: 'word-toolbar-group' }, fontSelect, sizeSelect),
    el('div', { class: 'word-toolbar-divider' }),
    el('div', { class: 'word-toolbar-group' }, btnBold, btnItalic, btnUnderline, btnStrike),
    el('div', { class: 'word-toolbar-divider' }),
    el('div', { class: 'word-toolbar-group' }, btnTextColor, btnHighlight),
    el('div', { class: 'word-toolbar-divider' }),
    el('div', { class: 'word-toolbar-group' }, btnAlignLeft, btnAlignCenter, btnAlignRight, btnAlignJustify),
    el('div', { class: 'word-toolbar-divider' }),
    el('div', { class: 'word-toolbar-group' }, btnBulletList, btnNumberList, btnOutdent, btnIndent),
    el('div', { class: 'word-toolbar-divider' }),
    el('div', { class: 'word-toolbar-group' }, btnInsertTable, btnInsertImage, btnInsertHr),
    el('div', { class: 'word-toolbar-divider' }),
    el('div', { class: 'word-toolbar-group' }, btnUndo, btnRedo),
    el('div', { style: 'flex: 1;' }),
    el('div', { class: 'word-toolbar-group' }, btnSaveDocx, btnExportPdf, btnPrintDoc, btnCloseStudio),
  );

  // Editable A4 Page Simulator
  const pageEditor = el('div', {
    class: 'word-page',
    contenteditable: 'true',
    spellcheck: 'false',
    role: 'textbox',
    'aria-multiline': 'true',
  });

  const viewport = el('div', { class: 'word-viewport' }, pageEditor);

  // Status Bar
  const statWords = el('span', { class: 'word-stat-item' }, '0 từ');
  const statChars = el('span', { class: 'word-stat-item' }, '0 ký tự');
  const statDoc = el('span', { class: 'word-stat-item' }, currentFileName);

  const statusbar = el('div', { class: 'word-statusbar' },
    el('div', { class: 'word-stats' }, statWords, statChars, el('span', {}, '·'), el('span', {}, 'Trang A4')),
    el('div', { class: 'word-stats' }, statDoc),
  );

  // Studio Container
  const studioRoot = el('div', { class: 'word-studio hidden' }, toolbar, viewport, statusbar, imagePicker);
  container.append(studioRoot);

  // ---------- Execution of Formatting Commands ----------

  const exec = (cmd, val = null) => {
    pageEditor.focus();
    document.execCommand(cmd, false, val);
    updateStats();
    updateToolbarState();
  };

  btnBold.onclick = () => exec('bold');
  btnItalic.onclick = () => exec('italic');
  btnUnderline.onclick = () => exec('underline');
  btnStrike.onclick = () => exec('strikeThrough');

  fontSelect.onchange = () => exec('fontName', fontSelect.value);
  sizeSelect.onchange = () => {
    // Custom font size styling
    pageEditor.focus();
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      const span = document.createElement('span');
      span.style.fontSize = sizeSelect.value;
      const range = selection.getRangeAt(0);
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } else {
      document.execCommand('fontSize', false, '3');
    }
  };

  textColorInput.oninput = () => exec('foreColor', textColorInput.value);
  highlightColorInput.oninput = () => exec('hiliteColor', highlightColorInput.value);

  btnAlignLeft.onclick = () => { exec('justifyLeft'); setActiveAlign(btnAlignLeft); };
  btnAlignCenter.onclick = () => { exec('justifyCenter'); setActiveAlign(btnAlignCenter); };
  btnAlignRight.onclick = () => { exec('justifyRight'); setActiveAlign(btnAlignRight); };
  btnAlignJustify.onclick = () => { exec('justifyFull'); setActiveAlign(btnAlignJustify); };

  function setActiveAlign(btn) {
    [btnAlignLeft, btnAlignCenter, btnAlignRight, btnAlignJustify].forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  }

  btnBulletList.onclick = () => exec('insertUnorderedList');
  btnNumberList.onclick = () => exec('insertOrderedList');
  btnOutdent.onclick = () => exec('outdent');
  btnIndent.onclick = () => exec('indent');

  btnUndo.onclick = () => exec('undo');
  btnRedo.onclick = () => exec('redo');

  btnInsertHr.onclick = () => exec('insertHorizontalRule');

  // Insert Table
  btnInsertTable.onclick = () => {
    const rows = prompt('Nhập số hàng (Rows):', '3');
    const cols = prompt('Nhập số cột (Columns):', '3');
    const r = Math.min(20, Math.max(1, Number(rows) || 3));
    const c = Math.min(10, Math.max(1, Number(cols) || 3));

    let tableHtml = '<table style="width: 100%; border-collapse: collapse; margin: 1em 0;"><tbody>';
    for (let i = 0; i < r; i++) {
      tableHtml += '<tr>';
      for (let j = 0; j < c; j++) {
        const isHeader = i === 0;
        tableHtml += `<${isHeader ? 'th' : 'td'} style="border: 1px solid #cbd5e1; padding: 8px 12px; min-width: 40px;">${isHeader ? `Cột ${j + 1}` : 'Ô dữ liệu'}</${isHeader ? 'th' : 'td'}>`;
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table><p><br></p>';
    exec('insertHTML', tableHtml);
  };

  // Insert Image
  btnInsertImage.onclick = () => imagePicker.click();
  imagePicker.onchange = () => {
    const file = imagePicker.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        exec('insertHTML', `<img src="${e.target.result}" style="max-width: 100%; height: auto; border-radius: 4px; margin: 8px 0;" alt="Hình ảnh" /><p><br></p>`);
      };
      reader.readAsDataURL(file);
    }
    imagePicker.value = '';
  };

  // Update Toolbar States on Selection Change
  function updateToolbarState() {
    btnBold.classList.toggle('active', document.queryCommandState('bold'));
    btnItalic.classList.toggle('active', document.queryCommandState('italic'));
    btnUnderline.classList.toggle('active', document.queryCommandState('underline'));
    btnStrike.classList.toggle('active', document.queryCommandState('strikeThrough'));
  }

  document.addEventListener('selectionchange', () => {
    if (studioRoot.classList.contains('hidden')) return;
    if (document.activeElement === pageEditor || pageEditor.contains(document.activeElement)) {
      updateToolbarState();
    }
  });

  // Word Counter
  function updateStats() {
    const text = pageEditor.innerText || '';
    const stats = countWordsAndChars(text);
    statWords.textContent = `${stats.words.toLocaleString('vi-VN')} từ`;
    statChars.textContent = `${stats.characters.toLocaleString('vi-VN')} ký tự`;
  }

  pageEditor.addEventListener('input', updateStats);

  // ---------- Action Handlers ----------

  // Save to DOCX
  btnSaveDocx.onclick = async () => {
    onStatus?.('Đang kết xuất tệp Word (.docx)…');
    try {
      const blob = await buildDocxFromHtml(pageEditor, currentFileName.replace(/\.[^.]+$/, ''));
      if (downloadFn) {
        downloadFn(blob, currentFileName);
      } else {
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: currentFileName });
        a.click();
        URL.revokeObjectURL(url);
      }
      onStatus?.(`Đã lưu tệp ${currentFileName}.`);
    } catch (err) {
      console.error(err);
      alert(`Không thể lưu DOCX: ${err.message}`);
    }
  };

  // Export to PDF
  btnExportPdf.onclick = async () => {
    onStatus?.('Đang xuất văn bản sang PDF…');
    if (onExportPdf) {
      await onExportPdf(pageEditor.innerHTML, currentFileName.replace(/\.[^.]+$/, ''));
    } else {
      window.print();
    }
  };

  // Print
  btnPrintDoc.onclick = () => {
    if (onPrint) onPrint(pageEditor);
    else window.print();
  };

  // Close Studio
  btnCloseStudio.onclick = () => {
    studioRoot.classList.add('hidden');
    onClose?.();
  };

  // ---------- Public Methods ----------

  async function openDocx(fileData, fileName = 'Tai-lieu-Word.docx') {
    onStatus?.('Đang đọc tài liệu Word…');
    await loadScript(LIB_URLS.mammoth);
    const mammoth = globalThis.mammoth;
    if (!mammoth) throw new Error('Không tải được thư viện Mammoth để đọc tệp Word.');

    const { value: rawHtml } = await mammoth.convertToHtml({ arrayBuffer: fileData });
    const clean = cleanWordHtml(rawHtml || '<p>Văn bản trống.</p>');

    currentFileName = fileName;
    statDoc.textContent = currentFileName;
    pageEditor.innerHTML = clean;
    updateStats();

    studioRoot.classList.remove('hidden');
    pageEditor.focus();
    onStatus?.(`Đã mở ${fileName} trong chế độ soạn thảo Word.`);
  }

  function newWordDocument(title = 'Tài liệu Word mới.docx') {
    currentFileName = title;
    statDoc.textContent = currentFileName;

    pageEditor.innerHTML = `
      <h1 style="text-align: center; color: #1e3a8a;">TIÊU ĐỀ TÀI LIỆU</h1>
      <p style="text-align: center; font-style: italic; color: #64748b; margin-bottom: 2em;">Ngày soạn thảo: ${new Date().toLocaleDateString('vi-VN')}</p>
      <p>Bắt đầu nhập nội dung tài liệu tại đây. Bạn có thể sử dụng thanh công cụ phía trên để định dạng phông chữ, in đậm, căn lề, chèn bảng biểu hoặc hình ảnh...</p>
    `;
    updateStats();

    studioRoot.classList.remove('hidden');
    pageEditor.focus();
    onStatus?.('Đã tạo văn bản Word mới.');
  }

  return {
    root: studioRoot,
    editor: pageEditor,
    openDocx,
    newWordDocument,
    close: () => { studioRoot.classList.add('hidden'); onClose?.(); },
    isOpen: () => !studioRoot.classList.contains('hidden'),
  };
}
