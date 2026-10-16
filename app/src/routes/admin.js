'use strict';

const express = require('express');
const pool = require('../db');
const logger = require('../logger');
const { OPTIONS, toId, cleanText, renderError } = require('../utils');

const router = express.Router();

async function findQuiz(id) {
  const [[quiz]] = await pool.query('SELECT * FROM quizzes WHERE id = ?', [id]);
  return quiz;
}

// Bảng điều khiển: danh sách đề + 10 lượt làm bài gần nhất.
router.get('/', async (req, res) => {
  const [quizzes] = await pool.query(
    `SELECT q.id, q.title, q.time_limit, q.created_at,
            (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count,
            (SELECT COUNT(*) FROM attempts WHERE quiz_id = q.id) AS attempt_count
       FROM quizzes q
      ORDER BY q.created_at DESC, q.id DESC`
  );
  const [recent] = await pool.query(
    `SELECT a.id, a.student_name, a.student_code, a.score, a.total, a.submitted_at, q.title AS quiz_title
       FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
      ORDER BY a.submitted_at DESC, a.id DESC
      LIMIT 10`
  );
  res.render('admin/index', { title: 'Quản trị', quizzes, recent });
});

router.get('/quizzes/new', (req, res) => {
  res.render('admin/quiz-form', { title: 'Tạo đề thi mới' });
});

router.post('/quizzes', async (req, res) => {
  const title = cleanText(req.body.title, 200);
  const description = cleanText(req.body.description, 1000) || null;
  const minutes = Number.parseInt(req.body.time_limit, 10);
  const timeLimit = Number.isInteger(minutes) && minutes >= 1 && minutes <= 180 ? minutes : 15;
  if (!title) return renderError(res, 400, 'Dữ liệu không hợp lệ', 'Tiêu đề đề thi không được để trống.');

  const [result] = await pool.query('INSERT INTO quizzes (title, description, time_limit) VALUES (?, ?, ?)', [
    title,
    description,
    timeLimit,
  ]);
  logger.info('quiz_created', { quiz_id: result.insertId, title });
  res.redirect(303, `/admin/quizzes/${result.insertId}`);
});

// Quản lý câu hỏi của một đề.
router.get('/quizzes/:id', async (req, res) => {
  const id = toId(req.params.id);
  const quiz = id && (await findQuiz(id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  const [questions] = await pool.query('SELECT * FROM questions WHERE quiz_id = ? ORDER BY id', [id]);
  res.render('admin/quiz', { title: `Đề: ${quiz.title}`, quiz, questions });
});

router.post('/quizzes/:id/questions', async (req, res) => {
  const id = toId(req.params.id);
  const quiz = id && (await findQuiz(id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  const content = cleanText(req.body.content, 1000);
  const options = OPTIONS.map((o) => cleanText(req.body[`option_${o.toLowerCase()}`], 255));
  const correct = req.body.correct_option;
  if (!content || options.some((o) => !o) || !OPTIONS.includes(correct)) {
    return renderError(res, 400, 'Dữ liệu không hợp lệ', 'Cần nhập nội dung câu hỏi, đủ 4 phương án và chọn đáp án đúng.');
  }

  const [result] = await pool.query(
    `INSERT INTO questions (quiz_id, content, option_a, option_b, option_c, option_d, correct_option)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, content, ...options, correct]
  );
  logger.info('question_added', { quiz_id: id, question_id: result.insertId });
  res.redirect(303, `/admin/quizzes/${id}`);
});

router.post('/questions/:id/delete', async (req, res) => {
  const id = toId(req.params.id);
  const [[question]] = id ? await pool.query('SELECT quiz_id FROM questions WHERE id = ?', [id]) : [[]];
  if (!question) return renderError(res, 404, 'Không tìm thấy', 'Câu hỏi không tồn tại.');

  await pool.query('DELETE FROM questions WHERE id = ?', [id]);
  logger.warn('question_deleted', { quiz_id: question.quiz_id, question_id: id });
  res.redirect(303, `/admin/quizzes/${question.quiz_id}`);
});

router.post('/quizzes/:id/delete', async (req, res) => {
  const id = toId(req.params.id);
  const quiz = id && (await findQuiz(id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  await pool.query('DELETE FROM quizzes WHERE id = ?', [id]);
  logger.warn('quiz_deleted', { quiz_id: id, title: quiz.title });
  res.redirect(303, '/admin');
});

// Thống kê kết quả của một đề.
router.get('/quizzes/:id/results', async (req, res) => {
  const id = toId(req.params.id);
  const quiz = id && (await findQuiz(id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  const [[stats]] = await pool.query(
    `SELECT COUNT(*) AS attempts,
            ROUND(AVG(score / total) * 10, 2) AS avg_score,
            ROUND(MAX(score / total) * 10, 2) AS max_score
       FROM attempts WHERE quiz_id = ?`,
    [id]
  );
  const [attempts] = await pool.query(
    'SELECT * FROM attempts WHERE quiz_id = ? ORDER BY submitted_at DESC, id DESC',
    [id]
  );
  res.render('admin/results', { title: `Kết quả: ${quiz.title}`, quiz, stats, attempts });
});

module.exports = router;
