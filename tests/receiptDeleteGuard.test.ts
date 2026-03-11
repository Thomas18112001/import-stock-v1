import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("garde-fou: suppression commande bloquée si réassort lié", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "app/services/receiptService.ts"),
    "utf8",
  );

  assert.match(source, /hasRestockLinkedToReceipt/);
  assert.match(source, /Supprimez d'abord le réassort/i);
});
