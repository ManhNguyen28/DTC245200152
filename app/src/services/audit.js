'use strict';

const pool = require('../db');
const logger = require('../logger');

// Ghi nhật ký hoạt động (audit log) vào CSDL: ai làm gì, lúc nào, từ IP nào.
// Khác log ứng dụng (đẩy về Loki, giữ 7 ngày): audit log là dữ liệu nghiệp vụ, quản trị viên xem trong web.
// actor: người thực hiện; mặc định là người đang đăng nhập (req.user).
async function audit(req, action, detail, actor = req.user) {
  try {
    await pool.query('INSERT INTO audit_logs (user_id, username, action, detail, ip) VALUES (?, ?, ?, ?, ?)', [
      actor ? actor.id : null,
      actor ? actor.username : null,
      action,
      detail ? String(detail).slice(0, 500) : null,
      req.ip,
    ]);
  } catch (err) {
    // Ghi audit lỗi không được làm hỏng thao tác chính của người dùng.
    logger.error('audit_failed', { action, error: err.message });
  }
}

module.exports = { audit };
