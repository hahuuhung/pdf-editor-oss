// <pdf-canvas-view>: the scrolling page area.
//
// app.js builds the pages (div.page with their overlays) inside this element and owns every
// pointer tool. The view adds what belongs to the viewport itself:
// - lazy painting: a page's canvas is painted only near the visible area and released when it
//   scrolls far away, with a pixel cap per canvas, so long documents and high zoom stay in memory;
// - hand panning: Space+drag, middle-button drag, the hand tool, or one finger on a page;
// - zoom gestures: Ctrl/⌘+wheel (also touchpad pinch) and two-finger pinch, previewed with a CSS
//   transform and committed once through the intent view:zoom { zoom, anchor }, which keeps the
//   point under the pointer in place;
// - snap guides drawn while app.js drags an item.
// It emits canvas:pan { active } while panning or pinching.

import { el } from '../dom.js';
import { EVENTS } from '../store.js';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const MAX_CANVAS_PIXELS = 16_000_000; // about 64 MB per page canvas; sharper than that is not painted
const WHEEL_COMMIT_MS = 160; // wheel zoom is committed after this pause

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Targets that keep their own Space key: typing fields, buttons, links and list items.
const KEEPS_SPACE = 'input, textarea, select, button, a[href], [contenteditable="true"], [role="option"], [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"]';

export class PdfCanvasView extends HTMLElement {
  #store = null;
  #wired = false;
  #doc = null;
  #zoom = 1;
  #tool = 'select';
  #generation = 0;
  #near = new Set(); // pages in or close to the visible area
  #painted = new Set(); // pages painted for the current layout
  #painting = false;
  #task = null; // pdf.js render task in progress
  #nearObserver = null;
  #keepObserver = null;
  #spaceHeld = false;
  #pan = null; // { id, x, y, left, top, space }
  #touches = new Map(); // touch pointers on the view: id -> { x, y }
  #pinch = null; // { d0, cx0, cy0, cx, cy, scale, anchor }
  #wheel = null; // { scale, anchor, cx, cy }
  #wheelTimer = null;
  #guides = [];

  connectedCallback() {
    this.#nearObserver = new IntersectionObserver((entries) => this.#onNear(entries), { root: this, rootMargin: '100% 25%' });
    this.#keepObserver = new IntersectionObserver((entries) => this.#onKeep(entries), { root: this, rootMargin: '300% 100%' });
    for (const div of this.querySelectorAll('.page')) {
      this.#nearObserver.observe(div);
      this.#keepObserver.observe(div);
    }
    if (this.#wired) return;
    this.#wired = true;
    this.addEventListener('pointerdown', (e) => this.#onPointerDown(e), { capture: true });
    this.addEventListener('pointermove', (e) => this.#onPointerMove(e));
    this.addEventListener('pointerup', (e) => this.#onPointerUp(e));
    this.addEventListener('pointercancel', (e) => this.#onPointerUp(e));
    // The middle button would start the browser's autoscroll, and paste on Linux.
    this.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault());
    this.addEventListener('auxclick', (e) => e.button === 1 && e.preventDefault());
    this.addEventListener('wheel', (e) => this.#onWheel(e), { passive: false });
    document.addEventListener('keydown', (e) => this.#onKeyDown(e));
    document.addEventListener('keyup', (e) => this.#onKeyUp(e));
    window.addEventListener('blur', () => this.#reset());
  }

  disconnectedCallback() {
    this.#nearObserver?.disconnect();
    this.#keepObserver?.disconnect();
  }

  // The store to send intents to and to follow the tool and zoom from; set once by app.js.
  set store(store) {
    this.#store = store;
    this.#tool = store.state.tool ?? 'select';
    this.#zoom = store.state.zoom ?? 1;
    store.on(EVENTS.toolChanged, ({ tool }) => {
      this.#tool = tool;
      this.classList.toggle('tool-hand', tool === 'hand');
    });
    store.on(EVENTS.zoomChanged, ({ zoom }) => (this.#zoom = zoom));
    store.on(EVENTS.pagesUpdated, ({ doc }) => {
      if (doc) return;
      // The document was closed: stop painting and forget its pages.
      this.#generation++;
      this.#task?.cancel();
      this.#doc = null;
      this.#nearObserver?.disconnect();
      this.#keepObserver?.disconnect();
      this.#near.clear();
      this.#painted.clear();
      this.#reset();
    });
  }

  // ---------- lazy painting ----------

  // Called by app.js after it laid out the pages of `doc` at `zoom`. A canvas already inside a
  // page (the picture at the previous zoom) stays as a placeholder until the page is painted.
  paintPages(doc, pages, zoom) {
    this.#generation++;
    this.#task?.cancel();
    this.#task = null;
    this.#doc = doc;
    this.#zoom = zoom;
    this.#endPreview();
    this.#nearObserver.disconnect();
    this.#keepObserver.disconnect();
    this.#near.clear();
    this.#painted.clear();
    for (const div of pages) {
      this.#nearObserver.observe(div);
      this.#keepObserver.observe(div);
    }
  }

  #onNear(entries) {
    for (const entry of entries) {
      if (entry.isIntersecting) this.#near.add(entry.target);
      else this.#near.delete(entry.target);
    }
    this.#paintNext();
  }

  // Pages far outside the view give their canvas memory back; they are painted again on return.
  #onKeep(entries) {
    for (const entry of entries) {
      if (entry.isIntersecting) continue;
      const canvas = entry.target.querySelector('canvas');
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas.remove();
      }
      this.#painted.delete(entry.target);
    }
  }

  // The unpainted page closest to the middle of the view.
  #nextPage() {
    const box = this.getBoundingClientRect();
    const mid = (box.top + box.bottom) / 2;
    let best = null;
    let bestDistance = Infinity;
    for (const div of this.#near) {
      if (this.#painted.has(div) || !div.isConnected) continue;
      const r = div.getBoundingClientRect();
      const d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (d < bestDistance) {
        best = div;
        bestDistance = d;
      }
    }
    return best;
  }

  async #paintNext() {
    if (this.#painting) return;
    this.#painting = true;
    try {
      for (let div = this.#nextPage(); div && this.#doc; div = this.#nextPage()) {
        const generation = this.#generation;
        this.#painted.add(div); // also when painting fails, so a broken page is not retried forever
        let canvas;
        try {
          canvas = await this.#paintPage(Number(div.dataset.page));
        } catch {
          continue; // cancelled by a new layout, or the document was closed
        }
        if (generation !== this.#generation || !div.isConnected) continue;
        div.querySelector('canvas')?.remove();
        div.prepend(canvas);
      }
    } finally {
      this.#painting = false;
    }
  }

  async #paintPage(index) {
    const page = await this.#doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    let scale = this.#zoom * (window.devicePixelRatio || 1);
    const pixels = base.width * base.height * scale * scale;
    if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    const viewport = page.getViewport({ scale });
    const canvas = el('canvas', { width: Math.floor(viewport.width), height: Math.floor(viewport.height) });
    const task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
    this.#task = task;
    try {
      await task.promise;
    } finally {
      if (this.#task === task) this.#task = null;
    }
    return canvas;
  }

  // ---------- zoom anchors ----------

  // The page under a client point and the point's place inside it, as fractions of the page.
  anchorAt(clientX, clientY) {
    let best = null;
    for (const div of this.querySelectorAll('.page')) {
      const r = div.getBoundingClientRect();
      const d = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
      if (!best || d < best.d) best = { div, r, d };
      if (d === 0) break;
    }
    if (!best) return null;
    const { div, r } = best;
    return { page: Number(div.dataset.page), fx: (clientX - r.left) / r.width, fy: (clientY - r.top) / r.height, clientX, clientY };
  }

  // The anchor for zooming around the middle of the view (keyboard and toolbar zoom).
  centerAnchor() {
    const r = this.getBoundingClientRect();
    return this.anchorAt(r.left + r.width / 2, r.top + r.height / 2);
  }

  // Scrolls so that the anchored point of its page is back under the anchor's client point.
  restoreAnchor(anchor) {
    const div = this.querySelector(`.page[data-page="${anchor.page}"]`);
    if (!div) return;
    const r = div.getBoundingClientRect();
    this.scrollLeft += r.left + anchor.fx * r.width - anchor.clientX;
    this.scrollTop += r.top + anchor.fy * r.height - anchor.clientY;
  }

  // Shows the pages scaled by `scale` around client point (cx, cy) and shifted by (dx, dy) until
  // the zoom is committed; the layout itself does not change.
  #preview(cx, cy, scale, dx = 0, dy = 0) {
    if (!this.classList.contains('zooming')) {
      const r = this.getBoundingClientRect();
      const ox = this.scrollLeft + cx - r.left - this.clientLeft;
      const oy = this.scrollTop + cy - r.top - this.clientTop;
      for (const div of this.querySelectorAll('.page')) div.style.transformOrigin = `${ox - div.offsetLeft}px ${oy - div.offsetTop}px`;
      this.classList.add('zooming');
    }
    this.style.setProperty('--zoom-scale', scale);
    this.style.setProperty('--zoom-dx', `${dx}px`);
    this.style.setProperty('--zoom-dy', `${dy}px`);
  }

  #endPreview() {
    if (!this.classList.contains('zooming')) return;
    this.classList.remove('zooming');
    for (const div of this.querySelectorAll('.page')) div.style.transformOrigin = '';
    for (const name of ['--zoom-scale', '--zoom-dx', '--zoom-dy']) this.style.removeProperty(name);
  }

  // Commits a previewed zoom. app.js lays the pages out again, then paintPages ends the preview.
  #commitZoom(scale, anchor, cx, cy, dx = 0, dy = 0) {
    const zoom = clamp(this.#zoom * scale, MIN_ZOOM, MAX_ZOOM);
    if (!anchor || !this.#store || Math.abs(zoom - this.#zoom) < 0.005) {
      this.#endPreview();
      this.scrollLeft -= dx;
      this.scrollTop -= dy;
      return;
    }
    this.#store.dispatch('view:zoom', { zoom, anchor: { ...anchor, clientX: cx, clientY: cy } });
  }

  #onWheel(e) {
    if (!(e.ctrlKey || e.metaKey) || !this.#doc) return;
    e.preventDefault(); // no browser page zoom
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (!this.#wheel) this.#wheel = { scale: 1, anchor: this.anchorAt(e.clientX, e.clientY), cx: e.clientX, cy: e.clientY };
    const w = this.#wheel;
    w.scale = clamp(w.scale * Math.exp(-delta * 0.002), MIN_ZOOM / this.#zoom, MAX_ZOOM / this.#zoom);
    this.#preview(w.cx, w.cy, w.scale);
    clearTimeout(this.#wheelTimer);
    this.#wheelTimer = setTimeout(() => {
      this.#wheel = null;
      this.#commitZoom(w.scale, w.anchor, w.cx, w.cy);
    }, WHEEL_COMMIT_MS);
  }

  // ---------- panning and pinching ----------

  #emitPan(active) {
    this.#store?.emit(EVENTS.pan, { active });
  }

  #onKeyDown(e) {
    if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target?.closest?.(KEEPS_SPACE) || document.querySelector('.dlg-overlay')) return;
    if (!this.#doc || this.hidden) return;
    e.preventDefault(); // Space would scroll the page view by a screen
    if (this.#spaceHeld) return;
    this.#spaceHeld = true;
    this.classList.add('pan-ready');
  }

  #onKeyUp(e) {
    if (e.key !== ' ' || !this.#spaceHeld) return;
    this.#spaceHeld = false;
    this.classList.remove('pan-ready');
    if (this.#pan?.space) this.#endPan();
  }

  #reset() {
    this.#spaceHeld = false;
    this.classList.remove('pan-ready');
    if (this.#pan) this.#endPan();
    if (this.#pinch) {
      this.#pinch = null;
      this.#endPreview();
      this.#emitPan(false);
    }
    this.#touches.clear();
  }

  #wantsPan(e) {
    if (e.button === 1) return true;
    if (e.button !== 0) return false;
    if (this.#spaceHeld || this.#tool === 'hand') return true;
    // One finger on a page pans with the select tool (pages turn off the browser's own touch
    // scrolling so that drawing tools work); on items it moves them, outside pages the browser scrolls.
    return e.pointerType === 'touch' && this.#tool === 'select' && !!e.target.closest('.page') && !e.target.closest('.mark, .tbox, .sel-handle');
  }

  #onPointerDown(e) {
    if (e.pointerType === 'touch') {
      this.#touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.#pinch || this.#touches.size > 2) {
        e.stopPropagation();
        return;
      }
      if (this.#touches.size === 2) {
        e.preventDefault();
        e.stopPropagation(); // the second finger never starts a tool gesture
        this.#startPinch();
        return;
      }
    }
    if (this.#pan || !this.#doc || !this.#wantsPan(e)) return;
    // A touch with the select tool still reaches app.js, so a tap on a page clears the selection.
    if (!(e.pointerType === 'touch' && this.#tool === 'select')) {
      e.preventDefault();
      e.stopPropagation();
    }
    this.#pan = { id: e.pointerId, x: e.clientX, y: e.clientY, left: this.scrollLeft, top: this.scrollTop, space: this.#spaceHeld && e.button === 0 };
    try {
      this.setPointerCapture(e.pointerId);
    } catch {
      // synthetic or already released pointer
    }
    this.classList.add('panning');
    this.#emitPan(true);
  }

  #onPointerMove(e) {
    if (this.#touches.has(e.pointerId)) this.#touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.#pinch) return this.#movePinch();
    if (!this.#pan || e.pointerId !== this.#pan.id) return;
    this.scrollLeft = this.#pan.left - (e.clientX - this.#pan.x);
    this.scrollTop = this.#pan.top - (e.clientY - this.#pan.y);
  }

  #onPointerUp(e) {
    const wasTouch = this.#touches.delete(e.pointerId);
    if (this.#pinch && wasTouch) return this.#endPinch();
    if (this.#pan && e.pointerId === this.#pan.id) this.#endPan();
  }

  #endPan() {
    try {
      this.releasePointerCapture(this.#pan.id);
    } catch {
      // already released
    }
    this.#pan = null;
    this.classList.remove('panning');
    this.#emitPan(false);
  }

  #startPinch() {
    if (this.#pan) {
      this.#pan = null;
      this.classList.remove('panning');
    } else {
      this.#emitPan(true); // app.js cancels a drawing or a drag started by the first finger
    }
    const [a, b] = [...this.#touches.values()];
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    this.#pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx0: cx, cy0: cy, cx, cy, scale: 1, anchor: this.anchorAt(cx, cy) };
    for (const id of this.#touches.keys()) {
      try {
        this.setPointerCapture(id);
      } catch {
        // pointer already gone
      }
    }
  }

  #movePinch() {
    const p = this.#pinch;
    if (this.#touches.size < 2) return;
    const [a, b] = [...this.#touches.values()];
    p.cx = (a.x + b.x) / 2;
    p.cy = (a.y + b.y) / 2;
    p.scale = clamp(Math.hypot(a.x - b.x, a.y - b.y) / p.d0, MIN_ZOOM / this.#zoom, MAX_ZOOM / this.#zoom);
    this.#preview(p.cx0, p.cy0, p.scale, p.cx - p.cx0, p.cy - p.cy0);
  }

  // The first finger to lift ends the pinch; the other one does nothing until it lifts too.
  #endPinch() {
    const p = this.#pinch;
    this.#pinch = null;
    this.#commitZoom(p.scale, p.anchor, p.cx, p.cy, p.cx - p.cx0, p.cy - p.cy0);
    this.#emitPan(false);
  }

  // ---------- snap guides ----------

  // Draws the guides { x, y } (page points, null = none) on a page while an item is dragged.
  showGuides(pageEl, size, guides) {
    this.clearGuides();
    if (!pageEl || !guides) return;
    if (guides.x !== null && guides.x !== undefined) {
      this.#guides.push(pageEl.appendChild(el('div', { class: 'snap-guide v', style: `left:${(guides.x / size.width) * 100}%` })));
    }
    if (guides.y !== null && guides.y !== undefined) {
      this.#guides.push(pageEl.appendChild(el('div', { class: 'snap-guide h', style: `top:${(guides.y / size.height) * 100}%` })));
    }
  }

  clearGuides() {
    for (const g of this.#guides) g.remove();
    this.#guides = [];
  }
}

customElements.define('pdf-canvas-view', PdfCanvasView);
