# 01 運用の手順

Surface(WSL2 の Ubuntu)で Works を動かすための手順と、実際に踏んだ落とし穴。構成の説明は `docs/design/06-deployment.md`。
コマンドはリポジトリ直下で打つ。

## 1. 起動・停止・更新

```
docker compose --profile public up -d --build     # 画面 + Tunnel。ソースを変えたあとの反映もこれ
docker compose --profile public ps                # 状態(web が healthy であること)
docker compose --profile public logs -f tunnel    # Tunnel の接続(Registered tunnel connection が 4 本)
docker compose --profile public down              # 停止(ボリュームは残る)
docker compose up -d --build                      # Tunnel なしで画面だけ(http://127.0.0.1:8610)
```

- `--profile public` を付けないと `tunnel` は対象にならない(止めるときも同じ)
- **`docker compose down -v` は打たない。**`-v` はボリュームを消す。いまは空だが、`db` にデータが入ったら取り返しがつかない

**イメージの取得でつまずく点**: この WSL の `~/.docker/config.json` は `credsStore: desktop.exe`(Docker Desktop の名残)で、公開イメージの pull まで
`docker-credential-desktop.exe: executable file not found` で失敗する。ECR の認証が入っているので設定は消さず、pull やビルドのときだけ空の設定を使う:

```
mkdir -p /tmp/docker-nocreds && echo '{}' > /tmp/docker-nocreds/config.json
DOCKER_CONFIG=/tmp/docker-nocreds docker compose --profile public up -d --build
```

一度取得したイメージがあれば、ふだんの `up -d` は上の回避なしで通る。

## 2. 画面の開発

```
cd frontend
npm install
npm run dev          # http://127.0.0.1:5173(モックで動く)
npm run build        # 型検査 + 本番ビルド
npm run lint         # oxlint
npm test             # Vitest(L1 の lib と L2 のモック。docs/tests)
npm run e2e          # 実ブラウザで主要な操作を確かめる(開発サーバに対して)
npm run fixtures     # モックのレコードを作り直す(scripts/gen-fixtures.mjs)
```

- E2E の向き先は引数で変えられる: `npm run e2e -- http://127.0.0.1:8610`(コンテナの本番ビルド)
- E2E のブラウザは Playwright の Chromium(`~/.cache/ms-playwright/chromium-*`)。無ければ `npx playwright install chromium`。別の場所にあるなら `CHROMIUM_PATH`
- モックのデータはブラウザごと。画面の利用者メニュー「モックのデータを初期化」で戻る。メタデータ(`fixtures/objects.json`・`views.json`)は手で直す

**スクリーンショットで見た目を確かめるとき**: WSL には和文が IPA ゴシックしか無く、本番(Windows の BIZ UDP ゴシック)と見た目が変わる。
Windows のフォントを一時的に参照させると揃う:

```
cat > /tmp/fonts.conf <<'EOF'
<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>/mnt/c/Windows/Fonts</dir><cachedir>/tmp/fontcache</cachedir></fontconfig>
EOF
FONTCONFIG_FILE=/tmp/fonts.conf npm run e2e     # Playwright で撮るスクリプトも同じ環境変数で
```

## 3. Cloudflare(Tunnel・DNS・Access)

```
python3 scripts/cloudflare-api.py                  # API トークンが生きているか
python3 scripts/cloudflare-tunnel-setup.py works.sanei-clover.com --origin http://web:8080 --allow <メール> --app-name Works
python3 scripts/cloudflare-access-check.py works.sanei-clover.com
python3 scripts/cloudflare-access-check.py works.sanei-clover.com --exec 'npm --prefix frontend run -s e2e -- https://works.sanei-clover.com'
```

- `cloudflare-tunnel-setup.py` は何度打っても同じ結果になる。Tunnel を作り直したときは `.env` の `CLOUDFLARE_TUNNEL_TOKEN` を置き換えるので、そのあと `docker compose --profile public up -d` で cloudflared を作り直す
- `cloudflare-access-check.py` は、未認証が Access へ送られること、認証済みなら画面の HTML まで届くことを外から確かめる。確認のあいだだけサービストークンとポリシーを作り、終わったら消す。`--exec` を付けると、そのトークンを環境変数に入れてコマンドを走らせる(上の例は、公開 URL に対する E2E)
- トークンの値は、どのスクリプトも表示しない。`.env` の中身を画面やログに出さないこと

## 4. 踏んだ落とし穴

| 症状 | 原因と対処 |
|---|---|
| `web` が再起動を繰り返し、ログに `exec /usr/bin/caddy: operation not permitted` | 公式イメージの caddy は `cap_net_bind_service` 付きのバイナリ。`cap_drop: [ALL]` だけだと exec できない。`cap_add: [NET_BIND_SERVICE]` を足してある |
| 公開 URL でだけ、コンソールに `static.cloudflareinsights.com/beacon.min.js … violates Content Security Policy` | ゾーンの Web Analytics が HTML にビーコンを自動挿入していた。CSP が止めるので実害は無い。配る側で `Cache-Control: no-transform` を返して挿入させないようにした。ホスト単位の除外ルールは無料プランでは作れない(`maxRulesError`) |
| Access の確認で、同じ要求が 302 と 200 を行き来する | 作りたてのポリシーが Cloudflare の全拠点へ行き渡るまで十数秒かかる。確認スクリプトは 3 回続けて通るまで待つ |
| 絞り込み欄で、打った文字が逆順に入る(「かささぎ」→「ぎささか」) | 幅 0 から広がるアニメーションの途中で打鍵すると、Chromium がキャレットを先頭に置き続ける。入力欄は、開いた状態でだけ描く(幅を動かさない)。**入力欄の幅をアニメーションさせない** |
| テーブル設定で、Enter のあと速く打つと、文字が前の欄に入る(「見積」→ Enter →「見積番号」が「見」と「名前積番号」になる) | 次の欄へのフォーカス移動を `requestAnimationFrame` で 1 フレーム遅らせていた。**フォーカスの移動は同期で行う。**行を足してから移すときは `flushSync` で先に描く。E2E は待ちを挟まずに打つので、この類を拾える |
| 日本語 IME で英字を打つと、変換が途切れて「lleあ」のようになる(列名の欄で `Lead` を Shift+l, e, a, d と打つ) | 入力のたびに `toLowerCase()` した値を書き戻していた。変換中(`InputEvent.isComposing`)に値を書き換えると変換が仕切り直しになる。**変換中は値をそのまま持ち、`compositionend` と blur で整える**(`keyInputHandlers`)。Linux の Playwright では再現できない(CDP の `Input.imeSetComposition` でも Windows の MS-IME の挙動にはならない)ので、値を変形する入力欄を作るときは規則として守る |
| パネルの幅を変えたあと、パネルがもう一度スライドして入ってくる | ドラッグ中だけ `animate-panel-in` を外していたため、付け直すたびに CSS アニメーションが再生されていた。**アニメーションのクラスは付けたままにする**(初回の挿入時だけ走る) |
| ポップオーバーの中からポップオーバーを開くと、内側を押した瞬間に外側が閉じて、選んだ値が消える | 外側の「外側のクリック」判定が、body に描かれた内側を外側だと見ていた。開いた順の並び(`popoverStack`)を持ち、自分より後に開いたものの中は内側とみなす。Esc もいちばん上だけが閉じる。**ポップオーバーの部品は `ui/overlay.tsx` の `Popover` だけを使う**(自前で fixed の div を出すと、この判定から外れる) |
| レコードを作成しても「〜を作成しました」のトーストが出ない | `mutate(vars, { onSuccess })` の onSuccess は、呼んだ画面が閉じた(unmount した)あとには呼ばれない(TanStack Query の仕様)。閉じたあとに知らせるものは `mutateAsync().then()` で受ける |
| `<dialog>` を開くと、先頭のボタンにフォーカスが入り、React の `autoFocus` が効かない | `showModal()` が、描画のあとで先頭のフォーカス可能な要素へ当て直す。**`Modal` が開いたあとに最初の入力欄へ当て直す**(`ui/overlay.tsx`)。個々のモーダルで細工しない(Web フォームの作成で同じことを踏み直して共通化した) |
| 開発サーバで、初めて開いた画面が一度だけ再読み込みされる | Vite が新しい依存(`@dnd-kit/react/sortable` など)を初回に最適化して reload する。本番ビルドでは起きない。スクリーンショットのスクリプトは 2 回目から安定する |
| 数字のゼロに全部斜線が入る | 書体(Atkinson Hyperlegible Next)の仕様で、切り替える機能も無い。Figtree に替えた。**書体を替えるときは、金額の並ぶ画面で確かめる** |
| PostgreSQL 18 が空のまま起動する | 18 からデータの場所が `/var/lib/postgresql/18/docker`。ボリュームは `/var/lib/postgresql` に付ける |

## 5. バックエンド(api + db)

```
docker compose --profile backend up -d --build     # api(FastAPI)+ db(PostgreSQL)
docker compose --profile backend up -d db          # DB だけ(pytest が繋ぐ先)
docker compose logs -f api
```

- **道具は uv。**入っていなければ `curl -LsSf https://astral.sh/uv/install.sh | sh`(公式の入れ方)。`scripts/verify.sh` は uv が無いと red になる
- 初回の起動で `python -m app.cli init` が走り、マイグレーション → 初期メタデータ → 管理者まで揃う。**`WORKS_ADMIN_EMAIL` が空だと管理者が作られず、ログインできない**
- `.env` に要る値は `backend/README.md`(`WORKS_DB_PASSWORD`・`WORKS_SECRET_KEY`・`WORKS_ADMIN_EMAIL`)
- **db はホストの 127.0.0.1:55432 に出ている**(pytest が実物に繋ぐため)。外へは出さない
- テストは名前が `_test` で終わる DB にしか繋がない(`works_test` を自動で作る)。**本番の `works` を消さないための安全装置**なので外さない
- 画面から API を使うには `VITE_API_MODE=http` で web を建て直す(`docker compose up -d --build web`)。既定は mock(J-024)

## 6. Google ドライブを繋ぐ(GCP 側の手順・2026-09-23)

画面の「Google に接続」が動くまでに、**人が 1 回だけ**やること。設計は `docs/design/04` §8。
**ここで作る値(クライアント ID とシークレット、署名鍵)は `.env` に入れるだけで、コミットしない。**

| | |
|---|---|
| GCP プロジェクト | `citric-earth-449901-e7`(**スプレッドシートなどのカスタム MCP を建てたのと同じプロジェクト**。sanei-clover.com の Workspace) |
| OAuth の画面 | `https://console.cloud.google.com/auth/clients?project=citric-earth-449901-e7`(**Google Auth Platform**。2025 年に「API とサービス → OAuth 同意画面」から移った) |
| API の有効化 | `https://console.cloud.google.com/apis/library/drive.googleapis.com?project=citric-earth-449901-e7` |

**A. 自分で作る値(GCP とは関係ない。手元のコマンドで生成する)**

```
openssl rand -hex 32     # → WORKS_SECRET_KEY(セッション Cookie の署名 + Google の鍵の暗号化)
openssl rand -hex 24     # → WORKS_DB_PASSWORD(まだ入れていなければ。記号を含めない)
```

`WORKS_SECRET_KEY` は**どこかから取ってくるものではなく、自分で作る乱数**。一度決めたら変えない
(変えると、ログイン中の人は入り直し、繋いだ Google は繋ぎ直しになる)。

**B. GCP コンソールで取る値(クライアント ID とシークレット)**

1. **Drive API を有効にする** — 上の「API の有効化」を開いて「有効にする」
2. **Google Auth Platform → ブランディング(Branding)** — アプリ名(例 `Works`)とサポート用メールを入れる
   (プロジェクトで初めて OAuth を使うときだけ。カスタム MCP で作ってあれば済んでいる)
3. **対象(Audience)** を **「内部」(Internal)** にする。内部なら、`drive.readonly` が制限付きスコープでも
   **審査(CASA)が要らず、同意画面にスコープの一覧も出ない**。外部にすると審査が要るので、必ず内部のままにする
   (内部を選べるのは、そのプロジェクトが Workspace 組織の中にあるときだけ)
4. **クライアント(Clients)→「クライアントを作成」** — 種類は **ウェブ アプリケーション**、名前は `Works`。
   **承認済みのリダイレクト URI** に次を**1 文字も違わず**足す

   ```
   https://works.sanei-clover.com/api/v1/google/callback
   ```

5. 作成直後のダイアログに **クライアント ID** と **クライアント シークレット** が出る。
   閉じてしまっても、クライアントの詳細画面からいつでも見られる(JSON でも落とせる)
6. **データアクセス(Data Access)のスコープ登録は、内部アプリでは必須ではない**(同意画面に出ないため)。
   登録しても害は無い: `…/auth/drive.readonly`・`…/auth/drive.file`・`…/auth/userinfo.email`・`openid`

**C. `.env` に入れて建て直す**

```
WORKS_SECRET_KEY=<A で作った 64 文字>
WORKS_GOOGLE_CLIENT_ID=<...>.apps.googleusercontent.com
WORKS_GOOGLE_CLIENT_SECRET=<GOCSPX-... >
# 既定は https://works.sanei-clover.com/api/v1/google/callback。変えたときだけ書く(GCP 側も揃える)
WORKS_GOOGLE_REDIRECT_URI=
```

```
docker compose --profile backend up -d --build api
```

タスクか商談のパネルの「資料」に「Google に接続」が出る。押して自分の Workspace アカウントで許可すると、
同じ画面へ戻ってきて「新規」「参照」が使えるようになる。

つまずいたとき:

| 症状 | 見るところ |
|---|---|
| ドライブの項目に「Google 連携が設定されていません」と出る | `WORKS_GOOGLE_CLIENT_ID` / `SECRET` が api に渡っていない(`.env` に入れたあと `up -d --build api` をしたか) |
| `redirect_uri_mismatch` | GCP のリダイレクト URI と `WORKS_GOOGLE_REDIRECT_URI` の不一致(末尾の `/`・http と https・ホスト名) |
| 繋いだのに次の日また「Google に接続」が出る | `WORKS_SECRET_KEY` が空だと、再起動のたびに鍵が変わって保存した token を読めない(`.env` に固定する) |
| 403 `access_denied` で戻る | 同意画面が「内部」で、押した人が Workspace の利用者か。外部アカウント(個人の Gmail)では通らない |
| Cloudflare Access の画面が Google の戻りで出る | 戻り先も Access の内側。**同じブラウザで Works にログインしたまま**繋ぐ |

出典: Google 公式「アクセス認証情報を作成する」「OAuth 同意画面を設定する」(2026-09-23 参照)。

## 7. 版を上げる

- 画面のライブラリ: `cd frontend && npm outdated` → 上げる → `npm run build && npm run e2e`。`@dnd-kit/react` は 1.0 前なので、E2E のドラッグの項目を必ず見る。上げる前に非推奨になっていないかを確かめる(共通ルール)
- バックエンドのライブラリ: `cd backend && uv sync --upgrade` → `scripts/verify.sh`。上げる前に非推奨になっていないかを確かめる(共通ルール)。`pyproject.toml` の `filterwarnings` で名指しして外している警告が、まだ要るかも見る
- イメージ: `docker-compose.yml`・`frontend/Dockerfile`・`backend/Dockerfile` のタグを書き換えて `up -d --build`。`latest` は使わない。`db` を上げるときは、先に `pg_dump` を取る
