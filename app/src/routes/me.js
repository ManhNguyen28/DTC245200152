'use strict';

// Khu vực cá nhân của người dùng đã đăng nhập: lịch sử + biểu đồ tiến bộ, hồ sơ, đổi mật khẩu, ôn tập câu sai.
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const logger = require('../logger');
const { requireLogin } = require('../middleware/auth');
const { finalizeExpired } = require('../services/attempts');
const { audit } = require('../services/audit');
const { OPTIONS, cleanText, setFlash, isPassed } = require('../utils');

const router = express.Router();
router.use(requireLogin);

// Tọa độ biểu đồ đường (SVG) điểm của tối đa 20 bài gần nhất, theo thứ tự thời gian.
function buildChart(done) {
  const items = done.slice(0, 20).reverse();
  const W = 640;
  const H = 220;
  const pad = { left: 36, right: 24, top: 30, bottom: 28 };
  const x = (i) => (items.length <= 1 ? pad.left + (W - pad.left - pad.right) / 2
    : pad.left + (i * (W - pad.left - pad.right)) / (items.length - 1));
  const y = (v) => pad.top + ((10 - v) * (H - pad.top - pad.bottom)) / 10;
  const points = items.map((a, i) => ({
    x: Math.round(x(i)), y: Math.round(y((a.score / a.total) * 10)),
    label: ((a.score / a.total) * 10).toFixed(1), title: a.quiz_title,
  }));
  return {
    W, H, pad, points,
    line: points.map((p) => `${p.x},${p.y}`).join(' '),
    grid: [0, 2, 4, 6, 8, 10].map((v) => ({ v, y: Math.round(y(v)) })),
    passY: Math.round(y(5)),
  };
}

// ===================== LỊCH SỬ & TIẾN BỘ =====================
router.get('/history', async (req, res) => {
  await finalizeExpired(req.user.id);
  const [attempts] = await pool.query(
    `SELECT a.id, a.quiz_id, a.status, a.score, a.total, a.is_late, a.started_at, a.submitted_at,
            TIMESTAMPDIFF(SECOND, a.started_at, a.submitted_at) AS duration, q.title AS quiz_title, q.pass_score
       FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
      WHERE a.user_id = ?
      ORDER BY a.id DESC`,
    [req.user.id]
  );
  attempts.forEach((a) => {
    a.passed = a.status === 'submitted' && isPassed(a, a.pass_score);
  });
  const done = attempts.filter((a) => a.status === 'submitted' && a.total > 0);
  const avg = done.length ? done.reduce((s, a) => s + (a.score / a.total) * 10, 0) / done.length : null;
  const best = done.length ? Math.max(...done.map((a) => (a.score / a.total) * 10)) : null;
  const passedCount = done.filter((a) => a.passed).length;
  res.render('history', {
    title: 'Lịch sử & tiến bộ', attempts, doneCount: done.length, avg, best, passedCount,
    chart: done.length ? buildChart(done) : null,
  });
});

// ===================== HỒ SƠ & MẬT KHẨU =====================
router.get('/profile', async (req, res) => {
  const [[profile]] = await pool.query(
    'SELECT username, full_name, student_code, role, created_at, last_login_at FROM users WHERE id = ?',
    [req.user.id]
  );
  res.render('profile', { title: 'Hồ sơ cá nhân', profile, errors: [] });
});

router.post('/profile', async (req, res) => {
  const fullName = cleanText(req.body.full_name, 100);
  const studentCode = cleanText(req.body.student_code, 20) || null;
  if (fullName.length < 2) {
    setFlash(req, 'error', 'Vui lòng nhập họ và tên.');
    return res.redirect(303, '/me/profile');
  }
  await pool.query('UPDATE users SET full_name = ?, student_code = ? WHERE id = ?', [fullName, studentCode, req.user.id]);
  logger.info('profile_updated', { user: req.user.username });
  await audit(req, 'profile_updated', 'Cập nhật hồ sơ cá nhân');
  setFlash(req, 'success', 'Đã cập nhật hồ sơ.');
  res.redirect(303, '/me/profile');
});

router.post('/password', async (req, res) => {
  const current = typeof req.body.current_password === 'string' ? req.body.current_password : '';
  const password = typeof req.body.new_password === 'string' ? req.body.new_password : '';
  const confirm = typeof req.body.confirm_password === 'string' ? req.body.confirm_password : '';

  const [[row]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  let error = null;
  if (!(await bcrypt.compare(current, row.password_hash))) error = 'Mật khẩu hiện tại không đúng.';
  else if (password.length < 8 || password.length > 72) error = 'Mật khẩu mới phải dài từ 8 đến 72 ký tự.';
  else if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) error = 'Mật khẩu mới phải có cả chữ và số.';
  else if (password !== confirm) error = 'Mật khẩu nhập lại không khớp.';
  else if (password === current) error = 'Mật khẩu mới phải khác mật khẩu hiện tại.';

  if (error) {
    logger.warn('password_change_failed', { user: req.user.username, ip: req.ip });
    setFlash(req, 'error', error);
    return res.redirect(303, '/me/profile');
  }
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 10), req.user.id]);
  logger.info('password_changed', { user: req.user.username, ip: req.ip });
  await audit(req, 'password_changed', 'Tự đổi mật khẩu');
  setFlash(req, 'success', 'Đã đổi mật khẩu.');
  res.redirect(303, '/me/profile');
});

// ===================== ÔN TẬP CÂU SAI =====================
// Các câu mà lần trả lời GẦN NHẤT của học viên là sai (trả lời đúng ở lần sau thì tự rời danh sách).
async function wrongQuestions(userId) {
  const [rows] = await pool.query(
    `SELECT q.id, q.content, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option,
            q.explanation, q.difficulty, qz.title AS quiz_title, last.selected_option
       FROM (SELECT aa.question_id, MAX(aa.id) AS last_id
               FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
              WHERE a.user_id = ? AND a.status = 'submitted' AND a.is_late = 0
              GROUP BY aa.question_id) t
       JOIN attempt_answers last ON last.id = t.last_id
       JOIN questions q ON q.id = t.question_id
       JOIN quizzes qz ON qz.id = q.quiz_id
      WHERE last.is_correct = 0
      ORDER BY last.id DESC
      LIMIT 50`,
    [userId]
  );
  return rows;
}

router.get('/review', async (req, res) => {
  const questions = await wrongQuestions(req.user.id);
  res.render('review', { title: 'Ôn tập câu làm sai', questions });
});

// Luyện tập lại các câu sai: chấm ngay, KHÔNG lưu vào kết quả thi.
router.post('/practice', async (req, res) => {
  const questions = await wrongQuestions(req.user.id);
  const results = questions.map((q) => {
    const value = req.body[`q_${q.id}`];
    const selected = OPTIONS.includes(value) ? value : null;
    return { ...q, practice: selected, correct: selected === q.correct_option };
  });
  const score = results.filter((r) => r.correct).length;
  logger.info('practice_checked', { user: req.user.username, score, total: results.length });
  res.render('practice-result', { title: 'Kết quả luyện tập', results, score });
});

module.exports = router;
