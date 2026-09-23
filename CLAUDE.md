# perfect-crm — 自作 CRM「Works」

## このリポジトリは何か

取引先・取引先責任者・商談・タスクを扱う CRM を、**あり物(GAS・NocoDB・Twenty)を使わず、完全に AI で自作する**(2026-09-21、本人の決定)。
これまでの顧客管理を置き換え、Todoist も廃止するのが到達点。**命は、きれいで「イケてる」画面・使いやすさ・サクサク動く軽快さ。**

設計の正は `docs/design/`(01 要件と決定 → 02 データモデル → 03 アーキテクチャ → 04 API → 05 UI → 06 配置 → 07 移行)。
運用の手順と落とし穴は `docs/runbook/`。問いと作業は `backlog/`(書式は `questions-jobs` skill)。

## 現状(2026-09-21)

**画面のモックが `https://works.sanei-clover.com` で動いている**(WSL2 の Docker → Cloudflare Tunnel → Access)。
データはブラウザ内の擬似 DB。バックエンド(Python)と PostgreSQL は `backend/` にあり、画面を http モードへ切り替えるのはこれから(J-024)。ログインは Cloudflare Access を信頼する(`docs/design/03` §5)。
2026-09-22 に、画面からのテーブルの追加と設定・CSV の取り込みと書き出し・パネルのぱんくず(`docs/design/05` §8、決まりは `02` §5)、活動の時系列・パネルの幅・サイドバーの並べ替え・Google ドライブの項目(同 §9)、ビューの編集(同 §10)、環境設定(テーブル・Web フォーム・MCP。管理者だけ。同 §11)をモックに入れた。次の一手は `backlog/JOBS.md` の先頭。
バックエンドは FastAPI + SQLAlchemy 2(Core)+ Alembic + psycopg 3、パッケージ管理は uv(Q-034 で決定。`docs/design/03` §4・§10、`backend/README.md`)。

- `.env` は直下に 1 つ。値を出力・コミット・外部送出しない(スクリプトも値を表示しない)
- **Docker は WSL2 の中の Docker Engine を使う。Windows 側の Docker Desktop は使わない**
- イメージのタグは固定する。`docker compose down -v` は打たない(ボリュームが消える)
- このリポジトリは公開。個人情報を入れない。モックの会社・人物は架空にする。実データは `~/backups/perfect-crm/`

## 守ること(コードを書くとき)

- **画面はメタデータで描く。**テーブル名・項目名を画面のコードに書かない。足したいものは `objects` / `fields` / `views` の定義に足す(`docs/design/01` D-01)
- **画面は `ApiClient`(`frontend/src/api/client.ts`)だけを通してデータに触る。**契約の型は `frontend/src/api/types.ts`、振る舞いの正はモック(`frontend/src/mocks/engine.ts`)。契約を変えたら、型・モック・`http.ts`・`docs/design/04` を同じコミットで揃える
- **レコードは DB の 1 行そのままの形**(snake_case、UUID、参照は ID、表示名は `references`)。画面で camelCase に直さない
- **業務ルールはサーバ側**(いまはモックの `applyRules`)。画面に同じ計算を持たせない。画面・MCP・AI チャットのどこから書いても同じ経路を通す
- **書式付きの文字(`richtext`)は HTML。描く前に `lib/richtext.ts` で許した要素だけを残す。**`dangerouslySetInnerHTML` にそのまま渡さない
- **更新は楽観的に。**応答を待たずに画面を書き換え、失敗したら戻す(`frontend/src/data/mutations.ts`)。確認ダイアログではなく「元に戻す」で守る
- **キー操作を壊さない。**日本語入力の変換中はショートカットを反応させない。文字を打っている最中は 1 文字のキーを効かせない。入力欄の幅をアニメーションさせない(打った文字が逆順に入る。runbook §4)。フォーカスの移動は同期で行う(1 フレーム遅らせると、続けて打った文字が前の欄に入る。同 §4)。**変換中(`isComposing`)に入力欄の値を変形して書き戻さない**(小文字化・trim は確定後に。同 §4)
- **見た目はトークンで。**色・文字・影・動きは `frontend/src/styles/index.css` の変数を使い、生の色を書かない。太さは 400 と 700 だけ。グラフの色は `dataviz` の検証スクリプトを通した値だけ(`docs/design/05` §4)
- 自社固有の値(会社名、メールアドレス、外部サービスの ID)をコードに埋めない。設定かデータに出す

## 確かめてから終える

```
scripts/verify.sh                          # ビルド + lint + Vitest + テストケース表の整合(無人ループと着地の関門)
cd frontend && npm run e2e                 # 実ブラウザ(開発サーバを起動してから)
```

テストの土台は `docs/tests/README.md`(4 軸と層)。表の `—` の行(L1・L2)は無人ループが Vitest で埋める(`docs/runbook/02-loop.md`、`loops/`)。**無人ループは `backlog/` を読まない・書かない**(共通ルール)。

画面を変えたら、スクリーンショットで明・暗・スマホ幅を見る(和文の書体を本番と揃える方法は runbook §2)。
公開 URL まで確かめるなら `python3 scripts/cloudflare-access-check.py works.sanei-clover.com --exec '…'`(runbook §3)。

## スタック

確定: 画面は Vite + React + TypeScript + Tailwind CSS v4(+ React Router、TanStack Query、zustand、@dnd-kit/react、lucide)。配信は Caddy、公開は Cloudflare Tunnel + Access、DB は PostgreSQL 18、全体は Docker Compose。
バックエンドは FastAPI(Q-034)。ログインは Cloudflare Access の JWT を確かめる(03 §5)。
採用したライブラリと非推奨の確認結果は `docs/design/03` §9。**新しく足すときは、非推奨でないことを一次資料で確かめてから。**

## 作業の仕方

- 共通ルール(`~/.claude/CLAUDE.md`)に従う。ここでは重複させない
- 決定は `docs/design/` を更新して残す。backlog にはポインタだけ
- デザインを変えるときは、Anthropic 公式の `frontend-design` skill(claude-plugins-official)と `dataviz` skill の手順に従う
