"""自前のログイン(03 §5。01 D-14)。

- `passwords` パスワードの保存(Argon2id)と決まり(NIST SP 800-63B-4)
- `totp` 2 段階認証(RFC 6238)。パスワードで入るときは必須
- `sessions` ブラウザのセッション(Cookie は乱数、DB は sha256)
- `challenges` パスワードが通り、2 段目を待つ札
- `throttle` 続けて失敗したときの待ちと、ログインの試みの記録

口(`/session`・`/account`)は `app/api/session.py`・`app/api/account.py`。
"""
