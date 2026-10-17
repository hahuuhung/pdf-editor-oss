// editorStore: the editor's state container, event bus and undo/redo history.
//
// Views do not call each other. A component asks for a change by dispatching an intent
// ('page:reorder'); app.js handles it, updates the state and emits an event
// ('state:pages-updated') that every subscribed view renders from:
//
//   component --dispatch(intent)--> handler in app.js --pdf ops--> emit(event) --> components
//
// The state object is plain: app.js reads and assigns its fields directly and emits the matching
// event after a change. Undo snapshots are opaque values supplied by the caller.

export const EVENTS = Object.freeze({
  loaded: 'pdf:loaded', // a document was opened: { fileName, pageCount }
  pagesUpdated: 'state:pages-updated', // pages were (re)loaded: { doc, pageSizes, current, order, changed }
  pageChanged: 'state:page-changed', // the current page: { index, count }
  selectionChanged: 'selection:changed', // the selected item: { selected }
  toolChanged: 'state:tool-changed', // { mode, tool }
  zoomChanged: 'state:zoom-changed', // { zoom }
  historyChanged: 'history:changed', // { canUndo, canRedo }
  pan: 'canvas:pan', // hand panning started or stopped: { active }
});

export class EditorStore extends EventTarget {
  #handlers = new Map();
  #past = [];
  #future = [];

  constructor(state = {}, { historyLimit = 100 } = {}) {
    super();
    this.state = state;
    this.historyLimit = historyLimit;
  }

  // ---------- events ----------

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // Calls `listener(detail)` for every `type` event. Returns a function that unsubscribes.
  on(type, listener) {
    const wrapped = (e) => listener(e.detail);
    this.addEventListener(type, wrapped);
    return () => this.removeEventListener(type, wrapped);
  }

  // ---------- intents ----------

  // Registers the handler of an intent such as 'page:reorder'. An intent has exactly one handler.
  handle(intent, handler) {
    this.#handlers.set(intent, handler);
  }

  // Asks for a change and returns the handler's result (often a promise).
  dispatch(intent, payload = {}) {
    const handler = this.#handlers.get(intent);
    if (!handler) throw new Error(`Không có xử lý cho "${intent}".`);
    return handler(payload);
  }

  // ---------- history ----------

  get canUndo() {
    return this.#past.length > 0;
  }

  get canRedo() {
    return this.#future.length > 0;
  }

  // Records the state before a change as one undo step and forgets the redo steps.
  record(snapshot) {
    this.#push(this.#past, snapshot);
    this.#future = [];
    this.#historyChanged();
  }

  // Returns the snapshot to restore for undo, or null; `current` becomes the redo step.
  undo(current) {
    if (!this.#past.length) return null;
    this.#push(this.#future, current);
    const snapshot = this.#past.pop();
    this.#historyChanged();
    return snapshot;
  }

  // Returns the snapshot to restore for redo, or null; `current` becomes an undo step again.
  redo(current) {
    if (!this.#future.length) return null;
    this.#push(this.#past, current);
    const snapshot = this.#future.pop();
    this.#historyChanged();
    return snapshot;
  }

  clearHistory() {
    this.#past = [];
    this.#future = [];
    this.#historyChanged();
  }

  #push(stack, snapshot) {
    stack.push(snapshot);
    if (stack.length > this.historyLimit) stack.shift();
  }

  #historyChanged() {
    this.emit(EVENTS.historyChanged, { canUndo: this.canUndo, canRedo: this.canRedo });
  }
}
