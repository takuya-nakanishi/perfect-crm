#!/usr/bin/env python3
"""Cloudflare API の共通部品。リポジトリ直下の .env の CLOUDFLARE_API_TOKEN を読む。送信先は api.cloudflare.com のみ。
他スクリプトから import して使う(単体実行はトークン検証)。"""
import json, pathlib, sys, urllib.request, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]   # リポジトリ直下(.env はそこに 1 つ)
ENV = dict(l.split('=', 1) for l in (ROOT / '.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
API = 'https://api.cloudflare.com/client/v4'
TOKEN = ENV.get('CLOUDFLARE_API_TOKEN', '').strip()
if not TOKEN:
    sys.exit('CLOUDFLARE_API_TOKEN が .env に無い')


def api(path, body=None, method=None, params=None):
    url = API + path + (('?' + urllib.parse.urlencode(params)) if params else '')
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method or ('POST' if data else 'GET'))
    req.add_header('Authorization', 'Bearer ' + TOKEN)
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as e:
        res = json.loads(e.read() or b'{}')
    if not res.get('success'):
        raise RuntimeError(f'{method or "GET"} {path}: {res.get("errors")}')
    return res['result']


def zone(name):
    z = api('/zones', params={'name': name})
    if not z:
        sys.exit(f'ゾーン {name} が Cloudflare に無い(Add a site が先)')
    return z[0]


def dns_records(zone_id):
    return api(f'/zones/{zone_id}/dns_records', params={'per_page': 500})


def set_env(key, value):
    """.env の key を value にする。戻り値は 'added' / 'updated' / 'unchanged'。値そのものは表示しない。

    Tunnel を作り直すとトークンも変わるので、古い値が残っていたら置き換える(残すと cloudflared が繋がらない)。
    """
    if ENV.get(key, '').strip() == value:
        return 'unchanged'
    path = ROOT / '.env'
    lines = path.read_text().splitlines()
    hit = [i for i, l in enumerate(lines) if l.startswith(key + '=')]
    if hit:
        lines[hit[0]] = f'{key}={value}'
    else:
        lines.append(f'{key}={value}')
    path.write_text('\n'.join(lines) + '\n')
    ENV[key] = value
    return 'updated' if hit else 'added'


if __name__ == '__main__':
    # アカウント所有トークン(cfat…)は /user/tokens/verify を通れないので、ゾーンからアカウント ID を引いて検証する
    zones = api('/zones')
    aid = zones[0]['account']['id'] if zones else None
    v = api(f'/accounts/{aid}/tokens/verify') if aid else api('/user/tokens/verify')
    print('トークン:', v['status'], v.get('id', '')[:8] + '…', '| ゾーン:', [z['name'] for z in zones])
