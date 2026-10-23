'use strict';

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const logger = require('../logger');
const { parseCsv, toCsv } = require('../services/csv');
const { audit } = require('../services/audit');
const { getLeaderboard, getQuizSummary, getScoreDistribution, getQuestionStats } = require('../services/stats');
const { CATEGORY_ICONS } = require('../icons');
const {
  OPTIONS,
  TIME_ZONE,
  DIFFICULTY,
  toId,
  cleanText,
  toIntInRange,
  renderError,
  setFlash,
  formatDate,
  score10,
  vnInputToDate,
  quizStatus,
} = require('../utils');

const router = express.Router();
const MAX_IMPORT_ROWS = 500;

async function findQuiz(id) {
  if (!id) return null;
  const [[quiz]] = await pool.query(
    'SELECT q.*, c.name AS category_name FROM quizzes q LEFT JOIN categories c ON c.id = q.category_id WHERE q.id = ?',
    [id]
  );
  return quiz;
}

async function listCategories() {
  const [rows] = await pool.query('SELECT id, name FROM categories ORDER BY name');
  return rows;
}

// Đọc và kiểm tra dữ liệu form đề thi (dùng chung cho tạo mới và sửa). Trả về { data, error }.
function readQuizForm(body) {
  const score = Number.parseFloat(body.pass_score);
  const data = {
    title: cleanText(body.title, 200),
    description: cleanText(body.description, 1000) || null,
    category_id: toId(body.category_id),
    time_limit: toIntInRange(body.time_limit, 1, 180, 15),
    max_attempts: toIntInRange(body.max_attempts, 0, 50, 0),
    questions_per_attempt: toIntInRange(body.questions_per_attempt, 0, 200, 0),
    pass_score: Number.isFinite(score) && score >= 0 && score <= 10 ? Math.round(score * 4) / 4 : 5,
    shuffle_questions: body.shuffle_questions === '1',
    is_published: body.is_published === '1',
    opens_at: vnInputToDate(body.opens_at),
    closes_at: vnInputToDate(body.closes_at),
  };
  let error = null;
  if (!data.title) error = 'Tiêu đề đề thi không được để trống.';
  else if (data.opens_at && data.closes_at && data.closes_at <= data.opens_at) error = 'Thời điểm đóng đề phải sau thời điểm mở đề.';
  return { data, error };
}

// Mã vào phòng thi: nhập mã mới -> băm bcrypt; tích "bỏ mã" -> xóa; để trống -> giữ nguyên.
async function accessCodeChange(body) {
  if (body.remove_code === '1') return { access_code_hash: null };
  const code = cleanText(body.access_code, 50);
  if (code) return { access_code_hash: await bcrypt.hash(code, 10) };
  return {};
}

// Đọc và kiểm tra một câu hỏi; trả về null nếu thiếu dữ liệu.
function readQuestion(content, options, correct, explanation, difficulty) {
  const q = {
    content: cleanText(content, 1000),
    options: options.map((o) => cleanText(o, 255)),
    correct: cleanText(correct, 1).toUpperCase(),
    explanation: cleanText(explanation, 1000) || null,
    difficulty: Object.keys(DIFFICULTY).includes(cleanText(difficulty, 10)) ? cleanText(difficulty, 10) : 'medium',
  };
  if (!q.content || q.options.some((o) => !o) || !OPTIONS.includes(q.correct)) return null;
  return q;
}

const questionRow = (quizId, q) => [quizId, q.content, ...q.options, q.correct, q.explanation, q.difficulty];
const QUESTION_COLUMNS = '(quiz_id, content, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty)';

// ======================= TỔNG QUAN =======================
router.get('/', async (req, res) => {
  const [[totals]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
            (SELECT COUNT(*) FROM quizzes) AS quizzes,
            (SELECT COUNT(*) FROM questions) AS questions,
            (SELECT COUNT(*) FROM attempts WHERE status = 'submitted') AS attempts,
            (SELECT ROUND(AVG(score / total) * 10, 2) FROM attempts WHERE status = 'submitted' AND total > 0) AS avg_score`
  );

  // Số lượt nộp bài 7 ngày gần nhất (tính theo ngày giờ Việt Nam).
  const [daily] = await pool.query(
    `SELECT DATE_FORMAT(CONVERT_TZ(submitted_at, '+00:00', '+07:00'), '%Y-%m-%d') AS day, COUNT(*) AS n
       FROM attempts
      WHERE status = 'submitted' AND submitted_at >= UTC_TIMESTAMP() - INTERVAL 8 DAY
      GROUP BY day`
  );
  const counts = new Map(daily.map((d) => [d.day, d.n]));
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 86400000);
    const key = date.toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
    const label = date.toLocaleDateString('vi-VN', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit' });
    days.push({ label, n: counts.get(key) || 0 });
  }

  const [topQuizzes] = await pool.query(
    `SELECT q.id, q.title, COUNT(a.id) AS attempts, ROUND(AVG(a.score / a.total) * 10, 2) AS avg_score
       FROM quizzes q
       JOIN attempts a ON a.quiz_id = q.id AND a.status = 'submitted' AND a.total > 0
      GROUP BY q.id
      ORDER BY attempts DESC
      LIMIT 5`
  );
  const [recent] = await pool.query(
    `SELECT a.id, a.score, a.total, a.is_late, a.submitted_at, q.title AS quiz_title, u.full_name, u.student_code
       FROM attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN users u ON u.id = a.user_id
      WHERE a.status = 'submitted'
      ORDER BY a.submitted_at DESC, a.id DESC
      LIMIT 8`
  );
  const [events] = await pool.query(
    'SELECT username, action, detail, ip, created_at FROM audit_logs ORDER BY id DESC LIMIT 6'
  );
  res.render('admin/dashboard', { title: 'Tổng quan', totals, days, topQuizzes, recent, events });
});

// ======================= ĐỀ THI =======================
router.get('/quizzes', async (req, res) => {
  const [quizzes] = await pool.query(
    `SELECT q.id, q.title, q.time_limit, q.max_attempts, q.questions_per_attempt, q.is_published, q.opens_at, q.closes_at,
            (q.access_code_hash IS NOT NULL) AS has_code, c.name AS category_name,
            (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count,
            (SELECT COUNT(*) FROM attempts WHERE quiz_id = q.id AND status = 'submitted') AS attempt_count
       FROM quizzes q LEFT JOIN categories c ON c.id = q.category_id
      ORDER BY q.created_at DESC, q.id DESC`
  );
  quizzes.forEach((q) => {
    q.status = quizStatus(q);
  });
  res.render('admin/quizzes', { title: 'Quản lý đề thi', quizzes });
});

router.get('/quizzes/new', async (req, res) => {
  res.render('admin/quiz-form', {
    title: 'Tạo đề thi mới',
    quiz: { time_limit: 15, max_attempts: 0, questions_per_attempt: 0, pass_score: 5, shuffle_questions: true, is_published: false },
    categories: await listCategories(),
  });
});

router.post('/quizzes', async (req, res) => {
  const { data, error } = readQuizForm(req.body);
  if (error) return renderError(res, 400, 'Dữ liệu không hợp lệ', error);

  const [result] = await pool.query('INSERT INTO quizzes SET ?', [{ ...data, ...(await accessCodeChange(req.body)) }]);
  logger.info('quiz_created', { quiz_id: result.insertId, title: data.title, by: req.user.username });
  await audit(req, 'quiz_created', `Tạo đề #${result.insertId} "${data.title}"`);
  setFlash(req, 'success', 'Đã tạo đề thi. Hãy thêm câu hỏi rồi bật "Công khai" để học viên làm bài.');
  res.redirect(303, `/admin/quizzes/${result.insertId}`);
});

router.get('/quizzes/:id/edit', async (req, res) => {
  const quiz = await findQuiz(toId(req.params.id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');
  res.render('admin/quiz-form', { title: 'Sửa đề thi', quiz, categories: await listCategories() });
});

router.post('/quizzes/:id', async (req, res) => {
  const quiz = await findQuiz(toId(req.params.id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');
  const { data, error } = readQuizForm(req.body);
  if (error) return renderError(res, 400, 'Dữ liệu không hợp lệ', error);

  const codeChange = await accessCodeChange(req.body);
  await pool.query('UPDATE quizzes SET ? WHERE id = ?', [{ ...data, ...codeChange }, quiz.id]);
  logger.info('quiz_updated', { quiz_id: quiz.id, by: req.user.username });
  const codeNote = 'access_code_hash' in codeChange ? (codeChange.access_code_hash ? ', đặt mã phòng thi mới' : ', bỏ mã phòng thi') : '';
  await audit(req, 'quiz_updated', `Sửa đề #${quiz.id} "${data.title}"${codeNote}`);
  setFlash(req, 'success', 'Đã lưu thay đổi.');
  res.redirect(303, `/admin/quizzes/${quiz.id}`);
});

router.post('/quizzes/:id/delete', async (req, res) => {
  const quiz = await findQuiz(toId(req.params.id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  await pool.query('DELETE FROM quizzes WHERE id = ?', [quiz.id]);
  logger.warn('quiz_deleted', { quiz_id: quiz.id, title: quiz.title, by: req.user.username });
  await audit(req, 'quiz_deleted', `Xóa đề #${quiz.id} "${quiz.title}"`);
  setFlash(req, 'success', `Đã xóa đề "${quiz.title}".`);
  res.redirect(303, '/admin/quizzes');
});

// Nhân bản đề (kèm toàn bộ câu hỏi). Bản sao ở trạng thái ẩn, không mang theo mã phòng thi và lịch thi.
router.post('/quizzes/:id/duplicate', async (req, res) => {
  const quiz = await findQuiz(toId(req.params.id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  const conn = await pool.getConnection();
  let newId;
  try {
    await conn.beginTransaction();
    const [result] = await conn.query('INSERT INTO quizzes SET ?', [{
      category_id: quiz.category_id,
      title: `${quiz.title} (bản sao)`.slice(0, 200),
      description: quiz.description,
      time_limit: quiz.time_limit,
      max_attempts: quiz.max_attempts,
      questions_per_attempt: quiz.questions_per_attempt,
      pass_score: quiz.pass_score,
      shuffle_questions: quiz.shuffle_questions,
      is_published: false,
    }]);
    newId = result.insertId;
    await conn.query(
      `INSERT INTO questions ${QUESTION_COLUMNS}
       SELECT ?, content, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty
         FROM questions WHERE quiz_id = ? ORDER BY id`,
      [newId, quiz.id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  logger.info('quiz_duplicated', { from: quiz.id, to: newId, by: req.user.username });
  await audit(req, 'quiz_duplicated', `Nhân bản đề #${quiz.id} thành #${newId}`);
  setFlash(req, 'success', 'Đã nhân bản đề thi (bản sao đang ẩn).');
  res.redirect(303, `/admin/quizzes/${newId}`);
});

// ======================= CÂU HỎI =======================
router.get('/quizzes/:id', async (req, res) => {
  const quiz = await findQuiz(toId(req.params.id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');
  const [questions] = await pool.query('SELECT * FROM questions WHERE quiz_id = ? ORDER BY id', [quiz.id]);
  quiz.status = quizStatus(quiz);
  res.render('admin/quiz', { title: `Đề: ${quiz.title}`, quiz, questions });
});

router.post('/quizzes/:id/questions', async (req, res) => {
  const quiz = await findQuiz(toId(req.params.id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  const b = req.body;
  const q = readQuestion(b.content, [b.option_a, b.option_b, b.option_c, b.option_d], b.correct_option, b.explanation, b.difficulty);
  if (!q) {
    setFlash(req, 'error', 'Cần nhập nội dung câu hỏi, đủ 4 phương án và chọn đáp án đúng.');
    return res.redirect(303, `/admin/quizzes/${quiz.id}`);
  }
  const [result] = await pool.query(`INSERT INTO questions ${QUESTION_COLUMNS} VALUES (?)`, [questionRow(quiz.id, q)]);
  logger.info('question_added', { quiz_id: quiz.id, question_id: result.insertId, by: req.user.username });
  await audit(req, 'question_added', `Thêm câu hỏi #${result.insertId} vào đề #${quiz.id}`);
  setFlash(req, 'success', 'Đã thêm câu hỏi.');
  res.redirect(303, `/admin/quizzes/${quiz.id}`);
});

router.get('/questions/:id/edit', async (req, res) => {
  const id = toId(req.params.id);
  const [[question]] = id ? await pool.query('SELECT * FROM questions WHERE id = ?', [id]) : [[]];
  if (!question) return renderError(res, 404, 'Không tìm thấy', 'Câu hỏi không tồn tại.');
  const quiz = await findQuiz(question.quiz_id);
  res.render('admin/question-form', { title: 'Sửa câu hỏi', quiz, question });
});

router.post('/questions/:id', async (req, res) => {
  const id = toId(req.params.id);
  const [[question]] = id ? await pool.query('SELECT id, quiz_id FROM questions WHERE id = ?', [id]) : [[]];
  if (!question) return renderError(res, 404, 'Không tìm thấy', 'Câu hỏi không tồn tại.');

  const b = req.body;
  const q = readQuestion(b.content, [b.option_a, b.option_b, b.option_c, b.option_d], b.correct_option, b.explanation, b.difficulty);
  if (!q) {
    setFlash(req, 'error', 'Cần nhập nội dung câu hỏi, đủ 4 phương án và chọn đáp án đúng.');
    return res.redirect(303, `/admin/questions/${id}/edit`);
  }
  await pool.query(
    `UPDATE questions SET content = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?, correct_option = ?,
            explanation = ?, difficulty = ? WHERE id = ?`,
    [q.content, ...q.options, q.correct, q.explanation, q.difficulty, id]
  );
  logger.info('question_updated', { quiz_id: question.quiz_id, question_id: id, by: req.user.username });
  await audit(req, 'question_updated', `Sửa câu hỏi #${id} (đề #${question.quiz_id})`);
  setFlash(req, 'success', 'Đã cập nhật câu hỏi.');
  res.redirect(303, `/admin/quizzes/${question.quiz_id}`);
});

router.post('/questions/:id/delete', async (req, res) => {
  const id = toId(req.params.id);
  const [[question]] = id ? await pool.query('SELECT quiz_id FROM questions WHERE id = ?', [id]) : [[]];
  if (!question) return renderError(res, 404, 'Không tìm thấy', 'Câu hỏi không tồn tại.');

  await pool.query('DELETE FROM questions WHERE id = ?', [id]);
  logger.warn('question_deleted', { quiz_id: question.quiz_id, question_id: id, by: req.user.username });
  await audit(req, 'question_deleted', `Xóa câu hỏi #${id} (đề #${question.quiz_id})`);
  setFlash(req, 'success', 'Đã xóa câu hỏi.');
  res.redirect(303, `/admin/quizzes/${question.quiz_id}`);
});

// ======================= NHẬP / XUẤT CÂU HỎI (CSV) =======================
router.get('/quizzes/:id/import', async (req, res) => {
  const quiz = await findQuiz(toId(req.params.id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');
  res.render('admin/import', { title: 'Nhập câu hỏi từ CSV', quiz, errors: [], csvText: '' });
});

router.post('/quizzes/:id/import', async (req, res) => {
  const quiz = await findQuiz(toId(req.params.id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  const csvText = typeof req.body.csv_text === 'string' ? req.body.csv_text : '';
  const delimiter = req.body.delimiter === ';' ? ';' : ',';
  const rows = parseCsv(csvText, delimiter);
  if (req.body.has_header === '1') rows.shift();

  // Kiểm tra toàn bộ trước; có lỗi thì không nhập dòng nào (tất cả hoặc không gì cả).
  // Mỗi dòng: 6 cột bắt buộc + 2 cột tùy chọn (giải thích, độ khó easy/medium/hard).
  const errors = [];
  const questions = [];
  if (!rows.length) errors.push('Không có dòng dữ liệu nào.');
  if (rows.length > MAX_IMPORT_ROWS) errors.push(`Tối đa ${MAX_IMPORT_ROWS} câu hỏi mỗi lần nhập.`);
  rows.slice(0, MAX_IMPORT_ROWS).forEach((r, i) => {
    const line = i + (req.body.has_header === '1' ? 2 : 1);
    if (r.length < 6 || r.length > 8) {
      errors.push(`Dòng ${line}: cần 6 đến 8 cột, đang có ${r.length} cột.`);
      return;
    }
    const q = readQuestion(r[0], r.slice(1, 5), r[5], r[6], (r[7] || '').trim().toLowerCase());
    if (!q) errors.push(`Dòng ${line}: thiếu nội dung/phương án hoặc đáp án không thuộc A, B, C, D.`);
    else questions.push(q);
  });

  if (errors.length) {
    return res.status(400).render('admin/import', { title: 'Nhập câu hỏi từ CSV', quiz, errors, csvText });
  }

  await pool.query(`INSERT INTO questions ${QUESTION_COLUMNS} VALUES ?`, [questions.map((q) => questionRow(quiz.id, q))]);
  logger.info('questions_imported', { quiz_id: quiz.id, count: questions.length, by: req.user.username });
  await audit(req, 'questions_imported', `Nhập ${questions.length} câu hỏi từ CSV vào đề #${quiz.id}`);
  setFlash(req, 'success', `Đã nhập ${questions.length} câu hỏi từ CSV.`);
  res.redirect(303, `/admin/quizzes/${quiz.id}`);
});

// Xuất câu hỏi ra CSV đúng định dạng nhập -> sao lưu, chỉnh sửa bằng Excel rồi nhập lại.
router.get('/quizzes/:id/questions.csv', async (req, res) => {
  const quiz = await findQuiz(toId(req.params.id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');
  const [questions] = await pool.query('SELECT * FROM questions WHERE quiz_id = ? ORDER BY id', [quiz.id]);
  const rows = [
    ['content', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_option', 'explanation', 'difficulty'],
    ...questions.map((q) => [q.content, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.explanation || '', q.difficulty]),
  ];
  await audit(req, 'questions_exported', `Xuất ${questions.length} câu hỏi của đề #${quiz.id}`);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="cau-hoi-de-${quiz.id}.csv"`);
  res.send(toCsv(rows));
});

// ======================= KẾT QUẢ & THỐNG KÊ =======================
async function listResults(quizId) {
  const [rows] = await pool.query(
    `SELECT a.id, a.score, a.total, a.is_late, a.started_at, a.submitted_at,
            TIMESTAMPDIFF(SECOND, a.started_at, a.submitted_at) AS duration,
            u.full_name, u.username, u.student_code
       FROM attempts a JOIN users u ON u.id = a.user_id
      WHERE a.quiz_id = ? AND a.status = 'submitted'
      ORDER BY a.submitted_at DESC, a.id DESC`,
    [quizId]
  );
  return rows;
}

router.get('/quizzes/:id/results', async (req, res) => {
  const quiz = await findQuiz(toId(req.params.id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');
  res.render('admin/results', {
    title: `Kết quả: ${quiz.title}`,
    quiz,
    summary: await getQuizSummary(quiz.id),
    attempts: await listResults(quiz.id),
  });
});

// Xuất bảng điểm ra file CSV (mở được bằng Excel).
router.get('/quizzes/:id/results.csv', async (req, res) => {
  const quiz = await findQuiz(toId(req.params.id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');

  const attempts = await listResults(quiz.id);
  const passScore = Number(quiz.pass_score);
  const rows = [
    ['STT', 'Họ và tên', 'Tên đăng nhập', 'Mã SV', 'Số câu đúng', 'Tổng số câu', 'Điểm hệ 10', 'Kết quả', 'Nộp trễ', 'Bắt đầu', 'Nộp bài', 'Thời gian làm (giây)'],
    ...attempts.map((a, i) => [
      i + 1,
      a.full_name,
      a.username,
      a.student_code || '',
      a.score,
      a.total,
      score10(a.score, a.total),
      !a.is_late && a.total > 0 && (a.score / a.total) * 10 >= passScore ? 'Đạt' : 'Chưa đạt',
      a.is_late ? 'Có' : 'Không',
      formatDate(a.started_at),
      formatDate(a.submitted_at),
      a.duration,
    ]),
  ];
  logger.info('results_exported', { quiz_id: quiz.id, rows: attempts.length, by: req.user.username });
  await audit(req, 'results_exported', `Xuất bảng điểm đề #${quiz.id} (${attempts.length} bài)`);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="ket-qua-de-${quiz.id}.csv"`);
  res.send(toCsv(rows));
});

router.get('/quizzes/:id/stats', async (req, res) => {
  const quiz = await findQuiz(toId(req.params.id));
  if (!quiz) return renderError(res, 404, 'Không tìm thấy', 'Đề thi không tồn tại.');
  res.render('admin/stats', {
    title: `Thống kê: ${quiz.title}`,
    quiz,
    summary: await getQuizSummary(quiz.id),
    distribution: await getScoreDistribution(quiz.id),
    questions: await getQuestionStats(quiz.id),
    top: await getLeaderboard(quiz.id, 10),
  });
});

// ======================= DANH MỤC =======================
router.get('/categories', async (req, res) => {
  const [categories] = await pool.query(
    `SELECT c.id, c.name, c.icon, COUNT(q.id) AS quiz_count
       FROM categories c LEFT JOIN quizzes q ON q.category_id = c.id
      GROUP BY c.id ORDER BY c.name`
  );
  res.render('admin/categories', { title: 'Danh mục môn học', categories, icons: CATEGORY_ICONS });
});

async function saveCategory(req, res, id) {
  const name = cleanText(req.body.name, 100);
  const iconName = CATEGORY_ICONS.includes(req.body.icon) ? req.body.icon : 'book';
  if (!name) {
    setFlash(req, 'error', 'Tên danh mục không được để trống.');
    return res.redirect(303, '/admin/categories');
  }
  try {
    if (id) await pool.query('UPDATE categories SET name = ?, icon = ? WHERE id = ?', [name, iconName, id]);
    else await pool.query('INSERT INTO categories (name, icon) VALUES (?, ?)', [name, iconName]);
    logger.info(id ? 'category_updated' : 'category_created', { category_id: id, name, by: req.user.username });
    await audit(req, id ? 'category_updated' : 'category_created', `${id ? 'Sửa' : 'Thêm'} danh mục "${name}"`);
    setFlash(req, 'success', id ? 'Đã cập nhật danh mục.' : 'Đã thêm danh mục.');
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY') throw err;
    setFlash(req, 'error', 'Tên danh mục đã tồn tại.');
  }
  res.redirect(303, '/admin/categories');
}

router.post('/categories', (req, res) => saveCategory(req, res, null));

router.post('/categories/:id', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return renderError(res, 404, 'Không tìm thấy', 'Danh mục không tồn tại.');
  return saveCategory(req, res, id);
});

router.post('/categories/:id/delete', async (req, res) => {
  const id = toId(req.params.id);
  if (id) await pool.query('DELETE FROM categories WHERE id = ?', [id]);
  logger.warn('category_deleted', { category_id: id, by: req.user.username });
  await audit(req, 'category_deleted', `Xóa danh mục #${id}`);
  setFlash(req, 'success', 'Đã xóa danh mục (các đề thuộc danh mục này chuyển thành "Chưa phân loại").');
  res.redirect(303, '/admin/categories');
});

// ======================= NGƯỜI DÙNG =======================
router.get('/users', async (req, res) => {
  const [users] = await pool.query(
    `SELECT u.id, u.username, u.full_name, u.student_code, u.role, u.is_locked, u.created_at, u.last_login_at,
            COUNT(a.id) AS attempts, ROUND(AVG(a.score / a.total) * 10, 2) AS avg_score
       FROM users u
       LEFT JOIN attempts a ON a.user_id = u.id AND a.status = 'submitted' AND a.total > 0
      GROUP BY u.id
      ORDER BY u.role, u.created_at DESC`
  );
  res.render('admin/users', { title: 'Người dùng', users });
});

// Lấy người dùng cần thao tác; không cho tự khóa / tự hạ quyền chính mình (tránh mất quyền quản trị).
async function targetUser(req, res) {
  const id = toId(req.params.id);
  const [[user]] = id ? await pool.query('SELECT id, username, role, is_locked FROM users WHERE id = ?', [id]) : [[]];
  if (!user) {
    renderError(res, 404, 'Không tìm thấy', 'Người dùng không tồn tại.');
    return null;
  }
  if (user.id === req.user.id) {
    setFlash(req, 'error', 'Không thể tự thao tác trên tài khoản của chính mình.');
    res.redirect(303, '/admin/users');
    return null;
  }
  return user;
}

router.post('/users/:id/lock', async (req, res) => {
  const user = await targetUser(req, res);
  if (!user) return;
  const locked = !user.is_locked;
  await pool.query('UPDATE users SET is_locked = ? WHERE id = ?', [locked, user.id]);
  logger.warn(locked ? 'user_locked' : 'user_unlocked', { target: user.username, by: req.user.username });
  await audit(req, locked ? 'user_locked' : 'user_unlocked', `${locked ? 'Khóa' : 'Mở khóa'} tài khoản @${user.username}`);
  setFlash(req, 'success', `Đã ${locked ? 'khóa' : 'mở khóa'} tài khoản @${user.username}.`);
  res.redirect(303, '/admin/users');
});

router.post('/users/:id/role', async (req, res) => {
  const user = await targetUser(req, res);
  if (!user) return;
  const role = req.body.role === 'admin' ? 'admin' : 'student';
  await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, user.id]);
  logger.warn('user_role_changed', { target: user.username, role, by: req.user.username });
  await audit(req, 'user_role_changed', `Đổi vai trò @${user.username}: ${user.role} → ${role}`);
  setFlash(req, 'success', `Đã đổi vai trò của @${user.username} thành ${role === 'admin' ? 'Quản trị' : 'Học viên'}.`);
  res.redirect(303, '/admin/users');
});

// Đặt lại mật khẩu: sinh mật khẩu tạm ngẫu nhiên, chỉ hiện MỘT LẦN cho quản trị viên.
router.post('/users/:id/reset-password', async (req, res) => {
  const user = await targetUser(req, res);
  if (!user) return;
  const temp = `Tmp${crypto.randomBytes(6).toString('base64url')}9`;
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(temp, 10), user.id]);
  logger.warn('user_password_reset', { target: user.username, by: req.user.username });
  await audit(req, 'user_password_reset', `Đặt lại mật khẩu @${user.username}`);
  setFlash(req, 'success', `Mật khẩu tạm của @${user.username}: ${temp} — chỉ hiện một lần, hãy gửi cho người dùng và yêu cầu đổi ngay.`);
  res.redirect(303, '/admin/users');
});

// ======================= NHẬT KÝ HOẠT ĐỘNG =======================
router.get('/audit', async (req, res) => {
  const action = cleanText(req.query.action, 50);
  const username = cleanText(req.query.user, 30);
  const where = [];
  const params = [];
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (username) {
    where.push('username = ?');
    params.push(username);
  }
  const [logs] = await pool.query(
    `SELECT id, username, action, detail, ip, created_at FROM audit_logs
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC LIMIT 200`,
    params
  );
  const [actions] = await pool.query('SELECT action, COUNT(*) AS n FROM audit_logs GROUP BY action ORDER BY action');
  res.render('admin/audit', { title: 'Nhật ký hoạt động', logs, actions, action, username });
});

module.exports = router;
