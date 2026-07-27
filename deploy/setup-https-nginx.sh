#!/usr/bin/env bash
# CardKey + Cloudflare Origin 证书 → Nginx HTTPS 反代
# 用法:
#   sudo bash deploy/setup-https-nginx.sh cardkey.ai-service.top
#   sudo bash deploy/setup-https-nginx.sh cardkey.ai-service.top /etc/cardkey/tls/cert.pem /etc/cardkey/tls/key.pem
set -euo pipefail

DOMAIN="${1:-cardkey.ai-service.top}"
CERT="${2:-/etc/cardkey/tls/cert.pem}"
KEY="${3:-/etc/cardkey/tls/key.pem}"
UPSTREAM="${UPSTREAM:-127.0.0.1:18080}"
APP_DIR="${APP_DIR:-}"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }

[[ "$(id -u)" -ne 0 ]] && { red "请用 root: sudo bash $0 ..."; exit 1; }

if [[ -z "$APP_DIR" ]]; then
  for d in /root/CardKey "$HOME/CardKey" /opt/cardkey "$(pwd)"; do
    [[ -f "$d/docker-compose.yml" ]] && APP_DIR="$d" && break
  done
fi

if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
  red "证书不存在: $CERT / $KEY"
  yellow "请先写入 Cloudflare Origin 证书后再执行"
  exit 1
fi
chmod 644 "$CERT" 2>/dev/null || true
chmod 600 "$KEY" 2>/dev/null || true

# 停掉 Caddy，避免占 80/443
if systemctl is-active --quiet caddy 2>/dev/null; then
  info "停止 Caddy（释放 80/443）…"
  systemctl stop caddy || true
  systemctl disable caddy || true
fi
if command -v caddy >/dev/null 2>&1 && pgrep -x caddy >/dev/null 2>&1; then
  pkill caddy || true
fi

# 安装 Nginx
if ! command -v nginx >/dev/null 2>&1; then
  info "安装 Nginx…"
  export DEBIAN_FRONTEND=noninteractive
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq nginx
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y nginx
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nginx
  else
    red "请手动安装 nginx 后重试"
    exit 1
  fi
fi

CONF_DIR="/etc/nginx/conf.d"
[[ -d /etc/nginx/sites-available ]] && CONF_DIR="/etc/nginx/sites-available"
SITE_FILE="${CONF_DIR}/cardkey.conf"

info "写入 Nginx 配置 → $SITE_FILE"
cat >"$SITE_FILE" <<EOF
# CardKey — Cloudflare Origin Certificate
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     ${CERT};
    ssl_certificate_key ${KEY};
    ssl_session_timeout 1d;
    ssl_session_cache   shared:SSL:10m;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # 安全头
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;

    client_max_body_size 20m;

    location / {
        proxy_pass http://${UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host  \$host;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
EOF

# Debian/Ubuntu sites-enabled
if [[ -d /etc/nginx/sites-enabled ]]; then
  ln -sfn "$SITE_FILE" /etc/nginx/sites-enabled/cardkey.conf
  # 关掉默认站点避免抢 server_name
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
fi

info "检测配置…"
nginx -t

systemctl enable nginx
systemctl restart nginx
sleep 1
systemctl --no-pager status nginx | head -15 || true

# 更新 .env
if [[ -n "${APP_DIR:-}" && -f "$APP_DIR/.env" ]]; then
  info "更新 $APP_DIR/.env …"
  ENVF="$APP_DIR/.env"
  if grep -q '^CORS_ORIGINS=' "$ENVF"; then
    sed -i.bak "s|^CORS_ORIGINS=.*|CORS_ORIGINS=https://${DOMAIN},http://${DOMAIN}|" "$ENVF"
  else
    echo "CORS_ORIGINS=https://${DOMAIN},http://${DOMAIN}" >>"$ENVF"
  fi
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
  (cd "$APP_DIR" && docker compose up -d cardkey) 2>/dev/null || true
fi

echo ""
green "========================================"
green "  Nginx HTTPS 已就绪"
green "  https://${DOMAIN}/"
green "  https://${DOMAIN}/admin"
green "========================================"
yellow "Cloudflare: DNS 橙云 + SSL 模式 Full (strict)"
yellow "管理端设置 API 对外地址: https://${DOMAIN}"
echo ""
