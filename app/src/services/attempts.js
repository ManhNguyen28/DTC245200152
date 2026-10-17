'use strict';

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../logger');
const metrics = require('../metrics');
const { OPTIONS } = require('../utils');

// Cho phép nộp trễ tối đa 30 giây so với hạn (bù độ trễ mạng / tự nộp khi hết giờ).
const GRACE_SECONDS = 30;

// Xáo trộn mảng (Fisher-Yates) với bộ sinh số ngẫu nhiên an toàn.
function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Chấm điểm và đóng một lượt làm bài. Nộp quá hạn (late = true) thì bỏ qua mọi câu trả lời.
// Dùng transaction + khóa dòng (FOR UPDATE) để một bài không bị nộp/chấm hai lần.
async function submitAttempt(attemptId, answers, late) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[attempt]] = await conn.query(
      "SELECT id, quiz_id, user_id, question_order FROM attempts WHERE id = ? AND status = 'in_progress' FOR UPDATE",
      [attemptId]
    );
    if (!attempt) {
      await conn.rollback();
      return null;
    }

    const order = attempt.question_order;
    const [questions] = order.length
      ? await conn.query('SELECT id, correct_option FROM questions WHERE id IN (?)', [order])
      : [[]];
    const correct = new Map(questions.map((q) => [q.id, q.correct_option]));

    // Giữ đúng thứ tự câu hỏi thí sinh đã thấy; câu bị admin xóa giữa chừng thì bỏ qua.
    const rows = order
      .filter((id) => correct.has(id))
      .map((id) => {
        const value = late ? null : answers[id];
        const selected = OPTIONS.includes(value) ? value : null;
        return [attempt.id, id, selected, selected !== null && selected === correct.get(id)];
      });
    const score = rows.filter((r) => r[3]).length;

    if (rows.length) {
      await conn.query(
        'INSERT INTO attempt_answers (attempt_id, question_id, selected_option, is_correct) VALUES ?',
        [rows]
      );
    }
    await conn.query(
      `UPDATE attempts
          SET status = 'submitted', score = ?, total = ?, is_late = ?,
              submitted_at = LEAST(NOW(), DATE_ADD(deadline_at, INTERVAL ? SECOND))
        WHERE id = ?`,
      [score, rows.length, late, GRACE_SECONDS, attempt.id]
    );
    await conn.commit();

    const result = { attemptId: attempt.id, quizId: attempt.quiz_id, userId: attempt.user_id, score, total: rows.length, late };
    metrics.submissions.inc({ late: String(Boolean(late)) });
    logger.info('quiz_submitted', {
      attempt_id: attempt.id,
      quiz_id: attempt.quiz_id,
      user_id: attempt.user_id,
      score,
      total: rows.length,
      late,
    });
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Đóng các lượt làm bài đã quá hạn mà thí sinh bỏ dở (đóng tab, mất mạng...).
async function finalizeExpired(userId) {
  const [rows] = await pool.query(
    `SELECT id FROM attempts
      WHERE user_id = ? AND status = 'in_progress' AND NOW() > DATE_ADD(deadline_at, INTERVAL ? SECOND)`,
    [userId, GRACE_SECONDS]
  );
  for (const row of rows) await submitAttempt(row.id, {}, true);
}

// Bắt đầu (hoặc tiếp tục) một lượt làm bài.
// Trả về { attemptId } hoặc { error } nếu không được phép làm bài.
async function startAttempt(user, quiz) {
  await finalizeExpired(user.id);

  // Đang có bài dở dang và còn hạn -> làm tiếp, không tạo lượt mới.
  const [[current]] = await pool.query(
    "SELECT id FROM attempts WHERE user_id = ? AND quiz_id = ? AND status = 'in_progress' LIMIT 1",
    [user.id, quiz.id]
  );
  if (current) return { attemptId: current.id, resumed: true };

  if (quiz.max_attempts > 0) {
    const [[{ used }]] = await pool.query('SELECT COUNT(*) AS used FROM attempts WHERE user_id = ? AND quiz_id = ?', [
      user.id,
      quiz.id,
    ]);
    if (used >= quiz.max_attempts) {
      return { error: `Bạn đã dùng hết ${quiz.max_attempts} lượt làm bài của đề này.` };
    }
  }

  const [questions] = await pool.query('SELECT id FROM questions WHERE quiz_id = ? ORDER BY id', [quiz.id]);
  if (!questions.length) return { error: 'Đề thi này chưa có câu hỏi nào.' };

  const ids = questions.map((q) => q.id);
  const order = quiz.shuffle_questions ? shuffle(ids) : ids;

  // Hạn nộp do máy chủ tính (NOW() của MySQL) -> sửa đồng hồ máy tính không có tác dụng.
  const [result] = await pool.query(
    `INSERT INTO attempts (quiz_id, user_id, question_order, total, started_at, deadline_at)
     VALUES (?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [quiz.id, user.id, JSON.stringify(order), order.length, quiz.time_limit]
  );
  metrics.attemptsStarted.inc();
  logger.info('attempt_started', { attempt_id: result.insertId, quiz_id: quiz.id, user_id: user.id });
  return { attemptId: result.insertId, resumed: false };
}

module.exports = { GRACE_SECONDS, startAttempt, submitAttempt, finalizeExpired };
