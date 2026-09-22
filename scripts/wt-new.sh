#!/usr/bin/env bash
# 並行セッションと無人ループ用の作業ツリーを作る(origin/main から wt/<名前> を切る)。
# 同じ作業ツリーで 2 つのセッションを動かすと、片方の git add が他方の未コミット変更を巻き込むため、物理的に分ける。
#
# 使い方: scripts/wt-new.sh <名前>      例) scripts/wt-new.sh loop-meta-004
# 統合は scripts/wt-land.sh(rebase → verify → main へ push → worktree とブランチを削除)。PR は作らない
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
die() { echo "NG: $*" >&2; exit 1; }

NAME="${1:-}"
[ -n "$NAME" ] || die "作業名を指定してください(例: scripts/wt-new.sh loop-meta-004)"
echo "$NAME" | grep -qE '^[a-z0-9][a-z0-9-]*$' || die "作業名は英小文字・数字・ハイフンにしてください: $NAME"

BRANCH="wt/$NAME"
DIR=".claude/worktrees/$NAME"   # .gitignore 済み
[ -e "$DIR" ] && die "既にあります: $DIR(使い終わっていれば scripts/wt-land.sh か git worktree remove)"
git show-ref --verify --quiet "refs/heads/$BRANCH" && die "ブランチが残っています: $BRANCH"

git fetch origin main || die "fetch に失敗しました"
git worktree add -b "$BRANCH" "$DIR" origin/main || die "worktree の作成に失敗しました"
# frontend の node_modules は本体のものを共有する(worktree ごとに入れ直さない)
if [ -d "$ROOT/frontend/node_modules" ]; then
  ln -s "$ROOT/frontend/node_modules" "$DIR/frontend/node_modules" || die "node_modules のリンクに失敗しました"
fi
echo "作業ツリー: $ROOT/$DIR(ブランチ $BRANCH、origin/main から)。終わったら中で: bash $ROOT/scripts/wt-land.sh"
