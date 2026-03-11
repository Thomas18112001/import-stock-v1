import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { withEmbeddedContext } from "../utils/embeddedPath";

type NavigationResult = { ok: boolean; error?: string };

export function useEmbeddedNavigate() {
  const routerNavigate = useNavigate();
  const location = useLocation();

  return useCallback(
    (path: string): NavigationResult => {
      if (!path.startsWith("/")) {
        return { ok: false, error: "Chemin de navigation invalide" };
      }
      const contextualPath = withEmbeddedContext(path, location.search, location.pathname);
      try {
        routerNavigate(contextualPath);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Navigation impossible";
        return { ok: false, error: message };
      }
    },
    [location.pathname, location.search, routerNavigate],
  );
}
