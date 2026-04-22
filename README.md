# Remote Console

Remote Console is a Microsoft Teams-first remote terminal project for viewing and interacting with a Codex-backed shell from desktop and iOS.

## Repository Layout

- `apps/teams-tab/` Teams personal tab frontend shell
- `services/relay-server/` authenticated relay service
- `agents/windows-agent/` local Windows machine agent
- `packages/protocol/` shared session and message protocol
- `docs/` product and architecture notes
- `infra/` deployment and environment setup
- `scripts/` developer automation

## Commands

- `npm install`
- `npm run build`
- `npm run start:relay`
- `npm run start:agent`
- `npm run start:tab`
- `npm test`

## Current Scope

This initial build slice provides:

- a typed shared protocol package
- a relay server with explicit auth-mode configuration, a public `/api/config` capability summary, shared-key protection for current agent traffic, Entra-backed viewer validation for Teams SSO mode, and optional session-level viewer bindings
- a Windows agent that authenticates to the relay, polls queued commands, and executes them through a persistent PowerShell process
- a Teams tab shell that reads relay auth capabilities, stores a viewer key locally for shared-key mode, acquires Teams SSO tokens for Entra mode, streams terminal updates from the relay, and submits typed commands into the active session
- root build and test commands
