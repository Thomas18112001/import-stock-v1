import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { withRequestEmbeddedContext } from "../utils/embeddedContext.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  throw redirect(withRequestEmbeddedContext(request, "/produits-en-reception"));
};

export default function DashboardReceiptsAliasRoute() {
  return null;
}
