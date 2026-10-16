'use strict';

const pool = require('../db');

// Bảng xếp hạng: mỗi học viên lấy lượt làm tốt nhất (điểm cao nhất, nếu bằng nhau thì làm nhanh hơn).
// Dùng window function ROW_NUMBER() của MySQL 8 để chọn lượt tốt nhất của từng người.
async function getLeaderboard(quizId, limit) {
  const [rows] = await pool.query(
    `SELECT u.full_name, u.username, u.student_code, b.score, b.total, b.duration, b.submitted_at
       FROM (SELECT a.user_id, a.score, a.total, a.submitted_at,
                    TIMESTAMPDIFF(SECOND, a.started_at, a.submitted_at) AS duration,
                    ROW_NUMBER() OVER (
                      PARTITION BY a.user_id
                      ORDER BY a.score / a.total DESC, TIMESTAMPDIFF(SECOND, a.started_at, a.submitted_at), a.id
                    ) AS rn
               FROM attempts a
              WHERE a.quiz_id = ? AND a.status = 'submitted' AND a.total > 0) b
       JOIN users u ON u.id = b.user_id
      WHERE b.rn = 1 AND u.role = 'student'
      ORDER BY b.score / b.total DESC, b.duration, b.submitted_at
      LIMIT ?`,
    [quizId, limit]
  );
  return rows;
}

// Tổng hợp điểm của một đề: số lượt, trung bình, cao nhất, thấp nhất, tỉ lệ đạt (>= 5 điểm).
async function getQuizSummary(quizId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS attempts,
            COUNT(DISTINCT user_id) AS students,
            ROUND(AVG(score / total) * 10, 2) AS avg_score,
            ROUND(MAX(score / total) * 10, 2) AS max_score,
            ROUND(MIN(score / total) * 10, 2) AS min_score,
            ROUND(AVG(score / total >= 0.5) * 100, 1) AS pass_rate
       FROM attempts
      WHERE quiz_id = ? AND status = 'submitted' AND total > 0`,
    [quizId]
  );
  return row;
}

// Phân bố điểm theo các mốc 0..10 (điểm hệ 10, làm tròn xuống).
async function getScoreDistribution(quizId) {
  const [rows] = await pool.query(
    `SELECT LEAST(FLOOR(score / total * 10), 10) AS bucket, COUNT(*) AS n
       FROM attempts
      WHERE quiz_id = ? AND status = 'submitted' AND total > 0
      GROUP BY bucket`,
    [quizId]
  );
  const counts = Array(11).fill(0);
  rows.forEach((r) => {
    counts[Number(r.bucket)] = r.n;
  });
  return counts;
}

// Thống kê từng câu: bao nhiêu người trả lời, tỉ lệ đúng, số người chọn mỗi phương án.
async function getQuestionStats(quizId) {
  const [rows] = await pool.query(
    `SELECT q.id, q.content, q.correct_option,
            COUNT(aa.id) AS answered,
            COALESCE(SUM(aa.is_correct), 0) AS correct,
            COALESCE(SUM(aa.selected_option = 'A'), 0) AS a,
            COALESCE(SUM(aa.selected_option = 'B'), 0) AS b,
            COALESCE(SUM(aa.selected_option = 'C'), 0) AS c,
            COALESCE(SUM(aa.selected_option = 'D'), 0) AS d,
            COALESCE(SUM(aa.selected_option IS NULL AND aa.id IS NOT NULL), 0) AS blank
       FROM questions q
       LEFT JOIN attempt_answers aa ON aa.question_id = q.id
      WHERE q.quiz_id = ?
      GROUP BY q.id
      ORDER BY q.id`,
    [quizId]
  );
  // SUM trả về kiểu DECIMAL (chuỗi) -> đổi sang số để tính toán và hiển thị.
  return rows.map((r) => {
    const n = (k) => Number(r[k]);
    const answered = n('answered');
    return {
      ...r,
      answered,
      correct: n('correct'),
      a: n('a'),
      b: n('b'),
      c: n('c'),
      d: n('d'),
      blank: n('blank'),
      correctRate: answered ? Math.round((n('correct') / answered) * 100) : null,
    };
  });
}

module.exports = { getLeaderboard, getQuizSummary, getScoreDistribution, getQuestionStats };
