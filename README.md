# PDF Editor

Trình chỉnh sửa PDF chạy hoàn toàn trong trình duyệt. Tệp của bạn không rời khỏi máy: mọi xử lý (hiển thị, chỉnh sửa, OCR, mã hóa) diễn ra tại chỗ.

**Dùng thử:** <https://hahuuhung.github.io/pdf-editor-oss/>

## Tính năng

Các chức năng được gom theo **ribbon** (kiểu Office): mỗi tab một lĩnh vực, trong tab chia nhóm có nhãn.

| Tab ribbon | Có gì |
|---|---|
| Trang đầu, Xem | Các lệnh hay dùng; phóng to/thu nhỏ, vừa trang, tìm kiếm văn bản (Ctrl+F), mục lục (bookmark) bấm để nhảy trang, in |
| Chú thích | Ghi chú, tô sáng, gạch chân/ngang/sóng, hình chữ nhật, elip, đường, mũi tên, vẽ tự do, con dấu |
| Chỉnh sửa | Thêm chữ, chèn ảnh, liên kết, hình mờ, đầu/chân trang và số Bates, thuộc tính tài liệu |
| Trang | Kéo thả hình thu nhỏ để sắp xếp (chọn nhiều trang bằng Ctrl/Shift), nút xoay/xóa nhanh trên từng trang, chèn trang trắng, nhân bản, trích xuất, tách PDF (mỗi trang, mỗi N trang, theo dãy), gộp nhiều PDF và đổi thứ tự, cắt lề (cố định hoặc tự động theo nội dung), đánh số trang (số bắt đầu, bỏ trang bìa), xuất PNG |
| Ký & điền | Chữ ký vẽ tay, dấu tích/chéo/chấm, ngày, điền biểu mẫu có sẵn |
| Chuyển đổi | OCR tiếng Việt chuẩn (xem [docs/ocr-vietnamese.md](docs/ocr-vietnamese.md)) và tiếng Anh, xuất Word/Excel/TXT/HTML/ảnh, tạo PDF từ Word (giữ tiêu đề, danh sách, bảng), Excel (mọi sheet, bảng rộng xoay ngang) và ảnh, tách ảnh (.zip), giảm dung lượng |
| Bảo vệ | Che thông tin thật (xóa nội dung bên dưới), đặt mật khẩu AES-256, mở tệp có mật khẩu, gỡ mật khẩu, xóa thông tin ẩn |

Thêm: màn hình khởi động với **Công cụ nhanh** (gộp, tách, nén, chuyển đổi, ký, bảo vệ chỉ một cú bấm; cũng có ở Tệp › Công cụ nhanh), hoàn tác/làm lại cho mọi thao tác, bảng lệnh Ctrl+K, chủ đề sáng/tối, kéo thả tệp vào cửa sổ.

Thao tác nhanh với ribbon:

- **Thanh truy cập nhanh** ở thanh tiêu đề (Mở, Xuất, In, Hoàn tác, Làm lại). Bấm ▾ để chọn lệnh, hoặc chuột phải lên bất kỳ nút ribbon nào › Thêm vào thanh truy cập nhanh.
- **Phím truy cập (KeyTips)**: nhấn rồi thả Alt (Mac: ⌥), chữ cái hiện trên tab và nút; gõ chữ cái để chạy lệnh, Esc để lùi.
- **Tệp** mở trang Backstage: mở/tạo/xuất, tạo PDF từ ảnh/Word/Excel, chủ đề, kiểu ribbon, tài khoản.
- Kiểu ribbon: đầy đủ, gọn (một hàng) hoặc chỉ hiện tab; Ctrl+F1 (Mac: ⌥⌘R) hoặc nhấp đúp tên tab để thu gọn.
- **Menu chuột phải** (nhấn giữ trên Android) trên trang, ảnh thu nhỏ và nút ribbon.
- Thanh trạng thái: chuyển trang, mức thu phóng, nút ẩn/hiện ảnh thu nhỏ và bảng bên.

Đa nền tảng: Windows, macOS, Linux, ChromeOS, iPad/iPhone, Android. Phím tắt hiển thị đúng hệ điều hành (⌘ trên Mac/iPad). Trên máy tính bảng và điện thoại, ribbon thành một hàng biểu tượng cuộn ngang, ảnh thu nhỏ và bảng bên thành ngăn kéo; nút đủ lớn cho cảm ứng; chừa vùng tai thỏ/thanh home của iPhone. Có chế độ tương phản cao của Windows và giảm chuyển động.

Di chuyển và căn chỉnh:

- Cuộn trang bằng cách giữ Space rồi kéo, kéo chuột giữa, công cụ Bàn tay (phím H), hoặc vuốt một ngón trên màn hình cảm ứng.
- Phóng to tại vị trí con trỏ bằng Ctrl+lăn chuột, chụm hai ngón trên touchpad hoặc màn hình cảm ứng.
- Khi kéo chú thích hay khung chữ, mục tự bắt dính vào mép và tâm trang, lề khối chữ của trang và các mục khác, kèm đường gióng màu xanh. Giữ Ctrl khi kéo để tắt.
- Trang chỉ được vẽ khi gần vùng nhìn thấy và được giải phóng khi cuộn xa, nên tài liệu dài vẫn nhẹ RAM.

Chữ tiếng Việt khi xuất PDF (hộp chữ, con dấu, đầu/chân trang, hình mờ, chữ OCR, Word/Excel → PDF): nếu chưa chọn font, trình soạn tự tải font DejaVu Sans (khoảng 740 KB, một lần mỗi phiên) và chỉ nhúng các chữ cần dùng. Chỉ font được tải về, tài liệu không gửi đi đâu. Muốn dùng font khác: Tệp › Chọn font (.ttf), ví dụ `C:\Windows\Fonts\arial.ttf`.

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
- `src/ribbon.js` (bố cục ribbon, KeyTips, phím tắt theo nền tảng; có test), `src/ribbonbar.js` (dựng thanh tiêu đề, ribbon, Backstage, thanh trạng thái, menu chuột phải, ngăn kéo), `src/ribbon.css`. Thiết kế: [docs/ribbon-ui.md](docs/ribbon-ui.md).
- `src/app.js`: điều phối giao diện, lịch sử hoàn tác, hộp thoại.
- `src/model.js`, `src/marks.js`: mô hình chữ và chú thích.
- `src/export.js`: ghi mọi chỉnh sửa vào PDF (pdf-lib), kể cả trang đã xoay.
- `src/pdfops.js`, `src/pages.js`: thao tác trang.
- `src/ocr.js`, `src/protect.js`, `src/extract.js`, `src/redact.js`: OCR, mã hóa, tách nội dung, che thông tin.
- `src/geometry.js`, `src/docsettings.js`, `src/search.js`, `src/textlayout.js`: các hàm thuần, có test.
- `src/quicktools.js`: các thẻ Công cụ nhanh. `src/crop.js` (cắt lề), `src/snap.js` (bắt dính), `src/fonts.js` (font Unicode khi cần): hàm thuần, có test. Thiết kế và luồng xử lý: [WALKTHROUGH.md](WALKTHROUGH.md).
- `src/store.js`: kho trạng thái tập trung (sự kiện, intent, lịch sử hoàn tác). Các thành phần nghe sự kiện và gửi intent, không gọi thẳng nhau.
- `src/components/thumbnail-sidebar.js` (`<pdf-thumbnail-sidebar>`): danh sách trang, chọn nhiều, kéo thả, xoay/xóa nhanh. Logic chọn trang trong `src/pageselect.js`.
- `src/components/canvas-view.js` (`<pdf-canvas-view>`): vùng trang, vẽ trang lười, cuộn bằng tay, thu phóng bằng cử chỉ, đường gióng. Bắt dính dùng `src/snap.js`.

Thư viện bên thứ ba và ghi nguồn: xem [THIRD_PARTY.md](THIRD_PARTY.md).
