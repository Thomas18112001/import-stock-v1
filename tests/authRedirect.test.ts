import test from "node:test";
import assert from "node:assert/strict";

async function loadAuthServer() {
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
  return import("../app/services/auth.server");
}

test("buildAuthLoginPath preserves embedded params already present", async () => {
  const { buildAuthLoginPath } = await loadAuthServer();
  const request = new Request("https://app.test/tableau-de-bord?shop=demo.myshopify.com&host=abc123&embedded=1");
  assert.equal(
    buildAuthLoginPath(request),
    "/auth/login?shop=demo.myshopify.com&host=abc123&embedded=1",
  );
});

test("buildAuthLoginPath rebuilds host from shop when first embedded hit has no host", async () => {
  const { buildAuthLoginPath } = await loadAuthServer();
  const request = new Request("https://app.test/tableau-de-bord?shop=demo-shop.myshopify.com&embedded=1");
  const target = buildAuthLoginPath(request);

  assert.match(target, /^\/auth\/login\?/);
  assert.match(target, /shop=demo-shop\.myshopify\.com/);
  assert.match(target, /host=/);
  assert.match(target, /embedded=1/);
});

test("buildAuthLoginPath reuses referer context when current request is incomplete", async () => {
  const { buildAuthLoginPath } = await loadAuthServer();
  const request = new Request("https://app.test/tableau-de-bord", {
    headers: {
      referer: "https://app.test/produits-en-reception?shop=demo.myshopify.com&host=abc123&embedded=1",
    },
  });

  assert.equal(
    buildAuthLoginPath(request),
    "/auth/login?shop=demo.myshopify.com&host=abc123&embedded=1",
  );
});
