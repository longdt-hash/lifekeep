# BẢN MÔ TẢ NGỮ CẢNH DỰ ÁN LIFEKEEP (PROJECT CONTEXT)
> **Dành cho Trợ lý AI và Lập trình viên để tiếp tục phát triển dự án trên máy tính mới mà không bị gián đoạn.**

---

## 1. TỔNG QUAN DỰ ÁN (PROJECT OVERVIEW)
* **Tên ứng dụng:** LifeKeep - Trợ lý nhắc việc & tài chính, cá nhân
* **Khẩu hiệu:** Trợ lý nhắc việc & tài chính, cá nhân
* **Phong cách Thiết kế (UI/UX):** Royal Purple & Light Modern Neobank / iOS Fintech Theme (theo phong cách ngân hàng số cao cấp: Hero Header tím hoàng gia gradient, thẻ nổi bo góc tròn lớn mềm mại, thân nền xám nhạt `#f8fafc` siêu nét, thanh điều hướng đáy dạng Dock nổi viên thuốc).
* **Định dạng:** Progressive Web App (PWA) cài đặt trực tiếp lên iPhone/Android, chạy offline 100%, bảo mật dữ liệu trên máy người dùng (IndexedDB).
* **Công nghệ sử dụng:**
  * HTML5 + Tailwind CSS (qua CDN)
  * Vanilla JavaScript ES6+ (Module Controller pattern)
  * Chart.js (Biểu đồ Cột kép và Biểu đồ Tròn)
  * IndexedDB API (StorageManager v3)
  * Native Calendar (.ics format) tích hợp Apple Calendar / Google Calendar
  * Web Server: PowerShell dual-stack TCP server (`server.ps1`), không phụ thuộc Node.js hay Python.
  * Đường truyền Online: Cloudflare Tunnel (`cloudflared.exe`) cấp link HTTPS toàn cầu cho điện thoại 4G/5G.

---

## 2. CÁC TÍNH NĂNG ĐÃ HOÀN THÀNH (COMPLETED FEATURES)

### A. Quản lý Bảo dưỡng, Giấy tờ & Nhắc việc (Trang chủ)
1. **Theo dõi đa danh mục:**
   * 🚗 Phương tiện (Xe ô tô, xe máy)
   * 🏠 Gia dụng & Nhà cửa (Máy lạnh, lõi lọc nước, hợp đồng thuê...)
   * 🪪 Giấy tờ cá nhân (Đăng ký xe, CCCD, Hộ chiếu, Bảo hiểm TNDS, Bảo hiểm sức khỏe...)
   * 💻 Đồ công nghệ (Bảo hành laptop, điện thoại...)
   * 📌 Danh mục Khác
2. **Nút Thêm mới (+) nổi bật căn giữa 100%:**
   * Nằm chính giữa thanh điều hướng 5 tab: `[Trang chủ] [Hướng dẫn] [+] [Tài chính] [Sao lưu]`.
   * Hỗ trợ chọn nhanh các mẫu thông dụng chuẩn Việt Nam (*Đăng kiểm ô tô, Thay nhớt, Vệ sinh máy lạnh...*) với chu kỳ và chi phí gợi ý tự động.
   * **Ngày thông báo mặc định là ngày thực tại** trên điện thoại (`YYYY-MM-DD`).
   * **Thêm giờ thông báo chính xác (`HH:mm`)** và tùy chọn bật báo thức chuông rung điện thoại.
3. **Chi phí & Bóc tách chi phí con (Sub-items Breakdown):**
   * Có mặt đầy đủ trong cả form **Thêm mới** và form **Chỉnh sửa (Edit)**.
   * Cho phép bóc tách chi tiết (ví dụ: *Thay nhớt 650k, Lọc dầu 120k, Công thợ 150k -> Tổng: 920k*).
   * Nút `✏️ Sửa` trực tiếp trên từng thẻ việc để sửa thông tin và chi phí 1 chạm.
4. **Quy trình hoàn thành & Tự động nhảy chu kỳ:**
   * Nút `✓ Đã xong`: ghi nhận bảo dưỡng, lưu biên lai và tự động dời ngày đến hạn lần tới theo chu kỳ (+6 tháng, +12 tháng...).
   * **Nhật ký đã xong (History tab):** Lưu trữ vĩnh viễn mọi lần bảo dưỡng và chi phí trong quá khứ, không bao giờ bị mất dữ liệu.
   * **Khắc phục triệt để lỗi nhân đôi Job & Nhật ký (v25):** Loại bỏ trùng lặp event submit form, bổ sung cờ khóa chống click đúp `_isSavingItem` và `_isSavingComplete`, tách bạch tuyệt đối giữa việc tạo Reminder nhắc việc tương lai và ghi nhận Nhật ký hoàn thành trong quá khứ, tích hợp hàm `cleanupDuplicates()` tự động dọn sạch các bản ghi trùng lặp cũ khi khởi động.
5. **Hệ thống Thông báo, Nhạc chuông & Rung màn hình điện thoại (Phone Alarm & Notifications - v25):**
   * **Tự động nhận diện chuông mặc định của thiết bị (Zero-Download):** Loại bỏ hoàn toàn cửa sổ bật lên tải file `.ics` gây phiền phức. Khi người dùng bấm quả chuông `🔔` hoặc tạo nhắc việc mới, ứng dụng tự động kết nối với hệ thống thông báo gốc của máy (Android / iOS PWA) để **sử dụng trực tiếp nhạc chuông thông báo và chế độ rung mà người dùng đang cài sẵn trên điện thoại**.
   * **Bật/Tắt chuông 1 chạm trên từng thẻ việc:** Bấm quả chuông `🔔` để kích hoạt thông báo (hiển thị chuông vàng tím `🔔`), bấm lại để tắt (`🔕`), kèm phản hồi rung và chuông thử nghiệm tức thì.
   * **Âm thanh & Rung PWA trong app:** Tích hợp bộ rung điện thoại vật lý (`navigator.vibrate`) + Web/Service Worker Notification với logo nhận diện và chế độ `requireInteraction: true`.
   * **Mở khóa âm thanh (AudioContext Pre-warming):** Tự động kích hoạt bộ âm thanh ngay từ cú chạm đầu tiên trên màn hình điện thoại, đảm bảo chuông báo thức luôn phát to, rõ ràng kể cả khi chạy ngầm hoặc từ `setInterval`.
   * **Cơ chế báo giờ thông minh không phụ thuộc phút trùng khớp:** So sánh chính xác thời gian thực tế (`currentMinutes >= targetMinutes` trong ngày đến hạn hoặc khi quá hạn), khắc phục triệt để lỗi bị mất thông báo khi điện thoại tắt màn hình hoặc mở app sau giờ hẹn.
   * **Tự động đánh thức khi mở khóa màn hình:** Tích hợp bộ lắng nghe `visibilitychange` & `focus` để rà soát và reo chuông báo thức tức thì ngay khi người dùng bật sáng màn hình hoặc quay lại ứng dụng.
   * **Biểu ngữ cảnh báo trực quan trong ứng dụng (In-App Alarm Banner):** Bổ sung banner nổi bật rung lắc và chuông cảnh báo trực tiếp trên màn hình app phòng trường hợp thiết bị tắt quyền thông báo ngoài hệ điều hành.
   * **Bộ kiểm tra thời gian thực (Heartbeat):** Tự động rà soát ngay khi khởi động và mỗi 30 giây để rung chuông và thông báo.
6. **Quản lý Hình ảnh Giấy tờ & Biên lai Bảo dưỡng (Photo Lightbox & Dual Picker):**
   * **Hai tùy chọn chụp ảnh linh hoạt:** Tách biệt rõ ràng giữa nút `📷 Chụp ảnh` (mở thẳng camera sau điện thoại) và `📁 Chọn từ máy` (chọn ảnh có sẵn từ bộ sưu tập hoặc tệp tin trên máy) cho cả mục nhắc việc và nhật ký bảo dưỡng.
   * **Trình xem ảnh toàn màn hình Lightbox có Thu phóng & Kéo rê (`#photo-viewer-modal`):** Khắc phục triệt để lỗi không mở được hoặc không zoom được ảnh. Hỗ trợ:
     * **Cử chỉ 2 ngón tay thu phóng (Pinch-to-zoom)** mượt mà trên điện thoại và tablet.
     * **Cuộn chuột (Mouse wheel)** để phóng to/thu nhỏ trên máy tính.
     * **Chạm đúp (Double tap / Double click)** để phóng to nhanh 220% hoặc thu về 100%.
     * **Kéo rê di chuyển (Pan / Drag)** tự do khi đang phóng to để soi rõ từng chi tiết nhỏ nhất trên hóa đơn và giấy tờ.
     * Bộ nút điều khiển `[−]`, `[100%]`, `[+]`, `[Tải về]` và `[✕]` sắc nét ở thanh tiêu đề.

---

### B. Quản lý Tài chính, Thu nhập & Chi tiêu hàng ngày (Tab Tài chính)
1. **Biểu tượng đồng tiền tròn (`🪙`) ở thanh menu dưới cùng.**
2. **Ghi nhận Thu / Chi tức thì (Nút `+ Ghi thu/chi`):**
   * **Thu nhập:** Lương, Thưởng, Bán hàng, Tiền lãi, Khác...
   * **Chi tiêu hàng ngày:** Ăn uống, Đi chợ/Siêu thị, Hóa đơn điện nước, Xăng xe, Mua sắm, Giải trí, Sức khỏe...
   * **Đóng modal tức thì & Chống bấm lưu 2 lần:** Khi bấm `Lưu giao dịch`, cửa sổ nhập liệu đóng ngay lập tức, nút được khóa chống click trùng lặp, đồng thời tự động cập nhật số liệu và hiển thị thông báo `💰 Đã lưu chi tiêu thành công!`.
3. **Tùy chỉnh Danh mục Thu / Chi cá nhân:**
   * Người dùng có thể tự do thêm danh mục Thu nhập hoặc Chi tiêu mới với Tên và Icon/Emoji tùy ý.
   * Danh mục được lưu trữ trong IndexedDB và tự động đồng bộ vào dropdown giao dịch, biểu đồ cơ cấu chi tiêu.
4. **Hạn mức Chi tiêu / Ngân sách tháng (Monthly Budgeting):**
   * Cho phép thiết lập số tiền ngân sách tối đa muốn chi trong tháng (kèm nút chọn nhanh 5tr, 10tr, 15tr, 20tr, 30tr hoặc tùy chỉnh).
   * Thẻ tiến trình ngân sách trực quan: hiển thị Hạn mức, Đã chi (sinh hoạt + bảo dưỡng), Số tiền còn lại hoặc Vượt mức.
   * Thanh tiến trình đổi màu thông minh: Xanh an toàn (< 75%), Vàng cảnh báo (75% - 99%), Đỏ nhấp nháy cảnh báo vượt ngưỡng (>= 100%).
5. **Liên kết tổng thể chi tiêu:**
   * $\text{Tổng Chi tiêu} = \text{Chi tiêu sinh hoạt hàng ngày} + \text{Chi phí bảo dưỡng \& Giấy tờ LifeKeep}$.
   * Thẻ tóm tắt hiển thị rõ ràng: Tổng Thu nhập, Tổng Chi tiêu (kèm bóc tách sinh hoạt vs nhắc việc), Số dư tích lũy và Tỷ lệ tiết kiệm (%).
   * Thanh tiến trình phân bổ tỷ lệ phần trăm giữa Chi tiêu ngày và Chi phí nhắc việc.
6. **Thống kê & Biểu đồ linh hoạt Đa Năm (Tuần, Tháng, Năm, Tùy chọn, Tất cả):**
   * **Hỗ trợ Đa Năm linh hoạt (Dynamic Multi-Year):** Tự động phát hiện tất cả các năm có dữ liệu (2025, 2026...). Cung cấp bộ chọn Năm và Tháng trực tiếp trong cả tab Tài chính và modal Thống kê.
   * **Tự động đồng bộ báo cáo theo ngày giao dịch vừa nhập:** Khi thêm giao dịch ở năm trước (ví dụ: 2025), báo cáo tài chính sẽ tự động điều chỉnh năm và tháng hiển thị theo ngày của giao dịch đó, giúp người dùng thấy ngay số liệu vừa nhập mà không bị ẩn.
   * **Bộ lọc thời gian tùy chọn (Custom Date Range):** Chọn ngày bắt đầu và kết thúc tùy ý; biểu đồ và số liệu tự động tái lập tức thì.
   * **Biểu đồ Cột kép (Chart.js):** So sánh Thu nhập (xanh) vs Chi tiêu (đỏ) theo ngày, tuần, tháng hoặc so sánh tổng kết giữa các năm.
   * **Biểu đồ Tròn (Chart.js):** Cơ cấu chi tiêu tổng hợp cả sinh hoạt và bảo dưỡng xe/nhà cửa.
7. **Xuất Báo cáo Excel (CSV) chuẩn UTF-8 BOM:**
   * Xuất Bảng kê Thu - Chi (kỳ đang lọc hoặc toàn bộ lịch sử) ra file `.csv` chuẩn UTF-8 BOM không lỗi font tiếng Việt trong Microsoft Excel.
   * Xuất Sổ Nhật ký Bảo dưỡng & Giấy tờ ra file `.csv` có đầy đủ chi phí con và đơn vị thực hiện.
8. **Lịch sử giao dịch đa năng:**
   * Bộ lọc nhanh: `Tất cả` | `🟢 Thu nhập` | `🔴 Chi hàng ngày` | `🔧 Chi nhắc việc`.

---

### C. Cơ sở dữ liệu IndexedDB (`LifeKeepDB` v4)
* `items`: Danh sách mục tài sản, giấy tờ cần theo dõi (`id`, `name`, `category`, `dueDate`, `dueTime`, `notifyPhone`, `cycleMonths`, `cost`, `subItems`, `notes`, `photos`...).
* `logs`: Lịch sử các lần hoàn thành bảo dưỡng & chi phí (`id`, `itemId`, `itemName`, `date`, `totalCost`, `subItems`, `notes`, `photos`...).
* `customTemplates`: Mẫu riêng do người dùng tự lưu (`id`, `name`, `category`, `cycleMonths`, `cost`, `subItems`...).
* `transactions`: Giao dịch thu nhập và chi tiêu hàng ngày (`id`, `type`, `category`, `categoryName`, `amount`, `date`, `notes`...).
* `customCategories`: Danh mục Thu/Chi do người dùng tự tạo (`id`, `type`, `name`, `icon`).
* `settings`: Cài đặt hệ thống, hạn mức ngân sách tháng (`budget_YYYY-MM`, `default_monthly_budget`...).

---

### D. Kiến trúc Giao diện Royal Purple & Light Neobank (v11)
1. **Logo & Bộ nhận diện thương hiệu LifeKeep:**
   * Logo chính thức với nền tím hoàng gia đồng bộ (`#7c3aed`), biểu tượng bàn tay mặt cười trắng nét vẽ tay thân thiện và chữ `LifeKeep` cách điệu.
   * Tích hợp toàn diện: Header Hero, Favicon tab trình duyệt, Icon màn hình chính iOS (`apple-touch-icon`), biểu tượng cài đặt PWA Android/Desktop (`manifest.json`), Modal Cài đặt và Hướng dẫn sử dụng.
2. **Hero Header Tím Hoàng Gia Gradient (`from-purple-700 via-purple-600 to-indigo-800`):**
   * Logo LifeKeep bo góc lớn viền nổi bật thay cho chữ cái L cũ, lời chào thân thiện, huy hiệu PWA, chuông báo, cài đặt.
   * **Bộ chọn Năm Tương Tác Trực Tiếp (Interactive Hero Year Selector):** Huy hiệu `TỔNG CHI TIÊU NĂM YYYY ∨` trên trang chủ có thể chạm/bấm trực tiếp để sổ xuống danh sách các năm có dữ liệu (2025, 2026...). Khi chọn một năm bất kỳ, số dư chi tiêu lớn (`#hero-total-balance`) và thẻ chi phí (`#metric-cost`) lập tức tính toán và hiển thị chính xác toàn bộ số tiền chi tiêu của năm đó.
   * 3 nút hành động nhanh hình tròn viền nổi: `[+ Thu/Chi]` (ghi nhanh giao dịch), `[🎯 Hạn mức]` (quản lý ngân sách tháng), `[🪙 Tài chính]` (mở bảng kê tài chính).

---

### E. Hệ thống Xác thực Tài khoản & Cổng Đăng nhập Bảo mật (Authentication Gate)
1. **Cổng Đăng nhập Toàn Màn hình Neumorphic Màu Tím Đồng Bộ (`#auth-screen`):**
   * Thiết kế mô phỏng 100% hình mẫu tham chiếu: Thẻ nổi mềm mại (Soft Neumorphic Glassmorphism), logo LifeKeep phát sáng ở đỉnh thẻ, hiệu ứng mờ kính hiện đại trên nền tím dịu (`#f8fafc`).
   * **Yêu cầu bảo mật bắt buộc:** Ứng dụng khóa toàn bộ màn hình cho đến khi người dùng đăng nhập tài khoản hoặc đăng nhập qua Gmail thành công.
2. **Đăng nhập & Đăng ký Tài khoản Nội bộ (Vanilla JS + Web Crypto):**
   * Chuyển đổi mượt mà giữa chế độ **Đăng nhập (Sign In)** và **Đăng ký tài khoản (Sign Up)**.
   * Ô nhập liệu bo tròn lớn dạng viên thuốc, có biểu tượng Người dùng và Ổ khóa trực quan.
   * Nút mắt `👁️` bật/tắt hiển thị mật khẩu tức thì.
   * Mật khẩu được mã hóa an toàn bằng thuật toán SHA-256 (Web Crypto API) trước khi lưu trữ trong `localStorage`.
   * Hỗ trợ tùy chọn **Ghi nhớ đăng nhập (Remember Me)** giúp lưu phiên an toàn qua các lần mở app tiếp theo.
   * Hỗ trợ **Quên mật khẩu?** giúp người dùng đặt lại mật khẩu nhanh chóng theo tài khoản đã đăng ký.
3. **Cửa Sổ Lựa Chọn & Đăng Nhập Tài Khoản Google / Gmail Chuẩn (`loginWithGoogle`):**
   * **Khắc phục triệt để lỗi 401 (invalid_client):** Loại bỏ hoàn toàn việc gọi Google One Tap với client ID giả lập gây cửa sổ lỗi Google OAuth.
   * Khi người dùng bấm **"Tiếp tục với Google / Gmail"**, cửa sổ lựa chọn tài khoản Google (Account Chooser) xuất hiện:
     * Tự động nhận diện tài khoản Gmail đã từng đăng nhập trên thiết bị, hiển thị chính xác tên người dùng tùy chỉnh hoặc lấy theo tên email, không áp đặt tên giả định.
     * Người dùng chỉ cần bấm nút **"Chọn ➔"** là hệ thống lập tức lấy email đó làm tài khoản và đăng nhập thẳng vào ứng dụng.
     * Nếu muốn dùng tài khoản khác hoặc chưa đăng nhập, nút **"Đăng nhập tài khoản khác"** cho phép mở cửa sổ đăng nhập Google chuẩn không qua OAuth client ID lỗi.
4. **Quản lý Hồ sơ & Đăng xuất (Profile & Logout):**
   * Lời chào ở Header tự động cập nhật theo tên hoặc Gmail của tài khoản đang đăng nhập.
   * Thẻ thông tin tài khoản hiển thị chi tiết trong modal **Cài đặt & Tài khoản**, tích hợp nút **🚪 Đăng xuất** để xóa phiên và quay lại màn hình khóa bảo mật.
5. **Đồng Bộ & Cách Ly Dữ Liệu Theo Từng Tài Khoản (Per-Account Isolation & Anti-Resurrection):**
   * Phân tách cơ sở dữ liệu IndexedDB riêng biệt cho từng tài khoản (LifeKeepDB_). Mọi thao tác thêm, sửa, xóa dữ liệu (nhắc việc, thu chi, danh mục, ngân sách) được lưu trữ hoàn toàn độc lập, không bị chồng chéo hay rò rỉ giữa các tài khoản.
   * **Khắc phục triệt để lỗi hồi sinh dữ liệu sau F5:** Thay thế logic kiểm tra items.length === 0 cũ bằng cờ khởi tạo thông minh has_initialized_seed và lifekeep_seeded_. Khi người dùng đã xóa hết các mục nhắc việc, hệ thống tôn trọng tuyệt đối thao tác này và KHÔNG BAO GIỜ tự chèn lại dữ liệu mẫu khi tải lại trang (F5).
   * **Chuyển giao dữ liệu an toàn (Safe Migration):** Khi người dùng Gmail/nội bộ đăng nhập, toàn bộ giao dịch tài chính đã tạo, danh mục và cài đặt được kế thừa đầy đủ, loại bỏ các mục mẫu đã xóa.
   * **Bảo mật khi đăng xuất:** Hàm logout() tự động dọn sạch dữ liệu in-memory, ngắt kết nối DB cá nhân và chuyển về trạng thái khách an toàn.

---

### F. Kiến trúc Giao diện Royal Purple & Light Neobank (v12)
2. **Thẻ Nổi Nổi Bật Đè Lên Header (`#hero-floating-card`):**
   * Nằm ngay dưới Hero Header với biên `-mt-6`, đổ bóng tím mềm (`shadow-xl shadow-purple-950/10`), bo cong 3XL (`rounded-3xl`).
   * Tự động hiển thị mục quan trọng / quá hạn / sắp đến hạn cần xử lý gấp nhất, hoặc thẻ An toàn khi mọi việc đều ổn.
3. **Thân Trang Nền Sáng Tinh Tế (`#f8fafc`):**
   * Các thẻ việc & thẻ KPI đều là thẻ trắng tinh khôi (`bg-white border border-slate-200/90 shadow-xs hover:shadow-md hover:border-purple-300`).
   * Huy hiệu trạng thái và danh mục dùng tone màu pastel trang nhã (Rose, Amber, Emerald, Purple).
4. **Dock Điều Hướng Đáy Dạng Viên Thuốc Nổi (Floating Rounded-Full Pill):**
   * Nằm lơ lửng cách mép đáy `bottom-4`, bo tròn hoàn toàn `rounded-full`, nền trắng mờ kính `bg-white/95 backdrop-blur-md`, viền `border-slate-200/80`, bóng đổ lớn `shadow-2xl shadow-purple-950/15`.
   * Nút trung tâm `+` được nâng cao nổi bật với dải màu tím hoàng gia rực rỡ.
5. **Modal & Biểu đồ Đồng Bộ Light Mode:**
   * Tất cả 13 modal đều được thiết kế trên thẻ trắng, ô nhập liệu nền xám dịu mắt (`bg-slate-50 border-slate-200 focus:bg-white focus:border-purple-600`).
   * Biểu đồ Chart.js tối ưu cho nền sáng: đường lưới mờ mảnh, chữ slate rõ nét, viền doughnut trắng tinh tế.

---

## 3. CẤU TRÚC TỆP TIN (FILE STRUCTURE)
```
lifekeep/
├── index.html           # Toàn bộ giao diện PWA, các modal (item, detail, complete, help, settings, finance, tx, budget, category, export-csv, photo-viewer, note-modal, quick-action-modal, notification-center-modal)
├── app.js               # Logic ứng dụng, StorageManager (IndexedDB v5), định dạng tiền tệ tự động, photo lightbox viewer, bộ điều khiển Thu chi, Nhắc việc & Ghi chú (Notes)
├── manifest.json        # Cấu hình PWA Web App Manifest (standalone, theme colors, icons)
├── logo.png             # Logo chính 512x512 LifeKeep (nền tím hoàng gia, biểu tượng mặt cười)
├── icon-192.png         # Icon PWA 192x192
├── favicon.png          # Favicon tab trình duyệt
├── apple-touch-icon.png # Icon màn hình chính iOS (iPhone/iPad)
├── sw.js                # Service Worker Network-First caching (v28)
├── server.ps1           # Dual-stack TCP Web Server (PowerShell thuần, port 8080)
├── start.bat            # File 1-click khởi chạy local server (http://localhost:8080)
├── start_online.bat     # File 1-click mở đường truyền Cloudflare Tunnel HTTPS ra ngoài Internet (4G/5G)
├── cloudflared.exe      # Binary Cloudflare Tunnel cho Windows (portable)
├── open_in_browser.bat  # Tự động mở trình duyệt đến app
├── README.md            # Hướng dẫn sử dụng cho người dùng
└── CONTEXT.md           # Tệp ngữ cảnh này (dành cho AI / lập trình viên)
```

---

## 4. HƯỚNG DẪN TIẾP TỤC TRÊN MÁY TÍNH MỚI

### Bước 1: Sao chép thư mục sang máy tính mới
1. Tải hoặc giải nén file `lifekeep.zip` vào bất kỳ thư mục nào trên máy mới (ví dụ: `C:\lifekeep` hoặc `D:\Projects\lifekeep`).
2. Nhấp đúp vào `start.bat` để chạy server nội bộ, hoặc `start_online.bat` để mở đường truyền online cho điện thoại.
3. Mở trình duyệt truy cập: `http://localhost:8080`.

### Bước 2: Đồng bộ dữ liệu người dùng (Nếu có dữ liệu cũ cần giữ)
* Trên máy cũ (hoặc trên app điện thoại): Vào tab **Sao lưu** ➜ Bấm **"Xuất file sao lưu (JSON)"**.
* Trên máy mới: Vào tab **Sao lưu** ➜ Bấm **"Phục hồi từ file sao lưu"** ➜ Chọn file JSON vừa xuất. Toàn bộ dữ liệu nhắc việc, chi phí con và các khoản thu chi sẽ được phục hồi 100%.

### Bước 3: Hướng dẫn Trợ lý AI trên máy mới
Khi bạn mở cửa sổ chat với AI trên máy mới, chỉ cần gửi câu lệnh sau:
> *"Tôi đang phát triển dự án LifeKeep. Hãy đọc kỹ file `CONTEXT.md` và mã nguồn trong thư mục này để nắm toàn bộ ngữ cảnh, sau đó hỗ trợ tôi tiếp tục công việc."*
AI sẽ đọc file này và tiếp tục hỗ trợ bạn một cách chính xác mà không cần giải thích lại từ đầu.

---

## 5. CÁC TÍNH NĂNG MỚI NÂNG CẤP (PHIÊN BẢN v26)

1. **Khắc phục Toast Thông báo Treo Quá Lâu:**
   - Hàm `showToast()` được tối ưu: dùng trực tiếp `style.opacity` và `style.transform` kết hợp hẹn giờ tự ẩn sau 2.2 giây (2200ms) mượt mà và biến mất hoàn toàn (`display: none`).
   - Bổ sung sự kiện chạm/bấm trực tiếp vào toast để tắt tức thì (Tap to Dismiss).

2. **Mô-đun Ghi Chú (Notes) Phong Cách Google Keep / Apple Notes:**
   - Nâng cấp IndexedDB lên version 5, bổ sung bảng lưu trữ `notes` với chỉ mục `dueDate` và `updatedAt`.
   - Mỗi ghi chú hỗ trợ: tiêu đề, nội dung nhiều dòng, bảng chọn màu pastel (8 màu thanh nhã), ghim lên đầu (Pin to top).
   - Tích hợp báo thức/nhắc nhở ngày & giờ hẹn cho ghi chú: chuông báo âm điệu vui tươi (Web Audio API), chế độ rung điện thoại (Vibration API), và thông báo hệ thống ra màn hình điện thoại (Web Notification API) hoàn toàn giống như các mục nhắc việc.
   - Thanh chuyển đổi giao diện 3 tab: `[⏳ Việc cần làm] [📜 Đã xong] [📝 Ghi chú]`.

3. **Menu Tác Vụ Nhanh (Quick Action Sheet):**
   - Khi bấm vào nút `+` chính giữa dock đáy màn hình, giao diện mở một Bottom Sheet thanh lịch hiển thị 3 lựa chọn nổi bật:
     1. 📝 **Ghi chú**: Mở ngay trình soạn thảo ghi chú mới với màu sắc và tùy chọn báo thức.
     2. ⏰ **Thêm nhắc việc & Giấy tờ**: Mở form thêm công việc bảo trì, tái ký hạn, giấy tờ.
     3. 💰 **Ghi nhận Thu / Chi**: Mở form nhập giao dịch tài chính nhanh chóng.
   - Thao tác nhanh, trực quan, tối ưu cho trải nghiệm người dùng trên điện thoại di động một tay.

---

## 6. CÁC TÍNH NĂNG MỚI NÂNG CẤP (PHIÊN BẢN v27)

1. **Thay thế Nút Bánh Răng bằng Chuông Thông Báo (Notification Center):**
   - Loại bỏ nút bánh răng cài đặt ở góc phải header vì đã tích hợp mở cửa sổ Cài đặt & Tài khoản khi bấm trực tiếp vào Ảnh đại diện (Avatar) hoặc Tên người dùng bên trái.
   - Thay thế bằng **Nút Chuông Thông Báo (Bell Icon)** có huy hiệu đếm số lượng trực tiếp (Live dynamic badge). Khi có việc quá hạn, huy hiệu nhấp nháy đỏ cảnh báo.

2. **Trung Tâm Thông Báo Dạng Danh Sách Trải Xuống (Notification Dropdown Panel):**
   - Gom toàn bộ thông báo vào một nơi duy nhất: Việc quá hạn (🚨), Việc đến hạn hôm nay (⏰), Việc sắp đến hạn (⏳), và Ghi chú có hẹn giờ báo thức (📝).
   - Tích hợp 4 chip lọc nhanh: `Tất cả` | `🚨 Quá hạn` | `⏰ Hôm nay` | `📝 Ghi chú`.
   - Nút **Thử chuông & Rung** trực tiếp trên thanh tiêu đề trung tâm thông báo để kiểm tra loa và độ rung của thiết bị bất cứ lúc nào.

3. **Điều Hướng Thông Minh Khi Chọn Thông Báo:**
   - Bấm vào một công việc nhắc nhở: Tự động đóng dropdown, chuyển sang tab **Việc cần làm** và mở ngay thẻ chi tiết của công việc đó.
   - Bấm vào một ghi chú hẹn giờ: Tự động đóng dropdown, chuyển sang tab **Ghi chú** và mở ngay hộp thoại chỉnh sửa của ghi chú đó.
   - Hỗ trợ đóng nhanh bằng phím `Escape`, nút `✕`, nút `Đóng` hoặc bấm ra ngoài màn hình mờ.

---

## 7. CÁC TÍNH NĂNG MỚI NÂNG CẤP (PHIÊN BẢN v28)

1. **Thay Đổi 2 Nút Tròn Đầu Trang Thành Ghi Chú & Nhắc Việc:**
   - Nút tròn 1 (`Thu / Chi` cũ) ➜ Chuyển thành **📝 Ghi chú**: Khi bấm vào sẽ tự động kích hoạt tab **Ghi chú**, đồng thời cuộn mượt xuống khu vực ghi chú để người dùng xem và tạo ghi chú ngay lập tức (`app.goToNotesTab()`).
   - Nút tròn 2 (`Hạn mức` cũ) ➜ Chuyển thành **⏰ Nhắc việc**: Khi bấm vào sẽ tự động kích hoạt tab **Việc cần làm**, đồng thời cuộn mượt xuống danh sách công việc để xử lý (`app.goToJobsTab()`).
   - Nút tròn 3 giữ nguyên **💰 Tài chính** màu vàng nổi bật để mở màn hình Quản lý Thu - Chi & Ngân sách.
   - Bố cục 3 nút tròn đầu trang (Ghi chú - Nhắc việc - Tài chính) hiện đồng bộ hoàn hảo với 3 tùy chọn trong Action Sheet ở nút `+` đáy màn hình.

---

## 8. HỖ TRỢ SONG NGỮ TIẾNG VIỆT & TIẾNG ANH (PHIÊN BẢN v29)

1. **Hệ Thống Đa Ngôn Ngữ i18n Chuẩn Hóa:**
   - Từ điển song ngữ `I18N` hoàn chỉnh chứa đầy đủ 2 bộ từ vựng Tiếng Việt (🇻🇳 VI) và Tiếng Anh (🇬🇧 EN).
   - Tự động ghi nhớ lựa chọn ngôn ngữ của người dùng trong `localStorage ('lifekeep_lang')`.
   - Hỗ trợ đổi ngôn ngữ nhanh chóng và cập nhật tức thì toàn bộ giao diện (Reactive DOM & Dynamic Re-render) mà không cần tải lại trang.

2. **Hai Vị Trí Chuyển Đổi Ngôn Ngữ Tiện Dụng:**
   - **Nút chuyển đổi 1 chạm trên thanh Header**: Nút pill kính mờ `[🇻🇳 VI] / [🇬🇧 EN]` cho phép bấm 1 chạm để đổi qua lại ngay tức thì giữa Tiếng Việt và Tiếng Anh.
   - **Thẻ cài đặt ngôn ngữ trong Cài đặt & Tài khoản**: Hộp thoại Cài đặt bổ sung thẻ chọn ngôn ngữ `Ngôn ngữ / Language` với 2 nút chuyển đổi rõ ràng.

3. **Bản Dịch Toàn Diện Từng Chi Tiết:**
   - Dịch toàn bộ các nút điều hướng, dock đáy trang, modal tác vụ nhanh, trung tâm thông báo, trình soạn thảo ghi chú, nhãn chi phí, danh mục (Vehicles, Home & Living, Documents, Technology, Other).
   - Dịch trạng thái công việc (Overdue, Due today, Due in X days, Days left, Safe, No due date).
   - Định dạng ngày tháng thông minh: Tiếng Việt dạng `DD/MM/YYYY`, Tiếng Anh chuyển sang định dạng chuẩn quốc tế `MMM D, YYYY` (ví dụ: `Oct 25, 2026`).
   - Lời chào người dùng tự động tương thích: `Xin chào, [Tên]` hoặc `Hello, [Name]`.

---

## 9. TÀI CHÍNH CÁ NHÂN SỐ DƯ GỐC & TỐI ƯU GIAO DIỆN (PHIÊN BẢN v30)

1. **Đổi tên ứng dụng chính thức**: "Trợ lý nhắc việc & tài chính, cá nhân".
2. **Loại bỏ mục xóa cache cũ**: Gỡ bỏ nút "Làm mới cập nhật giao diện mới (xóa cache cũ)" trong Settings theo yêu cầu.
3. **Thẻ Tài chính cá nhân màu vàng nổi bật với biểu tượng `$` nhấp nháy**:
   - Thẻ hiển thị màu vàng gradient nổi bật trên giao diện chính.
   - Quản lý **Số dư gốc khi nhập lần đầu**: Thiết lập số vốn khởi điểm để theo dõi từ số dư gốc đó đã chi tiêu như thế nào.
   - Hiển thị song song: Số dư gốc, Số dư khả dụng (Gốc + Thu - Chi), và Số tiền đã chi tiêu từ số dư gốc.

---

## 10. TỐI ƯU CHI TIÊU THEO THÁNG, PHÍM TẮT THÊM NHANH & HOÀN THÀNH LINH HOẠT (PHIÊN BẢN v31)

1. **Gỡ bỏ nút Cài lên điện thoại trên Header**:
   - Tối giản hàng điều khiển trên cùng cạnh quả chuông thông báo, giữ giao diện thanh lịch và gọn gàng.
2. **Chi Tiêu Tháng Này (Mặc định tháng hiện tại & Dropdown chọn các tháng trước)**:
   - Thẻ Tổng chi tiêu trên Hero chuyển thành `CHI TIÊU THÁNG NÀY (T{month}/{year})` hiển thị mặc định theo tháng thực tế trên thiết bị.
   - Cho phép người dùng chạm/chọn dropdown để duyệt lại toàn bộ các tháng trước đó.
   - Thống kê chi tiêu (Logs bảo dưỡng + Chi tiêu hàng ngày trong kỳ) tự động lọc chính xác theo tháng và năm được chọn. Thẻ KPI top cập nhật nhãn `Chi T{month} 🪙`.
3. **Nút tròn Header nhảy trực tiếp vào form Thêm mới**:
   - Nút tròn **📝 Ghi chú**: Bấm vào nhảy ngay vào form thêm mới ghi chú (`app.openNoteModal()`) và chuyển sang tab Ghi chú.
   - Nút tròn **⏰ Nhắc việc**: Bấm vào nhảy ngay vào form thêm mới nhắc việc (`app.openAddModal()`) và chuyển sang tab Việc cần làm.
4. **Tùy chọn Hoàn thành: Nhắc lại theo chu kỳ hoặc Xong hoàn toàn (Lưu vào Nhật ký Đã xong)**:
   - **Nhắc việc**: Modal hoàn thành bổ sung 2 lựa chọn:
     - `🔄 Lặp lại định kỳ`: Lưu 1 mốc chi phí vào nhật ký và tự động dời ngày đến hạn sang chu kỳ tiếp theo (+cycleMonths).
     - `🏁 Xong hoàn toàn - Lưu vào Nhật ký (Đã xong)`: Lưu toàn bộ chi phí và bóc tách con vào `logs`, gỡ mục khỏi danh sách Việc cần làm bằng phương thức `deleteItemOnly(id)` (giữ nguyên 100% dữ liệu lịch sử trong tab Đã xong).
   - **Ghi chú**: Bổ sung nút `✓ Xong` ngay trên thẻ ghi chú và trong form chỉnh sửa. Mở modal Hoàn thành ghi chú (`#complete-note-modal`) với 2 tùy chọn:
     - `🏁 Xong việc & Lưu vào Nhật ký (Đã xong)`: Chuyển ghi chú vào tab Đã xong (category: `note`, icon `📝`) và gỡ khỏi danh sách ghi chú hoạt động.
     - `🔄 Nhắc lại theo chu kỳ`: Lưu mốc nhật ký và dời ngày hẹn (+1 ngày, +1 tuần, +1 tháng, +3 tháng, +6 tháng, +1 năm).
5. **Cập nhật chuẩn cam kết Bảo mật & Quyền riêng tư**:
   - Tuyên bố minh bạch: *"Chúng tôi không lưu trữ dữ liệu cá nhân của bạn, dữ liệu được lưu trữ 100% trên máy cài phần mềm này. Mọi thông tin nhắc việc, chi tiêu tài chính, ảnh chụp và ghi chú đều nằm trực tiếp trong bộ nhớ thiết bị của bạn (IndexedDB), bảo đảm quyền riêng tư tuyệt đối."*
   - Cập nhật đồng bộ trong `index.html` và từ điển song ngữ `I18N` (`vi` và `en`).

---

## 11. HỆ THỐNG ĐĂNG NHẬP GOOGLE & TỰ ĐỘNG SAO LƯU GOOGLE (PHIÊN BẢN v33)

1. **Hệ thống Đăng nhập bằng Google (Google Sign-In & Firebase Auth Web SDK):**
   - **Đăng nhập Google chính chủ**: Tích hợp Firebase Auth Web SDK Compat (`10.12.0`) qua CDN kết hợp mô-đun `firebase-config.js`.
   - **Xác thực 1 chạm**: Bấm "Tiếp tục với Google / Gmail" kích hoạt cửa sổ chọn tài khoản Google thật (`signInWithPopup` / `signInWithRedirect`), lấy mã `UID`, `email`, `displayName`, và `photoURL`.
   - **Ảnh đại diện Google thật**: Tự động hiển thị Avatar thật từ tài khoản Google trên Header Hero (`#header-user-avatar`) và Modal Cài đặt (`#settings-user-avatar`).
   - **Tự động theo dõi người dùng**: Người dùng đăng nhập được ghi nhận vào Firebase Console (Authentication > Users: UID, Email, Ngày tạo, Lần đăng nhập cuối) và Google Analytics (DAU/MAU).
   - **Cơ chế dự phòng kép**: Nếu chưa cấu hình Firebase Key hoặc offline, app tự động chuyển sang chế độ chọn tài khoản cục bộ mượt mà, không bao giờ bị lỗi crash hay gián đoạn.

2. **Hệ thống Sao lưu Tự động vào Google (Android Auto Backup 25MB & Cloud Firestore):**
   - **Cơ chế 1: Android Auto Backup (Google Drive 25MB miễn phí)**:
     - Tạo tệp quy tắc `res/xml/backup_rules.xml` (Android 11 trở xuống) và `res/xml/data_extraction_rules.xml` (Android 12+ API 31+).
     - Hệ điều hành Android tự động nén toàn bộ cơ sở dữ liệu `IndexedDB` và cấu hình cục bộ của app đẩy lên phân vùng ẩn Google Drive của máy khi cắm sạc + có Wi-Fi.
     - Tự động phục hồi (Auto-Restore) 100% khi người dùng đổi điện thoại mới hoặc cài lại app từ CH Play mà không cần thao tác thủ công.
   - **Cơ chế 2: Cloud Firestore Sync Đa thiết bị (`users/{uid}/appData/main`)**:
     - Nút `☁️ Sao lưu lên Google`: Đẩy toàn bộ nhắc việc, lịch sử chi phí, giao dịch tài chính, ghi chú và ngân sách lên Cloud Firestore.
     - Nút `📥 Khôi phục từ Google`: Tự động kéo bản sao lưu mới nhất từ Google về máy.
   - **Tối ưu hóa nén ảnh (0.72 JPEG)**: Giảm kích thước ảnh chụp hóa đơn/giấy tờ xuống ~80-120KB để cả cơ sở dữ liệu luôn siêu nhẹ (< 1-2MB), an toàn tuyệt đối dưới ngưỡng 25MB của Google Drive.
   - **Hộp thoại Cấu hình Firebase (`#firebase-config-modal`)**: Cho phép người dùng hoặc quản trị viên dán chuỗi JSON cấu hình Firebase trực tiếp trên giao diện app một cách tiện lợi.




