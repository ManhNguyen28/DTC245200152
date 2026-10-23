-- =====================================================================
-- Khởi tạo CSDL cho hệ thống Quiz (Đề 35)
-- MySQL tự chạy file này ở lần khởi động ĐẦU TIÊN (khi volume dữ liệu còn trống),
-- trong CSDL được khai báo bởi biến MYSQL_DATABASE.
-- Tài khoản admin KHÔNG tạo ở đây: ứng dụng tự tạo khi khởi động từ biến môi trường
-- ADMIN_USER / ADMIN_PASSWORD (mật khẩu được băm bcrypt, không nằm trong mã nguồn).
-- Thời gian lưu dạng TIMESTAMP (UTC); ứng dụng chỉ đổi sang giờ Việt Nam khi hiển thị.
-- =====================================================================
SET NAMES utf8mb4;

-- Người dùng: quản trị viên và học viên
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(30)  NOT NULL,
  password_hash VARCHAR(100) NOT NULL COMMENT 'bcrypt, không lưu mật khẩu gốc',
  full_name     VARCHAR(100) NOT NULL,
  student_code  VARCHAR(20)  NULL,
  role          ENUM('admin','student') NOT NULL DEFAULT 'student',
  is_locked     BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Tài khoản bị quản trị viên khóa',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL,
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Danh mục môn học (icon: box, globe, terminal, shield, book)
CREATE TABLE IF NOT EXISTS categories (
  id   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(20)  NOT NULL DEFAULT 'book',
  UNIQUE KEY uq_categories_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Đề thi
CREATE TABLE IF NOT EXISTS quizzes (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id           INT UNSIGNED NULL,
  title                 VARCHAR(200)  NOT NULL,
  description           VARCHAR(1000) NULL,
  time_limit            SMALLINT UNSIGNED NOT NULL DEFAULT 15 COMMENT 'Thời gian làm bài (phút)',
  max_attempts          SMALLINT UNSIGNED NOT NULL DEFAULT 0  COMMENT '0 = không giới hạn',
  questions_per_attempt SMALLINT UNSIGNED NOT NULL DEFAULT 0  COMMENT 'Ngân hàng câu hỏi: rút ngẫu nhiên N câu mỗi lượt; 0 = tất cả',
  pass_score            DECIMAL(4,2) NOT NULL DEFAULT 5.00   COMMENT 'Điểm đạt (hệ 10) để nhận giấy chứng nhận',
  shuffle_questions     BOOLEAN NOT NULL DEFAULT TRUE,
  is_published          BOOLEAN NOT NULL DEFAULT TRUE,
  opens_at              TIMESTAMP NULL COMMENT 'Lịch mở đề (NULL = mở ngay)',
  closes_at             TIMESTAMP NULL COMMENT 'Lịch đóng đề (NULL = không đóng)',
  access_code_hash      VARCHAR(100) NULL COMMENT 'Mã vào phòng thi (băm bcrypt); NULL = không cần mã',
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_quizzes_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Câu hỏi trắc nghiệm 4 phương án
CREATE TABLE IF NOT EXISTS questions (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quiz_id        INT UNSIGNED NOT NULL,
  content        VARCHAR(1000) NOT NULL,
  option_a       VARCHAR(255) NOT NULL,
  option_b       VARCHAR(255) NOT NULL,
  option_c       VARCHAR(255) NOT NULL,
  option_d       VARCHAR(255) NOT NULL,
  correct_option ENUM('A','B','C','D') NOT NULL,
  explanation    VARCHAR(1000) NULL COMMENT 'Giải thích đáp án, hiện sau khi nộp bài',
  difficulty     ENUM('easy','medium','hard') NOT NULL DEFAULT 'medium',
  CONSTRAINT fk_questions_quiz FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lượt làm bài. Hạn nộp (deadline_at) do máy chủ tính khi bắt đầu làm bài.
CREATE TABLE IF NOT EXISTS attempts (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quiz_id        INT UNSIGNED NOT NULL,
  user_id        INT UNSIGNED NOT NULL,
  status         ENUM('in_progress','submitted') NOT NULL DEFAULT 'in_progress',
  question_order JSON NOT NULL COMMENT 'Các câu (đã rút / xáo trộn) của lượt làm này',
  score          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  total          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_late        BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Nộp quá hạn -> không tính điểm',
  started_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deadline_at    TIMESTAMP NOT NULL,
  submitted_at   TIMESTAMP NULL,
  INDEX idx_attempts_user_quiz (user_id, quiz_id),
  INDEX idx_attempts_submitted (submitted_at),
  CONSTRAINT fk_attempts_quiz FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
  CONSTRAINT fk_attempts_user FOREIGN KEY (user_id) REFERENCES users(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Chi tiết câu trả lời của từng lượt làm bài
CREATE TABLE IF NOT EXISTS attempt_answers (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attempt_id      INT UNSIGNED NOT NULL,
  question_id     INT UNSIGNED NOT NULL,
  selected_option ENUM('A','B','C','D') NULL,
  is_correct      BOOLEAN NOT NULL,
  CONSTRAINT fk_answers_attempt  FOREIGN KEY (attempt_id)  REFERENCES attempts(id)  ON DELETE CASCADE,
  CONSTRAINT fk_answers_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nhật ký hoạt động (audit log): ai làm gì, lúc nào, từ IP nào
CREATE TABLE IF NOT EXISTS audit_logs (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NULL,
  username   VARCHAR(30)  NULL,
  action     VARCHAR(50)  NOT NULL,
  detail     VARCHAR(500) NULL,
  ip         VARCHAR(45)  NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Phiên đăng nhập (express-mysql-session). Lưu trong DB để khởi động lại web không mất phiên.
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires    INT UNSIGNED NOT NULL,
  data       MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Dữ liệu mẫu
-- ---------------------------------------------------------------------
INSERT INTO categories (id, name, icon) VALUES
  (1, 'Docker & DevOps', 'box'),
  (2, 'Mạng máy tính', 'globe'),
  (3, 'Hệ điều hành Linux', 'terminal'),
  (4, 'An toàn thông tin', 'shield');

-- Đề 1 dùng ngân hàng 10 câu, mỗi lượt rút ngẫu nhiên 5 câu
INSERT INTO quizzes (id, category_id, title, description, time_limit, max_attempts, questions_per_attempt, pass_score) VALUES
  (1, 1, 'Docker cơ bản', 'Kiểm tra kiến thức nền tảng về container, image và Docker Compose. Mỗi lượt rút ngẫu nhiên 5 câu từ ngân hàng 10 câu.', 10, 3, 5, 5.00),
  (2, 2, 'Mạng máy tính căn bản', 'Các khái niệm về giao thức, cổng dịch vụ và HTTP.', 10, 0, 0, 5.00),
  (3, 3, 'Linux cơ bản', 'Lệnh và phân quyền thường dùng khi quản trị máy chủ Linux.', 10, 0, 0, 6.00);

INSERT INTO questions (quiz_id, content, option_a, option_b, option_c, option_d, correct_option, difficulty, explanation) VALUES
  (1, 'Lệnh nào liệt kê các container đang chạy?', 'docker ps', 'docker images', 'docker run', 'docker build', 'A', 'easy',
      'docker ps liệt kê container đang chạy (thêm -a để xem cả container đã dừng); docker images liệt kê image.'),
  (1, 'File nào dùng để định nghĩa nhiều container chạy cùng nhau?', 'Dockerfile', 'docker-compose.yml', '.dockerignore', 'package.json', 'B', 'easy',
      'docker-compose.yml mô tả nhiều service, mạng, volume; Dockerfile chỉ mô tả cách build MỘT image.'),
  (1, 'Dữ liệu được giữ lại sau khi xóa container nếu lưu ở đâu?', 'Thư mục /tmp', 'Lớp (layer) của image', 'Volume', 'Biến môi trường', 'C', 'medium',
      'Volume nằm ngoài vòng đời container: xóa container (docker compose down) dữ liệu vẫn còn, chỉ down -v mới xóa.'),
  (1, 'Lệnh nào trong Dockerfile chỉ định image nền?', 'RUN', 'FROM', 'COPY', 'CMD', 'B', 'easy',
      'FROM là lệnh đầu tiên, chọn image nền (vd node:22-alpine) để xây dựng tiếp.'),
  (1, 'Cờ nào của docker run dùng để ánh xạ cổng?', '-v', '-e', '-p', '-d', 'C', 'easy',
      '-p cổng_máy_chủ:cổng_container; -v gắn volume, -e đặt biến môi trường, -d chạy nền.'),
  (1, 'Trong docker-compose, "depends_on: condition: service_healthy" có tác dụng gì?', 'Khởi động lại container khi lỗi', 'Chỉ khởi động service khi service phụ thuộc đã healthy', 'Giới hạn RAM', 'Mở cổng ra ngoài', 'B', 'medium',
      'Service chờ healthcheck của service kia báo healthy rồi mới chạy, vd web chờ MySQL sẵn sàng.'),
  (1, 'Vì sao nên chạy container bằng user không phải root?', 'Chạy nhanh hơn', 'Giảm thiệt hại nếu ứng dụng bị chiếm quyền', 'Tiết kiệm ổ đĩa', 'Không cần Dockerfile', 'B', 'medium',
      'Container dùng chung kernel với máy chủ; tiến trình root bị chiếm quyền có nguy cơ thoát ra máy chủ (container escape).'),
  (1, 'Lệnh nào xem log của một container?', 'docker inspect', 'docker logs', 'docker top', 'docker stats', 'B', 'easy',
      'docker logs <tên> in stdout/stderr của container; thêm -f để theo dõi liên tục.'),
  (1, '"docker compose down -v" khác "docker compose down" ở điểm nào?', 'Xóa cả image', 'Xóa cả volume dữ liệu', 'Chỉ dừng, không xóa container', 'Không khác', 'B', 'hard',
      'Tùy chọn -v xóa cả các volume được khai báo -> mất dữ liệu; lần sau MySQL sẽ chạy lại init.sql.'),
  (1, 'Mạng Docker khai báo "internal: true" có đặc điểm gì?', 'Không cho container nào kết nối', 'Container trong mạng không ra được Internet', 'Chỉ dùng IPv6', 'Tự mở cổng 80', 'B', 'hard',
      'Mạng internal không có đường ra ngoài: dù bị chiếm quyền, container cũng không gửi được dữ liệu ra Internet.'),

  (2, 'HTTPS mặc định dùng cổng nào?', '80', '21', '443', '22', 'C', 'easy',
      'HTTP dùng 80, HTTPS dùng 443, FTP 21, SSH 22.'),
  (2, 'Mã trạng thái HTTP 404 có nghĩa là gì?', 'Lỗi máy chủ', 'Không tìm thấy tài nguyên', 'Chuyển hướng', 'Thành công', 'B', 'easy',
      '4xx là lỗi phía người dùng; 404 = Not Found. Lỗi máy chủ là 5xx, chuyển hướng 3xx, thành công 2xx.'),
  (2, 'Giao thức nào phân giải tên miền thành địa chỉ IP?', 'DHCP', 'FTP', 'DNS', 'SMTP', 'C', 'easy',
      'DNS (Domain Name System) dịch tên miền sang IP; DHCP cấp phát IP, SMTP gửi thư, FTP truyền file.'),
  (2, 'Reverse proxy thường được đặt ở vị trí nào?', 'Giữa client và các máy chủ ứng dụng', 'Bên trong cơ sở dữ liệu', 'Trên máy của client', 'Trong trình duyệt', 'A', 'medium',
      'Reverse proxy (vd Nginx) đứng trước các máy chủ ứng dụng: nhận request, mã hóa TLS, định tuyến, bảo vệ phía sau.'),
  (2, 'Địa chỉ 127.0.0.1 là gì?', 'Địa chỉ gateway', 'Địa chỉ loopback (localhost)', 'Địa chỉ broadcast', 'Địa chỉ DNS của Google', 'B', 'medium',
      '127.0.0.1 luôn trỏ về chính máy đang dùng (loopback).'),

  (3, 'Lệnh nào hiển thị thư mục hiện tại?', 'ls', 'pwd', 'cd', 'mkdir', 'B', 'easy',
      'pwd = print working directory. ls liệt kê file, cd đổi thư mục, mkdir tạo thư mục.'),
  (3, 'Lệnh nào thay đổi quyền truy cập của file?', 'chown', 'chmod', 'chgrp', 'umask', 'B', 'easy',
      'chmod đổi quyền đọc/ghi/thực thi; chown đổi chủ sở hữu; chgrp đổi nhóm.'),
  (3, 'Người dùng có quyền cao nhất trong Linux là?', 'admin', 'root', 'sudo', 'system', 'B', 'easy',
      'root (uid 0) có toàn quyền; sudo là lệnh để chạy với quyền root.'),
  (3, 'Lệnh nào theo dõi file log theo thời gian thực?', 'cat', 'less', 'tail -f', 'head', 'C', 'medium',
      'tail -f (follow) in thêm dòng mới mỗi khi file log được ghi.'),
  (3, 'Với quyền 755, chủ sở hữu file có những quyền gì?', 'Chỉ đọc', 'Đọc và ghi', 'Đọc, ghi và thực thi', 'Chỉ thực thi', 'C', 'hard',
      '7 = 4 (đọc) + 2 (ghi) + 1 (thực thi) cho chủ sở hữu; 5 = đọc + thực thi cho nhóm và người khác.');
