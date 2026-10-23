// Nạp trong <head> (trước khi trang hiển thị) để áp chế độ sáng/tối ngay, tránh "nháy" màn hình.
// Thứ tự ưu tiên: lựa chọn đã lưu của người dùng -> cài đặt của hệ điều hành.
(function () {
  var saved = null;
  try { saved = localStorage.getItem('theme'); } catch (e) { /* trình duyệt chặn localStorage */ }
  var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
