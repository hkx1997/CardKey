#!/usr/bin/env bash
# 安全升级：只重建应用容器，绝不删除/重建数据库卷
# 用法：bash scripts/upgrade.sh [git-ref]
#   bash scripts/upgrade.sh           # pull main + 重建 cardkey
#   bash scripts/upgrade.sh v0.1.11   # checkout 标签后重建
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REF="${1:-}"

red() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  red "需要 Docker"
  exit 1
fi
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

# 拒绝危险参数
for a in "$@"; do
  if [[ "$a" == "-v" || "$a" == "--volumes" ]]; then
    red "禁止在升级时使用 -v / --volumes（会删除数据库）"
    exit 1
  fi
done

if [[ ! -f .env ]]; then
  red "缺少 .env，请先 deploy/docker-deploy.sh 安装"
  exit 1
fi

# 打印当前卷，便于确认不会换空卷
info "当前 Docker 卷（cardkey 相关）"
docker volume ls --format '{{.Name}}' | grep -E 'cardkey|postgres' || true
echo ""
if [[ -f .env ]]; then
  grep -E '^(POSTGRES_VOLUME_NAME|APP_VOLUME_NAME|REDIS_VOLUME_NAME)=' .env 2>/dev/null || true
fi

info "同步代码"
if [[ -n "$REF" ]]; then
  git fetch --tags origin 2>/dev/null || git fetch --tags
  git checkout "$REF"
else
  git pull --ff-only origin main 2>/dev/null || git pull --ff-only || true
fi

info "确保数据库/缓存容器在跑（不强制重建）"
# --no-recreate：已存在则保持，避免无意义重建
compose up -d --no-recreate postgres redis 2>/dev/null \
  || compose up -d postgres redis

info "仅构建并滚动应用 cardkey（不动 postgres 数据卷）"
compose build cardkey
compose up -d --no-deps cardkey

echo ""
green "升级完成。数据库容器未用 down -v，卷应保持不变。"
yellow "若库是空的：多半挂到了新空卷。执行 docker volume ls，把旧卷名写进 .env："
echo "  POSTGRES_VOLUME_NAME=你的旧postgres卷名"
echo "  然后: docker compose up -d postgres"
echo ""
echo "危险命令（切勿）: docker compose down -v"
