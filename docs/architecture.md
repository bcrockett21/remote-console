# Architecture

## Initial Vertical Slice

- `packages/protocol` defines the shared message envelope and session snapshot types.
- `services/relay-server` exposes a minimal HTTP API for health, relay auth capability discovery, session discovery, terminal snapshots, command queueing, agent output ingestion, and server-sent event streaming.
- `agents/windows-agent` is now an active polling agent that registers with the relay and executes queued commands against a persistent PowerShell process.
- `apps/teams-tab` is a terminal-style shell that talks to the relay over HTTP, adapts to relay auth mode, and streams terminal updates over SSE.

## Auth Direction

- `RELAY_AUTH_MODE=shared-key` remains the working development path. Viewer access uses the existing shared key and agent access continues to use the agent shared key.
- `RELAY_AUTH_MODE=entra-id` now validates Teams SSO viewer access tokens against Entra OpenID metadata and signing keys, checks issuer/audience/tenant/lifetime/scope, and enforces `AUTHORIZED_VIEWER_OBJECT_IDS`.
- The Teams tab switches from shared-key `EventSource` streaming to authenticated fetch-based SSE when viewer auth requires bearer tokens.
- `SESSION_VIEWER_BINDINGS` can now narrow Entra authorization from relay-wide viewer allowlisting to specific session IDs, which is the current machine-level authorization seam.

## Next Steps

1. Replace env-configured session bindings with durable machine and user authorization state instead of process-local configuration.
2. Replace the PowerShell bridge with a PTY-backed Windows shell and Codex bridge.
3. Replace plain browser assets with a real Teams app package and tab registration flow.
4. Add durable persistence for session and machine metadata instead of in-memory relay state.
