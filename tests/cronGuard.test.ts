import test from "node:test";
import assert from "node:assert/strict";

async function loadCronGuard() {
  process.env.CRON_SECRET = process.env.CRON_SECRET || "top-secret";
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || "test-key";
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "test-secret";
  process.env.SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL || "https://example.test";
  process.env.SCOPES =
    process.env.SCOPES ||
    "read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects,read_locations,read_products,read_inventory,write_inventory";
  process.env.PRESTA_BASE_URL = process.env.PRESTA_BASE_URL || "https://btob.wearmoi.com";
  process.env.PRESTA_WS_KEY = process.env.PRESTA_WS_KEY || "test-key";
  process.env.PRESTA_BOUTIQUE_CUSTOMER_ID = process.env.PRESTA_BOUTIQUE_CUSTOMER_ID || "21749";
  process.env.SHOPIFY_DEFAULT_LOCATION_NAME = process.env.SHOPIFY_DEFAULT_LOCATION_NAME || "Boutique Toulon";
  process.env.SYNC_BATCH_SIZE = process.env.SYNC_BATCH_SIZE || "50";
  process.env.SYNC_MAX_PER_RUN = process.env.SYNC_MAX_PER_RUN || "200";
  return import("../app/services/cron-guard.server");
}

test("cron secret accepte le header X-CRON-SECRET", async () => {
  const { assertCronSecret } = await loadCronGuard();
  const request = new Request("https://example.com/api/cron/synchroniser", {
    headers: { "X-CRON-SECRET": "top-secret" },
  });

  assert.doesNotThrow(() => assertCronSecret(request, "top-secret"));
});

test("cron secret refuse la query cron_secret", async () => {
  const { assertCronSecret } = await loadCronGuard();
  const request = new Request("https://example.com/api/cron/synchroniser?cron_secret=top-secret");

  assert.throws(
    () => assertCronSecret(request, "top-secret"),
    (error: unknown) => error instanceof Response && error.status === 401,
  );
});

test("cron secret refuse un secret absent ou invalide", async () => {
  const { assertCronSecret } = await loadCronGuard();
  const missing = new Request("https://example.com/api/cron/synchroniser");
  const wrong = new Request("https://example.com/api/cron/synchroniser", {
    headers: { "X-CRON-SECRET": "wrong" },
  });

  assert.throws(
    () => assertCronSecret(missing, "top-secret"),
    (error: unknown) => error instanceof Response && error.status === 401,
  );
  assert.throws(
    () => assertCronSecret(wrong, "top-secret"),
    (error: unknown) => error instanceof Response && error.status === 401,
  );
});

test("route cron sync refuse un shop invalide", async () => {
  await loadCronGuard();
  process.env.CRON_SECRET = "top-secret";
  const mod = await import("../app/routes/api.cron.sync");
  const originalNow = Date.now;
  Date.now = () => 60_001;
  try {
    const response = await mod.loader({
      request: new Request("https://example.com/api/cron/synchroniser?shop=invalid&locationId=gid://shopify/Location/1", {
        headers: { "X-CRON-SECRET": "top-secret" },
      }),
      params: {},
      context: {},
    } as never);

    assert.equal(response.status, 400);
  } finally {
    Date.now = originalNow;
  }
});

test("route cron sync refuse une boutique invalide", async () => {
  await loadCronGuard();
  process.env.CRON_SECRET = "top-secret";
  const mod = await import("../app/routes/api.cron.sync");
  const originalNow = Date.now;
  Date.now = () => 120_002;
  try {
    const response = await mod.loader({
      request: new Request("https://example.com/api/cron/synchroniser?shop=demo.myshopify.com&locationId=invalid", {
        headers: { "X-CRON-SECRET": "top-secret" },
      }),
      params: {},
      context: {},
    } as never);

    assert.equal(response.status, 400);
  } finally {
    Date.now = originalNow;
  }
});
