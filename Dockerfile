# CardKey all-in-one: build frontend + Go API, serve SPA + API on :8080
FROM node:22-alpine AS frontend
WORKDIR /fe
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json frontend/vitest.config.ts ./
COPY frontend/src ./src
COPY frontend/public ./public
ARG APP_VERSION=0.1.0
ENV VITE_API_MODE=http
ENV VITE_APP_VERSION=$APP_VERSION
RUN pnpm build

FROM golang:1.22-alpine AS backend
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# 将前端 dist 打进二进制（webstatic embed），一键更新即可刷新 UI
COPY --from=frontend /fe/dist /src/internal/webstatic/dist
COPY VERSION /src/VERSION
ARG APP_VERSION=0.1.0
ARG GIT_COMMIT=dev
ARG BUILD_TIME=unknown
RUN VERSION=$(cat /src/VERSION 2>/dev/null || echo "$APP_VERSION") ; \
    CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w -X github.com/cardkey/cardkey/internal/version.Version=${VERSION} -X github.com/cardkey/cardkey/internal/version.Commit=${GIT_COMMIT} -X github.com/cardkey/cardkey/internal/version.BuildTime=${BUILD_TIME}" \
    -o /out/cardkey ./cmd/cardkey

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget \
  && adduser -D -H -u 10001 cardkey
WORKDIR /app
COPY --from=backend /out/cardkey /app/cardkey
COPY --from=backend /src/migrations /app/migrations
# 兼容旧部署：磁盘 static 仍拷一份；启动时会用嵌入 SPA 再同步一次
COPY --from=frontend /fe/dist /app/static
COPY deploy/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
  && mkdir -p /app/data/uploads /app/data/bin \
  && chown -R cardkey:cardkey /app
USER cardkey
ENV HTTP_ADDR=:8080
ENV MIGRATIONS_DIR=/app/migrations
ENV STATIC_DIR=/app/static
ENV DATA_DIR=/app/data
ENV APP_ENV=production
EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
# 优先 /app/data/bin/cardkey（一键更新落盘），否则镜像内 /app/cardkey
ENTRYPOINT ["/app/docker-entrypoint.sh"]
