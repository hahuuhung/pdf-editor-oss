// Small DOM helpers shared by the editor: element builders, icons and modal dialogs.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Simple line icons drawn for this project (24x24, stroke = currentColor).
export const ICONS = {
  cursor: '<path d="M5 3l13 8-6 1.8L9.5 19z"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  note: '<path d="M4 4h16v12H9l-5 4z"/>',
  highlight: '<path d="M4 20h16M7 16l7.5-7.5 3 3L10 19H7z"/>',
  underline: '<path d="M7 4v7a5 5 0 0010 0V4M4 20h16"/>',
  strike: '<path d="M4 12h16M8 7.5h8M8 16.5h8"/>',
  squiggly: '<path d="M4 17c1.5-2.5 2.5 2.5 4 0s2.5 2.5 4 0 2.5 2.5 4 0 2 1.5 4-1"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  oval: '<ellipse cx="12" cy="12" rx="8.5" ry="6"/>',
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L19 5M10 5h9v9"/>',
  ink: '<path d="M4 18c2.5-6 4.5 3 7-2s3-2 9-7"/>',
  stamp: '<path d="M9 4h6v5l3 3H6l3-3zM5 15h14v3H5zM7 21h10"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  redact: '<rect x="3" y="8" width="18" height="8" rx="1" fill="currentColor"/>',
  signature: '<path d="M3 17c3-1 4-9 6-9s-1 9 2 9 3-5 5-5 1 4 3 4h2M3 21h18"/>',
  date: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
  open: '<path d="M3 7h6l2 2h10v10H3z"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-6h8v6"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5M8 11h6M11 8v6"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5M8 11h6"/>',
  fitWidth: '<path d="M3 7v10M21 7v10M3 12h18"/>',
  fitPage: '<rect x="6" y="3" width="12" height="18" rx="1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  prev: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  rotateLeft: '<path d="M4 4v5h5"/><path d="M4.5 9A8 8 0 1112 20"/>',
  rotateRight: '<path d="M20 4v5h-5"/><path d="M19.5 9A8 8 0 1012 20"/>',
  pageAdd: '<path d="M6 3h8l4 4v14H6z"/><path d="M12 10v6M9 13h6"/>',
  pageCopy: '<rect x="8" y="8" width="12" height="13" rx="1"/><path d="M16 8V4H4v13h4"/>',
  extract: '<path d="M6 3h8l4 4v14H6z"/><path d="M12 9v7M9 13l3 3 3-3"/>',
  merge: '<path d="M4 4h7v7H4zM13 13h7v7h-7zM11 7.5h3.5a2 2 0 012 2V13"/>',
  watermark: '<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/>',
  header: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M7 7h10M7 17h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  command: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10l3 2-3 2M12 14h5"/>',
  png: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15l3-4 3 3 2-2 3 3"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  form: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h4"/>',
  scan: '<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M8 10h8M8 14h5"/>',
  word: '<path d="M6 3h8l4 4v14H6z"/><path d="M8.5 11l1.2 5 1.8-4 1.8 4 1.2-5"/>',
  html: '<path d="M6 3h8l4 4v14H6z"/><path d="M10 12l-2 2 2 2M14 12l2 2-2 2"/>',
  images: '<rect x="7" y="7" width="14" height="12" rx="1"/><path d="M17 7V4H3v12h4M7 16l4-4 3 3 2-2 5 5"/>',
  compress: '<path d="M6 3h8l4 4v14H6z"/><path d="M12 8v3M10 13h4v4h-4z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  sanitize: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
  return span.firstElementChild;
}

// Builds an element. Props: class, text, value, checked, on<event> handlers, other attributes.
// Children may be nodes or strings; null, undefined and false are skipped.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function iconButton(name, title, onClick, { disabled = false, cls = '' } = {}) {
  return el('button', { class: `icon ${cls}`.trim(), title, 'aria-label': title, onclick: onClick, disabled }, icon(name));
}

// A labelled form row for dialogs.
export function field(label, input, hint) {
  return el('label', { class: 'dlg-field' }, el('span', { class: 'dlg-label' }, label), input, hint ? el('span', { class: 'dlg-hint' }, hint) : null);
}

export function isDialogOpen() {
  return !!document.querySelector('.dlg-overlay');
}

// Opens a modal dialog. Each action's `run` may return false (or a promise of false) to keep it open.
export function openDialog({ title, body, actions = [], width = 460, onClose }) {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const buttons = actions.map((a) =>
    el('button', {
      class: a.primary ? 'primary' : a.danger ? 'danger' : '',
      onclick: async () => {
        if ((await a.run?.()) !== false) close();
      },
    }, a.label),
  );
  const box = el('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: `width:min(${width}px, calc(100vw - 32px))` },
    el('div', { class: 'dlg-title' }, title),
    el('div', { class: 'dlg-body' }, body),
    buttons.length ? el('div', { class: 'dlg-actions' }, buttons) : null,
  );
  const overlay = el('div', { class: 'dlg-overlay', onpointerdown: (e) => e.target === overlay && close() }, box);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  (box.querySelector('[autofocus]') ?? box.querySelector('input, textarea, select') ?? buttons.at(-1))?.focus();
  return close;
}

export function confirmDialog(title, message, okLabel = 'Đồng ý') {
  return new Promise((resolve) => {
    let answer = false;
    openDialog({
      title,
      body: el('p', { class: 'dlg-text' }, message),
      actions: [
        { label: 'Hủy' },
        { label: okLabel, primary: true, run: () => { answer = true; } },
      ],
      onClose: () => resolve(answer),
    });
  });
}
