#!/usr/bin/env bash
# worktree の作業を main へ着地させる。PR は作らない。
# 流れ: 未コミット確認 → fetch → rebase origin/main → verify → main へ push → worktree とブランチを削除
#   - メインの作業ツリーに触らない(git push origin HEAD:main で直接送る)
#   - コンフリクトは自動解消しない。解消したら scripts/wt-land.sh --continue で再開する
#   - verify が red なら着地させない(PR を挟まないぶん、ここが唯一の関門)
set -u
die() { echo "NG: $*" >&2; exit 1; }
MODE="${1:-}"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "git の作業ツリーではありません"
WT_ROOT="$(git rev-parse --show-toplevel)"
cd "$WT_ROOT"

BRANCH="$(git branch --show-current)"
if [ -z "$BRANCH" ]; then
  for head_name in "$(git rev-parse --git-path rebase-merge/head-name)" "$(git rev-parse --git-path rebase-apply/head-name)"; do
    if [ -f "$head_name" ]; then BRANCH="$(sed 's|^refs/heads/||' "$head_name")"; break; fi
  done
fi
case "$BRANCH" in
  wt/*) ;;
  "") die "detached HEAD です。ブランチ上で実行してください" ;;
  *) die "worktree のブランチ(wt/*)で実行してください(現在: $BRANCH)。メインの main では使えません" ;;
esac

MAIN="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
[ -n "$MAIN" ] || die "メインの作業ツリーを特定できませんでした"
[ "$MAIN" != "$WT_ROOT" ] || die "ここはメインの作業ツリーです。worktree の中で実行してください"

if [ "$MODE" = "--continue" ]; then
  if [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
    git -c core.editor=true rebase --continue || die "rebase がまだ解消できていません。衝突を直して再度 --continue してください"
  fi
else
  [ -z "$(git status --porcelain | grep -v '^?? frontend/node_modules$')" ] || die "未コミットの変更があります。コミットしてから実行してください"
  git fetch origin main || die "fetch に失敗しました"
  if ! git rebase origin/main; then
    echo "NG: rebase でコンフリクトしました(自動解消はしません)。衝突: $(git diff --name-only --diff-filter=U | tr '\n' ' ')" >&2
    echo "解消したら: git add <パス> && bash scripts/wt-land.sh --continue / やめるなら: git rebase --abort" >&2
    exit 3
  fi
fi
[ -z "$(git status --porcelain | grep -v '^?? frontend/node_modules$')" ] || die "未コミットの変更が残っています"

echo "== verify =="
bash scripts/verify.sh || die "verify が red です。直してから再実行してください(着地させません)"

AHEAD="$(git rev-list --count origin/main..HEAD)"
if [ "$AHEAD" = "0" ]; then
  echo "== main へ送るコミットがありません =="
else
  echo "== main へ push($AHEAD コミット)=="
  git push origin "HEAD:main" || die "push に失敗しました(他セッションが先に進めた可能性。fetch して再実行してください)"
fi

cd "$MAIN" || die "メインの作業ツリーへ移動できませんでした"
rm -f "$WT_ROOT/frontend/node_modules"
git worktree remove --force "$WT_ROOT" || die "worktree の削除に失敗しました: $WT_ROOT"
git branch -D "$BRANCH" >/dev/null || die "ブランチの削除に失敗しました: $BRANCH"
echo "着地しました: $BRANCH → origin/main($AHEAD コミット)。本体では cd $MAIN && git pull --rebase"
