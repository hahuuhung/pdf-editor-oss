import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldAutoSaveSession,
  formatFileSize,
  formatRelativeTimeVi,
  createMemoryKvBackend,
  createWorkspaceStorage,
  createAutoSaveScheduler,
} from '../src/workspace-storage.js';

describe('shouldAutoSaveSession security & quota guardrails', () => {
  it('strictly blocks encrypted source PDFs and password-protected documents', () => {
    const sample = new Uint8Array([37, 80, 68, 70]);
    assert.equal(shouldAutoSaveSession({ pdfBytes: sample, isEncryptedSource: false }), true);
    assert.equal(shouldAutoSaveSession({ pdfBytes: sample, isEncryptedSource: true }), false);
    assert.equal(
      shouldAutoSaveSession({
        pdfBytes: sample,
        isEncryptedSource: false,
        settings: { protection: { userPassword: 'secret' } },
      }),
      false,
    );
    // Permission-only protection with empty userPassword is allowed or safe when no user password
    assert.equal(
      shouldAutoSaveSession({
        pdfBytes: sample,
        isEncryptedSource: false,
        settings: { protection: { userPassword: '' } },
      }),
      true,
    );
  });

  it('rejects empty buffers and files exceeding maxBytes', () => {
    assert.equal(shouldAutoSaveSession({ pdfBytes: new Uint8Array(0) }), false);
    assert.equal(shouldAutoSaveSession({ pdfBytes: new Uint8Array(200), maxBytes: 100 }), false);
  });
});

describe('createWorkspaceStorage draft & MRU recent files lifecycle', () => {
  it('saves isolated draft copies and purges draft immediately if user adds a password', async () => {
    const store = createWorkspaceStorage({ backend: createMemoryKvBackend() });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const boxes = [{ id: 1, page: 0, x: 10, y: 20, text: 'Bản nháp' }];

    const ok = await store.saveDraft({
      fileName: 'hop-dong.pdf',
      pdfBytes: bytes,
      boxes,
      marks: [],
      pageCount: 4,
      savedAt: 1000,
    });
    assert.equal(ok, true);

    // Mutate caller buffers to verify stored snapshot is isolated
    bytes[0] = 99;
    boxes[0].text = 'Mutated';

    const loaded = await store.loadDraft();
    assert.equal(loaded.fileName, 'hop-dong.pdf');
    assert.equal(loaded.pdfBytes[0], 1);
    assert.equal(loaded.boxes[0].text, 'Bản nháp');

    // Setting a password purges the existing draft automatically
    const blocked = await store.saveDraft({
      fileName: 'hop-dong.pdf',
      pdfBytes: new Uint8Array([1, 2, 3]),
      settings: { protection: { userPassword: '123' } },
    });
    assert.equal(blocked, false);
    assert.equal(await store.loadDraft(), null);
  });

  it('maintains MRU order, deduplicates filenames, caps list length, and skips encrypted files', async () => {
    const store = createWorkspaceStorage({ backend: createMemoryKvBackend(), maxRecents: 3 });
    const b = new Uint8Array([10, 20, 30]);

    await store.addRecentFile({ fileName: 'A.pdf', pdfBytes: b, pageCount: 1, openedAt: 100 });
    await store.addRecentFile({ fileName: 'B.pdf', pdfBytes: b, pageCount: 2, openedAt: 200 });
    await store.addRecentFile({ fileName: 'Secret.pdf', pdfBytes: b, isEncryptedSource: true, openedAt: 250 });
    await store.addRecentFile({ fileName: 'C.pdf', pdfBytes: b, pageCount: 3, openedAt: 300 });
    await store.addRecentFile({ fileName: 'D.pdf', pdfBytes: b, pageCount: 4, openedAt: 400 });
    // Re-opening B moves B to index 0
    await store.addRecentFile({ fileName: 'b.pdf', pdfBytes: b, pageCount: 2, openedAt: 500 });

    const list = await store.listRecentFiles();
    assert.deepEqual(list.map((i) => i.fileName), ['b.pdf', 'D.pdf', 'C.pdf']);

    await store.removeRecentFile(list[1].id);
    assert.deepEqual((await store.listRecentFiles()).map((i) => i.fileName), ['b.pdf', 'C.pdf']);

    await store.clearAll();
    assert.equal((await store.listRecentFiles()).length, 0);
  });
});

describe('formatting helpers & autoSaveScheduler', () => {
  it('formats Vietnamese relative timestamps and file sizes cleanly', async () => {
    assert.equal(formatFileSize(512), '512 B');
    assert.equal(formatFileSize(2048), '2 KB');
    assert.equal(formatFileSize(2.5 * 1024 * 1024), '2.5 MB');

    const now = 1_000_000;
    assert.equal(formatRelativeTimeVi(now - 15_000, now), 'Vừa xong');
    assert.equal(formatRelativeTimeVi(now - 5 * 60_000, now), '5 phút trước');
    assert.equal(formatRelativeTimeVi(now - 3 * 3600_000, now), '3 giờ trước');

    let count = 0;
    const sched = createAutoSaveScheduler(() => { count++; }, 5000);
    sched.schedule();
    sched.schedule();
    await sched.flush();
    assert.equal(count, 1);
  });
});

