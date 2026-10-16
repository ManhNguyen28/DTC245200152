'use strict';

const crypto = require('crypto');
const logger = require('../logger');

// So sánh chuỗi trong thời gian không đổi để tránh tấn công dò mật khẩu theo thời gian (timing attack).
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Bảo vệ khu vực /admin bằng HTTP Basic Auth, tài khoản lấy từ biến môi trường.
function adminAuth(req, res, next) {
  const expectedUser = process.env.ADMIN_USER;
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (expectedUser && expectedPassword) {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const [user, ...rest] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
      if (safeEqual(user, expectedUser) && safeEqual(rest.join(':'), expectedPassword)) {
        return next();
      }
      logger.warn('admin_login_failed', { user, ip: req.ip });
    }
  } else {
    logger.error('admin_credentials_not_configured');
  }

  res.set('WWW-Authenticate', 'Basic realm="Quiz Admin", charset="UTF-8"');
  return res.status(401).send('Yêu cầu đăng nhập quản trị.');
}

module.exports = adminAuth;
