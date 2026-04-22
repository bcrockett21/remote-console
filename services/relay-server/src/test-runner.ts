import assert from "node:assert/strict";
import { authorizeAgent, authorizeViewer, loadRelayRuntimeConfig } from "./auth.js";

run("loadRelayRuntimeConfig defaults to shared-key development auth", () => {
  const config = loadRelayRuntimeConfig({});

  assert.equal(config.viewer.mode, "shared-key");
  assert.equal(config.viewer.sharedKey, "viewer-dev-key");
  assert.equal(config.publicConfig.viewerAuth.status, "ready");
  assert.equal(config.publicConfig.authorization.mode, "development-shared-key");
});

run("loadRelayRuntimeConfig surfaces Entra planning config", () => {
  const config = loadRelayRuntimeConfig({
    RELAY_AUTH_MODE: "entra-id",
    AUTHORIZED_VIEWER_OBJECT_IDS: "user-a, user-b"
  });

  assert.equal(config.viewer.mode, "entra-id");
  assert.equal(config.viewer.sharedKey, null);
  assert.deepEqual(config.authorization.allowedViewerIds, ["user-a", "user-b"]);
  assert.equal(config.publicConfig.authorization.allowedViewerCount, 2);
  assert.equal(config.publicConfig.viewerAuth.teamsSsoEnabled, true);
});

run("authorizeViewer accepts the configured shared key", () => {
  const config = loadRelayRuntimeConfig({
    VIEWER_SHARED_KEY: "viewer-secret"
  });

  const request = {
    headers: {
      "x-remote-console-viewer-key": "viewer-secret"
    }
  } as unknown as Parameters<typeof authorizeViewer>[0];
  const url = new URL("http://localhost:4040/api/sessions");

  assert.deepEqual(authorizeViewer(request, url, config), { ok: true });
});

run("authorizeViewer blocks Entra mode until token validation exists", () => {
  const config = loadRelayRuntimeConfig({
    RELAY_AUTH_MODE: "entra-id"
  });
  const request = {
    headers: {}
  } as unknown as Parameters<typeof authorizeViewer>[0];
  const url = new URL("http://localhost:4040/api/sessions");

  assert.deepEqual(authorizeViewer(request, url, config), {
    ok: false,
    statusCode: 501,
    message: "Viewer auth is configured for Entra ID, but token validation is not implemented yet."
  });
});

run("authorizeAgent requires the configured agent key", () => {
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

console.log("5 relay-server test(s) passed.");

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}
