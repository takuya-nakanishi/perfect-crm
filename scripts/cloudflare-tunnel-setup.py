#!/usr/bin/env python3
"""compose 内のサービスを Cloudflare Tunnel + Access で公開する準備を API で行う(再実行しても重複しない)。

  python3 scripts/cloudflare-tunnel-setup.py twenty.sanei-clover.com <許可メール,メール か - > http://server:3000 [Access アプリ名] [素通しパス 例 /mcp]

やること: Tunnel 作成 → 経路(hostname → 宛先)→ CNAME(プロキシ ON)→ Access の One-time PIN →
Access アプリ(セッション 24h・App Launcher に表示)→ 許可ポリシー(メール1件)→ 直下の .env に CLOUDFLARE_TUNNEL_TOKEN を追記。
そのあと `docker compose --profile public up -d` で cloudflared が起動する。
"""
import sys, importlib.util, pathlib

spec = importlib.util.spec_from_file_location('cf', pathlib.Path(__file__).with_name('cloudflare-api.py'))
cf = importlib.util.module_from_spec(spec); spec.loader.exec_module(cf)

if len(sys.argv) < 4:
    sys.exit(__doc__)
host, email, origin = sys.argv[1], sys.argv[2], sys.argv[3]
app_name = sys.argv[4] if len(sys.argv) > 4 else host.split('.')[0]
zone_name = '.'.join(host.split('.')[1:])
z = cf.zone(zone_name); zid, aid = z['id'], z['account']['id']
name = 'sanei-clover-lan'   # この LAN から外へ出す経路をこの 1 本に集約する(サービスごとに Tunnel を増やさない)

# 1. Tunnel(名前で検索し、無ければ作る)
tunnels = [t for t in cf.api(f'/accounts/{aid}/cfd_tunnel', params={'name': name, 'is_deleted': 'false'})]
tun = tunnels[0] if tunnels else cf.api(f'/accounts/{aid}/cfd_tunnel', {'name': name, 'config_src': 'cloudflare'})
print('Tunnel:', tun['id'], '(既存)' if tunnels else '(作成)')

# 2. 経路: ホスト名 → compose 内の宛先。**既存の経路は消さない**(1 本の Tunnel を複数サービスで共有するため)。
#    同じホスト名の行だけ差し替え、最後は必ず catch-all の 404 にする
cur = cf.api(f'/accounts/{aid}/cfd_tunnel/{tun["id"]}/configurations')
ingress = [r for r in ((cur.get('config') or {}).get('ingress') or []) if r.get('hostname') and r['hostname'] != host]
ingress.append({'hostname': host, 'service': origin})
ingress.sort(key=lambda r: r['hostname'])
ingress.append({'service': 'http_status:404'})
cf.api(f'/accounts/{aid}/cfd_tunnel/{tun["id"]}/configurations', {'config': {'ingress': ingress}}, method='PUT')
print('経路:', ', '.join(f'{r["hostname"]} -> {r["service"]}' for r in ingress if r.get('hostname')))

# 3. CNAME(プロキシ ON。Tunnel 宛てはプロキシ必須)
target = f'{tun["id"]}.cfargotunnel.com'
recs = [r for r in cf.dns_records(zid) if r['name'] == host]
if recs:
    r = recs[0]
    if r['type'] != 'CNAME' or r['content'] != target or not r['proxied']:
        cf.api(f'/zones/{zid}/dns_records/{r["id"]}', {'type': 'CNAME', 'name': host, 'content': target, 'ttl': 1, 'proxied': True}, method='PUT')
        print('CNAME 更新')
    else:
        print('CNAME 既存')
else:
    cf.api(f'/zones/{zid}/dns_records', {'type': 'CNAME', 'name': host, 'content': target, 'ttl': 1, 'proxied': True}); print('CNAME 作成')

# 4〜5b は Access を前段に置くときだけ。許可メールに '-' を渡すと Access を作らず、アプリ自身の認証だけで守る(現行の Twenty はこちら)
use_access = email not in ('-', 'none')
if not use_access:
    print('Access: 作らない(素通し)')
if use_access:
    # 4. Access: One-time PIN の IdP
    idps = cf.api(f'/accounts/{aid}/access/identity_providers')
    if not any(i['type'] == 'onetimepin' for i in idps):
        cf.api(f'/accounts/{aid}/access/identity_providers', {'name': 'One-time PIN', 'type': 'onetimepin', 'config': {}}); print('IdP: One-time PIN 作成')

    # 5. Access アプリ + 許可ポリシー(メールはカンマ区切りで複数可)。他は既定で拒否
    emails = [e.strip() for e in email.split(',') if e.strip()]
    apps = [a for a in cf.api(f'/accounts/{aid}/access/apps') if a.get('domain') == host]
    app = apps[0] if apps else cf.api(f'/accounts/{aid}/access/apps', {
        'name': app_name, 'domain': host, 'type': 'self_hosted', 'session_duration': '24h',
        'app_launcher_visible': True, 'allowed_idps': [], 'auto_redirect_to_identity': False})
    print('Access アプリ:', app['id'], '(既存)' if apps else '(作成)')
    pols = cf.api(f'/accounts/{aid}/access/apps/{app["id"]}/policies')
    if not any(p['decision'] == 'allow' for p in pols):
        cf.api(f'/accounts/{aid}/access/apps/{app["id"]}/policies',
               {'name': '本人のみ', 'decision': 'allow', 'precedence': 1, 'include': [{'email': {'email': e}} for e in emails]})
        print('ポリシー: allow', emails)
    else:
        print('ポリシー既存:', [(p['name'], p['decision']) for p in pols])

    # 5b. Access を素通しにするパス(第 5 引数、カンマ区切り。例 /mcp)。エージェントは PIN の画面を通れないので、
    #     アプリ自身の認証(API キー等)で守られているパスだけを指定する
    for path in [p.strip() for p in (sys.argv[5] if len(sys.argv) > 5 else '').split(',') if p.strip()]:
        dom = host + path
        ex = [a for a in cf.api(f'/accounts/{aid}/access/apps') if a.get('domain') == dom]
        bp = ex[0] if ex else cf.api(f'/accounts/{aid}/access/apps', {
            'name': f'{app_name} {path} (bypass)', 'domain': dom, 'type': 'self_hosted', 'session_duration': '24h', 'app_launcher_visible': False})
        if not any(p['decision'] == 'bypass' for p in cf.api(f'/accounts/{aid}/access/apps/{bp["id"]}/policies')):
            cf.api(f'/accounts/{aid}/access/apps/{bp["id"]}/policies',
                   {'name': 'アプリ自身の認証で守る', 'decision': 'bypass', 'precedence': 1, 'include': [{'everyone': {}}]})
        print('Bypass:', dom, '(既存)' if ex else '(作成)')

# 6. cloudflared 用トークンを .env へ(既存なら触らない)
tok = cf.api(f'/accounts/{aid}/cfd_tunnel/{tun["id"]}/token')
print('.env に CLOUDFLARE_TUNNEL_TOKEN を追記' if cf.add_env('CLOUDFLARE_TUNNEL_TOKEN', tok) else 'CLOUDFLARE_TUNNEL_TOKEN は既存')
print(f'次: .env の TWENTY_SERVER_URL が https://{host} であることを確かめて docker compose --profile public up -d')
