#!/usr/bin/env bash
# CardKey Docker 一键部署（端口 / 数据库密码可配，首次 Web 向导建管理员）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd 2>/dev/null || pwd)"
if [[ ! -f "$ROOT/docker-compose.yml" ]]; then
  ROOT="$(pwd)"
fi
cd "$ROOT"

info() { printf '==> %s\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*" >&2; }

if ! command -v docker >/dev/null 2>&1; then
  red "需要 Docker"
  exit 1
fi

mkdir -p data postgres_data redis_data 2>/dev/null || true

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c "$(($1 * 2))"
  fi
}

if [[ ! -f .env ]]; then
  info "生成 .env …"
  APP_PORT="${APP_PORT:-18080}"
  POSTGRES_PORT="${POSTGRES_PORT:-5432}"
  REDIS_PORT="${REDIS_PORT:-6379}"
  PG_PASS="$(rand_hex 16)"
  JWT="$(rand_hex 32)"
  CK="$(rand_hex 32)"
  cat >.env <<EOF
# 端口
APP_PORT=${APP_PORT}
POSTGRES_PORT=${POSTGRES_PORT}
REDIS_PORT=${REDIS_PORT}
FRONTEND_PORT=5173

# 数据库
POSTGRES_USER=cardkey
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=cardkey

# 应用
JWT_SECRET=${JWT}
CONTENT_KEY=${CK}
BOOTSTRAP_ADMIN_USER=
BOOTSTRAP_ADMIN_PASS=
PUBLIC_REDEEM_API_KEY=
APP_ENV=production
CORS_ORIGINS=http://localhost:${APP_PORT},http://127.0.0.1:${APP_PORT}
SECURE_COOKIE=false
TRUST_PROXY=true
CSRF_CHECK=false
UPDATE_MODE=disabled
EOF
  chmod 600 .env || true
  green "已写入 .env（权限 600）"
  echo "  APP_PORT=${APP_PORT}"
  echo "  POSTGRES_PORT=${POSTGRES_PORT}"
  echo "  REDIS_PORT=${REDIS_PORT}"
  echo "  POSTGRES_PASSWORD 已随机生成（见 .env）"
else
  info ".env 已存在，跳过生成"
fi

# 从 .env 读端口展示
get_env() {
  grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true
}
APP_PORT="$(get_env APP_PORT)"
APP_PORT="${APP_PORT:-18080}"

info "启动 compose…"
docker compose pull || true
docker compose up -d --build

echo ""
green "========================================"
green "  CardKey 部署完成"
green "  管理端: http://localhost:${APP_PORT}/admin"
green "  兑换页: http://localhost:${APP_PORT}/"
green ""
green "  首次打开管理端将进入「安装向导」"
green "  设置管理员账号与站点名称"
green ""
green "  数据库密码等见: $(pwd)/.env"
green "========================================"
echo ""
