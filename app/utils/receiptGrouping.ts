type ReceiptGroupable = {
  gid: string;
  prestaOrderId: number;
  prestaReference: string;
};

function normalizeReference(value: string): string {
  return value.trim().toLowerCase();
}

export function referenceGroupKey(reference: string, fallbackOrderId: number): string {
  const normalized = normalizeReference(reference);
  return normalized || `presta-order-${fallbackOrderId}`;
}

export function groupReceiptsByReference<T extends ReceiptGroupable>(receipts: T[]): Array<{
  key: string;
  reference: string;
  receipts: T[];
  isSplit: boolean;
}> {
  const groups = new Map<string, { key: string; reference: string; receipts: T[] }>();

  for (const receipt of receipts) {
    const key = referenceGroupKey(receipt.prestaReference, receipt.prestaOrderId);
    const existing = groups.get(key);
    if (existing) {
      existing.receipts.push(receipt);
      continue;
    }
    groups.set(key, {
      key,
      reference: receipt.prestaReference.trim() || `Commande ${receipt.prestaOrderId}`,
      receipts: [receipt],
    });
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    isSplit: group.receipts.length > 1,
  }));
}
