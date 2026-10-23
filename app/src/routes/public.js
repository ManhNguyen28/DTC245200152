'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const logger = require('../logger');
const { requireLogin } = require('../middleware/auth');
const { GRACE_SECONDS, startAttempt, submitAttempt, finalizeExpired } = require('../services/attempts');
const { getLeaderboard } = require('../services/stats');
const { certificateCode, parseCode, verifySignature } = require('../services/certificates');
const { audit } = require('../services/audit');
const { toId, cleanText, escapeLike, renderError, setFlash, quizStatus, isPassed } = require('../utils');

const router = express.Router();

// Lấy đề thi; đề đang ẩn (chưa công khai) chỉ quản trị viên xem được.
async function findVisibleQuiz(id, user) {
  if (!id) return null;
  const [[quiz]] = await pool.query(
    `SELECT q.*, c.name AS category_name, c.icon AS category_icon,
            (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count
       FROM quizzes q LEFT JOIN categories c ON c.id = q.category_id
      WHERE q.id = ?`,
    [id]
  );
  if (!quiz) return null;
  if (!quiz.is_published && !(user && user.role === 'admin')) return null;
  quiz.status = quizStatus(quiz);
  quiz.has_code = Boolean(quiz.access_code_hash);
  quiz.per_attempt = quiz.questions_per_attempt > 0 ? Math.min(quiz.questions_per_attempt, quiz.question_count) : quiz.question_count;
  return quiz;
}

// Lấy lượt làm bài và kiểm tra quyền: chỉ chủ bài làm (hoặc admin) được xem.
async function findOwnAttempt(id, user) {
  if (!id) return null;
  const [[attempt]] = await pool.query(
    `SELECT a.*, TIMESTAMPDIFF(SECOND, NOW(), a.deadline_at) AS remaining,
            TIMESTAMPDIFF(SECOND, a.started_at, a.submitted_at) AS duration,
            q.title AS quiz_title, q.pass_score, u.full_name, u.username, u.student_code
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

// ===================== TRANG CHỦ =====================
// Landing page: số liệu nổi bật, danh mục, danh sách đề (tìm kiếm / lọc), bảng vàng học viên.
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

  const userId = req.user ? req.user.id : 0;
  const [quizzes] = await pool.query(
    `SELECT q.id, q.title, q.description, q.time_limit, q.max_attempts, q.questions_per_attempt, q.pass_score,
            q.opens_at, q.closes_at, (q.access_code_hash IS NOT NULL) AS has_code,
            c.name AS category_name, c.icon AS category_icon,
            (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count,
            (SELECT COUNT(*) FROM attempts WHERE quiz_id = q.id AND status = 'submitted') AS attempt_count,
            (SELECT ROUND(MAX(score / total) * 10, 2) FROM attempts
              WHERE quiz_id = q.id AND user_id = ? AND status = 'submitted' AND total > 0) AS my_best
       FROM quizzes q LEFT JOIN categories c ON c.id = q.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY q.created_at DESC, q.id DESC`,
    [userId, ...params]
  );
  quizzes.forEach((quiz) => {
    quiz.status = quizStatus(quiz);
    quiz.per_attempt = quiz.questions_per_attempt > 0 ? Math.min(quiz.questions_per_attempt, quiz.question_count) : quiz.question_count;
  });

  const [categories] = await pool.query(
    `SELECT c.id, c.name, c.icon, COUNT(q.id) AS quiz_count
       FROM categories c LEFT JOIN quizzes q ON q.category_id = c.id AND q.is_published = 1
      GROUP BY c.id ORDER BY c.name`
  );
  const [[stats]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM quizzes WHERE is_published = 1) AS quizzes,
            (SELECT COUNT(*) FROM questions) AS questions,
            (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
            (SELECT COUNT(*) FROM attempts WHERE status = 'submitted') AS attempts`
  );
  // Bảng vàng: học viên có điểm trung bình cao nhất (ít nhất 2 bài đã nộp)
  const [topStudents] = await pool.query(
    `SELECT u.full_name, COUNT(*) AS attempts, ROUND(AVG(a.score / a.total) * 10, 2) AS avg_score
       FROM attempts a JOIN users u ON u.id = a.user_id
      WHERE a.status = 'submitted' AND a.total > 0 AND u.role = 'student'
      GROUP BY u.id HAVING attempts >= 2
      ORDER BY avg_score DESC, attempts DESC LIMIT 5`
  );

  res.render('index', { title: 'Trang chủ', quizzes, categories, stats, topStudents, q, categoryId });
});

// ===================== ĐỀ THI =====================
// Trang giới thiệu đề: thông tin, lịch mở/đóng, mã phòng thi, lượt đã làm, top 5.
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
    myAttempts.forEach((a) => {
      a.passed = a.status === 'submitted' && isPassed(a, quiz.pass_score);
    });
  }
  const inProgress = myAttempts.find((a) => a.status === 'in_progress');
  const remainingAttempts = quiz.max_attempts > 0 ? Math.max(0, quiz.max_attempts - myAttempts.length) : null;
  const top = await getLeaderboard(quiz.id, 5);

  res.render('quiz-intro', { title: quiz.title, quiz, myAttempts, inProgress, remainingAttempts, top });
});

router.post('/quiz/:id/start', requireLogin, async (req, res) => {
  const quiz = await findVisibleQuiz(toId(req.params.id), req.user);
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  const [[current]] = await pool.query(
    "SELECT id FROM attempts WHERE user_id = ? AND quiz_id = ? AND status = 'in_progress' AND deadline_at > NOW() LIMIT 1",
    [req.user.id, quiz.id]
  );
  // Bài đang làm dở thì cho làm tiếp; còn lượt mới thì kiểm tra lịch thi và mã phòng thi.
  if (!current) {
    if (quiz.status === 'upcoming') {
      setFlash(req, 'error', 'Đề thi chưa đến giờ mở.');
      return res.redirect(303, `/quiz/${quiz.id}`);
    }
    if (quiz.status === 'closed') {
      setFlash(req, 'error', 'Đề thi đã đóng.');
      return res.redirect(303, `/quiz/${quiz.id}`);
    }
    if (quiz.has_code) {
      const code = cleanText(req.body.access_code, 50);
      if (!code || !(await bcrypt.compare(code, quiz.access_code_hash))) {
        logger.warn('access_code_failed', { quiz_id: quiz.id, user: req.user.username, ip: req.ip });
        await audit(req, 'access_code_failed', `Nhập sai mã phòng thi đề #${quiz.id}`);
        setFlash(req, 'error', 'Mã vào phòng thi không đúng.');
        return res.redirect(303, `/quiz/${quiz.id}`);
      }
    }
  }

  const result = await startAttempt(req.user, quiz);
  if (result.error) {
    setFlash(req, 'error', result.error);
    return res.redirect(303, `/quiz/${quiz.id}`);
  }
  if (result.resumed) setFlash(req, 'info', 'Bạn đang có bài làm dở dang, tiếp tục làm bài.');
  res.redirect(303, `/attempt/${result.attemptId}`);
});

// ===================== LÀM BÀI =====================
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
    'SELECT id, content, option_a, option_b, option_c, option_d, difficulty FROM questions WHERE id IN (?)',
    [order]
  );
  const byId = new Map(rows.map((q) => [q.id, q]));
  const questions = order.map((id) => byId.get(id)).filter(Boolean);

  res.render('attempt', { title: attempt.quiz_title, attempt, questions, remaining: Math.max(0, attempt.remaining) });
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

// ===================== KẾT QUẢ =====================
// Điểm, đáp án chi tiết kèm giải thích. Chỉ chủ bài làm hoặc quản trị viên được xem.
router.get('/result/:id', requireLogin, async (req, res) => {
  const attempt = await findOwnAttempt(toId(req.params.id), req.user);
  if (!attempt) return renderError(res, 404, 'Không tìm thấy', 'Bài làm không tồn tại.');
  if (attempt.status === 'in_progress') return res.redirect(`/attempt/${attempt.id}`);

  const [details] = await pool.query(
    `SELECT qs.content, qs.option_a, qs.option_b, qs.option_c, qs.option_d, qs.correct_option,
            qs.explanation, qs.difficulty, aa.selected_option, aa.is_correct
       FROM attempt_answers aa JOIN questions qs ON qs.id = aa.question_id
      WHERE aa.attempt_id = ?
      ORDER BY aa.id`,
    [attempt.id]
  );
  const passed = isPassed(attempt, attempt.pass_score);
  res.render('result', { title: 'Kết quả bài làm', attempt, details, passed });
});

// ===================== GIẤY CHỨNG NHẬN =====================
router.get('/certificate/:id', requireLogin, async (req, res) => {
  const attempt = await findOwnAttempt(toId(req.params.id), req.user);
  if (!attempt || attempt.status !== 'submitted') return renderError(res, 404, 'Không tìm thấy', 'Bài làm không tồn tại.');
  if (!isPassed(attempt, attempt.pass_score)) {
    return renderError(res, 403, 'Chưa đạt yêu cầu', `Cần đạt tối thiểu ${Number(attempt.pass_score)} điểm để nhận giấy chứng nhận.`);
  }
  const code = certificateCode(attempt.id, attempt.user_id);
  logger.info('certificate_viewed', { attempt_id: attempt.id, user: req.user.username });
  res.render('certificate', { title: 'Giấy chứng nhận', attempt, code });
});

// Trang công khai: ai có mã đều kiểm tra được giấy chứng nhận là thật hay giả.
router.get('/verify', async (req, res) => {
  const raw = cleanText(req.query.code, 40);
  let result = null;
  if (raw) {
    const parsed = parseCode(raw);
    let attempt = null;
    if (parsed) {
      [[attempt]] = await pool.query(
        `SELECT a.id, a.user_id, a.score, a.total, a.is_late, a.submitted_at, a.status,
                q.title AS quiz_title, q.pass_score, u.full_name, u.student_code
           FROM attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN users u ON u.id = a.user_id
          WHERE a.id = ?`,
        [parsed.attemptId]
      );
    }
    const valid = Boolean(
      attempt && attempt.status === 'submitted' && verifySignature(parsed, attempt.user_id) && isPassed(attempt, attempt.pass_score)
    );
    logger.info('certificate_verified', { code: raw, valid });
    result = { code: raw, valid, attempt: valid ? attempt : null };
  }
  res.render('verify', { title: 'Xác thực giấy chứng nhận', result });
});

// ===================== BẢNG XẾP HẠNG =====================
router.get('/quiz/:id/leaderboard', requireLogin, async (req, res) => {
  const quiz = await findVisibleQuiz(toId(req.params.id), req.user);
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');
  const rows = await getLeaderboard(quiz.id, 50);
  res.render('leaderboard', { title: `Bảng xếp hạng: ${quiz.title}`, quiz, rows });
});

module.exports = router;
