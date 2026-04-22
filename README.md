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
- `npm test`

## Current Scope

This initial build slice provides:

- a typed shared protocol package
- a minimal relay server with session discovery, command queueing, terminal snapshots, and server-sent event streaming
- a Windows agent CLI stub that registers with the relay, polls queued commands, and posts output back
- a Teams tab shell that streams terminal updates from the relay and submits typed commands into the active session
- root build and test commands
