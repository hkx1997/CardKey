#!/usr/bin/env bash
# 安全升级：只拉代码并重建应用，绝不删除数据卷
# 用法：bash scripts/upgrade.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "需要 Docker" >&2
  exit 1
fi
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

echo "==> git pull（不触碰数据卷）"
git pull --ff-only origin main || git pull --ff-only

if [[ ! -f .env ]]; then
  echo "缺少 .env，请先 deploy/docker-deploy.sh 安装" >&2
  exit 1
fi

# 禁止误用 -v
echo "==> docker compose up -d --build（保留 postgres_data / cardkey_data）"
compose up -d --build

echo ""
echo "OK. 数据卷未删除。"
echo "  查看卷: docker volume ls | grep cardkey"
echo "  危险命令（会清空库，切勿执行）: docker compose down -v"
