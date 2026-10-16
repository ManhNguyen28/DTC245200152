'use strict';

const OPTIONS = ['A', 'B', 'C', 'D'];
const TIME_ZONE = 'Asia/Ho_Chi_Minh';

// Chuyển tham số URL thành id số nguyên dương, sai định dạng trả về null.
function toId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Chuẩn hóa chuỗi người dùng nhập: bỏ khoảng trắng thừa, cắt theo độ dài tối đa.
function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Số nguyên trong khoảng [min, max], ngoài khoảng hoặc sai định dạng trả về giá trị mặc định.
function toIntInRange(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

// Thoát ký tự đặc biệt của LIKE để người dùng gõ "%" hay "_" không thành ký tự đại diện.
function escapeLike(text) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Chỉ cho phép chuyển hướng nội bộ (chống open redirect: ?next=https://trang-lua-dao).
function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '';
}

function renderError(res, status, title, message) {
  return res.status(status).render('error', { title, message });
}

// Thông báo hiển thị một lần ở trang kế tiếp (sau khi chuyển hướng).
function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function formatDate(date) {
  return date ? new Date(date).toLocaleString('vi-VN', { timeZone: TIME_ZONE }) : '—';
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.max(0, Math.round(Number(seconds)));
  return `${Math.floor(s / 60)} phút ${String(s % 60).padStart(2, '0')} giây`;
}

// Điểm hệ 10 từ số câu đúng / tổng số câu.
function score10(score, total) {
  return total > 0 ? ((score / total) * 10).toFixed(2) : '0.00';
}

module.exports = {
  OPTIONS,
  TIME_ZONE,
  toId,
  cleanText,
  toIntInRange,
  escapeLike,
  safeNext,
  renderError,
  setFlash,
  formatDate,
  formatDuration,
  score10,
};
