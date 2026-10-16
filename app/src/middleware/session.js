'use strict';

const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const pool = require('../db');

const EIGHT_HOURS = 8 * 60 * 60 * 1000;

if (!process.env.SESSION_SECRET) {
  throw new Error('Thiếu biến môi trường SESSION_SECRET');
}

// Lưu phiên đăng nhập trong bảng `sessions` của MySQL (dùng chung connection pool của ứng dụng).
// Bảng đã tạo sẵn trong init.sql nên không cần quyền CREATE cho tài khoản ứng dụng.
const store = new MySQLStore(
  {
    createDatabaseTable: false,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: EIGHT_HOURS,
  },
  pool
);

module.exports = session({
  name: 'quiz.sid',
  secret: process.env.SESSION_SECRET, // khóa ký cookie, chống giả mạo session id
  store,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true, // JavaScript trên trang không đọc được cookie (giảm thiệt hại khi bị XSS)
    sameSite: 'lax', // trình duyệt không gửi cookie kèm form POST từ trang web khác
    secure: process.env.COOKIE_SECURE === 'true', // chỉ gửi cookie qua HTTPS (bật khi có Nginx + TLS)
    maxAge: EIGHT_HOURS,
  },
});
