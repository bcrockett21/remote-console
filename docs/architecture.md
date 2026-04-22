# Architecture

## Initial Vertical Slice

- `packages/protocol` defines the shared message envelope and session snapshot types.
- `services/relay-server` exposes a minimal HTTP API for health, session discovery, terminal snapshots, command queueing, agent output ingestion, and server-sent event streaming.
- `agents/windows-agent` is now an active polling agent that registers with the relay and executes queued commands against a persistent PowerShell process.
- `apps/teams-tab` is a terminal-style shell that talks to the relay over HTTP and streams terminal updates over SSE.

## Next Steps

1. Replace the PowerShell bridge with a PTY-backed Windows shell and Codex bridge.
2. Add authenticated session brokering between Teams users and machines.
3. Replace plain browser assets with a real Teams app package and tab registration flow.
4. Add durable persistence for session and machine metadata instead of in-memory relay state.
