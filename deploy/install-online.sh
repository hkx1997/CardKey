#!/usr/bin/env bash
# 在线一键安装：克隆仓库并进入交互配置
# curl -fsSL https://raw.githubusercontent.com/hkx1997/CardKey/main/deploy/install-online.sh | bash
set -euo pipefail

REPO_URL="${CARDKEY_REPO:-https://github.com/hkx1997/CardKey.git}"
INSTALL_DIR="${CARDKEY_DIR:-$HOME/cardkey}"
BRANCH="${CARDKEY_BRANCH:-main}"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }

if ! command -v docker >/dev/null 2>&1; then
  red "请先安装 Docker: https://docs.docker.com/get-docker/"
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  red "请先安装 git"
  exit 1
fi

if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "更新已有目录 $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" || true
else
  info "克隆 $REPO_URL → $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
chmod +x deploy/docker-deploy.sh deploy/install.sh 2>/dev/null || true
info "进入交互安装…"
# 保留 stdin，便于交互（curl|bash 时通常无 TTY，脚本会自动非交互）
exec bash deploy/docker-deploy.sh "$@"
