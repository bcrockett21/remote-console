# Teams Tab Setup

## Local Hosting

The current Teams tab is a static web client served from `apps/teams-tab`.

### Commands

- `npm run build`
- `npm run start:relay`
- `npm run start:agent`
- `npm run start:tab`

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
- `SESSION_VIEWER_BINDINGS`
  Semicolon-separated session-to-viewer map in the format `session-id:viewer-a|viewer-b;other-session:viewer-b`. When set, the relay only returns sessions bound to the current viewer and blocks direct access to unbound sessions.

## Teams App Package

The repository includes a Teams app manifest template at:

- `apps/teams-tab/appPackage/manifest.template.json`

Build a concrete manifest with:

- `npm run build:teams-manifest`

Environment variables:

- `APP_BASE_URL`
  Example: `https://your-dev-tunnel.example.com`
- `MICROSOFT_APP_ID`
  Entra application ID for the Teams app registration
- `MICROSOFT_APP_RESOURCE`
  Optional Application ID URI for `webApplicationInfo.resource`. Defaults to `api://{APP_DOMAIN}/{MICROSOFT_APP_ID}`.

The rendered manifest is written to:

- `apps/teams-tab/appPackage/dist/manifest.json`

## Current State

- the manifest is a development template, not a production package
- the tab client can initialize the Teams JavaScript SDK when hosted inside Teams
- the local static host is plain HTTP; a real Teams install will need an HTTPS host such as a dev tunnel or deployed environment
- the relay now exposes an auth capability document at `/api/config`
- Entra-backed Teams identity now works for viewer requests when the tab is opened inside Teams and the relay is configured with the required Entra settings
- the relay can now optionally scope Entra viewer access down to specific sessions with `SESSION_VIEWER_BINDINGS`
- agent authentication is still shared-key based while viewer identity moves to Entra-backed authorization
