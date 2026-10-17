#!/usr/bin/env sh
# Tạo chứng chỉ SSL tự ký (self-signed) cho Nginx.
# Cách dùng:  sh nginx/gen-cert.sh <IP hoặc tên miền máy chủ>
# Ví dụ:      sh nginx/gen-cert.sh 192.168.146.128
#
# Khóa bí mật (server.key) KHÔNG đưa lên GitHub (đã khai báo trong .gitignore);
# mỗi máy chủ tự sinh cặp khóa của riêng mình.
set -e

HOST="${1:-localhost}"
DIR="$(dirname "$0")/certs"
mkdir -p "$DIR"

# Tên trong chứng chỉ (Subject Alternative Name) phải khớp địa chỉ người dùng gõ trên trình duyệt.
case "$HOST" in
  *[!0-9.]*) SAN="DNS:$HOST,DNS:localhost,IP:127.0.0.1" ;;   # tên miền
  *)         SAN="IP:$HOST,DNS:localhost,IP:127.0.0.1" ;;    # địa chỉ IP
esac

openssl req -x509 -nodes -newkey rsa:2048 -sha256 -days 365 \
  -keyout "$DIR/server.key" -out "$DIR/server.crt" \
  -subj "/C=VN/ST=Thai Nguyen/L=Thai Nguyen/O=ICTU/OU=DTC245200152/CN=$HOST" \
  -addext "subjectAltName=$SAN" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"

chmod 600 "$DIR/server.key"
chmod 644 "$DIR/server.crt"

# Container nginx bỏ mọi capability (cap_drop: ALL), kể cả CAP_DAC_OVERRIDE -> root trong container
# không còn "vượt" được phân quyền file. Khóa bí mật phải thuộc sở hữu root (uid 0) để nginx đọc được.
if [ "$(id -u)" -ne 0 ]; then
  if sudo -n true 2>/dev/null; then
    sudo chown 0:0 "$DIR/server.key"
  else
    docker run --rm -v "$(cd "$DIR" && pwd):/certs" alpine:latest chown 0:0 /certs/server.key
  fi
fi

echo "Đã tạo chứng chỉ cho $HOST (hiệu lực 365 ngày):"
openssl x509 -in "$DIR/server.crt" -noout -subject -dates -ext subjectAltName
