#!/usr/bin/env bash
# 検証をまとめて実行する: 型検査 + 本番ビルド、lint、単体テスト(Vitest)、テストケース表の整合。
# 無人ループ(scripts/loop-run.sh)と着地(scripts/wt-land.sh)の関門。人も手で回してよい。
# E2E(実ブラウザ)は開発サーバと Chromium が要るので含めない(npm run e2e を別に回す。docs/runbook/01 §2)。
#
#   scripts/verify.sh            結果を標準出力に表で出す。全部 green なら 0、どこか red なら 1
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
strip_ansi() { sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g'; }

declare -a NAMES=() STATUSES=() DURS=() FAILED_NAMES=() FAILED_LOGS=()
FAILED=0
STEP_N=0
run_step() {
  local name="$1"; shift
  local out="$TMP/step-${STEP_N}.log"; STEP_N=$((STEP_N + 1))
  local t0=$SECONDS
  if "$@" >"$out" 2>&1; then
    NAMES+=("$name"); STATUSES+=("green"); DURS+=("$((SECONDS - t0))s")
  else
    NAMES+=("$name"); STATUSES+=("red"); DURS+=("$((SECONDS - t0))s")
    FAILED=1; FAILED_NAMES+=("$name"); FAILED_LOGS+=("$out")
  fi
}

# 依存が無ければ先に入れる(worktree では本体の node_modules をリンクしている)
if [ ! -d frontend/node_modules ]; then
  run_step "frontend:npm ci" npm --prefix frontend ci --no-audit --no-fund
fi
run_step "frontend:build" npm --prefix frontend run -s build
run_step "frontend:lint" npm --prefix frontend run -s lint
run_step "frontend:test" npm --prefix frontend run -s test
# テストケース表(docs/tests)と実在するテスト(*.test.ts、E2E のラベル)の対応が崩れていないか
run_step "tests:table-consistency" node scripts/loop-next.mjs --check

VERDICT="green"; [ "$FAILED" = 1 ] && VERDICT="red"
echo "# verify $(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S') — ${VERDICT}"
echo
echo "- ブランチ: $(git branch --show-current) / コミット: $(git rev-parse --short HEAD) / 未コミット変更: $([ -n "$(git status --porcelain)" ] && echo あり || echo なし)"
echo
echo "| ステップ | 結果 | 所要 |"
echo "|---|---|---|"
for i in "${!NAMES[@]}"; do echo "| ${NAMES[$i]} | ${STATUSES[$i]} | ${DURS[$i]} |"; done
if [ "$FAILED" = 1 ]; then
  echo
  echo "## 失敗ステップの出力"
  for i in "${!FAILED_NAMES[@]}"; do
    echo; echo "### ${FAILED_NAMES[$i]}"; echo '```'; strip_ansi < "${FAILED_LOGS[$i]}" | tail -n 120; echo '```'
  done
fi
exit $FAILED
