#!/usr/bin/env python3
"""棚卸しゾーンファイル(dig 出力)と Cloudflare 側のレコードを突き合わせる。NS 切替前に全件一致を確認するためのもの。

  python3 scripts/cloudflare-dns-check.py docs/dns/sanei-clover.com-2026-09-19.zone            # 差分表示のみ
  python3 scripts/cloudflare-dns-check.py docs/dns/sanei-clover.com-2026-09-19.zone --apply    # 欠けを追加(プロキシ OFF)
  python3 scripts/cloudflare-dns-check.py docs/dns/sanei-clover.com-2026-09-19.zone --verify   # Cloudflare の NS へ dig して一致確認

移設時は何も変えないのが規約(dns-cloudflare skill): 追加はするが、Cloudflare 側にしか無いレコードは消さず警告に留める。
"""
import re, shlex, subprocess, sys, importlib.util, pathlib

spec = importlib.util.spec_from_file_location('cf', pathlib.Path(__file__).with_name('cloudflare-api.py'))
cf = importlib.util.module_from_spec(spec); spec.loader.exec_module(cf)

zone_file = pathlib.Path(sys.argv[1]); mode = sys.argv[2] if len(sys.argv) > 2 else '--diff'
LINE = re.compile(r'^(\S+)\s+(\d+)\s+IN\s+(\S+)\s+(.*)$')


def parse_zone(path):
    """(name, type, content, priority) の集合。TXT は分割文字列を結合、末尾ドットは除去"""
    recs = set()
    for l in path.read_text().splitlines():
        m = LINE.match(l)
        if not m:
            continue
        name, _ttl, typ, rdata = m.groups(); name = name.rstrip('.')
        if typ == 'TXT':
            content = ''.join(shlex.split(rdata)); prio = None
        elif typ == 'MX':
            p, host = rdata.split(); content = host.rstrip('.'); prio = int(p)
        elif typ in ('CNAME', 'NS'):
            content = rdata.rstrip('.'); prio = None
        else:
            content = rdata.strip(); prio = None
        if typ == 'NS':
            continue  # NS は Cloudflare が自分のものを置く
        recs.add((name, typ, content, prio))
    return recs


def norm_cf(r):
    c = r['content']
    if r['type'] == 'TXT':
        c = ''.join(shlex.split(c)) if c.startswith('"') else c
    return (r['name'], r['type'], c.rstrip('.') if r['type'] in ('CNAME', 'MX') else c, r.get('priority'))


zone_name = zone_file.name.split('dns-')[1].split('-20')[0]
want = parse_zone(zone_file)
z = cf.zone(zone_name); zid = z['id']
have_raw = cf.dns_records(zid); have = {norm_cf(r): r for r in have_raw}
print(f'ゾーン {zone_name} ({zid}) 状態={z["status"]} NS={z.get("name_servers")}')
missing = sorted(want - set(have)); extra = sorted(set(have) - want)
print(f'棚卸し {len(want)} 件 / Cloudflare {len(have)} 件 / 欠け {len(missing)} / Cloudflare にしか無い {len(extra)}')
for r in missing: print('  欠け :', r)
for r in extra:
    print('  余分 :', r, '(proxied)' if have[r].get('proxied') else '')
proxied = [k for k, r in have.items() if r.get('proxied')]
if proxied:
    print('  警告 : プロキシ ON のレコードがある(移設時は全て OFF が規約):', proxied)

if mode == '--apply':
    for name, typ, content, prio in missing:
        body = {'type': typ, 'name': name, 'content': content, 'ttl': 1, 'proxied': False}
        if typ == 'MX': body['priority'] = prio
        r = cf.api(f'/zones/{zid}/dns_records', body); print('  追加 :', typ, name, '->', r['id'])
    for k in proxied:
        r = have[k]; cf.api(f'/zones/{zid}/dns_records/{r["id"]}', {**{x: r[x] for x in ('type', 'name', 'content', 'ttl')}, 'proxied': False}, method='PUT')
        print('  プロキシ OFF:', k[:2])

if mode == '--verify':
    ns = z['name_servers'][0]; bad = 0
    for name, typ, content, prio in sorted(want):
        out = subprocess.run(['dig', '@' + ns, '+short', name, typ], capture_output=True, text=True).stdout.split('\n')
        got = set()
        for l in out:
            if not l: continue
            if typ == 'TXT': got.add(''.join(shlex.split(l)))
            elif typ == 'MX': p, h = l.split(); got.add((int(p), h.rstrip('.')))
            else: got.add(l.rstrip('.'))
        target = (prio, content) if typ == 'MX' else content
        ok = target in got
        bad += not ok
        print(('OK  ' if ok else 'NG  '), typ, name, '' if ok else f'-> Cloudflare NS の応答: {got}')
    print('全件一致。NS を切り替えてよい' if bad == 0 else f'不一致 {bad} 件。切り替えない')
