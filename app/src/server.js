'use strict';

const path = require('path');
const os = require('os');
const express = require('express');
const pool = require('./db');
const logger = require('./logger');
const { ensureAdmin } = require('./bootstrap');
const sessionMiddleware = require('./middleware/session');
const csrf = require('./middleware/csrf');
const { loadUser, requireAdmin } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const { formatDate, formatDuration, score10 } = require('./utils');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by'); // không để lộ "Express" trong header phản hồi

// Chạy sau Nginx: tin header X-Forwarded-For / X-Forwarded-Proto của đúng số lớp proxy khai báo.
// Nhờ đó req.ip là IP thật của người dùng (không phải IP của Nginx) và req.secure = true khi dùng HTTPS
// (bắt buộc để cookie "secure" được gửi). Không đặt biến này khi chạy trực tiếp không qua proxy.
const trustProxy = Number(process.env.TRUST_PROXY);
if (trustProxy > 0) app.set('trust proxy', trustProxy);

// Biến và hàm dùng chung cho mọi view. hostname = ID container khi chạy trong Docker.
app.locals.hostname = os.hostname();
app.locals.formatDate = formatDate;
app.locals.formatDuration = formatDuration;
app.locals.score10 = score10;

// 1. File tĩnh (CSS, JS): trả về ngay, không cần session hay đăng nhập.
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// 2. Ghi log mỗi request khi phản hồi xong (phương thức, đường dẫn, mã trạng thái, thời gian xử lý).
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/health') return;
    logger.info('http_request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100,
      ip: req.ip,
      user: req.user ? req.user.username : undefined,
    });
  });
  next();
});

// 3. Kiểm tra sức khỏe: ứng dụng còn sống và kết nối được CSDL (dùng cho healthcheck/giám sát).
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'up' });
  } catch (err) {
    logger.error('health_check_failed', { error: err.message });
    res.status(503).json({ status: 'error', db: 'down' });
  }
});

// 4. Phiên đăng nhập -> đọc dữ liệu form -> kiểm tra CSRF -> thông báo flash -> nạp người dùng.
app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(csrf);
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});
app.use(loadUser);

// 5. Các trang của ứng dụng. Khu vực /admin chỉ dành cho quản trị viên.
app.use('/', authRoutes);
app.use('/', publicRoutes);
app.use('/admin', requireAdmin, adminRoutes);

// 6. Không khớp route nào -> 404; lỗi không lường trước -> 500 (ghi log chi tiết, không lộ cho người dùng).
app.use((req, res) => {
  res.status(404).render('error', { title: 'Không tìm thấy', message: 'Trang bạn yêu cầu không tồn tại.' });
});

app.use((err, req, res, next) => {
  logger.error('unhandled_error', { method: req.method, path: req.originalUrl, error: err.message, stack: err.stack });
  if (res.headersSent) return next(err);
  res.status(500).render('error', { title: 'Lỗi hệ thống', message: 'Đã xảy ra lỗi, vui lòng thử lại sau.' });
});

let server;

// Dừng êm khi Docker gửi SIGTERM (docker stop): ngừng nhận request, đóng kết nối DB rồi thoát.
function shutdown(signal) {
  logger.info('server_stopping', { signal });
  if (!server) process.exit(0);
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

ensureAdmin()
  .then(() => {
    server = app.listen(PORT, () => logger.info('server_started', { port: PORT }));
  })
  .catch((err) => {
    logger.error('startup_failed', { error: err.message });
    process.exit(1);
  });
