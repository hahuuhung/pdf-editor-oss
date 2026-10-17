import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, EditorStore } from '../src/store.js';

test('on delivers the event detail until unsubscribed', () => {
  const store = new EditorStore();
  const seen = [];
  const off = store.on(EVENTS.pageChanged, (d) => seen.push(d.index));
  store.emit(EVENTS.pageChanged, { index: 2 });
  store.emit(EVENTS.selectionChanged, { selected: null });
  off();
  store.emit(EVENTS.pageChanged, { index: 3 });
  assert.deepEqual(seen, [2]);
});

test('the state object is shared, not copied', () => {
  const state = { zoom: 1 };
  const store = new EditorStore(state);
  store.state.zoom = 2;
  assert.equal(state.zoom, 2);
});

test('dispatch runs the registered intent handler and returns its result', async () => {
  const store = new EditorStore();
  store.handle('page:reorder', async ({ from, to }) => `${from}->${to}`);
  assert.equal(await store.dispatch('page:reorder', { from: 0, to: 2 }), '0->2');
  assert.throws(() => store.dispatch('page:unknown'), /page:unknown/);
});

test('record, undo and redo move snapshots between the two stacks', () => {
  const store = new EditorStore();
  assert.equal(store.undo('now'), null);
  store.record('a');
  store.record('b');
  assert.equal(store.undo('c'), 'b'); // current state 'c' becomes the redo step
  assert.equal(store.canRedo, true);
  assert.equal(store.redo('b'), 'c');
  assert.equal(store.undo('c'), 'b');
  store.record('x'); // a new change forgets the redo steps
  assert.equal(store.canRedo, false);
  assert.equal(store.redo('y'), null);
  assert.equal(store.undo('y'), 'x');
  assert.equal(store.undo('x'), 'a');
  assert.equal(store.canUndo, false);
});

test('history keeps at most historyLimit steps and reports every change', () => {
  const store = new EditorStore({}, { historyLimit: 2 });
  const flags = [];
  store.on(EVENTS.historyChanged, (d) => flags.push(`${d.canUndo}/${d.canRedo}`));
  store.record(1);
  store.record(2);
  store.record(3);
  assert.equal(store.undo(4), 3);
  assert.equal(store.undo(3), 2);
  assert.equal(store.undo(2), null); // step 1 was dropped
  store.clearHistory();
  assert.equal(store.canRedo, false);
  assert.deepEqual(flags, ['true/false', 'true/false', 'true/false', 'true/true', 'false/true', 'false/false']);
});
