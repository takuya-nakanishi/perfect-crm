-- 連絡先台帳 スキーマ(2026-09-19)
-- 正本はこのPostgreSQL。画面ツール・Claude Code・Codex はすべてここに読み書きする。
-- 設計は Google スプレッドシート「THE計画／連絡先台帳」(2026-09-18) の5タブをそのまま移したもの。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 列挙(規約外の値をDBが拒否する)
CREATE TYPE org_kind    AS ENUM ('取引先','BP・パートナー','見込み','士業・専門家','金融機関','自社・関係会社','情報源','未分類');
CREATE TYPE org_status  AS ENUM ('現役','休眠','終了','要確認');
CREATE TYPE person_kind AS ENUM ('取引先担当者','要員・候補者','紹介者','士業・専門家','その他');
CREATE TYPE person_status AS ENUM ('現役','休眠','退職・異動','要確認');
CREATE TYPE activity_kind AS ENUM ('会議','メール','電話','対面','紹介','資料送付','その他');
CREATE TYPE actor_kind  AS ENUM ('本人','Claude','Codex','画面');
CREATE TYPE change_op   AS ENUM ('追加','更新','削除');

CREATE TABLE organizations (
  id            text PRIMARY KEY,                 -- o0001 形式(台帳から継承)。新規は画面/AIが採番
  name          text NOT NULL UNIQUE,             -- 正式名称
  short_name    text,
  kind          org_kind   NOT NULL DEFAULT '未分類',
  status        org_status NOT NULL DEFAULT '要確認',
  drive_folder  text,                             -- マイドライブ配下の相対パス
  wiki_entity   text,                             -- llm-wiki entities のファイル名(拡張子なし)。一方向リンク
  first_contact date,
  last_contact  date,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE people (
  id              text PRIMARY KEY,               -- p0001 形式
  name            text NOT NULL,
  name_kana       text,
  organization_id text REFERENCES organizations(id) ON DELETE SET NULL,
  title           text,                           -- 役職
  email           text CHECK (email IS NULL OR email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  phone           text,
  kind            person_kind   NOT NULL DEFAULT 'その他',
  how_met         text,                           -- 出会いの経緯
  first_contact   date,
  last_contact    date,
  wiki_entity     text,
  status          person_status NOT NULL DEFAULT '要確認',
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX people_org_idx   ON people(organization_id);
CREATE INDEX people_name_idx  ON people(name);
CREATE INDEX people_email_idx ON people(lower(email)) WHERE email IS NOT NULL;

CREATE TABLE activities (
  id              text PRIMARY KEY,               -- a0001 形式
  occurred_on     date NOT NULL,
  person_id       text REFERENCES people(id) ON DELETE SET NULL,
  organization_id text REFERENCES organizations(id) ON DELETE SET NULL,
  kind            activity_kind NOT NULL,
  summary         text NOT NULL,                  -- 1行要約
  attendees       text,                           -- 同席者
  source          text,                           -- raw の GitHub URL / Gmail / Todoist / Drive
  next_action     text,
  recorded_by     actor_kind NOT NULL DEFAULT '本人',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (person_id IS NOT NULL OR organization_id IS NOT NULL)
);
CREATE INDEX activities_person_idx ON activities(person_id, occurred_on DESC);
CREATE INDEX activities_org_idx    ON activities(organization_id, occurred_on DESC);

-- 監査証跡。トリガーで自動記録されるので、どの経路で書いても残る(規律3)
CREATE TABLE change_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor       actor_kind  NOT NULL,
  table_name  text NOT NULL,
  record_id   text NOT NULL,
  op          change_op   NOT NULL,
  diff        jsonb                                -- 更新時は変わった列だけ、追加/削除は全列
);
CREATE INDEX change_log_record_idx ON change_log(table_name, record_id, at DESC);

-- 操作者はトランザクション内で SET LOCAL app.actor = 'Claude' 等で申告する。
-- ロールは権限の高さ(所有者 / AI / 画面)で分け、誰が書いたかは申告で残す。
-- ただし申告できる値はロールごとに縛る(AI用ロールが '本人' を名乗ることはできない)。
--   contacts(所有者)   : 未申告なら '本人'。人間が psql で使う
--   contacts_agent(AI) : 'Claude' か 'Codex' の申告が必須。未申告・他の値は書き込み自体が失敗する
--   contacts_ui(画面)  : ロール既定の '画面' 固定(002-roles.sql)
-- log_change() は SECURITY DEFINER なので current_user は所有者になる。接続ロールは session_user で見る
CREATE OR REPLACE FUNCTION current_actor() RETURNS actor_kind LANGUAGE plpgsql STABLE AS $$
DECLARE a text := NULLIF(current_setting('app.actor', true), '');
BEGIN
  IF session_user = 'contacts_agent' AND (a IS NULL OR a NOT IN ('Claude', 'Codex')) THEN
    RAISE EXCEPTION 'contacts_agent は SET LOCAL app.actor = ''Claude'' または ''Codex'' を宣言してから書く(現在: %)', COALESCE(a, '未申告')
      USING ERRCODE = 'check_violation';
  END IF;
  IF session_user = 'contacts_ui' AND a IS DISTINCT FROM '画面' THEN
    RAISE EXCEPTION 'contacts_ui の操作者は ''画面'' 固定(現在: %)', COALESCE(a, '未申告') USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(a, '本人')::actor_kind;
END $$;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- SECURITY DEFINER: 画面ロール(contacts_ui)は change_log に書けないが、トリガー経由では所有者権限で必ず記録される
CREATE OR REPLACE FUNCTION log_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d jsonb; rid text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    d := to_jsonb(NEW) - 'created_at' - 'updated_at'; rid := NEW.id;
    INSERT INTO change_log(actor, table_name, record_id, op, diff) VALUES (current_actor(), TG_TABLE_NAME, rid, '追加', d);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(key, jsonb_build_object('old', o.value, 'new', n.value)) INTO d
      FROM jsonb_each(to_jsonb(OLD)) o JOIN jsonb_each(to_jsonb(NEW)) n USING (key)
     WHERE o.value IS DISTINCT FROM n.value AND key NOT IN ('updated_at');
    IF d IS NOT NULL THEN
      INSERT INTO change_log(actor, table_name, record_id, op, diff) VALUES (current_actor(), TG_TABLE_NAME, NEW.id, '更新', d);
    END IF;
    RETURN NEW;
  ELSE
    d := to_jsonb(OLD) - 'created_at' - 'updated_at';
    INSERT INTO change_log(actor, table_name, record_id, op, diff) VALUES (current_actor(), TG_TABLE_NAME, OLD.id, '削除', d);
    RETURN OLD;
  END IF;
END $$;

DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','people','activities'] LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
    EXECUTE format('CREATE TRIGGER %I_log AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION log_change()', t, t);
  END LOOP;
END $$;

-- 採番(o/p/a + 4桁)。画面・AIどちらからも同じ関数で採る
CREATE OR REPLACE FUNCTION next_id(prefix text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int; tbl text;
BEGIN
  tbl := CASE prefix WHEN 'o' THEN 'organizations' WHEN 'p' THEN 'people' WHEN 'a' THEN 'activities' END;
  EXECUTE format('SELECT COALESCE(MAX(substr(id,2)::int),0)+1 FROM %I WHERE id ~ %L', tbl, '^' || prefix || '[0-9]{4}$') INTO n;
  RETURN prefix || lpad(n::text, 4, '0');
END $$;

-- 人物詳細で「所属組織+活動履歴」を1画面にするための読み取りビュー
CREATE VIEW people_overview AS
SELECT p.*, o.name AS organization_name, o.kind AS organization_kind, o.status AS organization_status,
       (SELECT count(*) FROM activities a WHERE a.person_id = p.id) AS activity_count,
       (SELECT max(occurred_on) FROM activities a WHERE a.person_id = p.id) AS last_activity_on
  FROM people p LEFT JOIN organizations o ON o.id = p.organization_id;

-- 画面(NocoDB)用ロール。パスワードは .env の CONTACTS_UI_DB_PASSWORD。
-- app.actor をロール既定値で '画面' に固定し、画面経由の書き込みを監査ログで識別する。
-- (初期化時は compose が実行しないので、手順は README を参照)
