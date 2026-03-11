import { useEffect, useMemo, useState } from "react";
import { redirect, type LoaderFunctionArgs, useLoaderData, useNavigation, useRevalidator } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Page,
  Select,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
  TextField,
  Toast,
} from "@shopify/polaris";
import { buildMissingPrestaConfigMessage, getBoutiqueMappingByLocationName } from "../config/boutiques";
import { env } from "../env.server";
import { useEmbeddedNavigate } from "../hooks/useEmbeddedNavigate";
import { requireAdmin } from "../services/auth.server";
import { listReceipts } from "../services/receiptService";
import { listLocations } from "../services/shopifyGraphql";
import { getSyncState } from "../services/shopifyMetaobjects";
import { encodeReceiptIdForUrl } from "../utils/receiptId";
import { filterReceiptsForSelectedLocation } from "../utils/receiptFilters";
import { groupReceiptsByReference } from "../utils/receiptGrouping";
import { buildReauthPath, shouldTriggerReauth } from "../utils/reauth";
import { MissingShopifyScopeError } from "../utils/shopifyScopeErrors";
import { sanitizeSearchQuery, sanitizeSort } from "../utils/validators";

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

function cityLabelFromLocationName(name: string): string {
  return name.replace(/^Boutique\s+/i, "").trim() || name;
}

function toSortableMs(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}Z` : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

function receiptOrderDateMs(receipt: { prestaDateAdd: string; prestaDateUpd?: string }): number {
  return Math.max(toSortableMs(receipt.prestaDateAdd), toSortableMs(receipt.prestaDateUpd ?? ""));
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

type ReceiptRow = {
  gid: string;
  prestaOrderId: number;
  prestaReference: string;
  status: string;
  prestaDateAdd: string;
  prestaDateUpd?: string;
};

function parseOrderDayInput(value: string): string {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function extractOrderDay(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const directMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch?.[1]) return directMatch[1];

  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}Z` : trimmed;
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const { admin, shop } = await requireAdmin(request);

  const allowedStatuses = ["", "IMPORTED", "READY", "BLOCKED", "INCOMING", "APPLIED", "ROLLED_BACK"];
  const allowedSorts = ["date_desc", "date_asc", "id_desc", "id_asc"];

  const rawStatus = url.searchParams.get("status") ?? "";
  const status = allowedStatuses.includes(rawStatus) ? rawStatus : "";
  const q = sanitizeSearchQuery(url.searchParams.get("q") ?? "");
  const orderDay = parseOrderDayInput(url.searchParams.get("orderDay") ?? "");
  const sort = sanitizeSort(url.searchParams.get("sort") ?? "date_desc", allowedSorts, "date_desc");
  const cursor = url.searchParams.get("cursor");
  const stack = (url.searchParams.get("stack") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  try {
    const [page, syncState, locations] = await Promise.all([
      listReceipts(admin, shop, { pageSize: 50, cursor: cursor || null }),
      getSyncState(admin),
      listLocations(admin),
    ]);

    const selectedLocation =
      locations.find((loc) => loc.id === syncState.selectedLocationId) ||
      locations.find((loc) => loc.name === env.shopifyDefaultLocationName) ||
      locations[0] ||
      null;

    const boutiqueMapping = selectedLocation ? getBoutiqueMappingByLocationName(selectedLocation.name) : null;
    const locationConfigured = Boolean(boutiqueMapping?.prestaCustomerId);
    const configurationMessage =
      selectedLocation && !locationConfigured ? buildMissingPrestaConfigMessage(selectedLocation.name) : null;

    const includeLegacyUnassigned =
      selectedLocation?.name?.trim().toLowerCase() === env.shopifyDefaultLocationName.trim().toLowerCase();
    const filteredByLocation = selectedLocation
      ? filterReceiptsForSelectedLocation(page.receipts, selectedLocation.id, includeLegacyUnassigned)
      : page.receipts;

    const filtered = filteredByLocation.filter((receipt) => {
      if (status && receipt.status !== status) return false;
      if (q) {
        const haystack = `${receipt.prestaOrderId} ${receipt.prestaReference}`.toLowerCase();
        if (!haystack.includes(q.toLowerCase())) return false;
      }
      if (orderDay) {
        const receiptDay = extractOrderDay(receipt.prestaDateAdd || receipt.prestaDateUpd || "");
        if (!receiptDay || receiptDay !== orderDay) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sort === "date_asc") {
        const dateDelta = receiptOrderDateMs(a) - receiptOrderDateMs(b);
        if (dateDelta !== 0) return dateDelta;
        return a.prestaOrderId - b.prestaOrderId;
      }
      if (sort === "id_asc") return a.prestaOrderId - b.prestaOrderId;
      if (sort === "id_desc") return b.prestaOrderId - a.prestaOrderId;
      const dateDelta = receiptOrderDateMs(b) - receiptOrderDateMs(a);
      if (dateDelta !== 0) return dateDelta;
      return b.prestaOrderId - a.prestaOrderId;
    });

    return {
      status,
      q,
      orderDay,
      sort,
      deleted: url.searchParams.get("deleted") === "1",
      cursor: cursor ?? "",
      stack,
      pageInfo: page.pageInfo,
      receipts: sorted,
      locationName: selectedLocation?.name ?? "Boutique",
      locationCity: selectedLocation ? cityLabelFromLocationName(selectedLocation.name) : "Boutique",
      locationConfigured,
      configurationMessage,
      scopeIssue: null as null | { missingScope: string; message: string },
    };
  } catch (error) {
    if (error instanceof MissingShopifyScopeError) {
      if (shouldTriggerReauth(url)) {
        throw redirect(buildReauthPath(shop, error.missingScope));
      }
      return {
        status,
        q,
        orderDay,
        sort,
        deleted: false,
        cursor: "",
        stack,
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
        receipts: [],
        locationName: "Boutique",
        locationCity: "Boutique",
        locationConfigured: true,
        configurationMessage: null,
        scopeIssue: {
          missingScope: error.missingScope,
          message: `Autorisation manquante : ${error.missingScope}. Réinstallez l'application pour appliquer les nouveaux droits.`,
        },
      };
    }
    throw error;
  }
};

export default function ReceiptsPage() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const embeddedNavigate = useEmbeddedNavigate();
  const revalidator = useRevalidator();

  const [receipts, setReceipts] = useState<ReceiptRow[]>(data.receipts);
  const [query, setQuery] = useState(data.q);
  const [orderDay, setOrderDay] = useState(data.orderDay);
  const [status, setStatus] = useState(data.status);
  const [sort, setSort] = useState(data.sort);
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(
    data.deleted ? { content: "Commande supprimée." } : null,
  );

  useEffect(() => {
    setReceipts(data.receipts);
  }, [data.receipts]);

  useEffect(() => {
    if (data.deleted) {
      setToast({ content: "Commande supprimée." });
      revalidator.revalidate();
    }
  }, [data.deleted, revalidator]);

  const nextStack = [...data.stack, data.cursor || "ROOT"].join(",");
  const prevCursorToken = data.stack[data.stack.length - 1];
  const prevCursor = !prevCursorToken || prevCursorToken === "ROOT" ? "" : prevCursorToken;
  const prevStack = data.stack.slice(0, -1).join(",");
  const isLoading = navigation.state !== "idle";
  const groups = useMemo(() => groupReceiptsByReference(receipts), [receipts]);

  const applyFilters = () => {
    const path = `/produits-en-reception?q=${encodeURIComponent(query)}&orderDay=${encodeURIComponent(orderDay)}&status=${encodeURIComponent(status)}&sort=${encodeURIComponent(sort)}`;
    const result = embeddedNavigate(path);
    if (!result.ok) {
      setToast({ content: "Navigation impossible.", error: true });
    }
  };

  return (
    <Page
      title={`Commandes boutique ${data.locationCity}`}
      subtitle="Commandes importées depuis Prestashop BtoB"
      secondaryActions={[{ content: "Tableau de bord", onAction: () => embeddedNavigate("/tableau-de-bord") }]}
    >
      {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}

      <BlockStack gap="400">
        {data.scopeIssue ? (
          <Banner tone="critical">
            <Text as="p" variant="bodyMd">
              {data.scopeIssue.message}
            </Text>
          </Banner>
        ) : null}

        {!data.locationConfigured && data.configurationMessage ? (
          <Banner tone="warning" title="Configuration requise">
            {data.configurationMessage}
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              Seules les commandes Prestashop BtoB sont listées.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Les commandes fractionnées restent indépendantes, mais elles sont regroupées visuellement par référence.
            </Text>
            <InlineStack gap="300" align="start" blockAlign="end">
              <Box minWidth="240px">
                <TextField
                  label="Recherche (ID ou référence)"
                  name="q"
                  value={query}
                  onChange={setQuery}
                  autoComplete="off"
                />
              </Box>
              <Select
                label="Statut"
                name="status"
                value={status}
                onChange={setStatus}
                options={[
                  { label: "Tous", value: "" },
                  { label: "À vérifier", value: "IMPORTED" },
                  { label: "Confirmer la réception", value: "READY" },
                  { label: "Bloquée", value: "BLOCKED" },
                  { label: "En cours d'arrivage", value: "INCOMING" },
                  { label: "Reçue en boutique", value: "APPLIED" },
                  { label: "Stock retiré", value: "ROLLED_BACK" },
                ]}
              />
              <Box width="170px" minWidth="170px">
                <TextField
                  label="Date commande"
                  type="date"
                  name="orderDay"
                  value={orderDay}
                  onChange={setOrderDay}
                  autoComplete="off"
                />
              </Box>
              <Select
                label="Tri"
                name="sort"
                value={sort}
                onChange={setSort}
                options={[
                  { label: "Date décroissante", value: "date_desc" },
                  { label: "Date croissante", value: "date_asc" },
                  { label: "ID décroissant", value: "id_desc" },
                  { label: "ID croissant", value: "id_asc" },
                ]}
              />
              <Button submit={false} onClick={applyFilters}>
                Filtrer
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {isLoading ? (
          <Card>
            <BlockStack gap="300">
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText />
            </BlockStack>
          </Card>
        ) : groups.length === 0 ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Commandes introuvables
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Essayez de changer les filtres ou le terme de recherche.
              </Text>
            </BlockStack>
          </Card>
        ) : (
          <BlockStack gap="400">
            {groups.map((group) => (
              <Card key={group.key} background={group.isSplit ? "bg-surface-secondary" : "bg-surface"}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="h2" variant="headingMd">
                        {group.reference}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {group.isSplit
                          ? `${group.receipts.length} sous-commandes liées à la même commande d'origine`
                          : "Commande unique"}
                      </Text>
                    </BlockStack>
                    {group.isSplit ? <Badge tone="info">Commande fractionnée</Badge> : null}
                  </InlineStack>

                  <BlockStack gap="200">
                    {group.receipts.map((receipt) => (
                      <Box
                        key={receipt.gid}
                        padding="300"
                        borderWidth="025"
                        borderColor="border"
                        borderRadius="200"
                        background="bg-surface"
                      >
                        <InlineStack align="space-between" blockAlign="start" gap="400">
                          <BlockStack gap="100">
                            <Text as="h3" variant="bodyMd" fontWeight="semibold">
                              Sous-commande #{receipt.prestaOrderId}
                            </Text>
                            <InlineStack gap="200">
                              <Badge tone={badgeTone(receipt.status)}>{statusLabel(receipt.status)}</Badge>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Date de commande : {formatDisplayDate(receipt.prestaDateAdd)}
                            </Text>
                          </BlockStack>

                          <Button
                            size="slim"
                            submit={false}
                            onClick={() => {
                              const receiptIdEnc = encodeReceiptIdForUrl(receipt.gid);
                              const result = embeddedNavigate(`/produits-en-reception/${receiptIdEnc}`);
                              if (!result.ok) {
                                setToast({ content: "Navigation impossible.", error: true });
                              }
                            }}
                          >
                            Ouvrir
                          </Button>
                        </InlineStack>
                      </Box>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
        )}

        <InlineStack gap="300" align="space-between">
          <Button
            disabled={data.stack.length === 0}
            onClick={() =>
              embeddedNavigate(
                `/produits-en-reception?q=${encodeURIComponent(data.q)}&status=${encodeURIComponent(
                  data.status,
                )}&orderDay=${encodeURIComponent(data.orderDay)}&sort=${encodeURIComponent(data.sort)}&cursor=${encodeURIComponent(prevCursor)}&stack=${encodeURIComponent(
                  prevStack,
                )}`,
              )
            }
          >
            Précédent
          </Button>
          <Button
            disabled={!data.pageInfo.hasNextPage || !data.pageInfo.endCursor}
            onClick={() =>
              embeddedNavigate(
                `/produits-en-reception?q=${encodeURIComponent(data.q)}&status=${encodeURIComponent(
                  data.status,
                )}&orderDay=${encodeURIComponent(data.orderDay)}&sort=${encodeURIComponent(data.sort)}&cursor=${encodeURIComponent(
                  data.pageInfo.endCursor ?? "",
                )}&stack=${encodeURIComponent(nextStack)}`,
              )
            }
          >
            Suivant
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
