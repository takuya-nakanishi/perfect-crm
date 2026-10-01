# 03 アーキテクチャ

## 1. 全体像

```
ブラウザ ──────┐
Android アプリ ─┼─https─▶ Cloudflare(TLS)──Tunnel──▶ cloudflared ──▶ web(Caddy)
Claude・Codex ─┘                                                           │ 静的ファイル(画面)
                                                                           │ /api/*・/mcp・OAuth の口
                                                                           ▼
                                                                     api(Python)── ログイン・OAuth・MCP
                                                                           │
                                                                           ▼
                                                                     db(PostgreSQL 18)
```

**2026-09-24 から `api` と `db` も本番で動いている**(実データ。J-041)。ログインとセッションはアプリ自身がすべて持ち(§5)、
**手前に門(Cloudflare Access)は置かない**(2026-10-01 の決定。01 D-14)。ブラウザ・Android アプリ・Claude・Codex は、どれも公開 URL に直に届く。
本番で Access を外すのは J-055(06 §3)。

## 2. 構成

| 場所 | 役割 |
|---|---|
| `frontend/` | 画面。Vite + React + TypeScript + Tailwind CSS v4。ビルドすると静的ファイルになる |
| `frontend/Dockerfile` / `Caddyfile` | Node でビルドし、Caddy で配る。SPA の戻し、キャッシュ、CSP などのヘッダ、`/healthz` |
| `backend/` | Python の JSON API。`/api/v1`(04)。中身の地図は `backend/README.md` |
| `android/` | Android のネイティブアプリ(これから。01 D-15、§12)。Gradle のプロジェクトで、画面・API とは道具立てが別 |
| `docker-compose.yml` | `web` / `tunnel`(profile `public`)/ `api`・`db`(profile `backend`) |
| `scripts/` | Cloudflare の Tunnel・DNS・Access を API で組むスクリプトと、Access 越しの疎通確認。`verify.sh`(検証の関門)、無人ループ(`loop-run.sh`・`loop-next.mjs`)、worktree(`wt-new.sh`・`wt-land.sh`) |
| `docs/` | 設計(`design/`)、運用手順(`runbook/`。`02-loop.md` が無人ループ)、テストケース表(`tests/`。4 軸で 6 領域) |
| `backlog/` | 問いと作業(人と、人が起こしたセッションのもの) |
| `loops/` | 無人ループの記録(`tests/<ID>.md`)。ループは `backlog/` を読まない・書かない |

### frontend/src の中

| 場所 | 中身 |
|---|---|
| `api/types.ts` | **画面とバックエンドの契約(型)。**ここが正 |
| `api/client.ts` | 窓口 `ApiClient` と、mock / http の切り替え |
| `api/http.ts` | 本物の API を叩く実装(`/api/v1`) |
| `mocks/` | 擬似 DB。`fixtures/*.json`(DB の行と同じ形)と、絞り込み・並び替え・集計・検索・値の検証・業務ルールを肩代わりする `engine.ts`、テーブル設定を受ける `schema.ts`(02 §5)、CSV の取り込みと書き出しの `csv.ts`(04 §7)、Google ドライブの擬似 `drive.ts`(04 §8)、Slack のチャンネルの `slack.ts` とワークフローの `workflows.ts`(04 §14・§15。書き込みの口 `setWriteHooks` に差し込む) |
| `data/` | TanStack Query の取得と更新。楽観更新はここに集約(`mutations.ts`) |
| `lib/` | 日付、書式、フィルタの評価、タスク追加欄の読み取り、キー操作、パネルの経路(`usePeek.ts`)、テーブル設定の下書き(`tableDraft.ts`)、書式付きの文字の洗浄(`richtext.ts`)、ドライブの値の読み取り(`drive.ts`) |
| `state/ui.ts` | 画面の状態(テーマ、サイドバー、開いているモーダル、トースト) |
| `components/` | `shell/`(外枠・サイドバー・検索・タスク追加)、`object/`(テーブルの画面と 3 種のビュー、グラフ)、`record/`(パネルとぱんくず、項目の表示と編集、活動の時系列 `ActivityTimeline.tsx`、書式付きの文字 `RichText*.tsx`、ドライブの項目 `DriveFilesEditor.tsx`)、`designer/`(テーブル設定と CSV の取り込み。別ファイルに分けて、開いたときに読む)、`workflow/`(ワークフローの編集・条件のチップ・Slack に知らせる・実行記録。05 §14)、`ui/`(部品) |
| `e2e/smoke.mjs` | 主要な操作を実ブラウザで確かめる(05 §6) |

## 3. モックと本物の差し替え

```
画面 ──▶ api(ApiClient)──┬─ mock: mocks/mockClient.ts ──▶ mocks/engine.ts ──▶ fixtures/*.json + localStorage
                          └─ http: api/http.ts ──▶ /api/v1(Python)
```

- 切り替えはビルド時の環境変数 `VITE_API_MODE`(`mock` が既定、`http` で本物)。Compose の `web` のビルド引数にもなっている
- 実装は動的 import なので、`http` のビルドにモックのデータは入らない
- モックは「サーバがやるはずの処理」を全部肩代わりする: フィルタの評価、選択肢の定義順や参照先の名前での並び替え、集計、ひらがな・カタカナを区別しない検索、業務ルール(02 §3)、参照先の表示名の添付、通信の待ち時間(読み 40ms・書き 120ms)
- **バックエンドを作るときは、モックの振る舞いが仕様。**`engine.ts` と同じ入力に同じ出力を返せば、画面は何も変えずに動く。確認は同じ E2E を http モードで通すこと(`scripts/e2e-http.sh`。2026-09-24 に全項目が通った。J-024)

## 4. バックエンドのフレームワーク(決定・2026-09-23)

**FastAPI + SQLAlchemy 2(Core 中心)+ Alembic + Pydantic v2 + psycopg 3、パッケージ管理は uv。**
2026-09-23 に本人が決めた(Q-034 解決)。下は決める前に並べた比較で、判断の根拠として残す。言語は Python(01 D-04)。

| 観点 | FastAPI | Litestar | Django(+ Django Ninja) |
|---|---|---|---|
| 画面との契約(OpenAPI を自動生成し、TypeScript の型と突き合わせる) | ◎ Pydantic v2 と一体 | ◎ | ○ Ninja なら可 |
| メタデータ駆動の汎用 API(`/objects/{key}/records` が任意のテーブルを扱う。フィルタを安全に SQL へ訳す) | ◎ SQLAlchemy Core で動的に組める | ◎ 同左 | △ ORM は「モデル = クラス」が前提。動的なテーブルは生 SQL か無理のある動的モデルになる |
| テーブルを画面から追加する(J-031。実行時に DDL を流す) | ◎ Core + 実行時 DDL が素直 | ◎ | △ マイグレーションがモデルのファイルを前提にしており、枠の外になる |
| ログイン(セッション、パスワード、CSRF) | △ 自分で組む(小さいが、書く) | ○ 部品あり | ◎ 最初から全部ある |
| MCP サーバ(J-028。公式 `mcp` は ASGI アプリに載せる形) | ◎ そのまま同居できる | ◎ | △ 載るが遠回り |
| AI チャットのストリーミング(J-029。SSE + `anthropic` の非同期クライアント) | ◎ | ◎ | ○ できるが同期が基本の文化 |
| 情報量(人にも AI にも) | ◎ 圧倒的 | △ 少ない。AI が間違えやすい | ◎ 圧倒的 |
| 保守の安定 | ○ 利用者が非常に多い。0.x 番台が続くが実害は小さい | ○ コミュニティ運営 | ◎ 財団、LTS |
| 管理画面 | 無し(要らない。自分の画面が製品) | 無し | ◎ あるが、使い道が薄い |

決め手:

- 決め手は、この CRM の芯が「メタデータから SQL を組み立てる汎用 API」であること。Django の最大の強み(モデルを書けば管理画面も認証も付いてくる)は、モデルをコードに書かないこの作りでは活きにくい
- MCP と AI チャットを同じプロセスに素直に載せられる
- 弱みのログインは、利用者 1 名の規模なら小さく書ける(セッション Cookie + argon2)。Q-035 で Access を信頼する形にすれば、さらに小さくなる(2026-09-24 に Access を信頼する形にしたので、argon2 は使わず依存から外した。トークンは高いエントロピーの乱数なので sha256)
- 次点は Django + Django Ninja。「ローンチ後のテーブル追加は JSONB で済ませる」と割り切るなら(Q-036)、認証と管理画面が最初からある利点が勝つ

比較した時点(2026-09-21)の版: fastapi 0.141.1 / litestar 2.24.0 / Django 6.1.1 / django-ninja 1.7.1。
**採用を決めた時点の一次資料での確認は §10**(2026-09-23 に引き直した)。

## 5. 認証(2026-10-01 に作り直す。01 D-14)

**アプリ自身がログインを持つ。**メールアドレスとパスワード(+ 2 段階認証の TOTP)、Google でログイン、Microsoft でログイン(+ TOTP)の 3 つ。
**手前に門(Cloudflare Access)は置かない**(2026-10-01、本人の決定。01 D-14、06 §3)。ブラウザ・Android アプリ・AI のエージェント(MCP)は公開 URL に直に届き、ここのログインと OAuth・トークンだけで守る(下の「門を置かずに守る」)。

### だれが、何で入るか

| 入口 | 証明するもの | 通る口 | 持ち時間 |
|---|---|---|---|
| 画面(ブラウザ) | セッションの Cookie `__Host-works_session`(パスワード + TOTP、Google、Microsoft + TOTP のどれかで入ったときに置く) | `/api/v1/*` | ログインから 30 日(Access のころと同じ間隔) |
| Android アプリ | OAuth の access token(スコープ `api`。`Authorization: Bearer`) | `/api/v1/*` | access 1 時間、refresh 90 日(使うたびに替わる。90 日使わなければ入り直す) |
| Claude のカスタムコネクタ | OAuth の access token(スコープ `works`) | `/mcp` だけ | 同上 |
| Codex など | 環境設定で発行したトークン(`wks_`。04 §10) | `/mcp` だけ | 失効するまで |
| Web フォームの送り手 | なし(URL の鍵) | `/api/v1/forms/{key}` だけ | — |

- `current_user`(`app/api/deps.py`)は、Cookie → `Authorization: Bearer` の順に見る。どちらも無い・効かない → 401 `unauthenticated`。**Bearer はスコープ `api` のものだけを通す**(`wks_` と `works` は MCP のためのもので、画面の API へ広げない)
- 利用者を消す(`deleted_at`)と、その人のセッション・許可・トークンはどれも効かなくなる。管理者(`admin`)の扱いは変わらない
- **手元・テスト・E2E・本番が同じログインを通る。**ログインの形を切り替える設定(`WORKS_AUTH`)は無い。メールアドレスだけで入れた `dev` は J-053 で、Access の JWT を信頼した `access` は Access を外すと決めた日に消した(2026-10-01)。公開する場所で「ログインを経ずに入れる」形を誤って有効にする事故を、形ごと無くすため。E2E の DB(`reset-demo`)はデモの利用者に決まったパスワードを入れ、E2E はそれで入る。手元の http では `Secure` の Cookie を置けないので、名前を `works_session` にする(`WORKS_SECURE_COOKIE=false`)
- `WORKS_SECRET_KEY` は、公開する場所では必須にする(空なら起動しない)。Google・Microsoft の戻りを待つ Cookie の署名と、Google・Slack の鍵と TOTP の秘密の暗号化に使う

### パスワード

- ログイン ID はメールアドレス(小文字にそろえる)。パスワードは任意で、Google・Microsoft だけで入る人は持たない(`password_hash` が NULL)
- 決まりは NIST SP 800-63B-4 に従う(§13):
  - **15 文字以上**。TOTP と組むので NIST の下限は 8 文字だが、パスワード管理に任せれば長さは負担にならないので、パスワードだけで入る場合の下限(15)を取る。数えるのは NFKC で正規化したあとの文字(コードポイント)
  - 256 文字まで受ける(64 文字以上を受けること、とされる。上限は、長すぎる入力で重くしないため)
  - 文字の種類の縛りと、定期的な変更は求めない。空白も日本語も使える
  - **よく漏れているパスワードは断る**: Have I Been Pwned の Pwned Passwords に照らす(SHA-1 の先頭 5 文字だけを送り、残りは手元で照らす。キーも費用も要らない)。届かないときは通し、記録を残す。ほかに、メールアドレス・その @ の前・名前・「works」・ワークスペースの名前と丸ごと同じものも断る
- 保存は **Argon2id**(`argon2-cffi` の `PasswordHasher`。既定は RFC 9106 の低メモリの組で、64 MiB・3 回・並列 4。OWASP の最小(19 MiB・2 回・並列 1)より重い)。**同時に掛けるのは 2 本まで**(ログインを連打されても、64 MiB ずつメモリを食わせない)。ログインが通ったとき、強さが古ければ掛け直す(`check_needs_rehash`)
- `passlib` は使わない。2020-10 から版が出ておらず、bcrypt 5.0 と組むと短いパスワードでも落ちる(§13)
- 失敗の応答は、メールアドレスが無いときもパスワードが違うときも同じ文(「メールアドレスかパスワードが違います」)。無いときも見せかけのハッシュを 1 回照らし、かかる時間で見分けられないようにする

### 2 段階認証(TOTP。2026-10-01 本人の決定。Q-048)

- **パスワードか Microsoft で入るときは必須。**Google で入るときは求めない(Google 側の 2 段階認証に任せる。対象を Workspace に限っているので、管理コンソールで必須にしておける)。Microsoft の 2 段階認証は、Works からは確かめられず、個人のアカウント・よその組織のアカウントもあるので必須にもできない。だから Works の 6 桁を重ねる(2026-10-02。01 D-14)
- 方式は RFC 6238 の TOTP。**SHA-1・6 桁・30 秒**(RFC の既定。Google Authenticator・Microsoft Authenticator・1Password など、認証アプリがそろって受ける組)。秘密は 160 ビットの乱数(`pyotp.random_base32()`。NIST の下限は 112 ビット)
- 受ける幅は前後 1 刻み(±30 秒)。端末の時計のずれと、通信と打つ時間のため(RFC 6238 §5.2、NIST SP 800-63B-4 §3.1.5.2)
- **同じコードは 1 回しか受けない**(RFC 6238 §5.2 と NIST の SHALL)。最後に受けた刻み(`users.totp_last_step`)より後のものだけを受ける
- 秘密は `users.totp_secret` に**暗号化して**置く(Google の鍵と同じく、`WORKS_SECRET_KEY` から導いた鍵の Fernet)。コードを照らすのに元の値が要るので、ハッシュにはできない。`WORKS_SECRET_KEY` を変えると、2 段階認証はやり直しになる
- ログインの流れ: `POST /session`(メールアドレスとパスワード)が通っても、**まだセッションを作らない**。2 段目を待つ札(`login_challenges` の行。Cookie `__Host-works_login`、5 分)を置いて「6 桁を入れて」と返す → `POST /session/totp`(6 桁)が通ったらセッションを作り、札を消す。1 枚の札で試せるのは 5 回まで。切れたら・5 回違えたら、1 段目からやり直す。Microsoft から戻ったときも同じ札を置き(札は 1 段目が何だったかを持つ)、ログインの画面が `GET /session/challenge` で札を読み直して 6 桁の段を出す
- **初めての設定**: TOTP がまだの人(管理者が `set-password` で足した直後・Microsoft で初めて入った人など)は、1 段目(パスワードか Microsoft)が通ったところで設定の段へ進む。QR と秘密の文字列を出し、認証アプリで読み、表示された 6 桁が通ったら、設定とログインを一度に済ませる。**設定が済むまでセッションは作らない**(パスワードだけで入れる時間を作らない)
- QR はサーバが作る(`segno`。`data:image/svg+xml` の URI で返し、画面は `<img>` で描く。画面にライブラリを足さず、CSP も `img-src 'self' data:` の中に収まる)。中身は `otpauth://totp/<ワークスペース名>:<メールアドレス>?secret=…&issuer=<ワークスペース名>`(自社の名前をコードに書かない)
- やり直す(端末を替えた): アカウントの画面から。10 分以内にログインしていること(パスワード + TOTP か Google)が要る。新しい秘密で読み直し、6 桁が通ったら入れ替える(古い端末のコードは効かなくなる)
- 端末を無くした: Google で入り、アカウントの画面でやり直す(Microsoft で入るにも 6 桁が要るので、ここでは使えない)。Google を結んでいなければ、管理者の `python -m app.cli reset-totp <メール>`(次にパスワードか Microsoft で入るときに設定し直す。パスワードも漏れた恐れがあれば `set-password` も)
- 回復用のコードは持たない(Google で入る・管理者のコマンドで戻せる。利用者 1〜3 名の規模)。外す口も作らない(パスワードで入る限り必須)
- E2E: `reset-demo` がデモの利用者に決まった秘密を入れ、E2E はそこから 6 桁を計算して入れる。モックは 2 段目を出さない(パスワードも見ないため)

### 続けて失敗したとき

- **同じアカウントで 5 回続けて失敗したら(パスワードでも 6 桁でも)、次を受けるまで待たせる。**待ちは 1 分から失敗のたびに倍にし、上限は 1 時間。アカウントを閉じてはしまわない(閉じると、他人が本人を締め出せる)。どの方法でもログインが通れば数え直す
- **100 回続けて失敗したら、そのアカウントのパスワードでのログインを止める**(NIST の上限。§13)。戻すのは、本人が Google で入ってパスワードを決め直すか、管理者の `set-password`。待ち(5 回から)と止める(100 回)は 6 桁の段にも掛かるので、Microsoft で入っても 6 桁の段で同じように待たされる(Google は 6 桁を通らないので掛からない)
- **同じ IP から 10 分に 30 回失敗したら、その IP からのパスワードのログインを 10 分止める**(429 `too_many_attempts`、`Retry-After`)。待たせている間はパスワードを照らさない(ハッシュを掛けない)
- IP は Cloudflare が付ける `CF-Connecting-IP` を使う(api には Tunnel の向こうからしか届かないので信じてよい。手元は接続元)
- **門は無いので、ログインの口にはインターネットのだれからでも届く。ここの間引きが守りの本体**(下の「門を置かずに守る」)
- 試みはすべて `login_attempts` に残す(02 §8)。ただし待たせて断った試み(`throttled`)は、同じ送り元(IP)から 1 分に 1 件だけ残す(1 つの IP から叩き続けられても、表を膨らませない。数に入れないものなので、判定は変わらない)

### 門を置かずに守る(2026-10-01。01 D-14 の 2 度目の見直し)

ログインの前に届く口と、その守り。ほかの口(`/api/v1/*` の残り)は、どれもセッションか Bearer が無ければ 401。

| 口 | だれが叩くか | 守り |
|---|---|---|
| `POST /api/v1/session`・`/session/totp` | ログインする人 | 上の間引き(アカウントごと・IP ごと)、TOTP、Argon2id(同時に 2 本まで)、`Origin` |
| `GET /api/v1/session`・`/session/options` | 画面 | 読むだけ(未ログインなら 401 と、ログインの画面が出すもの) |
| `GET /api/v1/session/{google,microsoft}` | 本人のブラウザ | 提供元の許可の画面へ送るだけ。途中の状態は署名した 10 分の Cookie に置き、**DB に行を作らない**。提供元の discovery document は 1 時間持つ(叩かれても提供元へ問い合わせを積まない) |
| `GET /api/v1/session/{google,microsoft}/callback` | 本人のブラウザ | state を Cookie と照らす(合わなければ提供元へ問い合わせずに断る)。**コードの引き換えは送り元(IP)ごとに 1 分 10 回まで**。ID トークンの署名・発行元・宛先・期限・nonce。公開鍵は、知らない kid でも読み直すのは 1 分に 1 回まで |
| `GET /api/v1/session/challenge` | ログインの画面 | 2 段目の札の Cookie が無い・切れていれば 401(読むだけ) |
| `/register`(MCP の動的登録) | Claude | 戻り先は Claude だけ(§6)。**許可の無い登録は新しいものから 50 件だけ残し、古いものから消す**(断らないので、正しい登録を締め出さない。許可の付いた登録は消さない) |
| `/authorize` | 本人のブラウザ | 登録済みのクライアントだけ。**許可を待つ依頼は新しいものから 50 件だけ残す**(10 分で切れる)。鍵を出すのは、ログインした本人が許可したときだけ |
| `/token`・`/revoke` | Claude | 認可コード・refresh token は 256 ビットの乱数で、PKCE も要る。全文は保存しない(sha256) |
| `/mcp` | Claude・Codex など | OAuth の access token か環境設定のトークン(`wks_`)。無い・違えば 401 |
| `POST /api/v1/forms/{key}` | Web サイトの訪問者・サイトのサーバ | 鍵は URL、bot 避けの隠し欄、**受け口ごと・送り元(IP)ごとに 1 分 10 件まで**(04 §10) |
| `GET /api/v1/google/callback`・`/slack/callback` | 本人のブラウザ | 署名付きの `state`(`WORKS_SECRET_KEY`) |
| 画面(静的なファイル) | だれでも | 中身は公開のリポジトリと同じ。データは API の向こう |

- **本文は 20 MB まで**(Caddy の `request_body`。超えたら 413)。api は本文を読み終えてから認証を確かめるので、ログインの前の口に大きな本文を送りつけられても、メモリを食わせない。いちばん大きいのは CSV の取り込み(04 §7)。MCP と OAuth の口は SDK が本文の大きさを抑えている
- 配る側のヘッダ(CSP・`X-Frame-Options`・`nosniff` など。06 §4)に、HSTS(1 年。このホストだけ)を足した
- **Cloudflare の率の上限(WAF の rate limiting)は使わない。**無料で使えるのは 1 本で、条件はパスだけ、数える期間と遮る時間が 10 秒に固定(§13)。ゾーンのほかのホストにも当たる。アプリの間引きのほうが細かく効く
- 置かなかったもの: ログイン画面の CAPTCHA(TOTP と間引きで足りる。人が増えたら考える)、新しい端末でのログインの知らせ

### 画面のセッション

- ログインが通ったら、32 バイトの乱数を Cookie `__Host-works_session`(`HttpOnly`・`Secure`・`SameSite=Lax`・`Path=/`、`Domain` なし)に入れ、DB には sha256 だけを置く(`user_sessions`)。Cookie に署名はしない(DB の行が正。行を消せばその場で効かなくなる)
- 期限はログインから 30 日。使っていても延ばさない(Access のころと同じく、月に 1 回入り直す)。最後に使った時刻は 1 時間に 1 回だけ書く(アカウントの画面の「最終」)
- NIST SP 800-63B-4 は、2 要素で入ったセッション(AAL2)の入り直しを 24 時間以内・使わない時間は 1 時間以内にするよう勧めている(SHOULD。§2.2.2)。**日常の道具として 30 日を取る**(本人が了承。2026-10-01)
- ログインのたびに新しいセッションを作る(前の Cookie は引き継がない)。ログアウトは行を消す
- **パスワードを変えたら、いま使っているもの以外のセッションと、アプリの許可をすべて切る**
- 自分のセッションとアプリを一覧で見て、1 つずつ・まとめて切れる(04 §16、05 §15)

### 書き込みの偽造(CSRF)を防ぐ

- Cookie で入った要求のうち、読む以外(POST・PUT・PATCH・DELETE)は、`Origin` が公開 URL と同じものだけを受ける(無い・違う → 403 `bad_origin`)。`SameSite=Lax` と重ねる
- ログイン(`POST /session`)にも同じ確かめをする(よそのサイトから、攻撃者のアカウントでログインさせられるのを防ぐ)
- Bearer で入る要求(アプリ・MCP)と、Web フォームの受け口は対象外(前者は Cookie を使わず、後者はよそのサイトから送られるもの)

### Google でログイン

- OpenID Connect の認可コード + PKCE(S256)。スコープは `openid email`。OAuth クライアントはドライブと同じもの(GCP `citric-earth-449901-e7`、種類はウェブ、**対象は「内部」**。runbook §6)。「内部」なので、**Google で入れるのは Workspace のアカウントだけ**(ほかは Google が `org_internal` で断り、Works には戻ってこない)
- 流れ: ログインの画面のボタン(リンク)`GET /api/v1/session/google?next=…` → 短命の Cookie `__Host-works_oidc`(10 分)を置いて Google の許可の画面へ → 戻り `GET /api/v1/session/google/callback` で、state を Cookie と照らし、コードをトークンに替え(client secret と PKCE の verifier を添える)、ID トークンを確かめる → 利用者を決めてセッションを作り、`next` へ。中身は `app/auth/oidc.py`
- Cookie に入れるのは、state(256 ビットの乱数)・戻り先・結ぶ相手(アカウントの画面から結ぶときだけ)・時刻で、`WORKS_SECRET_KEY` で署名する。**PKCE の verifier と nonce は、state から同じ鍵で導く**(Cookie に秘密を置かず、DB にも行を作らない)
- ID トークンは、署名(Google の公開鍵。`kid` で選ぶ)・`iss`(`https://accounts.google.com` か `accounts.google.com`)・`aud`(クライアント ID)・期限(時計のずれは 2 分まで見逃す)・nonce を確かめる。Google の口(許可・トークン・公開鍵)は discovery document(`https://accounts.google.com/.well-known/openid-configuration`)から読み、1 時間持つ。公開鍵は、知らない `kid` が来たら読み直す(鍵の入れ替え)
- **利用者との結び付けは Google の `sub`**(アカウント固有で変わらない ID)。Google は「メールアドレスを利用者の ID に使うな」としている(§13)。初めて Google で入るときだけ、**Google が持ち主だと言えるアドレス**(`email_verified` が真で、Gmail のアドレスか、`hd` がある Workspace の利用者。§13)で `users.email` を探し、見つかれば `google_sub` を結ぶ。以後は `sub` で引く(Google 側でアドレスが変わっても入れる)。見つからなければ入れない(`google_not_registered`)。消した利用者に結ばれた `sub` でも入れない
- state を Cookie に結ぶのは、他人が用意した戻りの URL を踏まされて、その人のアカウントでログインさせられるのを防ぐため(ドライブの繋ぎは利用者の ID を state に署名しているが、ログインの前には利用者がいない)
- 戻り先(`<公開 URL>/api/v1/session/google/callback`)を、GCP のクライアントの「承認済みのリダイレクト URI」に足す(ドライブの戻り先とは別の URL。runbook §6)
- 結ぶ・外すはアカウントの画面から(下の「結ぶ・外す」)
- Google で入る人には、Workspace 側の 2 段階認証が効く(管理コンソールで必須にしておく。06 §3)

### Microsoft でログイン(2026-10-02。01 D-14)

- Microsoft の ID プラットフォーム(Entra ID)の OpenID Connect。仕組みは Google と同じ(`app/auth/oidc.py`。認可コード + PKCE、state・nonce、署名した Cookie、ID トークンの確かめ)。違うところだけを書く
- **入れるのは、個人の Microsoft アカウントと、職場・学校のアカウント**(テナント `common`。`WORKS_MICROSOFT_TENANT` で `organizations`・`consumers`・テナントの ID に絞れる)。アプリ登録の「サポートされているアカウントの種類」は「Any Entra ID Tenant + Personal Microsoft accounts」(runbook §6c)
- スコープは `openid email profile`(`profile` は、アドレスの無い職場のアカウントでもサインインの名前を表示に出すため)。戻りは `response_mode=query`(GET で戻すので、SameSite=Lax の Cookie が届く)
- **ID トークンの発行元**: `common` の discovery document は、発行元を `https://login.microsoftonline.com/{tenantid}/v2.0` の型で載せる。ID トークンの `tid`(入った人のテナント)を当てはめたものと `iss` が同じであること。`aud` はアプリ(クライアント)の ID
- **利用者との結び付けは Microsoft の `sub`**(Works のアプリ登録に固有の、変わらない ID。§13)。`email` は「確かめられていない・変わる」と Microsoft が書いているので、**初めてのときにアドレスから利用者を探すのは、ドメインの持ち主が確かめたアドレス(省略できる claim の `xms_edov` が真)のときだけ**。アプリ登録の「トークン構成」で、ID トークンに `email` と `xms_edov` を足しておく(runbook §6c)。確かめられないアドレスの人は、ほかの方法で Works に入り、アカウントの画面で結ぶ(結ぶときはログイン中の本人なので、アドレスを確かめなくてよい)
- **6 桁(TOTP)を重ねる。**Microsoft で確かめたら、セッションは作らず、パスワードのときと同じ 2 段目の札を置いてログインの画面(`/login?continue=microsoft&next=…`)へ戻す。画面は `GET /session/challenge` で札を読み直して 6 桁の段(まだの人は設定の段)を出し、`POST /session/totp` が通ったらセッションを作る(`method` は `microsoft`)
- **クライアントの証明は証明書**(OpenID Connect の `private_key_jwt`)。Microsoft は、client secret を本番で使わないよう求めている(§13)。Works は証明書の秘密鍵で、PS256・`x5t#S256`(証明書の SHA-256 の指紋)・`aud` = トークンの口・5 分の JWT を作って添える。証明書は手元で作り(`openssl req -x509 … -noenc`)、公開する側(証明書)だけを Entra に上げる。秘密鍵と証明書は、PEM を続けて base64 で 1 行にして `.env` の `WORKS_MICROSOFT_CERTIFICATE` に置く(runbook §6c)
- 起動のときに確かめる: ID と証明書が片方だけ・証明書が読めない・秘密鍵と証明書が対になっていない → api は起動しない(ボタンが出ているのに入れない、を作らない)。期限が 30 日を切ったらログインのたびではなく起動のときに知らせる(証明書の期限は作り直して Entra に上げ直す)
- 戻り先(`<公開 URL>/api/v1/session/microsoft/callback`)を、アプリ登録の「Web」のリダイレクト URI に入れる

### 結ぶ・外す(アカウントの画面から)

- 結ぶ: `POST /api/v1/account/identities/{google,microsoft}` が許可の画面の URL を返し、画面はページごとそこへ移る(書き込みなので POST にし、`Origin` を確かめる。GET のリンクだと、よそのサイトから結ぶ流れを始めさせられる)。**10 分以内のログインが要る**(入る手段を足すことなので、盗まれたセッションから他人のアカウントを結ばせない)。どのアカウントを結ぶかを選ばせる(`prompt=select_account`)
- 戻りはログインと同じ口(`/session/{provider}/callback`。Cookie に結ぶ相手がいれば結ぶ)。**戻ったときに、始めた人と同じ人がまだログインしていること**(ログアウトした・別の人で入り直した → 結ばない)。ほかの人に結ばれたアカウントは結べない(`{provider}_in_use`)。結べたら `/account?linked=…`、だめなら `/account?link_error=…`
- 外す: `DELETE /api/v1/account/identities/{provider}`。ほかに入る手段(パスワードか、もう一方)が残るときだけ(`last_login_method`)

### パスワード・2 段階認証を変える・忘れたとき、利用者を足す

- 変えるには、いまのパスワードか、**10 分以内にログインしたこと**(パスワード + TOTP、Google、Microsoft + TOTP のどれか)が要る。忘れたら Google か Microsoft で入り直し、10 分のうちにアカウントの画面で決め直す。2 段階認証のやり直しと、端末を無くしたときは上の「2 段階認証」
- 管理者は `python -m app.cli set-password <メール>` で決められる(標準入力から読む。画面にもログにも出さない)。その人のセッションと許可はすべて切れる
- **メールでの再設定は持たない**(Works にはメールを送る仕組みが無い。人が増えたら考える)
- 利用者を足すのは管理者だけ(`python -m app.cli add-user`。画面は J-038)。**名乗り出て登録する口は作らない**。足した人は、Google か Microsoft(確かめられたアドレスのとき)で入るか、`set-password` で決めた最初のパスワードで入って変える

### Android アプリのログイン(サーバ側。アプリ側は 09)

- RFC 8252(ネイティブアプリの OAuth)に従う。**ログインの画面はアプリの中に作らず、ブラウザで Works の `/login` を開く**(パスワードも Google も Microsoft も、Web と同じ 1 枚で済む)。埋め込みの WebView は使わない(RFC 8252 が禁じ、Google も WebView の中のログインを断る)
- 開き方は **Auth Tab**(Chrome 137 以降。androidx.browser 1.9.0 で安定版)。Auth Tab の無いブラウザでは、自動で Custom Tabs に落ちる
- クライアントは初めから入れてある公開クライアント `works-android`(動的登録ではない)。PKCE(S256)は必須。スコープは `api`
- **戻り先は https**(`<公開 URL>/app/oauth/callback`)。Works が `/.well-known/assetlinks.json`(Digital Asset Links)で「この URL を受けてよいのは Works のアプリ(パッケージ名と署名の指紋)」と示し、Chrome と Android がそれを確かめる。値は `.env`(`WORKS_ANDROID_PACKAGE`・`WORKS_ANDROID_CERT_SHA256`)から api が返す(Caddy が api へ流す道に足す)
- 戻り先の持ち主を確かめられるので、**許可のカードを出さない**。RFC 8252 §8.6 は「クライアントを確かめられないなら自動で許可しない」としていて、https の戻り先はその確かめに当たる。ログインが通れば、そのままアプリへ戻す
- あとは Claude のコネクタと同じ(access 1 時間、refresh 90 日で使うたびに替わる)。refresh は同時に 1 本だけ走らせる(2 本走ると後の 1 本が `invalid_grant` になり、ログアウトしたように見える。J-043 の refresh の件も参照)
- ログアウトは `/revoke` で許可ごと消す。アカウントの画面からも切れる

### 経緯

- 2026-09-22: 外側の門を Cloudflare Access に決めた(Q-035)。IdP は One-time PIN と Google Workspace(Q-039)
- 2026-09-24: アプリは Access の JWT(`Cf-Access-Jwt-Assertion`)を確かめ、そのメールアドレスで利用者を決める形にした(J-023)。当時は、A 案「アプリが自分で認証する。どこへ引っ越しても同じ」と、B 案「Access を信頼する。楽だが Cloudflare の外では成り立たない」を比べ、本人が B を選んだ
- 2026-10-01: Android のネイティブアプリ(01 D-15)を作るにあたり、A 案に切り替えた(01 D-14)。自前のログインは J-053 でコードに入れた(`dev` は消し、`access` は残した)。本番をアプリのログインに切り替え、`app/access.py` と `WORKS_AUTH` を消すのは J-055(06 §3)
- 2026-10-01(同日): 2 段階認証は TOTP で、パスワードで入るときは必須と決めた(Q-048)。Google で入れるのが Workspace のアカウントだけなこと、既定値(セッション 30 日・メールでの再設定を持たない・Android アプリに許可のカードを出さない)も本人が了承
- 2026-10-01(同日): Access は外さず、門として残すと見直した(本人。「Surface で稼働させている以上 Access は必要。ログインとセッションはシステム側に」)。Android アプリは Cloudflare WARP で門を通る(本人の意向)。J-055 は「Access の撤去」から「本番をアプリのログインに切り替える」に変えた
- 2026-10-01(同日、2 度目の見直し): **Access を外す(素通しにする)と決めた**(本人。「Access を素通りにし、ログインやセッション管理は全面的にシステム側に。スマホアプリや AI エージェントなどからのリクエストも届くように」)。`WORKS_AUTH` と `app/access.py` を消し、ログインの前に届く口の守りを足した(上の「門を置かずに守る」)。WARP(J-057)は要らなくなった。本番で Access を外すのは J-055
- 2026-10-02: **Google アカウントと Microsoft アカウントでもログインできるようにした**(本人。J-054)。Google は決めてあった形のまま作った。Microsoft は個人と職場・学校の両方を受け、6 桁を重ね、アドレスは `xms_edov` のときだけ信じ、クライアントの証明は証明書にした(上の「Microsoft でログイン」。01 D-14)

## 6. MCP サーバ(ローンチ後・J-028)

**2026-09-24 に作った**(J-028)。本人の要望: 「Google スライドなどのカスタム MCP と同じく、Claude のアプリで 1 回設定したら、同じ Claude を使うほかの端末でも使えるようにしたい」。

- **繋ぎ方の本筋は Claude のカスタムコネクタ(リモート MCP + OAuth)。**Claude の設定 › コネクタで URL(`https://works.sanei-clover.com/mcp`)を 1 回足して許可すれば、Claude.ai の Web・デスクトップ・スマホ・Claude Code(claude.ai のコネクタとして)のどれでも使える。コネクタはアカウントに付き、端末ごとの設定が要らないため。一次資料: Claude のコネクタの認証の説明(https://claude.com/docs/connectors/building/authentication、2026-09-24 確認)。「Claude.ai・Desktop・モバイル・Claude Code・Cowork は同じ仕組みを使う」
- **Claude のサーバが Works を叩く。**手前に門は無いので、MCP と OAuth の口にそのまま届く(§5「門を置かずに守る」)。Access を門にしていた頃(2026-09-24〜10-01)は、カスタムコネクタが Access のサービストークンのヘッダを送れない(送れるヘッダ名は Anthropic の承認制)ため、Anthropic の送信元(`160.79.104.0/21`)からだけ機械向けの口を素通しにしていた(06 §7)
- **Works 自身が OAuth 2.1 の認可サーバになる**(公式 Python SDK `mcp` 2.x の認可サーバの部品を使う。`backend/app/mcpserver/`)。動的登録(RFC 7591)、PKCE S256、refresh token は使うたびに替える、`invalid_grant`、form-urlencoded の `/token`、401 の `WWW-Authenticate` に資源のメタデータ(RFC 9728)。**人の許可は Works にログインした画面(`/oauth/consent`)**で行い、許可した人が MCP の利用者になる
- **登録できる戻り先は Claude だけ**(`https://claude.ai/api/mcp/auth_callback` と、Claude Code の loopback `http://localhost|127.0.0.1:<任意>/callback`)。知らないアプリに許可の画面を踏ませて鍵を渡すのを防ぐ。Android アプリは動的登録ではなく、初めから入れてあるクライアント(§5)。だれでも叩けるので、許可の無い登録と許可を待つ依頼は 50 件までしか残さない(§5「門を置かずに守る」)
- 環境設定で発行したトークン(`wks_`。04 §10)も `/mcp` で使える。Codex など、ヘッダを自分で付けるアプリのため(門が無いので、このトークンだけで届く)。ほかの AI のアプリ(ChatGPT など)を OAuth で繋ぐには、その戻り先を許すかどうかを決めてから足す
- ツールは 6 つ: `list_tables`・`search`・`list_records`・`get_record`(時系列も)・`create_record`・`update_record`。**画面と同じ関数を呼ぶ**(検証、既定値、業務ルール、繰り返し、言及)。DB を直接触らせない。**削除のツールは持たない**(会話の中では「元に戻す」に気づきにくい)。環境設定(テーブル定義など)も MCP からは変えない
- 状態を持たない形(stateless HTTP + JSON の応答)。1 プロセス・利用者 1〜3 名の前提。プロトコルは SDK が最新版(2026-07-28)と 1 つ前(2025-11-25)の両方を受ける(`backend/tests/test_mcp.py`)

## 7. サイドバーの AI チャット(ローンチ後・J-029)

Notion AI や Twenty のように、サイドバーをチャット欄に切り替えられるようにする。
**LLM は差し替えられる前提で組む**(Amazon Bedrock でも、個人の Claude API キーでも使える。01 D-11)。

```
画面のチャット欄 ──SSE──▶ api: /api/v1/chat ──▶ LLM プロバイダ(差し替え可能)──▶ Claude
                                   │ ツール呼び出し
                                   ▼
                          コマンド層(画面・MCP と同じ)──▶ db
```

- **鍵はサーバ側だけが持つ。**ブラウザから LLM を直接呼ばない。設定は環境変数(`.env`)
- **差し替えの単位は「クライアントの作り方」と「モデル ID」だけにする。**公式の Python SDK(`anthropic`)は、直接の API 用の `Anthropic()` と Bedrock 用の `AnthropicBedrockMantle(aws_region=…)` を持ち、作ったあとの呼び方(`messages.create` / `.stream`)は同じ。Bedrock のモデル ID は `anthropic.` が前に付く(例 `anthropic.claude-opus-5`)。認証は、直接なら API キー、Bedrock なら AWS の認証情報
- **両方で使える機能だけに寄せる。**メッセージ、ストリーミング、自前のツール呼び出し、プロンプトキャッシュ、適応的思考は両方で使える。Anthropic 側で動くツール(Web 検索、コード実行)、MCP コネクタ、Files API、サーバ側フォールバックは Bedrock に無い。CRM のチャットに要るのは自前のツール(レコードの検索・作成・更新)だけなので、困らない
- ツールの中身は MCP(§6)と共有する。「外から MCP で呼ぶ」「中からチャットが呼ぶ」の違いは入口だけ
- 既定のモデルは `claude-opus-5`。費用を抑えたい操作に軽いモデルを使うかは、作るときに実測して決める
- Claude 以外(他社のモデル)まで差し替え対象にするかは未決 → **Q-041**。する場合は、この層の上にもう 1 段の抽象が要る

出典: Anthropic 公式の `claude-api` skill(2026-09-21 参照。プロバイダ別の機能表とクライアントの作り方)。

## 8. 親子レコードと、利用者が組む画面(検討・Q-043)

本人の問い(2026-09-22): 見積と明細のように、親子が揃って初めて 1 つの意味を持つデータ(Salesforce の主従関係)を、個別の画面を作らずに、利用者側のカスタマイズ(LWC やフローに当たるもの)で扱えるようにしたい。作るのは難しいか。

**答え: 3 段に分けると、①と②は難しくない。③は作れるが持ち続けるのが重く、この製品では持たない方針を勧める。**

| 段 | 中身 | 難しさ | 作り方 |
|---|---|---|---|
| ① 主従関係 | 子は親なしに存在しない。親を消せば子も消える。子の合計を親へ集計する。親子を **1 回の保存**で書く | 低(数日) | `relation` に `master_detail: true` を足す。保存 API に `children` を受ける形(`POST /objects/quotes/records` の本文に `{ …, children: { quote_lines: [...] } }`)を足し、1 トランザクションで書く。集計は `rollup`(親の項目定義に「子テーブル・列・関数」を書く)をサーバが更新時に計算する。既存の仕組み(メタデータ・業務ルール)の延長 |
| ② 親子を同時に作る画面 | 見積ヘッダ + 明細の表を 1 画面で入力する | 中(1〜2 週間) | **個別の画面は作らない。**「主従の子を、親のパネルの中で表として編集する」汎用の部品を 1 つ作る。行の追加・削除・並べ替え・列ごとの入力欄は既存の `FieldEditor` で描ける。見積・請求・発注のどれも、テーブル定義だけでこの部品が使える |
| ③ 利用者がロジックと画面を組む(LWC・フロー) | 条件分岐、計算、独自の画面配置を、利用者が定義する | 高(作るより**持ち続ける**のが重い) | 独自の DSL か低コードの実行系が要り、版を上げるたびに互換性を背負う。ソロ開発で最も割に合わない部分 |

方針の提案:

1. **①と②を汎用に作る。**「メタデータで表せる範囲」を広げることで汎用性を出す(01 D-01 の延長)。親子は `master_detail` と `rollup` の 2 つの定義で足りる
2. **③の DSL は持たない。**代わりに 2 つで受ける。(a) 画面の見え方は**ビューの定義**(J-034 で画面から編集できるようにする。列・並び・絞り込み・カンバン・レポートの部品)。(b) 手順や条件のある処理は **AI チャット + MCP**(J-028・J-029)に自然文で頼む。「この商談から見積を作って、明細は先月と同じで」のような、フローで組んでいたものは、コマンド層(§6)を呼ぶ AI が担う。**このリポジトリは AI で作る前提なので、必要になった画面は AI に作らせて、成果物をメタデータ(ビュー定義)として保存する**ほうが、利用者に DSL を学ばせるより軽い
3. 順序は、ローンチ → 見積のような最初の主従の要件が出た時点で①②を作る。先に作らない(要件が無いうちに汎用化すると、形が合わない)

決めるべきこと(Q-043): ①②を採るか、③をどこまで持つか。答えが出たら J に落とす。

## 9. 一次資料での確認結果(2026-09-21)

共通ルール「新規に技術選定するときは、その時点で非推奨でないかを確認する」に従い、npm レジストリの `deprecated` フラグと最新版を直接引いた。**採用したものに非推奨は無い。**

| パッケージ | 版 | 用途 |
|---|---|---|
| vite / @vitejs/plugin-react | 8.3.0 / 6.1.1 | ビルド(公式テンプレート `react-ts` が元) |
| typescript | 6.0.3 | 公式テンプレートの指定(`~6.0`) |
| react / react-dom | 19.3.0 | |
| react-router | 8.4.0 | 宣言的なルーティングだけを使う(`BrowserRouter` / `Routes`) |
| @tanstack/react-query | 5.103.1 | 取得のキャッシュと楽観更新 |
| zustand | 5.0.15 | 画面の状態 |
| @dnd-kit/react | 0.5.0 | カンバンのドラッグ&ドロップ |
| @dnd-kit/dom | 0.5.0 | 上の土台(`@dnd-kit/react` が既に入れている)。センサーの設定を import するため直接の依存にした(`lib/dnd.ts`) |
| lucide-react | 1.47.0 | アイコン(使うものだけ束ねる) |
| tailwindcss / @tailwindcss/vite | 4.3.3 | |
| @fontsource-variable/figtree | 5.3.0 | 欧文と数字の書体(同梱) |
| oxlint | 1.83.0 | 公式テンプレートの lint |
| playwright-core | 1.63.0 | E2E(ブラウザは別途) |
| @tiptap/react / starter-kit / core / pm / extensions / extension-mention / suggestion | 3.31.3(2026-09-22 確認。`deprecated` 無し、2026-09-04 更新) | 書式付きの文字(richtext)の入力欄。StarterKit にリンクと下線が含まれる(v3)。Placeholder は `@tiptap/extensions`、`@` の言及は `extension-mention` + `suggestion`。エディタは別ファイルで、書き始めるときに読む |

判断を要したもの:

- **ドラッグ&ドロップ**: 従来の `@dnd-kit/core`(6.3.1)は非推奨ではないが、最終更新が 2024-12 で止まっている。同じ作者の後継 `@dnd-kit/react` は 0.5.0 と若いが 2026-09 も更新が続く。止まっているほうを新規に採ると次に非推奨になるのはそちらなので、後継を採った。1.0 前なので、上げるときは E2E のドラッグの項目で確かめる。`@dnd-kit/dom` は `@dnd-kit/react` と同じ版に揃える。**既定のセンサーは「200ms 押し続けたら動かさなくてもドラッグ開始」で、クリックで開く行・カードが開かなくなる**。そういう部品には `lib/dnd.ts` の `clickableSensors`(マウスは 5px 動かしたときだけ)を渡す
- **ダイアログやポップオーバーの部品ライブラリは入れていない。**モーダルはブラウザ標準の `<dialog>`(フォーカスの閉じ込めと背後の無効化を標準に任せる)、ポップオーバーは自前の小さな部品。束ねる JS を増やさないため
- **書式付きの文字のエディタ**: 自前の `contenteditable` + `document.execCommand` は、`execCommand` が非推奨なので採らない。Tiptap(ProseMirror)は現行版(3.x)が 2026-09 も更新中で非推奨の印が無い。表示側はエディタを使わず、許した要素だけを残す小さな洗浄(`lib/richtext.ts`)で描く(DOMPurify を足さないため。サーバも保存前に同じ規則で洗うこと)
- **グラフのライブラリも入れていない。**棒グラフ 2 種と数字タイルだけなので、HTML と CSS で描いている(`dataviz` の仕様どおりに作るのにも、そのほうが素直)

コンテナのイメージ(Docker Hub の現行タグ): `node:24-alpine`(Active LTS。ビルド用)、`caddy:2.11.4-alpine`、`cloudflare/cloudflared:2026.9.1`、`postgres:18.6-alpine`。`latest` は使わない。

## 10. 一次資料での確認結果(バックエンド・2026-09-23)

Q-034 を決めた時点で、共通ルール「採用を決めたら、その時点で非推奨でないことを一次資料で確認する」に従い、PyPI の JSON API から最新版・公開日・`yanked` を直接引いた。**採用したものに非推奨は無い。**

| パッケージ | 版 | 最終公開 | 用途 |
|---|---|---|---|
| fastapi | 0.141.1 | 2026-07-29 | HTTP と OpenAPI |
| uvicorn | 0.53.0 | 2026-09-14 | ASGI サーバ |
| SQLAlchemy | 2.0.54 | 2026-09-15 | **Core 中心**(ORM のモデルは書かない。02 §5 のメタデータから SQL を組む) |
| alembic | 1.20.0 | 2026-09-11 | 「初めからあるテーブル」のマイグレーションだけ(§4・02 §4) |
| pydantic / pydantic-settings | 2.13.5 / 2.15.0 | 2026-08-28 / 2026-08-07 | 入出力の検証、環境変数の読み取り |
| psycopg | 3.3.6 | 2026-09-18 | PostgreSQL のドライバ |
| nh3 | 0.3.7 | 2026-08-23 | richtext の洗浄(04 §1)。**`bleach` は非推奨なので使わない** |
| mcp | 2.2.0 | 2026-09-07 | MCP サーバと OAuth の認可サーバの部品(§6。2026-09-24 に足した。PyPI で Production/Stable、`yanked` 無し。`FastMCP` は 2.x で `MCPServer` に改名済み) |
| PyJWT | 2.15.0 | 2026-09-23 | Access の JWT の検証(§5。2026-09-24 に足した。PyPI で `yanked` 無し、非推奨の表示無し。暗号は既に入っている cryptography を使う) |
| python-multipart | 0.0.32 | 2026-06-04 | Web フォームの受け口(form-urlencoded。04 §10) |
| pytest / pytest-asyncio | 9.1.1 / 1.4.0 | 2026-06-19 / 2026-05-26 | テスト |
| httpx2 | 2.13.0 | 2026-09-14 | **Google の API を叩く**(04 §8)ことと、テストから ASGI 越しに HTTP 層ごと叩くこと。**`httpx`(0.28.1)は使わない** — starlette 1.6.0 が「`httpx` と一緒に使うのは非推奨。`httpx2` を入れること」と警告する(2026-09-23 に実物の出力で確認) |
| cryptography | 50.0.1 | 2026-09-23 確認 | 繋いだ Google の鍵を暗号化して DB に置く(`app/google/store.py`)。Fernet の鍵は `WORKS_SECRET_KEY` から導く |
| ruff | 0.16.8 | 2026-09-16 | lint と整形(画面側の oxlint に当たる) |
| mypy | 2.3.1 | 2026-08-15 | 型検査(画面側の `tsc` に当たる) |
| uv | 0.12.18 | 2026-09-22 | パッケージ管理と仮想環境 |

ローンチ後に足すもの(着手時に引き直す): `mcp` 2.2.0(J-028)、`anthropic` 1.8.0(J-029)。

**同期で書く**(2026-09-23 の決めごと)。`async def` は使わず、SQLAlchemy も psycopg も同期のまま使う。理由は、
①この API の芯は動的に組む SQL と実行時 DDL で、同期のほうが素直に書けて情報も多い
②利用者 1〜3 名・レコード 1,000 件の規模では、非同期にしても体感が変わらない
③FastAPI は同期の関数をスレッドプールで動かすので、あとで SSE(J-029)だけを `async def` にして混在させられる。

## 11. ワークフローの送り係(2026-09-30)

ワークフロー(01 D-13、04 §15)の「アクションを動かす」は、レコードを書く要求の中ではしない。**書き込みと同じトランザクションで実行記録(送信待ち)を入れ、確定したものだけを送り係が拾って動かす**(トランザクショナル・アウトボックス)。

```
画面・MCP・Web フォーム・CSV・繰り返しの次回
  └ records/service.py の insert / update ── workflows/engine.py: 動かすワークフローを決める
                                              └ workflow_runs に queued を入れる ─┐ 同じトランザクション
                                                                                    │ 確定(commit)の瞬間に送り係を起こす
                                                                                    ▼ 起こし損ねても 10 秒ごとに見回る
                                    送り係(api のプロセスの中の 1 本のスレッド。workflows/runner.py)
                                      └ for update skip locked で取り出す → アクションを動かす → 結果を書く
                                                                                    ▼
                                                                  Slack(Incoming Webhook)
```

- **取り消された書き込みは送らない**(実行記録ごと巻き戻る)。**確定した書き込みは必ず 1 回は送る**(送った直後に落ちた行は、2 分後にもう一度送る。取りこぼすより二重に届くほうを取る)
- **書き込みを外のサービスの応答待ちにしない。**Slack が遅くても、画面も Web フォームの送り手も待たない
- **ワークフローの側で何が起きても、レコードの書き込みは止めない。**判定と実行記録の作成は SAVEPOINT で囲み、失敗はログ(`works.workflows`)に残して捨てる
- 一時的な失敗(429・5xx・繋がらない)は 30 秒・2 分・8 分・30 分と間を空け、5 回目でも駄目なら失敗。同じチャンネルへは 1.1 秒あける(Incoming Webhook は毎秒 1 件)
- 動かす直前にワークフローを見て、オフ・削除なら見送る(大量に動いてしまったとき、オフにすれば残りは止まる)
- 起こし方: 実行記録を入れたトランザクションの接続に印を付け(`conn.info`)、エンジンの `commit` の出来事で送り係を起こす。取り消し(`rollback`)なら印を捨てる。PostgreSQL の `LISTEN/NOTIFY` にしなかったのは、1 プロセスなのでスレッドを起こすだけで足り、接続を 1 本張り続ける作りが要らないため
- 1 プロセスの前提(利用者 1〜3 名。uvicorn は 1 ワーカー)。プロセスを増やしても `skip locked` で同じ行は取り合わないが、同じチャンネルの 1 秒の間隔はプロセスごとにしか守れない
- テストは送り係を起こさない(`WORKS_WORKFLOW_RUNNER=false`)。`runner.run_due()` を直に呼んで送る
- leadcast-sales の通知(台帳 `notification_deliveries` + SQS + Lambda)と同じ考え方を、1 プロセスの規模に落とした

## 12. Android アプリ(2026-10-01。01 D-15)

**アプリの決定と仕様は 1 枚にまとめた: [09-android.md](09-android.md)**(本人の要望)。ここには、サーバ側で関わることだけを置く。

- 置き場は `android/`。契約は `/api/v1`(04)のまま。**契約を変えたら、型・モック・`http.ts`・04 に加えて `android/` も同じコミットで揃える**(`android/` ができたら CLAUDE.md の決まりに足す)
- ログイン: §5「Android アプリのログイン」(公開クライアント `works-android`、PKCE、スコープ `api`、許可のカードを出さない)。手前に門は無いので、公開 URL に直に届く(06 §7)
- サーバに足すもの(J-056): `/api/v1` でスコープ `api` の Bearer を受ける(Bearer の要求は `Origin` を見ない)、`works-android` の登録、`/.well-known/assetlinks.json`

## 13. 一次資料での確認結果(ログインと Android・2026-10-01。Google・Microsoft でログインは 2026-10-02)

共通ルールに従い、採るもの・採らないものを一次資料で確かめた(2026-10-01。公式の頁を直に取得)。
Zero Trust の料金・Cloudflare One Agent・Split Tunnels・Android の VPN・Managed OAuth の行は、スマホを WARP で門に通す案のために確かめたもの。同じ日に Access を外すと決めたので使わないが、記録として残す。

| もの | 確かめたこと | 出典 |
|---|---|---|
| NIST SP 800-63B-4 | 2025-07-31 に確定版。パスワードだけで入るなら 15 文字以上(二段階目の一部なら 8 文字以上)、64 文字以上を受ける(SHOULD)、文字の種類の縛りは禁止、漏えいした一覧との照合は必須(全体で照らす)、同じアカウントの続けての失敗は 100 回まで | https://pages.nist.gov/800-63-4/sp800-63b.html |
| NIST SP 800-63B-4(OTP とセッション) | TOTP の有効期間は時計のずれ・通信の遅れ・打つ時間から決める。同じ OTP は有効な間に 1 回しか受けない(SHALL)。続けての失敗の間引きは必須。秘密は 112 ビット以上、6 桁まで切り詰めてよい、秘密は使う部品だけが触れるように守る(§3.1.5)。AAL2 の入り直しは 24 時間以内・使わない時間は 1 時間以内を勧める(SHOULD。§2.2.2。Works は 30 日を取る) | https://pages.nist.gov/800-63-4/sp800-63b.html |
| RFC 6238(TOTP) | 刻みの既定は 30 秒。通信の遅れとして認めるのは 1 刻みまでを勧める。1 回通ったコードの 2 回目を受けてはいけない(§5.2)。既定の HMAC は SHA-1(SHA-256・512 も可) | https://www.rfc-editor.org/rfc/rfc6238 |
| pyotp(採る) | 2.10.0(2026-06-14)。Production/Stable、依存なし、リポジトリは 2026-06 もコミットがある。`random_base32()` は 160 ビットの秘密 | https://pypi.org/project/pyotp/ |
| segno(採る) | 1.6.6(2025-03-12)。Production/Stable、依存なしの QR の生成。リポジトリは 2026-07 もコミットがある | https://pypi.org/project/segno/ |
| OWASP Password Storage Cheat Sheet | Argon2id の最小は 19 MiB・2 回・並列 1 | https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html |
| argon2-cffi(採る) | 25.1.0(2025-06-03)。Production/Stable、Python 3.13・3.14 対応。リポジトリは 2026-09 もコミットがある。`PasswordHasher` の既定は RFC 9106 の低メモリの組(t=3・m=64 MiB・p=4)、`check_needs_rehash` あり | https://pypi.org/project/argon2-cffi/ |
| passlib(採らない) | 最後の版が 1.7.4(2020-10-08)。Python 3.13 では `crypt` が消えた。bcrypt 5.0.0 と組むと、起動時の自己診断が 72 バイトを超える値を渡して `ValueError` で落ちる(手元で再現)。FastAPI の手引きは `pwdlib` + Argon2 を勧めている。Argon2 を 1 つ使うだけなので、その下の `argon2-cffi` を直に使う | https://pypi.org/project/passlib/ 、https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/ |
| Google OpenID Connect | `iss` は `https://accounts.google.com` か `accounts.google.com`、`aud` はクライアント ID、期限を確かめる。利用者の ID には `sub` を使い、メールアドレスを使わない | https://developers.google.com/identity/openid-connect/openid-connect |
| Google の「内部」 | 組織のメンバーだけが許可でき、ほかは `org_internal`。審査は要らない | https://support.google.com/cloud/answer/15549945 |
| Google の WebView の禁止 | 開発者が操れる埋め込みの user-agent で、Google の OAuth を開いてはいけない(`disallowed_useragent`) | https://developers.google.com/identity/protocols/oauth2/policies |
| RFC 8252 | ネイティブアプリの OAuth は外のブラウザで。PKCE は必須。戻り先は private-use scheme・https・loopback の 3 つで、https を優先する(SHOULD)。確かめられないクライアントは自動で許可しない(§8.6) | https://www.rfc-editor.org/rfc/rfc8252 |
| Auth Tab(androidx.browser。採る) | Chrome 137 以降。戻り先は独自の scheme か https(Digital Asset Links の確かめが必須。http は不可)。無いブラウザでは Custom Tabs に落ちる。1.9.0 が 2025-07-30 に安定版、最新は 1.10.0(2026-03-25)。Chrome の手引きは今も「alpha」と書いているが、リリースノートのほうが新しい | https://developer.chrome.com/docs/android/custom-tabs/guide-auth-tab 、https://developer.android.com/jetpack/androidx/releases/browser |
| Google Sign-In for Android(採らない) | 非推奨を経て、2026-08-26 の play-services-auth 22.0.0 で API が消えた。後継は Credential Manager | https://developers.google.com/android/guides/releases |
| AppAuth-Android(採らない) | 最後の版が 0.11.1(2021-12-22) | https://github.com/openid/AppAuth-Android |
| androidx.security:security-crypto(採らない) | 1.1.0-alpha07(2025-04-09)で全 API が非推奨。「プラットフォームの API と Android Keystore を直に使うこと」 | https://developer.android.com/jetpack/androidx/releases/security |
| Cloudflare の率の上限 | 無料で 1 本。数えるのは IP ごと、期間 10 秒、遮る時間 10 秒、条件に使えるのはパスと Verified Bot だけ(メソッドは Business 以上) | https://developers.cloudflare.com/waf/rate-limiting-rules/ |
| Cookie の `__Host-` | `Secure`、https から置く、`Domain` なし、`Path=/` が要る | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie |
| Have I Been Pwned の Pwned Passwords | 無料・キー不要・率の上限なし。送るのは SHA-1 の先頭 5 文字だけ。`User-Agent` が無いと 403 | https://haveibeenpwned.com/API/v3#PwnedPasswords |
| Cloudflare Turnstile | 無料。サーバから siteverify で確かめる(Web フォームにスパムが来たら足す。06 §7) | https://developers.cloudflare.com/turnstile/ |
| Cloudflare Zero Trust の料金(2026-10-01 確認) | Free は 50 人まで $0(Access・Gateway・端末用アプリ・自己登録・Split Tunnels を含む。ログの保持は 24 時間)。登録時に支払い情報は要るが請求されない。Pay-as-you-go は 1 人月 $7。数えるのは Access のアプリに入った人と、端末を登録した人 | https://www.cloudflare.com/plans/zero-trust-services/ 、https://developers.cloudflare.com/cloudflare-one/faq/getting-started-faq/ |
| Cloudflare One Agent(旧 WARP。Android) | Zero Trust の端末用アプリは「Cloudflare One Agent」(`com.cloudflare.cloudflareoneagent`)。一般向けの 1.1.1.1 + WARP は Zero Trust にはもう使えない。Android の動きのモードは Traffic and DNS(既定)・DNS only・Posture only で、通信を運ぶのは Traffic and DNS だけ。Gateway は方針を作らなければ全部許す | https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/download/ 、…/configure/modes/ |
| Authenticate with Cloudflare One Client(旧 WARP authentication identity) | **ベータ。**端末のアプリのセッションが生きている間は、Access の IdP のログインを求めない(最大 90 日)。Allow / Block の方針のアプリだけ、Binding Cookie と併用できない、1 端末 1 人。ブラウザ以外の通信に 302 ではなく 401 を返す設定がある。**公開ホスト名のアプリで、ネイティブアプリの通信が通るかは資料に無い(実機で確かめる。09 §5)。Free での可否も記載なし** | https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/ 、…/configure/client-sessions/ |
| Split Tunnels の Include | 指定した宛先だけを通す(全プラン)。Include にするなら IdP と `<チーム>.cloudflareaccess.com` と、守るアプリも入れる。スマホはトンネルを張ったときにだけ反映し、ドメインより IP の指定を勧める。Cloudflare の配下のドメインは IP を共有するので、ほかのホスト名も一緒に通ることがある | https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/configure/route-traffic/split-tunnels/ |
| Android の VPN | 常時接続の VPN は Android 7.0 から。VPN は利用者ごとに同時に 1 本だけ(新しく始めると前のものは止まる) | https://developer.android.com/develop/connectivity/vpn |
| Access の Managed OAuth(WARP の代わりの候補) | 2026-03 に追加。ブラウザ以外の口(CLI・SDK など)が OAuth 2.0 の認可コードで Access を通る。RFC 8707 に対応した OAuth クライアントが要る | https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/ |
| Google の「持ち主と言えるアドレス」(2026-10-02 確認) | Google が持ち主だと言えるのは、`@gmail.com` のアドレスと、`email_verified` が真で `hd` がある(Workspace の)アドレスだけ。ほかのアドレスは、アカウントを作ったときに確かめただけで、今の持ち主かは分からない。Workspace の利用者かは、アドレスのドメインではなく `hd` で見る | https://developers.google.com/identity/gsi/web/guides/verify-google-id-token 、https://developers.google.com/identity/openid-connect/openid-connect |
| Microsoft の ID トークン(2026-10-02 確認) | `sub` は変わらず、使い回されず、**アプリ(クライアント ID)ごとに違う値**(pairwise)。利用者の鍵には `sub` か `oid` を使う。`email` は「正しいとは限らず、変わる。認可にもデータの鍵にも使うな」、`preferred_username` も変わるので認可に使わない。個人のアカウントの `tid` は `9188040d-6c67-4c5b-b112-36a304b66dad`。署名・`iat`/`nbf`/`exp`・`aud`・`nonce` を確かめる | https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference 、https://learn.microsoft.com/en-us/entra/identity-platform/id-tokens |
| Microsoft の `xms_edov`(省略できる claim) | 「メールアドレスのドメインの持ち主が確かめたか」の真偽。`email` があるときだけ入る。アプリ登録の「トークン構成」で足す | https://learn.microsoft.com/en-us/entra/identity-platform/optional-claims-reference |
| Microsoft の OpenID Connect と認可コード | テナントは `common`(個人 + 職場・学校)・`organizations`・`consumers`・テナントの ID。discovery document は `https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration`。PKCE は「公開・機密のどちらのクライアントにも勧める」。コードだけを受けるなら `response_mode=query` が使える。`prompt=select_account` でアカウントを選ばせる | https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc 、https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow |
| Microsoft のクライアントの証明 | **client secret は「安全性が低いので本番では使うべきでない」**(期限は最長 24 か月)。証明書の資格情報は、ヘッダが `alg` PS256・`typ` JWT・`x5t#S256`(証明書の DER の SHA-256 の指紋を base64url)、本文が `aud`(トークンの口)・`iss` と `sub`(クライアント ID)・`jti`・`nbf`・`iat`・`exp`(5〜10 分) | https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials 、https://learn.microsoft.com/en-us/entra/identity-platform/certificate-credentials |
| Microsoft のアプリ登録 | Entra 管理センター › Entra ID › アプリの登録 › 新規登録。前提は Azure のアカウント(無料で作れ、既定のディレクトリが使える)。サポートされているアカウントの種類「Any Entra ID Tenant + Personal Microsoft accounts」 | https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app |
| ボタンのマーク | Google の「G」は大きさと色を変えず、標準の色のまま白い地に置く。Microsoft のロゴは変えない | https://developers.google.com/identity/branding-guidelines 、https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-branding-in-apps |
| PyJWT(採る) | 2.15.1(2026-09-28)。Production/Stable。ID トークンの署名の確かめ(`PyJWKSet`)と、Microsoft へのクライアントの証明(PS256)。これまでも MCP の SDK の中で入っていたものを、直に使う | https://pypi.org/project/PyJWT/ |
| OpenSSL の `req -nodes`(使わない) | OpenSSL 3.0 で非推奨。代わりは `-noenc`(手元の 3.0.13 の `openssl req -help` でも deprecated と出る) | `man openssl-req` |
