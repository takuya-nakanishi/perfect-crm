"""ワークフローのアクション(04 §15)。種類ごとに 1 つのモジュールを持ち、`KINDS` に並べる。

アクションを足すときは、次の 5 つを持つモジュールを作って `KINDS` に足す(画面は `frontend/src/lib/workflow.ts` の
`ACTION_KINDS` に足す):

- `check(conn, obj, action)`: 画面から来たアクションを確かめて整える(不備は 400)
- `prepare(conn, firing)`: 動かすのに要るもの(実行記録の `payload`)を、**書き込みと同じトランザクションの中で**作る。
  レコードの値はここで写す(あとでレコードが変わっても、そのときの内容で動く)
- `execute(payload)`: 実際に動かす。**トランザクションの外で**呼ばれる(外のサービスを待つため)
- `target(conn, payload)`: 実行記録に出す送り先の名前(無くなっていれば None)
- `problems(conn, obj, action)`: いま動けない理由(画面に出す)
"""

from dataclasses import dataclass
from typing import Any, Literal, Protocol

from sqlalchemy import Connection

from app.records.origin import Origin


@dataclass(frozen=True)
class Firing:
    """ワークフローが 1 回動くときの材料。"""

    workflow_id: str
    workflow_name: str
    obj: dict[str, Any]
    # API の形の 1 行(`service.find` の `record`)。テスト送信でレコードが 1 件も無ければ None(見本の値で作る)
    record: dict[str, Any] | None
    event: str
    origin: Origin
    # 画面の「テスト送信」(実行記録には残さない)
    test: bool = False


@dataclass(frozen=True)
class Result:
    """動かした結果。retry は一時的な失敗で、送り係が間を空けて試し直す。"""

    status: Literal["done", "retry", "failed", "skipped"]
    error: str | None = None
    code: str | None = None
    retry_after: float | None = None


class ActionKind(Protocol):
    def check(self, conn: Connection, obj: dict[str, Any], action: dict[str, Any]) -> dict[str, Any]: ...

    def prepare(self, conn: Connection, firing: Firing, action: dict[str, Any]) -> dict[str, Any]: ...

    def execute(self, payload: dict[str, Any]) -> Result: ...

    def target(self, conn: Connection, payload: dict[str, Any]) -> str | None: ...

    def problems(self, conn: Connection, obj: dict[str, Any], action: dict[str, Any]) -> list[str]: ...

    def pace_key(self, payload: dict[str, Any]) -> str | None: ...


def kinds() -> dict[str, ActionKind]:
    """アクションの種類。循環を避けるため、使うときに読む。"""
    from app.workflows.actions import slack

    return {"slack": slack.KIND}
