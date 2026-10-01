"""環境変数から読む設定。値は .env(リポジトリ直下に 1 つ)にあり、出力しない。"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# コンテナの中では環境変数(Compose が .env を渡す)。ホストから直に動かすときはこのファイルを読む
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WORKS_", extra="ignore", env_file=ENV_FILE, env_file_encoding="utf-8")

    db_host: str = "db"
    db_port: int = 5432
    db_name: str = "works"
    db_user: str = "works"
    db_password: str = ""
    # 全体を 1 本で渡したいとき(テストや接続先の差し替え)。空なら上の 5 つから組み立てる
    database_url: str = ""

    # ワークスペースの既定値(初回の seed でだけ使う)
    workspace_name: str = "Works"
    timezone: str = "Asia/Tokyo"
    # 最初の管理者(`python -m app.cli init` が作る)。空なら作らない
    admin_email: str = ""
    admin_name: str = "管理者"

    # --- ログイン(03 §5。アプリ自身が持つ。01 D-14)-------------------------
    # メールアドレスとパスワード + TOTP(app/auth/)。手元・テスト・E2E・本番のどこも同じ形。
    # Cloudflare Access の JWT で利用者を決める形(WORKS_AUTH=access)は、Access を外したときに消した(2026-10-01)

    # 署名と暗号化の鍵(.env の WORKS_SECRET_KEY)。空なら起動ごとのランダム。
    # https に出す(secure_cookie)なら必須(空なら起動しない。2 段階認証の秘密を読めなくなるため)
    secret_key: str = ""
    # セッションの Cookie に Secure を付け、名前に __Host- を付ける(https で配るとき。手元の http では false)
    secure_cookie: bool = True
    # パスワードを決めるとき、漏えいした一覧(Have I Been Pwned)に照らす。テストは外へ出ないよう false
    pwned_check: bool = True

    # SQL をログに出す(開発用)
    echo_sql: bool = False

    # --- Google ドライブ(04 §8。利用者ごとの OAuth)-------------------------
    # OAuth クライアント(種類は「ウェブ アプリケーション」)。GCP のプロジェクトは docs/runbook/01 §6
    google_client_id: str = ""
    google_client_secret: str = ""
    # 許可のあとに Google が戻す先。**クライアントに登録した URL と 1 文字も違ってはいけない**
    google_redirect_uri: str = "https://works.sanei-clover.com/api/v1/google/callback"
    # 戻したあとに画面のどこを開くか(同じオリジンの中だけ)
    google_return_path: str = "/"

    # --- Slack への通知(04 §14。ワークスペースで 1 つ)------------------------------
    # Slack アプリの資格情報(docs/runbook/01 §6b)。空なら連携できない(画面はその旨を出す)。
    # 認可の戻り先は `<public_url>/api/v1/slack/callback`(Slack アプリに登録するリダイレクト URL と揃える)
    slack_client_id: str = ""
    slack_client_secret: str = ""

    # --- ワークフロー(04 §15)-------------------------------------------------------
    # 送り係(実行記録の送信待ちを拾って動かすスレッド)を API のプロセスで起こすか。テストは false にして、直に呼ぶ
    workflow_runner: bool = True

    # 外から見た Works の URL(末尾の / なし)。MCP の接続先(`<ここ>/mcp`)と OAuth の発行元になる(03 §6)。
    # **Claude のコネクタに入れる URL と 1 文字も違ってはいけない**。既定は手元の web(compose が本番の値を渡す)
    public_url: str = "http://127.0.0.1:8610"

    # 1 リクエストあたりのレコードの上限(04 §12 のページング)
    max_limit: int = Field(default=500, ge=1)

    @property
    def google_enabled(self) -> bool:
        """OAuth クライアントが `.env` にあるか。無ければドライブの API は 503 を返す。"""
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def slack_enabled(self) -> bool:
        """Slack アプリの資格情報が `.env` にあるか。無ければ連携の画面は「未設定」を出す。"""
        return bool(self.slack_client_id and self.slack_client_secret)

    @property
    def slack_redirect_uri(self) -> str:
        """Slack の認可のあとに戻る先。**Slack アプリに登録したリダイレクト URL と 1 文字も違ってはいけない**。"""
        return f"{self.public_url.rstrip('/')}/api/v1/slack/callback"

    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"postgresql+psycopg://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
