# PDF Editor

Trình chỉnh sửa PDF chạy hoàn toàn trong trình duyệt. Tệp của bạn không rời khỏi máy: mọi xử lý (hiển thị, chỉnh sửa, OCR, mã hóa) diễn ra tại chỗ.

**Dùng thử:** <https://hahuuhung.github.io/pdf-editor-oss/>

## Tính năng

| Chế độ | Có gì |
|---|---|
| Đọc | Phóng to/thu nhỏ, vừa trang, tìm kiếm văn bản (Ctrl+F), in |
| Chú thích | Ghi chú, tô sáng, gạch chân/ngang/sóng, hình chữ nhật, elip, đường, mũi tên, vẽ tự do, con dấu |
| Chỉnh sửa | Thêm chữ, chèn ảnh, liên kết, hình mờ, đầu/chân trang và số Bates, thuộc tính tài liệu |
| Trang | Xoay, di chuyển, chèn trang trắng, nhân bản, xóa, trích xuất, kết hợp nhiều PDF, xuất PNG |
| Ký & điền | Chữ ký vẽ tay, dấu tích/chéo/chấm, ngày, điền biểu mẫu có sẵn |
| Chuyển đổi | OCR tiếng Việt và tiếng Anh, xuất Word/TXT/HTML, tách ảnh (.zip), giảm dung lượng |
| Bảo vệ | Che thông tin thật (xóa nội dung bên dưới), đặt mật khẩu AES-256, mở tệp có mật khẩu, xóa thông tin ẩn |

Thêm: hoàn tác/làm lại cho mọi thao tác, bảng lệnh Ctrl+K, chủ đề sáng/tối, kéo thả tệp vào cửa sổ.

Chữ tiếng Việt khi xuất PDF cần một font `.ttf` hỗ trợ tiếng Việt (Tệp › Chọn font), ví dụ `C:\Windows\Fonts\arial.ttf`.

## Chạy trên máy

Trang dùng ES modules nên cần một máy chủ HTTP, không mở trực tiếp bằng `file://`:

```bash
python -m http.server 8000
```

Rồi mở <http://localhost:8000>.

## Kiểm thử

```bash
node --test tests/
```

## Cấu trúc

- `index.html`: giao diện và CSS.
- `src/app.js`: điều phối giao diện, lịch sử hoàn tác, hộp thoại.
- `src/model.js`, `src/marks.js`: mô hình chữ và chú thích.
- `src/export.js`: ghi mọi chỉnh sửa vào PDF (pdf-lib), kể cả trang đã xoay.
- `src/pdfops.js`, `src/pages.js`: thao tác trang.
- `src/ocr.js`, `src/protect.js`, `src/extract.js`, `src/redact.js`: OCR, mã hóa, tách nội dung, che thông tin.
- `src/geometry.js`, `src/docsettings.js`, `src/search.js`, `src/textlayout.js`: các hàm thuần, có test.

Thư viện bên thứ ba và ghi nguồn: xem [THIRD_PARTY.md](THIRD_PARTY.md).
