#!/usr/bin/env python3
"""公開 URL に門(Cloudflare Access)を挟まずに届き、アプリ自身の守りが効いていることを、外から確かめる。

  python3 scripts/public-check.py works.sanei-clover.com

読むだけで、本番の DB を書き換えない(ログインの口は Origin で断られる形だけを叩く。その場合、記録は残らない)。
Cloudflare の API も .env も使わない。確かめること(docs/design/06 §3・§7):

- 画面の HTML・SPA のパス・/healthz が、Access のログインへ送られずに返る。配る側のヘッダ(CSP・HSTS など)が付く
- 未ログインの API は 401 unauthenticated(アプリが答えている)。ログインの画面が読むものは 200
- Google・Microsoft でログインを開けていれば、その口が提供元の許可の画面へ送り、戻り先が公開 URL を名乗る
- よそのサイトからのログインは 403 bad_origin
- MCP はトークンが無ければ 401 で、メタデータの場所を教える。OAuth のメタデータが公開 URL を名乗る
- 20 MB を超える本文は 413(api に届く前に Caddy が断る)
"""
import argparse, json, sys, urllib.error, urllib.parse, urllib.request

p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
p.add_argument('host')
args = p.parse_args()
base = f'https://{args.host}'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def fetch(path, method='GET', body=None, headers=None):
    req = urllib.request.Request(base + path, data=body, method=method, headers={'User-Agent': 'works-public-check', **(headers or {})})
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=60) as r:
            return r.status, r.read().decode('utf-8', 'replace'), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace'), {k.lower(): v for k, v in e.headers.items()}


def code_of(text):
    try:
        return json.loads(text).get('code')
    except (ValueError, AttributeError):
        return None


failed = False


def check(ok, label, detail=''):
    global failed
    print('PASS' if ok else 'FAIL', label + (f'({detail})' if detail else ''))
    failed |= not ok


status, body, headers = fetch('/')
gate = status in (301, 302, 303) and 'cloudflareaccess.com' in headers.get('location', '')
check(status == 200 and '<div id="root">' in body, '画面の HTML が、Access を挟まずに返る', 'Access のログインへ送られた。門がまだある' if gate else f'HTTP {status}')
for name in ('content-security-policy', 'strict-transport-security', 'x-frame-options', 'x-content-type-options'):
    check(name in headers, f'配る側のヘッダ {name} が付く')
status, body, _ = fetch('/o/tasks')
check(status == 200 and '<div id="root">' in body, 'SPA のパスでも HTML が返る', f'HTTP {status}')
status, body, _ = fetch('/healthz')
check(status == 200 and body.strip() == 'ok', '/healthz が返る', f'HTTP {status}')

status, body, _ = fetch('/api/v1/session')
check(status == 401 and code_of(body) == 'unauthenticated', '未ログインの API は 401 unauthenticated', f'HTTP {status} {code_of(body)}')
status, body, _ = fetch('/api/v1/session/options')
check(status == 200 and 'google' in body and 'microsoft' in body, 'ログインの画面が読むもの(/session/options)は 200', f'HTTP {status}')
options = json.loads(body) if status == 200 else {}
# 開けた提供元だけ: ボタンの口が許可の画面へ送る(状態は Cookie に置くだけで、DB には何も書かない)
for provider, host in (('google', 'accounts.google.com'), ('microsoft', 'login.microsoftonline.com')):
    if not options.get(provider):
        print(f'SKIP {provider} でログイン(設定が無い)')
        continue
    status, _, headers = fetch(f'/api/v1/session/{provider}?next=/')
    target = urllib.parse.urlparse(headers.get('location', ''))
    query = urllib.parse.parse_qs(target.query)
    check(
        status == 303 and target.netloc == host and query.get('redirect_uri') == [f'{base}/api/v1/session/{provider}/callback'],
        f'{provider} でログインの口が、許可の画面へ公開 URL の戻り先で送る',
        f'HTTP {status} {target.netloc}',
    )
status, body, _ = fetch('/api/v1/session', 'POST', json.dumps({'email': 'nobody@example.com', 'password': 'x'}).encode(),
                        {'Content-Type': 'application/json', 'Origin': 'https://evil.example'})
check(status == 403 and code_of(body) == 'bad_origin', 'よそのサイトからのログインは 403 bad_origin', f'HTTP {status} {code_of(body)}')

status, body, headers = fetch('/mcp', 'POST', b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
                              {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'})
check(status == 401 and 'resource_metadata=' in headers.get('www-authenticate', ''), 'MCP はトークンが無ければ 401 で、メタデータの場所を教える', f'HTTP {status}')
status, body, _ = fetch('/.well-known/oauth-authorization-server')
issuer = json.loads(body).get('issuer') if status == 200 else None
check(status == 200 and (issuer or '').rstrip('/') == base, 'OAuth のメタデータが公開 URL を名乗る', f'HTTP {status} issuer={issuer}')
status, body, _ = fetch('/.well-known/oauth-protected-resource/mcp')
resource = json.loads(body).get('resource') if status == 200 else None
check(status == 200 and resource == f'{base}/mcp', 'MCP の資源のメタデータが返る', f'HTTP {status}')

# 中身は JSON ですらない。Caddy が断らずに api へ届いても、本文の検証で落ちるだけで、何も書かない
status, _, _ = fetch('/api/v1/session', 'POST', b'x' * (21 * 1024 * 1024), {'Content-Type': 'application/json', 'Origin': base})
check(status == 413, '20 MB を超える本文は 413', f'HTTP {status}')

sys.exit(1 if failed else 0)
