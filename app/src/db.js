'use strict';

const mysql = require('mysql2/promise');

// Connection pool: tái sử dụng kết nối tới MySQL thay vì mở mới cho mỗi request.
// Thông tin kết nối lấy từ biến môi trường (khai báo trong docker-compose / .env),
// không ghi cứng mật khẩu trong mã nguồn.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
