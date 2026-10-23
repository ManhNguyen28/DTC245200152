// JavaScript phía trình duyệt, để trong file riêng (không viết inline trong HTML)
// để tương thích Content-Security-Policy chặn mọi script/style inline.
(function () {
  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* localStorage bị chặn: bỏ qua, trang vẫn hoạt động */ }
    return null;
  }

  // ---------- Chế độ sáng / tối ----------
  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      store('theme', next);
    });
  }

  // ---------- Menu trên điện thoại ----------
  var navBtn = document.getElementById('nav-toggle');
  var nav = document.getElementById('main-nav');
  if (navBtn && nav) navBtn.addEventListener('click', function () { nav.classList.toggle('open'); });

  // ---------- Hỏi xác nhận trước các thao tác nguy hiểm (form có data-confirm) ----------
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });

  // ---------- Kích thước biểu đồ / vòng điểm (đọc từ data-*, không dùng style inline) ----------
  document.querySelectorAll('[data-h]').forEach(function (el) { el.style.height = Math.max(Number(el.dataset.h), 2) + '%'; });
  document.querySelectorAll('[data-w]').forEach(function (el) { el.style.width = Number(el.dataset.w) + '%'; });
  document.querySelectorAll('[data-p]').forEach(function (el) { el.style.setProperty('--p', Number(el.dataset.p)); });

  // ---------- In giấy chứng nhận ----------
  var printBtn = document.getElementById('print-btn');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

  // ---------- Nhập CSV: hiện nội dung file đã chọn vào ô văn bản ----------
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

  // =================== TRANG LÀM BÀI ===================
  var form = document.getElementById('quiz-form');
  var timerEl = document.getElementById('timer');
  if (!form || !timerEl) return;

  var attemptKey = 'attempt-' + form.dataset.attempt;
  var questions = Array.prototype.slice.call(form.querySelectorAll('fieldset.question'));
  var total = questions.length;
  var answeredEl = document.getElementById('answered');
  var progressEl = document.getElementById('progress-fill');
  var flagCountEl = document.getElementById('flag-count');

  // Lưu tạm đáp án + câu đánh dấu vào trình duyệt: lỡ tải lại trang / mất mạng không mất bài.
  var saved = {};
  try { saved = JSON.parse(store(attemptKey) || '{}'); } catch (e) { saved = {}; }
  saved.answers = saved.answers || {};
  saved.flags = saved.flags || {};
  function persist() { store(attemptKey, JSON.stringify(saved)); }

  Object.keys(saved.answers).forEach(function (name) {
    var input = form.querySelector('input[name="' + name + '"][value="' + saved.answers[name] + '"]');
    if (input) input.checked = true;
  });

  function refresh() {
    var answered = 0;
    var flagged = 0;
    questions.forEach(function (fs, i) {
      var name = fs.dataset.name;
      var isAnswered = !!form.querySelector('input[name="' + name + '"]:checked');
      var isFlagged = !!saved.flags[name];
      if (isAnswered) answered += 1;
      if (isFlagged) flagged += 1;
      var link = document.getElementById('nav-' + (i + 1));
      if (link) {
        link.classList.toggle('answered', isAnswered);
        link.classList.toggle('flagged', isFlagged);
      }
      var btn = fs.querySelector('.flag-btn');
      if (btn) btn.classList.toggle('on', isFlagged);
    });
    if (answeredEl) answeredEl.textContent = answered;
    if (flagCountEl) flagCountEl.textContent = flagged;
    if (progressEl) progressEl.style.width = (total ? (answered / total) * 100 : 0) + '%';
    return { answered: answered, flagged: flagged };
  }

  form.addEventListener('change', function (e) {
    if (e.target.type === 'radio') {
      saved.answers[e.target.name] = e.target.value;
      persist();
    }
    refresh();
  });

  // Đánh dấu câu "chưa chắc" để xem lại trước khi nộp.
  form.querySelectorAll('.flag-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.closest('fieldset.question').dataset.name;
      if (saved.flags[name]) delete saved.flags[name];
      else saved.flags[name] = 1;
      persist();
      refresh();
    });
  });
  refresh();

  var submitted = false;
  form.addEventListener('submit', function (e) {
    var state = refresh();
    var left = total - state.answered;
    var msg = [];
    if (left > 0) msg.push('còn ' + left + ' câu chưa trả lời');
    if (state.flagged > 0) msg.push(state.flagged + ' câu đang đánh dấu xem lại');
    if (!submitted && msg.length && !window.confirm('Bạn ' + msg.join(' và ') + '. Vẫn nộp bài?')) {
      e.preventDefault();
      return;
    }
    submitted = true;
    store(attemptKey, null);
  });

  // Đồng hồ đếm ngược: số giây còn lại do MÁY CHỦ tính, hết giờ tự động nộp bài.
  var deadline = Date.now() + Number(form.dataset.remaining) * 1000;
  var timerBox = timerEl.parentElement;
  function render() {
    var remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    var m = Math.floor(remaining / 60);
    var s = remaining % 60;
    timerEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    if (remaining <= 60) timerBox.classList.add('warning');
    return remaining;
  }
  render();
  var interval = setInterval(function () {
    if (render() <= 0) {
      clearInterval(interval);
      if (!submitted) {
        submitted = true;
        store(attemptKey, null);
        form.submit(); // gọi trực tiếp nên không hiện hộp xác nhận
      }
    }
  }, 1000);
})();
