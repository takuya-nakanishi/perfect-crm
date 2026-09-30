"""書き込みがどこから来たか(04 §15)。ワークフローの「どこから」と、実行記録に使う。

書き込みの経路は `service.insert` / `service.update` の 1 本なので、呼ぶ側が必ずこれを渡す(省けない引数にしてある)。
"""

from dataclasses import dataclass
from typing import Literal

OriginKind = Literal["app", "form", "mcp", "auto", "import"]

# 画面の並びと同じ順。`import`(CSV の取り込み)は、ワークフローの既定では動かさない(100 件入れると 100 通届く)
ORIGIN_KINDS: tuple[OriginKind, ...] = ("app", "form", "mcp", "auto", "import")


@dataclass(frozen=True)
class Origin:
    kind: OriginKind
    # 書いた人。Web フォームは None
    actor: str | None = None
    # 人に見せる補足(Web フォームの名前)
    label: str | None = None


def app(actor: str | None) -> Origin:
    """画面(と、画面と同じ API を叩くもの)。"""
    return Origin("app", actor)


def mcp(actor: str | None) -> Origin:
    return Origin("mcp", actor)


def form(label: str) -> Origin:
    return Origin("form", None, label)


def csv_import(actor: str | None) -> Origin:
    return Origin("import", actor)


def auto(actor: str | None) -> Origin:
    """業務ルールが作ったもの(繰り返しのタスクの次回)。きっかけを作った人を持つ。"""
    return Origin("auto", actor)
