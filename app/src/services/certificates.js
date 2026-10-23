'use strict';

const crypto = require('crypto');

// Mã xác thực giấy chứng nhận: Q35-<id bài làm>-<12 ký tự chữ ký HMAC-SHA256>.
// Chữ ký tạo bằng khóa bí mật của máy chủ (SESSION_SECRET) -> không ai tự "chế" được mã hợp lệ,
// nhưng ai có mã đều kiểm tra được tại trang /verify.
function signature(attemptId, userId) {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(`certificate:${attemptId}:${userId}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
}

function certificateCode(attemptId, userId) {
  return `Q35-${String(attemptId).padStart(6, '0')}-${signature(attemptId, userId)}`;
}

// Tách mã -> id bài làm. Chữ ký được kiểm tra lại sau khi biết user_id của bài làm.
function parseCode(code) {
  const match = /^Q35-(\d{6})-([0-9A-F]{12})$/.exec(String(code || '').trim().toUpperCase());
  return match ? { attemptId: Number(match[1]), sig: match[2] } : null;
}

function verifySignature(parsed, userId) {
  const expected = Buffer.from(signature(parsed.attemptId, userId));
  const actual = Buffer.from(parsed.sig);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = { certificateCode, parseCode, verifySignature };
