'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const logger = require('../logger');
const loginLimiter = require('../middleware/loginLimiter');
const metrics = require('../metrics');
const { cleanText, safeNext, setFlash } = require('../utils');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;
// Băm giả để thời gian phản hồi như nhau dù tài khoản có tồn tại hay không
// (tránh kẻ tấn công đo thời gian để dò tên đăng nhập).
const DUMMY_HASH = bcrypt.hashSync('khong-phai-mat-khau-that', 10);

// Đổi session id sau khi đăng nhập (chống session fixation).
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Đăng nhập', next: safeNext(req.query.next), username: '' });
});

router.post('/login', loginLimiter.check, async (req, res) => {
  const username = cleanText(req.body.username, 30);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const next = safeNext(req.body.next);

  const [[user]] = username
    ? await pool.query('SELECT id, username, password_hash, role FROM users WHERE username = ?', [username])
    : [[]];
  const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

  if (!user || !valid) {
    loginLimiter.fail(req);
    metrics.loginAttempts.inc({ result: 'failed' });
    logger.warn('login_failed', { username, ip: req.ip });
    return res.status(401).render('login', {
      title: 'Đăng nhập',
      next,
      username,
      error: 'Tên đăng nhập hoặc mật khẩu không đúng.',
    });
  }

  loginLimiter.reset(req);
  await regenerateSession(req);
  req.session.userId = user.id;
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  metrics.loginAttempts.inc({ result: 'success' });
  logger.info('login_success', { username: user.username, role: user.role, ip: req.ip });
  res.redirect(303, next || (user.role === 'admin' ? '/admin' : '/'));
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { title: 'Đăng ký tài khoản', values: {}, errors: [] });
});

router.post('/register', async (req, res) => {
  const values = {
    username: cleanText(req.body.username, 30),
    full_name: cleanText(req.body.full_name, 100),
    student_code: cleanText(req.body.student_code, 20),
  };
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const confirm = typeof req.body.password_confirm === 'string' ? req.body.password_confirm : '';

  const errors = [];
  if (!USERNAME_RE.test(values.username)) {
    errors.push('Tên đăng nhập dài 3–30 ký tự, chỉ gồm chữ không dấu, số, dấu chấm hoặc gạch dưới.');
  }
  if (values.full_name.length < 2) errors.push('Vui lòng nhập họ và tên.');
  if (password.length < 8 || password.length > 72) errors.push('Mật khẩu phải dài từ 8 đến 72 ký tự.');
  else if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) errors.push('Mật khẩu phải có cả chữ và số.');
  if (password !== confirm) errors.push('Mật khẩu nhập lại không khớp.');

  if (!errors.length) {
    try {
      const hash = await bcrypt.hash(password, 10);
      const [result] = await pool.query(
        "INSERT INTO users (username, password_hash, full_name, student_code, role) VALUES (?, ?, ?, ?, 'student')",
        [values.username, hash, values.full_name, values.student_code || null]
      );
      metrics.registrations.inc();
      logger.info('user_registered', { user_id: result.insertId, username: values.username, ip: req.ip });

      await regenerateSession(req);
      req.session.userId = result.insertId;
      setFlash(req, 'success', `Chào mừng ${values.full_name}! Tài khoản đã được tạo.`);
      return res.redirect(303, '/');
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      errors.push('Tên đăng nhập đã có người sử dụng.');
    }
  }
  res.status(400).render('register', { title: 'Đăng ký tài khoản', values, errors });
});

router.post('/logout', (req, res, next) => {
  const username = req.user && req.user.username;
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('quiz.sid');
    logger.info('logout', { username });
    res.redirect(303, '/');
  });
});

module.exports = router;
