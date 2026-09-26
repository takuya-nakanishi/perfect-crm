#!/usr/bin/env bash
# 画面を http モード(本物の API + PostgreSQL)で動かし、モックと同じ E2E(frontend/e2e/smoke.mjs)を通す(J-024)。
#
#   scripts/e2e-http.sh              E2E 用の DB を種のデータで作り直す → api と画面を起こす → E2E → 片付ける
#   scripts/e2e-http.sh --keep       終わっても api と画面を止めない(ブラウザで様子を見るとき。止め方は最後に出る)
#
# ポート(E2E_API_PORT・E2E_WEB_PORT。既定 8621・5621)が既に使われていたら始めない。
# 残っていた古い画面に向けて E2E が通ってしまうのを防ぐため。
#
# DB は `works_e2e`(名前が _e2e で終わる DB にしか種を入れない。本番の works には触れない)。
# 置き場は Compose の db(127.0.0.1:${WORKS_DB_PORT:-55432})で、利用者とパスワードは .env のもの。
# 別の場所に向けるなら WORKS_E2E_DATABASE_URL(postgresql+psycopg://…/works_e2e)。
# ログインは WORKS_AUTH=dev(メールアドレスだけ)。Access が無い手元のためで、公開する場所ではこの形にしない。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${E2E_API_PORT:-8621}"
WEB_PORT="${E2E_WEB_PORT:-5621}"
KEEP=0; [ "${1:-}" = "--keep" ] && KEEP=1
LOG="$(mktemp -d)"

export WORKS_AUTH=dev WORKS_SECURE_COOKIE=false
if [ -n "${WORKS_E2E_DATABASE_URL:-}" ]; then
  export WORKS_DATABASE_URL="$WORKS_E2E_DATABASE_URL"
else
  export WORKS_DB_HOST=127.0.0.1 WORKS_DB_PORT="${WORKS_DB_PORT:-55432}" WORKS_DB_NAME=works_e2e
fi

# 起こしたもの(api と画面)は、それぞれ別のプロセスグループにして、止めるときはグループごと止める。
# npx は npm exec → sh → node(vite)と子を作るので、最初のプロセスだけ止めると vite が残り、
# 次の実行でポートがふさがる(2026-09-26 に、34 時間前の実行の vite が残っていた)
PGIDS=()
start() {  # $1: 置き場, $2: ログ, 残り: コマンド
  local dir="$1" log="$2"; shift 2
  # この非対話のシェルでは、非同期の子はグループの長ではないので、setsid は fork せずに exec する。
  # だから $! がそのまま新しいグループの ID になる
  (cd "$dir" && exec setsid "$@" </dev/null >"$log" 2>&1) &
  PGIDS+=("$!")
}
stop_all() {
  local p alive
  for p in "${PGIDS[@]}"; do kill -TERM -- "-$p" 2>/dev/null || true; done
  # ポートが空くまで待つ。5 秒で止まらなければ KILL
  for _ in $(seq 1 50); do
    alive=0
    for p in "${PGIDS[@]}"; do kill -0 -- "-$p" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && return 0
    sleep 0.1
  done
  for p in "${PGIDS[@]}"; do kill -KILL -- "-$p" 2>/dev/null || true; done
}
cleanup() {
  if [ "$KEEP" = 0 ]; then stop_all; return; fi
  # 途中で失敗して終わっても、動いているものの止め方は出す
  local p running=()
  for p in "${PGIDS[@]}"; do kill -0 -- "-$p" 2>/dev/null && running+=("$p"); done
  if [ "${#running[@]}" -gt 0 ]; then
    echo "起こしたものは動いたまま(画面は http://127.0.0.1:$WEB_PORT)。止めるなら kill --$(printf ' -%s' "${running[@]}")"
  fi
}
trap cleanup EXIT
# Ctrl+C・kill でも片付けを通す(起こしたものは別のグループなので、端末の Ctrl+C は届かない)
trap 'exit 130' INT
trap 'exit 143' TERM

# この WSL では、待ち受けの無いポートへの接続が拒否されず、SYN-SENT のまま 2 分ほど待たされる。
# だから接続の成否でポートを調べない(待ち受けの一覧を見る)。起動待ちの curl にも接続の上限を付ける
wait_http() {  # $1: URL。いま起こしたもの(PGIDS の最後)が途中で落ちたら、待たずに止める
  local pid="${PGIDS[-1]}"
  for _ in $(seq 1 60); do
    curl -fs --connect-timeout 1 --max-time 10 -o /dev/null "$1" && return 0
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  echo "起動しませんでした: $1(ログ: $LOG)" >&2; return 1
}

for port in "$API_PORT" "$WEB_PORT"; do
  if [ -n "$(ss -Hltn "sport = :$port")" ]; then
    echo "127.0.0.1:$port は既に使われています。前の実行の残りなら止めてから流してください(持ち主は ss -ltnp | grep :$port)。\
別のポートで流すなら E2E_API_PORT・E2E_WEB_PORT" >&2
    exit 1
  fi
done

echo "== 種のデータで DB を作り直す"
(cd "$ROOT/backend" && .venv/bin/python -m app.cli reset-demo >"$LOG/reset.log" 2>&1) || { cat "$LOG/reset.log" >&2; exit 1; }

echo "== api を起こす(127.0.0.1:$API_PORT)"
start "$ROOT/backend" "$LOG/api.log" .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT"
wait_http "http://127.0.0.1:$API_PORT/healthz"

echo "== 画面を http モードで起こす(127.0.0.1:$WEB_PORT)"
start "$ROOT/frontend" "$LOG/web.log" env VITE_API_MODE=http WORKS_API_TARGET="http://127.0.0.1:$API_PORT" \
  npx vite --port "$WEB_PORT" --strictPort
wait_http "http://127.0.0.1:$WEB_PORT/"

echo "== E2E"
status=0
(cd "$ROOT/frontend" && node e2e/smoke.mjs "http://127.0.0.1:$WEB_PORT") || status=$?
if [ "$status" != 0 ]; then echo "api のログ: $LOG/api.log"; fi
exit "$status"
