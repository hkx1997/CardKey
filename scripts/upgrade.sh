#!/usr/bin/env bash
# 安全升级：只重建应用容器，绝不删除/重建数据库卷
# 用法：bash scripts/upgrade.sh [git-ref]
#   bash scripts/upgrade.sh           # pull main + 重建 cardkey
#   bash scripts/upgrade.sh v0.1.13   # checkout 标签后重建
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

get_env() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true; }

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

# ---------- 卷安全检查（防止静默挂上新空卷）----------
EXPECTED_PG="$(get_env POSTGRES_VOLUME_NAME)"
EXPECTED_PG="${EXPECTED_PG:-cardkey_postgres_data}"

info "当前配置的 Postgres 卷: $EXPECTED_PG"
info "本机相关 Docker 卷："
mapfile -t ALL_PG < <(docker volume ls --format '{{.Name}}' | grep -E 'postgres|cardkey' || true)
for v in "${ALL_PG[@]:-}"; do
  mark=""
  [[ "$v" == "$EXPECTED_PG" ]] && mark="  ← 当前使用"
  echo "  - $v$mark"
done

# 多个 postgres 相关卷 → 强提示（历史最常见「假重置」原因）
pg_count=0
for v in "${ALL_PG[@]:-}"; do
  if echo "$v" | grep -qi postgres; then
    pg_count=$((pg_count + 1))
  fi
done
if (( pg_count > 1 )); then
  echo ""
  yellow "⚠ 检测到多个 Postgres 相关卷。升级不会删库，但若当前挂的是空卷，会像「数据被重置」。"
  yellow "  若刚出现示例数据 / 安装向导：请立刻执行："
  echo "    bash scripts/recover-volume.sh"
  echo ""
fi

if ! docker volume inspect "$EXPECTED_PG" >/dev/null 2>&1; then
  yellow "⚠ 卷 $EXPECTED_PG 尚不存在：首次 up 时会创建空库。"
  if (( pg_count >= 1 )); then
    yellow "  本机已有其它卷，更可能是名字不匹配。请先："
    echo "    bash scripts/recover-volume.sh"
    yellow "  再继续升级（Ctrl+C 中止，或 5 秒后自动继续）…"
    sleep 5 || true
  fi
fi

info "同步代码"
if [[ -n "$REF" ]]; then
  git fetch --tags origin 2>/dev/null || git fetch --tags
  git checkout "$REF"
else
  git pull --ff-only origin main 2>/dev/null || git pull --ff-only || true
fi

info "确保数据库/缓存容器在跑（不强制重建、不 down -v）"
# --no-recreate：已存在则保持
compose up -d --no-recreate postgres redis 2>/dev/null \
  || compose up -d postgres redis

info "仅构建并滚动应用 cardkey（不动 postgres 数据卷；会重建前端静态）"
# --no-cache 前端阶段可选：默认缓存加速；UI 不更新时加: CARDKEY_BUILD_NO_CACHE=1
if [[ "${CARDKEY_BUILD_NO_CACHE:-}" == "1" ]]; then
  compose build --no-cache cardkey
else
  compose build cardkey
fi

# entrypoint 优先执行数据卷 /app/data/bin/cardkey（一键更新写入）。
# 若不清除，compose build 出的新镜像会被旧 exe 盖住 → UI/API 仍像旧版（例如 radix forwardRef）。
# 只删 bin 内可执行文件，不动 uploads / postgres。
info "清除数据卷内旧一键更新二进制（使本次镜像生效）"
APP_VOL="$(get_env APP_VOLUME_NAME)"
APP_VOL="${APP_VOL:-cardkey_app_data}"
# 常见历史卷名：compose project 前缀不同 / 旧部署
CANDIDATE_VOLS=("$APP_VOL" cardkey_app_data cardkey_cardkey_data)
# 也尝试当前 compose 挂载的卷（若容器已存在）
if compose ps -q cardkey >/dev/null 2>&1; then
  while IFS= read -r vn; do
    [[ -n "$vn" ]] && CANDIDATE_VOLS+=("$vn")
  done < <(docker inspect "$(compose ps -q cardkey 2>/dev/null | head -1)" --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)
fi
# 去重
declare -A _seen_vol=()
for v in "${CANDIDATE_VOLS[@]}"; do
  [[ -z "$v" || -n "${_seen_vol[$v]:-}" ]] && continue
  _seen_vol[$v]=1
  if docker volume inspect "$v" >/dev/null 2>&1; then
    if docker run --rm -v "${v}:/data" alpine sh -c 'test -f /data/bin/cardkey && rm -f /data/bin/cardkey && echo removed || echo none' 2>/dev/null | grep -q removed; then
      green "  已删除卷 $v 内 /bin/cardkey"
    fi
  fi
done
# 若容器在跑且能 exec，再保险删一次（挂载点可能用了别的卷名）
compose exec -T -u root cardkey sh -c 'rm -f /app/data/bin/cardkey' 2>/dev/null || true

compose up -d --no-deps --force-recreate cardkey

# 启动后快速看库是否空（有 admin 才算已安装）
echo ""
info "检查库是否像「空库 / 新卷」…"
sleep 3
if compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
  PG_USER="$(get_env POSTGRES_USER)"; PG_USER="${PG_USER:-cardkey}"
  PG_DB="$(get_env POSTGRES_DB)"; PG_DB="${PG_DB:-cardkey}"
  admin_n="$(compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc 'SELECT COUNT(*) FROM admins' 2>/dev/null | tr -d '[:space:]' || echo "?")"
  cat_n="$(compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc 'SELECT COUNT(*) FROM categories' 2>/dev/null | tr -d '[:space:]' || echo "?")"
  echo "  admins=$admin_n  categories=$cat_n  volume=$EXPECTED_PG"
  if [[ "$admin_n" == "0" ]]; then
    red "当前库没有管理员 —— 多半挂了空卷，或尚未完成安装向导。"
    yellow "找回旧数据: bash scripts/recover-volume.sh"
  elif [[ "$cat_n" == "0" ]]; then
    yellow "有管理员但无类别（正常，若你删光了类别）。启动时不再自动灌示例数据。"
  else
    green "库状态正常（非空）。"
  fi
else
  yellow "暂时无法连接 postgres 做计数检查，请自行: docker compose logs postgres --tail 50"
fi

echo ""
info "验证本次进程与前端资源（本机 loopback，绕过 CDN）"
compose logs cardkey --tail 15 2>/dev/null | sed 's/^/  /' || true
# 健康检查
if curl -sfS --max-time 5 "http://127.0.0.1:18080/healthz" >/dev/null 2>&1 \
  || curl -sfS --max-time 5 "http://127.0.0.1:8080/healthz" >/dev/null 2>&1; then
  green "  healthz OK"
else
  yellow "  healthz 未通：请 docker compose logs cardkey --tail 40"
fi
# index 不应再引用 radix-*.js（0.1.55 坏包特征）
IDX=""
for port in 18080 8080; do
  IDX="$(curl -sfS --max-time 5 "http://127.0.0.1:${port}/" 2>/dev/null || true)"
  [[ -n "$IDX" ]] && break
done
if [[ -n "$IDX" ]]; then
  if echo "$IDX" | grep -qE 'radix-[A-Za-z0-9_-]+\.js'; then
    red "  index.html 仍引用 radix-*.js —— 进程可能仍是旧二进制，请检查卷内 /app/data/bin/cardkey"
  else
    green "  index.html 无 radix 分片（符合 0.1.56+）"
  fi
  echo "$IDX" | grep -oE 'assets/[^"]+\.js' | head -8 | sed 's/^/    /' || true
fi

echo ""
green "升级完成。未执行 docker compose down -v。"
yellow "UI：本脚本已 build 镜像并清除卷内旧一键更新 exe。"
yellow "浏览器：Ctrl+F5 强刷；若前面有 Cloudflare，控制台「缓存」→ 清除全部。"
echo "危险命令（切勿）: docker compose down -v / docker volume rm / docker system prune --volumes"
echo "数据说明: deploy/DATA_SAFETY.md"
