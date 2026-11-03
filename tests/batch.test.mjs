import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeFlattenOptions,
  sanitizeBatchPipeline,
  computeBatchBatesPlan,
  buildOutputFileName,
} from '../src/batch.js';

describe('sanitizeFlattenOptions & sanitizeBatchPipeline', () => {
  it('sanitizes flatten mode, DPI and target safely', () => {
    const def = sanitizeFlattenOptions({});
    assert.equal(def.mode, 'vector');
    assert.equal(def.dpi, 200);
    assert.equal(def.keepLinks, true);
    assert.equal(def.target, 'download');

    const ras = sanitizeFlattenOptions({ mode: 'raster', dpi: 300, jpegQuality: 1.5, keepLinks: false, target: 'replace' });
    assert.equal(ras.mode, 'raster');
    assert.equal(ras.dpi, 300);
    assert.equal(ras.jpegQuality, 1);
    assert.equal(ras.keepLinks, false);
    assert.equal(ras.target, 'replace');
  });

  it('sanitizes sequential batch pipeline steps and strips unsafe filename characters', () => {
    const pipe = sanitizeBatchPipeline({
      watermark: { enabled: true, text: '  MẬT  ', opacity: 0.3 },
      bates: { enabled: true, prefix: 'HD-', start: 10, digits: 5, position: 'headerRight' },
      flatten: { enabled: true, mode: 'raster', dpi: 150 },
      compress: { enabled: true },
      protect: { enabled: true, userPassword: '' }, // empty password disables encryption safely
      fileNameSuffix: '-final:v1*?',
    });

    assert.equal(pipe.watermark.enabled, true);
    assert.equal(pipe.watermark.text, 'MẬT');
    assert.equal(pipe.bates.position, 'headerRight');
    assert.equal(pipe.flatten.mode, 'raster');
    assert.equal(pipe.compress.enabled, true);
    assert.equal(pipe.protect.enabled, false);
    assert.equal(pipe.fileNameSuffix, '-finalv1');
  });
});

describe('computeBatchBatesPlan & buildOutputFileName', () => {
  it('computes continuous cross-file Bates numbers across multiple PDFs', () => {
    const plan = computeBatchBatesPlan([3, 5, 2], {
      prefix: 'HS-',
      start: 1,
      digits: 6,
      continuousAcrossFiles: true,
    });
    assert.equal(plan.length, 3);
    assert.equal(plan[0].firstLabel, 'HS-000001');
    assert.equal(plan[0].lastLabel, 'HS-000003');
    assert.equal(plan[1].firstLabel, 'HS-000004');
    assert.equal(plan[1].lastLabel, 'HS-000008');
    assert.equal(plan[2].firstLabel, 'HS-000009');
    assert.equal(plan[2].lastLabel, 'HS-000010');
  });

  it('resets Bates numbers per file when continuousAcrossFiles is false', () => {
    const plan = computeBatchBatesPlan([3, 5], {
      prefix: 'DOC-',
      start: 100,
      digits: 4,
      continuousAcrossFiles: false,
    });
    assert.equal(plan[0].firstLabel, 'DOC-0100');
    assert.equal(plan[1].firstLabel, 'DOC-0100');
    assert.equal(plan[1].lastLabel, 'DOC-0104');
  });

  it('deduplicates colliding output filenames inside ZIP archives', () => {
    const used = new Set();
    assert.equal(buildOutputFileName('Hop-dong.pdf', '-batch', used), 'Hop-dong-batch.pdf');
    assert.equal(buildOutputFileName('hop-dong.PDF', '-batch', used), 'hop-dong-batch (2).pdf');
    assert.equal(buildOutputFileName('Hop-dong.pdf', '-batch', used), 'Hop-dong-batch (3).pdf');
  });
});

