// Heavy optional libraries, loaded from a CDN the first time a feature needs them, so opening the
// editor stays fast. Versions are pinned.

export const LIB_URLS = {
  qpdf: 'https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.js', // ISC, QPDF compiled to WebAssembly
  qpdfWasm: 'https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.wasm',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js', // Apache-2.0
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', // MIT
  docx: 'https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js', // MIT
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.20.2/dist/xlsx.full.min.js', // Apache-2.0
  mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js', // BSD-2-Clause
  unicodeFont: 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf', // Bitstream Vera / DejaVu license (free)
};

const loading = new Map();

export function loadScript(url) {
  if (!loading.has(url)) {
    loading.set(
      url,
      new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => {
          loading.delete(url);
          script.remove();
          reject(new Error(`Không tải được thư viện từ ${new URL(url).host}. Hãy kiểm tra kết nối mạng rồi thử lại.`));
        };
        document.head.append(script);
      }),
    );
  }
  return loading.get(url);
}
