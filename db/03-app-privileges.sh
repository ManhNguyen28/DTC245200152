#!/bin/bash
# HARDENING CSDL - nguyên tắc QUYỀN TỐI THIỂU (least privilege).
# 1. Tài khoản ứng dụng ($MYSQL_USER) mặc định được image MySQL cấp ALL PRIVILEGES trên CSDL.
#    Ứng dụng chỉ cần đọc/ghi dữ liệu (bảng đã tạo sẵn trong init.sql) -> chỉ cấp SELECT, INSERT, UPDATE, DELETE.
#    Lỗ hổng SQL injection (nếu có) cũng không thể DROP / ALTER bảng hay cấp quyền cho tài khoản khác.
# 2. Tài khoản root chỉ được đăng nhập từ BÊN TRONG container (root@localhost), không từ mạng
#    (vd không đăng nhập root qua phpMyAdmin được).
# - MySQL tự chạy file này (sau 01, 02) ở lần khởi động đầu tiên, khi volume dữ liệu còn trống.
# - Có thể chạy lại trên CSDL đang hoạt động:
#     docker exec quiz-db bash /docker-entrypoint-initdb.d/03-app-privileges.sh
set -e

MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot mysql <<-EOSQL
  REVOKE ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* FROM '${MYSQL_USER}'@'%';
  GRANT SELECT, INSERT, UPDATE, DELETE ON \`${MYSQL_DATABASE}\`.* TO '${MYSQL_USER}'@'%';
  ALTER USER '${MYSQL_USER}'@'%' WITH MAX_USER_CONNECTIONS 20;

  DROP USER IF EXISTS 'root'@'%';
  FLUSH PRIVILEGES;
EOSQL

echo "[03-app-privileges] '${MYSQL_USER}' chỉ còn SELECT/INSERT/UPDATE/DELETE; root chỉ đăng nhập từ localhost"
