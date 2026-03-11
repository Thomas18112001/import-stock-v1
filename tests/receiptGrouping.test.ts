import test from "node:test";
import assert from "node:assert/strict";
import { groupReceiptsByReference } from "../app/utils/receiptGrouping";

test("groupReceiptsByReference regroupe les sous-commandes partageant la même référence", () => {
  const groups = groupReceiptsByReference([
    { gid: "1", prestaOrderId: 1001, prestaReference: "REF-100" },
    { gid: "2", prestaOrderId: 1002, prestaReference: "REF-100" },
    { gid: "3", prestaOrderId: 1003, prestaReference: "REF-200" },
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.reference, "REF-100");
  assert.equal(groups[0]?.receipts.length, 2);
  assert.equal(groups[0]?.isSplit, true);
  assert.equal(groups[1]?.reference, "REF-200");
  assert.equal(groups[1]?.receipts.length, 1);
  assert.equal(groups[1]?.isSplit, false);
});

test("groupReceiptsByReference normalise la référence avant regroupement", () => {
  const groups = groupReceiptsByReference([
    { gid: "1", prestaOrderId: 1001, prestaReference: " REF-100 " },
    { gid: "2", prestaOrderId: 1002, prestaReference: "ref-100" },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.receipts.length, 2);
});
