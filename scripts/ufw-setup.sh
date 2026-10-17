#!/usr/bin/env bash
# HARDENING MÁY CHỦ: tường lửa UFW theo nguyên tắc "chặn mặc định, chỉ mở cổng cần thiết".
# Cách dùng (trên máy chủ Ubuntu):  sudo bash scripts/ufw-setup.sh
#
# Lưu ý về Docker: cổng được publish trong docker-compose (ports:) do Docker tự mở bằng iptables,
# ĐI VÒNG QUA UFW. Vì vậy hệ thống Quiz chỉ publish đúng 80/443 (Nginx); mọi dịch vụ khác chỉ "expose"
# trong mạng Docker nội bộ. UFW bảo vệ các dịch vụ chạy trực tiếp trên máy chủ (SSH, FTP...).
set -e

if [ "$(id -u)" -ne 0 ]; then
  echo "Cần chạy bằng quyền root: sudo bash $0" >&2
  exit 1
fi

command -v ufw >/dev/null || apt-get install -y ufw

echo "===== QUY TẮC CŨ (trước khi cấu hình) ====="
ufw status numbered || true

# Xóa toàn bộ quy tắc cũ (UFW tự sao lưu vào /etc/ufw/*.rules.<thời gian>) rồi đặt lại từ đầu,
# tránh quy tắc cũ (vd cho phép FTP cổng 21) vẫn còn hiệu lực.
ufw --force reset

ufw default deny incoming                       # chặn mọi kết nối vào...
ufw default allow outgoing                      # ...cho phép máy chủ kết nối ra (cập nhật, tải image)

ufw limit 22/tcp comment 'SSH - quan tri (gioi han toc do chong do mat khau)'
ufw allow 80/tcp  comment 'HTTP - chuyen huong sang HTTPS'
ufw allow 443/tcp comment 'HTTPS - Nginx reverse proxy'

ufw logging on
ufw --force enable                              # bật (SSH đã được cho phép ở trên nên không mất kết nối)

echo "===== QUY TẮC MỚI ====="
ufw status verbose
