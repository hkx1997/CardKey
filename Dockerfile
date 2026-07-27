# CardKey all-in-one: build frontend + Go API, serve SPA + API on :8080
FROM node:22-alpine AS frontend
WORKDIR /fe
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json frontend/vitest.config.ts ./
COPY frontend/src ./src
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
COPY --from=frontend /fe/dist /app/static
RUN chown -R cardkey:cardkey /app
USER cardkey
ENV HTTP_ADDR=:8080
ENV MIGRATIONS_DIR=/app/migrations
ENV STATIC_DIR=/app/static
ENV APP_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["/app/cardkey"]
