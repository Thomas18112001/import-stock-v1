import { useEffect, useMemo, useState } from "react";
import { redirect, type LoaderFunctionArgs, useFetcher, useLoaderData, useNavigation, useRevalidator } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  Select,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";
import { env } from "../env.server";
import { useEmbeddedNavigate } from "../hooks/useEmbeddedNavigate";
import { requireAdmin } from "../services/auth.server";
import { getDashboardData } from "../services/receiptService";
import { encodeReceiptIdForUrl } from "../utils/receiptId";
import { filterReceiptsForSelectedLocation } from "../utils/receiptFilters";
import { groupReceiptsByReference } from "../utils/receiptGrouping";
import { formatRelativeSyncFr } from "../utils/relativeTimeFr";
import { buildReauthPath, shouldTriggerReauth } from "../utils/reauth";
import { MissingShopifyScopeError } from "../utils/shopifyScopeErrors";

function badgeTone(status: string): "info" | "success" | "critical" | "warning" {
  if (status === "READY" || status === "INCOMING") return "warning";
  if (status === "APPLIED") return "success";
  if (status === "BLOCKED" || status === "ROLLED_BACK") return "critical";
  return "info";
}

function statusLabel(status: string): string {
  if (status === "IMPORTED") return "À vérifier";
  if (status === "READY") return "Confirmer la réception";
  if (status === "BLOCKED") return "Bloquée";
  if (status === "INCOMING") return "En cours d'arrivage";
  if (status === "APPLIED") return "Reçue en boutique";
  if (status === "ROLLED_BACK") return "Stock retiré";
  return status;
}

function toSortableMs(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}Z` : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

function receiptSortTimestamp(receipt: { prestaDateUpd: string; prestaDateAdd: string }): number {
  return Math.max(toSortableMs(receipt.prestaDateUpd), toSortableMs(receipt.prestaDateAdd));
}

function formatDisplayDate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "-";
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}Z` : trimmed;
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return trimmed;

  const date = new Date(ms);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}-${month}-${year} | ${hours}h${minutes}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const { admin, shop } = await requireAdmin(request);

  try {
    const data = await getDashboardData(admin, shop, { pageSize: 20 });
    const sortedReceipts = [...data.receipts].sort((a, b) => {
      const dateDelta = receiptSortTimestamp(b) - receiptSortTimestamp(a);
      if (dateDelta !== 0) return dateDelta;
      return b.prestaOrderId - a.prestaOrderId;
    });

    const defaultLocation =
      data.locations.find((loc) => loc.id === data.syncState.selectedLocationId) ||
      data.locations.find((loc) => loc.name === env.shopifyDefaultLocationName) ||
      data.locations[0] ||
      null;

    return {
      locations: data.locations,
      defaultLocationId: defaultLocation?.id ?? "",
      defaultLocationName: env.shopifyDefaultLocationName,
      syncState: data.syncState,
      receipts: sortedReceipts,
      scopeIssue: null as null | { missingScope: string; message: string },
    };
  } catch (error) {
    if (error instanceof MissingShopifyScopeError) {
      if (shouldTriggerReauth(url)) {
        throw redirect(buildReauthPath(shop, error.missingScope));
      }
      return {
        locations: [],
        defaultLocationId: "",
        defaultLocationName: env.shopifyDefaultLocationName,
        syncState: {
          selectedLocationId: "",
          cursorByLocation: {},
          lastSyncAtByLocation: {},
          prestaCheckpointByLocation: {},
        },
        receipts: [],
        scopeIssue: {
          missingScope: error.missingScope,
          message: `Autorisation manquante : ${error.missingScope}. Reinstallez l'application pour appliquer les nouveaux droits.`,
        },
      };
    }
    throw error;
  }
};

export default function DashboardPage() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const embeddedNavigate = useEmbeddedNavigate();
  const revalidator = useRevalidator();
  const selectLocationFetcher = useFetcher<{ ok: boolean; selectedLocationId?: string; error?: string }>();
  const [locationId, setLocationId] = useState(data.defaultLocationId);
  const [orderLookup, setOrderLookup] = useState("");
  const [syncDay, setSyncDay] = useState("");
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  const syncFetcher = useFetcher<{
    ok: boolean;
    imported: number;
    syncDay?: string | null;
    locationId?: string;
    lastSyncAt?: string;
    error?: string;
  }>();

  const importFetcher = useFetcher<{
    ok: boolean;
    created?: boolean;
    receiptGid?: string;
    locationId?: string;
    lastSyncAt?: string;
    createdCount?: number;
    duplicateCount?: number;
    splitCount?: number;
    importedReference?: string;
    error?: string;
  }>();

  const [lastSyncMap, setLastSyncMap] = useState<Record<string, string>>(data.syncState.lastSyncAtByLocation);
  const syncResult = syncFetcher.data;
  const importResult = importFetcher.data;
  const selectedLocation = data.locations.find((loc) => loc.id === locationId) ?? null;
  const selectedLocationConfigured = Boolean(selectedLocation?.prestaConfigured);
  const lastSyncLabel = formatRelativeSyncFr(lastSyncMap[locationId]);

  const options = useMemo(
    () =>
      data.locations.map((loc) => ({
        value: loc.id,
        label: loc.prestaConfigured ? loc.name : `${loc.name} (à configurer)`,
      })),
    [data.locations],
  );

  const isBusy = navigation.state !== "idle";
  const importBusy = importFetcher.state !== "idle";
  const syncBusy = syncFetcher.state !== "idle";
  const blockedByScope = Boolean(data.scopeIssue);
  const selectLocationBusy = selectLocationFetcher.state !== "idle";

  useEffect(() => {
    setLastSyncMap(data.syncState.lastSyncAtByLocation);
  }, [data.syncState.lastSyncAtByLocation]);

  useEffect(() => {
    setLocationId(data.defaultLocationId);
  }, [data.defaultLocationId]);

  useEffect(() => {
    if (syncResult?.ok && syncResult.locationId && syncResult.lastSyncAt) {
      setLastSyncMap((prev) => ({ ...prev, [syncResult.locationId!]: syncResult.lastSyncAt! }));
      revalidator.revalidate();
    }
  }, [revalidator, syncResult]);

  useEffect(() => {
    if (importResult?.ok && importResult.locationId && importResult.lastSyncAt) {
      setLastSyncMap((prev) => ({ ...prev, [importResult.locationId!]: importResult.lastSyncAt! }));
      revalidator.revalidate();
    }
  }, [importResult, revalidator]);

  const selectedLocationName = data.locations.find((location) => location.id === locationId)?.name ?? "";
  const includeLegacyUnassigned = selectedLocationName === data.defaultLocationName;
  const latestReceiptsForLocation = [...filterReceiptsForSelectedLocation(data.receipts, locationId, includeLegacyUnassigned)].sort(
    (a, b) => {
      const dateDelta = receiptSortTimestamp(b) - receiptSortTimestamp(a);
      if (dateDelta !== 0) return dateDelta;
      return b.prestaOrderId - a.prestaOrderId;
    },
  );
  const latestGroups = groupReceiptsByReference(latestReceiptsForLocation);

  const renderImportFeedback = () => {
    if (!importResult?.ok) return null;
    const splitCount = importResult.splitCount ?? 1;
    const createdCount = importResult.createdCount ?? (importResult.created ? 1 : 0);
    const duplicateCount = importResult.duplicateCount ?? (importResult.created ? 0 : 1);

    if (splitCount > 1) {
      return (
        <Banner tone={createdCount > 0 ? "success" : "warning"}>
          Référence {importResult.importedReference || orderLookup}: {splitCount} commandes trouvées, {createdCount} importée(s)
          {duplicateCount > 0 ? `, ${duplicateCount} déjà présente(s)` : ""}.
        </Banner>
      );
    }
    if (importResult.created) {
      return <Banner tone="success">Commande importée avec succès.</Banner>;
    }
    if (importResult.receiptGid) {
      return (
        <Banner tone="warning">
          Cette commande est déjà présente.
          <Box paddingBlockStart="200">
            <Button
              submit={false}
              onClick={() => {
                const receiptIdEnc = encodeReceiptIdForUrl(importResult.receiptGid!);
                const result = embeddedNavigate(`/produits-en-reception/${receiptIdEnc}`);
                if (!result.ok) setToast({ content: "Navigation impossible.", error: true });
              }}
            >
              Ouvrir la commande existante
            </Button>
          </Box>
        </Banner>
      );
    }
    return null;
  };

  return (
    <Page title="Import Stock Boutique V1" subtitle="Tableau de bord des commandes">
      {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}

      <Layout>
        {data.scopeIssue ? (
          <Layout.Section>
            <Banner tone="critical">
              <Text as="p" variant="bodyMd">
                {data.scopeIssue.message}
              </Text>
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Boutique
                </Text>
                <Select
                  label="Sélectionner la boutique"
                  options={options}
                  value={locationId}
                  onChange={(nextLocationId) => {
                    setLocationId(nextLocationId);
                    const formData = new FormData();
                    formData.set("locationId", nextLocationId);
                    selectLocationFetcher.submit(formData, { method: "post", action: "/actions/boutiques/selectionner" });
                  }}
                  disabled={syncBusy || importBusy || blockedByScope || selectLocationBusy}
                />
                {!selectedLocationConfigured && selectedLocation ? (
                  <Banner tone="warning">
                    La boutique &quot;{selectedLocation.name}&quot; doit être configurée pour Prestashop BtoB. Synchronisation indisponible.
                  </Banner>
                ) : null}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Synchronisation et import
                </Text>
                <Text as="p" variant="bodyMd">
                  Choisissez une date pour synchroniser les commandes, ou importez une commande manuellement avec son ID ou sa référence.
                </Text>
                <Text as="p" variant="bodyMd">
                  Si PrestaShop a découpé une commande en plusieurs parties, toutes les sous-commandes ayant la même référence sont importées automatiquement.
                </Text>
                <Text as="p" variant="bodyMd">
                  Dernière synchronisation pour cette boutique : {lastSyncLabel}
                </Text>

                <syncFetcher.Form method="post" action="/actions/synchroniser">
                  <input type="hidden" name="locationId" value={locationId} />
                  <InlineStack gap="300" align="start" blockAlign="end">
                    <Box width="220px" minWidth="220px">
                      <TextField label="Date de commande (optionnel)" type="date" name="syncDay" value={syncDay} onChange={setSyncDay} autoComplete="off" />
                    </Box>
                    <Button submit variant="primary" loading={syncBusy} disabled={syncBusy || blockedByScope || !selectedLocationConfigured}>
                      Synchroniser maintenant
                    </Button>
                    <Button submit={false} onClick={() => setSyncDay("")} disabled={syncBusy}>
                      Réinitialiser la date
                    </Button>
                  </InlineStack>
                </syncFetcher.Form>

                {syncResult?.error ? <Banner tone="critical">{syncResult.error}</Banner> : null}
                {syncResult?.ok ? (
                  <Banner tone="success">
                    {syncResult.imported} commande(s) synchronisée(s){syncResult.syncDay ? ` pour le ${syncResult.syncDay}` : ""}.
                  </Banner>
                ) : null}

                <importFetcher.Form method="post" action="/actions/importer-par-id">
                  <input type="hidden" name="locationId" value={locationId} />
                  <InlineStack gap="300" align="start" blockAlign="end">
                    <Box minWidth="260px">
                      <TextField label="ID ou référence de commande Prestashop" name="presta_order_lookup" value={orderLookup} onChange={setOrderLookup} autoComplete="off" />
                    </Box>
                    <Button submit loading={importBusy} disabled={importBusy || blockedByScope || !selectedLocationConfigured || !orderLookup.trim()}>
                      Importer manuellement
                    </Button>
                  </InlineStack>
                </importFetcher.Form>

                {importResult?.error ? <Banner tone="critical">{importResult.error}</Banner> : null}
                {renderImportFeedback()}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Parcours principal
              </Text>
              <Text as="p" variant="bodyMd">1) Choisir la boutique.</Text>
              <Text as="p" variant="bodyMd">2) Synchroniser par date ou importer une commande par ID ou référence.</Text>
              <Text as="p" variant="bodyMd">3) Ouvrir la commande dans la liste.</Text>
              <Text as="p" variant="bodyMd">4) Confirmer la réception.</Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Dernières commandes importées</Text>
                <Button submit={false} onClick={() => embeddedNavigate("/produits-en-reception")}>Voir toutes les commandes</Button>
              </InlineStack>

              {isBusy ? (
                <BlockStack gap="300">
                  <SkeletonDisplayText size="small" />
                  <SkeletonBodyText />
                </BlockStack>
              ) : latestGroups.length === 0 ? (
                <Text as="p" variant="bodyMd" tone="subdued">Aucune commande importée pour cette boutique.</Text>
              ) : (
                <BlockStack gap="400">
                  {latestGroups.map((group) => (
                    <Card key={group.key} background={group.isSplit ? "bg-surface-secondary" : "bg-surface"}>
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="050">
                            <Text as="h3" variant="headingSm">{group.reference}</Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {group.isSplit ? `${group.receipts.length} sous-commandes liées à une même commande d'origine` : "Commande unique"}
                            </Text>
                          </BlockStack>
                          {group.isSplit ? <Badge tone="info">Commande fractionnée</Badge> : null}
                        </InlineStack>

                        <IndexTable
                          resourceName={{ singular: "commande", plural: "commandes" }}
                          itemCount={group.receipts.length}
                          selectable={false}
                          headings={[
                            { title: "ID Presta" },
                            { title: "Statut" },
                            { title: "Date commande" },
                            { title: "Date mise à jour" },
                            { title: "Dernière action" },
                            { title: "Action" },
                          ]}
                        >
                          {group.receipts.map((receipt, index) => (
                            <IndexTable.Row id={receipt.gid} key={receipt.gid} position={index}>
                              <IndexTable.Cell>{receipt.prestaOrderId}</IndexTable.Cell>
                              <IndexTable.Cell><Badge tone={badgeTone(receipt.status)}>{statusLabel(receipt.status)}</Badge></IndexTable.Cell>
                              <IndexTable.Cell>{formatDisplayDate(receipt.prestaDateAdd)}</IndexTable.Cell>
                              <IndexTable.Cell>{formatDisplayDate(receipt.prestaDateUpd)}</IndexTable.Cell>
                              <IndexTable.Cell>{formatDisplayDate(receipt.updatedAt)}</IndexTable.Cell>
                              <IndexTable.Cell>
                                <Button
                                  submit={false}
                                  size="slim"
                                  onClick={() => {
                                    const receiptIdEnc = encodeReceiptIdForUrl(receipt.gid);
                                    const result = embeddedNavigate(`/produits-en-reception/${receiptIdEnc}`);
                                    if (!result.ok) setToast({ content: "Navigation impossible.", error: true });
                                  }}
                                >
                                  Ouvrir
                                </Button>
                              </IndexTable.Cell>
                            </IndexTable.Row>
                          ))}
                        </IndexTable>
                      </BlockStack>
                    </Card>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
