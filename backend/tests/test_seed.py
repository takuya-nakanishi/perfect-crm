"""初期定義(app/seed)が、画面のモック(frontend/src/mocks/fixtures)と同じであること。

同じものを 2 か所に置いているので、**食い違ったらここで落ちる**。
片方だけ直すと画面とサーバで定義がずれるため、直すときは両方を同じコミットで。
"""

import json
from pathlib import Path

import pytest

from app.meta.seed import SEED_DIR

FIXTURES = Path(__file__).resolve().parents[2] / "frontend" / "src" / "mocks" / "fixtures"


@pytest.mark.parametrize("name", ["objects", "views"])
def test_初期定義がモックの_fixtures_と一致する(name: str) -> None:
    if not FIXTURES.exists():  # 配布したイメージの中には画面のソースが無い
        pytest.skip("frontend/src/mocks/fixtures が無い")
    ours = json.loads((SEED_DIR / f"{name}.json").read_text(encoding="utf-8"))
    theirs = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    assert ours == theirs
