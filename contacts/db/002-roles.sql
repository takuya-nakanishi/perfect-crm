-- 権限の高さで分けたロール(誰が使うかではなく、何ができるかで分ける)
--   contacts        : 所有者。スキーマ変更・ロール管理。人間が psql で使う(initdb が作る)
--   contacts_agent  : AI(Claude Code / Codex 共用)。台帳3表の読み書きのみ。操作者は毎トランザクション申告
--   contacts_ui     : 画面(NocoDB)。台帳3表の読み書きのみ。操作者は '画面' 固定
-- 実行: docker exec -i contacts-db psql -U contacts -d contacts \
--         -v agent_pw="'<CONTACTS_AGENT_DB_PASSWORD>'" -v ui_pw="'<CONTACTS_UI_DB_PASSWORD>'" -f - < db/002-roles.sql
CREATE DATABASE nocodb_meta OWNER contacts;

CREATE ROLE contacts_agent LOGIN PASSWORD :agent_pw;
CREATE ROLE contacts_ui    LOGIN PASSWORD :ui_pw;

GRANT USAGE ON SCHEMA public TO contacts_agent, contacts_ui;
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, people, activities TO contacts_agent, contacts_ui;
GRANT SELECT ON change_log, people_overview TO contacts_agent, contacts_ui;   -- 監査ログは読めるが書けない(トリガーが所有者権限で記録する)
ALTER DEFAULT PRIVILEGES FOR ROLE contacts IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO contacts_agent, contacts_ui;

-- 画面経由の書き込みは全て「画面」として記録。AI は current_actor() が申告を強制する(001-schema.sql)
ALTER ROLE contacts_ui SET app.actor = '画面';
