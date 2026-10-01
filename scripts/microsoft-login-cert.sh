#!/usr/bin/env bash
# Microsoft でログイン(docs/design/03 §5)のクライアントの証明に使う証明書を作り、秘密鍵ごと .env に書き足す。
# 手順は docs/runbook/01 §6c。**秘密鍵は画面に出さない**(.env にだけ書く。作業の途中のファイルは消す)。
#
#   scripts/microsoft-login-cert.sh            証明書を作る → .env に WORKS_MICROSOFT_CERTIFICATE を書く → Entra に上げる証明書の置き場を出す
#
# 出すもの: Entra に上げる証明書(公開してよい側。~/works-microsoft-login.crt)、その SHA-1 の指紋(Entra の一覧に出る値)と期限。
# .env に WORKS_MICROSOFT_CERTIFICATE がもう入っていれば、何もしないで止まる(作り直すときは、その行を消してから流す)。
# 期限は 2 年(作り直したら、Entra に新しい証明書を上げ、古いものを消す)。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${WORKS_ENV_FILE:-$ROOT/.env}"
OUT="${WORKS_CERT_OUT:-$HOME/works-microsoft-login.crt}"
DAYS=730

[ -f "$ENV_FILE" ] || { echo "$ENV_FILE がありません" >&2; exit 1; }
if grep -q '^WORKS_MICROSOFT_CERTIFICATE=.' "$ENV_FILE"; then
  echo "$ENV_FILE には WORKS_MICROSOFT_CERTIFICATE がもう入っています。作り直すなら、その行を消してから流してください" >&2
  exit 1
fi

umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# RSA(Works は PS256 で署名する)。-nodes は OpenSSL 3.0 で非推奨なので -noenc(03 §13)
openssl req -x509 -newkey rsa:3072 -noenc -sha256 -days "$DAYS" -subj "/CN=Works login" \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
VALUE="$(cat "$TMP/key.pem" "$TMP/cert.pem" | base64 -w0)"

if grep -q '^WORKS_MICROSOFT_CERTIFICATE=$' "$ENV_FILE"; then
  # .env.example から写した空の行があれば、そこに入れる(同じ名前の行を 2 つ作らない)
  sed -i "s|^WORKS_MICROSOFT_CERTIFICATE=\$|WORKS_MICROSOFT_CERTIFICATE=$VALUE|" "$ENV_FILE"
else
  printf 'WORKS_MICROSOFT_CERTIFICATE=%s\n' "$VALUE" >>"$ENV_FILE"
fi
umask 022
cp "$TMP/cert.pem" "$OUT"

echo "書きました: $ENV_FILE の WORKS_MICROSOFT_CERTIFICATE(秘密鍵と証明書。値は出しません)"
echo "Entra に上げる証明書: $OUT"
if command -v wslpath >/dev/null 2>&1; then echo "  Windows からは: $(wslpath -w "$OUT")"; fi
echo "  $(openssl x509 -in "$OUT" -noout -fingerprint -sha1 | sed 's/^sha1 Fingerprint=/SHA-1 の指紋(Entra の「拇印」): /I')"
echo "  期限: $(openssl x509 -in "$OUT" -noout -enddate | sed 's/^notAfter=//')"
echo "次: Entra のアプリ登録 › 証明書とシークレット › 証明書 › 証明書のアップロード で上げる(docs/runbook/01 §6c)"
