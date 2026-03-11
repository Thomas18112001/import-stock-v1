const EMBEDDED_CONTEXT_KEYS = ["shop", "host", "embedded"] as const;

function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function readContextValue(source: URL, key: (typeof EMBEDDED_CONTEXT_KEYS)[number]): string {
  return (source.searchParams.get(key) || "").trim();
}

export function withRequestEmbeddedContext(request: Request, targetPath: string): string {
  const requestUrl = new URL(request.url);
  const target = new URL(targetPath, requestUrl.origin);

  const refererUrl = tryParseUrl(request.headers.get("referer") || "");
  const contextSources = [requestUrl, refererUrl].filter(Boolean) as URL[];

  for (const key of EMBEDDED_CONTEXT_KEYS) {
    if ((target.searchParams.get(key) || "").trim()) continue;
    for (const source of contextSources) {
      const value = readContextValue(source, key);
      if (!value) continue;
      target.searchParams.set(key, value);
      break;
    }
  }

  return `${target.pathname}${target.search}${target.hash}`;
}
