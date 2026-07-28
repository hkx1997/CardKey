#!/bin/sh
# Docker 入口：优先启动数据卷上的一键更新二进制，保证 UI/API 与镜像层解耦
set -e
DATA_DIR="${DATA_DIR:-/app/data}"
PERSIST="${DATA_DIR}/bin/cardkey"
IMAGE_BIN="${CARDKEY_IMAGE_BIN:-/app/cardkey}"
# 与发版门禁一致：空壳约 11–12MB，完整包 ≥13MB
MIN_BYTES=13000000

if [ -f "$PERSIST" ] && [ -x "$PERSIST" ]; then
  sz=$(wc -c < "$PERSIST" 2>/dev/null || echo 0)
  if [ "${sz:-0}" -ge "$MIN_BYTES" ]; then
    exec "$PERSIST" "$@"
  fi
  echo "cardkey entrypoint: persist binary too small (${sz} bytes < ${MIN_BYTES}), using image binary" >&2
fi
exec "$IMAGE_BIN" "$@"
