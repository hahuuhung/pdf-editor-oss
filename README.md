# PDF Editor

Trình chỉnh sửa PDF chạy hoàn toàn trong trình duyệt. Tệp của bạn không rời khỏi máy: mọi xử lý (hiển thị, chỉnh sửa, OCR, mã hóa) diễn ra tại chỗ.

**Dùng thử:** <https://hahuuhung.github.io/pdf-editor-oss/>

## Tính năng

| Chế độ | Có gì |
|---|---|
| Đọc | Phóng to/thu nhỏ, vừa trang, tìm kiếm văn bản (Ctrl+F), in |
| Chú thích | Ghi chú, tô sáng, gạch chân/ngang/sóng, hình chữ nhật, elip, đường, mũi tên, vẽ tự do, con dấu |
| Chỉnh sửa | Thêm chữ, chèn ảnh, liên kết, hình mờ, đầu/chân trang và số Bates, thuộc tính tài liệu |
| Trang | Kéo thả hình thu nhỏ để sắp xếp (chọn nhiều trang bằng Ctrl/Shift), nút xoay/xóa nhanh trên từng trang, chèn trang trắng, nhân bản, trích xuất, kết hợp nhiều PDF, xuất PNG |
| Ký & điền | Chữ ký vẽ tay, dấu tích/chéo/chấm, ngày, điền biểu mẫu có sẵn |
| Chuyển đổi | OCR tiếng Việt và tiếng Anh, xuất Word/TXT/HTML, tách ảnh (.zip), giảm dung lượng |
| Bảo vệ | Che thông tin thật (xóa nội dung bên dưới), đặt mật khẩu AES-256, mở tệp có mật khẩu, xóa thông tin ẩn |

Thêm: hoàn tác/làm lại cho mọi thao tác, bảng lệnh Ctrl+K, chủ đề sáng/tối, kéo thả tệp vào cửa sổ.

Di chuyển và căn chỉnh:

- Cuộn trang bằng cách giữ Space rồi kéo, kéo chuột giữa, công cụ Bàn tay (phím H), hoặc vuốt một ngón trên màn hình cảm ứng.
- Phóng to tại vị trí con trỏ bằng Ctrl+lăn chuột, chụm hai ngón trên touchpad hoặc màn hình cảm ứng.
- Khi kéo chú thích hay khung chữ, mục tự bắt dính vào mép và tâm trang, lề khối chữ của trang và các mục khác, kèm đường gióng màu xanh. Giữ Ctrl khi kéo để tắt.
- Trang chỉ được vẽ khi gần vùng nhìn thấy và được giải phóng khi cuộn xa, nên tài liệu dài vẫn nhẹ RAM.

Chữ tiếng Việt khi xuất PDF cần một font `.ttf` hỗ trợ tiếng Việt (Tệp › Chọn font), ví dụ `C:\Windows\Fonts\arial.ttf`.

## Tài khoản VET VIRAL

Đăng nhập không bắt buộc: mọi tính năng chỉnh sửa vẫn dùng được khi chưa đăng nhập. Đăng nhập bằng tài khoản [VET VIRAL](https://vetviral.com) để xem tài khoản (tên, gói, số điểm) và nhận thông báo tính năng mới, khuyến mãi trong tab **Tin**.

- Cách đăng nhập: bấm **Đăng nhập** ở góc trên bên phải, mở vetviral.com, đăng nhập rồi bấm **Cho phép** khi thấy đúng mã đang hiện trong PDF Editor.
- PDF Editor không nhận mật khẩu hay phiên web của VET VIRAL. Nó giữ một token ứng dụng riêng trong trình duyệt, token này chỉ đọc được tài khoản và thông báo; không dùng điểm, không thanh toán.
- Tài liệu PDF không bao giờ được gửi đi. Gửi lên VET VIRAL chỉ có tên trình duyệt chung (ví dụ "Chrome trên Windows") để bạn nhận ra kết nối.
- Thu hồi bất cứ lúc nào: trong PDF Editor (**Đăng xuất**) hoặc trên vetviral.com (Cài đặt › Bảo mật › Ứng dụng đã kết nối).

Mã nguồn: `src/account.js`.

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
- `src/store.js`: kho trạng thái tập trung (sự kiện, intent, lịch sử hoàn tác). Các thành phần nghe sự kiện và gửi intent, không gọi thẳng nhau.
- `src/components/thumbnail-sidebar.js` (`<pdf-thumbnail-sidebar>`): danh sách trang, chọn nhiều, kéo thả, xoay/xóa nhanh. Logic chọn trang trong `src/pageselect.js`.
- `src/components/canvas-view.js` (`<pdf-canvas-view>`): vùng trang, vẽ trang lười, cuộn bằng tay, thu phóng bằng cử chỉ, đường gióng. Bắt dính dùng `src/snap.js`.

Thư viện bên thứ ba và ghi nguồn: xem [THIRD_PARTY.md](THIRD_PARTY.md).
