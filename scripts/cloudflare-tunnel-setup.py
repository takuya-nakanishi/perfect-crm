#!/usr/bin/env python3
"""compose 内のサービスを Cloudflare Tunnel + Access で公開する準備を API で行う(再実行しても重複しない)。

  python3 scripts/cloudflare-tunnel-setup.py works.sanei-clover.com --origin http://web:8080 --allow <メール>[,<メール>] --app-name Works

やること: Tunnel 作成 → 経路(hostname → 宛先)→ CNAME(プロキシ ON)→ Access の One-time PIN →
Access アプリ(セッション長は --session)→ 許可ポリシー(メール)→ 直下の .env の CLOUDFLARE_TUNNEL_TOKEN と
WORKS_ACCESS_TEAM_DOMAIN / WORKS_ACCESS_AUD(api がログインの JWT を確かめるのに使う)を更新。
そのあと `docker compose --profile public up -d` で cloudflared が起動する。手順の全体は docs/runbook/01-operations.md。

--allow を省くと Access を置かない(素通し。アプリ自身の認証だけで守ることになるので、画面がモックの間は使わない)。
"""
import argparse, importlib.util, pathlib

spec = importlib.util.spec_from_file_location('cf', pathlib.Path(__file__).with_name('cloudflare-api.py'))
cf = importlib.util.module_from_spec(spec); spec.loader.exec_module(cf)

p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
p.add_argument('host', help='公開するホスト名(例 works.sanei-clover.com)')
p.add_argument('--origin', required=True, help='compose のネットワーク内での宛先(例 http://web:8080)')
p.add_argument('--allow', default='', help='Access で通すメールアドレス(カンマ区切り)。省くと Access を作らない')
p.add_argument('--app-name', default=None, help='Access アプリの表示名(既定はホスト名の先頭)')
p.add_argument('--session', default='720h', help='Access のセッション長(既定 720h = 30 日。短いと PIN の往復が日常の負担になる)')
p.add_argument('--bypass', default='', help='Access を素通しにするパス(カンマ区切り。例 /mcp)。アプリ自身の認証で守られているパスだけ')
p.add_argument('--anthropic', default='', help='Anthropic のクラウド(Claude のカスタムコネクタ)からだけ素通しにするパス(カンマ区切り)。'
               'アプリ自身の認証(OAuth)で守られているパスだけ。送信元は ANTHROPIC_EGRESS に限る')
args = p.parse_args()

host, origin = args.host, args.origin
app_name = args.app_name or host.split('.')[0]
zone_name = '.'.join(host.split('.')[1:])
z = cf.zone(zone_name); zid, aid = z['id'], z['account']['id']
# Anthropic の送信元(Outbound)。変わるときは告知がある: https://platform.claude.com/docs/en/api/ip-addresses(2026-09-24 確認)
ANTHROPIC_EGRESS = ['160.79.104.0/21']
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

# 4〜5b は Access を前段に置くときだけ
emails = [e.strip() for e in args.allow.split(',') if e.strip()]
if not emails:
    print('Access: 作らない(素通し)')
else:
    # 4. Access: One-time PIN の IdP
    idps = cf.api(f'/accounts/{aid}/access/identity_providers')
    if not any(i['type'] == 'onetimepin' for i in idps):
        cf.api(f'/accounts/{aid}/access/identity_providers', {'name': 'One-time PIN', 'type': 'onetimepin', 'config': {}}); print('IdP: One-time PIN 作成')

    # 5. Access アプリ + 許可ポリシー。他は既定で拒否
    apps = [a for a in cf.api(f'/accounts/{aid}/access/apps') if a.get('domain') == host]
    if apps:
        app = apps[0]
        if app.get('session_duration') != args.session:
            body = {k: app[k] for k in ('name', 'domain', 'type', 'app_launcher_visible', 'allowed_idps', 'auto_redirect_to_identity') if k in app}
            app = cf.api(f'/accounts/{aid}/access/apps/{app["id"]}', {**body, 'session_duration': args.session}, method='PUT')
            print('Access アプリ: セッション長を', args.session, 'に更新')
    else:
        app = cf.api(f'/accounts/{aid}/access/apps', {
            'name': app_name, 'domain': host, 'type': 'self_hosted', 'session_duration': args.session,
            'app_launcher_visible': True, 'allowed_idps': [], 'auto_redirect_to_identity': False})
    print('Access アプリ:', app['id'], '(既存)' if apps else '(作成)', '| セッション', app.get('session_duration'))
    pols = cf.api(f'/accounts/{aid}/access/apps/{app["id"]}/policies')
    if not any(p['decision'] == 'allow' for p in pols):
        cf.api(f'/accounts/{aid}/access/apps/{app["id"]}/policies',
               {'name': '本人のみ', 'decision': 'allow', 'precedence': 1, 'include': [{'email': {'email': e}} for e in emails]})
        print('ポリシー: allow', len(emails), '件のメールアドレス')
    else:
        print('ポリシー既存:', [(p['name'], p['decision']) for p in pols])

    # 5a. アプリ(api)が Access の JWT を確かめるための 2 つを .env へ(03 §5 の B 案。backend/app/access.py)。
    #     チームのドメインは発行元(iss)と公開鍵の置き場、AUD タグは宛先(aud)。どちらも値は表示しない
    org = cf.api(f'/accounts/{aid}/access/organizations')
    for key, value in (('WORKS_ACCESS_TEAM_DOMAIN', f'https://{org["auth_domain"]}'), ('WORKS_ACCESS_AUD', app['aud'])):
        print(f'.env の {key}:', {'added': '追記', 'updated': '置き換え', 'unchanged': 'そのまま'}[cf.set_env(key, value)])

    # 5b. Access を素通しにするパス。エージェントは PIN の画面を通れないので、
    #     アプリ自身の認証(API キー等)で守られているパスだけを指定する
    for path in [p.strip() for p in args.bypass.split(',') if p.strip()]:
        dom = host + path
        ex = [a for a in cf.api(f'/accounts/{aid}/access/apps') if a.get('domain') == dom]
        bp = ex[0] if ex else cf.api(f'/accounts/{aid}/access/apps', {
            'name': f'{app_name} {path} (bypass)', 'domain': dom, 'type': 'self_hosted', 'session_duration': '24h', 'app_launcher_visible': False})
        if not any(p['decision'] == 'bypass' for p in cf.api(f'/accounts/{aid}/access/apps/{bp["id"]}/policies')):
            cf.api(f'/accounts/{aid}/access/apps/{bp["id"]}/policies',
                   {'name': 'アプリ自身の認証で守る', 'decision': 'bypass', 'precedence': 1, 'include': [{'everyone': {}}]})
        print('Bypass:', dom, '(既存)' if ex else '(作成)')

    # 5c. Claude のカスタムコネクタ(docs/design/03 §6)。Claude は Anthropic のクラウドから MCP と OAuth の口を叩くので、
    #     その送信元(https://platform.claude.com/docs/en/api/ip-addresses の Outbound)からだけ門を開ける。
    #     ほかの送信元はこのパスで止まる(PIN の画面にも行かない)。人が開く /authorize と画面は含めない
    for path in [p.strip() for p in args.anthropic.split(',') if p.strip()]:
        dom = host + path
        ex = [a for a in cf.api(f'/accounts/{aid}/access/apps') if a.get('domain') == dom]
        ap = ex[0] if ex else cf.api(f'/accounts/{aid}/access/apps', {
            'name': f'{app_name} {path} (Claude)', 'domain': dom, 'type': 'self_hosted', 'session_duration': '24h', 'app_launcher_visible': False})
        include = [{'ip': {'ip': r}} for r in ANTHROPIC_EGRESS]
        pols = cf.api(f'/accounts/{aid}/access/apps/{ap["id"]}/policies')
        same = [q for q in pols if q['decision'] == 'bypass' and q.get('include') == include]
        if not same:
            for q in pols:
                if q['decision'] == 'bypass':
                    cf.api(f'/accounts/{aid}/access/apps/{ap["id"]}/policies/{q["id"]}', method='DELETE')
            cf.api(f'/accounts/{aid}/access/apps/{ap["id"]}/policies',
                   {'name': 'Anthropic から(アプリの OAuth で守る)', 'decision': 'bypass', 'precedence': 1, 'include': include})
        print('Claude から素通し:', dom, '(既存)' if ex else '(作成)', '| 送信元', ', '.join(ANTHROPIC_EGRESS))

# 6. cloudflared 用トークンを .env へ。Tunnel を作り直すと値が変わるので、違っていれば置き換える(値は表示しない)
tok = cf.api(f'/accounts/{aid}/cfd_tunnel/{tun["id"]}/token')
print('.env の CLOUDFLARE_TUNNEL_TOKEN:', {'added': '追記', 'updated': '置き換え', 'unchanged': 'そのまま'}[cf.set_env('CLOUDFLARE_TUNNEL_TOKEN', tok)])
print('次: docker compose --profile public up -d --build')
