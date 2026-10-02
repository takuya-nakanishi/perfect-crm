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
ブラウザ・スマホのアプリ・AI のエージェント
  ─https→ works.sanei-clover.com(Cloudflare。CNAME → <Tunnel ID>.cfargotunnel.com、プロキシ ON)
        → Tunnel「sanei-clover-lan」→ cloudflared → http://web:8080(Caddy)→ 画面の静的ファイル / api
```

**手前に門(Cloudflare Access)を置かない。ログインとセッションはアプリがすべて持つ**(2026-10-01、本人の決定。01 D-14 の 2 度目の見直し)。スマホのアプリも AI のエージェント(Claude・Codex など)も、ブラウザと同じ公開 URL に直に届く。ログインの前に届く口と、その守りは 03 §5「門を置かずに守る」。

- Surface から Cloudflare へ外向きに張るだけで、受信ポートを開けない。固定 IP もポート開放も要らない
- **Tunnel はこの LAN で 1 本(`sanei-clover-lan`)に集約する。**サービスを増やすときは同じ Tunnel にホスト名を足す。`scripts/cloudflare-tunnel-setup.py` は既存の経路を残したまま、指定したホストの行だけを差し替える。別の Compose のサービスを載せるなら、cloudflared から届くネットワークに置くこと
- 組み立てはすべて API(`scripts/cloudflare-tunnel-setup.py`。再実行しても重複しない): Tunnel → 経路 → CNAME → `.env` のトークン更新。Access を外すのも同じスクリプト(`--remove-access`。§3)
- API トークンは直下の `.env` の `CLOUDFLARE_API_TOKEN`。権限は必要最小より広い(ゾーン `sanei-clover.com` とアカウントの全権限。2026-09-19 に本人が受け入れたリスク)。前提は、`.env` の外に出さない・漏えいを疑ったら即失効

## 3. 門(Cloudflare Access)を外す(2026-10-01)

2026-09-21 から、前段に Cloudflare Access を置いていた(アプリ名 `Works`、種別 self-hosted、許可は本人だけ、IdP は One-time PIN と Google Workspace(Q-039)、セッション 720 時間)。
2026-10-01 に、Access を外してログインとセッションをすべてアプリに持たせると決めた(本人。「スマホアプリや AI エージェントなどからのリクエストも届くようにしたい」。01 D-14)。
門があると、ブラウザ以外(Android アプリ・Claude Code・Codex など)は WARP かサービストークンを持たないと届かない(§7 の末尾)。

**切り替えの手順(J-055)**。既存のパスワードがある場合は、2 段階認証を先に設定する。
パスワードも外部ログインの資格情報も無い場合は、Access を先に外してもアプリにはログインできず、データ API は 401 を返す。
その場合の初期設定と実アカウントの確認は J-069・J-070 として進める(2026-10-02、本人の直接到達の指示で実施)。

1. 新しい版(Access の JWT を信頼する形を消した版)を本番へ出す。**出した時点で、本番のログインはアプリのログインになる**(Access は前にいるまま)。`WORKS_SECRET_KEY` が空だと api は起動しない
2. パスワードを使う場合は本人が決める: `docker compose exec api python -m app.cli set-password <メール>`(15 文字以上を 2 回)。Google だけで入る場合は J-069 の設定を済ませればよく、パスワードは不要
3. Works を開く → Works のログイン(パスワード → 初回は QR で 2 段階認証を設定。Access が残っていれば、先に通る)。Claude のコネクタの許可は DB に残る
4. **パスワードを設定してある場合は、2 段階認証の設定が済んでから**、Access を外す: `python3 scripts/cloudflare-tunnel-setup.py works.sanei-clover.com --origin http://web:8080 --remove-access`(このホストとその下のパスの Access アプリをすべて消す。解除前は 7 つ: 画面全体と、Claude のための 6 つのパス)。パスワードを決めてから 2 段階認証を設定するまでのあいだに、パスワードを知る人が自分の認証アプリを登録できてしまうため
5. 外から確かめる: `python3 scripts/public-check.py works.sanei-clover.com`(読むだけ。runbook §3)。スマホの Chrome で開いて、パスワード + 6 桁で入れること
6. 後片付け: `.env` から `WORKS_AUTH`・`WORKS_ACCESS_TEAM_DOMAIN`・`WORKS_ACCESS_AUD` を消す(api はもう読まない。残っていても害は無い)

- 戻すとき(門をまた置く): `python3 scripts/cloudflare-tunnel-setup.py works.sanei-clover.com --origin http://web:8080 --allow <メール> --anthropic /mcp,/token,/register,/revoke,/.well-known/oauth-authorization-server,/.well-known/oauth-protected-resource`。アプリのログインはそのまま(Access の JWT は見ない)なので、門の内側でも Works のログインが要る。スマホのアプリとエージェントは、また門で止まる
- One-time PIN の IdP は消さない(アカウントで共有するもの)
- Google でログインを使うなら、Workspace の管理コンソールで 2 段階認証を必須にしておく(Google で入るときは Works の 6 桁を求めないため)。Microsoft で入るときは Works の 6 桁を求めるので、こちらは要らない
- Google・Microsoft でログインを本番で開ける手順は runbook §6(Google のクライアントに戻り先を足す)と §6c(Entra のアプリ登録と証明書)。`.env` に入れて api を建て直すと、ログインの画面にボタンが出る(J-069)

**2026-10-02 の実施記録**: 本人の指示で Google・Microsoft のコードと Microsoft の署名鍵・テナントの検証補強を本番へ反映。
DB は 0009 → 0010。Access アプリ 7 件を対象ホストと配下に限定して API で解除し、Tunnel・DNS は変更していない。
事前の DB の退避は `~/backups/perfect-crm/works-2026-10-02-before-J-055-J-069.dump`、Access の設定は同じ場所の
`works-2026-10-02-before-J-055-access.json`(公開リポジトリには入れない)。`.env` の旧 Access 設定 3 項目も削除した。
公開 URL の直接到達とアプリの守りの検査はすべて PASS。Google・Microsoft の認可画面への転送は資格情報が未設定のため SKIP で、両提供元は無効のまま(J-069)。
有効な利用者 1 人にパスワード・TOTP・外部アカウントの結び付けはまだ無く、初回ログインの確認は J-070。
検証: `scripts/verify.sh` は全 green、モック E2E と `scripts/e2e-http.sh` は全通過。
OIDC の 43 テストは提供元の署名付きトークンを模した実 DB の検査で、Google・Microsoft の実アカウントの検査は J-069 に残す。

## 4. 配る側のヘッダ(`frontend/Caddyfile`)

- CSP は `default-src 'self'`。外部の資源を一切読まない(書体も同梱)。`style-src` の `'unsafe-inline'` は React の `style` 属性のため。インラインのスクリプトは禁止なので、明暗を描画前に決める処理は `public/theme.js` に出してある
- `/assets/*`(ファイル名にハッシュ)は 1 年 + `immutable`。無いファイルは 404 を返し、`index.html` で誤魔化さない(古い HTML が新しい資源を探したときに、HTML を JS として読ませないため)
- それ以外は `index.html` を返し(SPA)、`Cache-Control: no-cache, no-transform`
- **HSTS は 1 年**(`max-age=31536000`。`includeSubDomains` は付けない。このホストだけ)。門が無いので、http に落とされる余地を残さない。ブラウザは http で受けた HSTS を無視するので、手元の `http://127.0.0.1:8610` には効かない
- **`/api/*` の本文は 20 MB まで**(`request_body`。超えたら 413)。api は本文を読み終えてから認証を確かめるので、ログインの前の口に大きな本文を送りつけられても、メモリを食わせない。いちばん大きいのは CSV の取り込み(04 §7)
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

Tunnel をやめて ALB などで直接受けるなら、TLS を自前で持つ。**ログインはアプリが持ち、門も置いていないので(01 D-14)、作り直しは要らない**(Access を信頼していた 2026-09-24〜10-01 の形では、ここで作り直しになるのを引き受けていた)。`CF-Connecting-IP` は Cloudflare の外では付かないので、間引きの送り元の IP の取り方は移った先に合わせる(03 §5)。

## 7. 外から使う口(2026-10-01、Access を外してから)

門が無いので、外から叩くものはアプリの認証だけで届く。

| 経路 | 誰が叩くか | 認証 |
|---|---|---|
| 画面と `/api/v1/*` | ブラウザ | セッションの Cookie(パスワード + TOTP、Google、Microsoft + TOTP。03 §5) |
| `/api/v1/*` | Android アプリ(J-056) | OAuth の access token(スコープ `api`。03 §5) |
| `/mcp` と OAuth の口 | Claude のカスタムコネクタ(Anthropic のクラウドから)・Claude Code | OAuth(本人が Works にログインして許可する。03 §6) |
| `/mcp` | Codex など、ヘッダを自分で付けるアプリ | 環境設定で発行したトークン(`wks_`。04 §10) |
| `POST /api/v1/forms/{key}` | Web サイトの訪問者のブラウザ、サイトのサーバ | 無し(鍵は URL。間引きと bot 避け。04 §10) |

- **MCP**: 環境設定の「繋ぎ方」は、トークンのヘッダ(`Authorization`)だけの形で出す(05 §11)
- **Web フォーム**: 訪問者のブラウザから直に送れる(環境設定が出す埋め込みの HTML)。鍵(URL)を訪問者に見せたくなければ、サイトのサーバから転送する。スパムが来たら Turnstile を足す(03 §13)
- 管理 API(`/settings/*`)は、管理者のセッションだけが通る
- Google と Slack の戻り(`/api/v1/google/callback`・`/api/v1/slack/callback`)は、署名付きの `state` で、だれの許可かを決める
- Google・Microsoft でログインの戻り(`/api/v1/session/{google,microsoft}/callback`)は、state を署名した Cookie と照らし、ID トークンを確かめる。コードの引き換えは送り元ごとに 1 分 10 回まで(03 §5「門を置かずに守る」)
- 記録: Access のログは無くなる。ログインは `login_attempts`(02 §8)、MCP は `oauth_grants.last_used_at`、ほかは api のログ

### 2026-09-22〜10-01 の形(記録)

Access の内側のまま外から使う形だった(Q-044)。外から叩くものは、Access のサービストークンをヘッダ(`CF-Access-Client-Id` / `CF-Access-Client-Secret`)で渡して門を通った。
Claude のカスタムコネクタはそのヘッダを送れない(送れるヘッダ名は Anthropic の承認制)ので、Anthropic の送信元(`160.79.104.0/21`)からだけ、機械向けの口(`/mcp`・`/token`・`/register`・`/revoke`・OAuth のメタデータ)を素通しにした(2026-09-24、本人の承認。人が開く `/authorize` と画面は門の内側のまま)。
スマホのアプリは、端末に入れた Cloudflare One Agent(旧 WARP)で門を通る案だった(2026-10-01 の前半。09 の記録)。どれも Access を外して要らなくなった。
