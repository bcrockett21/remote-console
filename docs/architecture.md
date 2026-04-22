# Architecture

## Initial Vertical Slice

- `packages/protocol` defines the shared message envelope and session snapshot types.
- `services/relay-server` exposes a minimal HTTP API for health, relay auth capability discovery, session discovery, terminal snapshots, command queueing, agent output ingestion, and server-sent event streaming.
- `agents/windows-agent` is now an active polling agent that registers with the relay and executes queued commands against a persistent PowerShell process.
- `apps/teams-tab` is a terminal-style shell that talks to the relay over HTTP, adapts to relay auth mode, and streams terminal updates over SSE.

## Auth Direction

- `RELAY_AUTH_MODE=shared-key` remains the working development path. Viewer access uses the existing shared key and agent access continues to use the agent shared key.
- `RELAY_AUTH_MODE=entra-id` is now a deliberate relay mode instead of an undocumented future idea. The relay publishes that capability through `/api/config`, and protected viewer routes fail with a clear `501` until token validation is implemented.
- Machine authorization is modeled as an Entra-backed viewer allowlist in that future mode. The relay accepts `AUTHORIZED_VIEWER_OBJECT_IDS` now so the intended per-user authorization surface is explicit even before the token-verification step lands.

## Next Steps

1. Implement Teams/Entra token acquisition in the tab and token validation in the relay so `RELAY_AUTH_MODE=entra-id` becomes functional instead of planned-only.
2. Replace the PowerShell bridge with a PTY-backed Windows shell and Codex bridge.
3. Replace plain browser assets with a real Teams app package and tab registration flow.
4. Add durable persistence for session and machine metadata instead of in-memory relay state.
