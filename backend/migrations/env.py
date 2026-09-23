"""Alembic の実行環境。接続先は app.config(.env)から読み、ini には書かない。"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import get_settings
from app.meta.tables import metadata

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", get_settings().sqlalchemy_url)
target_metadata = metadata


def include_object(obj: object, name: str | None, type_: str, reflected: bool, compare_to: object) -> bool:
    """**Alembic が見るのはシステム表だけ**(02 §4)。

    業務のテーブル(取引先・商談…と、画面から足したもの)は `meta_*` を正としてアプリが DDL を流す。
    ここで除かないと、autogenerate が「知らないテーブル」を drop するリビジョンを作ってしまう。
    """
    if type_ == "table":
        return name in metadata.tables or name == "alembic_version"
    table_name = getattr(getattr(obj, "table", None), "name", None)
    return table_name is None or table_name in metadata.tables


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        include_object=include_object,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
