# Image nền: Node.js 22 LTS trên Alpine Linux (gọn nhẹ, ít lỗ hổng)
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Copy package*.json trước để tận dụng cache: chỉ cài lại thư viện khi danh sách phụ thuộc thay đổi.
# Cài thư viện bằng root -> thư mục node_modules thuộc root, tiến trình ứng dụng chỉ ĐỌC được.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
    # HARDENING: xóa trình quản lý gói (npm, npx, yarn, corepack) - chỉ cần lúc build, không cần lúc chạy.
    # Giảm bề mặt tấn công: Trivy báo 11 lỗ hổng HIGH nằm trong chính npm đi kèm image gốc.
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* /root/.npm

# Copy mã nguồn: chủ sở hữu root, quyền chỉ đọc cho người khác (644 file / 755 thư mục).
COPY src ./src
COPY public ./public
RUN chmod -R a-w /app

# HARDENING: chạy ứng dụng bằng user thường "node" (uid 1000) thay vì root.
# Nếu ứng dụng bị chiếm quyền, kẻ tấn công không có quyền root và không sửa được mã nguồn.
USER node

EXPOSE 3000

# Docker tự kiểm tra sức khỏe: gọi /health (kiểm tra cả kết nối CSDL) mỗi 30 giây.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
