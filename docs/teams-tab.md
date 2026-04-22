# Teams Tab Setup

## Local Hosting

The current Teams tab is a static web client served from `apps/teams-tab`.

### Commands

- `npm run build`
- `npm run start:relay`
- `npm run start:agent`
- `npm run start:tab`

The tab host defaults to `http://localhost:53000`.

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
