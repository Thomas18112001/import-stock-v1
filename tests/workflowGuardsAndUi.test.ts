import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertReceiptLocationMatch } from "../app/utils/locationLock";
import { canApplyFromStatus, canAdjustSkuFromStatus } from "../app/utils/receiptStatus";
import { findExistingReceiptByOrder, isStrictDuplicateForOrder } from "../app/utils/receiptUniqueness";
import { canDeleteReceiptStatus } from "../app/utils/stockOps";

function readFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

test("apply cible uniquement la location verrouillée", () => {
  assert.doesNotThrow(() =>
    assertReceiptLocationMatch("gid://shopify/Location/123", "gid://shopify/Location/123"),
  );
  assert.throws(
    () => assertReceiptLocationMatch("gid://shopify/Location/123", "gid://shopify/Location/999"),
    /verrouill[ée]e/i,
  );
});

test("anti doublon import + anti double apply", () => {
  const receipts = [{ gid: "gid://shopify/Metaobject/1", prestaOrderId: 1001, prestaReference: "REF-1001" }];
  const duplicate = findExistingReceiptByOrder(receipts, 1001, "REF-1001");
  assert.equal(duplicate?.duplicateBy, "id");
  assert.equal(isStrictDuplicateForOrder(duplicate, 1001), true);

  assert.equal(canApplyFromStatus("READY"), true);
  assert.equal(canApplyFromStatus("INCOMING"), false);
  assert.equal(canApplyFromStatus("APPLIED"), false);
});

test("persistance boutique entre pages: selectedLocationId prioritaire", () => {
  const dashboardSource = readFile("app/routes/app._index.tsx");
  const receiptsSource = readFile("app/routes/app.receipts._index.tsx");

  assert.match(dashboardSource, /data\.syncState\.selectedLocationId/);
  assert.match(receiptsSource, /syncState\.selectedLocationId/);
});

test("V1 masque le diagnostic SKU dans l'UI mais conserve les gardes serveur", () => {
  assert.equal(canAdjustSkuFromStatus("INCOMING"), false);
  assert.equal(canAdjustSkuFromStatus("APPLIED"), false);

  const detailSource = readFile("app/routes/app.receipts.$receiptIdEnc.tsx");
  const serviceSource = readFile("app/services/receiptService.ts");
  assert.doesNotMatch(detailSource, /showDiagnosticCard/);
  assert.doesNotMatch(detailSource, /Diagnostiquer les SKU|Ajuster les SKU/);
  assert.match(serviceSource, /if \(!canAdjustSkuFromStatus\(receipt\.status\)\)/);
});

test("suppression autorisée avant réception et après retrait du stock", () => {
  assert.equal(canDeleteReceiptStatus("IMPORTED"), true);
  assert.equal(canDeleteReceiptStatus("READY"), true);
  assert.equal(canDeleteReceiptStatus("BLOCKED"), true);
  assert.equal(canDeleteReceiptStatus("INCOMING"), true);
  assert.equal(canDeleteReceiptStatus("APPLIED"), false);
  assert.equal(canDeleteReceiptStatus("ROLLED_BACK"), true);
  const source = readFile("app/services/receiptService.ts");
  assert.match(source, /Suppression impossible : retirez d'abord le stock de la commande reçue/);
});

test("navigation 'Ouvrir' vers le détail commande", () => {
  const dashboardSource = readFile("app/routes/app._index.tsx");
  const receiptsSource = readFile("app/routes/app.receipts._index.tsx");
  assert.match(dashboardSource, /encodeReceiptIdForUrl\(receipt\.gid\)/);
  assert.match(receiptsSource, /encodeReceiptIdForUrl\(receipt\.gid\)/);
});

test("dashboard V1 conserve l'import manuel par ID ou référence et la date", () => {
  const dashboardSource = readFile("app/routes/app._index.tsx");
  const importActionSource = readFile("app/routes/actions.importById.tsx");

  assert.match(dashboardSource, /name="syncDay"/);
  assert.match(dashboardSource, /name="presta_order_lookup"/);
  assert.match(dashboardSource, /ID ou référence de commande Prestashop/);
  assert.match(importActionSource, /importByReference/);
});

test("écrans actifs utilisent le libellé Confirmer la réception", () => {
  const dashboardSource = readFile("app/routes/app._index.tsx");
  const receiptsSource = readFile("app/routes/app.receipts._index.tsx");
  const detailSource = readFile("app/routes/app.receipts.$receiptIdEnc.tsx");

  assert.match(dashboardSource, /Confirmer la réception/);
  assert.match(receiptsSource, /Confirmer la réception/);
  assert.match(detailSource, /Confirmer la réception/);
  assert.doesNotMatch(receiptsSource, /Prête à recevoir/);
});

test("voir toutes les commandes expose un filtre de date personnalisé", () => {
  const receiptsSource = readFile("app/routes/app.receipts._index.tsx");
  assert.match(receiptsSource, /name="orderDay"/);
  assert.match(receiptsSource, /label="Date commande"/);
});

test("loader global Woora n'est plus monté dans le layout", () => {
  const appLayoutSource = readFile("app/routes/app.tsx");
  assert.doesNotMatch(appLayoutSource, /AppLoader/);
  assert.doesNotMatch(appLayoutSource, /app-loader\.css/);
  assert.doesNotMatch(appLayoutSource, /NavMenu/);
});

test("pages legacy de la V1 redirigent vers le tableau de bord", () => {
  const disabledSource = readFile("app/routes/app.disabled.tsx");
  const purchaseOrdersSource = readFile("app/routes/app.purchase-orders.tsx");
  const planningSource = readFile("app/routes/app.planification-stocks.tsx");

  assert.match(disabledSource, /redirect\(`\/tableau-de-bord/);
  assert.match(purchaseOrdersSource, /app\.disabled/);
  assert.match(planningSource, /app\.disabled/);
});
