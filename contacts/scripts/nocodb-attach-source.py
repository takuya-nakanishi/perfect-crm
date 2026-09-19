#!/usr/bin/env python3
"""既存ベースに台帳DB(contacts)を画面用ロール contacts_ui で外部ソースとして追加し、テーブル取込を待つ。送信先は 127.0.0.1 のみ。"""
import json, time, urllib.request, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]   # リポジトリ直下(.env はそこに 1 つ)
env = dict(l.split('=',1) for l in (ROOT/'.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
S = json.load(open('/tmp/nc-session.json')); NC='http://127.0.0.1:8090'; T=S['token']; B=S['base_id']
def api(path, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(NC+path, data=data, method=method or ('POST' if data else 'GET'))
    req.add_header('Content-Type','application/json'); req.add_header('xc-auth',T)
    try:
        with urllib.request.urlopen(req, timeout=180) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, e.read()[:500].decode(errors='replace')
# 空のソースを掃除
st, srcs = api(f'/api/v2/meta/bases/{B}/sources')
for s in srcs.get('list', []):
    if not s.get('is_meta'): print('旧ソース削除', s['id'], api(f"/api/v2/meta/bases/{B}/sources/{s['id']}", method='DELETE')[0])
body = {'alias': 'contacts', 'type': 'pg',
        'config': {'client': 'pg', 'connection': {'host': 'db', 'port': 5432, 'user': 'contacts_ui',
                   'password': env['CONTACTS_UI_DB_PASSWORD'], 'database': 'contacts'}, 'searchPath': ['public']},
        'inflection_column': 'none', 'inflection_table': 'none'}
st, res = api(f'/api/v2/meta/bases/{B}/sources', body); print('ソース追加:', st, (res if st != 200 else res.get('id')))
for i in range(20):
    st, r = api(f'/api/v2/meta/bases/{B}/tables'); tables = r.get('list', [])
    if tables: break
    time.sleep(3)
print('=== 認識されたテーブル ===')
for t in tables: print(' ', t['id'], t['title'], '(DBビュー)' if t.get('type') == 'view' else '')
S['tables'] = {t['title']: t['id'] for t in tables}; json.dump(S, open('/tmp/nc-session.json', 'w'))

# 標準ビューの作成(再実行しても重複しないよう既存名を確認)
def ensure_kanban(table, title, group_col):
    st, meta = api(f"/api/v2/meta/tables/{TB[table]}"); cols = {c['title']: c for c in meta['columns']}
    st, views = api(f"/api/v2/meta/tables/{TB[table]}/views")
    if any(v['title'] == title for v in views.get('list', [])): print('既存:', title); return
    st, r = api(f"/api/v2/meta/tables/{TB[table]}/kanbans", {'title': title, 'fk_grp_col_id': cols[group_col]['id']})
    print('カンバン作成:', title, st if st == 200 else r)
TB = S['tables']
ensure_kanban('organizations', '組織 状態別', 'status')
ensure_kanban('organizations', '組織 種別', 'kind')
ensure_kanban('people', '人物 状態別', 'status')
