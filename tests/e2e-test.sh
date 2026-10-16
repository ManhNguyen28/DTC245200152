#!/usr/bin/env bash
# Kiểm thử end-to-end web Quiz: chức năng + bảo mật. Chạy trên máy chủ: bash tests/e2e-test.sh
# Lưu ý: tạo dữ liệu test (sv_an, sv_binh...). Chạy trên CSDL sạch: docker compose down -v && docker compose up -d
cd "$(dirname "$0")/.." && set -a && . ./.env && set +a
B=${BASE_URL:-https://localhost}            # đi qua Nginx (HTTPS)
curl() { command curl -k "$@"; }            # -k: chấp nhận chứng chỉ tự ký
T=$(mktemp -d)
PASS=0; FAIL=0
ok()   { echo "  ✅ ĐẠT  $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ LỖI  $1"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1 (=$2)"; else bad "$1 (mong đợi $3, nhận $2)"; fi; }
sql()  { docker exec -e MYSQL_PWD="$MYSQL_PASSWORD" quiz-db mysql -N --default-character-set=utf8mb4 -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "$1" 2>/dev/null; }
# Lấy CSRF token từ một trang (dùng cookie của người dùng $1)
csrf() { curl -s -b "$T/$1" -c "$T/$1" "$B$2" | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/.*value="//;s/"$//'; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
register_as() { # cookie username fullname password
  local tok; tok=$(csrf "$1" /register)
  code -b "$T/$1" -c "$T/$1" --data-urlencode "_csrf=$tok" --data-urlencode "username=$2" \
       --data-urlencode "full_name=$3" -d "student_code=DTC$RANDOM" --data-urlencode "password=$4" \
       --data-urlencode "password_confirm=$4" "$B/register"
}
register() { register_as "$1" "$1" "$2" "$3"; } # user fullname password (cookie = tên user)
login() { # cookie user password
  local tok; tok=$(csrf "$1" /login)
  code -b "$T/$1" -c "$T/$1" --data-urlencode "_csrf=$tok" --data-urlencode "username=$2" --data-urlencode "password=$3" "$B/login"
}
start() { # cookie quizId -> in ra URL chuyển hướng
  local tok; tok=$(csrf "$1" "/quiz/$2")
  curl -s -o /dev/null -w '%{redirect_url}' -b "$T/$1" -c "$T/$1" -d "_csrf=$tok" "$B/quiz/$2/start"
}

echo "== 1. Khách (chưa đăng nhập) =="
check "Trang chủ" "$(code $B/)" 200
check "Số đề hiển thị" "$(curl -s $B/ | grep -c 'class="card quiz-card"')" 3
check "Tìm kiếm 'linux'" "$(curl -s "$B/?q=linux" | grep -c 'class="card quiz-card"')" 1
check "Lọc danh mục 2" "$(curl -s "$B/?category=2" | grep -c 'class="card quiz-card"')" 1
check "Vào /admin bị chuyển tới đăng nhập" "$(code $B/admin)" 303
check "Vào /me/history bị chuyển tới đăng nhập" "$(code $B/me/history)" 303

echo "== 2. Đăng ký / đăng nhập =="
check "Đăng ký mật khẩu yếu bị từ chối" "$(register yeu 'Mật khẩu yếu' 123)" 400
check "Đăng ký sv_an" "$(register sv_an 'Nguyễn Văn An' 'MatKhau123')" 303
check "Đăng ký trùng tên bị từ chối" "$(register_as khach_moi sv_an 'Trùng tên' 'MatKhau123')" 400
check "Đăng ký sv_binh" "$(register sv_binh 'Trần Thị Bình' 'MatKhau456')" 303
check "Mật khẩu lưu dạng bcrypt (bắt đầu \$2)" "$(sql "SELECT LEFT(password_hash,2) FROM users WHERE username='sv_an'")" '$2'
check "POST thiếu CSRF token bị chặn" "$(code -b $T/sv_an -d 'x=1' $B/logout)" 403
check "Học viên vào /admin bị cấm" "$(code -b $T/sv_an $B/admin)" 403

echo "== 3. Làm bài (sv_an, đề 1) =="
URL=$(start sv_an 1); AID=${URL##*/}
[[ "$URL" == *"/attempt/"* ]] && ok "Bắt đầu làm bài -> $URL" || bad "Bắt đầu làm bài ($URL)"
REM=$(curl -s -b $T/sv_an $B/attempt/$AID | grep -o 'data-remaining="[0-9]*"' | grep -o '[0-9]*')
[ "$REM" -gt 590 ] && [ "$REM" -le 600 ] && ok "Đồng hồ máy chủ: còn $REM giây (10 phút)" || bad "Đồng hồ ($REM)"
check "Mở lại 'Bắt đầu' -> tiếp tục đúng bài cũ" "$(start sv_an 1)" "$B/attempt/$AID"
ORDER=$(sql "SELECT question_order FROM attempts WHERE id=$AID"); echo "  ℹ️  Thứ tự câu đã xáo: $ORDER"
# Trả lời đúng tất cả: lấy đáp án đúng từ DB
DATA="_csrf=$(csrf sv_an /attempt/$AID)"
while read -r id ans; do DATA="$DATA&q_$id=$ans"; done < <(sql "SELECT id, correct_option FROM questions WHERE quiz_id=1")
curl -s -o /dev/null -b $T/sv_an -c $T/sv_an -d "$DATA" $B/attempt/$AID/submit
check "Điểm sv_an (đúng hết)" "$(sql "SELECT CONCAT(score,'/',total) FROM attempts WHERE id=$AID")" "5/5"
curl -s -o /dev/null -b $T/sv_an -c $T/sv_an -d "$DATA" $B/attempt/$AID/submit   # bấm "Nộp" lần nữa
check "Nộp lại lần 2 không chấm lại" "$(sql "SELECT COUNT(*) FROM attempt_answers WHERE attempt_id=$AID")" 5
check "Trang kết quả của chính mình" "$(code -b $T/sv_an $B/result/$AID)" 200
check "sv_binh xem trộm kết quả của sv_an bị chặn" "$(code -b $T/sv_binh $B/result/$AID)" 404

echo "== 4. Giới hạn lượt làm (đề 1 tối đa 3 lượt) =="
for i in 2 3; do U=$(start sv_an 1); X=${U##*/}; curl -s -o /dev/null -b $T/sv_an -d "_csrf=$(csrf sv_an /attempt/$X)&q_1=A" $B/attempt/$X/submit; done
check "Đã dùng" "$(sql "SELECT COUNT(*) FROM attempts a JOIN users u ON u.id=a.user_id WHERE u.username='sv_an' AND quiz_id=1")" 3
check "Lượt thứ 4 bị từ chối (quay về trang đề)" "$(start sv_an 1)" "$B/quiz/1"

echo "== 5. Nộp quá giờ (sv_binh, đề 2) =="
URL=$(start sv_binh 2); BID=${URL##*/}
sql "UPDATE attempts SET started_at = NOW() - INTERVAL 12 MINUTE, deadline_at = NOW() - INTERVAL 2 MINUTE WHERE id=$BID"
DATA="_csrf=$(csrf sv_binh /quiz/2)"
while read -r id ans; do DATA="$DATA&q_$id=$ans"; done < <(sql "SELECT id, correct_option FROM questions WHERE quiz_id=2")
curl -s -o /dev/null -b $T/sv_binh -c $T/sv_binh -d "$DATA" $B/attempt/$BID/submit
check "Bài trễ: điểm 0 và đánh dấu is_late" "$(sql "SELECT CONCAT(score,'/',total,' late=',is_late) FROM attempts WHERE id=$BID")" "0/5 late=1"
# sv_binh làm đề 2 đúng 3/5 để có dữ liệu xếp hạng
URL=$(start sv_binh 2); BID=${URL##*/}; DATA="_csrf=$(csrf sv_binh /attempt/$BID)"; n=0
while read -r id ans; do n=$((n+1)); [ $n -le 3 ] && DATA="$DATA&q_$id=$ans"; done < <(sql "SELECT id, correct_option FROM questions WHERE quiz_id=2 ORDER BY id")
curl -s -o /dev/null -b $T/sv_binh -d "$DATA" $B/attempt/$BID/submit
check "sv_binh đề 2 đúng 3 câu" "$(sql "SELECT score FROM attempts WHERE id=$BID")" 3
check "Lịch sử của sv_binh" "$(code -b $T/sv_binh $B/me/history)" 200
check "Bảng xếp hạng đề 1 có sv_an" "$(curl -s -b $T/sv_binh $B/quiz/1/leaderboard | grep -c 'Nguyễn Văn An')" 1

echo "== 6. Chống dò mật khẩu =="
for i in 1 2 3 4 5; do login hacker sv_an sai$i >/dev/null; done
check "Lần sai thứ 6 bị khóa tạm" "$(login hacker sv_an sai6)" 429

echo "== 7. Quản trị viên =="
docker restart quiz-web >/dev/null; sleep 3   # xóa bộ đếm đăng nhập sai (lưu trong RAM) để admin đăng nhập
check "Admin đăng nhập" "$(login admin "$ADMIN_USER" "$ADMIN_PASSWORD")" 303
for p in /admin /admin/quizzes /admin/categories /admin/users /admin/quizzes/1 /admin/quizzes/1/results /admin/quizzes/1/stats /admin/quizzes/1/import /admin/quizzes/new /admin/quizzes/1/edit; do
  check "GET $p" "$(code -b $T/admin $B$p)" 200
done
TOK=$(csrf admin /admin/categories)
code -b $T/admin -d "_csrf=$TOK" --data-urlencode "name=Bảo mật web" $B/admin/categories >/dev/null
check "Thêm danh mục" "$(sql "SELECT COUNT(*) FROM categories WHERE name='Bảo mật web'")" 1
TOK=$(csrf admin /admin/quizzes/new)
U=$(curl -s -o /dev/null -w '%{redirect_url}' -b $T/admin -d "_csrf=$TOK" --data-urlencode "title=An toàn thông tin cơ bản" \
    -d "category_id=4&time_limit=5&max_attempts=0&shuffle_questions=1&is_published=1" $B/admin/quizzes); QID=${U##*/}
[ -n "$QID" ] && ok "Tạo đề mới id=$QID" || bad "Tạo đề mới"
TOK=$(csrf admin /admin/quizzes/$QID/import)
code -b $T/admin -d "_csrf=$TOK&delimiter=,&has_header=1" --data-urlencode "csv_text@db/sample-questions.csv" $B/admin/quizzes/$QID/import >/dev/null
check "Nhập CSV mẫu" "$(sql "SELECT COUNT(*) FROM questions WHERE quiz_id=$QID")" 5
check "CSV sai định dạng bị từ chối" "$(code -b $T/admin -d "_csrf=$TOK&delimiter=,&has_header=0" --data-urlencode $'csv_text=chi,co,3 cot' $B/admin/quizzes/$QID/import)" 400
curl -s -b $T/admin $B/admin/quizzes/1/results.csv -o $T/kq.csv
check "Xuất CSV: số dòng (tiêu đề + 3 bài)" "$(wc -l < $T/kq.csv)" 4
echo "  ℹ️  Dòng đầu file CSV: $(head -2 $T/kq.csv | tail -1 | cut -c1-90)"
check "Đề ẩn: khách không thấy" "$(sql "UPDATE quizzes SET is_published=0 WHERE id=$QID"; code $B/quiz/$QID)" 404
check "Đề ẩn: admin vẫn xem được" "$(code -b $T/admin $B/quiz/$QID)" 200

echo "== 8. Múi giờ =="
echo "  ℹ️  MySQL (UTC):  $(sql "SELECT started_at FROM attempts WHERE id=$AID")"
echo "  ℹ️  Web hiển thị: $(curl -s -b $T/admin $B/admin/quizzes/1/results | grep -o '[0-9]*:[0-9]*:[0-9]* [0-9]*/[0-9]*/[0-9]*' | tail -1)  (giờ Việt Nam = UTC+7)"

echo; echo "== KẾT QUẢ: $PASS đạt, $FAIL lỗi =="
rm -rf "$T"
