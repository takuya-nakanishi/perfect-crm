# syntax=docker/dockerfile:1
# 画面のイメージ。Node でビルドし、できた静的ファイルを Caddy で配る(実行時に Node は要らない)。

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
# mock = ブラウザ内の擬似 DB で動かす / http = バックエンドの /api/v1 を叩く(src/api/client.ts)
ARG VITE_API_MODE=mock
ENV VITE_API_MODE=$VITE_API_MODE
RUN npm run build

FROM caddy:2.11.4-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 8080
