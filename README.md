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
| Reverse proxy | Nginx (HTTPS tự ký, TLS 1.2/1.3, security headers, rate limiting) |
| Giám sát | Prometheus, Grafana, cAdvisor, node-exporter, mysqld-exporter, nginx-prometheus-exporter, prom-client |
| Triển khai | Docker, Docker Compose |

## Kiến trúc

```
Người dùng ──https:443──▶ nginx ──▶ web (Node.js :3000) ──▶ db (MySQL :3306)
           ──http:80 ──▶ (301 → https)  └─▶ /phpmyadmin/ ──▶ phpmyadmin ──▶ db
```

- Chỉ **nginx** mở cổng ra ngoài (80, 443); `web`, `phpmyadmin`, `db` chỉ truy cập được bên trong mạng Docker.
- Hai mạng tách biệt: `frontend` (nginx ↔ web, phpmyadmin) và `backend` (web, phpmyadmin ↔ db).
  Nginx không thuộc mạng `backend` nên không thể kết nối tới CSDL.
- Security headers: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy,
  Cross-Origin-Opener-Policy, Content-Security-Policy; ẩn phiên bản Nginx (`server_tokens off`).
- Giới hạn 20 lần gửi form đăng nhập/phút/IP ở Nginx (thêm vào bộ khóa đăng nhập sai của ứng dụng).

## Giám sát (Prometheus + Grafana)

```
web (/metrics) ──────────────┐
nginx ─stub_status─▶ nginx-exporter ──┤
MySQL ──▶ mysqld-exporter ───────┤──(Prometheus thu thập mỗi 15s)──▶ PROMETHEUS ──▶ GRAFANA (3 dashboard)
container ──▶ cAdvisor ──────────┤                                    └─ 8 luật cảnh báo
máy chủ ──▶ node-exporter ───────┘
```

| Nguồn | Exporter | Số liệu chính |
|---|---|---|
| Ứng dụng Quiz | `prom-client` (tích hợp trong code) | request/giây theo route, độ trễ p50/p95/p99, mã trạng thái, bài nộp, đăng nhập thành công/sai/bị khóa, bài đang làm |
| Web server | nginx-prometheus-exporter (đọc `stub_status` cổng 8080 nội bộ) | request/giây, kết nối active/reading/writing/waiting |
| Cơ sở dữ liệu | mysqld-exporter (user `exporter` chỉ có quyền PROCESS, REPLICATION CLIENT, SELECT performance_schema) | kết nối, truy vấn/giây theo loại, truy vấn chậm, kết nối bị từ chối, InnoDB |
| Container | cAdvisor | CPU, RAM, mạng từng container |
| Máy chủ | node-exporter | CPU, RAM, ổ đĩa, load average |

- Dashboard và nguồn dữ liệu Grafana được **provisioning** từ file (`monitoring/grafana/`), không cấu hình tay.
- Luật cảnh báo (`monitoring/prometheus/rules/alerts.yml`): mất kết nối target, MySQL down, lỗi 5xx > 5%,
  p95 > 1s, nghi ngờ dò mật khẩu, ổ đĩa < 10%, RAM > 90%.
- Prometheus giữ số liệu 7 ngày, tối đa 300 MB. Trang `/prometheus/` được Nginx bảo vệ bằng Basic Auth;
  `/metrics` của ứng dụng bị chặn từ bên ngoài.

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
├── nginx/
│   ├── conf.d/quiz.conf        # Reverse proxy, HTTPS, chuyển hướng HTTP, rate limiting, log JSON
│   ├── snippets/               # proxy.conf (header chuyển tiếp), security-headers.conf
│   ├── gen-cert.sh             # Tạo chứng chỉ SSL tự ký
│   └── certs/                  # server.crt, server.key (tự tạo, không đưa lên Git)
│   ├── gen-htpasswd.sh         # Tạo mật khẩu Basic Auth cho /prometheus/
├── monitoring/
│   ├── prometheus/             # prometheus.yml (6 nguồn thu thập), rules/alerts.yml (8 luật cảnh báo)
│   └── grafana/                # provisioning (datasource, dashboard provider) + dashboards/*.json
├── tests/
│   ├── e2e-test.sh             # Kiểm thử tự động 45 kịch bản (chức năng + bảo mật)
│   └── demo-traffic.sh         # Mô phỏng buổi thi: 6 học viên demo, 18 bài nộp, đăng nhập sai
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

# 2. Tạo file biến môi trường rồi đặt mật khẩu mạnh và PUBLIC_HOST (IP máy chủ) trong .env
cp .env.example .env
#    SESSION_SECRET có thể tạo bằng: openssl rand -hex 32

# 3. Tạo chứng chỉ SSL tự ký cho địa chỉ máy chủ và mật khẩu Basic Auth cho /prometheus/
sh nginx/gen-cert.sh 192.168.146.128
sh nginx/gen-htpasswd.sh

# 4. Build và khởi chạy toàn bộ hệ thống
docker compose up -d --build

# 5. Kiểm tra trạng thái và cấu hình Nginx
docker compose ps
docker exec quiz-nginx nginx -t
```

Trình duyệt sẽ cảnh báo chứng chỉ không tin cậy (do tự ký) – chọn **Nâng cao → Tiếp tục truy cập**.
Kết nối vẫn được mã hóa đầy đủ.

## Địa chỉ truy cập

Thay `<IP>` bằng địa chỉ máy chủ (ví dụ `192.168.146.128`, hoặc `localhost` nếu chạy trên máy cá nhân).

| Dịch vụ | URL | Tài khoản |
|---|---|---|
| Website Quiz | https://&lt;IP&gt;/ | Tự đăng ký tài khoản học viên |
| Trang quản trị | https://&lt;IP&gt;/admin | `ADMIN_USER` / `ADMIN_PASSWORD` trong `.env` |
| phpMyAdmin | https://&lt;IP&gt;/phpmyadmin/ | `MYSQL_USER` / `MYSQL_PASSWORD` trong `.env` |
| Grafana (3 dashboard) | https://&lt;IP&gt;/grafana/ | `MONITOR_USER` / `MONITOR_PASSWORD` trong `.env` |
| Prometheus | https://&lt;IP&gt;/prometheus/ | `MONITOR_USER` / `MONITOR_PASSWORD` (Basic Auth) |
| Health check ứng dụng | https://&lt;IP&gt;/health | – |
| Health check Nginx | http://&lt;IP&gt;/nginx-health | – |

Truy cập `http://<IP>` sẽ tự chuyển hướng sang `https://<IP>`.

Tài khoản admin được ứng dụng tạo tự động ở lần khởi động đầu tiên. Đổi `ADMIN_PASSWORD` sau đó
**không** đổi mật khẩu của tài khoản đã tồn tại.

## Kiểm thử

```bash
docker compose down -v && docker compose up -d   # CSDL sạch
bash tests/e2e-test.sh                             # 45 kịch bản, in ĐẠT/LỖI cho từng kịch bản

# Tạo dữ liệu demo (6 học viên hv01..hv06, mật khẩu HocVien2026) cho bảng xếp hạng và dashboard
bash tests/demo-traffic.sh
```

## Lệnh hữu ích

```bash
docker compose logs -f web        # Xem log ứng dụng (JSON)
docker compose down               # Dừng hệ thống (giữ dữ liệu)
docker compose down -v            # Dừng và XÓA dữ liệu CSDL (chạy lại init.sql lần sau)
```
