// Quick tools: one-click entry points to the most used jobs, shown as cards on the start screen and
// in the Quick tools dialog. A card names an editor action (ACTIONS in app.js) or a tool; app.js
// runs it and asks for a PDF first when the job needs an open document.

import { el, icon } from './dom.js';

export const QUICK_TOOLS = [
  {
    title: 'Sắp xếp & tối ưu',
    items: [
      { label: 'Gộp PDF', desc: 'Ghép nhiều tệp thành một, đổi thứ tự tùy ý', icon: 'merge', hue: 'var(--green)', action: 'merge' },
      { label: 'Tách PDF', desc: 'Mỗi trang, mỗi N trang hoặc theo dãy trang', icon: 'split', hue: 'var(--green)', action: 'split' },
      { label: 'Nén PDF', desc: 'Giảm dung lượng, giữ nguyên chất lượng', icon: 'compress', hue: 'var(--green)', action: 'compress' },
      { label: 'Sắp xếp trang', desc: 'Kéo thả, xoay, xóa và chèn trang', icon: 'pages', hue: 'var(--green)', action: 'organizePages' },
      { label: 'Cắt lề trang', desc: 'Lề cố định hoặc tự động theo nội dung', icon: 'crop', hue: 'var(--green)', action: 'crop' },
      { label: 'Đánh số trang', desc: 'Chọn vị trí, mẫu, số bắt đầu, bỏ trang bìa', icon: 'hash', hue: 'var(--green)', action: 'pageNumbers' },
    ],
  },
  {
    title: 'Chuyển đổi',
    items: [
      { label: 'PDF sang Word', desc: 'Tệp .docx giữ đoạn văn và trang', icon: 'word', hue: 'var(--blue)', action: 'exportWord' },
      { label: 'PDF sang Excel', desc: 'Nhận diện bảng, cột và số', icon: 'excel', hue: 'var(--green)', action: 'exportExcel' },
      { label: 'PDF sang ảnh', desc: 'PNG hoặc JPG, 72 đến 300 DPI', icon: 'png', hue: 'var(--orange)', action: 'exportImagesDpi' },
      { label: 'Ảnh sang PDF', desc: 'Nhiều ảnh thành một tệp PDF', icon: 'image', hue: 'var(--orange)', action: 'imagesToPdf' },
      { label: 'Word sang PDF', desc: 'Giữ tiêu đề, danh sách, bảng tiếng Việt', icon: 'word', hue: 'var(--blue)', action: 'docxToPdf' },
      { label: 'Excel sang PDF', desc: 'Mọi sheet, tự xoay ngang bảng rộng', icon: 'excel', hue: 'var(--green)', action: 'excelToPdf' },
      { label: 'Nhận dạng chữ (OCR)', desc: 'Bản quét thành chữ tìm kiếm được', icon: 'scan', hue: 'var(--teal)', action: 'ocr' },
    ],
  },
  {
    title: 'Ký & bảo vệ',
    items: [
      { label: 'Ký tên', desc: 'Vẽ chữ ký rồi đặt lên trang', icon: 'signature', hue: 'var(--purple)', action: 'signature' },
      { label: 'Hình mờ', desc: 'Chữ chìm trên mọi trang', icon: 'watermark', hue: 'var(--pink)', action: 'watermark' },
      { label: 'Đặt mật khẩu', desc: 'Mã hóa AES-256, hạn chế in và sao chép', icon: 'lock', hue: 'var(--red)', action: 'protect' },
      { label: 'Gỡ mật khẩu', desc: 'Mở tệp có mật khẩu, lưu bản không khóa', icon: 'unlock', hue: 'var(--red)', action: 'unlock' },
      { label: 'Che thông tin', desc: 'Xóa hẳn nội dung dưới vùng che', icon: 'redact', hue: 'var(--red)', tool: 'redact' },
      { label: 'Xóa thông tin ẩn', desc: 'Metadata, JavaScript, tệp đính kèm', icon: 'sanitize', hue: 'var(--red)', action: 'sanitize' },
    ],
  },
];

// The cards, grouped by section. `onRun(card)` is called when one is chosen.
export function quickToolsGrid(onRun) {
  return el('div', { class: 'qt' }, QUICK_TOOLS.map((group) => el('section', { class: 'qt-group' },
    el('h2', { class: 'qt-title' }, group.title),
    el('div', { class: 'qt-grid' }, group.items.map((card) => el('button', { type: 'button', class: 'qt-card', style: `--hue:${card.hue}`, onclick: () => onRun(card) },
      el('span', { class: 'qt-ico' }, icon(card.icon, 20)),
      el('span', { class: 'qt-text' }, el('span', { class: 'qt-label' }, card.label), el('span', { class: 'qt-desc' }, card.desc)),
    ))),
  )));
}
