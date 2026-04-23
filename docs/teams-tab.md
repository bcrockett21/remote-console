# Teams Tab Setup

## Local Hosting

The current Teams tab is a static web client served from `apps/teams-tab`.

### Commands

- `npm run build`
- `npm run start:relay`
- `npm run start:agent`
- `npm run start:tab`
- `npm run build:teams-package`

The tab host defaults to `http://localhost:53000`.

## Relay Auth Modes

The tab now reads relay auth capabilities from `GET /api/config` before loading sessions.

### `RELAY_AUTH_MODE=shared-key`

This remains the default development path.

- Relay viewer traffic uses `VIEWER_SHARED_KEY`
- Relay agent traffic uses `AGENT_SHARED_KEY`
- The Teams tab sends the viewer key as a header for fetch requests and as a query parameter for the SSE stream
- The Windows agent sends the agent key as a request header
- The tab keeps the viewer-key field visible and stores the value in `localStorage`

Defaults for local development:

- `VIEWER_SHARED_KEY=viewer-dev-key`
- `AGENT_SHARED_KEY=agent-dev-key`

### `RELAY_AUTH_MODE=entra-id`

This mode now supports real Teams SSO viewer authentication.

- The relay expects a bearer token in the `Authorization` header for viewer requests
- The tab calls `microsoftTeams.authentication.getAuthToken()` when it needs a viewer token
- Shared-key browser preview is no longer enough for viewer access in this mode; open the tab inside Teams
- Live terminal streaming uses an authenticated fetch-based SSE reader instead of `EventSource`
- The relay validates the token signature, issuer, tenant, audience, expiry, and `access_as_user` scope
- `AUTHORIZED_VIEWER_OBJECT_IDS` is the comma-separated Entra object-id allowlist for relay viewers
- `SESSION_VIEWER_BINDINGS` optionally narrows access from relay-wide allowlisting to session-specific allowlisting

Required relay environment variables in this mode:

- `ENTRA_TENANT_ID`
  Entra tenant ID that issues the Teams SSO token
- `MICROSOFT_APP_ID`
  Entra application/client ID for the Teams tab app registration
- `AUTHORIZED_VIEWER_OBJECT_IDS`
  Comma-separated Entra object IDs allowed to act as relay viewers

Optional relay environment variables:

- `MICROSOFT_APP_RESOURCE`
  Additional accepted audience for the access token. Use this when your app registration exposes a custom Application ID URI.
- `ENTRA_OPENID_CONFIGURATION_URL`
  Override for OpenID metadata discovery. This is mainly useful for tests.
- `RELAY_AUTH_POLICY_FILE`
  Path to a JSON authorization policy file. When set, this replaces the env-based `AUTHORIZED_VIEWER_OBJECT_IDS` and `SESSION_VIEWER_BINDINGS` inputs.
- `SESSION_VIEWER_BINDINGS`
  Semicolon-separated session-to-viewer map in the format `session-id:viewer-a|viewer-b;other-session:viewer-b`. This remains as a fallback when `RELAY_AUTH_POLICY_FILE` is not set.

Authorization policy file shape:

- `allowedViewerObjectIds`
  Array of Entra object IDs allowed to use the relay.
- `sessionViewerBindings`
  Object keyed by session ID, with each value set to an array of allowed viewer object IDs.

Example file:

- `infra/authorization-policy.example.json`

## Teams App Package

The repository includes a Teams app manifest template at:

- `apps/teams-tab/appPackage/manifest.template.json`

Build a concrete manifest with:

- `npm run build:teams-manifest`
- `npm run build:teams-package`

Environment variables:

- `APP_BASE_URL`
  Example: `https://your-dev-tunnel.example.com`
- `MICROSOFT_APP_ID`
  Entra application ID for the Teams app registration
- `MICROSOFT_APP_RESOURCE`
  Optional Application ID URI for `webApplicationInfo.resource`. Defaults to `api://{APP_DOMAIN}/{MICROSOFT_APP_ID}`.

The rendered manifest is written to:

- `apps/teams-tab/appPackage/dist/manifest.json`

The installable Teams app package is written to:

- `apps/teams-tab/appPackage/dist/teams-app-package.zip`

## Teams Test Loop

Use this flow to test the app inside Microsoft Teams:

1. Start the local services you want to test.
   Run `npm run start:relay`, `npm run start:agent`, and `npm run start:tab`.
2. Expose the tab host over public HTTPS.
   The Teams manifest `contentUrl` must be reachable from Teams, so point a public HTTPS URL at `http://localhost:53000`.
3. Render the manifest for that HTTPS URL.
   Set `APP_BASE_URL` to the public HTTPS base URL and set `MICROSOFT_APP_ID` to the Entra app registration used by the Teams app.
4. Build the uploadable Teams package.
   Run `npm run build:teams-package`.
5. Upload the ZIP package in Teams.
   Use `apps/teams-tab/appPackage/dist/teams-app-package.zip` when adding a custom app in Teams.

Example PowerShell session:

```powershell
$env:APP_BASE_URL = "https://your-public-teams-url.example.com"
$env:MICROSOFT_APP_ID = "00000000-0000-0000-0000-000000000000"
npm run build:teams-package
```

## Current State

- the manifest is a development template, not a production package
- the tab client can initialize the Teams JavaScript SDK when hosted inside Teams
- the local static host is plain HTTP; Teams testing still requires a public HTTPS host such as a dev tunnel or deployed environment
- the relay now exposes an auth capability document at `/api/config`
- Entra-backed Teams identity now works for viewer requests when the tab is opened inside Teams and the relay is configured with the required Entra settings
- the relay can now optionally scope Entra viewer access down to specific sessions with `SESSION_VIEWER_BINDINGS`
- agent authentication is still shared-key based while viewer identity moves to Entra-backed authorization
