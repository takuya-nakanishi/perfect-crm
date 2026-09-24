#!/usr/bin/env bash
# 画面を http モード(本物の API + PostgreSQL)で動かし、モックと同じ E2E(frontend/e2e/smoke.mjs)を通す(J-024)。
#
#   scripts/e2e-http.sh              E2E 用の DB を種のデータで作り直す → api と画面を起こす → E2E → 片付ける
#   scripts/e2e-http.sh --keep       終わっても api と画面を止めない(ブラウザで様子を見るとき)
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

PIDS=()
cleanup() {
  if [ "$KEEP" = 0 ]; then for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; fi
}
trap cleanup EXIT

wait_http() {
  for _ in $(seq 1 60); do curl -fs -o /dev/null "$1" && return 0; sleep 0.5; done
  echo "起動しませんでした: $1(ログ: $LOG)" >&2; return 1
}

echo "== 種のデータで DB を作り直す"
(cd "$ROOT/backend" && .venv/bin/python -m app.cli reset-demo >"$LOG/reset.log" 2>&1) || { cat "$LOG/reset.log" >&2; exit 1; }

echo "== api を起こす(127.0.0.1:$API_PORT)"
(cd "$ROOT/backend" && exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" >"$LOG/api.log" 2>&1) &
PIDS+=($!)
wait_http "http://127.0.0.1:$API_PORT/healthz"

echo "== 画面を http モードで起こす(127.0.0.1:$WEB_PORT)"
(cd "$ROOT/frontend" && VITE_API_MODE=http WORKS_API_TARGET="http://127.0.0.1:$API_PORT" \
  exec npx vite --port "$WEB_PORT" --strictPort >"$LOG/web.log" 2>&1) &
PIDS+=($!)
wait_http "http://127.0.0.1:$WEB_PORT/"

echo "== E2E"
status=0
(cd "$ROOT/frontend" && node e2e/smoke.mjs "http://127.0.0.1:$WEB_PORT") || status=$?
if [ "$status" != 0 ]; then echo "api のログ: $LOG/api.log"; fi
[ "$KEEP" = 1 ] && echo "api と画面は動いたまま(http://127.0.0.1:$WEB_PORT)。止めるなら kill ${PIDS[*]}"
exit "$status"
