'use strict';

const crypto = require('crypto');
const logger = require('../logger');

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Chống CSRF: mỗi phiên có một mã bí mật ngẫu nhiên, được nhúng vào mọi form (input ẩn _csrf).
// Request thay đổi dữ liệu (POST) phải gửi kèm đúng mã này. Trang web lạ không đọc được mã
// nên không thể giả mạo form gửi thay người dùng.
function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.includes(req.method)) return next();

  const token = req.body && req.body._csrf;
  if (typeof token === 'string' && safeEqual(token, req.session.csrfToken)) return next();

  logger.warn('csrf_rejected', { method: req.method, path: req.originalUrl, ip: req.ip });
  return res.status(403).render('error', {
    title: 'Yêu cầu không hợp lệ',
    message: 'Phiên làm việc đã hết hạn hoặc biểu mẫu không hợp lệ. Vui lòng tải lại trang và thử lại.',
  });
}

module.exports = csrf;
