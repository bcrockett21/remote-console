import { createPublicKey, verify as verifySignature } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import type { SessionDescriptor } from "@remote-console/protocol";
import { isRelayAuthMode, type RelayAuthMode, type RelayAuthorizationMode, type RelayConfigPayload } from "@remote-console/protocol";

const viewerKeyHeaderName = "x-remote-console-viewer-key";
const agentKeyHeaderName = "x-remote-console-agent-key";
const accessTokenHeaderName = "authorization";
const defaultMetadataTtlMs = 15 * 60 * 1000;
const clockSkewSeconds = 300;

const metadataCache = new Map<string, CachedMetadata>();
const keysCache = new Map<string, CachedSigningKeys>();

export type RelayRuntimeConfig = {
  viewer: SharedKeyViewerConfig | EntraViewerConfig;
  agent: {
    sharedKey: string;
  };
  authorization: {
    mode: RelayAuthorizationMode;
    allowedViewerIds: string[];
    sessionViewerBindings: Map<string, Set<string>>;
  };
  publicConfig: RelayConfigPayload;
};

type SharedKeyViewerConfig = {
  mode: "shared-key";
  sharedKey: string;
  status: "ready";
};

type EntraViewerConfig = {
  mode: "entra-id";
  status: "ready";
  tenantId: string;
  clientId: string;
  appResource: string | null;
  openIdConfigurationUrl: string;
};

type OpenIdConfiguration = {
  issuer: string;
  jwks_uri: string;
};

type SigningKey = {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  x5c?: string[];
  issuer?: string;
};

type JwtHeader = {
  alg?: string;
  kid?: string;
};

type JwtPayload = {
  aud?: string | string[];
  exp?: number;
  iat?: number;
  iss?: string;
  nbf?: number;
  oid?: string;
  preferred_username?: string;
  scp?: string;
  tid?: string;
  ver?: string;
};

type CachedMetadata = {
  expiresAt: number;
  value: OpenIdConfiguration;
};

type CachedSigningKeys = {
  expiresAt: number;
  value: SigningKey[];
};

type AuthorizationPolicyFile = {
  allowedViewerObjectIds?: unknown;
  sessionViewerBindings?: unknown;
};

export type AuthorizationResult =
  | { ok: true; viewer?: ViewerIdentity }
  | { ok: false; statusCode: number; message: string };

export type ViewerIdentity = {
  objectId: string;
  tenantId: string;
  username: string | null;
};

export type AuthDependencies = {
  fetchImpl?: typeof fetch;
  now?: Date;
};

export function loadRelayRuntimeConfig(env: NodeJS.ProcessEnv): RelayRuntimeConfig {
  const modeCandidate = env.RELAY_AUTH_MODE ?? "shared-key";
  if (!isRelayAuthMode(modeCandidate)) {
    throw new Error(`Unsupported RELAY_AUTH_MODE '${modeCandidate}'. Expected 'shared-key' or 'entra-id'.`);
  }

  const authorizationPolicy = loadAuthorizationPolicy(env);
  const allowedViewerIds = authorizationPolicy.allowedViewerIds;
  const sessionViewerBindings = authorizationPolicy.sessionViewerBindings;
  const authorizationMode = resolveAuthorizationMode(modeCandidate, sessionViewerBindings);

  if (modeCandidate === "shared-key") {
    return {
      viewer: {
        mode: "shared-key",
        sharedKey: env.VIEWER_SHARED_KEY ?? "viewer-dev-key",
        status: "ready"
      },
      agent: {
        sharedKey: env.AGENT_SHARED_KEY ?? "agent-dev-key"
      },
      authorization: {
        mode: authorizationMode,
        allowedViewerIds,
        sessionViewerBindings
      },
      publicConfig: {
        viewerAuth: {
          mode: "shared-key",
          status: "ready",
          viewerKeyHeaderName,
          accessTokenHeaderName: null,
          teamsSsoEnabled: false,
          requiresTeamsHost: false,
          expectedAudience: null
        },
        agentAuth: {
          mode: "shared-key",
          status: "ready",
          agentKeyHeaderName
        },
        authorization: {
          mode: authorizationMode,
          allowedViewerCount: allowedViewerIds.length,
          sessionBindingCount: sessionViewerBindings.size,
          requiresUserMapping: false,
          machineBindingEnabled: false
        }
      }
    };
  }

  const tenantId = requireEnv(env.ENTRA_TENANT_ID, "ENTRA_TENANT_ID");
  const clientId = requireEnv(env.MICROSOFT_APP_ID ?? env.ENTRA_CLIENT_ID, "MICROSOFT_APP_ID");
  const appResource = normalizeOptional(env.MICROSOFT_APP_RESOURCE ?? env.ENTRA_APP_ID_URI);
  const openIdConfigurationUrl = env.ENTRA_OPENID_CONFIGURATION_URL
    ?? `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`;

  return {
    viewer: {
      mode: "entra-id",
      status: "ready",
      tenantId,
      clientId,
      appResource,
      openIdConfigurationUrl
    },
    agent: {
      sharedKey: env.AGENT_SHARED_KEY ?? "agent-dev-key"
    },
    authorization: {
      mode: authorizationMode,
      allowedViewerIds,
      sessionViewerBindings
    },
    publicConfig: {
      viewerAuth: {
        mode: "entra-id",
        status: "ready",
        viewerKeyHeaderName: null,
        accessTokenHeaderName,
        teamsSsoEnabled: true,
        requiresTeamsHost: true,
        expectedAudience: appResource ?? clientId
      },
      agentAuth: {
        mode: "shared-key",
        status: "ready",
        agentKeyHeaderName
      },
      authorization: {
        mode: authorizationMode,
        allowedViewerCount: allowedViewerIds.length,
        sessionBindingCount: sessionViewerBindings.size,
        requiresUserMapping: true,
        machineBindingEnabled: true
      }
    }
  };
}

export async function authorizeViewer(
  request: IncomingMessage,
  url: URL,
  config: RelayRuntimeConfig,
  dependencies: AuthDependencies = {})
: Promise<AuthorizationResult> {
  if (config.viewer.mode === "shared-key") {
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

  const bearerToken = readBearerToken(request);
  if (!bearerToken) {
    return {
      ok: false,
      statusCode: 401,
      message: "Bearer token was missing or invalid."
    };
  }

  try {
    const identity = await validateEntraViewerToken(bearerToken, config, dependencies);

    if (!config.authorization.allowedViewerIds.includes(identity.objectId)) {
      return {
        ok: false,
        statusCode: 403,
        message: "Viewer is authenticated but not authorized for this relay."
      };
    }

    return {
      ok: true,
      viewer: identity
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 401,
      message: error instanceof Error ? error.message : "Viewer token validation failed."
    };
  }
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

export function filterAuthorizedSessions(
  sessions: SessionDescriptor[],
  viewer: ViewerIdentity | undefined,
  config: RelayRuntimeConfig)
: SessionDescriptor[] {
  if (config.authorization.mode !== "entra-session-allowlist") {
    return sessions;
  }

  if (!viewer) {
    return [];
  }

  return sessions.filter(session => canViewerAccessSession(session.id, viewer, config));
}

export function canViewerAccessSession(
  sessionId: string,
  viewer: ViewerIdentity | undefined,
  config: RelayRuntimeConfig)
: boolean {
  if (config.authorization.mode !== "entra-session-allowlist") {
    return true;
  }

  if (!viewer) {
    return false;
  }

  const allowedViewers = config.authorization.sessionViewerBindings.get(sessionId);
  return allowedViewers?.has(viewer.objectId) ?? false;
}

async function validateEntraViewerToken(
  token: string,
  config: RelayRuntimeConfig,
  dependencies: AuthDependencies)
: Promise<ViewerIdentity> {
  if (config.viewer.mode !== "entra-id") {
    throw new Error("Viewer auth is not configured for Entra ID.");
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? new Date();
  const jwt = parseJwt(token);
  const metadata = await getOpenIdConfiguration(config.viewer.openIdConfigurationUrl, fetchImpl, now);
  const signingKeys = await getSigningKeys(metadata.jwks_uri, fetchImpl, now);
  const signingKey = signingKeys.find(key => key.kid === jwt.header.kid);
  if (!signingKey) {
    throw new Error("Viewer token signature key was not found.");
  }

  verifyJwtSignature(jwt.signingInput, jwt.signature, signingKey);
  validateTokenClaims(jwt.payload, config.viewer, metadata, now);

  return {
    objectId: jwt.payload.oid ?? "",
    tenantId: jwt.payload.tid ?? "",
    username: typeof jwt.payload.preferred_username === "string" ? jwt.payload.preferred_username : null
  };
}

function validateTokenClaims(
  payload: JwtPayload,
  config: EntraViewerConfig,
  metadata: OpenIdConfiguration,
  now: Date)
: void {
  if (payload.iss !== metadata.issuer) {
    throw new Error("Viewer token issuer did not match the configured tenant.");
  }

  const validAudiences = [config.clientId, config.appResource].filter((value): value is string => Boolean(value));
  const audiences = normalizeAudiences(payload.aud);
  if (!audiences.some(audience => validAudiences.includes(audience))) {
    throw new Error("Viewer token audience did not match this application.");
  }

  if (payload.tid !== config.tenantId) {
    throw new Error("Viewer token tenant did not match the configured tenant.");
  }

  if (typeof payload.oid !== "string" || payload.oid.length === 0) {
    throw new Error("Viewer token did not include an object id.");
  }

  const scopes = typeof payload.scp === "string" ? payload.scp.split(" ").filter(Boolean) : [];
  if (!scopes.includes("access_as_user")) {
    throw new Error("Viewer token did not include the required access_as_user scope.");
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (typeof payload.nbf === "number" && payload.nbf > nowSeconds + clockSkewSeconds) {
    throw new Error("Viewer token is not active yet.");
  }

  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds - clockSkewSeconds) {
    throw new Error("Viewer token is expired.");
  }
}

function verifyJwtSignature(signingInput: string, signature: Buffer, signingKey: SigningKey): void {
  const publicKey = createSigningPublicKey(signingKey);
  const verified = verifySignature("RSA-SHA256", Buffer.from(signingInput, "utf8"), publicKey, signature);
  if (!verified) {
    throw new Error("Viewer token signature verification failed.");
  }
}

function createSigningPublicKey(signingKey: SigningKey) {
  if (signingKey.kty === "RSA" && typeof signingKey.n === "string" && typeof signingKey.e === "string") {
    return createPublicKey({
      key: {
        kty: "RSA",
        n: signingKey.n,
        e: signingKey.e
      },
      format: "jwk"
    });
  }

  const certificate = signingKey.x5c?.[0];
  if (typeof certificate === "string" && certificate.length > 0) {
    const pem = `-----BEGIN CERTIFICATE-----\n${wrapPem(certificate)}\n-----END CERTIFICATE-----`;
    return createPublicKey(pem);
  }

  throw new Error("Viewer token signing key was incomplete.");
}

function parseJwt(token: string): { header: JwtHeader; payload: JwtPayload; signature: Buffer; signingInput: string } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Viewer token was not a valid JWT.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJwtSection<JwtHeader>(encodedHeader, "header");
  const payload = parseJwtSection<JwtPayload>(encodedPayload, "payload");

  if (header.alg !== "RS256") {
    throw new Error("Viewer token used an unsupported signing algorithm.");
  }

  if (typeof header.kid !== "string" || header.kid.length === 0) {
    throw new Error("Viewer token did not include a signing key id.");
  }

  return {
    header,
    payload,
    signature: decodeBase64Url(encodedSignature),
    signingInput: `${encodedHeader}.${encodedPayload}`
  };
}

function parseJwtSection<T>(value: string, label: string): T {
  try {
    return JSON.parse(decodeBase64Url(value).toString("utf8")) as T;
  } catch {
    throw new Error(`Viewer token ${label} was not valid JSON.`);
  }
}

async function getOpenIdConfiguration(
  url: string,
  fetchImpl: typeof fetch,
  now: Date)
: Promise<OpenIdConfiguration> {
  const cached = metadataCache.get(url);
  if (cached && cached.expiresAt > now.getTime()) {
    return cached.value;
  }

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to load OpenID configuration from ${url}.`);
  }

  const metadata = await response.json() as Partial<OpenIdConfiguration>;
  if (typeof metadata.issuer !== "string" || typeof metadata.jwks_uri !== "string") {
    throw new Error("OpenID configuration was incomplete.");
  }

  metadataCache.set(url, {
    expiresAt: now.getTime() + defaultMetadataTtlMs,
    value: {
      issuer: metadata.issuer,
      jwks_uri: metadata.jwks_uri
    }
  });

  return metadataCache.get(url)!.value;
}

async function getSigningKeys(
  url: string,
  fetchImpl: typeof fetch,
  now: Date)
: Promise<SigningKey[]> {
  const cached = keysCache.get(url);
  if (cached && cached.expiresAt > now.getTime()) {
    return cached.value;
  }

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to load signing keys from ${url}.`);
  }

  const payload = await response.json() as { keys?: unknown };
  if (!Array.isArray(payload.keys)) {
    throw new Error("Signing keys payload was incomplete.");
  }

  const signingKeys = payload.keys
    .filter((value): value is SigningKey => typeof value === "object" && value !== null);

  keysCache.set(url, {
    expiresAt: now.getTime() + defaultMetadataTtlMs,
    value: signingKeys
  });

  return signingKeys;
}

function readBearerToken(request: IncomingMessage): string | null {
  const authorizationHeader = request.headers[accessTokenHeaderName];
  const headerValue = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  if (typeof headerValue !== "string") {
    return null;
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function normalizeAudiences(audience: JwtPayload["aud"]): string[] {
  if (typeof audience === "string") {
    return [audience];
  }

  return Array.isArray(audience)
    ? audience.filter((value): value is string => typeof value === "string")
    : [];
}

function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64");
}

function wrapPem(value: string): string {
  return value.match(/.{1,64}/g)?.join("\n") ?? value;
}

function normalizeOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function loadAuthorizationPolicy(env: NodeJS.ProcessEnv): {
  allowedViewerIds: string[];
  sessionViewerBindings: Map<string, Set<string>>;
} {
  const filePath = normalizeOptional(env.RELAY_AUTH_POLICY_FILE);
  if (!filePath) {
    return {
      allowedViewerIds: splitList(env.AUTHORIZED_VIEWER_OBJECT_IDS),
      sessionViewerBindings: parseSessionViewerBindings(env.SESSION_VIEWER_BINDINGS)
    };
  }

  const resolvedPath = path.resolve(filePath);
  const raw = readFileSync(resolvedPath, "utf8");
  const parsed = JSON.parse(raw) as AuthorizationPolicyFile;

  return {
    allowedViewerIds: parseAllowedViewerObjectIds(parsed.allowedViewerObjectIds),
    sessionViewerBindings: parseSessionViewerBindingObject(parsed.sessionViewerBindings)
  };
}

function resolveAuthorizationMode(
  authMode: RelayAuthMode,
  sessionViewerBindings: Map<string, Set<string>>)
: RelayAuthorizationMode {
  if (authMode === "shared-key") {
    return "development-shared-key";
  }

  return sessionViewerBindings.size > 0
    ? "entra-session-allowlist"
    : "entra-viewer-allowlist";
}

function splitList(value: string | undefined): string[] {
  return value?.split(",")
    .map(item => item.trim())
    .filter(Boolean) ?? [];
}

function parseAllowedViewerObjectIds(value: unknown): string[] {
  if (typeof value === "undefined") {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("Authorization policy field 'allowedViewerObjectIds' must be an array of strings.");
  }

  return value
    .map(item => {
      if (typeof item !== "string" || item.trim().length === 0) {
        throw new Error("Authorization policy field 'allowedViewerObjectIds' must contain non-empty strings.");
      }

      return item.trim();
    });
}

function parseSessionViewerBindings(value: string | undefined): Map<string, Set<string>> {
  const bindings = new Map<string, Set<string>>();
  const trimmed = value?.trim();
  if (!trimmed) {
    return bindings;
  }

  for (const entry of trimmed.split(";")) {
    const normalizedEntry = entry.trim();
    if (!normalizedEntry) {
      continue;
    }

    const [sessionId, viewerList] = normalizedEntry.split(":", 2);
    const normalizedSessionId = sessionId?.trim();
    if (!normalizedSessionId || !viewerList) {
      throw new Error("SESSION_VIEWER_BINDINGS entries must use the format 'session-id:viewer-a|viewer-b'.");
    }

    const viewers = viewerList
      .split("|")
      .map(item => item.trim())
      .filter(Boolean);

    if (viewers.length === 0) {
      throw new Error(`SESSION_VIEWER_BINDINGS entry for '${normalizedSessionId}' did not include any viewer object ids.`);
    }

    bindings.set(normalizedSessionId, new Set(viewers));
  }

  return bindings;
}

function parseSessionViewerBindingObject(value: unknown): Map<string, Set<string>> {
  const bindings = new Map<string, Set<string>>();
  if (typeof value === "undefined") {
    return bindings;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Authorization policy field 'sessionViewerBindings' must be an object keyed by session id.");
  }

  for (const [sessionId, viewerIds] of Object.entries(value)) {
    if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
      throw new Error("Authorization policy 'sessionViewerBindings' contained an invalid session id.");
    }

    if (!Array.isArray(viewerIds) || viewerIds.length === 0) {
      throw new Error(`Authorization policy binding for '${sessionId}' must be a non-empty array of viewer object ids.`);
    }

    const normalizedViewers = viewerIds.map(item => {
      if (typeof item !== "string" || item.trim().length === 0) {
        throw new Error(`Authorization policy binding for '${sessionId}' must contain non-empty viewer object ids.`);
      }

      return item.trim();
    });

    bindings.set(sessionId.trim(), new Set(normalizedViewers));
  }

  return bindings;
}

function requireEnv(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} is required when RELAY_AUTH_MODE=entra-id.`);
  }

  return trimmed;
}
