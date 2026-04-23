import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SessionDescriptor } from "@remote-console/protocol";
import { authorizeAgent, authorizeViewer, canViewerAccessSession, filterAuthorizedSessions, loadRelayRuntimeConfig } from "./auth.js";

const tenantId = "7c6f4c7c-79f6-41fb-a8ad-1c5f373a4c11";
const clientId = "1c8ae727-9bf1-4b26-a31a-d1a7bde82024";
const appResource = `api://remote-console.example.com/${clientId}`;

await run("loadRelayRuntimeConfig defaults to shared-key development auth", () => {
  const config = loadRelayRuntimeConfig({});

  assert.equal(config.viewer.mode, "shared-key");
  assert.equal(config.viewer.sharedKey, "viewer-dev-key");
  assert.equal(config.publicConfig.viewerAuth.status, "ready");
  assert.equal(config.publicConfig.viewerAuth.accessTokenHeaderName, null);
  assert.equal(config.publicConfig.authorization.mode, "development-shared-key");
  assert.equal(config.publicConfig.authorization.sessionBindingCount, 0);
});

await run("loadRelayRuntimeConfig requires Entra tenant and client configuration", () => {
  assert.throws(() => loadRelayRuntimeConfig({
    RELAY_AUTH_MODE: "entra-id"
  }), /ENTRA_TENANT_ID is required/);
});

await run("loadRelayRuntimeConfig builds Entra auth config", () => {
  const config = loadRelayRuntimeConfig({
    RELAY_AUTH_MODE: "entra-id",
    ENTRA_TENANT_ID: tenantId,
    MICROSOFT_APP_ID: clientId,
    MICROSOFT_APP_RESOURCE: appResource,
    AUTHORIZED_VIEWER_OBJECT_IDS: "user-a, user-b"
  });

  assert.equal(config.viewer.mode, "entra-id");
  assert.equal(config.viewer.clientId, clientId);
  assert.equal(config.viewer.appResource, appResource);
  assert.deepEqual(config.authorization.allowedViewerIds, ["user-a", "user-b"]);
  assert.equal(config.publicConfig.authorization.allowedViewerCount, 2);
  assert.equal(config.publicConfig.authorization.sessionBindingCount, 0);
  assert.equal(config.publicConfig.viewerAuth.accessTokenHeaderName, "authorization");
  assert.equal(config.publicConfig.viewerAuth.expectedAudience, appResource);
});

await run("loadRelayRuntimeConfig switches to session-scoped allowlisting when bindings are configured", () => {
  const config = loadRelayRuntimeConfig({
    RELAY_AUTH_MODE: "entra-id",
    ENTRA_TENANT_ID: tenantId,
    MICROSOFT_APP_ID: clientId,
    SESSION_VIEWER_BINDINGS: "local-machine:viewer-1|viewer-2;lab-machine:viewer-2"
  });

  assert.equal(config.authorization.mode, "entra-session-allowlist");
  assert.equal(config.publicConfig.authorization.sessionBindingCount, 2);
  assert.deepEqual(Array.from(config.authorization.sessionViewerBindings.get("local-machine") ?? []), ["viewer-1", "viewer-2"]);
});

await run("loadRelayRuntimeConfig reads durable authorization policy from a JSON file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "remote-console-auth-"));
  const policyPath = path.join(tempDir, "authorization-policy.json");

  try {
    await writeFile(policyPath, JSON.stringify({
      allowedViewerObjectIds: ["viewer-a", "viewer-b"],
      sessionViewerBindings: {
        "local-machine": ["viewer-a"],
        "lab-machine": ["viewer-b"]
      }
    }, null, 2), "utf8");

    const config = loadRelayRuntimeConfig({
      RELAY_AUTH_MODE: "entra-id",
      ENTRA_TENANT_ID: tenantId,
      MICROSOFT_APP_ID: clientId,
      RELAY_AUTH_POLICY_FILE: policyPath,
      AUTHORIZED_VIEWER_OBJECT_IDS: "ignored-viewer",
      SESSION_VIEWER_BINDINGS: "ignored-session:ignored-viewer"
    });

    assert.deepEqual(config.authorization.allowedViewerIds, ["viewer-a", "viewer-b"]);
    assert.equal(config.authorization.mode, "entra-session-allowlist");
    assert.deepEqual(Array.from(config.authorization.sessionViewerBindings.get("local-machine") ?? []), ["viewer-a"]);
    assert.equal(config.publicConfig.authorization.allowedViewerCount, 2);
    assert.equal(config.publicConfig.authorization.sessionBindingCount, 2);
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

await run("authorizeViewer accepts the configured shared key", async () => {
  const config = loadRelayRuntimeConfig({
    VIEWER_SHARED_KEY: "viewer-secret"
  });

  const request = {
    headers: {
      "x-remote-console-viewer-key": "viewer-secret"
    }
  } as unknown as Parameters<typeof authorizeViewer>[0];
  const url = new URL("http://localhost:4040/api/sessions");

  assert.deepEqual(await authorizeViewer(request, url, config), { ok: true });
});

await run("authorizeViewer validates and authorizes a signed Entra token", async () => {
  const config = loadRelayRuntimeConfig({
    RELAY_AUTH_MODE: "entra-id",
    ENTRA_TENANT_ID: tenantId,
    MICROSOFT_APP_ID: clientId,
    MICROSOFT_APP_RESOURCE: appResource,
    ENTRA_OPENID_CONFIGURATION_URL: "https://login.microsoftonline.com/test/valid/v2.0/.well-known/openid-configuration",
    AUTHORIZED_VIEWER_OBJECT_IDS: "viewer-1"
  });

  const signingMaterial = await createSigningMaterial();
  const token = createJwt(signingMaterial.privateKeyPem, signingMaterial.kid, {
    aud: clientId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    nbf: Math.floor(Date.now() / 1000) - 60,
    oid: "viewer-1",
    preferred_username: "viewer@example.com",
    scp: "access_as_user",
    tid: tenantId
  });

  const request = {
    headers: {
      authorization: `Bearer ${token}`
    }
  } as unknown as Parameters<typeof authorizeViewer>[0];

  const authorization = await authorizeViewer(request, new URL("http://localhost:4040/api/sessions"), config, {
    fetchImpl: createFetchStub(
      "https://login.microsoftonline.com/test/valid/v2.0/.well-known/openid-configuration",
      "https://login.microsoftonline.com/test/valid/discovery/v2.0/keys",
      signingMaterial.publicJwk)
  });

  assert.deepEqual(authorization, {
    ok: true,
    viewer: {
      objectId: "viewer-1",
      tenantId,
      username: "viewer@example.com"
    }
  });
});

await run("authorizeViewer rejects Entra viewers outside the allowlist", async () => {
  const config = loadRelayRuntimeConfig({
    RELAY_AUTH_MODE: "entra-id",
    ENTRA_TENANT_ID: tenantId,
    MICROSOFT_APP_ID: clientId,
    ENTRA_OPENID_CONFIGURATION_URL: "https://login.microsoftonline.com/test/forbidden/v2.0/.well-known/openid-configuration",
    AUTHORIZED_VIEWER_OBJECT_IDS: "viewer-1"
  });

  const signingMaterial = await createSigningMaterial();
  const token = createJwt(signingMaterial.privateKeyPem, signingMaterial.kid, {
    aud: clientId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    nbf: Math.floor(Date.now() / 1000) - 60,
    oid: "viewer-2",
    scp: "access_as_user",
    tid: tenantId
  });

  const request = {
    headers: {
      authorization: `Bearer ${token}`
    }
  } as unknown as Parameters<typeof authorizeViewer>[0];

  assert.deepEqual(await authorizeViewer(request, new URL("http://localhost:4040/api/sessions"), config, {
    fetchImpl: createFetchStub(
      "https://login.microsoftonline.com/test/forbidden/v2.0/.well-known/openid-configuration",
      "https://login.microsoftonline.com/test/forbidden/discovery/v2.0/keys",
      signingMaterial.publicJwk)
  }), {
    ok: false,
    statusCode: 403,
    message: "Viewer is authenticated but not authorized for this relay."
  });
});

await run("authorizeViewer rejects missing Entra bearer tokens", async () => {
  const config = loadRelayRuntimeConfig({
    RELAY_AUTH_MODE: "entra-id",
    ENTRA_TENANT_ID: tenantId,
    MICROSOFT_APP_ID: clientId
  });

  const request = {
    headers: {}
  } as unknown as Parameters<typeof authorizeViewer>[0];

  assert.deepEqual(await authorizeViewer(request, new URL("http://localhost:4040/api/sessions"), config), {
    ok: false,
    statusCode: 401,
    message: "Bearer token was missing or invalid."
  });
});

await run("filterAuthorizedSessions only returns sessions bound to the viewer", () => {
  const config = loadRelayRuntimeConfig({
    RELAY_AUTH_MODE: "entra-id",
    ENTRA_TENANT_ID: tenantId,
    MICROSOFT_APP_ID: clientId,
    SESSION_VIEWER_BINDINGS: "local-machine:viewer-1|viewer-2;lab-machine:viewer-2"
  });

  const sessions: SessionDescriptor[] = [
    {
      id: "local-machine",
      machineName: "Local Machine",
      state: "connected",
      updatedAt: "2026-04-22T10:00:00.000Z"
    },
    {
      id: "lab-machine",
      machineName: "Lab Machine",
      state: "connected",
      updatedAt: "2026-04-22T10:00:00.000Z"
    }
  ];

  assert.deepEqual(filterAuthorizedSessions(sessions, {
    objectId: "viewer-1",
    tenantId,
    username: "viewer@example.com"
  }, config).map(session => session.id), ["local-machine"]);
});

await run("canViewerAccessSession rejects unbound viewers in session-scoped mode", () => {
  const config = loadRelayRuntimeConfig({
    RELAY_AUTH_MODE: "entra-id",
    ENTRA_TENANT_ID: tenantId,
    MICROSOFT_APP_ID: clientId,
    SESSION_VIEWER_BINDINGS: "local-machine:viewer-1"
  });

  assert.equal(canViewerAccessSession("local-machine", {
    objectId: "viewer-1",
    tenantId,
    username: null
  }, config), true);
  assert.equal(canViewerAccessSession("local-machine", {
    objectId: "viewer-2",
    tenantId,
    username: null
  }, config), false);
});

await run("authorizeAgent requires the configured agent key", () => {
  const config = loadRelayRuntimeConfig({
    AGENT_SHARED_KEY: "agent-secret"
  });
  const request = {
    headers: {
      "x-remote-console-agent-key": "wrong"
    }
  } as unknown as Parameters<typeof authorizeAgent>[0];

  assert.deepEqual(authorizeAgent(request, config), {
    ok: false,
    statusCode: 401,
    message: "Agent key was missing or invalid."
  });
});

console.log("12 relay-server test(s) passed.");

async function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function createSigningMaterial(): Promise<{
  kid: string;
  privateKeyPem: string;
  publicJwk: Record<string, string>;
}> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  const jwk = publicKey.export({
    format: "jwk"
  }) as JsonWebKey;

  return {
    kid: "test-kid-1",
    privateKeyPem: privateKey.export({
      format: "pem",
      type: "pkcs1"
    }).toString(),
    publicJwk: {
      e: typeof jwk.e === "string" ? jwk.e : "",
      kid: "test-kid-1",
      kty: "RSA",
      n: typeof jwk.n === "string" ? jwk.n : ""
    }
  };
}

function createJwt(privateKeyPem: string, kid: string, payload: Record<string, unknown>): string {
  const header = {
    alg: "RS256",
    kid,
    typ: "JWT"
  };

  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();

  const signature = signer.sign(privateKeyPem);
  return `${signingInput}.${encodeBase64Url(signature)}`;
}

function createFetchStub(
  metadataUrl: string,
  keysUrl: string,
  publicJwk: Record<string, string>)
: typeof fetch {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url === metadataUrl) {
      return new Response(JSON.stringify({
        issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        jwks_uri: keysUrl
      }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }

    if (url === keysUrl) {
      return new Response(JSON.stringify({
        keys: [publicJwk]
      }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
