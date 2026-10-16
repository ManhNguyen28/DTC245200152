# Hệ thống Quiz / Thi trắc nghiệm – Đề 35

**Môn:** Triển khai và Quản trị Hệ thống Phần mềm
**Sinh viên:** Nguyễn Đức Mạnh – **MSSV:** DTC245200152

Website tạo đề thi trắc nghiệm, làm bài và chấm điểm tự động, triển khai hoàn toàn bằng Docker Compose.

## Chức năng

| Người dùng | Chức năng |
|---|---|
| Thí sinh | Xem danh sách đề, làm bài có đồng hồ đếm ngược (hết giờ tự nộp), xem điểm và đáp án chi tiết |
| Quản trị (`/admin`) | Tạo/xóa đề thi, thêm/xóa câu hỏi 4 phương án, xem thống kê kết quả (số lượt, điểm trung bình, cao nhất) |

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Ứng dụng web | Node.js 22, Express 5, EJS |
| Cơ sở dữ liệu | MySQL 8.4 |
| Quản lý CSDL | phpMyAdmin 5.2 |
| Triển khai | Docker, Docker Compose |

## Cấu trúc thư mục

```
DTC245200152/
├── app/                    # Ứng dụng web Quiz
│   ├── src/
│   │   ├── server.js       # Khởi tạo Express, log request, /health, xử lý lỗi
│   │   ├── db.js           # Connection pool MySQL
│   │   ├── logger.js       # Ghi log dạng JSON ra stdout
│   │   ├── utils.js
│   │   ├── middleware/auth.js   # Basic Auth cho /admin
│   │   ├── routes/public.js     # Danh sách đề, làm bài, chấm điểm, kết quả
│   │   ├── routes/admin.js      # Quản lý đề, câu hỏi, thống kê
│   │   └── views/          # Giao diện EJS
│   ├── public/             # CSS, JavaScript phía trình duyệt
│   ├── Dockerfile
│   └── package.json
├── db/init.sql             # Tạo bảng + dữ liệu mẫu (chạy ở lần khởi động đầu)
├── docker-compose.yml
├── .env.example            # Mẫu biến môi trường
└── README.md
```

## Hướng dẫn chạy

Yêu cầu: Docker Desktop (Windows/macOS) hoặc Docker Engine + Compose plugin (Linux), Git.

```bash
# 1. Lấy mã nguồn
git clone https://github.com/DTC245200152/DTC245200152.git
cd DTC245200152

# 2. Tạo file biến môi trường rồi sửa mật khẩu trong .env
cp .env.example .env

# 3. Build và khởi chạy toàn bộ hệ thống
docker compose up -d --build

# 4. Kiểm tra trạng thái
docker compose ps
```

## Địa chỉ truy cập

| Dịch vụ | URL | Tài khoản |
|---|---|---|
| Website Quiz | http://localhost:3000 | – |
| Trang quản trị | http://localhost:3000/admin | `ADMIN_USER` / `ADMIN_PASSWORD` trong `.env` |
| phpMyAdmin | http://localhost:8080 | `MYSQL_USER` / `MYSQL_PASSWORD` trong `.env` |
| Health check | http://localhost:3000/health | – |

## Lệnh hữu ích

```bash
docker compose logs -f web        # Xem log ứng dụng
docker compose down               # Dừng hệ thống (giữ dữ liệu)
docker compose down -v            # Dừng và XÓA dữ liệu CSDL (chạy lại init.sql lần sau)
```
