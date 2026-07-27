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

# 安装 Caddy
if ! command -v caddy >/dev/null 2>&1; then
  info "安装 Caddy…"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    apt-get update -qq
    apt-get install -y -qq caddy
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y caddy
  else
    red "请手动安装 Caddy: https://caddyserver.com/docs/install"
    exit 1
  fi
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
