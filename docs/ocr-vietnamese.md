# OCR tiếng Việt: cấu hình và kết quả đo

## Thay đổi

| Hạng mục | Trước | Sau |
|---|---|---|
| Ngôn ngữ mặc định | Tiếng Việt + Tiếng Anh | **Tiếng Việt** (song ngữ vẫn chọn được) |
| Nhị phân hóa ảnh | Otsu toàn cục (mặc định của Tesseract) | **Sauvola** thích ứng theo vùng (`thresholding_method=2`) |
| Độ phân giải | scale 2,5 (≈ 180 DPI) | **300 DPI**, giới hạn 24 MP/trang (A3 trở lên tự giảm) |
| Tham số | — | `user_defined_dpi`, `preserve_interword_spaces=1` |
| Chuẩn hóa chữ | — | NFC (Unicode dựng sẵn), Ð/ð/Ɖ → Đ/đ, bỏ ký tự ẩn và dấu lạc (`src/vntext.js`) |
| Thư viện | tesseract.js 6.0.1 | tesseract.js 7.0.0 (nhanh hơn 15–35% theo nhà phát triển) |
| Bộ nhớ | canvas giữ đến khi GC | giải phóng canvas ngay sau mỗi trang |

## Cách đo

6 ảnh quét giả lập từ cùng một văn bản hành chính tiếng Việt (12 đoạn, đủ 6 thanh, các vần khó: *khuỷu, nguệch ngoạc, thuở, ngoằn ngoèo*): Times New Roman và Arial 8–12 pt, quét 150–300 DPI, nghiêng 0,3–1,2°, nhiễu, ánh sáng không đều, nén JPEG 40–85. Chạy tesseract.js 7.0.0, mô hình `vie` best_int. CER/WER tính bằng khoảng cách Levenshtein trên chữ đã chuẩn hóa NFC.

| Cấu hình (trung bình 6 ảnh) | CER | CER bỏ dấu | WER |
|---|---|---|---|
| Cũ: vie+eng, 180 DPI, Otsu | 6,01% | 4,89% | 14,75% |
| Chỉ vie, 180 DPI, Otsu | 5,26% | 4,33% | 12,67% |
| vie, 300 DPI, Otsu | 8,11% | 7,25% | 17,00% |
| **Mới: vie, 300 DPI, Sauvola** | **1,36%** | **0,35%** | **5,83%** |

Riêng 2 ảnh khó (8–9 pt, tối và không đều): 15,0% → 3,3% CER. Ảnh sạch: không kém đi đáng kể (0,37% → 0,42%).

Đã thử và **không** dùng: kéo giãn tương phản toàn cục (làm hỏng vùng tối, CER 52%), 400 DPI (không tốt hơn), hệ số Sauvola k=0,2 (CER 18,8%), mô hình float `tessdata_best` (không chạy được trên bản WebAssembly của tesseract.js 7).

## Giới hạn còn lại

Sai số còn lại chủ yếu là **nhầm dấu** (ĐỒNG → ĐÔNG, Thủy → Thùy, Bến → Bền): CER bỏ dấu chỉ 0,35%. Sửa được phần này cần từ điển hoặc mô hình ngôn ngữ tiếng Việt, chưa làm.

Chữ OCR được ghi thành lớp chữ ẩn khi xuất PDF. Để giữ dấu trong lớp này (và trong Word/TXT xuất từ đó), tài liệu cần font Unicode: chọn ở Tệp › Chọn font, hoặc dùng cơ chế tự tải font khi xuất.
