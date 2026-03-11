import type { ActionFunctionArgs } from "react-router";
import { assertActionRateLimit, getClientIp } from "../services/action-guard.server";
import { requireAdmin } from "../services/auth.server";
import { safeLogAuditEvent } from "../services/auditLogService";
import { importById, importByReference } from "../services/receiptService";
import { toPublicErrorMessage } from "../utils/error.server";
import { isShopifyGid, parsePositiveIntInput } from "../utils/validators";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, shop } = await requireAdmin(request);
  const form = await request.formData();
  const locationId = String(form.get("locationId") ?? "").trim();
  if (!isShopifyGid(locationId)) {
    return Response.json({ ok: false, error: "Sélection de la boutique invalide." }, { status: 400 });
  }

  const lookup = String(form.get("presta_order_lookup") ?? form.get("presta_order_id") ?? "").trim();
  if (!lookup) {
    return Response.json({ ok: false, error: "ID ou référence de commande Prestashop invalide." }, { status: 400 });
  }

  const orderId = parsePositiveIntInput(lookup);

  try {
    assertActionRateLimit("import", shop, getClientIp(request), 5_000);
    const result = orderId
      ? await importById(admin, shop, orderId, locationId)
      : await importByReference(admin, shop, lookup, locationId);

    await safeLogAuditEvent(admin, shop, {
      eventType: orderId ? "receipt.import_by_id.triggered" : "receipt.import_by_reference.triggered",
      entityType: "presta_order",
      entityId: orderId ? String(orderId) : lookup,
      locationId,
      prestaOrderId: orderId ?? 0,
      status: "success",
      payload: {
        lookup,
        created: result.created,
        duplicateBy: result.duplicateBy ?? null,
        receiptGid: result.receiptGid,
      },
    });

    return Response.json({
      ok: true,
      prestaOrderId: orderId ?? undefined,
      created: result.created,
      receiptGid: result.receiptGid,
      receiptGids: "receiptGids" in result ? result.receiptGids : result.receiptGid ? [result.receiptGid] : [],
      duplicateBy: result.duplicateBy,
      locationId: result.locationId,
      lastPrestaOrderId: result.lastPrestaOrderId,
      lastSyncAt: result.lastSyncAt,
      createdCount: "createdCount" in result ? result.createdCount : result.created ? 1 : 0,
      duplicateCount: "duplicateCount" in result ? result.duplicateCount : result.created ? 0 : 1,
      splitCount: "splitCount" in result ? result.splitCount : 1,
      importedOrderIds: "importedOrderIds" in result ? result.importedOrderIds : orderId ? [orderId] : [],
      importedReference: "importedReference" in result ? result.importedReference : undefined,
    });
  } catch (error) {
    await safeLogAuditEvent(admin, shop, {
      eventType: orderId ? "receipt.import_by_id.error" : "receipt.import_by_reference.error",
      entityType: "presta_order",
      entityId: orderId ? String(orderId) : lookup,
      locationId,
      prestaOrderId: orderId ?? 0,
      status: "error",
      message: error instanceof Error ? error.message : "Erreur import manuel",
    });

    return Response.json(
      { ok: false, error: toPublicErrorMessage(error, "Erreur d'import.") },
      { status: 400 },
    );
  }
};
