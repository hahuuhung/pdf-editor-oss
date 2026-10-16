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
- **Git Commit**: Commit Git sau mỗi task hoàn thành và cập nhật walkthrough tài liệu.
