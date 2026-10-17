// <pdf-thumbnail-sidebar>: page thumbnails with selection, drag-and-drop reordering and quick page
// actions.
//
// The element renders from store events and asks for every change with an intent, so it never
// touches the document itself:
//   listens to   pdf:loaded, state:pages-updated, state:page-changed
//   dispatches   page:select { index }, page:reorder { order }, page:rotate { pages, delta },
//                page:delete { pages }
// Click selects a page, Ctrl/⌘ adds or removes one, Shift selects a range. Dragging moves the whole
// selection; a line with a dot at each end shows where it will land.
//
// Pictures are painted only for cards near the visible part of the list (IntersectionObserver).
// After pages are moved, inserted or deleted the existing cards are kept and moved, so only new or
// changed pages are painted again.

import { el, icon } from '../dom.js';
import { isIdentityOrder, moveSelectionOrder } from '../pages.js';
import { clickSelection, dropGap, followOrder } from '../pageselect.js';
import { EVENTS } from '../store.js';

const PAINT_WIDTH = 150; // CSS pixels a thumbnail is painted for
const PAGE_DRAG = 'application/x-pdf-editor-pages'; // drag data type of page cards
const EDGE_SCROLL = 36; // pixels from the list's top or bottom edge that scroll it while dragging

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

async function paintThumbnail(doc, index) {
  const page = await doc.getPage(index + 1);
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const viewport = page.getViewport({ scale: (PAINT_WIDTH * dpr) / page.getViewport({ scale: 1 }).width });
  const canvas = el('canvas', { width: Math.round(viewport.width), height: Math.round(viewport.height) });
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

export class PdfThumbnailSidebar extends HTMLElement {
  #store = null;
  #unsubscribe = [];
  #wired = false;
  #doc = null;
  #cards = [];
  #current = 0;
  #selection = [];
  #anchor = null;
  #dirty = new Set(); // cards whose picture must be painted
  #near = new Set(); // cards in or close to the visible part of the list
  #painting = false;
  #generation = 0; // changes with every document update, so stale pictures are dropped
  #observer = null;
  #indicator = el('div', { class: 'drop-indicator', hidden: true, 'aria-hidden': 'true' });
  #drag = null; // { pages, order }

  connectedCallback() {
    this.setAttribute('role', 'listbox');
    this.setAttribute('aria-label', 'Các trang');
    this.setAttribute('aria-multiselectable', 'true');
    if (!this.#indicator.isConnected) this.prepend(this.#indicator);
    this.#observer = new IntersectionObserver((entries) => this.#onIntersect(entries), { root: this, rootMargin: '400px 0px' });
    for (const card of this.#cards) this.#observer.observe(card);
    if (this.#wired) return;
    this.#wired = true;
    this.addEventListener('click', (e) => this.#onClick(e));
    this.addEventListener('keydown', (e) => this.#onKeyDown(e));
    this.addEventListener('dragstart', (e) => this.#onDragStart(e));
    this.addEventListener('dragover', (e) => this.#onDragOver(e));
    this.addEventListener('dragleave', (e) => this.#onDragLeave(e));
    this.addEventListener('drop', (e) => this.#onDrop(e));
    this.addEventListener('dragend', () => this.#endDrag());
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#near.clear();
  }

  // The store to render from and to send intents to; set once by app.js.
  set store(store) {
    this.#unsubscribe.forEach((off) => off());
    this.#store = store;
    this.#unsubscribe = [
      store.on(EVENTS.loaded, () => this.#clear()),
      store.on(EVENTS.pagesUpdated, (detail) => this.#update(detail)),
      store.on(EVENTS.pageChanged, ({ index }) => this.#setCurrent(index)),
    ];
  }

  // Selected pages, in document order; never empty while a document is open.
  get selection() {
    return this.#selection.length ? [...this.#selection] : this.#cards.length ? [this.#current] : [];
  }

  // ---------- rendering ----------

  // A different document was opened: no card can be reused.
  #clear() {
    for (const card of this.#cards) {
      this.#observer?.unobserve(card);
      card.remove();
    }
    this.#cards = [];
    this.#dirty.clear();
    this.#near.clear();
    this.#selection = [];
    this.#anchor = null;
    this.scrollTop = 0;
  }

  #update({ doc, pageSizes, current = 0, order = null, changed = [] }) {
    this.#doc = doc;
    if (!doc || !pageSizes.length) {
      this.#generation++;
      this.#clear(); // the document was closed
      return;
    }
    this.#generation++;
    const old = this.#cards;
    const reuse = Array.isArray(order) && order.length === pageSizes.length && order.every((o) => o === -1 || (Number.isInteger(o) && o >= 0 && o < old.length));
    const before = reuse && !reducedMotion() ? new Map(old.map((card) => [card, card.getBoundingClientRect().top])) : null;
    const focused = old.includes(document.activeElement) ? document.activeElement : null;
    // Without an order the cards stay where they are and are all painted again.
    const cards = pageSizes.map((_, i) => (reuse ? old[order[i]] : old[i]) ?? this.#createCard());
    const kept = new Set(cards);
    for (const card of old) {
      if (kept.has(card)) continue;
      this.#observer?.unobserve(card);
      this.#dirty.delete(card);
      this.#near.delete(card);
      card.remove();
    }
    const fresh = cards.filter((card) => !old.includes(card));
    this.#cards = cards;
    this.#current = Math.min(Math.max(0, current), cards.length - 1);
    this.#selection = reuse ? followOrder(this.#selection, order) : [];
    if (!this.#selection.includes(this.#current)) this.#selection = [this.#current];
    this.append(...cards);
    cards.forEach((card, i) => {
      this.#bind(card, i, pageSizes[i]);
      if (!reuse || order[i] === -1 || changed.includes(i)) this.#dirty.add(card);
    });
    for (const card of fresh) this.#observer?.observe(card);
    if (focused?.isConnected) focused.focus({ preventScroll: true });
    if (before) this.#animate(before);
    this.#paintNext();
  }

  #createCard() {
    const tool = (action, name, label) =>
      el('button', { type: 'button', class: 'icon', 'data-action': action, title: label, 'aria-label': label, tabindex: '-1', draggable: 'false' }, icon(name, 14));
    return el('div', { class: 'thumb', role: 'option', draggable: 'true', tabindex: '-1' },
      el('div', { class: 'thumb-frame' },
        el('span', { class: 'thumb-count', 'aria-hidden': 'true' }),
        el('div', { class: 'thumb-tools' },
          tool('rotate-left', 'rotateLeft', 'Xoay trái 90°'),
          tool('rotate-right', 'rotateRight', 'Xoay phải 90°'),
          tool('delete', 'trash', 'Xóa trang'),
        ),
      ),
      el('span', { class: 'thumb-num' }),
    );
  }

  #bind(card, index, size) {
    const label = `Trang ${index + 1}`;
    card.dataset.page = index;
    card.title = label;
    card.setAttribute('aria-label', label);
    card.querySelector('.thumb-num').textContent = index + 1;
    card.querySelector('.thumb-frame').style.aspectRatio = `${size.width} / ${size.height}`;
    this.#paintState(card, index);
  }

  #paintState(card, index) {
    const on = index === this.#current;
    const selected = this.#selection.includes(index);
    card.classList.toggle('on', on);
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-selected', String(selected));
    card.tabIndex = on ? 0 : -1;
  }

  #refreshStates() {
    this.#cards.forEach((card, i) => this.#paintState(card, i));
  }

  // Slides moved cards from their old place; new cards fade in.
  #animate(before) {
    for (const card of this.#cards) {
      const top = before.get(card);
      if (top === undefined) {
        card.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
        continue;
      }
      const dy = top - card.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) card.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
  }

  #onIntersect(entries) {
    for (const entry of entries) {
      if (entry.isIntersecting) this.#near.add(entry.target);
      else this.#near.delete(entry.target);
    }
    this.#paintNext();
  }

  // Paints dirty cards near the visible area one at a time, in page order.
  async #paintNext() {
    if (this.#painting) return;
    this.#painting = true;
    try {
      for (;;) {
        const card = this.#cards.find((c) => this.#dirty.has(c) && this.#near.has(c));
        if (!card || !this.#doc) break;
        this.#dirty.delete(card);
        const generation = this.#generation;
        let canvas = null;
        try {
          canvas = await paintThumbnail(this.#doc, this.#cards.indexOf(card));
        } catch (err) {
          if (generation === this.#generation) console.warn('Không vẽ được hình thu nhỏ', err);
        }
        if (!this.#cards.includes(card)) continue;
        if (generation !== this.#generation) {
          this.#dirty.add(card); // the document changed meanwhile: paint again from the new one
          continue;
        }
        if (!canvas) continue;
        const frame = card.querySelector('.thumb-frame');
        frame.querySelector('canvas')?.remove();
        frame.prepend(canvas);
      }
    } finally {
      this.#painting = false;
    }
  }

  // ---------- selection and navigation ----------

  #setCurrent(index) {
    if (!this.#cards.length) return;
    this.#current = index;
    if (!this.#selection.includes(index)) {
      this.#selection = [index];
      this.#anchor = index;
    }
    this.#refreshStates();
    this.#cards[index]?.scrollIntoView({ block: 'nearest' });
  }

  #select(index, modifiers = {}) {
    const next = clickSelection(this.#selection, index, this.#anchor, modifiers);
    this.#selection = next.selection;
    this.#anchor = next.anchor;
    this.#refreshStates();
    // Ctrl-clicking a page out of the selection leaves the view where it is.
    if (this.#selection.includes(index)) this.#store.dispatch('page:select', { index });
  }

  // Pages an action on `card` applies to: the whole selection when the card is part of it.
  #pagesFor(card) {
    const index = this.#cards.indexOf(card);
    return this.#selection.includes(index) ? this.selection : [index];
  }

  #cardOf(target) {
    const card = target?.closest?.('.thumb');
    return card && this.#cards.includes(card) ? card : null;
  }

  #onClick(e) {
    const card = this.#cardOf(e.target);
    if (!card) return;
    const action = e.target.closest('button[data-action]')?.dataset.action;
    if (action === 'rotate-left' || action === 'rotate-right') {
      this.#store.dispatch('page:rotate', { pages: this.#pagesFor(card), delta: action === 'rotate-left' ? -90 : 90 });
    } else if (action === 'delete') {
      this.#store.dispatch('page:delete', { pages: this.#pagesFor(card) });
    } else {
      this.#select(this.#cards.indexOf(card), { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey });
    }
  }

  #onKeyDown(e) {
    const card = this.#cardOf(e.target);
    if (!card || e.target !== card) return;
    const index = this.#cards.indexOf(card);
    const last = this.#cards.length - 1;
    const mod = e.ctrlKey || e.metaKey;
    const moveFocus = (to) => {
      this.#select(to, { range: e.shiftKey });
      this.#cards[to]?.focus();
    };
    let handled = true;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      this.#moveSelectionBy(e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.altKey) {
      handled = false;
    } else if (mod && e.key.toLowerCase() === 'a') {
      this.#selection = this.#cards.map((_, i) => i);
      this.#refreshStates();
    } else if (mod) {
      handled = false;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      moveFocus(Math.max(0, index - 1));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      moveFocus(Math.min(last, index + 1));
    } else if (e.key === 'Home') {
      moveFocus(0);
    } else if (e.key === 'End') {
      moveFocus(last);
    } else if (e.key === 'Enter' || e.key === ' ') {
      this.#select(index);
    } else if (e.key === 'Delete') {
      this.#store.dispatch('page:delete', { pages: this.#pagesFor(card) });
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation(); // keeps the editor's own shortcuts (Delete, arrows) off the page items
    }
  }

  // Alt+↑/↓: moves the selected pages one place up or down.
  #moveSelectionBy(step) {
    const pages = this.selection;
    const first = pages[0];
    const lastPage = pages[pages.length - 1];
    if ((step < 0 && first === 0) || (step > 0 && lastPage === this.#cards.length - 1)) return;
    const order = moveSelectionOrder(this.#cards.length, pages, step < 0 ? first - 1 : lastPage + 2);
    if (!isIdentityOrder(order)) this.#store.dispatch('page:reorder', { order });
  }

  // ---------- drag and drop ----------

  #isPageDrag(e) {
    return !!this.#drag && !!e.dataTransfer?.types.includes(PAGE_DRAG);
  }

  #onDragStart(e) {
    const card = this.#cardOf(e.target);
    if (!card || e.target !== card) return;
    const index = this.#cards.indexOf(card);
    if (!this.#selection.includes(index)) {
      this.#selection = [index];
      this.#anchor = index;
      this.#refreshStates();
    }
    const pages = this.selection;
    this.#drag = { pages, order: null };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(PAGE_DRAG, pages.join(','));
    // The drag picture is the card's page, with the number of pages when several are dragged.
    const frame = card.querySelector('.thumb-frame');
    frame.querySelector('.thumb-count').textContent = pages.length > 1 ? `${pages.length} trang` : '';
    card.classList.add('drag-source');
    const r = frame.getBoundingClientRect();
    e.dataTransfer.setDragImage(frame, Math.min(e.clientX - r.left, r.width), Math.min(e.clientY - r.top, r.height));
    const drag = this.#drag;
    requestAnimationFrame(() => {
      card.classList.remove('drag-source');
      if (this.#drag !== drag) return; // the drag already ended
      for (const i of pages) this.#cards[i]?.classList.add('dragging');
    });
  }

  #onDragOver(e) {
    if (!this.#isPageDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const box = this.getBoundingClientRect();
    if (e.clientY < box.top + EDGE_SCROLL) this.scrollTop -= 14;
    else if (e.clientY > box.bottom - EDGE_SCROLL) this.scrollTop += 14;
    const gap = dropGap(this.#cards.map((c) => {
      const r = c.getBoundingClientRect();
      return r.top + r.height / 2;
    }), e.clientY);
    const order = moveSelectionOrder(this.#cards.length, this.#drag.pages, gap);
    this.#drag.order = isIdentityOrder(order) ? null : order;
    this.#showIndicator(this.#drag.order ? gap : -1);
  }

  #onDragLeave(e) {
    if (!this.#drag) return;
    const r = this.getBoundingClientRect();
    if (e.clientX <= r.left || e.clientX >= r.right || e.clientY <= r.top || e.clientY >= r.bottom) this.#showIndicator(-1);
  }

  #onDrop(e) {
    if (!this.#isPageDrag(e)) return;
    e.preventDefault();
    e.stopPropagation(); // not a file drop for the editor
    const order = this.#drag.order;
    this.#endDrag();
    if (order) this.#store.dispatch('page:reorder', { order });
  }

  #endDrag() {
    this.#drag = null;
    this.#showIndicator(-1);
    for (const card of this.#cards) card.classList.remove('dragging', 'drag-source');
  }

  // Shows the drop line in the gap before card `gap` (after the last card when gap = count).
  #showIndicator(gap) {
    if (gap < 0 || !this.#cards.length) {
      this.#indicator.hidden = true;
      return;
    }
    const above = this.#cards[gap - 1];
    const below = this.#cards[gap];
    const bottomOf = (c) => c.offsetTop + c.offsetHeight;
    const y = above && below ? (bottomOf(above) + below.offsetTop) / 2 : below ? below.offsetTop - 4 : bottomOf(above) + 4;
    this.#indicator.style.top = `${y}px`;
    this.#indicator.hidden = false;
  }
}

customElements.define('pdf-thumbnail-sidebar', PdfThumbnailSidebar);
