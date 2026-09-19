#!/usr/bin/env python3
"""NocoDB(127.0.0.1:8090 固定)に管理者を作り、台帳DB(contacts)を外部データソースとして接続する。
資格情報は同ディレクトリの .env から読む。送信先は localhost のみ。"""
import json, os, secrets, sys, urllib.request, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = ROOT / '.env'
NC = 'http://127.0.0.1:8090'

def load_env():
    d = {}
    for line in ENV.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); d[k] = v
    return d

def api(path, body=None, token=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(NC + path, data=data, method=method or ('POST' if data else 'GET'))
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('xc-auth', token)
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read() or b'{}')

env = load_env()
email = env.get('CONTACTS_UI_ADMIN_EMAIL') or 'takuya@contacts.local'
pw = env.get('CONTACTS_UI_ADMIN_PASSWORD')
if not pw:
    pw = secrets.token_urlsafe(18)
    with ENV.open('a') as f: f.write(f'CONTACTS_UI_ADMIN_EMAIL={email}\nCONTACTS_UI_ADMIN_PASSWORD={pw}\n')

try:
    token = api('/api/v1/auth/user/signup', {'email': email, 'password': pw})['token']; print('管理者作成OK')
except Exception:
    token = api('/api/v1/auth/user/signin', {'email': email, 'password': pw})['token']; print('管理者ログインOK(既存)')

base_id = env.get('CONTACTS_UI_BASE_ID')
if not base_id:
    base = api('/api/v2/meta/bases', {
        'title': '連絡先台帳',
        'sources': [{'alias': 'contacts', 'type': 'pg',
                     'config': {'client': 'pg', 'connection': {'host': 'db', 'port': 5432, 'user': 'contacts',
                                'password': env['CONTACTS_DB_PASSWORD'], 'database': 'contacts'}, 'searchPath': ['public']},
                     'inflection_column': 'none', 'inflection_table': 'none'}]}, token)
    base_id = base['id']
    with ENV.open('a') as f: f.write(f'CONTACTS_UI_BASE_ID={base_id}\n')
    print('外部DB接続OK base=' + base_id)

tables = api(f'/api/v2/meta/bases/{base_id}/tables', token=token).get('list', [])
print('=== 認識されたテーブル ===')
for t in tables: print(t['id'], t['title'], '(view)' if t.get('type') == 'view' else '')
json.dump({'token': token, 'base_id': base_id, 'tables': {t['title']: t['id'] for t in tables}}, open('/tmp/nc-session.json', 'w'))
