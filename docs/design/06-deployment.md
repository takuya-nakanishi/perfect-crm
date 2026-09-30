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
ブラウザ・アプリ ─https→ works.sanei-clover.com(Cloudflare。CNAME → <Tunnel ID>.cfargotunnel.com、プロキシ ON)
        → Tunnel「sanei-clover-lan」→ cloudflared → http://web:8080
```

**切り替え(J-055)までは、Cloudflare と Tunnel のあいだに Cloudflare Access(本人のメールだけを通す)がいる。**ログインをアプリが持つと決めたので(01 D-14)、外す(§3)。

- Surface から Cloudflare へ外向きに張るだけで、受信ポートを開けない。固定 IP もポート開放も要らない
- **Tunnel はこの LAN で 1 本(`sanei-clover-lan`)に集約する。**サービスを増やすときは同じ Tunnel にホスト名を足す。`scripts/cloudflare-tunnel-setup.py` は既存の経路を残したまま、指定したホストの行だけを差し替える。別の Compose のサービスを載せるなら、cloudflared から届くネットワークに置くこと
- 組み立てはすべて API(`scripts/cloudflare-tunnel-setup.py`。再実行しても重複しない): Tunnel → 経路 → CNAME → One-time PIN の IdP → Access アプリ → 許可ポリシー → `.env` のトークン更新。Access を外したあとは、works には Access の 3 つを作らない(J-055 でスクリプトを直す)
- API トークンは直下の `.env` の `CLOUDFLARE_API_TOKEN`。権限は必要最小より広い(ゾーン `sanei-clover.com` とアカウントの全権限。2026-09-19 に本人が受け入れたリスク)。前提は、`.env` の外に出さない・漏えいを疑ったら即失効

## 3. Cloudflare の守りと、Access を外す手順(2026-10-01。01 D-14)

**Access は外す。**ログインをアプリが持つので(03 §5)、門は要らなくなる。外したあとに Cloudflare で持つのは、TLS、Tunnel(受信ポートを開けない)、縁の率の上限の 3 つ。

- **縁の率の上限**(WAF の rate limiting rules。無料で 1 本。03 §13): パスが `/api/v1/session` と同じ要求を、IP ごとに 10 秒で 10 回を超えたら 10 秒遮る。無料ではメソッドで絞れないので、画面を開くたびの `GET /session` も数に入るが、ふつうに使って 10 秒に 10 回は越えない。ログインの連打を粗くふるうもので、本体はアプリの間引き(03 §5)

**切り替えの手順**(J-055)。順を崩さない(門もログインも無い時間を作らないため)。

1. 自前のログイン(J-053。Google を使うなら J-054 も)を本番へ出す。このときはまだ Access が前にいて、門とアプリのログインの二重になる。表が変わるので、直前に `pg_dump`
2. 本人のパスワードを決め(`python -m app.cli set-password <メール>`)、パスワードで入って 2 段階認証を設定する(認証アプリで QR を読む)。Google を使うなら、GCP のクライアントに戻り先を足して(03 §5)Google で入れることを確かめ、Workspace の管理コンソールで 2 段階認証を必須にしておく
3. Access の内側で、ログイン・ログアウト・アカウントの画面・Claude のコネクタ(許可の画面が Works のログインになる)を確かめる
4. **Access のアプリを消す**(本体と、Anthropic の送信元の例外。§7 の「切り替えまで」)。スクリプトで消し、消したものを記録に残す
5. 縁の率の上限を足す(上)
6. 外から確かめる: 未ログインの `GET /api/v1/session` が 401 `unauthenticated`(Access の 302 ではない)、`/healthz` が 200、ログインの画面が開く、違うパスワードで 401、スマホからパスワード + 6 桁と Google で入れる、Claude から MCP が使える
7. 後片付け: `.env` から `WORKS_AUTH`・`WORKS_ACCESS_*` を消す。`cloudflare-tunnel-setup.py` が works に Access を作らないようにし、`cloudflare-access-check.py` を 6 の確かめに置き換える。環境設定の Web フォーム・MCP の「繋ぎ方」からサービストークンを外す。本番では `/api/v1/docs`・`openapi.json` を出さない(§7)。runbook §3・§5b と CLAUDE.md を直す

- 戻すとき: `cloudflare-tunnel-setup.py … --allow <メール>` をもう一度打てば、Access のアプリと許可を作り直せる(何度打っても同じ結果)。アプリのログインはそのまま残るので、二重の状態に戻る
- Access の頃の決めごと(セッション 30 日、One-time PIN、Google の IdP、`cloudflare-access-check.py` の一時的なサービストークン)は、git の履歴にある

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

Tunnel をやめて ALB などで直接受けるなら、TLS を自前で持つ。**ログインはアプリが持つので(01 D-14)、作り直しは要らない**(Access を信頼していた 2026-09-24〜の形では、ここで作り直しになるのを引き受けていた)。縁の率の上限は、移った先の仕組み(AWS WAF など)で掛け直す。

## 7. 外から届く口と、その守り(2026-10-01 に改める。01 D-14)

Access を外すと(J-055)、次の口がインターネットから直に届く。守りはどれもアプリが持つ。

| 口 | だれが | 守り |
|---|---|---|
| 画面(静的ファイル) | だれでも | 中身は公開しているコードと同じ。データは API にしか無い |
| `/api/v1/*` | ログインした人(Cookie)、Android アプリ(Bearer) | 自前のログイン(03 §5)。Cookie で入った書き込みは `Origin` を確かめる |
| `POST /api/v1/session` | だれでも | 続けて失敗したときの待ち(アプリ)と、縁の率の上限(§3) |
| `/api/v1/session/google`・`…/callback` | だれでも(ブラウザ) | state を Cookie に結ぶ(03 §5) |
| `/api/v1/forms/{key}` | Web サイトの訪問者 | URL の鍵、見えない欄、同じ IP からの間引き(04 §10) |
| `/mcp`・`/token`・`/register`・`/revoke`・`/.well-known/oauth-*` | Claude、Android アプリ、Codex など | Works の OAuth と `wks_`(無ければ 401) |
| `/authorize`・`/oauth/consent` | 本人のブラウザ | Works のログイン |
| `/.well-known/assetlinks.json` | Chrome と Android(アプリの戻り先の確かめ) | 公開してよい値だけ(パッケージ名と署名の指紋) |
| `/healthz` | だれでも | 中身なし |
| `/api/v1/docs`・`/api/v1/openapi.json` | — | 本番では出さない |

- Web フォームは、Web サイトのサーバから転送しなくても、訪問者のブラウザから直に送れるようになる(Access のサービストークンが要らない)。スパムが増えたら Cloudflare Turnstile(無料。サーバで確かめる。03 §13)を足す
- MCP を Codex などから使うときも、Access のサービストークンは要らなくなり、`wks_` だけで繋がる

### 切り替えまで: Access の内側のまま、外から使う(2026-09-22。Q-044 で決定。J-055 で片付ける)

**経路は 1 本のまま**(本人の決定: 別のホストや素通しの経路は作らない)。外から叩くものは、**Access のサービストークンをヘッダ(`CF-Access-Client-Id` / `CF-Access-Client-Secret`)で渡して門を通る**。環境設定で作った 2 つの扱い:

| 経路 | 誰が叩くか | 認証 |
|---|---|---|
| `POST /api/v1/forms/{key}`(Web フォームの受け口。04 §10) | 外部の Web サイトの訪問者(ブラウザ) | 無し(鍵は URL) |
| `/mcp`(J-028) | Claude Desktop / Claude Code / Codex | アプリのトークン(`Authorization: Bearer`) |

- **MCP**: Claude Desktop(`headers`)・Claude Code(`--header`)・Codex(`http_headers`)はどれも任意のヘッダを送れるので、サービストークン + アプリのトークンの 2 つを付ける。環境設定の「繋ぎ方」はその形で出す(05 §11)。サービストークンは Zero Trust で発行し、Access のポリシーに「Service Auth」として足す(`scripts/cloudflare-access-check.py` が一時的にやっていることを、恒久のトークンで行う)
- **Web フォーム**: 訪問者のブラウザは Access のヘッダを付けられない(付けさせると秘密が漏れる)。だから**送るのは Web サイトのサーバ**(問い合わせフォームの送信先。WordPress のプラグイン、サーバレス関数など)で、サービストークンを付けて受け口へ転送する。環境設定の「サーバから送る」がその形。静的なサイトからブラウザで直接送りたい場合だけ、受け口のパスを Access の外に出す(別の判断。いまは持たない)
- 管理 API(`/settings/*`)と画面は、これまでどおり Access の内側で人だけが通る
- **Slack の戻り(`/api/v1/slack/callback`)も Access の内側のまま**(04 §14)。戻ってくるのは、Works にログインして「チャンネルを追加」を押した本人のブラウザなので、素通しは要らない。api からは `slack.com`・`hooks.slack.com` へ出ていく(外向きの HTTPS。Tunnel とは別で、何も開けなくてよい)

#### Claude のカスタムコネクタのための例外(2026-09-24 決定。本人の承認。03 §6)

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
