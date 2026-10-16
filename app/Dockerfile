# Image nền: Node.js 22 LTS trên Alpine Linux (gọn nhẹ, ít lỗ hổng)
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Copy package*.json trước để tận dụng cache: chỉ cài lại thư viện khi danh sách phụ thuộc thay đổi
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy mã nguồn
COPY src ./src
COPY public ./public

EXPOSE 3000
CMD ["node", "src/server.js"]
