# contacts/ — エージェント規約(Claude Code / Codex 共通)

このディレクトリは現行の連絡先台帳の**正本**(PostgreSQL)を置く(perfect-crm 本体ができるまでの実運用の器)。
コマンドはすべて `perfect-crm/contacts/` で実行する(`docker-compose.yml` がここにある。`.env` はリポジトリ直下に 1 つで、ここの `.env` はそこへのシンボリックリンク)。

## 台帳へ書くとき(省略不可)

1. 接続はロール **`contacts_agent`**(`.env` の `CONTACTS_AGENT_DB_PASSWORD`)。所有者 `contacts` は使わない
2. 書き込みトランザクションの先頭で **`SET LOCAL app.actor = 'Claude'`**(Codex は `'Codex'`)を宣言する。
   宣言が無い・他の値を名乗ると DB 側が書き込みを拒否する(`current_actor()`)
3. ID は `next_id('o'|'p'|'a')` で採る。値の制約(enum・一意・参照)は DB が強制するので、失敗したら値を直す。制約を緩めない
4. スキーマ変更(`db/*.sql`)は人間の承認を得てから。所有者ロールで流し、同じコミットで `README.md` を直す

手順の実体は `README.md`「AI からの読み書き」。

## 禁止

- `.env` の値を出力・コミット・外部送出しない
- **`seed/*.csv`(個人情報)を Git に入れない**。このリポジトリは公開されている
- `change_log` を書き換えない(書けないが、迂回も試みない)
- 台帳の内容を llm-wiki の entities へ転記しない(連絡先は台帳に、知見は wiki に。境界は llm-wiki `vault/wiki/knowledge/personal-data-governance.md`)
