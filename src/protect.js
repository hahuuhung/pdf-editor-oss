// Password protection, unlocking and structural compression through QPDF compiled to WebAssembly.
// pdf-lib cannot read or write encrypted PDFs; QPDF does both (AES-256 for new protection).
// The argument builders are pure and tested; `runQpdf` needs a browser.

import { LIB_URLS, loadScript } from './libs.js';

const IN = '/in.pdf';
const OUT = '/out.pdf';

function randomPassword() {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// AES-256 encryption. Without an owner password a random one is used, so the permission
// restrictions cannot be lifted with an empty password.
export function encryptArgs({ userPassword = '', ownerPassword = '', allowPrint = true, allowCopy = true, allowModify = false } = {}) {
  return [
    IN,
    '--encrypt',
    userPassword,
    ownerPassword || randomPassword(),
    '256',
    `--print=${allowPrint ? 'full' : 'none'}`,
    `--extract=${allowCopy ? 'y' : 'n'}`,
    `--modify=${allowModify ? 'all' : 'none'}`,
    '--',
    OUT,
  ];
}

export function decryptArgs(password = '') {
  return [`--password=${password}`, '--decrypt', IN, OUT];
}

// Lossless size reduction: object streams, recompressed content streams, unused objects dropped.
export function compressArgs() {
  return ['--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', IN, OUT];
}

export function qpdfErrorMessage(log) {
  const text = String(log ?? '');
  if (/invalid password/i.test(text)) return 'Mật khẩu không đúng.';
  if (/not a PDF file|can't find PDF header/i.test(text)) return 'Tệp không phải PDF hợp lệ.';
  const last = text.trim().split('\n').filter(Boolean).at(-1);
  return last ? `QPDF báo lỗi: ${last}` : 'QPDF không xử lý được tệp này.';
}

// Runs one QPDF command on `input` and returns the output file. A fresh module instance is used for
// each run because QPDF exits at the end of main; the browser caches the compiled WebAssembly.
export async function runQpdf(args, input) {
  await loadScript(LIB_URLS.qpdf);
  const createModule = globalThis.Module;
  if (typeof createModule !== 'function') throw new Error('Không khởi tạo được QPDF.');
  const log = [];
  const qpdf = await createModule({
    locateFile: () => LIB_URLS.qpdfWasm,
    noInitialRun: true,
    print: (line) => log.push(line),
    printErr: (line) => log.push(line),
  });
  qpdf.FS.writeFile(IN, input);
  // This build writes its messages straight to the console, ignoring print/printErr. callMain is
  // synchronous, so the console is redirected only for its duration.
  const { log: consoleLog, error: consoleError } = console;
  console.log = (...parts) => log.push(parts.join(' '));
  console.error = (...parts) => log.push(parts.join(' '));
  let code;
  try {
    code = qpdf.callMain(args);
  } catch (err) {
    code = typeof err?.status === 'number' ? err.status : 1;
    log.push(String(err?.message ?? err));
  } finally {
    console.log = consoleLog;
    console.error = consoleError;
  }
  let output = null;
  try {
    output = qpdf.FS.readFile(OUT);
  } catch {
    // no output file
  }
  // Exit code 3 means "succeeded with warnings" and still writes the output.
  if (!output || (code !== 0 && code !== 3)) throw new Error(qpdfErrorMessage(log.join('\n')));
  return output;
}

export function encryptPdf(bytes, options) {
  return runQpdf(encryptArgs(options), bytes);
}

export function decryptPdf(bytes, password = '') {
  return runQpdf(decryptArgs(password), bytes);
}

export function compressPdf(bytes) {
  return runQpdf(compressArgs(), bytes);
}

// pdf-lib refuses encrypted files, which is exactly when QPDF is needed.
export async function isEncrypted(bytes) {
  try {
    await PDFLib.PDFDocument.load(bytes);
    return false;
  } catch (err) {
    return /encrypt/i.test(err?.message ?? '');
  }
}
