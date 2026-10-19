// The editor shell around the page view: the title bar with the quick access toolbar (QAT), the
// ribbon (tabs, labelled groups, the "Tệp" backstage, KeyTips), the status bar, context menus and
// the side-panel layout (columns on wide screens, drawers on narrow ones).
//
// Layout data and the pure helpers live in ribbon.js. app.js owns every command and hands them over
// through `command(id)`, which returns { label, icon, key?, toggle?, on(), enabled(), run() }, or null
// for an id this build does not have (that button is simply left out).

import { el, icon, isDialogOpen } from './dom.js';
import {
  BACKSTAGE,
  KEYTIP_DIGITS,
  KEYTIP_LETTERS,
  QAT_CHOICES,
  QAT_LIMIT,
  RIBBON_TABS,
  assignKeyTips,
  columns,
  formatShortcut,
  isApplePlatform,
  itemCommand,
  itemLabel,
  parseJson,
  sanitizeQat,
  sanitizeRibbonMode,
  tabCommands,
  toggleQat,
  toggledRibbonMode,
} from './ribbon.js';

const QAT_KEY = 'pdfEditor.qat';
const MODE_KEY = 'pdfEditor.ribbon';
const PANELS_KEY = 'pdfEditor.panels';
const PHONE = '(max-width: 640px)';

function store(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    // Blocked storage: the choice lasts until the page is reloaded.
  }
}

function read(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

// ---------- context menus ----------

export function closeContextMenus() {
  document.querySelectorAll('.dropdown').forEach((d) => d.remove());
}

// A menu at (x, y) in viewport pixels. `items`: '-' or { label, icon, key, checked, disabled, run }.
export function openContextMenu(x, y, items) {
  closeContextMenus();
  const entries = items.filter(Boolean);
  if (!entries.length) return null;
  const menu = el('div', { class: 'dropdown rb-context', role: 'menu', onclick: (e) => e.stopPropagation(), onpointerdown: (e) => e.stopPropagation() });
  for (const item of entries) {
    if (item === '-') {
      if (menu.lastChild && !menu.lastChild.classList.contains('dd-sep')) menu.append(el('div', { class: 'dd-sep' }));
      continue;
    }
    menu.append(el('button', { type: 'button', role: 'menuitem', disabled: !!item.disabled, onclick: () => { closeContextMenus(); item.run(); } },
      el('span', { class: 'dd-check' }, item.checked ? '✓' : ''),
      icon(item.icon ?? 'info', 16),
      el('span', { class: 'grow' }, item.label),
      item.key ? el('span', { class: 'key' }, item.key) : null,
    ));
  }
  if (menu.lastChild?.classList.contains('dd-sep')) menu.lastChild.remove();
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  menu.style.top = `${y + r.height > innerHeight - 8 ? Math.max(8, y - r.height) : y}px`;
  menu.addEventListener('keydown', (e) => {
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
    const at = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      closeContextMenus();
    }
  });
  menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  return menu;
}

// Menus close on a press elsewhere, on scrolling, resizing and when the window loses focus.
window.addEventListener('pointerdown', (e) => !e.target.closest?.('.dropdown') && closeContextMenus());
for (const type of ['resize', 'blur']) window.addEventListener(type, closeContextMenus);
document.addEventListener('scroll', (e) => !e.target.closest?.('.dropdown') && closeContextMenus(), true);

// ---------- ribbon ----------

export function createRibbon({ titlebar, host, command, platform, storage, tab = 'home', onTab, accountArea, docInfo }) {
  const shortcut = (key) => formatShortcut(key, platform);
  const tooltip = (info) => (info.key ? `${info.label} (${shortcut(info.key)})` : info.label);
  const collapseKey = isApplePlatform(platform) ? '⌥⌘R' : 'Ctrl+F1';
  const tabs = RIBBON_TABS.filter((t) => t.backstage || tabCommands(t).some((id) => command(id)));

  let mode = sanitizeRibbonMode(read(storage, MODE_KEY));
  let expanded = mode === 'tabs' ? 'classic' : mode;
  let qat = sanitizeQat(parseJson(read(storage, QAT_KEY), null), (id) => !!command(id));
  let current = tabs.some((t) => t.id === tab && !t.backstage) ? tab : 'home';
  let flyout = false;
  let backstage = null;
  const phone = matchMedia(PHONE);

  // ----- buttons -----

  function runCommand(id) {
    const info = command(id);
    if (!info?.enabled()) return;
    closeKeyTips();
    closeBackstage();
    setFlyout(false);
    info.run();
    refresh();
  }

  function commandButton(id, kind, label) {
    const info = command(id);
    if (!info) return null;
    const b = el('button', { type: 'button', class: `rb-btn ${kind === 'qat' ? 'rb-qbtn' : `rb-${kind}`}`, 'data-cmd': id, title: tooltip(info), 'aria-label': info.label, onclick: () => runCommand(id) },
      icon(info.icon, kind === 'large' ? 24 : kind === 'qat' ? 17 : 16),
      kind === 'qat' ? null : el('span', { class: 'rb-label' }, label ?? itemLabel(id, info.label)),
    );
    if (info.toggle) b.setAttribute('aria-pressed', 'false');
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, buttonMenu(id));
    });
    return b;
  }

  function menuButton(id, cls) {
    const info = command(id);
    if (!info) return null;
    return el('button', { type: 'button', class: cls, 'data-cmd': id, title: tooltip(info), onclick: () => runCommand(id) },
      icon(info.icon, 18),
      el('span', { class: 'grow' }, itemLabel(id, info.label)),
      info.key ? el('span', { class: 'key' }, shortcut(info.key)) : null,
    );
  }

  // Disabled and on/off states of every command button on screen.
  function refresh() {
    for (const b of document.querySelectorAll('[data-cmd]')) {
      const info = command(b.dataset.cmd);
      if (!info) continue;
      b.disabled = !info.enabled();
      if (info.toggle) {
        const on = !!info.on();
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
    }
    const doc = docInfo?.();
    docName.textContent = doc?.name ?? '';
    docName.title = doc?.name ?? '';
  }

  // ----- quick access toolbar -----

  const qatEl = el('div', { class: 'rb-qat', role: 'toolbar', 'aria-label': 'Thanh truy cập nhanh' });

  function setQat(list) {
    qat = list;
    store(storage, QAT_KEY, JSON.stringify(qat));
    renderQat();
  }

  function renderQat() {
    qatEl.replaceChildren(
      ...qat.map((id) => commandButton(id, 'qat')).filter(Boolean),
      el('button', { type: 'button', class: 'rb-btn rb-qbtn rb-qat-more', title: 'Tùy chỉnh thanh truy cập nhanh', 'aria-label': 'Tùy chỉnh thanh truy cập nhanh', onclick: (e) => openQatMenu(e.currentTarget) }, icon('chevronDown', 14)),
    );
    refresh();
  }

  function openQatMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const known = QAT_CHOICES.filter((id) => command(id));
    openContextMenu(r.left, r.bottom + 4, [
      ...known.map((id) => ({ label: command(id).label, icon: command(id).icon, checked: qat.includes(id), disabled: !qat.includes(id) && qat.length >= QAT_LIMIT, run: () => setQat(toggleQat(qat, id)) })),
      '-',
      { label: 'Khôi phục mặc định', icon: 'refresh', run: () => setQat(sanitizeQat(null, (id) => !!command(id))) },
    ]);
  }

  function buttonMenu(id) {
    const pinned = qat.includes(id);
    return [
      { label: pinned ? 'Xóa khỏi thanh truy cập nhanh' : 'Thêm vào thanh truy cập nhanh', icon: pinned ? 'cross' : 'pin', disabled: !pinned && qat.length >= QAT_LIMIT, run: () => setQat(toggleQat(qat, id)) },
      '-',
      { label: mode === 'tabs' ? 'Luôn hiện ribbon' : 'Thu gọn ribbon', icon: mode === 'tabs' ? 'chevronDown' : 'chevronUp', key: collapseKey, run: toggleCollapsed },
    ];
  }

  // ----- title bar -----

  const docName = el('div', { class: 'rb-doc' });
  titlebar.replaceChildren(
    el('div', { class: 'rb-brand' }, el('span', { class: 'rb-logo', 'aria-hidden': 'true' }, icon('file', 15)), el('span', { class: 'rb-appname' }, 'PDF Editor')),
    qatEl,
    docName,
    el('button', { type: 'button', class: 'rb-search', title: `Tìm công cụ và lệnh (${shortcut('Ctrl+K')})`, 'aria-label': 'Tìm công cụ và lệnh', onclick: () => runCommand('palette') },
      icon('search', 15), el('span', { class: 'rb-search-text' }, 'Tìm lệnh…'), el('kbd', {}, shortcut('Ctrl+K'))),
    accountArea,
  );

  // ----- tabs and body -----

  const tabRow = el('div', { class: 'rb-tabs', role: 'tablist', 'aria-label': 'Ribbon' });
  const body = el('div', { class: 'rb-body', role: 'tabpanel' });
  const scroller = el('div', { class: 'rb-scroll' });
  const scrollLeft = el('button', { type: 'button', class: 'rb-scroll-btn left', 'aria-label': 'Cuộn ribbon sang trái', tabindex: '-1', onclick: () => scroller.scrollBy({ left: -240, behavior: 'smooth' }) }, icon('prev', 16));
  const scrollRight = el('button', { type: 'button', class: 'rb-scroll-btn right', 'aria-label': 'Cuộn ribbon sang phải', tabindex: '-1', onclick: () => scroller.scrollBy({ left: 240, behavior: 'smooth' }) }, icon('next', 16));
  body.append(scrollLeft, scroller, scrollRight);
  const displayButton = el('button', { type: 'button', class: 'rb-display', title: 'Kiểu hiển thị ribbon', 'aria-label': 'Kiểu hiển thị ribbon', onclick: (e) => openDisplayMenu(e.currentTarget) }, icon('chevronUp', 16));
  host.replaceChildren(tabRow, body);

  function tabButton(t) {
    const on = !t.backstage && t.id === current;
    const b = el('button', {
      type: 'button',
      class: `rb-tab${t.backstage ? ' rb-file' : ''}${on ? ' on' : ''}`,
      id: `rb-tab-${t.id}`,
      role: 'tab',
      'aria-selected': String(on),
      'aria-controls': t.backstage ? null : 'rb-panel',
      tabindex: on ? '0' : '-1',
      style: t.hue ? `--hue:${t.hue}` : null,
      'data-tab': t.id,
      onclick: () => (t.backstage ? openBackstage() : clickTab(t.id)),
      ondblclick: () => !t.backstage && toggleCollapsed(),
    }, t.label);
    b.addEventListener('keydown', (e) => {
      const buttons = [...tabRow.querySelectorAll('.rb-tab')];
      const at = buttons.indexOf(b);
      const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: buttons.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      buttons[(to + buttons.length) % buttons.length].focus();
    });
    return b;
  }

  function group(g) {
    const make = (kind) => (item) => commandButton(itemCommand(item), kind, typeof item === 'string' ? undefined : item.label);
    const large = (g.large ?? []).map(make('large')).filter(Boolean);
    const small = (g.small ?? []).map(make('small')).filter(Boolean);
    if (!large.length && !small.length) return null;
    return el('div', { class: 'rb-group', role: 'group', 'aria-label': g.label },
      el('div', { class: 'rb-items' }, large, columns(small).map((col) => el('div', { class: 'rb-col' }, col))),
      el('div', { class: 'rb-glabel' }, g.label),
    );
  }

  function render() {
    host.dataset.mode = mode;
    host.dataset.layout = phone.matches || mode === 'simple' ? 'simple' : 'classic';
    host.classList.toggle('rb-flyout', mode === 'tabs' && flyout);
    tabRow.replaceChildren(...tabs.map(tabButton), el('span', { class: 'rb-grow' }), displayButton);
    displayButton.replaceChildren(icon(mode === 'tabs' ? 'chevronDown' : 'chevronUp', 16));
    const t = tabs.find((x) => x.id === current);
    body.id = 'rb-panel';
    body.setAttribute('aria-labelledby', `rb-tab-${t.id}`);
    scroller.replaceChildren(...t.groups.map(group).filter(Boolean));
    scroller.scrollLeft = 0;
    refresh();
    updateScrollButtons();
  }

  function updateScrollButtons() {
    const max = scroller.scrollWidth - scroller.clientWidth;
    scrollLeft.hidden = scroller.scrollLeft <= 2;
    scrollRight.hidden = scroller.scrollLeft >= max - 2;
  }
  scroller.addEventListener('scroll', updateScrollButtons, { passive: true });
  new ResizeObserver(updateScrollButtons).observe(scroller);
  // A vertical mouse wheel scrolls an overflowing ribbon sideways.
  scroller.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || scroller.scrollWidth <= scroller.clientWidth) return;
    e.preventDefault();
    scroller.scrollLeft += e.deltaY;
  }, { passive: false });

  function clickTab(id) {
    if (mode === 'tabs') {
      if (flyout && id === current) return setFlyout(false);
      selectTab(id, true);
      return setFlyout(true);
    }
    selectTab(id, true);
  }

  // Shows tab `id`. `notify` tells app.js (a tab picked by the user, not one app.js asked for).
  function selectTab(id, notify = false) {
    if (!tabs.some((t) => t.id === id && !t.backstage)) return;
    const changed = id !== current;
    current = id;
    if (changed) render();
    if (notify) onTab?.(id);
  }

  function setFlyout(on) {
    if (flyout === on) return;
    flyout = on && mode === 'tabs';
    host.classList.toggle('rb-flyout', flyout);
    updateScrollButtons();
  }
  document.addEventListener('pointerdown', (e) => {
    if (flyout && !host.contains(e.target) && !e.target.closest?.('.dropdown')) setFlyout(false);
  });

  function setMode(next) {
    mode = sanitizeRibbonMode(next);
    if (mode !== 'tabs') expanded = mode;
    flyout = false;
    store(storage, MODE_KEY, mode);
    render();
  }

  function toggleCollapsed() {
    setMode(toggledRibbonMode(mode, expanded));
  }

  function openDisplayMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    openContextMenu(r.right - 240, r.bottom + 4, [
      { label: 'Ribbon đầy đủ', icon: 'ribbon', checked: mode === 'classic', run: () => setMode('classic') },
      { label: 'Ribbon gọn (một hàng)', icon: 'ribbonSimple', checked: mode === 'simple', run: () => setMode('simple') },
      { label: 'Chỉ hiện tab', icon: 'chevronUp', key: collapseKey, checked: mode === 'tabs', run: () => setMode('tabs') },
    ]);
  }

  phone.addEventListener('change', render);

  // ----- backstage (tab "Tệp") -----

  function openBackstage() {
    closeKeyTips();
    setFlyout(false);
    if (backstage) return;
    const doc = docInfo?.();
    const section = (s) => {
      const ids = s.items.filter((id) => command(id) && (!s.hideDisabled || command(id).enabled()));
      if (!ids.length) return null;
      return el('section', { class: 'rb-bs-section' }, el('h3', {}, s.label), el('div', { class: 'rb-bs-cards' }, ids.map((id) => menuButton(id, 'rb-card'))));
    };
    backstage = el('div', { class: 'rb-backstage', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tệp' },
      el('nav', { class: 'rb-bs-nav' },
        el('button', { type: 'button', class: 'rb-bs-back', onclick: closeBackstage }, icon('prev', 18), el('span', { class: 'grow' }, 'Quay lại'), el('span', { class: 'key' }, 'Esc')),
        BACKSTAGE.nav.map((id) => (id === '-' ? el('div', { class: 'rb-bs-sep' }) : menuButton(id, 'rb-bs-item'))),
      ),
      el('div', { class: 'rb-bs-main' },
        el('section', { class: 'rb-bs-section' },
          el('h3', {}, 'Tài liệu hiện tại'),
          el('div', { class: 'rb-doc-card' },
            icon('file', 28),
            el('div', {},
              el('div', { class: 'rb-doc-name' }, doc?.name ?? 'Chưa mở tài liệu'),
              el('div', { class: 'rb-doc-meta' }, doc ? doc.meta : 'Mở một tệp PDF, kéo thả tệp vào cửa sổ, hoặc tạo tài liệu mới.'),
            ),
          ),
        ),
        BACKSTAGE.sections.map(section),
      ),
    );
    document.body.append(backstage);
    refresh();
    backstage.querySelector('.rb-bs-back').focus();
  }

  function closeBackstage() {
    if (!backstage) return;
    backstage.remove();
    backstage = null;
    tabRow.querySelector('.rb-file')?.focus({ preventScroll: true });
  }

  // ----- KeyTips: press and release Alt, then a letter -----

  let altArmed = false;
  let keytips = null; // { map: Map<key, run>, level: 'top' | 'tab' }

  function closeKeyTips() {
    keytips = null;
    document.querySelectorAll('.rb-keytip').forEach((n) => n.remove());
  }

  function showKeyTips(entries, level) {
    closeKeyTips();
    keytips = { map: new Map(), level };
    for (const { key, node, run } of entries) {
      if (!key || !node || node.disabled || !node.getClientRects().length) continue;
      keytips.map.set(key, run);
      const r = node.getBoundingClientRect();
      document.body.append(el('span', { class: 'rb-keytip', style: `left:${r.left + r.width / 2}px;top:${r.bottom - 6}px` }, key));
    }
  }

  function showTopKeyTips() {
    const qatButtons = [...qatEl.querySelectorAll('[data-cmd]')];
    const tabButtons = [...tabRow.querySelectorAll('.rb-tab')];
    const keys = assignKeyTips(tabButtons.map((b) => b.textContent), { alphabet: KEYTIP_LETTERS });
    showKeyTips([
      ...qatButtons.slice(0, 9).map((node, i) => ({ key: KEYTIP_DIGITS[i], node, run: () => runCommand(node.dataset.cmd) })),
      ...tabButtons.map((node, i) => ({
        key: keys[i],
        node,
        run: () => {
          if (node.classList.contains('rb-file')) return openBackstage();
          selectTab(node.dataset.tab, true);
          if (mode === 'tabs') setFlyout(true);
          showTabKeyTips();
        },
      })),
    ], 'top');
  }

  function showTabKeyTips() {
    const buttons = [...scroller.querySelectorAll('[data-cmd]')];
    const keys = assignKeyTips(buttons.map((b) => b.querySelector('.rb-label')?.textContent ?? ''));
    showKeyTips(buttons.map((node, i) => ({ key: keys[i], node, run: () => runCommand(node.dataset.cmd) })), 'tab');
  }

  const typing = (t) => t?.closest?.('[contenteditable="true"], textarea, input, select');

  window.addEventListener('keydown', (e) => {
    if (isDialogOpen()) return;
    const collapse = (e.ctrlKey && !e.altKey && e.key === 'F1') || (e.metaKey && e.altKey && e.code === 'KeyR');
    if (collapse) {
      e.preventDefault();
      e.stopPropagation();
      return toggleCollapsed();
    }
    if (e.key === 'Alt') {
      altArmed = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat && !typing(e.target);
      if (altArmed) e.preventDefault();
      return;
    }
    altArmed = false;
    if (keytips) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return keytips.level === 'tab' ? showTopKeyTips() : closeKeyTips();
      const run = keytips.map.get(e.key.length === 1 ? e.key.toUpperCase() : '');
      if (run) run();
      else closeKeyTips();
      return;
    }
    if (e.key === 'Escape' && (backstage || flyout)) {
      e.preventDefault();
      e.stopPropagation();
      if (backstage) closeBackstage();
      else setFlyout(false);
    }
  }, true);

  window.addEventListener('keyup', (e) => {
    if (e.key !== 'Alt' || !altArmed) return;
    altArmed = false;
    e.preventDefault(); // keeps Chrome/Edge/Firefox on Windows from moving focus to the browser menu
    if (keytips) closeKeyTips();
    else if (!backstage && !isDialogOpen()) showTopKeyTips();
  }, true);

  for (const type of ['pointerdown', 'blur', 'resize']) {
    window.addEventListener(type, () => {
      altArmed = false;
      closeKeyTips();
    });
  }

  renderQat();
  render();

  return {
    refresh,
    selectTab,
    setMode,
    toggleCollapsed,
    openBackstage,
    get mode() {
      return mode;
    },
    get tab() {
      return current;
    },
  };
}

// ---------- status bar ----------

// Page navigation and zoom at the right of the status bar, like an office suite. `#page-field`,
// `#pageinfo` ("/ 12") and `#zoominfo` ("100%") are updated by app.js.
export function createStatusBar({ host, status, command, platform, zoomSteps, onPage, onZoom, onToggle }) {
  const tooltip = (id) => {
    const info = command(id);
    return info?.key ? `${info.label} (${formatShortcut(info.key, platform)})` : info?.label ?? '';
  };
  const cmd = (id, name) => el('button', { type: 'button', class: 'icon', 'data-cmd': id, title: tooltip(id), 'aria-label': command(id)?.label, onclick: () => command(id)?.enabled() && command(id).run() }, icon(name, 16));
  const zoomLabel = el('span', { id: 'zoominfo' });
  const zoomButton = el('button', { type: 'button', class: 'rb-zoom', title: 'Chọn mức thu phóng', 'aria-label': 'Chọn mức thu phóng', 'aria-haspopup': 'menu' }, zoomLabel, icon('chevronDown', 12));
  zoomButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = zoomButton.getBoundingClientRect();
    // Opened from the bottom edge, the menu flips above the button.
    openContextMenu(r.left, r.top - 4, [
      ...zoomSteps.map((z) => ({ label: `${Math.round(z * 100)}%`, icon: 'zoomIn', run: () => onZoom(z) })),
      '-',
      ...['fitPage', 'fitWidth'].map((id) => command(id) && { label: command(id).label, icon: command(id).icon, key: formatShortcut(command(id).key, platform), run: () => command(id).run() }),
    ]);
  });
  const field = el('input', { type: 'number', min: 1, id: 'page-field', 'aria-label': 'Số trang', inputmode: 'numeric', onchange: (e) => onPage(Number(e.target.value) - 1) });
  host.replaceChildren(
    el('button', { type: 'button', class: 'icon rb-side-toggle', 'data-cmd': 'toggleThumbs', title: 'Hiện/ẩn ảnh thu nhỏ', 'aria-label': 'Hiện/ẩn ảnh thu nhỏ', onclick: () => onToggle('left') }, icon('panelLeft', 16)),
    status,
    el('div', { class: 'rb-pagenav', role: 'group', 'aria-label': 'Chuyển trang' },
      el('button', { type: 'button', class: 'icon', title: 'Trang trước', 'aria-label': 'Trang trước', onclick: () => onPage('prev') }, icon('prev', 16)),
      field,
      el('span', { id: 'pageinfo', class: 'rb-pagecount' }),
      el('button', { type: 'button', class: 'icon', title: 'Trang sau', 'aria-label': 'Trang sau', onclick: () => onPage('next') }, icon('next', 16)),
    ),
    el('div', { class: 'rb-zoomgroup', role: 'group', 'aria-label': 'Thu phóng' },
      cmd('zoomOut', 'zoomOut'), zoomButton, cmd('zoomIn', 'zoomIn'),
      el('span', { class: 'rb-sb-sep' }),
      cmd('fitWidth', 'fitWidth'), cmd('fitPage', 'fitPage'),
    ),
    el('button', { type: 'button', class: 'icon rb-side-toggle', 'data-cmd': 'toggleSidebar', title: 'Hiện/ẩn bảng bên', 'aria-label': 'Hiện/ẩn bảng bên', onclick: () => onToggle('right') }, icon('panelRight', 16)),
  );
}

// ---------- side panels ----------

// The thumbnails (left) and the comments/search/forms panel (right) are columns that the user can
// hide on wide screens, and drawers over the page on narrow ones (left ≤ 900px, right ≤ 640px).
export function createPanelLayout({ storage, left, onChange }) {
  const narrow = { left: matchMedia('(max-width: 900px)'), right: matchMedia(PHONE) };
  const saved = parseJson(read(storage, PANELS_KEY), {});
  const hidden = { left: saved?.left === true, right: saved?.right === true };
  let drawer = null;
  const backdrop = el('div', { class: 'rb-backdrop', hidden: true, onclick: () => close() });
  document.body.append(backdrop);

  function apply() {
    const b = document.body.classList;
    b.toggle('rb-hide-left', hidden.left);
    b.toggle('rb-hide-right', hidden.right);
    b.toggle('rb-drawer-left', drawer === 'left');
    b.toggle('rb-drawer-right', drawer === 'right');
    backdrop.hidden = !drawer;
    onChange?.();
  }

  const isShown = (side) => (narrow[side].matches ? drawer === side : !hidden[side]);

  function setShown(side, on) {
    if (narrow[side].matches) drawer = on ? side : drawer === side ? null : drawer;
    else {
      hidden[side] = !on;
      store(storage, PANELS_KEY, JSON.stringify(hidden));
    }
    apply();
  }

  function close() {
    if (!drawer) return false;
    drawer = null;
    apply();
    return true;
  }

  for (const q of Object.values(narrow)) q.addEventListener('change', () => { drawer = null; apply(); });
  // Picking a page in the thumbnail drawer goes to it, so the drawer gets out of the way.
  left.addEventListener('click', (e) => {
    if (drawer === 'left' && e.target.closest('.thumb') && !e.target.closest('button')) close();
  });
  apply();

  return {
    isShown,
    show: (side) => setShown(side, true),
    toggle: (side) => setShown(side, !isShown(side)),
    close,
  };
}
