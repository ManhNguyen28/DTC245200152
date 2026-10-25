# Hệ thống Quiz / Thi trắc nghiệm – Đề 35

**Môn:** Triển khai và Quản trị Hệ thống Phần mềm
**Sinh viên:** Nguyễn Đức Mạnh – **MSSV:** DTC245200152

Website tạo đề thi trắc nghiệm, làm bài và chấm điểm tự động, triển khai hoàn toàn bằng Docker Compose.

## Chức năng

**Học viên**
- Đăng ký / đăng nhập; trang **hồ sơ** và **đổi mật khẩu** (mật khẩu băm bcrypt)
- Trang chủ dạng landing: số liệu nổi bật, danh mục có icon, tìm kiếm / lọc đề, **bảng vàng** học viên
- Làm bài: câu hỏi xáo trộn, đồng hồ do **máy chủ** tính, hết giờ tự nộp, **thanh tiến độ**, **bảng điều hướng câu hỏi**,
  **đánh dấu câu chưa chắc**, đáp án **tự lưu tạm** trên trình duyệt (tải lại trang không mất bài)
- Kết quả có **giải thích đáp án** và độ khó từng câu; **biểu đồ tiến bộ** điểm theo thời gian
- **Ôn tập câu làm sai** và luyện tập lại (không tính điểm)
- **Giấy chứng nhận** khi đạt điểm yêu cầu (in / lưu PDF) với **mã xác thực HMAC** – ai cũng kiểm tra được tại `/verify`
- Giao diện **sáng / tối**, hiển thị tốt trên điện thoại

**Đề thi nâng cao**
- **Ngân hàng câu hỏi**: mỗi lượt rút ngẫu nhiên N câu; **điểm đạt** tối thiểu; giới hạn số lượt làm
- **Lịch mở / đóng đề**; **mã vào phòng thi** (lưu dạng băm bcrypt); bài nộp quá hạn không tính điểm

**Quản trị viên** (`/admin`)
- Tổng quan: số liệu, biểu đồ lượt nộp 7 ngày, hoạt động gần đây
- Quản lý đề thi (tạo, sửa, ẩn/công khai, **nhân bản**, xóa), câu hỏi (kèm giải thích, độ khó), danh mục có icon
- Nhập câu hỏi từ CSV (mẫu: `db/sample-questions.csv`), **xuất câu hỏi** và bảng điểm ra CSV (mở bằng Excel)
- Thống kê đề: điểm trung bình/cao nhất/thấp nhất, tỉ lệ đạt, phân bố điểm, tỉ lệ đúng từng câu, top 10
- **Quản lý người dùng**: khóa / mở khóa, đổi vai trò, đặt lại mật khẩu (mật khẩu tạm hiện một lần)
- **Nhật ký hoạt động (audit log)**: ai làm gì, lúc nào, từ IP nào – lọc theo hành động / người dùng

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
| Log tập trung | Loki 3.7, Promtail 3.6 (Docker service discovery), LogQL |
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

## Log tập trung (Loki + Promtail)

```
12 container ──stdout/stderr──▶ PROMTAIL ──(gắn nhãn, đẩy log)──▶ LOKI ◀──LogQL── GRAFANA (Explore, dashboard 4)
               (Docker json-file, xoay vòng 3 x 10 MB)
```

- **Promtail** dùng Docker service discovery: tự phát hiện mọi container của project `dtc245200152`, đọc log và
  gắn nhãn `service`, `container`, `stream`; log Nginx tách `log_type` = `access` (JSON) / `error` / `system`;
  log ứng dụng (JSON) được gắn nhãn `level` (info / warn / error).
- **Loki** chỉ đánh chỉ mục theo nhãn, lưu log 7 ngày (compactor tự xóa log cũ), chỉ truy cập được trong mạng Docker.
- Ứng dụng và Nginx đều ghi log **dạng JSON** nên LogQL tách được từng trường bằng `| json`.

### Các truy vấn LogQL (Grafana → Explore → chọn nguồn **Loki**)

| # | Câu hỏi vận hành | LogQL |
|---|---|---|
| 1 | Những lần đăng nhập sai gần đây: tài khoản nào, từ IP nào? | `{service="web"} \| json \| msg="login_failed" \| line_format "user={{.username}} ip={{.ip}}"` |
| 2 | Request nào bị Nginx trả lỗi 4xx/5xx (phát hiện dò thám)? | `{service="nginx", log_type="access"} \| json \| status >= 400` |
| 3 | Đếm request theo mã trạng thái trong 1 giờ (truy vấn số liệu) | `sum by (status) (count_over_time({service="nginx", log_type="access"} \| json status \| __error__="" [1h]))` |
| 4 | IP nào đăng nhập sai nhiều nhất (phát hiện dò mật khẩu)? | `topk(5, sum by (ip, username) (count_over_time({service="web"} \| json msg, ip, username \| msg="login_failed" [1h])))` |
| 5 | Bài nộp điểm thấp (dưới 3) để hỗ trợ học viên | `{service="web"} \| json \| msg="quiz_submitted" \| score < 3` |
| 6 | Request xử lý chậm (> 20 ms) | `{service="web"} \| json \| msg="http_request" \| duration_ms > 20` |
| 7 | Lỗi của ứng dụng (lọc nhanh bằng nhãn) | `{service="web", level="error"}` |
| 8 | Lỗi/cảnh báo của mọi container | `{system="quiz-de35"} \|~ "(?i)error\|warn\|fail"` |

Ghi chú: `| json status` chỉ tách trường cần dùng (tránh tạo quá nhiều chuỗi khi đếm);
`| __error__=""` bỏ qua dòng không phải JSON.

## Hardening (gia cố bảo mật)

Nguyên tắc: **quyền tối thiểu** và **phòng thủ nhiều lớp** – giả định một thành phần bị xâm nhập,
kẻ tấn công cũng không đi tiếp được.

| # | Lớp | Biện pháp | Cách kiểm chứng |
|---|---|---|---|
| 1 | Container | Web chạy bằng user `node` (uid 1000), mã nguồn thuộc root chỉ đọc | `docker exec quiz-web whoami` → `node` |
| 2 | Container | `read_only` + `tmpfs`, `cap_drop: ALL` (nginx chỉ giữ 4 capability), `no-new-privileges` cho 13/13 container | ghi vào `/usr/bin` → *Read-only file system*; `CapEff = 0` |
| 3 | Container | Giới hạn RAM / CPU / số tiến trình mọi container; xoay vòng log 3 × 10 MB | `docker stats --no-stream` |
| 4 | CSDL | User ứng dụng chỉ `SELECT, INSERT, UPDATE, DELETE` (`db/03-app-privileges.sh`); user `exporter` chỉ đọc thống kê | `DROP TABLE` → *DROP command denied* |
| 5 | CSDL | `root` chỉ đăng nhập từ trong container (`MYSQL_ROOT_HOST=localhost`) | root qua TCP → *Access denied* |
| 6 | Mạng | 4 mạng tách biệt; `backend`, `monitoring`, `socket-proxy` là `internal` (không ra Internet); chỉ Nginx publish 80/443 | `wget` ra Internet từ mạng backend → bị chặn |
| 7 | Docker | Promtail đọc Docker API qua `docker-socket-proxy` chỉ cho phép GET container/network | `POST /containers/create` → 403 |
| 8 | Chuỗi cung ứng | Ghim phiên bản mọi image (không dùng `:latest`); `npm audit` 0 lỗ hổng; npm override vá `mysql2` | `grep image: docker-compose.yml` |
| 9 | Máy chủ | Tường lửa UFW: chặn mặc định, chỉ mở 22 (giới hạn tốc độ), 80, 443 | `sudo ufw status verbose` |
| 10 | Vận hành | Healthcheck (web, nginx, db, cadvisor); quét image bằng Trivy: 0 lỗ hổng HIGH/CRITICAL (đã xóa npm khỏi image chạy) | `docker compose ps`; Trivy |
| + | Web | HTTPS (TLS 1.2/1.3), security headers + CSP, rate limit đăng nhập, Basic Auth cho `/prometheus/` và `/phpmyadmin/`, chặn `/metrics` | xem mục Kiến trúc |
| + | Bí mật | Mật khẩu ngẫu nhiên trong `.env` (quyền 600, không đưa lên Git); khóa SSL thuộc root, quyền 600 | `ls -l .env nginx/certs` |

Ngoại lệ có chủ đích: **cAdvisor** chạy `privileged` để đọc cgroup của mọi container (công cụ giám sát hạ tầng,
chỉ ở mạng internal, không mở cổng).

Quét lỗ hổng image (tùy chọn):

```bash
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock:ro aquasec/trivy:0.76.0 \
  image --scanners vuln --severity HIGH,CRITICAL quiz-web:1.1
```

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
│   ├── 02-monitoring-user.sh   # User 'exporter' chỉ đọc thống kê (cho mysqld-exporter)
│   ├── 03-app-privileges.sh    # Thu hẹp quyền user ứng dụng; root chỉ từ localhost
│   └── sample-questions.csv    # File CSV mẫu để thử chức năng nhập câu hỏi
├── nginx/
│   ├── conf.d/quiz.conf        # Reverse proxy, HTTPS, chuyển hướng HTTP, rate limiting, log JSON
│   ├── snippets/               # proxy.conf (header chuyển tiếp), security-headers.conf
│   ├── gen-cert.sh             # Tạo chứng chỉ SSL tự ký
│   └── certs/                  # server.crt, server.key (tự tạo, không đưa lên Git)
│   ├── gen-htpasswd.sh         # Tạo mật khẩu Basic Auth cho /prometheus/
├── monitoring/
│   ├── prometheus/             # prometheus.yml (8 nguồn thu thập), rules/alerts.yml (8 luật cảnh báo)
│   ├── loki/                   # loki-config.yaml (lưu log 7 ngày)
│   ├── promtail/               # promtail-config.yaml (Docker service discovery, gắn nhãn)
│   └── grafana/                # provisioning (Prometheus + Loki) + dashboards/*.json (4 dashboard)
├── scripts/ufw-setup.sh        # Tường lửa máy chủ (chặn mặc định, mở 22/80/443)
├── tests/
│   ├── e2e-test.sh             # kiểm thử tự động 69 kịch bản (chức năng + bảo mật)
│   └── demo-traffic.sh         # Mô phỏng buổi thi: 6 học viên demo, 18 bài nộp, đăng nhập sai
├── docker-compose.yml
├── .env.example                # Mẫu biến môi trường
└── README.md
```

## Hướng dẫn chạy

Yêu cầu: Docker Engine + Compose plugin (Linux) hoặc Docker Desktop, Git.

```bash
# 1. Lấy mã nguồn
git clone https://github.com/ManhNguyen28/DTC245200152.git
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

# 6. (Máy chủ Ubuntu) Bật tường lửa: chỉ mở SSH, HTTP, HTTPS
sudo bash scripts/ufw-setup.sh
```

Trình duyệt sẽ cảnh báo chứng chỉ không tin cậy (do tự ký) – chọn **Nâng cao → Tiếp tục truy cập**.
Kết nối vẫn được mã hóa đầy đủ.

## Địa chỉ truy cập

Thay `<IP>` bằng địa chỉ máy chủ (ví dụ `192.168.146.128`, hoặc `localhost` nếu chạy trên máy cá nhân).

| Dịch vụ | URL | Tài khoản |
|---|---|---|
| Website Quiz | https://&lt;IP&gt;/ | Tự đăng ký tài khoản học viên |
| Trang quản trị | https://&lt;IP&gt;/admin | `ADMIN_USER` / `ADMIN_PASSWORD` trong `.env` |
| phpMyAdmin | https://&lt;IP&gt;/phpmyadmin/ | Lớp 1 (Nginx): `MONITOR_USER` / `MONITOR_PASSWORD`; lớp 2: `MYSQL_USER` / `MYSQL_PASSWORD` |
| Grafana (4 dashboard + Explore/LogQL) | https://&lt;IP&gt;/grafana/ | `MONITOR_USER` / `MONITOR_PASSWORD` trong `.env` |
| Prometheus | https://&lt;IP&gt;/prometheus/ | `MONITOR_USER` / `MONITOR_PASSWORD` (Basic Auth) |
| Health check ứng dụng | https://&lt;IP&gt;/health | – |
| Health check Nginx | http://&lt;IP&gt;/nginx-health | – |

Truy cập `http://<IP>` sẽ tự chuyển hướng sang `https://<IP>`.

Tài khoản admin được ứng dụng tạo tự động ở lần khởi động đầu tiên. Đổi `ADMIN_PASSWORD` sau đó
**không** đổi mật khẩu của tài khoản đã tồn tại.

## Kiểm thử

```bash
docker compose down -v && docker compose up -d   # CSDL sạch
bash tests/e2e-test.sh                             # 69 kịch bản, in ĐẠT/LỖI cho từng kịch bản

# Tạo dữ liệu demo (6 học viên hv01..hv06, mật khẩu HocVien2026) cho bảng xếp hạng và dashboard
bash tests/demo-traffic.sh
```

## Lệnh hữu ích

```bash
docker compose logs -f web        # Xem log ứng dụng (JSON)
docker compose down               # Dừng hệ thống (giữ dữ liệu)
docker compose down -v            # Dừng và XÓA dữ liệu CSDL (chạy lại init.sql lần sau)
```
