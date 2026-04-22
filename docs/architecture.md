# Architecture

## Initial Vertical Slice

- `packages/protocol` defines the shared message envelope and session snapshot types.
- `services/relay-server` exposes a minimal HTTP API for health and session discovery.
- `agents/windows-agent` is the first local-agent stub that will eventually bridge to Codex and the Windows shell.
- `apps/teams-tab` is a static terminal-style shell to ground the Teams UI direction before wiring live transport.

## Next Steps

1. Replace the static Teams tab preview with a real tab app build.
2. Add streaming transport between the relay and the local Windows agent.
3. Attach the Windows agent to a PTY-backed shell session.
4. Add Teams authentication and session brokering.
