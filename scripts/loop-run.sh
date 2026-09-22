#!/usr/bin/env bash
# ループの 1 周: テストケース表から 1 件選び、worktree でエージェントに書かせ、機械で確かめて着地させる。
# 設計は docs/runbook/02-loop.md。人が手で叩いても、タイマーから呼んでも同じ。
#
# 使い方(本体の作業ツリーのルートで):
#   scripts/loop-run.sh                 1 件。検証まで通したら worktree を残して止まる(人が差分を見て着地)
#   scripts/loop-run.sh --land auto     1 件。検証が通れば main へ着地まで行う
#   scripts/loop-run.sh --max 3         最大 3 件を続けて回す
#   scripts/loop-run.sh --dry-run       次の 1 件と依頼文を出すだけ(エージェントを起動しない)
#
# 止め方: touch ~/.cache/perfect-crm/loop/HALT(消すまで起動しない。連続失敗でも自動で立つ)
#
# 分業: 書く役=エージェント(claude -p) / 確かめる役=このスクリプト(触ったパスの検査 + verify.sh)。
# エージェントの「終わりました」は信用せず、コミットの中身と verify の結果だけで決める。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LAND="hold"; MAX=1; DRY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --land) LAND="${2:-}"; shift 2 ;;
    --max) MAX="${2:-1}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "NG: 不明な引数: $1" >&2; exit 64 ;;
  esac
done
case "$LAND" in hold|auto) ;; *) echo "NG: --land は hold か auto" >&2; exit 64 ;; esac

CLAUDE_BIN="${LOOP_CLAUDE_BIN:-$HOME/.local/bin/claude}"
AGENT_TIMEOUT="${LOOP_AGENT_TIMEOUT:-1800}"
MAX_ATTEMPTS="${LOOP_MAX_ATTEMPTS:-2}"
BREAKER="${LOOP_BREAKER:-3}"
STATE_DIR="${LOOP_STATE_DIR:-$HOME/.cache/perfect-crm/loop}"
LEDGER="$STATE_DIR/runs.jsonl"
PICK_REF="${LOOP_PICK_REF:-origin/main}"
mkdir -p "$STATE_DIR/logs"

say() { echo "[loop $(TZ=Asia/Tokyo date '+%H:%M:%S')] $*"; }
now() { TZ=Asia/Tokyo date '+%Y-%m-%dT%H:%M:%S+09:00'; }
today() { TZ=Asia/Tokyo date '+%Y-%m-%d'; }
ledger() { node -e 'const [id,result,detail,land]=process.argv.slice(1);console.log(JSON.stringify({at:new Date().toISOString(),id,result,detail,land}))' "$1" "$2" "$3" "$LAND" >> "$LEDGER"; }

if [ "$DRY" = 0 ]; then
  case "$(git rev-parse --show-toplevel 2>/dev/null)" in
    */.claude/worktrees/*) echo "NG: 本体の作業ツリーのルートで実行してください" >&2; exit 64 ;;
  esac
fi

exec 9>"$STATE_DIR/lock"
flock -n 9 || { say "別のループが動いています。何もしません"; exit 0; }
[ -e "$STATE_DIR/HALT" ] && { say "HALT が立っています($STATE_DIR/HALT)。原因を確かめて消してから再開してください"; exit 0; }
if [ -f "$LEDGER" ]; then
  RECENT_FAILS="$(tail -n "$BREAKER" "$LEDGER" | grep -c '"result":"failed"' || true)"
  if [ "$(wc -l < "$LEDGER")" -ge "$BREAKER" ] && [ "$RECENT_FAILS" -ge "$BREAKER" ]; then
    echo "連続 $BREAKER 件失敗したため停止($(now))。$LEDGER と $STATE_DIR/logs を確認" > "$STATE_DIR/HALT"
    say "連続失敗で HALT を立てました"; exit 1
  fi
fi

# 失敗・保留の記録を loops/tests/<ID>.md に残して着地させる(次の周が同じ失敗を繰り返さないための記憶)
record_attempt() { # wt id state note
  local wt="$1" id="$2" state="$3" note="$4" file="loops/tests/$2.md"
  ( cd "$wt" || exit 1
    git reset -q --hard origin/main
    mkdir -p loops/tests
    [ -f "$file" ] || printf '# %s\n\n- 状態: 未着手\n\n## 試行の記録\n\n' "$id" > "$file"
    local n; n="$(grep -c '^- \[' "$file" || true)"; n=$((n + 1))
    [ "$state" = "失敗" ] && [ "$n" -ge "$MAX_ATTEMPTS" ] && state="保留" && note="$note(試行 $n 回で通らず、人へ返す)"
    [ "$state" = "保留" ] && sed -i "s|^- 状態:.*|- 状態: 保留($(today)): $note|" "$file"
    printf -- '- [%s] %s: %s\n' "$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M')" "$state" "$note" >> "$file"
    git add -- "$file" && git commit -q -m "loops: $id の試行を記録する($state)" -- "$file" \
      && bash scripts/wt-land.sh >"$STATE_DIR/logs/$id-record-land.log" 2>&1
  )
}

DONE=0
while [ "$DONE" -lt "$MAX" ]; do
  git fetch -q origin main || { say "fetch に失敗"; exit 1; }
  PICK_DIR="$(mktemp -d)"
  git archive "$PICK_REF" docs/tests loops scripts/loop-next.mjs frontend/e2e 2>/dev/null | tar -x -C "$PICK_DIR" 2>/dev/null
  [ -f "$PICK_DIR/scripts/loop-next.mjs" ] || { say "$PICK_REF に scripts/loop-next.mjs がありません"; rm -rf "$PICK_DIR"; exit 1; }
  MAIN_TREE="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
  mkdir -p "$PICK_DIR/.claude"; ln -s "$MAIN_TREE/.claude/worktrees" "$PICK_DIR/.claude/worktrees"
  NEXT="$(node "$PICK_DIR/scripts/loop-next.mjs")"
  ID="$(node -e 'console.log(JSON.parse(process.argv[1]).id ?? "")' "$NEXT")"
  if [ -z "$ID" ]; then say "取れる行がありません: $NEXT"; rm -rf "$PICK_DIR"; break; fi
  PROMPT="$(node "$PICK_DIR/scripts/loop-next.mjs" --prompt)"
  rm -rf "$PICK_DIR"

  say "対象: $ID"
  if [ "$DRY" = 1 ]; then echo "$NEXT"; echo "-----"; echo "$PROMPT"; exit 0; fi

  NAME="loop-$(echo "$ID" | tr 'A-Z' 'a-z')"
  WT="$ROOT/.claude/worktrees/$NAME"
  bash scripts/wt-new.sh "$NAME" >"$STATE_DIR/logs/$ID-wt-new.log" 2>&1 || { say "worktree を作れません"; ledger "$ID" failed "wt-new"; exit 1; }

  LOG="$STATE_DIR/logs/$ID-$(TZ=Asia/Tokyo date '+%Y%m%d-%H%M%S').json"
  say "エージェントを起動(上限 ${AGENT_TIMEOUT}s)。ログ: $LOG"
  ( cd "$WT" && timeout "$AGENT_TIMEOUT" "$CLAUDE_BIN" -p "$PROMPT" --output-format json ) >"$LOG" 2>&1
  AGENT_RC=$?

  FAIL=""
  [ "$AGENT_RC" = 0 ] || FAIL="エージェントが異常終了(rc=$AGENT_RC。124 は時間切れ)"
  if [ -z "$FAIL" ] && [ -n "$(git -C "$WT" status --porcelain | grep -v '^?? frontend/node_modules$')" ]; then FAIL="未コミットの変更を残して終わった"; fi
  CHANGED="$(git -C "$WT" diff --name-only origin/main...HEAD)"
  if [ -z "$FAIL" ] && [ -z "$CHANGED" ]; then FAIL="コミットが無い"; fi
  if [ -z "$FAIL" ]; then
    AREA_TABLE="docs/tests/$(echo "$ID" | sed 's/-.*//' | tr 'A-Z' 'a-z').md"
    while IFS= read -r f; do
      case "$f" in
        "loops/tests/$ID.md"|"$AREA_TABLE") ;;
        frontend/src/*.test.ts|frontend/src/*.test.tsx) ;;
        *) FAIL="触ってはいけないパスを変更した: $f"; break ;;
      esac
    done <<< "$CHANGED"
  fi

  HELD=0
  if [ -z "$FAIL" ] && grep -q '^- 状態: 保留' "$WT/loops/tests/$ID.md" 2>/dev/null; then
    HELD=1
    [ "$CHANGED" = "loops/tests/$ID.md" ] || FAIL="保留なのに状態ファイル以外も変更している"
  fi

  if [ -z "$FAIL" ] && [ "$HELD" = 0 ]; then
    say "verify を実行"
    if ! ( cd "$WT" && bash scripts/verify.sh ) >"$STATE_DIR/logs/$ID-verify.log" 2>&1; then
      FAIL="verify が red: $(grep -E '\| red \|' "$STATE_DIR/logs/$ID-verify.log" | sed 's/ *| */ /g' | tr '\n' ';' | cut -c1-200)"
    elif ! grep -q "^- 状態: 完了" "$WT/loops/tests/$ID.md" 2>/dev/null; then
      FAIL="loops/tests/$ID.md が完了になっていない"
    fi
  fi

  if [ -n "$FAIL" ]; then
    say "失敗: $FAIL"; ledger "$ID" failed "$FAIL"
    record_attempt "$WT" "$ID" "失敗" "$FAIL" || say "試行の記録を着地できませんでした($STATE_DIR/logs/$ID-record-land.log)。worktree を残します: $WT"
  elif [ "$HELD" = 1 ]; then
    say "保留(エージェントの判断)。理由を着地させます"; ledger "$ID" held "$(grep -m1 '^- 状態:' "$WT/loops/tests/$ID.md")"
    ( cd "$WT" && bash scripts/wt-land.sh ) >"$STATE_DIR/logs/$ID-land.log" 2>&1 || say "着地に失敗。worktree を残します: $WT"
  elif [ "$LAND" = "auto" ]; then
    if ( cd "$WT" && bash scripts/wt-land.sh ) >"$STATE_DIR/logs/$ID-land.log" 2>&1; then
      say "着地しました: $ID"; ledger "$ID" landed "auto"
    else
      say "着地に失敗(rebase の衝突か verify)。worktree を残します: $WT"; ledger "$ID" failed "wt-land"
    fi
  else
    say "検証済み。差分を見て着地させてください:"
    echo "    git -C $WT diff origin/main...HEAD"
    echo "    (cd $WT && bash scripts/wt-land.sh)      # やめるなら git worktree remove --force $WT && git branch -D wt/$NAME"
    ledger "$ID" verified "hold"
  fi
  DONE=$((DONE + 1))
done
say "終了(${DONE} 件)"
