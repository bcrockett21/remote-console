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

This is now an explicit planning mode for Teams-compatible identity work.

- The relay advertises Entra-backed viewer auth through `/api/config`
- The tab hides the viewer-key field and explains that identity-backed access is not wired yet
- Protected viewer routes currently return `501` until token acquisition and token validation are implemented
- `AUTHORIZED_VIEWER_OBJECT_IDS` can be set as a comma-separated list to define the intended per-user machine allowlist shape

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

The rendered manifest is written to:

- `apps/teams-tab/appPackage/dist/manifest.json`

## Current State

- the manifest is a development template, not a production package
- the tab client can initialize the Teams JavaScript SDK when hosted inside Teams
- the local static host is plain HTTP; a real Teams install will need an HTTPS host such as a dev tunnel or deployed environment
- the relay now exposes an auth capability document at `/api/config`
- Entra-backed Teams identity is scaffolded at the config level, but token acquisition and validation are still not implemented
