'use strict';

// Số liệu (metrics) của ứng dụng theo định dạng Prometheus, xuất tại /metrics.
// Prometheus định kỳ 15 giây "đi hỏi" (scrape) trang này một lần.
const client = require('prom-client');
const pool = require('./db');

const register = new client.Registry();
register.setDefaultLabels({ app: 'quiz-web' });

// Số liệu chuẩn của tiến trình Node.js: CPU, bộ nhớ, event loop lag, số file đang mở...
client.collectDefaultMetrics({ register });

// ---- Counter: bộ đếm chỉ tăng; Prometheus dùng rate() để tính tốc độ ----
const httpRequests = new client.Counter({
  name: 'quiz_http_requests_total',
  help: 'Tổng số HTTP request theo phương thức, route và mã trạng thái',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

// ---- Histogram: phân bố thời gian xử lý, dùng để tính p95/p99 ----
const httpDuration = new client.Histogram({
  name: 'quiz_http_request_duration_seconds',
  help: 'Thời gian xử lý HTTP request (giây)',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

const loginAttempts = new client.Counter({
  name: 'quiz_login_attempts_total',
  help: 'Số lần đăng nhập theo kết quả (success, failed, blocked)',
  labelNames: ['result'],
  registers: [register],
});

const registrations = new client.Counter({
  name: 'quiz_user_registrations_total',
  help: 'Số tài khoản học viên đăng ký mới',
  registers: [register],
});

const attemptsStarted = new client.Counter({
  name: 'quiz_attempts_started_total',
  help: 'Số lượt bắt đầu làm bài',
  registers: [register],
});

const submissions = new client.Counter({
  name: 'quiz_submissions_total',
  help: 'Số bài đã nộp (late=true: nộp quá giờ)',
  labelNames: ['late'],
  registers: [register],
});

// Khởi tạo sẵn mọi tổ hợp nhãn bằng 0 ngay khi ứng dụng chạy.
// Nếu không, chuỗi số liệu (vd result="failed") chỉ xuất hiện ở lần sự kiện đầu tiên; Prometheus không có
// mốc 0 để so sánh nên increase()/rate() bỏ sót đúng những sự kiện đầu tiên sau mỗi lần khởi động.
['success', 'failed', 'blocked'].forEach((result) => loginAttempts.inc({ result }, 0));
['false', 'true'].forEach((late) => submissions.inc({ late }, 0));

// ---- Gauge: giá trị tăng/giảm, đọc từ CSDL đúng lúc Prometheus hỏi ----
new client.Gauge({
  name: 'quiz_attempts_in_progress',
  help: 'Số bài đang làm dở và còn trong thời gian làm bài',
  registers: [register],
  async collect() {
    const [[row]] = await pool.query(
      "SELECT COUNT(*) AS n FROM attempts WHERE status = 'in_progress' AND deadline_at > NOW()"
    );
    this.set(row.n);
  },
});

new client.Gauge({
  name: 'quiz_entities',
  help: 'Số lượng bản ghi chính trong hệ thống',
  labelNames: ['type'],
  registers: [register],
  async collect() {
    const [[row]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
              (SELECT COUNT(*) FROM quizzes) AS quizzes,
              (SELECT COUNT(*) FROM questions) AS questions,
              (SELECT COUNT(*) FROM attempts WHERE status = 'submitted') AS submitted_attempts`
    );
    for (const [type, value] of Object.entries(row)) this.set({ type }, value);
  },
});

// Nhãn route lấy theo MẪU đường dẫn (vd /quiz/:id) chứ không theo URL thật (/quiz/1, /quiz/2...)
// để số chuỗi thời gian không tăng vô hạn (tránh "high cardinality" làm Prometheus phình to).
function routeLabel(req) {
  if (req.route) return `${req.baseUrl}${req.route.path}`;
  if (req.originalUrl.startsWith('/static/')) return '/static/*';
  return 'unmatched';
}

function observeRequest(req, res, seconds) {
  const labels = { method: req.method, route: routeLabel(req), status: String(res.statusCode) };
  httpRequests.inc(labels);
  httpDuration.observe(labels, seconds);
}

module.exports = {
  register,
  observeRequest,
  loginAttempts,
  registrations,
  attemptsStarted,
  submissions,
};
