import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { parseScopes, REQUIRED_SHOPIFY_SCOPES } from "../config/shopifyScopes";
import { withRequestEmbeddedContext } from "../utils/embeddedContext.server";
import { hostParamFromShop, readLinkedDevStoreFromProject, shopFromHostParam } from "../utils/shopDomain";
import { isValidShopDomain } from "../utils/validators";

export type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

function tryParseUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function resolveShopFromRequest(request: Request): string {
  const requestUrl = new URL(request.url);
  const refererUrl = tryParseUrl(request.headers.get("referer"));

  return (
    requestUrl.searchParams.get("shop")?.trim() ||
    shopFromHostParam(requestUrl.searchParams.get("host")) ||
    refererUrl?.searchParams.get("shop")?.trim() ||
    shopFromHostParam(refererUrl?.searchParams.get("host")) ||
    readLinkedDevStoreFromProject() ||
    process.env.SHOP ||
    ""
  );
}

export function buildAuthLoginPath(request: Request): string {
  const requestUrl = new URL(request.url);
  const refererUrl = tryParseUrl(request.headers.get("referer"));
  const shop = resolveShopFromRequest(request);
  const host =
    requestUrl.searchParams.get("host")?.trim() ||
    refererUrl?.searchParams.get("host")?.trim() ||
    hostParamFromShop(shop) ||
    "";
  const isEmbedded =
    requestUrl.searchParams.get("embedded") === "1" ||
    refererUrl?.searchParams.get("embedded") === "1" ||
    Boolean(host);

  const params = new URLSearchParams();
  if (shop) params.set("shop", shop);
  if (host) params.set("host", host);
  if (isEmbedded) params.set("embedded", "1");

  const target = `/auth/login${params.toString() ? `?${params.toString()}` : ""}`;
  return withRequestEmbeddedContext(request, target);
}

function normalizeAdminAuthError(error: unknown, request: Request): never {
  if (error instanceof Response) {
    const contentType = error.headers.get("content-type")?.toLowerCase() ?? "";
    const isHtmlDocument = contentType.includes("text/html");
    const isAuthHandshakeResponse =
      error.status === 410 ||
      (error.status >= 200 && error.status < 400 && isHtmlDocument);

    if (isAuthHandshakeResponse) {
      throw redirect(buildAuthLoginPath(request));
    }
  }
  throw error;
}

export async function requireAdmin(request: Request): Promise<{
  admin: AdminClient;
  shop: string;
  actor: string;
}> {
  const debug = process.env.DEBUG === "true";
  const pathname = new URL(request.url).pathname;

  let auth:
    | Awaited<ReturnType<typeof authenticate.admin>>
    | never;
  try {
    auth = await authenticate.admin(request);
  } catch (error) {
    if (debug) {
      if (error instanceof Response) {
        console.info("[debug] auth missing session", {
          path: pathname,
          status: error.status,
          redirectTo: error.headers.get("Location") ?? null,
        });
      } else {
        console.info("[debug] auth error", {
          path: pathname,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    normalizeAdminAuthError(error, request);
  }

  const sessionShop = auth.session.shop;
  if (!isValidShopDomain(sessionShop)) {
    throw new Response("Contexte boutique invalide.", { status: 403 });
  }
  const requestShop = new URL(request.url).searchParams.get("shop");
  if (requestShop && requestShop !== sessionShop) {
    throw new Response("Contexte boutique incohérent.", { status: 403 });
  }
  const session = auth.session as {
    email?: string | null;
    userId?: string | number | bigint | null;
    shop: string;
  };
  const actor =
    session.email ??
    (session.userId ? String(session.userId) : session.shop);
  if (debug) {
    console.info("[debug] auth session ok", {
      path: pathname,
      shop: sessionShop,
      expectedScopes: REQUIRED_SHOPIFY_SCOPES.join(","),
      grantedScopes: parseScopes(process.env.SCOPES).join(","),
    });
  }
  return {
    admin: auth.admin as AdminClient,
    shop: sessionShop,
    actor,
  };
}
