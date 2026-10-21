import type { Connector } from "./types";
import { greenhouseConnector, leverConnector, ashbyConnector } from "./ats";
import { portalConnectors } from "./portals";

export const ALL_CONNECTORS: Connector[] = [
  greenhouseConnector,
  leverConnector,
  ashbyConnector,
  ...portalConnectors,
];

export const connectorsById = new Map(ALL_CONNECTORS.map((c) => [c.id, c]));

export function getConnector(id: string): Connector | undefined {
  return connectorsById.get(id);
}

export function connectorSummaries() {
  return ALL_CONNECTORS.map((c) => ({
    id: c.id,
    label: c.label,
    kind: c.kind,
    tosNote: c.tosNote,
    requiresLogin: c.requiresLogin,
    loginUrl: c.loginUrl ?? "",
  }));
}

export * from "./types";
