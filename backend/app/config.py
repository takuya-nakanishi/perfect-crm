"""環境変数から読む設定。値は .env(リポジトリ直下に 1 つ)にあり、出力しない。"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

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

    # --- ログイン(03 §5 の B 案。app/access.py)-----------------------------
    # access = Cloudflare Access が付ける JWT で利用者を決める(本番。ログイン画面は出さない)
    # dev = メールアドレスだけで入れる(Access の無い手元の E2E とテスト用。**公開する場所では使わない**)
    auth: Literal["access", "dev"] = "access"
    # Access のチーム(例 https://<チーム名>.cloudflareaccess.com)と、Access アプリの AUD タグ。
    # scripts/cloudflare-tunnel-setup.py が .env に書く。空のままだと access ではだれも入れない(503)
    access_team_domain: str = ""
    access_aud: str = ""

    # 署名と暗号化の鍵(.env の WORKS_SECRET_KEY)。空なら起動ごとのランダム
    secret_key: str = ""
    # dev のセッション Cookie に Secure を付ける(https で配るとき。開発の http では false)
    secure_cookie: bool = True

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

    # 1 リクエストあたりのレコードの上限(04 §12 のページング)
    max_limit: int = Field(default=500, ge=1)

    @property
    def google_enabled(self) -> bool:
        """OAuth クライアントが `.env` にあるか。無ければドライブの API は 503 を返す。"""
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"postgresql+psycopg://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
