'use strict';

// Ghi log dạng JSON, mỗi sự kiện một dòng ra stdout/stderr.
// Docker thu stdout của container -> Promtail đọc -> Loki lưu trữ,
// nhờ định dạng JSON có thể lọc theo trường bằng LogQL (| json | level="error").
function write(level, msg, fields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

module.exports = {
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};
