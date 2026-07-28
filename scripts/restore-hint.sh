#!/usr/bin/env bash
# 仅打印恢复提示，避免误操作。真实恢复请人工确认后执行。
set -euo pipefail
if [[ $# -lt 1 ]]; then
  echo "用法: bash scripts/restore-hint.sh backup.sql" >&2
  exit 1
fi
F="$1"
echo "将执行（请确认无误后再手动跑）："
echo "  cat $(printf %q "$F") | docker compose exec -T postgres psql -U \"\${POSTGRES_USER:-cardkey}\" \"\${POSTGRES_DB:-cardkey}\""
echo "恢复前建议先备份当前库；勿 docker compose down -v。"
