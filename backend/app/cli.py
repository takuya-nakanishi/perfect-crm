"""起動前の支度と、利用者の追加。

  python -m app.cli init                         マイグレーション → 初期メタデータ → 最初の管理者 → 参照の後始末
  python -m app.cli add-user <メール> [名前] [--admin]   利用者を足す(画面ができるまでの口。J-038)
  python -m app.cli set-password <メール>          パスワードを決める(標準入力から読む。画面にもログにも出さない)。
                                                 決め直したときは、その人のセッションとアプリの許可をすべて切る
  python -m app.cli reset-totp <メール>            2 段階認証を消す(端末を無くした人。次のログインで設定し直す)
  python -m app.cli reset-demo                   E2E 用の DB(名前が _e2e で終わる)を、モックと同じ種のデータで作り直す

ログインはアプリ自身が持つ(03 §5)。足した人は、Google で入るか、set-password で決めた最初のパスワードで入る。
パスワードで入るときは、最初のログインで 2 段階認証(TOTP)を設定する。
"""

import getpass
import sys
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, func, select, update

from app.auth import challenges, passwords, sessions
from app.config import get_settings
from app.db import get_engine
from app.meta import store
from app.meta.seed import ensure_user, seed
from app.meta.tables import users
from app.records.detach import detach_dangling

BACKEND_DIR = Path(__file__).resolve().parent.parent


def init() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    command.upgrade(config, "head")
    settings = get_settings()
    with get_engine().begin() as conn:
        seed(conn)
        if settings.admin_email:
            ensure_user(conn, name=settings.admin_name, email=settings.admin_email, admin=True)
        # 削除済みのレコードを指したまま残っている参照を外す(控えに残すので、元に戻せば付け直す。02 §4)
        detached = detach_dangling(conn)
        if detached:
            print(f"削除済みのレコードを指していた参照を {detached} 件外しました")


def add_user(args: list[str]) -> int:
    admin = "--admin" in args
    rest = [a for a in args if a != "--admin"]
    if not rest or "@" not in rest[0]:
        print("使い方: python -m app.cli add-user <メール> [名前] [--admin]", file=sys.stderr)
        return 2
    email = rest[0]
    name = " ".join(rest[1:]) or email.split("@")[0]
    with get_engine().begin() as conn:
        ensure_user(conn, name=name, email=email, admin=admin)
    print("ok")
    return 0


def _find_user(conn: Connection, email: str) -> Any | None:
    return conn.execute(
        select(users).where(users.c.email == email.strip().lower(), users.c.deleted_at.is_(None))
    ).first()


def _read_password() -> str:
    """端末なら 2 回打たせる(打ち間違いのまま決めない)。パイプなら 1 行目を読む。"""
    if sys.stdin.isatty():
        first = getpass.getpass("新しいパスワード: ")
        if getpass.getpass("もう一度: ") != first:
            raise SystemExit("2 回の入力が違います")
        return first
    return sys.stdin.readline().rstrip("\n")


def set_password(args: list[str]) -> int:
    if len(args) != 1 or "@" not in args[0]:
        print("使い方: python -m app.cli set-password <メール>(パスワードは標準入力から)", file=sys.stderr)
        return 2
    password = _read_password()
    with get_engine().begin() as conn:
        user = _find_user(conn, args[0])
        if user is None:
            print(f"{args[0]} は Works の利用者にいません(先に add-user)", file=sys.stderr)
            return 1
        reason = passwords.problem(
            password, email=user.email, name=user.name, workspace_name=store.get_workspace(conn)["name"]
        )
        if reason:
            print(reason, file=sys.stderr)
            return 1
        first = user.password_hash is None
        conn.execute(
            update(users)
            .where(users.c.id == user.id)
            .values(password_hash=passwords.hash_password(password), password_changed_at=func.clock_timestamp())
        )
        if not first:
            # 決め直したら、いまのセッションと許可はすべて切る(漏れたかもしれないパスワードで入った人を残さない)。
            # 初めて決めるときは切らない(漏れうる前のパスワードが無い。Claude のコネクタなどを繋ぎ直させない)
            sessions.revoke_all(conn, user.id, apps=True)
        challenges.drop_all(conn, user.id)
    print("ok(初めてのパスワード。ログイン中の端末とアプリの許可は残しました)" if first else "ok")
    return 0


def reset_totp(args: list[str]) -> int:
    if len(args) != 1 or "@" not in args[0]:
        print("使い方: python -m app.cli reset-totp <メール>", file=sys.stderr)
        return 2
    with get_engine().begin() as conn:
        user = _find_user(conn, args[0])
        if user is None:
            print(f"{args[0]} は Works の利用者にいません", file=sys.stderr)
            return 1
        conn.execute(
            update(users)
            .where(users.c.id == user.id)
            .values(totp_secret=None, totp_enabled_at=None, totp_last_step=None, totp_pending_secret=None)
        )
        challenges.drop_all(conn, user.id)
    print("ok(次にパスワードで入るときに設定し直します。パスワードも漏れた恐れがあれば set-password も)")
    return 0


def main(argv: list[str]) -> int:
    if argv[1:2] == ["init"]:
        init()
        print("ok")
        return 0
    if argv[1:2] == ["add-user"]:
        return add_user(argv[2:])
    if argv[1:2] == ["set-password"]:
        return set_password(argv[2:])
    if argv[1:2] == ["reset-totp"]:
        return reset_totp(argv[2:])
    if argv[1:2] == ["reset-demo"]:
        from app import demo

        demo.reset(get_engine())
        print("ok")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
