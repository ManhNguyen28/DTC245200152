-- =====================================================================
-- Khởi tạo CSDL cho hệ thống Quiz (Đề 35)
-- MySQL tự chạy file này ở lần khởi động ĐẦU TIÊN (khi volume dữ liệu còn trống),
-- trong CSDL được khai báo bởi biến MYSQL_DATABASE.
-- =====================================================================
SET NAMES utf8mb4;

-- Đề thi
CREATE TABLE IF NOT EXISTS quizzes (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(200)  NOT NULL,
  description VARCHAR(1000) NULL,
  time_limit  SMALLINT UNSIGNED NOT NULL DEFAULT 15 COMMENT 'Thời gian làm bài (phút)',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  CONSTRAINT fk_questions_quiz FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lượt làm bài
CREATE TABLE IF NOT EXISTS attempts (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quiz_id      INT UNSIGNED NOT NULL,
  student_name VARCHAR(100) NOT NULL,
  student_code VARCHAR(20)  NULL,
  score        SMALLINT UNSIGNED NOT NULL,
  total        SMALLINT UNSIGNED NOT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_attempts_submitted (submitted_at),
  CONSTRAINT fk_attempts_quiz FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
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

-- ---------------------------------------------------------------------
-- Dữ liệu mẫu
-- ---------------------------------------------------------------------
INSERT INTO quizzes (id, title, description, time_limit) VALUES
  (1, 'Docker cơ bản', 'Kiểm tra kiến thức nền tảng về container, image và Docker Compose.', 10),
  (2, 'Mạng máy tính căn bản', 'Các khái niệm về giao thức, cổng dịch vụ và HTTP.', 10),
  (3, 'Linux cơ bản', 'Lệnh và phân quyền thường dùng khi quản trị máy chủ Linux.', 10);

INSERT INTO questions (quiz_id, content, option_a, option_b, option_c, option_d, correct_option) VALUES
  (1, 'Lệnh nào liệt kê các container đang chạy?', 'docker ps', 'docker images', 'docker run', 'docker build', 'A'),
  (1, 'File nào dùng để định nghĩa nhiều container chạy cùng nhau?', 'Dockerfile', 'docker-compose.yml', '.dockerignore', 'package.json', 'B'),
  (1, 'Dữ liệu được giữ lại sau khi xóa container nếu lưu ở đâu?', 'Thư mục /tmp', 'Lớp (layer) của image', 'Volume', 'Biến môi trường', 'C'),
  (1, 'Lệnh nào trong Dockerfile chỉ định image nền?', 'RUN', 'FROM', 'COPY', 'CMD', 'B'),
  (1, 'Cờ nào của docker run dùng để ánh xạ cổng?', '-v', '-e', '-p', '-d', 'C'),

  (2, 'HTTPS mặc định dùng cổng nào?', '80', '21', '443', '22', 'C'),
  (2, 'Mã trạng thái HTTP 404 có nghĩa là gì?', 'Lỗi máy chủ', 'Không tìm thấy tài nguyên', 'Chuyển hướng', 'Thành công', 'B'),
  (2, 'Giao thức nào phân giải tên miền thành địa chỉ IP?', 'DHCP', 'FTP', 'DNS', 'SMTP', 'C'),
  (2, 'Reverse proxy thường được đặt ở vị trí nào?', 'Giữa client và các máy chủ ứng dụng', 'Bên trong cơ sở dữ liệu', 'Trên máy của client', 'Trong trình duyệt', 'A'),
  (2, 'Địa chỉ 127.0.0.1 là gì?', 'Địa chỉ gateway', 'Địa chỉ loopback (localhost)', 'Địa chỉ broadcast', 'Địa chỉ DNS của Google', 'B'),

  (3, 'Lệnh nào hiển thị thư mục hiện tại?', 'ls', 'pwd', 'cd', 'mkdir', 'B'),
  (3, 'Lệnh nào thay đổi quyền truy cập của file?', 'chown', 'chmod', 'chgrp', 'umask', 'B'),
  (3, 'Người dùng có quyền cao nhất trong Linux là?', 'admin', 'root', 'sudo', 'system', 'B'),
  (3, 'Lệnh nào theo dõi file log theo thời gian thực?', 'cat', 'less', 'tail -f', 'head', 'C'),
  (3, 'Với quyền 755, chủ sở hữu file có những quyền gì?', 'Chỉ đọc', 'Đọc và ghi', 'Đọc, ghi và thực thi', 'Chỉ thực thi', 'C');
