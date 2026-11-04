# LifeKeep - Trợ lý Bảo Dưỡng & Giấy Tờ Đời Sống (PWA Mobile App)

Ứng dụng web tiến bộ (PWA) hỗ trợ người dùng theo dõi hạn giấy tờ cá nhân, đăng kiểm xe, bảo dưỡng thiết bị gia đình (điều hòa, máy lọc nước) và đồ công nghệ.

---

## 🚀 Cách khởi động & Sử dụng

### 1. Trên máy tính:
- Bấm đúp vào file `start.bat` để bật server (hoặc chạy lệnh: `powershell -ExecutionPolicy Bypass -File server.ps1`).
- Bấm đúp file `open_in_browser.bat` hoặc truy cập: [http://localhost:8080](http://localhost:8080).

### 2. Trên điện thoại (iPhone & Android):
> **Điều kiện:** Điện thoại kết nối chung mạng Wi-Fi với máy tính.

- Mở trình duyệt trên điện thoại (Safari trên iPhone, Chrome trên Android).
- Truy cập địa chỉ: **`http://192.168.0.123:8080`** (hoặc bấm vào icon điện thoại ở góc trên app để quét mã QR).

#### Cài đặt thành App độc lập trên màn hình chính:
* **iPhone (Safari):**
  1. Bấm vào nút **Chia sẻ** (Biểu tượng ô vuông có mũi tên trỏ lên ở thanh dưới cùng).
  2. Cuộn xuống và chọn **"Thêm vào Màn hình chính"** (*Add to Home Screen*).
  3. Bấm **Thêm** ở góc trên bên phải. Biểu tượng **LifeKeep** sẽ xuất hiện trên màn hình iPhone như một app tải từ App Store.
* **Android (Chrome):**
  1. Bấm vào biểu tượng **3 chấm** ở góc trên bên phải trình duyệt.
  2. Chọn **"Cài đặt ứng dụng"** (*Install app*) hoặc **"Thêm vào Màn hình chính"**.

---

## 🌟 Các tính năng chính

1. **Quản lý 4 danh mục cốt lõi:**
   - 🚗 **Phương tiện:** Đăng kiểm ô tô, Bảo hiểm TNDS, Bảo hiểm thân vỏ, Thay nhớt máy, Thay lốp.
   - 🏠 **Gia dụng & Nhà:** Vệ sinh máy lạnh/điều hòa, Thay lõi lọc nước 1-2-3, Hợp đồng thuê nhà.
   - 🪪 **Giấy tờ cá nhân:** CCCD, Bằng lái xe, Hộ chiếu, Thẻ bảo hiểm sức khỏe.
   - 💻 **Đồ công nghệ:** Bảo hành máy tính, điện thoại, thiết bị điện tử.

2. **Mẫu thông dụng 1-Chạm (Preset Templates):**
   - Tự động điền chu kỳ chuẩn (ví dụ Đăng kiểm 12 tháng, Thay nhớt 6 tháng, Lõi lọc nước 3-6 tháng, Ghi chú giấy tờ cần mang).

3. **Chụp & Đính kèm ảnh giấy tờ:**
   - Hỗ trợ mở camera điện thoại chụp trực tiếp cà vẹt xe, sổ đăng kiểm, hóa đơn bảo hành.
   - Ảnh được tối ưu hóa nén và lưu cục bộ an toàn.

4. **Tính toán thời gian & Mức độ khẩn cấp tự động:**
   - 🚨 **Đỏ:** Quá hạn hoặc khẩn cấp (còn dưới 7 ngày).
   - ⏳ **Vàng/Cam:** Sắp đến hạn (còn dưới 30 ngày).
   - ✅ **Xanh:** An toàn (trên 30 ngày).

5. **Nhật ký bảo dưỡng & Tự động gia hạn chu kỳ tiếp theo:**
   - Sau khi làm xong (ví dụ vừa đi thay nhớt hoặc vệ sinh máy lạnh), bấm nút **"Đã xong"**.
   - Nhập số tiền đã chi + ghi chú thợ/gara.
   - Ứng dụng tự động lưu vào lịch sử chi phí và **nhảy ngày đến hạn tiếp theo** dựa theo chu kỳ (ví dụ +6 tháng) mà không cần tính toán bằng tay.

6. **Thống kê chi phí:**
   - Tổng hợp tổng số tiền bảo dưỡng, bảo trì đã chi trong năm.

7. **Bảo mật tuyệt đối (Offline-first):**
   - Toàn bộ dữ liệu và hình ảnh lưu trữ trong cơ sở dữ liệu `IndexedDB` của trình duyệt trên chính máy bạn.
   - Không tải lên bất kỳ máy chủ đám mây nào bên ngoài.
   - Có tính năng **Xuất file sao lưu (JSON)** và **Khôi phục** để dễ dàng chuyển sang điện thoại khác.
