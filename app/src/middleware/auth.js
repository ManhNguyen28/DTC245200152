'use strict';

const pool = require('../db');
const { setFlash } = require('../utils');

// Nạp thông tin người dùng đang đăng nhập (nếu có) cho mọi request.
async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (req.session.userId) {
    const [[user]] = await pool.query(
      'SELECT id, username, full_name, student_code, role, is_locked FROM users WHERE id = ?',
      [req.session.userId]
    );
    if (user && !user.is_locked) {
      req.user = user;
      res.locals.currentUser = user;
    } else {
      // Tài khoản bị xóa hoặc bị quản trị viên khóa -> đăng xuất ngay ở request kế tiếp.
      delete req.session.userId;
      if (user) setFlash(req, 'error', 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.');
    }
  }
  next();
}

// Bắt buộc đăng nhập; chưa đăng nhập thì chuyển tới trang đăng nhập rồi quay lại trang đang xem.
function requireLogin(req, res, next) {
  if (req.user) return next();
  setFlash(req, 'info', 'Vui lòng đăng nhập để tiếp tục.');
  const nextUrl = req.method === 'GET' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
  return res.redirect(303, `/login${nextUrl}`);
}

// Chỉ quản trị viên được vào khu vực /admin (phân quyền theo vai trò).
function requireAdmin(req, res, next) {
  if (!req.user) return requireLogin(req, res, next);
  if (req.user.role === 'admin') return next();
  return res.status(403).render('error', {
    title: 'Không có quyền truy cập',
    message: 'Chức năng này chỉ dành cho quản trị viên.',
  });
}

module.exports = { loadUser, requireLogin, requireAdmin };
