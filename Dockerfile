# materin server (Linux) — 全部配置通过环境变量
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.json ./
RUN bun install
RUN bun run web:build
RUN bun build --compile --target=bun-linux-x64 packages/server/src/index.ts --outfile /out/materin-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/materin-server /app/materin-server
COPY packages/web/dist /app/web
ENV MATERIN_HOME=/data \
    MATERIN_PORT=4128 \
    MATERIN_WEB_ROOT=/app/web
VOLUME /data
EXPOSE 4128
HEALTHCHECK --interval=30s --timeout=3s CMD curl -sf http://127.0.0.1:${MATERIN_PORT}/ || exit 1
WORKDIR /app
ENTRYPOINT ["/app/materin-server"]
