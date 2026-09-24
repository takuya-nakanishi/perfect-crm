"""起動前の支度と、利用者の追加。

  python -m app.cli init                         マイグレーション → 初期メタデータ → 最初の管理者
  python -m app.cli add-user <メール> [名前] [--admin]   利用者を足す(画面ができるまでの口。J-038)
  python -m app.cli reset-demo                   E2E 用の DB(名前が _e2e で終わる)を、モックと同じ種のデータで作り直す

ログインは Cloudflare Access(03 §5)。Access のポリシーで通したうえで、ここで Works の利用者に足す。
"""

import sys
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.config import get_settings
from app.db import get_engine
from app.meta.seed import ensure_user, seed

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


def main(argv: list[str]) -> int:
    if argv[1:2] == ["init"]:
        init()
        print("ok")
        return 0
    if argv[1:2] == ["add-user"]:
        return add_user(argv[2:])
    if argv[1:2] == ["reset-demo"]:
        from app import demo

        demo.reset(get_engine())
        print("ok")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
