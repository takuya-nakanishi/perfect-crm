"""2 段階認証(TOTP。03 §5)。パスワードで入るときは必須。

RFC 6238 の SHA-1・6 桁・30 秒(認証アプリがそろって受ける組)。前後 1 刻みまで受け、
**同じコードは 1 回しか受けない**(最後に受けた刻みより後だけ。RFC 6238 §5.2・NIST の SHALL)。
秘密は照らすのに元の値が要るので、ハッシュではなく暗号化して持つ(鍵は `WORKS_SECRET_KEY` から導く)。
"""

import base64
import hashlib
import hmac
import time
import unicodedata
from typing import Any

import pyotp
import segno
from cryptography.fernet import Fernet, InvalidToken

from app.security import app_secret

PERIOD = 30
DIGITS = 6
# 前後に受ける刻みの数(端末の時計のずれと、通信と打つ時間のため)
WINDOW = 1


def new_secret() -> str:
    """32 文字の base32 = 160 ビット(NIST の下限は 112 ビット)。"""
    return pyotp.random_base32()


def _cipher() -> Fernet:
    key = hashlib.sha256(f"totp-secret|{app_secret()}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(secret: str) -> str:
    return _cipher().encrypt(secret.encode()).decode()


def decrypt(value: str | None) -> str | None:
    """鍵(`WORKS_SECRET_KEY`)が変わっていれば読めない(None)。その人は設定し直しになる。"""
    if not value:
        return None
    try:
        return _cipher().decrypt(value.encode()).decode()
    except InvalidToken:
        return None


def setup(secret: str, *, email: str, issuer: str) -> dict[str, Any]:
    """画面に出す設定の中身(04 §16 の `TotpSetup`)。QR は白地に黒の SVG(読み取りやすさのため)。"""
    uri = pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)
    qr = segno.make(uri, error="m").svg_data_uri(scale=5, border=2, dark="#000", light="#fff")
    return {"secret": secret, "otpauth_uri": uri, "qr_svg": qr}


def clean(code: str) -> str:
    """全角の数字は半角へ(日本語入力のまま打っても通るように)。空白やハイフンは捨てる。"""
    return "".join(ch for ch in unicodedata.normalize("NFKC", code) if ch.isdigit())


def matched_step(secret: str, code: str, *, last_step: int | None, now: float | None = None) -> int | None:
    """合っていれば、その刻み(30 秒の通し番号)を返す。`last_step` 以前の刻みは受けない。"""
    digits = clean(code)
    if len(digits) != DIGITS:
        return None
    totp = pyotp.TOTP(secret, digits=DIGITS, interval=PERIOD)
    current = int((time.time() if now is None else now) // PERIOD)
    for step in range(current - WINDOW, current + WINDOW + 1):
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(totp.at(step * PERIOD), digits):
            return step
    return None
