# seed — 初期投入データの置き場(Git 管理外)

`organizations.csv` / `people.csv`(2026-09-18 のスプレッドシート台帳から。組織60・人物25)は**個人情報を含むため Git に入れない**
(`.gitignore` で `seed/*.csv` を除外)。原本は Google Drive `マイドライブ/連絡先台帳-移行元-2026-09/`。
再投入するときはそこから `seed/` へ置いて `docker cp seed contacts-db:/tmp/seed` → `\copy`(手順は README.md)。
