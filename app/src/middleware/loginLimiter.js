'use strict';

const logger = require('../logger');

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

// Đếm số lần đăng nhập sai theo địa chỉ IP (lưu trong bộ nhớ của tiến trình).
// Sai quá 5 lần trong 15 phút -> tạm khóa đăng nhập từ IP đó, chống dò mật khẩu (brute force).
const failures = new Map();

function recentFailures(ip) {
  const now = Date.now();
  const list = (failures.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(ip, list);
  else failures.delete(ip);
  return list;
}

function check(req, res, next) {
  const list = recentFailures(req.ip);
  if (list.length < MAX_FAILURES) return next();

  const waitMinutes = Math.ceil((WINDOW_MS - (Date.now() - list[0])) / 60000);
  logger.warn('login_blocked', { ip: req.ip, username: req.body && req.body.username });
  return res.status(429).render('login', {
    title: 'Đăng nhập',
    next: '',
    username: '',
    error: `Bạn đã đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${waitMinutes} phút.`,
  });
}

function fail(req) {
  const list = recentFailures(req.ip);
  list.push(Date.now());
  failures.set(req.ip, list);
}

function reset(req) {
  failures.delete(req.ip);
}

// Dọn định kỳ để Map không phình to.
setInterval(() => {
  for (const ip of failures.keys()) recentFailures(ip);
}, WINDOW_MS).unref();

module.exports = { check, fail, reset };
