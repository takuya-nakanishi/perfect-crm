# 03 アーキテクチャ

## 1. 全体像

```
ブラウザ / スマホ ──https──▶ Cloudflare(Access で本人確認)──Tunnel──▶ cloudflared ──▶ web(Caddy)
                                                                                        │ 静的ファイル(画面)
                                                                                        │ /api/*(これから)
                                                                                        ▼
Claude Code / Codex ──MCP(これから)──────────────────────────────────────────────▶ api(Python)
                                                                                        │
                                                                                        ▼
                                                                                  db(PostgreSQL 18)
```

**いま動いているのは `web` と `tunnel` だけ**(2026-09-21)。画面はブラウザ内の擬似 DB(モック)で完結している。
`api` は J-021 で足す。`db` は Compose に定義だけあり、`--profile backend` を付けるまで起動しない。

## 2. 構成

| 場所 | 役割 |
|---|---|
| `frontend/` | 画面。Vite + React + TypeScript + Tailwind CSS v4。ビルドすると静的ファイルになる |
| `frontend/Dockerfile` / `Caddyfile` | Node でビルドし、Caddy で配る。SPA の戻し、キャッシュ、CSP などのヘッダ、`/healthz` |
| `backend/` | Python の JSON API。`/api/v1`(04)。中身の地図は `backend/README.md` |
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
| `mocks/` | 擬似 DB。`fixtures/*.json`(DB の行と同じ形)と、絞り込み・並び替え・集計・検索・値の検証・業務ルールを肩代わりする `engine.ts`、テーブル設定を受ける `schema.ts`(02 §5)、CSV の取り込みと書き出しの `csv.ts`(04 §7)、Google ドライブの擬似 `drive.ts`(04 §8) |
| `data/` | TanStack Query の取得と更新。楽観更新はここに集約(`mutations.ts`) |
| `lib/` | 日付、書式、フィルタの評価、タスク追加欄の読み取り、キー操作、パネルの経路(`usePeek.ts`)、テーブル設定の下書き(`tableDraft.ts`)、書式付きの文字の洗浄(`richtext.ts`)、ドライブの値の読み取り(`drive.ts`) |
| `state/ui.ts` | 画面の状態(テーマ、サイドバー、開いているモーダル、トースト) |
| `components/` | `shell/`(外枠・サイドバー・検索・タスク追加)、`object/`(テーブルの画面と 3 種のビュー、グラフ)、`record/`(パネルとぱんくず、項目の表示と編集、活動の時系列 `ActivityTimeline.tsx`、書式付きの文字 `RichText*.tsx`、ドライブの項目 `DriveFilesEditor.tsx`)、`designer/`(テーブル設定と CSV の取り込み。別ファイルに分けて、開いたときに読む)、`ui/`(部品) |
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

## 5. 認証

**外側の門は Cloudflare Access で確定**(2026-09-22。Q-035・Q-039)。Access の IdP は One-time PIN に加えて **Cloudflare の IdP(Google Workspace の SSO)を手で足した**(Cloudflare 自身が Google Workspace でログインできるため。人が増えたら再考)。
**アプリ自身のログインは B 案「Access を信頼する」に決定**(2026-09-24。本人の決定。J-023)。下の表の B のとおり、
api は Access が付ける `Cf-Access-Jwt-Assertion` を確かめて(署名 = チームの公開鍵、`aud` = Access アプリの AUD タグ、`iss` = チーム、期限)、
そのメールアドレスで `users` を引く。実装は `backend/app/access.py` と `app/api/deps.py`。

- **門を通す人は Access のポリシー、Works の利用者は `users`**。Access は通ったが `users` にいない人は 403(`not_registered`)。足すのは `python -m app.cli add-user`(画面は J-038)。人が勝手に増えないよう、初めて来た人を自動で足すことはしない
- **アプリはログイン画面もパスワードも持たない。**画面の `/login` は、門を通れていない(401 `access_required`)・利用者でない(403)ときの案内だけを出す。ログアウトは Access のログアウト(`/cdn-cgi/access/logout`)へ送る
- サービストークン(MCP・Web フォームの送り手。06 §7)の JWT にはメールアドレスが無いので、画面の利用者にはならない(401)。それらは各自のトークンで守る
- **Access の無い手元(E2E、テスト)だけは `WORKS_AUTH=dev`**: メールアドレスだけで入り、署名付きの Cookie を持つ。公開する場所では使わない。既定は `access`
- 設定(`WORKS_ACCESS_TEAM_DOMAIN`・`WORKS_ACCESS_AUD`)は `scripts/cloudflare-tunnel-setup.py` が `.env` に書く。無ければ 503 で、だれも入れない(門を開けたままにしない)
- **引き受けたリスク**: Cloudflare の外(AWS など)へ出すと成り立たない。そのときは A 案を作る(06 §6)

**管理者(2026-09-22)**: 環境設定(テーブルの定義、Web フォーム、MCP のトークン。05 §11)は、利用者の `admin` が真の人だけが開ける。サーバは `/meta/objects`・`/settings/*` の書き込みで 403 を返す(`/meta/views` は誰でも書ける。05 §11)。**ロールや細かい権限の概念はまだ持たない**(印 1 つだけ)。人が増えたときの権限の設計は J-038。

| 案 | 中身 | 向き |
|---|---|---|
| A. アプリが自分で認証する | メール + パスワード、セッション Cookie。Access はその外側の門として残す(二重) | どこへ引っ越しても同じ。Access を外しても守られる |
| B. Access を信頼する | Cloudflare が付ける `Cf-Access-Jwt-Assertion` を検証して利用者を決める。ログイン画面は出さない | 楽。ただし Cloudflare の外(AWS など)へ出すと成り立たない |

引っ越しやすさ(01 D-05)を取るなら A。当面の手軽さなら B。A を作ったうえで「Access の JWT があれば自動でログイン済みにする」という折衷もある。
比べた結果、本人は B を選んだ(上)。A へ移るときは、`deps.py` の `current_user` にパスワードとセッションの経路を足せばよい(画面の `/login` のフォームは dev で既に動いている)。

## 6. MCP サーバ(ローンチ後・J-028)

**2026-09-24 に作った**(J-028)。本人の要望: 「Google スライドなどのカスタム MCP と同じく、Claude のアプリで 1 回設定したら、同じ Claude を使うほかの端末でも使えるようにしたい」。

- **繋ぎ方の本筋は Claude のカスタムコネクタ(リモート MCP + OAuth)。**Claude の設定 › コネクタで URL(`https://works.sanei-clover.com/mcp`)を 1 回足して許可すれば、Claude.ai の Web・デスクトップ・スマホ・Claude Code(claude.ai のコネクタとして)のどれでも使える。コネクタはアカウントに付き、端末ごとの設定が要らないため。一次資料: Claude のコネクタの認証の説明(https://claude.com/docs/connectors/building/authentication、2026-09-24 確認)。「Claude.ai・Desktop・モバイル・Claude Code・Cowork は同じ仕組みを使う」
- **Claude のサーバが Works を叩く。**だから Anthropic の送信元(`160.79.104.0/21`。https://platform.claude.com/docs/en/api/ip-addresses)から、MCP と OAuth の機械向けの口に届く必要がある。Access のサービストークンのヘッダは使えない(カスタムコネクタが送れるヘッダ名は Anthropic の承認制で、固定ヘッダの機能も一部の組織だけのベータ)。Access の扱いは 06 §7(Anthropic の送信元からだけ、機械向けの口を素通しにする。2026-09-24 本人が承認)
- **Works 自身が OAuth 2.1 の認可サーバになる**(公式 Python SDK `mcp` 2.x の認可サーバの部品を使う。`backend/app/mcpserver/`)。動的登録(RFC 7591)、PKCE S256、refresh token は使うたびに替える、`invalid_grant`、form-urlencoded の `/token`、401 の `WWW-Authenticate` に資源のメタデータ(RFC 9728)。**人の許可は Access の内側の画面(`/oauth/consent`)**で行い、許可した人が MCP の利用者になる(03 §5 の B 案と同じく、利用者は Access の JWT で決まる)
- **登録できる戻り先は Claude だけ**(`https://claude.ai/api/mcp/auth_callback` と、Claude Code の loopback `http://localhost|127.0.0.1:<任意>/callback`)。知らないアプリに許可の画面を踏ませて鍵を渡すのを防ぐ
- 環境設定で発行したトークン(`wks_`。04 §10)も `/mcp` で使える。Codex など、ヘッダを自分で付けるアプリのため(こちらは Access のサービストークンも要る。06 §7)
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
