'use strict';

const express = require('express');
const pool = require('../db');
const logger = require('../logger');
const { OPTIONS, toId, cleanText, renderError } = require('../utils');

const router = express.Router();

async function findQuiz(id) {
  const [[quiz]] = await pool.query('SELECT id, title, description, time_limit FROM quizzes WHERE id = ?', [id]);
  return quiz;
}

// Trang chủ: danh sách đề thi kèm số câu hỏi.
router.get('/', async (req, res) => {
  const [quizzes] = await pool.query(
    `SELECT q.id, q.title, q.description, q.time_limit, COUNT(qs.id) AS question_count
       FROM quizzes q
       LEFT JOIN questions qs ON qs.quiz_id = q.id
      GROUP BY q.id
      ORDER BY q.created_at DESC, q.id DESC`
  );
  res.render('index', { title: 'Danh sách đề thi', quizzes });
});

// Trang làm bài. Không gửi đáp án đúng xuống trình duyệt.
router.get('/quiz/:id', async (req, res) => {
  const id = toId(req.params.id);
  const quiz = id && (await findQuiz(id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  const [questions] = await pool.query(
    'SELECT id, content, option_a, option_b, option_c, option_d FROM questions WHERE quiz_id = ? ORDER BY id',
    [id]
  );
  if (!questions.length) return renderError(res, 400, 'Chưa có câu hỏi', 'Đề thi này chưa có câu hỏi nào.');

  res.render('quiz', { title: quiz.title, quiz, questions });
});

// Nộp bài: chấm điểm phía máy chủ, lưu bài làm trong một transaction.
router.post('/quiz/:id/submit', async (req, res) => {
  const id = toId(req.params.id);
  const quiz = id && (await findQuiz(id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  const studentName = cleanText(req.body.student_name, 100) || 'Ẩn danh';
  const studentCode = cleanText(req.body.student_code, 20) || null;

  const [questions] = await pool.query('SELECT id, correct_option FROM questions WHERE quiz_id = ? ORDER BY id', [id]);
  if (!questions.length) return renderError(res, 400, 'Chưa có câu hỏi', 'Đề thi này chưa có câu hỏi nào.');

  const answers = questions.map((q) => {
    const value = req.body[`q_${q.id}`];
    const selected = OPTIONS.includes(value) ? value : null;
    return { questionId: q.id, selected, isCorrect: selected === q.correct_option };
  });
  const score = answers.filter((a) => a.isCorrect).length;

  const conn = await pool.getConnection();
  let attemptId;
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      'INSERT INTO attempts (quiz_id, student_name, student_code, score, total) VALUES (?, ?, ?, ?, ?)',
      [id, studentName, studentCode, score, questions.length]
    );
    attemptId = result.insertId;
    await conn.query('INSERT INTO attempt_answers (attempt_id, question_id, selected_option, is_correct) VALUES ?', [
      answers.map((a) => [attemptId, a.questionId, a.selected, a.isCorrect]),
    ]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  logger.info('quiz_submitted', {
    quiz_id: id,
    attempt_id: attemptId,
    student: studentName,
    score,
    total: questions.length,
  });
  res.redirect(303, `/result/${attemptId}`);
});

// Kết quả bài làm: điểm và chi tiết từng câu (đáp án đã chọn / đáp án đúng).
router.get('/result/:id', async (req, res) => {
  const id = toId(req.params.id);
  const [[attempt]] = id
    ? await pool.query(
        `SELECT a.*, q.title AS quiz_title
           FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
          WHERE a.id = ?`,
        [id]
      )
    : [[]];
  if (!attempt) return renderError(res, 404, 'Không tìm thấy', 'Bài làm không tồn tại.');

  const [details] = await pool.query(
    `SELECT qs.content, qs.option_a, qs.option_b, qs.option_c, qs.option_d, qs.correct_option,
            aa.selected_option, aa.is_correct
       FROM attempt_answers aa JOIN questions qs ON qs.id = aa.question_id
      WHERE aa.attempt_id = ?
      ORDER BY qs.id`,
    [id]
  );
  res.render('result', { title: 'Kết quả bài làm', attempt, details });
});

module.exports = router;
