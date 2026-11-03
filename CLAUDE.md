# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Lệnh thường dùng

Không có `package.json`, bước build, bundler hay linter: mã nguồn trong repo chạy thẳng trên trình duyệt và được đăng tĩnh lên GitHub Pages.

```bash
python -m http.server 8000                                # chạy app tại http://localhost:8000 (ES modules không chạy qua file://)
node --test tests/                                        # toàn bộ unit test
node --test tests/store.test.mjs                          # một tệp test
node --test --test-name-pattern="undo" tests/store.test.mjs   # lọc theo tên test trong một tệp
```

Đừng thêm dependency npm hay bước build. Thư viện ngoài được nạp từ CDN với phiên bản ghim cố định; khi thêm thư viện, cập nhật cả `THIRD_PARTY.md`.

## Kiến trúc

**Nạp thư viện.** `index.html` luôn nạp pdf.js, pdf-lib và fontkit bằng thẻ `<script>`, nên chúng là biến toàn cục (`pdfjsLib`, `PDFLib`, `fontkit`), không phải import. Thư viện nặng khai báo trong `LIB_URLS` và nạp khi cần bằng `loadScript` (`src/libs.js`).

**`src/app.js` là bộ điều phối** và là nơi duy nhất nối mọi thứ lại với nhau: trạng thái, lịch sử hoàn tác, hộp thoại, bảng lệnh. Các module khác không import `app.js`; chúng nhận callback (ví dụ `openBatesDialog({ state, onApply, onStatus })`).

**Luồng trạng thái** (`src/store.js`): component không gọi thẳng nhau.

    component --store.dispatch(intent)--> store.handle trong app.js --> đổi state --> store.emit(EVENTS.*) --> các view vẽ lại

`state` là object thường; `app.js` gán trực tiếp rồi tự emit sự kiện tương ứng. Một intent chỉ có một handler.

**Hoàn tác** dựa trên ảnh chụp: mỗi bước lưu tham chiếu tới `boxes`, `marks`, `settings`, `pdfBytes`, và `changedSince` so sánh bằng `!==`. Vì vậy phải thay các trường này bằng object mới (bất biến), không sửa tại chỗ; sửa tại chỗ thì thay đổi không vào lịch sử.

**Lệnh** (xem sơ đồ ở `docs/ribbon-ui.md` mục 5.1): ribbon, thanh truy cập nhanh, Backstage, KeyTips, Ctrl+K, menu chuột phải và phím tắt đều đi qua `commandInfo(id)`. Id dạng `tool:*` đi tới `setTool`, còn lại đi tới `runAction` và bảng `ACTIONS` trong `app.js`. Thêm một lệnh gồm: thêm mục vào `ACTIONS`, rồi đặt nó vào bố cục `RIBBON_TABS` (`src/ribbon.js`). Lệnh có trong ribbon mà thiếu trong `ACTIONS` sẽ bị ẩn, chỉ có một dòng `console.info` báo.

**Tọa độ** (`src/geometry.js`): mục chỉnh sửa (`model.js`, `marks.js`) lưu theo không gian hiển thị, đơn vị point ở tỉ lệ 1, gốc trên-trái, đã tính cả xoay trang. PDF gốc dùng gốc dưới-trái và chưa xoay. Chỉ đổi giữa hai hệ qua `geometry.js`.

**Xuất PDF:** chỉnh sửa nằm trong state như một lớp phủ, tới `exportPdf` (`src/export.js`) mới được ghi vào PDF bằng pdf-lib. Riêng thao tác trang thì khác: các hàm trong `src/pdfops.js` nhận bytes và trả về bytes mới, rồi `applyBytes` trong `app.js` thay `state.pdfBytes` thành một bước hoàn tác và đánh lại chỉ số trang cho mọi mục gắn với trang.

**Viết module để test được:** không chạm DOM khi import, chỉ dùng DOM bên trong hàm, nhờ đó test Node import thẳng được từ `../src/*.js` mà không cần giả lập DOM. Test không phủ phần chạy với pdf-lib/pdf.js và phần giao diện, nên thay đổi ở đó phải kiểm tra trên trình duyệt.

**Giao diện:** `index.html` chứa bố cục và CSS gốc; mỗi tính năng lớn có một tệp `.css` riêng, liên kết trong `index.html`. Hộp thoại dựng bằng các hàm trong `src/dom.js` (`el`, `field`, `openDialog`...). Chữ hiển thị và thông báo lỗi viết bằng tiếng Việt, comment trong code viết bằng tiếng Anh.

**Mạng:** tài liệu không bao giờ rời khỏi máy. Các kết nối ra ngoài chỉ gồm CDN thư viện/font và API tài khoản VET VIRAL (`src/account.js`), và API này chỉ nhận token ứng dụng cùng tên trình duyệt.

**Tài liệu thiết kế:** `WALKTHROUGH.md` (luồng xử lý, rủi ro), `docs/ribbon-ui.md`, `docs/office-apps.md`, `docs/ocr-vietnamese.md`. `src/apps/calc-engine.js` thuộc giai đoạn ứng dụng văn phòng và chưa được nối vào app.

# Hướng Dẫn & Quy Chuẩn Dự Án (Project Rules & Guidelines)

Dự án: **PDF Editor OSS** - Trình chỉnh sửa và chuyển đổi tài liệu PDF mã nguồn mở chạy hoàn toàn trên trình duyệt (Client-side SPA).

## 1. Nguyên Tắc Chung (General Principles)
- **Ưu tiên khả năng đọc**: Mã nguồn rõ ràng, tường minh, dễ hiểu, tránh các giải pháp quá phức tạp hoặc "hacky".
- **Thay đổi tối thiểu**: Tập trung vào nhiệm vụ được giao, không tự ý refactor các phần mã không liên quan.
- **Bảo mật & Quyền riêng tư**: 100% xử lý tại trình duyệt của người dùng (Client-side), không truyền dữ liệu tài liệu ra bên ngoài.

## 2. Tiêu Chuẩn Đa Nền Tảng (Cross-Platform Standards)
- **Không sử dụng đường dẫn tuyệt đối**: Không hardcode `C:\...` trong code logic. Sử dụng đường dẫn tương đối.
- **Xử lý đường dẫn an toàn**: Khi làm việc với Node.js, sử dụng `path.join()` hoặc URL module chuẩn.

## 3. Quy Chuẩn Thiết Kế Giao Diện (UI/UX Rules)
- **White Theme chủ đạo**: Giao diện mang tính thẩm mỹ cao, hiện đại, tinh tế (theo phong cách Apple/Linear), sử dụng nền trắng (`#ffffff`), xám nhạt (`#f8fafc`, `#f4f4f5`), bo góc mềm mại 8-12px và border 1px tinh xảo (`#e4e4e7`).
- **Luôn tạo Mockup**: Khi lập kế hoạch tính năng UI mới, phải phác thảo bản vẽ trực quan chi tiết (bố cục, mã màu, phần tử tương tác, dữ liệu mẫu).

## 4. Kiến Trúc & Phát Triển (Architecture & Dev)
- **Vẽ Workflow Diagram**: Luôn vẽ sơ đồ luồng dữ liệu (Mermaid) trước khi triển khai các logic nghiệp vụ phức tạp.
- **Unit Test**: Viết unit test cho các module logic quan trọng (mô hình dữ liệu, thuật toán tách bảng, chuyển đổi file).
- **Thư viện Lazy-load**: Các thư viện nặng (SheetJS, Tesseract, QPDF, JSZip, Docx) chỉ tải khi người dùng kích hoạt tính năng tương ứng.

## 5. Quy Trình Làm Việc & Kiểm Thử (Workflow)
- **Cảnh báo rủi ro**: Cảnh báo trước các nguy cơ về hiệu năng (tràn RAM khi xuất ảnh 300 DPI, font tiếng Việt, PDF scan).
- **Review 2 lần**: Kiểm tra kỹ lưỡng 2 lần trước khi hoàn tất mỗi task.
- **Git Commit**: Commit Git sau mỗi task hoàn thành và cập nhật [`WALKTHROUGH.md`](WALKTHROUGH.md).
