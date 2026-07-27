#!/usr/bin/env bash
# 找回「看起来被重置」的 Postgres 数据：列出候选卷，写入 .env 并重启 postgres
# 用法：bash scripts/recover-volume.sh
#       bash scripts/recover-volume.sh 旧卷完整名字
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

red() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  red "需要 Docker"
  exit 1
fi
if [[ ! -f .env ]]; then
  red "缺少 .env"
  exit 1
fi

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

get_env() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true; }

CURRENT="$(get_env POSTGRES_VOLUME_NAME)"
CURRENT="${CURRENT:-cardkey_postgres_data}"

info "当前 .env 中 Postgres 卷: $CURRENT"
echo ""
info "本机所有疑似 Postgres / CardKey 卷（含占用体积）："
mapfile -t VOLS < <(docker volume ls --format '{{.Name}}' | grep -E 'postgres|cardkey' || true)
if [[ ${#VOLS[@]} -eq 0 ]]; then
  red "未找到任何相关卷"
  exit 1
fi

i=0
declare -a LIST=()
for v in "${VOLS[@]}"; do
  size="$(docker system df -v 2>/dev/null | awk -v n="$v" '$1==n {print $3; exit}')"
  size="${size:-?}"
  # 卷内是否有 PG 数据目录痕迹
  has_pg="no"
  if docker run --rm -v "$v":/v alpine:3.20 sh -c 'test -d /v/base || test -d /v/pgdata || test -f /v/PG_VERSION || ls /v 2>/dev/null | head -1 | grep -q .' 2>/dev/null; then
    has_pg="yes"
  fi
  printf '  [%d] %s  size=%s  nonempty≈%s\n' "$i" "$v" "$size" "$has_pg"
  LIST+=("$v")
  i=$((i + 1))
done

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  if [[ ! -t 0 ]]; then
    red "非交互环境请传入卷名: bash scripts/recover-volume.sh <volume-name>"
    exit 1
  fi
  echo ""
  yellow "选择要挂回的卷序号（一般选体积更大、非空的那一个）："
  read -r -p "序号: " idx
  if ! [[ "$idx" =~ ^[0-9]+$ ]] || (( idx < 0 || idx >= ${#LIST[@]} )); then
    red "无效序号"
    exit 1
  fi
  TARGET="${LIST[$idx]}"
fi

if ! docker volume inspect "$TARGET" >/dev/null 2>&1; then
  red "卷不存在: $TARGET"
  exit 1
fi

info "将 POSTGRES_VOLUME_NAME=$TARGET 写入 .env"
if grep -qE '^POSTGRES_VOLUME_NAME=' .env 2>/dev/null; then
  # 跨 sed 兼容：用临时文件
  grep -vE '^POSTGRES_VOLUME_NAME=' .env >.env.tmp_vol
  echo "POSTGRES_VOLUME_NAME=$TARGET" >>.env.tmp_vol
  mv .env.tmp_vol .env
else
  echo "POSTGRES_VOLUME_NAME=$TARGET" >>.env
fi

info "重启 postgres（不动其它卷）"
compose up -d --force-recreate --no-deps postgres
sleep 3
compose up -d --no-deps cardkey

echo ""
green "已挂接卷: $TARGET"
yellow "请打开管理端确认类别/卡密是否恢复。"
echo "若仍不对：docker compose logs postgres cardkey --tail 80"
echo "并确认 .env 的 POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB 与建库时一致（密码仅在卷首次初始化时写入）。"
