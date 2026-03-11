import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { withRequestEmbeddedContext } from "../utils/embeddedContext.server";

const ALIAS_BY_PATHNAME: Record<string, string> = {
  "/dashboard": "/tableau-de-bord",
  "/stats": "/stats-inventaire",
  "/planning": "/planification-stock",
  "/planification-stocks": "/planification-stock",
  "/inventory-health": "/sante-inventaire",
  "/alerts": "/alertes-inventaire",
  "/alertes": "/alertes-inventaire",
  "/suppliers": "/fournisseurs",
  "/commandes": "/produits-en-reception",
  "/tableau-de-bord/commandes": "/produits-en-reception",
  "/tableau-de-bord/produits-en-reception": "/produits-en-reception",
};

const ROOT_SECTIONS = new Set([
  "tableau-de-bord",
  "produits-en-reception",
  "reassorts-magasin",
  "planification-stock",
  "stats-inventaire",
  "fournisseurs",
  "sante-inventaire",
  "alertes-inventaire",
  "aide-autorisations",
  "commandes",
]);

function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim().replace(/\/+$/, "") || "/";
  const segments = trimmed.split("/").filter(Boolean);
  const rootIndex = segments.findIndex((segment) => ROOT_SECTIONS.has(segment));
  if (rootIndex >= 0) {
    return `/${segments.slice(rootIndex).join("/")}`;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const normalizedPath = normalizePathname(url.pathname);
  const canonicalPath = ALIAS_BY_PATHNAME[normalizedPath] || "/tableau-de-bord";
  const target = `${canonicalPath}${url.search}`;
  throw redirect(withRequestEmbeddedContext(request, target));
};

export default function LegacyCatchAllRedirectRoute() {
  return null;
}
