# Works の API。uv で依存を固定したまま入れ、実行は非 root で。
# イメージのタグは固定する(latest を使わない)。版は docs/design/03 §10
FROM python:3.14.7-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.12.18 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /srv
# 依存だけを先に入れる(コードだけ変えたときにこの層を使い回す)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
RUN uv sync --frozen --no-dev

FROM python:3.14.7-slim

RUN useradd --create-home --uid 10001 works
WORKDIR /srv
COPY --from=builder --chown=works:works /srv /srv
ENV PATH="/srv/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
USER works
EXPOSE 8000

# マイグレーションと初期データを揃えてから起動する(利用者 1〜3 名・1 プロセスの前提)
CMD ["sh", "-c", "python -m app.cli init && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
