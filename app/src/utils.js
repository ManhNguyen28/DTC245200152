'use strict';

const OPTIONS = ['A', 'B', 'C', 'D'];

// Chuyển tham số URL thành id số nguyên dương, sai định dạng trả về null.
function toId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Chuẩn hóa chuỗi người dùng nhập: bỏ khoảng trắng thừa, cắt theo độ dài tối đa.
function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function renderError(res, status, title, message) {
  return res.status(status).render('error', { title, message });
}

function formatDate(date) {
  return new Date(date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

module.exports = { OPTIONS, toId, cleanText, renderError, formatDate };
