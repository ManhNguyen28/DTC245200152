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

echo "Đã tạo chứng chỉ cho $HOST (hiệu lực 365 ngày):"
openssl x509 -in "$DIR/server.crt" -noout -subject -dates -ext subjectAltName
