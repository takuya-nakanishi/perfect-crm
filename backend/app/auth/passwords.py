"""パスワード(03 §5)。Argon2id で保存し、NIST SP 800-63B-4 の決まりに合わないものは断る。"""

import hashlib
import logging
import threading
import unicodedata

import httpx2
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.config import get_settings

logger = logging.getLogger("works.auth")

MIN_LENGTH = 15
# 64 文字以上を受けること、とされる(NIST)。上限は、長すぎる入力で重くしないため
MAX_LENGTH = 256

# 既定は RFC 9106 の低メモリの組(64 MiB・3 回・並列 4)。OWASP の最小(19 MiB・2 回・並列 1)より重い
_hasher = PasswordHasher()
# 同時に掛けるのは 2 本まで。ログインを連打されても、64 MiB ずつメモリを食わせない
_slots = threading.BoundedSemaphore(2)
# 利用者がいない・パスワードを持たないときに照らす見せかけ(かかる時間で見分けられないように)
_dummy: str | None = None

PWNED_URL = "https://api.pwnedpasswords.com/range/"
PWNED_TIMEOUT = 3.0


def normalize(password: str) -> str:
    """NFKC で正規化する(全角の英数字や、見た目が同じで符号の違う文字を揃える。NIST)。"""
    return unicodedata.normalize("NFKC", password)


def hash_password(password: str) -> str:
    with _slots:
        return _hasher.hash(normalize(password))


def _dummy_hash() -> str:
    global _dummy
    if _dummy is None:
        _dummy = _hasher.hash("works-dummy-password-for-timing")
    return _dummy


def verify(stored: str | None, password: str) -> bool:
    """照らす。`stored` が None(利用者がいない・パスワードを持たない)でも、同じだけ時間を掛けて False。"""
    target = stored or _dummy_hash()
    with _slots:
        try:
            _hasher.verify(target, normalize(password))
        except (VerificationError, InvalidHashError, ValueError):  # 壊れた値(文字化けなど)も「違う」
            return False
    return stored is not None


def needs_rehash(stored: str) -> bool:
    """強さの設定が変わっていれば、通ったときに掛け直す。"""
    return _hasher.check_needs_rehash(stored)


def pwned(password: str) -> bool:
    """漏えいした一覧(Have I Been Pwned)にあるか。送るのは SHA-1 の先頭 5 文字だけ。

    届かないときは通す(False)。決める人を止めないため。記録は残す。
    """
    if not get_settings().pwned_check:
        return False
    digest = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]
    try:
        with httpx2.Client(timeout=PWNED_TIMEOUT) as client:
            # 応答の大きさから推し量られないよう、ダミーを混ぜてもらう(Add-Padding)。ダミーは件数 0
            res = client.get(PWNED_URL + prefix, headers={"User-Agent": "works-crm", "Add-Padding": "true"})
            res.raise_for_status()
    except httpx2.HTTPError as exc:
        logger.warning("漏えいした一覧に照らせませんでした(通します): %s", exc)
        return False
    for line in res.text.splitlines():
        head, _, count = line.partition(":")
        if head.strip() == suffix and count.strip() not in ("", "0"):
            return True
    return False


def problem(password: str, *, email: str, name: str, workspace_name: str) -> str | None:
    """決まりに合わなければ、その理由の文。合えば None。"""
    text = normalize(password)
    if len(text) < MIN_LENGTH:
        return f"パスワードは {MIN_LENGTH} 文字以上にしてください"
    if len(text) > MAX_LENGTH:
        return f"パスワードは {MAX_LENGTH} 文字までにしてください"
    # 丸ごと同じものだけを断る(NIST は、部分や単語ではなく全体で照らすとしている)
    context = {email, email.split("@")[0], name, "works", workspace_name}
    if text.casefold() in {c.casefold() for c in context if c}:
        return "メールアドレス・名前・サービスの名前と同じパスワードは使えません"
    if pwned(text):
        return "漏えいしたことのあるパスワードです。別のものにしてください"
    return None
