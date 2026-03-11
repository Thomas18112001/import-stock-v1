import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as EmbeddedAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider, Box, Frame, InlineStack, Text } from "@shopify/polaris";
import frTranslations from "@shopify/polaris/locales/fr.json";

import { requireAdmin } from "../services/auth.server";
import "../styles/cursor-behavior.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

function AppShell() {
  return (
    <PolarisAppProvider i18n={frTranslations}>
      <div className="wm-app">
        <Frame>
          <Box minHeight="100vh" paddingBlockEnd="800">
            <Outlet />

            <Box paddingBlockStart="1000" paddingBlockEnd="800">
              <InlineStack align="center" blockAlign="center" gap="200">
                <img src="/logo-woora.png" alt="Woora" style={{ width: "180px", height: "auto" }} />
              </InlineStack>
              <Box paddingBlockStart="300">
                <InlineStack align="center" gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Application développée par{" "}
                    <a
                      href="https://woora.fr"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "inherit", textDecoration: "underline" }}
                    >
                      Woora
                    </a>
                    .{" "}
                    <a
                      href="https://woora.fr"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "inherit", textDecoration: "underline" }}
                    >
                      Support
                    </a>
                  </Text>
                </InlineStack>
              </Box>
            </Box>
          </Box>
        </Frame>
      </div>
    </PolarisAppProvider>
  );
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <EmbeddedAppProvider embedded apiKey={apiKey}>
      <AppShell />
    </EmbeddedAppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
