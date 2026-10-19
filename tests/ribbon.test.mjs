import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKSTAGE,
  DEFAULT_QAT,
  QAT_CHOICES,
  QAT_LIMIT,
  RIBBON_TABS,
  SHORT_LABELS,
  assignKeyTips,
  columns,
  commandTool,
  detectPlatform,
  foldLabel,
  formatShortcut,
  itemCommand,
  itemLabel,
  parseJson,
  ribbonCommandIds,
  sanitizeQat,
  sanitizeRibbonMode,
  splitShortcut,
  tabCommands,
  tabForCommand,
  toggleQat,
  toggledRibbonMode,
  toolCommand,
} from '../src/ribbon.js';

const ID = /^(tool:)?[a-zA-Z][a-zA-Z0-9]*$/;

test('ribbon tabs have unique ids, labels and well-formed groups', () => {
  const ids = RIBBON_TABS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(RIBBON_TABS[0].id, 'file');
  assert.ok(RIBBON_TABS[0].backstage);
  for (const tab of RIBBON_TABS.filter((t) => !t.backstage)) {
    assert.ok(tab.label && tab.hue, `${tab.id} needs a label and a hue`);
    assert.ok(tab.groups.length > 0, `${tab.id} has no groups`);
    for (const g of tab.groups) {
      assert.ok(g.label, `${tab.id} has a group without a label`);
      const items = [...(g.large ?? []), ...(g.small ?? [])];
      assert.ok(items.length > 0, `${tab.id} › ${g.label} is empty`);
      for (const item of items) assert.match(itemCommand(item), ID);
      const inGroup = items.map(itemCommand);
      assert.equal(new Set(inGroup).size, inGroup.length, `${tab.id} › ${g.label} repeats a command`);
    }
  }
});

test('the existing modes keep their ids so setMode callers still work', () => {
  for (const id of ['comment', 'edit', 'organize', 'sign', 'convert', 'protect']) assert.ok(RIBBON_TABS.some((t) => t.id === id), id);
});

test('every ribbon, backstage and QAT command has a short label, and KeyTips are unique per tab', () => {
  const backstage = [...BACKSTAGE.nav.filter((x) => x !== '-'), ...BACKSTAGE.sections.flatMap((s) => s.items)];
  const accountOnly = new Set(['login', 'manageAccount', 'logout', 'undo', 'redo']);
  for (const id of [...ribbonCommandIds(), ...backstage, ...QAT_CHOICES]) {
    if (!accountOnly.has(id)) assert.ok(SHORT_LABELS[id], `no short label for ${id}`);
  }
  for (const tab of RIBBON_TABS.filter((t) => !t.backstage)) {
    const ids = [...new Set(tabCommands(tab))];
    const keys = assignKeyTips(ids.map((id) => SHORT_LABELS[id]));
    assert.ok(keys.every(Boolean), `${tab.id} ran out of KeyTips`);
    assert.equal(new Set(keys).size, keys.length);
  }
});

test('tool ids round-trip and labels fall back to the action label without its ellipsis', () => {
  assert.equal(toolCommand('highlight'), 'tool:highlight');
  assert.equal(commandTool('tool:highlight'), 'highlight');
  assert.equal(commandTool('open'), null);
  assert.equal(commandTool(undefined), null);
  assert.equal(itemLabel('open'), 'Mở');
  assert.equal(itemLabel({ cmd: 'find', label: 'Tìm để che' }), 'Tìm để che');
  assert.equal(itemLabel('somethingNew', 'Làm gì đó…'), 'Làm gì đó');
});

test('tabForCommand keeps the current tab when it has the command, else picks the first that does', () => {
  assert.equal(tabForCommand(RIBBON_TABS, 'tool:select', 'sign'), 'sign');
  assert.equal(tabForCommand(RIBBON_TABS, 'tool:squiggly', 'home'), 'comment');
  assert.equal(tabForCommand(RIBBON_TABS, 'tool:redact', 'home'), 'protect');
  assert.equal(tabForCommand(RIBBON_TABS, 'nothing', 'edit'), 'edit');
  assert.equal(tabForCommand(RIBBON_TABS, 'tool:highlight', 'nope'), 'home');
});

test('columns stacks small buttons three to a column', () => {
  assert.deepEqual(columns([1, 2, 3, 4, 5]), [[1, 2, 3], [4, 5]]);
  assert.deepEqual(columns([]), []);
  assert.deepEqual(columns([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
});

test('ribbon display mode is sanitized and Ctrl+F1 toggles back to the previous mode', () => {
  assert.equal(sanitizeRibbonMode('simple'), 'simple');
  assert.equal(sanitizeRibbonMode('bogus'), 'classic');
  assert.equal(sanitizeRibbonMode(null, 'tabs'), 'tabs');
  assert.equal(toggledRibbonMode('classic'), 'tabs');
  assert.equal(toggledRibbonMode('simple'), 'tabs');
  assert.equal(toggledRibbonMode('tabs', 'simple'), 'simple');
  assert.equal(toggledRibbonMode('tabs', 'tabs'), 'classic');
});

test('sanitizeQat keeps unique known ids up to the limit and defaults when never customized', () => {
  const known = new Set(['open', 'export', 'print', 'undo', 'redo', 'find']);
  const isKnown = (id) => known.has(id);
  assert.deepEqual(sanitizeQat(null, isKnown), [...DEFAULT_QAT]);
  assert.deepEqual(sanitizeQat('open', isKnown), [...DEFAULT_QAT]);
  assert.deepEqual(sanitizeQat([], isKnown), []);
  assert.deepEqual(sanitizeQat(['find', 'find', 42, 'gone', 'open'], isKnown), ['find', 'open']);
  assert.equal(sanitizeQat(Array.from({ length: 30 }, (_, i) => `c${i}`)).length, QAT_LIMIT);
});

test('toggleQat adds at the end, removes, and leaves a full toolbar unchanged', () => {
  assert.deepEqual(toggleQat(['open'], 'find'), ['open', 'find']);
  assert.deepEqual(toggleQat(['open', 'find'], 'open'), ['find']);
  assert.deepEqual(toggleQat(['a', 'b'], 'c', 2), ['a', 'b']);
});

test('parseJson returns the fallback for missing or broken text', () => {
  assert.deepEqual(parseJson('["a"]', null), ['a']);
  assert.equal(parseJson(null, 'x'), 'x');
  assert.equal(parseJson('{oops', 'x'), 'x');
});

test('foldLabel strips Vietnamese diacritics and punctuation', () => {
  assert.equal(foldLabel('Chuyển đổi'), 'CHUYEN DOI');
  assert.equal(foldLabel('Ký & điền'), 'KY DIEN');
  assert.equal(foldLabel('Đầu/chân trang'), 'DAU CHAN TRANG');
});

test('assignKeyTips prefers initials, then later words, then any letter, and stays unique', () => {
  const tabs = RIBBON_TABS.map((t) => t.label);
  const keys = assignKeyTips(tabs, { alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
  assert.deepEqual(Object.fromEntries(tabs.map((l, i) => [l, keys[i]])), {
    Tệp: 'T',
    'Trang đầu': 'D',
    'Chú thích': 'C',
    'Chỉnh sửa': 'S',
    Trang: 'R',
    'Ký & điền': 'K',
    'Chuyển đổi': 'H',
    'Bảo vệ': 'B',
    Xem: 'X',
  });
  assert.deepEqual(assignKeyTips(['Mở', 'Mở'], { alphabet: 'MO' }), ['M', 'O']);
  assert.deepEqual(assignKeyTips(['A', 'A', 'A'], { alphabet: 'A' }), ['A', '', '']);
  assert.deepEqual(assignKeyTips(['Xem'], { reserved: ['X'] }), ['E']);
});

test('detectPlatform tells Apple, Android, Windows, ChromeOS and Linux apart', () => {
  assert.equal(detectPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)' }), 'mac');
  assert.equal(detectPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 5 }), 'ios');
  assert.equal(detectPlatform({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }), 'ios');
  assert.equal(detectPlatform({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' }), 'android');
  assert.equal(detectPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'windows');
  assert.equal(detectPlatform({ platform: 'Chrome OS', userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)' }), 'chromeos');
  assert.equal(detectPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), 'linux');
  assert.equal(detectPlatform({}), 'other');
});

test('shortcuts split on modifiers and keep the plus key', () => {
  assert.deepEqual(splitShortcut('Ctrl+Shift+Z'), ['Ctrl', 'Shift', 'Z']);
  assert.deepEqual(splitShortcut('Ctrl++'), ['Ctrl', '+']);
  assert.deepEqual(splitShortcut('Ctrl+-'), ['Ctrl', '-']);
  assert.deepEqual(splitShortcut('Del'), ['Del']);
  assert.deepEqual(splitShortcut(undefined), []);
});

test('formatShortcut writes ⌘-style shortcuts on Apple devices and Ctrl+ elsewhere', () => {
  assert.equal(formatShortcut('Ctrl+K', 'windows'), 'Ctrl+K');
  assert.equal(formatShortcut('Ctrl++', 'linux'), 'Ctrl++');
  assert.equal(formatShortcut('Ctrl+K', 'mac'), '⌘K');
  assert.equal(formatShortcut('Ctrl+Shift+Z', 'mac'), '⇧⌘Z');
  assert.equal(formatShortcut('Ctrl+Alt+R', 'ios'), '⌥⌘R');
  assert.equal(formatShortcut('Ctrl++', 'mac'), '⌘+');
  assert.equal(formatShortcut('Del', 'mac'), '⌫');
  assert.equal(formatShortcut('Alt', 'mac'), '⌥');
  assert.equal(formatShortcut('', 'mac'), '');
});
