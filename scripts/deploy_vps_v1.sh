#!/usr/bin/env bash
set -euo pipefail

# Usage:
# APP_DIR=/var/www/import-stock-v1 DOMAIN=import-stock-v1.example.com REPO_URL=https://github.com/<user>/import-stock-v1.git sudo ./scripts/deploy_vps_v1.sh

APP_USER="${APP_USER:-appuser}"
APP_GROUP="${APP_GROUP:-appuser}"
APP_DIR="${APP_DIR:-/var/www/import-stock-v1}"
REPO_URL="${REPO_URL:-https://github.com/Thomas18112001/import-stock-v1.git}"
DOMAIN="${DOMAIN:-import-stock-v1.example.com}"
SERVICE_NAME="${SERVICE_NAME:-import-stock-v1}"
APP_PORT="${APP_PORT:-3001}"
NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
SERVICE_TARGET="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo/root." >&2
  exit 1
fi

echo "[1/11] Install packages"
apt-get update -y
apt-get install -y git nginx ufw certbot python3-certbot-nginx curl

echo "[2/11] Ensure app user"
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "${APP_USER}"
fi

echo "[3/11] Ensure Node.js/npm exist"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing. Install Node LTS first, then rerun." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is missing. Install Node LTS first, then rerun." >&2
  exit 1
fi

echo "[4/11] Clone or refresh repository"
mkdir -p /var/www
if [[ ! -d "${APP_DIR}/.git" ]]; then
  rm -rf "${APP_DIR}"
  git clone "${REPO_URL}" "${APP_DIR}"
else
  git -C "${APP_DIR}" fetch --all --prune
  git -C "${APP_DIR}" pull --ff-only
fi
chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}"

echo "[5/11] Validate .env"
if [[ ! -f "${APP_DIR}/.env" ]]; then
  echo "Missing ${APP_DIR}/.env. Create it from .env.example before continuing." >&2
  exit 1
fi
if ! grep -q '^CRON_SECRET=' "${APP_DIR}/.env"; then
  echo "Missing CRON_SECRET in .env." >&2
  exit 1
fi

echo "[6/11] Install deps and build"
su - "${APP_USER}" -c "cd ${APP_DIR} && npm ci"
su - "${APP_USER}" -c "cd ${APP_DIR} && npm run build"

echo "[7/11] Install systemd service"
sed \
  -e "s|/var/www/import-stock-v1|${APP_DIR}|g" \
  -e "s|User=appuser|User=${APP_USER}|g" \
  -e "s|Group=appuser|Group=${APP_GROUP}|g" \
  "${APP_DIR}/deploy/import-stock-v1.service.example" > "${SERVICE_TARGET}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "[8/11] Install nginx vhost"
sed \
  -e "s|import-stock-v1.example.com|${DOMAIN}|g" \
  -e "s|127.0.0.1:3001|127.0.0.1:${APP_PORT}|g" \
  "${APP_DIR}/deploy/nginx/import-stock-v1.example.conf" > "${NGINX_SITE}"
ln -sf "${NGINX_SITE}" "${NGINX_ENABLED}"
nginx -t
systemctl reload nginx

echo "[9/11] Open firewall"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

echo "[10/11] TLS certificate"
if certbot certificates | grep -q "Domains: ${DOMAIN}"; then
  echo "Certificate already exists for ${DOMAIN}"
else
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email || {
    echo "Automatic certbot failed. Run manually:"
    echo "  sudo certbot --nginx -d ${DOMAIN}"
  }
fi

echo "[11/11] Status check"
systemctl --no-pager --full status "${SERVICE_NAME}" | sed -n '1,16p'
ss -lntp | grep ":${APP_PORT}" || true
curl -I "https://${DOMAIN}" || true

echo "Deploy V1 completed."
