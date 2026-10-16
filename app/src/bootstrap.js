'use strict';

const bcrypt = require('bcryptjs');
const pool = require('./db');
const logger = require('./logger');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Tạo tài khoản quản trị từ biến môi trường ADMIN_USER / ADMIN_PASSWORD nếu chưa có.
// Mật khẩu chỉ được lưu dưới dạng băm bcrypt. Nếu tài khoản đã tồn tại thì không ghi đè.
async function ensureAdmin() {
  const username = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    logger.warn('admin_bootstrap_skipped', { reason: 'ADMIN_USER/ADMIN_PASSWORD chưa được cấu hình' });
    return;
  }

  // CSDL có thể chưa sẵn sàng ngay khi container khởi động -> thử lại vài lần.
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const [[existing]] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
      if (!existing) {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
          "INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, 'Quản trị viên', 'admin')",
          [username, hash]
        );
        logger.info('admin_created', { username });
      }
      return;
    } catch (err) {
      logger.warn('db_not_ready', { attempt, error: err.message });
      await sleep(3000);
    }
  }
  throw new Error('Không kết nối được tới cơ sở dữ liệu');
}

module.exports = { ensureAdmin };
