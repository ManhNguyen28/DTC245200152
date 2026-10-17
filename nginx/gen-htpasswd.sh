#!/usr/bin/env sh
# Tạo file mật khẩu cho HTTP Basic Auth của Nginx (bảo vệ trang /prometheus/).
# Đọc MONITOR_USER / MONITOR_PASSWORD từ file .env; mật khẩu được băm (apr1), không lưu dạng gốc.
# Cách dùng (tại thư mục gốc dự án):  sh nginx/gen-htpasswd.sh
set -e

cd "$(dirname "$0")/.."
. ./.env

if [ -z "$MONITOR_USER" ] || [ -z "$MONITOR_PASSWORD" ]; then
  echo "Thiếu MONITOR_USER hoặc MONITOR_PASSWORD trong .env" >&2
  exit 1
fi

mkdir -p nginx/auth
printf '%s:%s\n' "$MONITOR_USER" "$(openssl passwd -apr1 "$MONITOR_PASSWORD")" > nginx/auth/.htpasswd
chmod 644 nginx/auth/.htpasswd
echo "Đã tạo nginx/auth/.htpasswd cho tài khoản '$MONITOR_USER'"
