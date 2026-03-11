# Deploy VPS V1

## 1. Push repository

```bash
git add .
git commit -m "V1 ready for VPS"
git push origin main
```

## 2. Prepare VPS

```bash
sudo mkdir -p /var/www/import-stock-v1
```

Clone once:

```bash
cd /var/www
sudo git clone https://github.com/Thomas18112001/import-stock-v1.git import-stock-v1
sudo chown -R appuser:appuser /var/www/import-stock-v1
```

## 3. Configure environment

Create `.env` from `.env.example` with production values:

- `NODE_ENV=production`
- `PORT=3001`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL=https://<your-v1-domain>`
- `SCOPES=...`
- `SHOP=<your-dev-store>.myshopify.com`
- `PRESTA_BASE_URL`
- `PRESTA_ALLOWED_HOST`
- `PRESTA_WS_KEY`
- `PRESTA_BOUTIQUE_CUSTOMER_ID`
- `SHOPIFY_SESSION_DB_PATH=/var/lib/import-stock-v1/shopify_sessions.sqlite`
- `CRON_SECRET` (generate with `npm run cron:secret`)

Generate CRON secret:

```bash
cd /var/www/import-stock-v1
npm run cron:secret
```

## 4. Deploy app/service/nginx

```bash
cd /var/www/import-stock-v1
sudo APP_DIR=/var/www/import-stock-v1 \
  DOMAIN=<your-v1-domain> \
  APP_PORT=3001 \
  REPO_URL=https://github.com/Thomas18112001/import-stock-v1.git \
  ./scripts/deploy_vps_v1.sh
```

## 5. Configure cron

```bash
cd /var/www/import-stock-v1
sudo SHOP=<shop>.myshopify.com \
  LOCATION_ID=gid://shopify/Location/<id> \
  CRON_SECRET=<secret> \
  APP_URL=https://<your-v1-domain> \
  ./scripts/install_cron_v1.sh
```

By default it runs every 15 minutes. Override with `SCHEDULE` if needed.
The cron endpoint used by V1 is `/api/cron/synchroniser`.

## 6. Validate runtime

Check:

```bash
sudo systemctl status import-stock-v1
sudo nginx -t
curl -I https://<your-v1-domain>
```

Functional checks in Shopify:

- dashboard loads
- manual import by ID
- manual import by reference (split orders imported together)
- grouped display in `Voir toutes les commandes`
- receive one sub-order independently
- rollback and delete rules

## 7. Shopify app config

Before final production use:

- set correct `application_url` and redirects in `shopify.app.toml`
- run `shopify app deploy`
- reinstall app on target store if scopes changed
