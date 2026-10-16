'use strict';

const express = require('express');
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { GRACE_SECONDS, startAttempt, submitAttempt, finalizeExpired } = require('../services/attempts');
const { getLeaderboard } = require('../services/stats');
const { toId, cleanText, escapeLike, renderError, setFlash } = require('../utils');

const router = express.Router();

// Lấy đề thi; đề đang ẩn (chưa công khai) chỉ quản trị viên xem được.
async function findVisibleQuiz(id, user) {
  if (!id) return null;
  const [[quiz]] = await pool.query(
    `SELECT q.*, c.name AS category_name,
            (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count
       FROM quizzes q LEFT JOIN categories c ON c.id = q.category_id
      WHERE q.id = ?`,
    [id]
  );
  if (!quiz) return null;
  if (!quiz.is_published && !(user && user.role === 'admin')) return null;
  return quiz;
}

// Lấy lượt làm bài và kiểm tra quyền: chỉ chủ bài làm (hoặc admin) được xem.
async function findOwnAttempt(id, user) {
  if (!id) return null;
  const [[attempt]] = await pool.query(
    `SELECT a.*, TIMESTAMPDIFF(SECOND, NOW(), a.deadline_at) AS remaining,
            TIMESTAMPDIFF(SECOND, a.started_at, a.submitted_at) AS duration,
            q.title AS quiz_title, u.full_name, u.username, u.student_code
       FROM attempts a
       JOIN quizzes q ON q.id = a.quiz_id
       JOIN users u ON u.id = a.user_id
      WHERE a.id = ?`,
    [id]
  );
  if (!attempt) return null;
  if (attempt.user_id !== user.id && user.role !== 'admin') return null;
  return attempt;
}

// Trang chủ: danh sách đề công khai, tìm kiếm theo từ khóa và lọc theo danh mục.
router.get('/', async (req, res) => {
  const q = cleanText(req.query.q, 100);
  const categoryId = toId(req.query.category);

  const where = ['q.is_published = 1'];
  const params = [];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push('(q.title LIKE ? OR q.description LIKE ?)');
    params.push(like, like);
  }
  if (categoryId) {
    where.push('q.category_id = ?');
    params.push(categoryId);
  }

  const [quizzes] = await pool.query(
    `SELECT q.id, q.title, q.description, q.time_limit, q.max_attempts, c.name AS category_name,
            (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count,
            (SELECT COUNT(*) FROM attempts WHERE quiz_id = q.id AND status = 'submitted') AS attempt_count
       FROM quizzes q LEFT JOIN categories c ON c.id = q.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY q.created_at DESC, q.id DESC`,
    params
  );
  const [categories] = await pool.query('SELECT id, name FROM categories ORDER BY name');
  res.render('index', { title: 'Danh sách đề thi', quizzes, categories, q, categoryId });
});

// Trang giới thiệu đề: thông tin, số lượt đã làm, top 5 bảng xếp hạng, nút bắt đầu.
router.get('/quiz/:id', async (req, res) => {
  const quiz = await findVisibleQuiz(toId(req.params.id), req.user);
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  let myAttempts = [];
  if (req.user) {
    await finalizeExpired(req.user.id);
    [myAttempts] = await pool.query(
      `SELECT id, status, score, total, is_late, submitted_at,
              TIMESTAMPDIFF(SECOND, started_at, submitted_at) AS duration
         FROM attempts WHERE user_id = ? AND quiz_id = ? ORDER BY id DESC`,
      [req.user.id, quiz.id]
    );
  }
  const inProgress = myAttempts.find((a) => a.status === 'in_progress');
  const remainingAttempts = quiz.max_attempts > 0 ? Math.max(0, quiz.max_attempts - myAttempts.length) : null;
  const top = await getLeaderboard(quiz.id, 5);

  res.render('quiz-intro', { title: quiz.title, quiz, myAttempts, inProgress, remainingAttempts, top });
});

router.post('/quiz/:id/start', requireLogin, async (req, res) => {
  const quiz = await findVisibleQuiz(toId(req.params.id), req.user);
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  const result = await startAttempt(req.user, quiz);
  if (result.error) {
    setFlash(req, 'error', result.error);
    return res.redirect(303, `/quiz/${quiz.id}`);
  }
  if (result.resumed) setFlash(req, 'info', 'Bạn đang có bài làm dở dang, tiếp tục làm bài.');
  res.redirect(303, `/attempt/${result.attemptId}`);
});

// Trang làm bài: câu hỏi theo thứ tự đã xáo, đồng hồ lấy số giây còn lại từ máy chủ.
router.get('/attempt/:id', requireLogin, async (req, res) => {
  const attempt = await findOwnAttempt(toId(req.params.id), req.user);
  if (!attempt || attempt.user_id !== req.user.id) {
    return renderError(res, 404, 'Không tìm thấy', 'Bài làm không tồn tại.');
  }
  if (attempt.status === 'submitted') return res.redirect(`/result/${attempt.id}`);

  if (attempt.remaining < -GRACE_SECONDS) {
    await submitAttempt(attempt.id, {}, true);
    setFlash(req, 'error', 'Đã hết thời gian làm bài, bài làm đã được đóng.');
    return res.redirect(`/result/${attempt.id}`);
  }

  const order = attempt.question_order;
  const [rows] = await pool.query(
    'SELECT id, content, option_a, option_b, option_c, option_d FROM questions WHERE id IN (?)',
    [order]
  );
  const byId = new Map(rows.map((q) => [q.id, q]));
  const questions = order.map((id) => byId.get(id)).filter(Boolean);

  res.render('attempt', {
    title: attempt.quiz_title,
    attempt,
    questions,
    remaining: Math.max(0, attempt.remaining),
  });
});

router.post('/attempt/:id/submit', requireLogin, async (req, res) => {
  const attempt = await findOwnAttempt(toId(req.params.id), req.user);
  if (!attempt || attempt.user_id !== req.user.id) {
    return renderError(res, 404, 'Không tìm thấy', 'Bài làm không tồn tại.');
  }
  if (attempt.status === 'submitted') return res.redirect(303, `/result/${attempt.id}`);

  // Câu trả lời gửi lên dạng q_<id câu hỏi> = A/B/C/D.
  const answers = {};
  for (const [key, value] of Object.entries(req.body)) {
    const match = /^q_(\d+)$/.exec(key);
    if (match) answers[Number(match[1])] = value;
  }

  const late = attempt.remaining < -GRACE_SECONDS;
  await submitAttempt(attempt.id, answers, late);
  if (late) setFlash(req, 'error', 'Bài nộp quá thời gian cho phép nên không được tính điểm.');
  res.redirect(303, `/result/${attempt.id}`);
});

// Kết quả: điểm và đáp án chi tiết. Chỉ chủ bài làm hoặc quản trị viên được xem.
router.get('/result/:id', requireLogin, async (req, res) => {
  const attempt = await findOwnAttempt(toId(req.params.id), req.user);
  if (!attempt) return renderError(res, 404, 'Không tìm thấy', 'Bài làm không tồn tại.');
  if (attempt.status === 'in_progress') return res.redirect(`/attempt/${attempt.id}`);

  const [details] = await pool.query(
    `SELECT qs.content, qs.option_a, qs.option_b, qs.option_c, qs.option_d, qs.correct_option,
            aa.selected_option, aa.is_correct
       FROM attempt_answers aa JOIN questions qs ON qs.id = aa.question_id
      WHERE aa.attempt_id = ?
      ORDER BY aa.id`,
    [attempt.id]
  );
  res.render('result', { title: 'Kết quả bài làm', attempt, details });
});

// Lịch sử làm bài của học viên đang đăng nhập.
router.get('/me/history', requireLogin, async (req, res) => {
  await finalizeExpired(req.user.id);
  const [attempts] = await pool.query(
    `SELECT a.id, a.quiz_id, a.status, a.score, a.total, a.is_late, a.started_at, a.submitted_at,
            TIMESTAMPDIFF(SECOND, a.started_at, a.submitted_at) AS duration, q.title AS quiz_title
       FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
      WHERE a.user_id = ?
      ORDER BY a.id DESC`,
    [req.user.id]
  );
  const done = attempts.filter((a) => a.status === 'submitted' && a.total > 0);
  const avg = done.length ? done.reduce((s, a) => s + (a.score / a.total) * 10, 0) / done.length : null;
  res.render('history', { title: 'Lịch sử làm bài', attempts, doneCount: done.length, avg });
});

router.get('/quiz/:id/leaderboard', requireLogin, async (req, res) => {
  const quiz = await findVisibleQuiz(toId(req.params.id), req.user);
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');
  const rows = await getLeaderboard(quiz.id, 50);
  res.render('leaderboard', { title: `Bảng xếp hạng: ${quiz.title}`, quiz, rows });
});

module.exports = router;
