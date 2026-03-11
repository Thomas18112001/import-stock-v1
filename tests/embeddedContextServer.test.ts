import assert from "node:assert/strict";
import test from "node:test";
import { withRequestEmbeddedContext } from "../app/utils/embeddedContext.server";

test("withRequestEmbeddedContext conserve les params presents dans l'URL courante", () => {
  const request = new Request("https://app.test/commandes?shop=demo.myshopify.com&host=abc123&embedded=1");
  const target = withRequestEmbeddedContext(request, "/produits-en-reception");
  assert.equal(target, "/produits-en-reception?shop=demo.myshopify.com&host=abc123&embedded=1");
});

test("withRequestEmbeddedContext reutilise le referer quand la query courante est vide", () => {
  const request = new Request("https://app.test/commandes", {
    headers: { referer: "https://app.test/tableau-de-bord?shop=demo.myshopify.com&host=abc123&embedded=1" },
  });
  const target = withRequestEmbeddedContext(request, "/produits-en-reception");
  assert.equal(target, "/produits-en-reception?shop=demo.myshopify.com&host=abc123&embedded=1");
});

test("withRequestEmbeddedContext ne remplace pas un param deja present dans la cible", () => {
  const request = new Request("https://app.test/commandes?shop=demo.myshopify.com&host=abc123&embedded=1");
  const target = withRequestEmbeddedContext(request, "/produits-en-reception?shop=custom.myshopify.com");
  assert.equal(target, "/produits-en-reception?shop=custom.myshopify.com&host=abc123&embedded=1");
});
