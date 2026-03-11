import { useEffect, useMemo, useState } from "react";
import { redirect, type LoaderFunctionArgs, useFetcher, useLoaderData, useRevalidator } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Text,
  Toast,
} from "@shopify/polaris";
import { env } from "../env.server";
import { useEmbeddedNavigate } from "../hooks/useEmbeddedNavigate";
import { requireAdmin } from "../services/auth.server";
import { getInventoryItemSnapshots, listLocations } from "../services/shopifyGraphql";
import { getSyncState } from "../services/shopifyMetaobjects";
import { getReceiptDetail, getReceiptStocksForLines } from "../services/receiptService";
import { decodeReceiptIdFromUrl, encodeReceiptIdForUrl } from "../utils/receiptId";
import { canReceiveFromStatus, canRetirerStockFromStatus } from "../utils/receiptStatus";
import { buildReauthPath, shouldTriggerReauth } from "../utils/reauth";
import { MissingShopifyScopeError } from "../utils/shopifyScopeErrors";
import { canDeleteReceiptStatus } from "../utils/stockOps";

function statusLabel(status: string): string {
  if (status === "IMPORTED") return "À vérifier";
  if (status === "READY") return "Confirmer la réception";
  if (status === "BLOCKED") return "Bloquée";
  if (status === "INCOMING") return "En cours d'arrivage";
  if (status === "APPLIED") return "Reçue en boutique";
  if (status === "ROLLED_BACK") return "Stock retiré";
  return status;
}

function badgeTone(status: string): "info" | "success" | "critical" | "warning" {
  if (status === "READY" || status === "INCOMING") return "warning";
  if (status === "APPLIED") return "success";
  if (status === "BLOCKED" || status === "ROLLED_BACK") return "critical";
  return "info";
}

function formatOrderDate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "-";
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}Z` : trimmed;
  const parsedMs = Date.parse(normalized);
  if (!Number.isFinite(parsedMs)) return trimmed;
  const parsed = new Date(parsedMs);

  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${day}-${month}-${year} | ${hours}h${minutes}`;
}

function buildActionMessage(status: string): string {
  if (status === "IMPORTED" || status === "READY" || status === "INCOMING") {
    return "Vous pouvez confirmer la réception de cette commande. La suppression reste possible tant que le stock n'est pas réceptionné.";
  }
  if (status === "APPLIED") {
    return "Le stock est déjà réceptionné. Utilisez « Retirer le stock ajouté » avant toute suppression de commande.";
  }
  if (status === "ROLLED_BACK") {
    return "Le stock a été retiré. Vous pouvez maintenant supprimer la commande.";
  }
  if (status === "BLOCKED") {
    return "Des produits ne sont pas reliés correctement dans Shopify. Corrigez-les avant de confirmer la réception.";
  }
  return "Vérifiez les informations de la commande avant de continuer.";
}

type DetailLoaderData =
  | {
      notFound: true;
      error: string;
    }
  | {
      notFound: false;
      error: null;
      receiptGid: string;
      receipt: {
        gid: string;
        prestaOrderId: number;
        prestaReference: string;
        prestaDateAdd: string;
        status: string;
        skippedSkus: string[];
        locationId: string;
      };
      lines: Array<{
        gid: string;
        sku: string;
        qty: number;
        status: string;
        inventoryItemGid: string;
        error: string;
        before: number | null;
        productTitle: string;
        variantTitle: string;
        imageUrl: string;
        imageAlt: string;
      }>;
      locationId: string;
      locationName: string;
    };

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const encoded = params.receiptIdEnc;
  if (!encoded) {
    return { error: "Identifiant de commande absent.", notFound: true } as const;
  }

  let receiptGid = "";
  try {
    receiptGid = decodeReceiptIdFromUrl(encoded);
  } catch {
    return { error: "Identifiant de commande invalide.", notFound: true } as const;
  }

  const { admin, shop } = await requireAdmin(request);

  try {
    const [detail, locations, syncState] = await Promise.all([
      getReceiptDetail(admin, shop, receiptGid),
      listLocations(admin),
      getSyncState(admin),
    ]);

    const locationId =
      detail.receipt.locationId ||
      syncState.selectedLocationId ||
      locations.find((loc) => loc.name === env.shopifyDefaultLocationName)?.id ||
      locations[0]?.id ||
      "";

    const inventoryItemIds = detail.lines.map((line) => line.inventoryItemGid).filter(Boolean);
    const [stocks, itemSnapshots] = await Promise.all([
      locationId ? getReceiptStocksForLines(admin, detail.lines, locationId) : Promise.resolve(new Map<string, number>()),
      inventoryItemIds.length ? getInventoryItemSnapshots(admin, inventoryItemIds) : Promise.resolve(new Map()),
    ]);

    const locationName = locations.find((loc) => loc.id === locationId)?.name ?? "Boutique";

    return {
      error: null,
      notFound: false,
      receiptGid,
      receipt: detail.receipt,
      lines: detail.lines.map((line) => {
        const snapshot = line.inventoryItemGid ? itemSnapshots.get(line.inventoryItemGid) : null;
        return {
          ...line,
          before: line.inventoryItemGid ? (stocks.get(line.inventoryItemGid) ?? null) : null,
          productTitle: snapshot?.productTitle ?? "",
          variantTitle: snapshot?.variantTitle ?? "",
          imageUrl: snapshot?.imageUrl ?? "",
          imageAlt: snapshot?.imageAlt ?? "",
        };
      }),
      locationId,
      locationName,
    } as const;
  } catch (error) {
    if (error instanceof MissingShopifyScopeError) {
      if (shouldTriggerReauth(url)) {
        throw redirect(buildReauthPath(shop, error.missingScope));
      }
      return {
        error: `Autorisation manquante : ${error.missingScope}. Réinstallez l'application pour appliquer les nouveaux droits.`,
        notFound: true,
      } as const;
    }
    const message = error instanceof Error ? error.message : "Commande introuvable.";
    return { error: message, notFound: true } as const;
  }
};

export default function ReceiptDetailPage() {
  const data = useLoaderData<typeof loader>() as DetailLoaderData;
  const embeddedNavigate = useEmbeddedNavigate();
  const revalidator = useRevalidator();
  const receiveFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const rollbackFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const deleteFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!receiveFetcher.data) return;
    if (receiveFetcher.data.ok) {
      setToast({ content: "Commande marquée comme reçue. Le stock de la boutique a été mis à jour." });
      revalidator.revalidate();
      return;
    }
    if (receiveFetcher.data.error) {
      setToast({ content: receiveFetcher.data.error, error: true });
    }
  }, [receiveFetcher.data, revalidator]);

  useEffect(() => {
    if (!rollbackFetcher.data) return;
    if (rollbackFetcher.data.ok) {
      setToast({ content: "Le stock ajouté a été retiré pour cette commande." });
      revalidator.revalidate();
      return;
    }
    if (rollbackFetcher.data.error) {
      setToast({ content: rollbackFetcher.data.error, error: true });
    }
  }, [revalidator, rollbackFetcher.data]);

  useEffect(() => {
    if (!deleteFetcher.data) return;
    if (deleteFetcher.data.ok) {
      embeddedNavigate("/produits-en-reception?deleted=1");
      return;
    }
    if (deleteFetcher.data.error) {
      setToast({ content: deleteFetcher.data.error, error: true });
    }
  }, [deleteFetcher.data, embeddedNavigate]);

  const productCards = useMemo(() => {
    if (data.notFound) return [];
    return data.lines.map((line) => {
      const productName = [line.productTitle, line.variantTitle].filter(Boolean).join(" / ") || line.sku || "Produit";
      const imageAlt = line.imageAlt || productName;

      return (
        <Box
          key={line.gid}
          padding="300"
          borderColor="border"
          borderWidth="025"
          borderRadius="200"
          background="bg-surface"
        >
          <InlineStack align="space-between" blockAlign="start" gap="400">
            <InlineStack gap="300" blockAlign="start">
              {line.imageUrl ? (
                <img
                  src={line.imageUrl}
                  alt={imageAlt}
                  style={{
                    width: "64px",
                    height: "64px",
                    objectFit: "cover",
                    borderRadius: "12px",
                    border: "1px solid #d9d9d9",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <Box
                  width="64px"
                  minHeight="64px"
                  background="bg-fill-secondary"
                  borderRadius="200"
                  borderColor="border"
                  borderWidth="025"
                />
              )}
              <BlockStack gap="100">
                <Text as="h3" variant="bodyMd" fontWeight="semibold">
                  {productName}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  SKU : {line.sku || "-"}
                </Text>
                {line.error ? (
                  <Text as="p" variant="bodySm" tone="critical">
                    {line.error}
                  </Text>
                ) : null}
              </BlockStack>
            </InlineStack>

            <InlineStack gap="400" blockAlign="center">
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">
                  Quantité
                </Text>
                <Text as="p" variant="bodyMd">
                  {line.qty}
                </Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">
                  Stock actuel
                </Text>
                <Text as="p" variant="bodyMd">
                  {line.before == null ? "-" : line.before}
                </Text>
              </BlockStack>
            </InlineStack>
          </InlineStack>
        </Box>
      );
    });
  }, [data]);

  if (data.notFound) {
    return (
      <Page title="Commande">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Banner tone="critical">{data.error}</Banner>
                <Button onClick={() => embeddedNavigate("/produits-en-reception")}>Retour aux commandes</Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const missingLines = data.lines.filter((line) => line.status === "MISSING" && !data.receipt.skippedSkus.includes(line.sku));
  const eligibleLines = data.lines.filter(
    (line) => line.status === "RESOLVED" && !data.receipt.skippedSkus.includes(line.sku) && line.qty > 0,
  );
  const canMarkReceived =
    canReceiveFromStatus(data.receipt.status) &&
    missingLines.length === 0 &&
    eligibleLines.length > 0 &&
    receiveFetcher.state === "idle";
  const canRollback =
    canRetirerStockFromStatus(data.receipt.status) &&
    rollbackFetcher.state === "idle" &&
    receiveFetcher.state === "idle";
  const canDelete = canDeleteReceiptStatus(data.receipt.status) && deleteFetcher.state === "idle";
  const actionMessage = buildActionMessage(data.receipt.status);

  return (
    <Page
      title={`Commande #${data.receipt.prestaOrderId}`}
      subtitle="Détail et validation de la commande"
      secondaryActions={[
        { content: "Retour à la liste", onAction: () => embeddedNavigate("/produits-en-reception") },
        { content: "Tableau de bord", onAction: () => embeddedNavigate("/tableau-de-bord") },
      ]}
    >
      {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}

      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Résumé
                </Text>
                <Badge tone={badgeTone(data.receipt.status)}>{statusLabel(data.receipt.status)}</Badge>
                <Text as="p" variant="bodyMd">
                  Référence : {data.receipt.prestaReference || "-"}
                </Text>
                <Text as="p" variant="bodyMd">
                  Date de commande : {formatOrderDate(data.receipt.prestaDateAdd)}
                </Text>
                <Text as="p" variant="bodyMd">
                  Boutique : {data.locationName}
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Produits
                </Text>
                {data.lines.length === 0 ? (
                  <Banner tone="warning">Aucune ligne trouvée pour cette commande.</Banner>
                ) : (
                  <BlockStack gap="200">{productCards}</BlockStack>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Action principale
              </Text>
              <Text as="p" variant="bodyMd">
                {actionMessage}
              </Text>

              {missingLines.length > 0 ? (
                <Banner tone="critical">
                  Des SKU sont manquants sur cette commande : {missingLines.map((line) => line.sku).join(", ")}.
                </Banner>
              ) : null}

              {eligibleLines.length === 0 && data.receipt.status !== "ROLLED_BACK" ? (
                <Banner tone="warning">Aucune ligne valide à traiter pour cette commande.</Banner>
              ) : null}

              {data.receipt.status === "APPLIED" ? (
                <Banner tone="success">Le stock a bien été ajouté à la boutique.</Banner>
              ) : null}

              {data.receipt.status === "ROLLED_BACK" ? (
                <Banner tone="info">Le stock a été retiré. La suppression est maintenant autorisée.</Banner>
              ) : null}

              {!canReceiveFromStatus(data.receipt.status) &&
              data.receipt.status !== "APPLIED" &&
              data.receipt.status !== "ROLLED_BACK" ? (
                <Banner tone="warning">
                  Cette commande doit être prête ou en cours d&apos;arrivage avant validation.
                </Banner>
              ) : null}

              <receiveFetcher.Form
                method="post"
                action={`/actions/produits-en-reception/${encodeReceiptIdForUrl(data.receiptGid)}/recu-en-boutique`}
              >
                <input type="hidden" name="locationId" value={data.locationId} />
                <input type="hidden" name="confirmed" value="true" />
                <Button submit variant="primary" disabled={!canMarkReceived} loading={receiveFetcher.state !== "idle"}>
                  Confirmer la réception
                </Button>
              </receiveFetcher.Form>

              <rollbackFetcher.Form
                method="post"
                action={`/actions/produits-en-reception/${encodeReceiptIdForUrl(data.receiptGid)}/annuler-reception`}
              >
                <Button submit tone="critical" disabled={!canRollback} loading={rollbackFetcher.state !== "idle"}>
                  Retirer le stock ajouté
                </Button>
              </rollbackFetcher.Form>

              <Button
                tone="critical"
                disabled={!canDelete}
                loading={deleteFetcher.state !== "idle"}
                onClick={() =>
                  deleteFetcher.submit(
                    { confirmed: "true" },
                    {
                      method: "post",
                      action: `/actions/produits-en-reception/${encodeReceiptIdForUrl(data.receiptGid)}/supprimer`,
                    },
                  )
                }
              >
                Supprimer la commande
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
