// JavaScript phía trình duyệt, để trong file riêng (không viết inline trong HTML)
// để có thể bật Content-Security-Policy chặn mọi script/style inline.
(function () {
  // Hỏi xác nhận trước các thao tác xóa (form có thuộc tính data-confirm).
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });

  // Vẽ biểu đồ cột: chiều cao/rộng lấy từ data-h / data-w (phần trăm).
  document.querySelectorAll('[data-h]').forEach(function (el) {
    el.style.height = Math.max(Number(el.dataset.h), 2) + '%';
  });
  document.querySelectorAll('[data-w]').forEach(function (el) {
    el.style.width = Number(el.dataset.w) + '%';
  });

  // Trang nhập CSV: đọc file người dùng chọn và hiện nội dung vào ô văn bản để kiểm tra trước.
  var fileInput = document.getElementById('csv-file');
  var csvText = document.getElementById('csv-text');
  if (fileInput && csvText) {
    fileInput.addEventListener('change', function () {
      var file = fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { csvText.value = reader.result; };
      reader.readAsText(file, 'UTF-8');
    });
  }

  // Trang làm bài.
  var form = document.getElementById('quiz-form');
  var timerEl = document.getElementById('timer');
  if (!form || !timerEl) return;

  // Đếm số câu đã trả lời.
  var answeredEl = document.getElementById('answered');
  var total = form.querySelectorAll('fieldset.question').length;
  function countAnswered() {
    var names = {};
    form.querySelectorAll('input[type=radio]:checked').forEach(function (r) { names[r.name] = true; });
    return Object.keys(names).length;
  }
  form.addEventListener('change', function () { answeredEl.textContent = countAnswered(); });

  var submitted = false;
  form.addEventListener('submit', function (e) {
    var left = total - countAnswered();
    if (!submitted && left > 0 && !window.confirm('Bạn còn ' + left + ' câu chưa trả lời. Vẫn nộp bài?')) {
      e.preventDefault();
      return;
    }
    submitted = true;
  });

  // Đồng hồ đếm ngược: số giây còn lại do MÁY CHỦ tính, hết giờ tự động nộp bài.
  var deadline = Date.now() + Number(form.dataset.remaining) * 1000;
  function render() {
    var remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    var m = Math.floor(remaining / 60);
    var s = remaining % 60;
    timerEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    if (remaining <= 60) timerEl.classList.add('warning');
    return remaining;
  }

  render();
  var interval = setInterval(function () {
    if (render() <= 0) {
      clearInterval(interval);
      if (!submitted) {
        submitted = true;
        form.submit(); // gọi trực tiếp nên không hiện hộp xác nhận
      }
    }
  }, 1000);
})();
