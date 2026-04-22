import type { IncomingMessage } from "node:http";
import { isRelayAuthMode, type RelayAuthMode, type RelayAuthorizationMode, type RelayConfigPayload } from "@remote-console/protocol";

const viewerKeyHeaderName = "x-remote-console-viewer-key";
const agentKeyHeaderName = "x-remote-console-agent-key";

export type RelayRuntimeConfig = {
  viewer: {
    mode: RelayAuthMode;
    sharedKey: string | null;
    status: "ready" | "planned";
  };
  agent: {
    sharedKey: string;
  };
  authorization: {
    mode: RelayAuthorizationMode;
    allowedViewerIds: string[];
  };
  publicConfig: RelayConfigPayload;
};

export type AuthorizationResult =
  | { ok: true }
  | { ok: false; statusCode: number; message: string };

export function loadRelayRuntimeConfig(env: NodeJS.ProcessEnv): RelayRuntimeConfig {
  const modeCandidate = env.RELAY_AUTH_MODE ?? "shared-key";
  if (!isRelayAuthMode(modeCandidate)) {
    throw new Error(`Unsupported RELAY_AUTH_MODE '${modeCandidate}'. Expected 'shared-key' or 'entra-id'.`);
  }

  const allowedViewerIds = splitList(env.AUTHORIZED_VIEWER_OBJECT_IDS);
  const authorizationMode: RelayAuthorizationMode = modeCandidate === "shared-key"
    ? "development-shared-key"
    : "entra-viewer-allowlist";
  const viewerStatus = modeCandidate === "shared-key" ? "ready" : "planned";

  return {
    viewer: {
      mode: modeCandidate,
      sharedKey: modeCandidate === "shared-key" ? env.VIEWER_SHARED_KEY ?? "viewer-dev-key" : null,
      status: viewerStatus
    },
    agent: {
      sharedKey: env.AGENT_SHARED_KEY ?? "agent-dev-key"
    },
    authorization: {
      mode: authorizationMode,
      allowedViewerIds
    },
    publicConfig: {
      viewerAuth: {
        mode: modeCandidate,
        status: viewerStatus,
        viewerKeyHeaderName: modeCandidate === "shared-key" ? viewerKeyHeaderName : null,
        teamsSsoEnabled: modeCandidate === "entra-id"
      },
      agentAuth: {
        mode: "shared-key",
        status: "ready",
        agentKeyHeaderName
      },
      authorization: {
        mode: authorizationMode,
        allowedViewerCount: allowedViewerIds.length,
        requiresUserMapping: modeCandidate === "entra-id",
        machineBindingEnabled: modeCandidate === "entra-id"
      }
    }
  };
}

export function authorizeViewer(
  request: IncomingMessage,
  url: URL,
  config: RelayRuntimeConfig)
: AuthorizationResult {
  if (config.viewer.mode === "entra-id") {
    return {
      ok: false,
      statusCode: 501,
      message: "Viewer auth is configured for Entra ID, but token validation is not implemented yet."
    };
  }

  const headerValue = request.headers[viewerKeyHeaderName];
  const keyFromHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const keyFromQuery = url.searchParams.get("viewerKey");

  if (keyFromHeader === config.viewer.sharedKey || keyFromQuery === config.viewer.sharedKey) {
    return { ok: true };
  }

  return {
    ok: false,
    statusCode: 401,
    message: "Viewer key was missing or invalid."
  };
}

export function authorizeAgent(
  request: IncomingMessage,
  config: RelayRuntimeConfig)
: AuthorizationResult {
  const headerValue = request.headers[agentKeyHeaderName];
  const keyFromHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (keyFromHeader === config.agent.sharedKey) {
    return { ok: true };
  }

  return {
    ok: false,
    statusCode: 401,
    message: "Agent key was missing or invalid."
  };
}

function splitList(value: string | undefined): string[] {
  return value?.split(",")
    .map(item => item.trim())
    .filter(Boolean) ?? [];
}
