"""起動前の支度。`python -m app.cli init` で、マイグレーション → 初期メタデータ → 管理者を揃える。"""

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


def main(argv: list[str]) -> int:
    if argv[1:2] == ["init"]:
        init()
        print("ok")
        return 0
    print("使い方: python -m app.cli init", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
