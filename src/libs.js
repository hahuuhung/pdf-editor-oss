// Heavy optional libraries, loaded from a CDN the first time a feature needs them, so opening the
// editor stays fast. Versions are pinned.

export const LIB_URLS = {
  qpdf: 'https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.js', // ISC, QPDF compiled to WebAssembly
  qpdfWasm: 'https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.wasm',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js', // Apache-2.0
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', // MIT
  docx: 'https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js', // MIT
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
