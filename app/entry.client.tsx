import { startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

function stripInjectedAttributes(element: Element) {
  for (const attribute of [...element.attributes]) {
    if (attribute.name.startsWith("bis_") || attribute.name.startsWith("data-bis")) {
      element.removeAttribute(attribute.name);
    }
  }
}

function cleanupInjectedDom() {
  const injectedScriptSelectors = [
    'script[src^="chrome-extension://"]',
    "script[bis_use]",
    "script[data-bis-config]",
    'script[src*="/cdn-cgi/scripts/"][src*="email-decode"]',
  ];

  document.querySelectorAll(injectedScriptSelectors.join(",")).forEach((node) => {
    node.remove();
  });

  stripInjectedAttributes(document.documentElement);
  stripInjectedAttributes(document.head);
  stripInjectedAttributes(document.body);

  document.querySelectorAll("*").forEach((element) => {
    stripInjectedAttributes(element);
  });
}

cleanupInjectedDom();

startTransition(() => {
  hydrateRoot(document, <HydratedRouter />);
});
