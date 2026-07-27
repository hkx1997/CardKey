#!/usr/bin/env bash
# CardKey binary install (systemd) — 对齐 sub2api 体验
set -euo pipefail

REPO_OWNER="${CARDKEY_GITHUB_OWNER:-}"
REPO_NAME="${CARDKEY_GITHUB_REPO:-CardKey}"
INSTALL_DIR="${CARDKEY_INSTALL_DIR:-/opt/cardkey}"
SERVICE_NAME="cardkey"
BIN_NAME="cardkey"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info() { printf '==> %s\n' "$*"; }

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    red "请使用 root 运行: curl ... | sudo bash"
    exit 1
  fi
}

detect_arch() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) red "不支持的架构: $arch"; exit 1 ;;
  esac
}

cmd_install() {
  need_root
  local arch os asset
  arch="$(detect_arch)"
  os="linux"
  asset="cardkey-${os}-${arch}"

  if [[ -z "$REPO_OWNER" ]]; then
    red "请设置 CARDKEY_GITHUB_OWNER=你的 GitHub 用户/组织"
    exit 1
  fi

  info "安装目录 $INSTALL_DIR"
  mkdir -p "$INSTALL_DIR/releases" /etc/cardkey
  id -u cardkey >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d "$INSTALL_DIR" cardkey

  local api="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
  local hdr=()
  if [[ -n "${GITHUB_TOKEN:-}${CARDKEY_GITHUB_TOKEN:-}" ]]; then
    hdr=(-H "Authorization: Bearer ${GITHUB_TOKEN:-$CARDKEY_GITHUB_TOKEN}")
  fi
  info "获取最新 Release…"
  local json url tag
  json="$(curl -fsSL "${hdr[@]}" -H "Accept: application/vnd.github+json" "$api")"
  tag="$(echo "$json" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
  url="$(echo "$json" | tr ',' '\n' | grep -o "https://[^\"]*${asset}[^\"]*" | head -1 || true)"
  if [[ -z "$url" ]]; then
    red "Release 中未找到资产 $asset ，请检查 CI 发布命名"
    exit 1
  fi
  info "下载 $tag → $asset"
  local dest="$INSTALL_DIR/releases/${tag#v}/cardkey"
  mkdir -p "$(dirname "$dest")"
  curl -fsSL "${hdr[@]}" -o "$dest" "$url"
  chmod 755 "$dest"
  cp -f "$dest" "$INSTALL_DIR/$BIN_NAME"
  chown -R cardkey:cardkey "$INSTALL_DIR"

  if [[ ! -f /etc/cardkey/env ]]; then
    info "生成 /etc/cardkey/env"
    umask 077
    cat >/etc/cardkey/env <<EOF
HTTP_ADDR=:8080
APP_ENV=production
DATABASE_URL=postgres://cardkey:CHANGE_ME@127.0.0.1:5432/cardkey?sslmode=disable
REDIS_URL=redis://127.0.0.1:6379/0
JWT_SECRET=$(openssl rand -hex 32)
CONTENT_KEY=$(openssl rand -hex 32)
BOOTSTRAP_ADMIN_USER=admin
BOOTSTRAP_ADMIN_PASS=
UPDATE_MODE=binary
UPDATE_GITHUB_OWNER=${REPO_OWNER}
UPDATE_GITHUB_REPO=${REPO_NAME}
UPDATE_BINARY_PATH=${INSTALL_DIR}/${BIN_NAME}
UPDATE_RELEASES_DIR=${INSTALL_DIR}/releases
MIGRATIONS_DIR=${INSTALL_DIR}/migrations
STATIC_DIR=${INSTALL_DIR}/static
EOF
    # 若有随 Release 打包的 migrations/static，请另行解压到 INSTALL_DIR
    chmod 600 /etc/cardkey/env
  fi

  cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=CardKey
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=cardkey
Group=cardkey
EnvironmentFile=/etc/cardkey/env
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/${BIN_NAME}
Restart=always
RestartSec=2
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now ${SERVICE_NAME}
  green "安装完成。查看日志: journalctl -u ${SERVICE_NAME} -f"
  green "管理后台: http://<host>:8080/admin （管理员密码见首次启动日志）"
}

cmd_uninstall() {
  need_root
  systemctl disable --now ${SERVICE_NAME} 2>/dev/null || true
  rm -f /etc/systemd/system/${SERVICE_NAME}.service
  systemctl daemon-reload
  green "已停止服务。数据目录 ${INSTALL_DIR} 与 /etc/cardkey 请手动删除。"
}

case "${1:-install}" in
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  *) echo "usage: $0 [install|uninstall]"; exit 1 ;;
esac
