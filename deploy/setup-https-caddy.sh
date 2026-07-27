#!/usr/bin/env bash
# CardKey + Cloudflare：Caddy 反代 HTTPS
# 用法见脚本末尾 help，或 README
set -euo pipefail

DOMAIN="${1:-}"
CERT="${2:-}"
KEY="${3:-}"
UPSTREAM="${UPSTREAM:-127.0.0.1:18080}"
APP_DIR="${APP_DIR:-}"
EMAIL="${ACME_EMAIL:-}"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }

usage() {
  cat <<'EOF'
CardKey Cloudflare HTTPS（Caddy 反代）

用法:
  # 使用 Cloudflare Origin 证书（推荐 Full strict）
  sudo bash deploy/setup-https-caddy.sh carkey.ai-service.top /path/origin.pem /path/origin.key

  # 或把证书放到默认路径后:
  #   /etc/cardkey/tls/cert.pem
  #   /etc/cardkey/tls/key.pem
  sudo bash deploy/setup-https-caddy.sh carkey.ai-service.top

  # Let's Encrypt 自动证书（域名需能直连 80/443；CF 建议 DNS only 灰云 或用 DNS 挑战）
  sudo ACME_EMAIL=you@example.com bash deploy/setup-https-caddy.sh carkey.ai-service.top auto

环境变量:
  UPSTREAM=127.0.0.1:18080   后端地址
  APP_DIR=/root/CardKey      项目目录（自动改 .env）
EOF
  exit 1
}

[[ -z "$DOMAIN" ]] && usage
[[ "$(id -u)" -ne 0 ]] && { red "请使用 root: sudo bash $0 ..."; exit 1; }

# 解析项目目录
if [[ -z "$APP_DIR" ]]; then
  for d in /root/CardKey "$HOME/CardKey" /opt/cardkey "$(pwd)"; do
    if [[ -f "$d/docker-compose.yml" ]]; then APP_DIR="$d"; break; fi
  done
fi

# 证书模式
MODE="origin"
if [[ "${CERT:-}" == "auto" || "${CERT:-}" == "acme" ]]; then
  MODE="acme"
  CERT=""
  KEY=""
fi

if [[ "$MODE" == "origin" ]]; then
  CERT="${CERT:-/etc/cardkey/tls/cert.pem}"
  KEY="${KEY:-/etc/cardkey/tls/key.pem}"
  if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
    red "找不到证书文件:"
    red "  CERT=$CERT"
    red "  KEY=$KEY"
    echo ""
    yellow "请先在 Cloudflare 创建 Origin Certificate："
    yellow "  SSL/TLS → Origin Server → Create Certificate"
    yellow "  保存证书为 cert.pem、私钥为 key.pem，例如："
    yellow "  mkdir -p /etc/cardkey/tls"
    yellow "  nano /etc/cardkey/tls/cert.pem   # 粘贴公钥证书"
    yellow "  nano /etc/cardkey/tls/key.pem    # 粘贴私钥"
    yellow "  chmod 600 /etc/cardkey/tls/key.pem"
    yellow "然后重新执行本脚本。"
    exit 1
  fi
  chmod 644 "$CERT" 2>/dev/null || true
  chmod 600 "$KEY" 2>/dev/null || true
fi

# 安装 Caddy（优先 GitHub 二进制，避免 cloudsmith apt 源卡住）
install_caddy_binary() {
  local arch
  case "$(uname -m)" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) red "不支持的架构: $(uname -m)"; return 1 ;;
  esac
  local ver="${CADDY_VERSION:-2.9.1}"
  local name="caddy_${ver}_linux_${arch}.tar.gz"
  local url="https://github.com/caddyserver/caddy/releases/download/v${ver}/${name}"
  local mirror="https://ghfast.top/${url}"
  local tmp
  tmp="$(mktemp -d)"
  info "下载 Caddy 二进制 v${ver} (${arch})…"
  if ! curl -fL --connect-timeout 15 --max-time 120 -o "$tmp/caddy.tgz" "$url" 2>/dev/null; then
    yellow "GitHub 直连失败，尝试镜像…"
    if ! curl -fL --connect-timeout 15 --max-time 120 -o "$tmp/caddy.tgz" "$mirror"; then
      rm -rf "$tmp"
      return 1
    fi
  fi
  tar -xzf "$tmp/caddy.tgz" -C "$tmp" caddy
  install -m 755 "$tmp/caddy" /usr/bin/caddy
  rm -rf "$tmp"
  # systemd unit（若无包管理安装）
  if [[ ! -f /etc/systemd/system/caddy.service && ! -f /lib/systemd/system/caddy.service ]]; then
    id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --shell /usr/sbin/nologin caddy 2>/dev/null || true
    mkdir -p /etc/caddy /var/lib/caddy /var/log/caddy
    chown -R caddy:caddy /var/lib/caddy /var/log/caddy 2>/dev/null || true
    cat >/etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
Documentation=https://caddyserver.com/docs/
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
LimitNPROC=512
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT
    # 允许读证书
    mkdir -p /etc/cardkey/tls
    # caddy 用户读 key：用 group 或 Capability 已够 bind 443；证书给 o+r key 保持 600 则用 root 跑更简单
    # 若 key 600 且属 root，Caddy 以 caddy 用户读不到 → 改为 root 运行反代更省事
    sed -i 's/^User=caddy/#User=caddy/' /etc/systemd/system/caddy.service
    sed -i 's/^Group=caddy/#Group=caddy/' /etc/systemd/system/caddy.service
    systemctl daemon-reload
  fi
  green "Caddy 二进制安装完成: $(caddy version 2>/dev/null | head -1)"
  return 0
}

if ! command -v caddy >/dev/null 2>&1; then
  info "安装 Caddy（优先二进制，避免 apt 源卡住）…"
  if ! install_caddy_binary; then
    yellow "二进制安装失败，尝试 apt（可能较慢，Ctrl+C 可中断后手动装）…"
    if command -v apt-get >/dev/null 2>&1; then
      export DEBIAN_FRONTEND=noninteractive
      timeout 60 apt-get update -qq || true
      if ! timeout 180 apt-get install -y -qq caddy 2>/dev/null; then
        red "自动安装 Caddy 失败。"
        red "请手动执行后重跑本脚本："
        red "  curl -fL https://github.com/caddyserver/caddy/releases/download/v2.9.1/caddy_2.9.1_linux_amd64.tar.gz -o /tmp/c.tgz"
        red "  tar -xzf /tmp/c.tgz -C /tmp caddy && install -m 755 /tmp/caddy /usr/bin/caddy"
        exit 1
      fi
    else
      red "请手动安装 Caddy 后重跑脚本"
      exit 1
    fi
  fi
else
  green "已检测到 Caddy: $(caddy version 2>/dev/null | head -1 || echo ok)"
fi

mkdir -p /etc/caddy
if [[ "$MODE" == "origin" ]]; then
  cat >/etc/caddy/Caddyfile <<EOF
# CardKey reverse proxy — Cloudflare Origin Certificate
${DOMAIN} {
	tls ${CERT} ${KEY}
	encode gzip
	reverse_proxy ${UPSTREAM} {
		header_up X-Forwarded-Proto {scheme}
		header_up X-Forwarded-Host {host}
		header_up X-Real-IP {remote_host}
	}
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
	}
}
EOF
else
  EMAIL_LINE=""
  [[ -n "$EMAIL" ]] && EMAIL_LINE="email ${EMAIL}"
  cat >/etc/caddy/Caddyfile <<EOF
# CardKey reverse proxy — Let's Encrypt
{
	${EMAIL_LINE}
}
${DOMAIN} {
	encode gzip
	reverse_proxy ${UPSTREAM} {
		header_up X-Forwarded-Proto {scheme}
		header_up X-Forwarded-Host {host}
		header_up X-Real-IP {remote_host}
	}
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
	}
}
EOF
fi

info "校验 Caddyfile…"
caddy validate --config /etc/caddy/Caddyfile

systemctl enable caddy
systemctl restart caddy
sleep 1
systemctl --no-pager --full status caddy | head -20 || true

# 更新 CardKey .env
if [[ -n "${APP_DIR:-}" && -f "$APP_DIR/.env" ]]; then
  info "更新 $APP_DIR/.env（CORS / Cookie）…"
  ENVF="$APP_DIR/.env"
  # CORS
  if grep -q '^CORS_ORIGINS=' "$ENVF"; then
    sed -i.bak "s|^CORS_ORIGINS=.*|CORS_ORIGINS=https://${DOMAIN},http://${DOMAIN}|" "$ENVF"
  else
    echo "CORS_ORIGINS=https://${DOMAIN},http://${DOMAIN}" >>"$ENVF"
  fi
  # Secure cookie
  if grep -q '^SECURE_COOKIE=' "$ENVF"; then
    sed -i.bak "s|^SECURE_COOKIE=.*|SECURE_COOKIE=true|" "$ENVF"
  else
    echo "SECURE_COOKIE=true" >>"$ENVF"
  fi
  if grep -q '^TRUST_PROXY=' "$ENVF"; then
    sed -i.bak "s|^TRUST_PROXY=.*|TRUST_PROXY=true|" "$ENVF"
  else
    echo "TRUST_PROXY=true" >>"$ENVF"
  fi
  rm -f "${ENVF}.bak"
  if [[ -f "$APP_DIR/docker-compose.yml" ]]; then
    (cd "$APP_DIR" && docker compose up -d cardkey) || true
  fi
  green "已设置 SECURE_COOKIE=true 与 CORS_ORIGINS=https://${DOMAIN}"
fi

echo ""
green "========================================"
green "  HTTPS 已配置"
green "  https://${DOMAIN}/"
green "  https://${DOMAIN}/admin"
green "========================================"
echo ""
yellow "Cloudflare 控制台请确认："
yellow "  1. DNS：A/AAAA → 服务器 IP，代理状态「已代理」(橙云)"
yellow "  2. SSL/TLS 模式：Full 或 Full (strict)  [Origin 证书用 Full strict]"
yellow "  3. 管理端「系统设置 → API → 对外 API 地址」填：https://${DOMAIN}"
echo ""
