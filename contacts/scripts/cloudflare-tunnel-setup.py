#!/usr/bin/env python3
"""works.<ゾーン> を Cloudflare Tunnel + Access で公開する準備を API で行う(再実行しても重複しない)。

  python3 scripts/cloudflare-tunnel-setup.py works.sanei-clover.com ntaku0815@gmail.com

やること: Tunnel 作成 → 経路(hostname → http://ui:8080)→ CNAME(プロキシ ON)→ Access の One-time PIN →
Access アプリ(セッション 24h・App Launcher に表示)→ 許可ポリシー(メール1件)→ .env に CLOUDFLARE_TUNNEL_TOKEN を追記。
そのあと `docker compose --profile public up -d` で cloudflared が起動する。
"""
import sys, importlib.util, pathlib

spec = importlib.util.spec_from_file_location('cf', pathlib.Path(__file__).with_name('cloudflare-api.py'))
cf = importlib.util.module_from_spec(spec); spec.loader.exec_module(cf)

host, email = sys.argv[1], sys.argv[2]
zone_name = '.'.join(host.split('.')[1:])
z = cf.zone(zone_name); zid, aid = z['id'], z['account']['id']
name = 'perfect-crm-contacts'

# 1. Tunnel(名前で検索し、無ければ作る)
tunnels = [t for t in cf.api(f'/accounts/{aid}/cfd_tunnel', params={'name': name, 'is_deleted': 'false'})]
tun = tunnels[0] if tunnels else cf.api(f'/accounts/{aid}/cfd_tunnel', {'name': name, 'config_src': 'cloudflare'})
print('Tunnel:', tun['id'], '(既存)' if tunnels else '(作成)')

# 2. 経路: ホスト名 → compose 内の NocoDB。それ以外は 404
cf.api(f'/accounts/{aid}/cfd_tunnel/{tun["id"]}/configurations',
       {'config': {'ingress': [{'hostname': host, 'service': 'http://ui:8080'}, {'service': 'http_status:404'}]}}, method='PUT')
print('経路:', host, '-> http://ui:8080')

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

# 4. Access: One-time PIN の IdP
idps = cf.api(f'/accounts/{aid}/access/identity_providers')
if not any(i['type'] == 'onetimepin' for i in idps):
    cf.api(f'/accounts/{aid}/access/identity_providers', {'name': 'One-time PIN', 'type': 'onetimepin', 'config': {}}); print('IdP: One-time PIN 作成')

# 5. Access アプリ + 許可ポリシー(メール1件)。他は既定で拒否
apps = [a for a in cf.api(f'/accounts/{aid}/access/apps') if a.get('domain') == host]
app = apps[0] if apps else cf.api(f'/accounts/{aid}/access/apps', {
    'name': '連絡先台帳(NocoDB)', 'domain': host, 'type': 'self_hosted', 'session_duration': '24h',
    'app_launcher_visible': True, 'allowed_idps': [], 'auto_redirect_to_identity': False})
print('Access アプリ:', app['id'], '(既存)' if apps else '(作成)')
pols = cf.api(f'/accounts/{aid}/access/apps/{app["id"]}/policies')
if not any(p['decision'] == 'allow' for p in pols):
    cf.api(f'/accounts/{aid}/access/apps/{app["id"]}/policies',
           {'name': '本人のみ', 'decision': 'allow', 'precedence': 1, 'include': [{'email': {'email': email}}]})
    print('ポリシー: allow', email)
else:
    print('ポリシー既存:', [(p['name'], p['decision']) for p in pols])

# 6. cloudflared 用トークンを .env へ(既存なら触らない)
tok = cf.api(f'/accounts/{aid}/cfd_tunnel/{tun["id"]}/token')
print('.env に CLOUDFLARE_TUNNEL_TOKEN を追記' if cf.add_env('CLOUDFLARE_TUNNEL_TOKEN', tok) else 'CLOUDFLARE_TUNNEL_TOKEN は既存')
print(f'次: NC_PUBLIC_URL を https://{host} にして docker compose --profile public up -d --force-recreate ui')
