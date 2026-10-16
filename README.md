# Hệ thống Quiz / Thi trắc nghiệm – Đề 35

**Môn:** Triển khai và Quản trị Hệ thống Phần mềm
**Sinh viên:** Nguyễn Đức Mạnh – **MSSV:** DTC245200152

Website tạo đề thi trắc nghiệm, làm bài và chấm điểm tự động, triển khai hoàn toàn bằng Docker Compose.

## Chức năng

**Học viên**
- Đăng ký / đăng nhập tài khoản (mật khẩu băm bcrypt)
- Tìm kiếm đề theo từ khóa, lọc theo danh mục môn học
- Làm bài: câu hỏi xáo trộn mỗi lượt, đồng hồ đếm ngược do **máy chủ** tính, hết giờ tự nộp, bỏ dở có thể làm tiếp
- Giới hạn số lượt làm mỗi đề; bài nộp quá hạn không được tính điểm
- Xem điểm và đáp án chi tiết, lịch sử làm bài, bảng xếp hạng từng đề

**Quản trị viên** (`/admin`)
- Tổng quan: số học viên, đề, câu hỏi, lượt nộp, biểu đồ lượt nộp 7 ngày
- Quản lý đề thi (tạo, sửa, ẩn/công khai, xóa), câu hỏi (thêm, sửa, xóa), danh mục môn học
- Nhập câu hỏi hàng loạt từ file CSV (mẫu: `db/sample-questions.csv`), xuất bảng điểm ra CSV (mở bằng Excel)
- Thống kê đề: điểm trung bình/cao nhất/thấp nhất, tỉ lệ đạt, phân bố điểm, tỉ lệ đúng từng câu, top 10
- Danh sách người dùng

**Bảo mật trong ứng dụng**: bcrypt, khóa đăng nhập 15 phút sau 5 lần sai, CSRF token cho mọi form,
cookie `HttpOnly`/`SameSite`, đổi session id khi đăng nhập, kiểm tra quyền sở hữu bài làm,
chống CSV injection, truy vấn tham số hóa (chống SQL injection), escape HTML (chống XSS).

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Ứng dụng web | Node.js 22, Express 5, EJS, express-session, bcryptjs |
| Cơ sở dữ liệu | MySQL 8.0 (phiên đăng nhập cũng lưu trong MySQL) |
| Quản lý CSDL | phpMyAdmin 5.2 |
| Triển khai | Docker, Docker Compose |

## Cấu trúc thư mục

```
DTC245200152/
├── app/                        # Ứng dụng web Quiz
│   ├── src/
│   │   ├── server.js           # Khởi tạo Express, chuỗi middleware, /health, xử lý lỗi
│   │   ├── bootstrap.js        # Tự tạo tài khoản admin từ biến môi trường
│   │   ├── db.js               # Connection pool MySQL
│   │   ├── logger.js           # Ghi log dạng JSON ra stdout
│   │   ├── middleware/         # session, csrf, auth (phân quyền), loginLimiter
│   │   ├── services/           # attempts (làm bài, chấm điểm), stats (thống kê), csv
│   │   ├── routes/             # auth, public (học viên), admin (quản trị)
│   │   └── views/              # Giao diện EJS
│   ├── public/                 # CSS, JavaScript phía trình duyệt
│   ├── Dockerfile
│   └── package.json
├── db/
│   ├── init.sql                # Lược đồ CSDL + dữ liệu mẫu (chạy ở lần khởi động đầu)
│   └── sample-questions.csv    # File CSV mẫu để thử chức năng nhập câu hỏi
├── tests/e2e-test.sh           # Kiểm thử tự động 45 kịch bản (chức năng + bảo mật)
├── docker-compose.yml
├── .env.example                # Mẫu biến môi trường
└── README.md
```

## Hướng dẫn chạy

Yêu cầu: Docker Engine + Compose plugin (Linux) hoặc Docker Desktop, Git.

```bash
# 1. Lấy mã nguồn
git clone https://github.com/DTC245200152/DTC245200152.git
cd DTC245200152

# 2. Tạo file biến môi trường rồi đặt mật khẩu mạnh trong .env
cp .env.example .env
#    SESSION_SECRET có thể tạo bằng: openssl rand -hex 32

# 3. Build và khởi chạy toàn bộ hệ thống
docker compose up -d --build

# 4. Kiểm tra trạng thái
docker compose ps
```

## Địa chỉ truy cập

Thay `<IP>` bằng địa chỉ máy chủ (ví dụ `192.168.146.128`, hoặc `localhost` nếu chạy trên máy cá nhân).

| Dịch vụ | URL | Tài khoản |
|---|---|---|
| Website Quiz | http://&lt;IP&gt;:3000 | Tự đăng ký tài khoản học viên |
| Trang quản trị | http://&lt;IP&gt;:3000/admin | `ADMIN_USER` / `ADMIN_PASSWORD` trong `.env` |
| phpMyAdmin | http://&lt;IP&gt;:8080 | `MYSQL_USER` / `MYSQL_PASSWORD` trong `.env` |
| Health check | http://&lt;IP&gt;:3000/health | – |

Tài khoản admin được ứng dụng tạo tự động ở lần khởi động đầu tiên. Đổi `ADMIN_PASSWORD` sau đó
**không** đổi mật khẩu của tài khoản đã tồn tại.

## Kiểm thử

```bash
docker compose down -v && docker compose up -d   # CSDL sạch
bash tests/e2e-test.sh                             # 45 kịch bản, in ĐẠT/LỖI cho từng kịch bản
```

## Lệnh hữu ích

```bash
docker compose logs -f web        # Xem log ứng dụng (JSON)
docker compose down               # Dừng hệ thống (giữ dữ liệu)
docker compose down -v            # Dừng và XÓA dữ liệu CSDL (chạy lại init.sql lần sau)
```
