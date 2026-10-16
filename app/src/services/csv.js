'use strict';

// Đọc CSV theo chuẩn RFC 4180: ô có dấu phân cách hoặc xuống dòng phải đặt trong ngoặc kép,
// dấu ngoặc kép bên trong ô viết thành "".
function parseCsv(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, ''); // bỏ BOM do Excel thêm vào đầu file

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Bỏ các dòng trống hoàn toàn.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

// Ghi một ô CSV an toàn.
// - Chống "CSV injection": ô bắt đầu bằng = + - @ sẽ bị Excel hiểu là công thức -> thêm dấu ' phía trước.
// - Ô chứa dấu phẩy, ngoặc kép hoặc xuống dòng được bọc trong ngoặc kép.
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// BOM ở đầu giúp Excel nhận đúng tiếng Việt (UTF-8).
function toCsv(rows) {
  return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

module.exports = { parseCsv, toCsv };
