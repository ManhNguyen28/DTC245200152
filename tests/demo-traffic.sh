#!/usr/bin/env bash
# Mô phỏng một buổi thi để có dữ liệu demo (bảng xếp hạng, thống kê, biểu đồ Grafana/Loki).
# - 6 học viên demo (hv01..hv06, mật khẩu HocVien2026), "trình độ" khác nhau -> điểm phân tán tự nhiên
# - Mỗi học viên làm 3 lượt, nghỉ vài giây giữa các lượt (như người thật)
# - Xen kẽ các lần đăng nhập sai (mô phỏng dò mật khẩu) để có dữ liệu cho giám sát bảo mật
# Cách dùng (trên máy chủ, tại thư mục gốc dự án):  bash tests/demo-traffic.sh
cd "$(dirname "$0")/.." && set -a && . ./.env && set +a
B=${BASE_URL:-https://localhost}
T=$(mktemp -d)
curl() { command curl -sk "$@"; }
sql()  { docker exec -e MYSQL_PWD="$MYSQL_PASSWORD" quiz-db mysql -N --default-character-set=utf8mb4 -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "$1" 2>/dev/null; }
csrf() { curl -b "$T/$1" -c "$T/$1" "$B$2" | grep -o 'name="_csrf" value="[^"]*"' | head -1 | sed 's/.*value="//;s/"$//'; }

NAMES=("Lê Minh Châu" "Phạm Quốc Dũng" "Hoàng Thu Hà" "Vũ Đức Huy" "Đặng Ngọc Lan" "Bùi Thanh Sơn")
SKILL=(90 80 70 60 50 40)        # % khả năng chọn đúng mỗi câu
PASSWORD=HocVien2026

echo "== Tạo tài khoản học viên demo =="
for i in "${!NAMES[@]}"; do
  u=$(printf 'hv%02d' $((i + 1)))
  tok=$(csrf "$u" /register)
  code=$(curl -o /dev/null -w '%{http_code}' -b "$T/$u" -c "$T/$u" --data-urlencode "_csrf=$tok" -d "username=$u" \
    --data-urlencode "full_name=${NAMES[$i]}" -d "student_code=DTC2452001$((10 + i))" \
    -d "password=$PASSWORD&password_confirm=$PASSWORD" "$B/register")
  if [ "$code" != "303" ]; then   # đã tồn tại -> đăng nhập
    tok=$(csrf "$u" /login)
    curl -o /dev/null -b "$T/$u" -c "$T/$u" --data-urlencode "_csrf=$tok" -d "username=$u&password=$PASSWORD" "$B/login"
  fi
  echo "  $u  ${NAMES[$i]}"
done

for round in 1 2 3; do
  echo "== Lượt thi $round =="
  for i in "${!NAMES[@]}"; do
    u=$(printf 'hv%02d' $((i + 1)))
    quiz=$(( (i + round) % 3 + 1 ))
    tok=$(csrf "$u" "/quiz/$quiz")
    url=$(curl -o /dev/null -w '%{redirect_url}' -b "$T/$u" -c "$T/$u" -d "_csrf=$tok" "$B/quiz/$quiz/start")
    [[ "$url" == *"/attempt/"* ]] || { echo "  $u: không bắt đầu được đề $quiz (hết lượt?)"; continue; }
    aid=${url##*/}
    curl -o /dev/null -b "$T/$u" "$B/attempt/$aid"          # mở trang làm bài
    sleep $((RANDOM % 3 + 2))                                 # thời gian "suy nghĩ"
    data="_csrf=$(csrf "$u" "/attempt/$aid")"
    while read -r qid correct; do
      if [ $((RANDOM % 100)) -lt "${SKILL[$i]}" ]; then ans=$correct
      else ans=$(echo A B C D | tr ' ' '\n' | grep -v "$correct" | shuf -n1); fi
      data="$data&q_$qid=$ans"
    done < <(sql "SELECT id, correct_option FROM questions WHERE quiz_id = $quiz")
    curl -o /dev/null -b "$T/$u" -d "$data" "$B/attempt/$aid/submit"
    echo "  $u làm đề $quiz: $(sql "SELECT CONCAT(score, '/', total) FROM attempts WHERE id = $aid")"
    curl -o /dev/null -b "$T/$u" "$B/result/$aid"            # xem kết quả
    curl -o /dev/null -b "$T/$u" "$B/quiz/$quiz/leaderboard" # xem bảng xếp hạng
  done
  # Một "kẻ tấn công" thử đoán mật khẩu của hv01
  for n in 1 2 3; do
    tok=$(csrf attacker /login)
    curl -o /dev/null -b "$T/attacker" -c "$T/attacker" --data-urlencode "_csrf=$tok" -d "username=hv01&password=doan-sai-$round$n" "$B/login"
  done
  echo "  (3 lần đăng nhập sai từ kẻ tấn công)"
  sleep 15
done

rm -rf "$T"
echo "== Xong. Tổng số bài đã nộp: $(sql "SELECT COUNT(*) FROM attempts WHERE status = 'submitted'") =="
