#!/bin/bash
# Tạo tài khoản MySQL riêng cho mysqld-exporter (Prometheus) theo nguyên tắc QUYỀN TỐI THIỂU:
# chỉ đọc được số liệu thống kê, KHÔNG đọc được dữ liệu ứng dụng (bảng users, questions...).
# - MySQL tự chạy file này (sau 01-init.sql) ở lần khởi động đầu tiên, khi volume dữ liệu còn trống.
# - Có thể chạy lại thủ công trên CSDL đang hoạt động:
#     docker exec quiz-db bash /docker-entrypoint-initdb.d/02-monitoring-user.sh
# Mật khẩu lấy từ biến môi trường MYSQL_EXPORTER_PASSWORD (khai báo trong .env).
set -e

if [ -z "$MYSQL_EXPORTER_PASSWORD" ]; then
  echo "[02-monitoring-user] Bỏ qua: chưa đặt MYSQL_EXPORTER_PASSWORD"
  exit 0
fi

# Kết nối bằng root qua Unix socket nội bộ của container (không qua mạng).
# Mật khẩu truyền bằng biến MYSQL_PWD để không hiện trên dòng lệnh (ps).
MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot mysql <<-EOSQL
  CREATE USER IF NOT EXISTS 'exporter'@'%'
    IDENTIFIED BY '${MYSQL_EXPORTER_PASSWORD}'
    WITH MAX_USER_CONNECTIONS 3;
  ALTER USER 'exporter'@'%' IDENTIFIED BY '${MYSQL_EXPORTER_PASSWORD}' WITH MAX_USER_CONNECTIONS 3;
  GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'exporter'@'%';
  GRANT SELECT ON performance_schema.* TO 'exporter'@'%';
  FLUSH PRIVILEGES;
EOSQL

echo "[02-monitoring-user] Đã tạo/cập nhật tài khoản 'exporter' cho giám sát"
