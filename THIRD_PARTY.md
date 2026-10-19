# Third-party material

## storytold/pdfcraft (MIT OR Apache-2.0)

Source: <https://github.com/storytold/pdfcraft> — Copyright (c) 2026 ArtCraft Team and the PdfCraft contributors.

Used as design reference only:

- Dark color tokens (`crates/ui-egui/src/theme.rs`) → CSS variables in `index.html`. The light tokens are the project's own white theme.
- Tool-group hues (`crates/engine/src/catalog.rs`) → mode-tab colors in `index.html`.
- Default comment styles (`crates/annot/src/lib.rs`, `Style::default_for`) → defaults in `src/marks.js`.
- Feature grouping (menus, modes, tools, comments panel) → `index.html` and `src/app.js`.

No source code was copied. Icons are simple hand-drawn SVG paths; pdfcraft's icons are Lucide (ISC) and were not used.

## Libraries loaded at runtime

Loaded from CDN with pinned versions; see each project's license.

- pdf.js 3.11.174 (Apache-2.0), pdf-lib 1.17.1 (MIT), @pdf-lib/fontkit 1.1.1 (MIT): always.
- On first use only (`src/libs.js`):
  - @neslinesli93/qpdf-wasm 0.3.0 (ISC), bundling QPDF 12 (Apache-2.0): password protection, unlocking, compression.
  - tesseract.js 7.0.0 (Apache-2.0) and its language data: OCR.
  - JSZip 3.10.1 (MIT or GPL-3.0, used under MIT): image extraction archive.
  - docx 9.5.1 (MIT): Word export.
  - SheetJS Community Edition 0.20.2 (Apache-2.0), from cdn.sheetjs.com: Excel export and Excel → PDF.
  - Mammoth 1.8.0 (BSD-2-Clause): Word → PDF.
  - DejaVu Sans 2.37 (Bitstream Vera / DejaVu fonts license, free to embed), `dejavu-fonts-ttf` on npm: Vietnamese text in exported PDFs when no font is chosen.
