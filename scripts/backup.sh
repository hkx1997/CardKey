#!/usr/bin/env bash
# 备份 Postgres（不碰卷删除）。用法：
#   bash scripts/backup.sh
#   bash scripts/backup.sh /path/to/dir
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/cardkey-$STAMP.sql"
echo "==> pg_dump → $FILE"
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-cardkey}" "${POSTGRES_DB:-cardkey}" >"$FILE"
# 提醒密钥
cat <<EOF
OK: $FILE
注意：恢复后仍需同一 CONTENT_KEY / JWT_SECRET（.env），否则卡密密文无法解密。
恢复示例：
  cat $FILE | docker compose exec -T postgres psql -U ${POSTGRES_USER:-cardkey} ${POSTGRES_DB:-cardkey}
EOF
