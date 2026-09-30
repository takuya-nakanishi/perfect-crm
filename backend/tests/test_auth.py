"""ログインの部品(03 §5): パスワードの決まりとハッシュ、TOTP の照らし方、端末の名前。"""

import httpx2
import pyotp
import pytest

from app.auth import passwords, sessions, totp

# RFC 6238 Appendix B の秘密("12345678901234567890" の base32)と、SHA-1 の期待値(8 桁の下 6 桁)
RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
RFC_VECTORS = [(59, "287082"), (1111111109, "081804"), (1111111111, "050471"), (1234567890, "005924")]


@pytest.mark.parametrize(("at", "expected"), RFC_VECTORS)
def test_RFC6238_の見本どおりのコードを受ける(at: int, expected: str) -> None:
    assert totp.matched_step(RFC_SECRET, expected, last_step=None, now=at) == at // 30


def test_前後_1_刻みまでは受け_2_刻み離れたら受けない() -> None:
    now = 1_800_000_000

    def code_at(at: int) -> str:
        return pyotp.TOTP(RFC_SECRET).at(at)

    assert totp.matched_step(RFC_SECRET, code_at(now - 30), last_step=None, now=now) is not None
    assert totp.matched_step(RFC_SECRET, code_at(now + 30), last_step=None, now=now) is not None
    assert totp.matched_step(RFC_SECRET, code_at(now - 60), last_step=None, now=now) is None
    assert totp.matched_step(RFC_SECRET, code_at(now + 60), last_step=None, now=now) is None


def test_受けた刻み以前のコードは受けない() -> None:
    now = 1_800_000_000
    code = pyotp.TOTP(RFC_SECRET).at(now)
    step = totp.matched_step(RFC_SECRET, code, last_step=None, now=now)
    assert step is not None
    assert totp.matched_step(RFC_SECRET, code, last_step=step, now=now) is None


@pytest.mark.parametrize("typed", ["287 082", "287-082", "２８７０８２"])
def test_空白やハイフン_全角の数字は整えて照らす(typed: str) -> None:
    assert totp.matched_step(RFC_SECRET, typed, last_step=None, now=59) == 1


@pytest.mark.parametrize("typed", ["", "28708", "2870821", "abcdef"])
def test_6_桁でなければ照らさない(typed: str) -> None:
    assert totp.matched_step(RFC_SECRET, typed, last_step=None, now=59) is None


def test_秘密は暗号化して持ち_鍵が違えば読めない(monkeypatch: pytest.MonkeyPatch) -> None:
    sealed = totp.encrypt(RFC_SECRET)
    assert RFC_SECRET not in sealed
    assert totp.decrypt(sealed) == RFC_SECRET
    monkeypatch.setattr(totp, "app_secret", lambda: "another-key")
    assert totp.decrypt(sealed) is None
    assert totp.decrypt(None) is None


def test_新しい秘密は_160_ビット() -> None:
    secret = totp.new_secret()
    assert len(secret) == 32
    assert secret != totp.new_secret()


def test_パスワードは_Argon2id_で持ち_元の文字は残らない() -> None:
    hashed = passwords.hash_password("correct horse battery staple")
    assert hashed.startswith("$argon2id$")
    assert "correct" not in hashed
    assert passwords.verify(hashed, "correct horse battery staple")
    assert not passwords.verify(hashed, "correct horse battery stapler")
    assert not passwords.verify(None, "correct horse battery staple")
    assert not passwords.verify("壊れた値", "correct horse battery staple")


def test_NFKC_で揃えてから照らす() -> None:
    hashed = passwords.hash_password("ｃｏｒｒｅｃｔ horse battery staple")
    assert passwords.verify(hashed, "correct horse battery staple")


def test_長さは正規化したあとの文字で数える() -> None:
    kw = {"email": "a@example.jp", "name": "A", "workspace_name": "W"}
    assert passwords.problem("あ" * 15, **kw) is None
    assert "15 文字以上" in (passwords.problem("あ" * 14, **kw) or "")
    assert passwords.problem("x" * 256, **kw) is None
    assert "256 文字まで" in (passwords.problem("x" * 257, **kw) or "")


def test_メールアドレスや名前と丸ごと同じものは断る() -> None:
    kw = {"email": "someone.long@example.jp", "name": "Very Long Name Here", "workspace_name": "Sanei Clover Inc."}
    assert passwords.problem("SOMEONE.LONG@example.jp", **kw) is not None
    assert passwords.problem("very long name here", **kw) is not None
    assert passwords.problem("sanei clover inc.", **kw) is not None
    # 部分に含むだけなら断らない(NIST は全体で照らす)
    assert passwords.problem("someone.long is my name", **kw) is None


class FakeResponse:
    def __init__(self, text: str) -> None:
        self.text = text

    def raise_for_status(self) -> None:
        return None


class FakeClient:
    def __init__(self, text: str, seen: list[str]) -> None:
        self.body = text
        self.seen = seen

    def __enter__(self) -> "FakeClient":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def get(self, url: str, headers: dict[str, str]) -> FakeResponse:
        self.seen.append(url)
        assert headers["User-Agent"]
        return FakeResponse(self.body)


def test_漏えいした一覧には_先頭_5_文字だけを送り_残りは手元で照らす(monkeypatch: pytest.MonkeyPatch) -> None:
    # "password" の SHA-1 は 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    seen: list[str] = []
    body = "1E4C9B93F3F0682250B6CF8331B7EE68FD8:9659365\r\n0000000000000000000000000000000000A:0"
    monkeypatch.setenv("WORKS_PWNED_CHECK", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr(httpx2, "Client", lambda **_: FakeClient(body, seen))
    try:
        assert passwords.pwned("password") is True
        assert seen == ["https://api.pwnedpasswords.com/range/5BAA6"]
        assert passwords.pwned("not in the list at all") is False
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()


def test_一覧に届かなければ通す(monkeypatch: pytest.MonkeyPatch) -> None:
    class Broken:
        def __init__(self, **_: object) -> None:
            raise httpx2.ConnectError("繋がらない")

    monkeypatch.setenv("WORKS_PWNED_CHECK", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr(httpx2, "Client", Broken)
    try:
        assert passwords.pwned("password") is False
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()


@pytest.mark.parametrize(
    ("agent", "label"),
    [
        ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36", "Chrome · Windows"),
        ("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0", "Edge · Windows"),
        ("Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1", "Safari · iPhone"),
        ("Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36", "Chrome · Android"),
        (None, "ブラウザ"),
    ],
)
def test_端末の名前(agent: str | None, label: str) -> None:
    assert sessions.describe(agent) == label
