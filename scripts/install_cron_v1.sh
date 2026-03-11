#!/usr/bin/env bash
set -euo pipefail

# Usage:
# SHOP=woora-app-2.myshopify.com
# LOCATION_ID=gid://shopify/Location/123456789  # optional if SHOPIFY_DEFAULT_LOCATION_NAME is configured
# CRON_SECRET=<secret>
# APP_URL=https://import-stock-v1.example.com
# ./scripts/install_cron_v1.sh

SHOP="${SHOP:-}"
LOCATION_ID="${LOCATION_ID:-}"
CRON_SECRET="${CRON_SECRET:-}"
APP_URL="${APP_URL:-}"
SCHEDULE="${SCHEDULE:-*/15 * * * *}"

if [[ -z "${SHOP}" || -z "${CRON_SECRET}" || -z "${APP_URL}" ]]; then
  echo "Missing required env vars: SHOP, CRON_SECRET, APP_URL" >&2
  exit 1
fi

CRON_FILE="/etc/cron.d/import-stock-v1"
CRON_CMD="curl -fsS -X POST -H \"X-CRON-SECRET: ${CRON_SECRET}\" -d \"shop=${SHOP}\""

if [[ -n "${LOCATION_ID}" ]]; then
  CRON_CMD="${CRON_CMD} -d \"locationId=${LOCATION_ID}\""
fi

CRON_CMD="${CRON_CMD} \"${APP_URL}/api/cron/synchroniser\" >/dev/null"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo/root." >&2
  exit 1
fi

cat > "${CRON_FILE}" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
${SCHEDULE} root ${CRON_CMD}
EOF

chmod 0644 "${CRON_FILE}"
systemctl restart cron
echo "Cron installed in ${CRON_FILE}"
