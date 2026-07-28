#!/bin/sh
# Docker 入口：优先启动数据卷上的一键更新二进制，保证 UI/API 与镜像层解耦
set -e
DATA_DIR="${DATA_DIR:-/app/data}"
PERSIST="${DATA_DIR}/bin/cardkey"
IMAGE_BIN="${CARDKEY_IMAGE_BIN:-/app/cardkey}"

if [ -f "$PERSIST" ] && [ -x "$PERSIST" ]; then
  # 粗略校验：不可为空文件
  sz=$(wc -c < "$PERSIST" 2>/dev/null || echo 0)
  if [ "${sz:-0}" -gt 1000000 ]; then
    exec "$PERSIST" "$@"
  fi
fi
exec "$IMAGE_BIN" "$@"
