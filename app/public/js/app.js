// JavaScript phía trình duyệt, để trong file riêng (không viết inline trong HTML)
// để sau này có thể bật Content-Security-Policy chặn script inline.
(function () {
  // Hỏi xác nhận trước các thao tác xóa (form có thuộc tính data-confirm).
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });

  // Đồng hồ đếm ngược trên trang làm bài, hết giờ tự động nộp bài.
  var form = document.getElementById('quiz-form');
  var timerEl = document.getElementById('timer');
  if (!form || !timerEl) return;

  var remaining = Number(form.dataset.timeLimit) * 60;
  var submitted = false;
  form.addEventListener('submit', function () { submitted = true; });

  function render() {
    var m = Math.floor(remaining / 60);
    var s = remaining % 60;
    timerEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    if (remaining <= 60) timerEl.classList.add('warning');
  }

  render();
  var interval = setInterval(function () {
    remaining -= 1;
    render();
    if (remaining <= 0) {
      clearInterval(interval);
      if (!submitted) {
        submitted = true;
        form.submit();
      }
    }
  }, 1000);
})();
