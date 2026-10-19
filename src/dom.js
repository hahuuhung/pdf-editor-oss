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
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  excel: '<path d="M6 3h8l4 4v14H6z"/><path d="M8.5 11l4 6M12.5 11l-4 6"/>',
  sync: '<path d="M21 12a9 9 0 00-9-9 9.75 9.75 0 00-6.74 2.74L3 8"/><path d="M3 3v5h5M3 12a9 9 0 009 9 9.75 9.75 0 006.74-2.74L21 16"/><path d="M16 16h5v5"/>',
  bolt: '<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z"/>',
  split: '<path d="M6 10V3h8l4 4v3M6 17v4h12v-4"/><path d="M3 13.5h18" stroke-dasharray="2.5 2.5"/>',
  crop: '<path d="M7 3v14h14M3 7h14v14"/>',
  hash: '<path d="M10 4L8 20M16 4l-2 16M5 9h15M4 15h15"/>',
  pages: '<rect x="3" y="4" width="8" height="11" rx="1"/><rect x="13" y="4" width="8" height="11" rx="1"/><path d="M3 19h18"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.6-1.7"/>',
  bookmark: '<path d="M6 3h12v18l-6-4.5L6 21z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 15v5h16v-5"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 013 0V12M11 11V4a1.5 1.5 0 013 0v7M14 11V5.5a1.5 1.5 0 013 0V14c0 4-2.5 7-6.5 7-2.5 0-4-1.2-5.5-3.5L3.2 14a1.5 1.5 0 012.5-1.6L8 15"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronUp: '<path d="M6 15l6-6 6 6"/>',
  pin: '<path d="M12 5v14M5 12h14"/>',
  ribbon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18"/>',
  ribbonSimple: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  panelLeft: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  panelRight: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  comments: '<path d="M4 4h16v12H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  swap: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
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

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Opens a modal dialog. Each action's `run` may return false (or a promise of false) to keep it open.
// Tab stays inside the dialog; closing it returns the focus to where it was. `icon` and `subtitle`
// are optional extras for the header.
export function openDialog({ title, subtitle, icon: iconName, body, actions = [], width = 460, onClose }) {
  let closed = false;
  const returnFocus = document.activeElement;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
    if (returnFocus?.isConnected && !isDialogOpen()) returnFocus.focus?.({ preventScroll: true });
  };
  const onKey = (e) => {
    if (overlay !== [...document.querySelectorAll('.dlg-overlay')].at(-1)) return; // a dialog above handles it
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      const items = [...box.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
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
  const titleId = `dlg-title-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const box = el('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, style: `width:min(${width}px, calc(100vw - 32px))` },
    el('div', { class: 'dlg-head' },
      iconName ? el('span', { class: 'dlg-icon' }, icon(iconName, 18)) : null,
      el('div', { class: 'dlg-heading' },
        el('div', { class: 'dlg-title', id: titleId }, title),
        subtitle ? el('div', { class: 'dlg-subtitle' }, subtitle) : null,
      ),
      el('button', { type: 'button', class: 'icon dlg-close', title: 'Đóng (Esc)', 'aria-label': 'Đóng', onclick: () => close() }, icon('cross', 16)),
    ),
    el('div', { class: 'dlg-body' }, body),
    buttons.length ? el('div', { class: 'dlg-actions' }, buttons) : null,
  );
  const overlay = el('div', { class: 'dlg-overlay', onpointerdown: (e) => e.target === overlay && close() }, box);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  (box.querySelector('[autofocus]') ?? box.querySelector('.dlg-body input, .dlg-body textarea, .dlg-body select') ?? buttons.at(-1) ?? box.querySelector('.dlg-close'))?.focus();
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
