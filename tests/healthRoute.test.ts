import test from "node:test";
import assert from "node:assert/strict";

test("health route returns 200 and ok payload", async () => {
  const mod = await import("../app/routes/api.health");
  const response = await mod.loader({
    request: new Request("https://example.com/api/health"),
    params: {},
    context: {},
  } as never);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "import-stock-v1");
});
