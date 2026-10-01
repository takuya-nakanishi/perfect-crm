# 06 配置

どこで、どう動かし、どう外へ出しているか。日々の操作と落とし穴は `docs/runbook/01-operations.md`。

## 1. Compose

| サービス | イメージ | 役割 | 起動 |
|---|---|---|---|
| `web` | `frontend/Dockerfile`(`node:24-alpine` でビルド → `caddy:2.11.4-alpine`) | 画面の静的ファイルを配る。無状態。ホストには `127.0.0.1:8610` だけを開ける | 常に |
| `tunnel` | `cloudflare/cloudflared:2026.9.1` | Cloudflare へ外向きに張る。トークンは `.env` の `CLOUDFLARE_TUNNEL_TOKEN` | `--profile public` |
| `db` | `postgres:18.6-alpine` | 状態のすべて。**ホストにポートを開けない**(触れるのは `api` だけ) | `--profile backend`(バックエンドを足すまで使わない) |
| `api` | (J-021 で足す) | Python の JSON API | |

- プロジェクト名は `works`。設定は直下の `.env`(Git に入れない。項目は `.env.example`)
- イメージのタグは固定し、`latest` を使わない
- `web` は、読み取り専用のルート、権限は `NET_BIND_SERVICE` だけ、`no-new-privileges`。権限を全部落とすと、公式イメージの caddy(権限付きのバイナリ)が `operation not permitted` で起動しない
- PostgreSQL 18 の公式イメージは、データを `/var/lib/postgresql/18/docker` に置く。ボリュームは `/var/lib/postgresql` に付ける(17 までの `/var/lib/postgresql/data` を指すと、空のまま起動して気づきにくい)

**Docker は WSL2 の Ubuntu に入れた Docker Engine を使う。**Windows 側の Docker Desktop は使わない(01 D-05)。

## 2. 外からの経路

```
ブラウザ ─https→ works.sanei-clover.com(Cloudflare。CNAME → <Tunnel ID>.cfargotunnel.com、プロキシ ON)
        → Cloudflare Access(門。許可した人だけを通す)→ Tunnel「sanei-clover-lan」→ cloudflared → http://web:8080
スマホのアプリ ─ Cloudflare WARP(端末ごと門を通る。09)─▶ 同じ
```

**Access は門として残し、ログインとセッションはアプリが持つ**(2026-10-01 に見直し。01 D-14)。Access は「許可した人以外を Surface に届かせない」、アプリのログインは「入ってきた人が誰か」を決める。役割が違うので両方を持つ。

- Surface から Cloudflare へ外向きに張るだけで、受信ポートを開けない。固定 IP もポート開放も要らない
- **Tunnel はこの LAN で 1 本(`sanei-clover-lan`)に集約する。**サービスを増やすときは同じ Tunnel にホスト名を足す。`scripts/cloudflare-tunnel-setup.py` は既存の経路を残したまま、指定したホストの行だけを差し替える。別の Compose のサービスを載せるなら、cloudflared から届くネットワークに置くこと
- 組み立てはすべて API(`scripts/cloudflare-tunnel-setup.py`。再実行しても重複しない): Tunnel → 経路 → CNAME → One-time PIN の IdP → Access アプリ → 許可ポリシー → `.env` のトークン更新
- API トークンは直下の `.env` の `CLOUDFLARE_API_TOKEN`。権限は必要最小より広い(ゾーン `sanei-clover.com` とアカウントの全権限。2026-09-19 に本人が受け入れたリスク)。前提は、`.env` の外に出さない・漏えいを疑ったら即失効

## 3. Cloudflare Access(門)と、アプリのログインへの切り替え

- アプリ名 `Works`、種別 self-hosted、許可は本人のメールアドレス、ほかは拒否。IdP は One-time PIN と Google Workspace(Q-039)
- **セッションは 720 時間(30 日)。**既定の 24 時間だと毎日ログインし直すことになり、日常の道具として使えない(Twenty のとき、それが理由で Access を外している)
- **門は残し、ログインとセッションはアプリが持つ**(2026-10-01 に見直し。01 D-14)。Surface(社内 LAN の PC)で動かす限り、アプリや部品に未知の穴が見つかっても、許可した人以外は攻撃を始められないようにしておく。代わりに、ブラウザでは月に 1 回、Access(Google なら 1 クリック)と Works(パスワード + 6 桁)の 2 回ログインする
- **スマホのアプリは Cloudflare WARP で門を通る**(本人の意向。01 D-15、09 §5)。WARP にログインした端末は、Access のログインの画面を経ずに通る。アプリは Access のことを知らない
- One-time PIN は、許可されていないアドレスにはコードを送らない(届かないのは故障ではない)。コードは要求した同じタブに入れる
- **Access の内側にあるものは、外部のサービスやエージェントからは届かない。**外へ見せる口と例外は §7
- 自動の確認は `scripts/cloudflare-access-check.py`。確認のあいだだけ使うサービストークンと、それを通すポリシーを作り、終わったら(失敗しても)消す

**アプリのログインへの切り替え**(J-055)。順を崩さない(締め出される時間を作らないため)。

1. 新しい版を本番へ出す(2026-10-01 に済み。`WORKS_AUTH=access` のまま出したので、ログインは変わっていない。表は 0009 まで)
2. 本人のパスワードを決める: `docker compose exec api python -m app.cli set-password <メール>`(15 文字以上を 2 回)。先に決めておけば、切り替えた瞬間に締め出されない
3. `.env` を `WORKS_AUTH=local` にして `docker compose --profile backend --profile public up -d api`。`WORKS_SECRET_KEY` が空だと api は起動しない(2 段階認証の秘密を読めなくなるため)
4. Works を開く → Access(いつもどおり)→ Works のログイン(パスワード → 初回は QR で 2 段階認証を設定)。Claude のコネクタ(許可の画面が Works のログインになる)も確かめる
5. 後片付け: `app/access.py` と `WORKS_AUTH` の分岐を消す(compose の既定も)。`.env` から `WORKS_AUTH`・`WORKS_ACCESS_*` を消す。runbook §5 と CLAUDE.md を直す

- 戻すとき: `.env` を `WORKS_AUTH=access` に戻して api を建て直せば、Access の JWT で入る形に戻る(門はそのまま)
- Google でログイン(J-054)を使うなら、Workspace の管理コンソールで 2 段階認証を必須にしておく(Google で入るときは Works の 6 桁を求めないため)

## 4. 配る側のヘッダ(`frontend/Caddyfile`)

- CSP は `default-src 'self'`。外部の資源を一切読まない(書体も同梱)。`style-src` の `'unsafe-inline'` は React の `style` 属性のため。インラインのスクリプトは禁止なので、明暗を描画前に決める処理は `public/theme.js` に出してある
- `/assets/*`(ファイル名にハッシュ)は 1 年 + `immutable`。無いファイルは 404 を返し、`index.html` で誤魔化さない(古い HTML が新しい資源を探したときに、HTML を JS として読ませないため)
- それ以外は `index.html` を返し(SPA)、`Cache-Control: no-cache, no-transform`
- **`no-transform` は Cloudflare に HTML を書き換えさせないため。**ゾーンの Web Analytics が自動挿入(auto_install)になっていて、これが無いとビーコンのスクリプトが差し込まれ、CSP に止められてコンソールにエラーが出続ける。ホスト単位で除外するルールは無料プランでは作れなかった(`maxRulesError`)ので、配る側で断っている。ゾーン全体の設定は触っていない

## 5. 稼働の前提(Surface で動かすあいだ)

- Surface のスリープ、Windows Update、WSL2 の再起動で止まる。Tunnel は経路を解決するが、稼働率は解決しない。利用者が本人 1 名のあいだは受け入れる
- コンテナは `restart: unless-stopped` なので、Docker が起きれば戻る。ただし **WSL2 は誰かが起動するまで起きない**。Windows の起動時に WSL と Docker を立ち上げる設定は未実施 → J-032(Windows 側の設定に触れるので、やるかどうかは本人が決める)
- 実データを置く前に、バックアップと復元を回す(J-025。退避先は Q-040)。WSL2 の仮想ディスクごと消える事故を前提にする

## 6. 引っ越し(AWS など)

Compose が動く場所ならどこでも同じ構成で動く。状態は PostgreSQL のボリュームと `.env` だけ。

1. 移設先で `docker compose --profile public --profile backend up -d --build`
2. `pg_dump` → `pg_restore`
3. `.env` を移す(Tunnel のトークンを含む)
4. 旧ホストの `tunnel` を止める。同じトークンで新ホストの cloudflared が繋がるので、DNS を触らない

Tunnel をやめて ALB などで直接受けるなら、TLS を自前で持つ。**ログインはアプリが持つので(01 D-14)、作り直しは要らない**(Access を信頼していた 2026-09-24〜の形では、ここで作り直しになるのを引き受けていた)。Access の門は無くなるので、移った先で門(VPN、IP の制限、WAF など)を考える。

## 7. Access の内側のまま、外から使う(2026-09-22。Q-044 で決定)

**経路は 1 本のまま**(本人の決定: 別のホストや素通しの経路は作らない)。外から叩くものは、**Access のサービストークンをヘッダ(`CF-Access-Client-Id` / `CF-Access-Client-Secret`)で渡して門を通る**。環境設定で作った 2 つの扱い:

| 経路 | 誰が叩くか | 認証 |
|---|---|---|
| `POST /api/v1/forms/{key}`(Web フォームの受け口。04 §10) | 外部の Web サイトの訪問者(ブラウザ) | 無し(鍵は URL) |
| `/mcp`(J-028) | Claude Desktop / Claude Code / Codex | アプリのトークン(`Authorization: Bearer`) |

- **MCP**: Claude Desktop(`headers`)・Claude Code(`--header`)・Codex(`http_headers`)はどれも任意のヘッダを送れるので、サービストークン + アプリのトークンの 2 つを付ける。環境設定の「繋ぎ方」はその形で出す(05 §11)。サービストークンは Zero Trust で発行し、Access のポリシーに「Service Auth」として足す(`scripts/cloudflare-access-check.py` が一時的にやっていることを、恒久のトークンで行う)
- **Web フォーム**: 訪問者のブラウザは Access のヘッダを付けられない(付けさせると秘密が漏れる)。だから**送るのは Web サイトのサーバ**(問い合わせフォームの送信先。WordPress のプラグイン、サーバレス関数など)で、サービストークンを付けて受け口へ転送する。環境設定の「サーバから送る」がその形。静的なサイトからブラウザで直接送りたい場合だけ、受け口のパスを Access の外に出す(別の判断。いまは持たない)
- 管理 API(`/settings/*`)と画面は、これまでどおり Access の内側で人だけが通る
- **Slack の戻り(`/api/v1/slack/callback`)も Access の内側のまま**(04 §14)。戻ってくるのは、Works にログインして「チャンネルを追加」を押した本人のブラウザなので、素通しは要らない。api からは `slack.com`・`hooks.slack.com` へ出ていく(外向きの HTTPS。Tunnel とは別で、何も開けなくてよい)

### Claude のカスタムコネクタのための例外(2026-09-24 決定。本人の承認。03 §6)

Claude のカスタムコネクタは、端末ではなく **Anthropic のクラウドから** Works を叩く。サービストークンのヘッダは付けられない(送れるヘッダ名は Anthropic の承認制)。
だから上の「素通しの経路は作らない」(Q-044)を、次の範囲でだけ破る(本人が承認し、同日に適用)。適用後、Anthropic 以外の送信元からは機械向けの口が 403、人の入口は Access のログインへ 302 になることを確かめた。

| パス | 素通しにする送信元 | 守るもの |
|---|---|---|
| `/mcp`、`/token`、`/register`、`/revoke`、`/.well-known/oauth-authorization-server`、`/.well-known/oauth-protected-resource` | **Anthropic の送信元だけ**(`160.79.104.0/21`。https://platform.claude.com/docs/en/api/ip-addresses) | Works の OAuth(トークンが無ければ 401) |
| `/authorize`、`/oauth/consent`、画面、`/api/*` | 素通しにしない(これまでどおり Access の内側) | Access(人) |

- **鍵を渡すのは、Access を通った本人だけ。**素通しの口で Claude がアプリを登録しても、`/authorize` と許可の画面は Access の内側なので、アカウントのメンバーが「許可する」を押さない限りトークンは出ない
- ほかの送信元から素通しのパスへ来たものは、そのパスの Access アプリで止まる(PIN の画面にも行かない)。Codex などがトークンで `/mcp` を使うときは、その Access アプリに「Service Auth」のポリシーを足す
- Anthropic の送信元は「告知なしには変えない」とされている。変わったら `scripts/cloudflare-tunnel-setup.py` の `ANTHROPIC_EGRESS` を直して再実行する
- 素通しにしたリクエストは Access のログに残らない。記録は api 側(`oauth_grants.last_used_at`、api のログ)
- 設定は `python3 scripts/cloudflare-tunnel-setup.py works.sanei-clover.com --origin http://web:8080 --allow <メール> --anthropic /mcp,/token,/register,/revoke,/.well-known/oauth-authorization-server,/.well-known/oauth-protected-resource`(再実行しても重複しない)

### スマホのアプリ(2026-10-01。01 D-15)

アプリはサービストークンを持たず、**端末に入れた Cloudflare WARP で門を通る**(本人の意向。仕組みと設定は 09 §5)。
アプリの通信も、ログインの画面を開く Auth Tab(Chrome)も、WARP を通って Access に届き、WARP にログインした人として通る。
WARP を切っている・入れていない端末からは、ブラウザと同じく Access のログインの画面になる(アプリは通れない)。

