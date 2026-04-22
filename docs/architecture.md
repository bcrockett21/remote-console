# Architecture

## Initial Vertical Slice

- `packages/protocol` defines the shared message envelope and session snapshot types.
- `services/relay-server` exposes a minimal HTTP API for health, session discovery, terminal snapshots, and in-memory command submission.
- `agents/windows-agent` is the first local-agent stub that will eventually bridge to Codex and the Windows shell.
- `apps/teams-tab` is a terminal-style shell that currently talks to the relay over HTTP and renders a live session preview.

## Next Steps

1. Replace the polling terminal preview with streaming transport between the relay and the local Windows agent.
2. Attach the Windows agent to a PTY-backed shell session.
3. Add Teams authentication and session brokering.
4. Replace the static browser tab shell with a real Teams app package and tab registration flow.
