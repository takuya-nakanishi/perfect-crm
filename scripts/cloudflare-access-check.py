#!/usr/bin/env python3
"""Cloudflare Access の内側まで届くことを、外から確かめる。

  python3 scripts/cloudflare-access-check.py works.sanei-clover.com
  python3 scripts/cloudflare-access-check.py works.sanei-clover.com --exec 'node frontend/e2e/smoke.mjs https://works.sanei-clover.com'

人は PIN の画面を通るが、スクリプトは通れない。そこで確認のあいだだけ使うサービストークンを作り、
それを通すポリシーを Access アプリに足してから叩き、終わったら(失敗しても)両方を消す。
--exec を付けると、トークンを環境変数 CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET に入れてコマンドを実行する。
トークンの値は表示しない。
"""
import argparse, importlib.util, os, pathlib, subprocess, sys, time, urllib.error, urllib.request

spec = importlib.util.spec_from_file_location('cf', pathlib.Path(__file__).with_name('cloudflare-api.py'))
cf = importlib.util.module_from_spec(spec); spec.loader.exec_module(cf)

p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
p.add_argument('host')
p.add_argument('--exec', dest='command', default=None, help='トークンを環境変数に入れて実行するコマンド')
args = p.parse_args()

host = args.host
aid = cf.zone('.'.join(host.split('.')[1:]))['account']['id']
apps = [a for a in cf.api(f'/accounts/{aid}/access/apps') if a.get('domain') == host]
if not apps:
    sys.exit(f'{host} の Access アプリが無い(cloudflare-tunnel-setup.py が先)')
app = apps[0]


def fetch(path, headers):
    req = urllib.request.Request(f'https://{host}{path}', headers={**headers, 'User-Agent': 'works-access-check'})
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'replace'), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, '', dict(e.headers)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


token = policy = None
failed = False
try:
    # 未認証は Access のログインへ送られること
    status, _, headers = fetch('/', {})
    location = headers.get('Location', headers.get('location', ''))
    ok = status == 302 and 'cloudflareaccess.com' in location
    print('PASS' if ok else 'FAIL', f'未認証は Access へ送られる(HTTP {status})')
    failed |= not ok

    token = cf.api(f'/accounts/{aid}/access/service_tokens', {'name': f'一時確認 {time.strftime("%Y-%m-%d %H:%M:%S")}', 'duration': '8760h'})
    policy = cf.api(f'/accounts/{aid}/access/apps/{app["id"]}/policies', {
        'name': '一時確認(自動で消える)', 'decision': 'non_identity', 'precedence': 50,
        'include': [{'service_token': {'token_id': token['id']}}]})
    auth = {'CF-Access-Client-Id': token['client_id'], 'CF-Access-Client-Secret': token['client_secret']}

    def check(path, label, good):
        # 作りたてのポリシーは Cloudflare の全拠点へ行き渡るまで数秒〜十数秒かかり、その間は同じ要求でも 302 と 200 が混ざる。
        # 3 回続けて通るまで待ってから判定する
        global failed
        streak, status, body = 0, 0, ''
        for _ in range(30):
            status, body, _ = fetch(path, auth)
            streak = streak + 1 if status == 200 and good(body) else 0
            if streak >= 3:
                break
            time.sleep(1.5)
        ok = streak >= 3
        print('PASS' if ok else 'FAIL', f'{label}(HTTP {status}, {len(body)} バイト)')
        failed |= not ok

    check('/healthz', 'Access の内側の /healthz に届く', lambda b: b.strip() == 'ok')
    check('/', '画面の HTML が返る', lambda b: '<div id="root">' in b)
    check('/o/tasks', 'SPA のパスでも HTML が返る', lambda b: '<div id="root">' in b)

    if args.command and not failed:
        env = {**os.environ, 'CF_ACCESS_CLIENT_ID': token['client_id'], 'CF_ACCESS_CLIENT_SECRET': token['client_secret']}
        code = subprocess.run(args.command, shell=True, env=env).returncode
        print('PASS' if code == 0 else 'FAIL', f'--exec のコマンド(終了コード {code})')
        failed |= code != 0
finally:
    if policy:
        cf.api(f'/accounts/{aid}/access/apps/{app["id"]}/policies/{policy["id"]}', method='DELETE')
    if token:
        cf.api(f'/accounts/{aid}/access/service_tokens/{token["id"]}', method='DELETE')
    print('後片付け: 一時のポリシーとサービストークンを削除')

sys.exit(1 if failed else 0)
