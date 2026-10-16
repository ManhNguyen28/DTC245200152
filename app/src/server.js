'use strict';

const path = require('path');
const os = require('os');
const express = require('express');
const pool = require('./db');
const logger = require('./logger');
const adminAuth = require('./middleware/auth');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const { formatDate } = require('./utils');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by'); // không để lộ "Express" trong header phản hồi

// Biến dùng chung cho mọi view. hostname = ID container khi chạy trong Docker.
app.locals.hostname = os.hostname();
app.locals.formatDate = formatDate;

app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// Ghi log mỗi request khi phản hồi xong (phương thức, đường dẫn, mã trạng thái, thời gian xử lý).
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
    });
  });
  next();
});

// Kiểm tra sức khỏe: ứng dụng còn sống và kết nối được CSDL.
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'up' });
  } catch (err) {
    logger.error('health_check_failed', { error: err.message });
    res.status(503).json({ status: 'error', db: 'down' });
  }
});

app.use('/', publicRoutes);
app.use('/admin', adminAuth, adminRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Không tìm thấy', message: 'Trang bạn yêu cầu không tồn tại.' });
});

app.use((err, req, res, next) => {
  logger.error('unhandled_error', { method: req.method, path: req.originalUrl, error: err.message, stack: err.stack });
  if (res.headersSent) return next(err);
  res.status(500).render('error', { title: 'Lỗi hệ thống', message: 'Đã xảy ra lỗi, vui lòng thử lại sau.' });
});

const server = app.listen(PORT, () => logger.info('server_started', { port: PORT }));

// Dừng êm khi Docker gửi SIGTERM (docker stop): ngừng nhận request, đóng kết nối DB rồi thoát.
function shutdown(signal) {
  logger.info('server_stopping', { signal });
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
