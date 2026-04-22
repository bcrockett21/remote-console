# Remote Console

Remote Console is a starter repository for a Microsoft Teams app that feels as close as possible to having a live terminal inside Teams on desktop and iOS.

## Initial Structure

- `apps/teams-tab/` Teams personal tab frontend
- `services/relay-server/` authenticated relay between Teams and the local machine
- `agents/windows-agent/` local Windows agent that bridges to Codex and the shell
- `packages/protocol/` shared session and streaming protocol contracts
- `docs/` product and architecture notes
- `infra/` deployment and environment setup
- `scripts/` developer automation

Empty directories are tracked with `.gitkeep` placeholders.
