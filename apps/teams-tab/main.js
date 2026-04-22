const relayInput = document.getElementById("relay-url");
const viewerKeyInput = document.getElementById("viewer-key");
const viewerKeyField = document.getElementById("viewer-key-field");
const sessionStatus = document.getElementById("session-status");
const authStatus = document.getElementById("auth-status");
const sessionSelect = document.getElementById("session-select");
const refreshButton = document.getElementById("refresh-button");
const terminalLines = document.getElementById("terminal-lines");
const input = document.getElementById("command-input");
const teamsBanner = document.getElementById("teams-banner");

const state = {
  relayUrl: relayInput instanceof HTMLInputElement ? relayInput.value.trim() : "http://localhost:4040",
  viewerKey: viewerKeyInput instanceof HTMLInputElement ? viewerKeyInput.value.trim() : "viewer-dev-key",
  sessionId: "local-machine",
  stream: null,
  inTeams: false,
  teamsHostName: "",
  relayConfig: defaultRelayConfig()
};

if (
  relayInput instanceof HTMLInputElement &&
  viewerKeyInput instanceof HTMLInputElement &&
  sessionStatus instanceof HTMLElement &&
  sessionSelect instanceof HTMLSelectElement &&
  refreshButton instanceof HTMLButtonElement &&
  terminalLines instanceof HTMLElement &&
  input instanceof HTMLInputElement
) {
  void initializeTeamsContext();
  loadStoredSettings();
  updateAuthUi();

  relayInput.addEventListener("change", async () => {
    state.relayUrl = relayInput.value.trim();
    storeSettings();
    closeStream();
    await loadRelayConfig();
    await loadSessions();
  });

  viewerKeyInput.addEventListener("change", async () => {
    state.viewerKey = viewerKeyInput.value.trim();
    storeSettings();
    closeStream();
    await loadSessions();
  });

  sessionSelect.addEventListener("change", async () => {
    state.sessionId = sessionSelect.value;
    closeStream();
    await loadTerminal();
    openStream();
  });

  refreshButton.addEventListener("click", async () => {
    await loadRelayConfig();
    await loadSessions();
  });

  input.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }

    const value = input.value.trim();
    if (value.length === 0) {
      return;
    }

    input.disabled = true;
    try {
      await fetch(`${state.relayUrl}/api/sessions/${state.sessionId}/terminal`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...viewerHeaders()
        },
        body: JSON.stringify({
          data: value
        })
      });

      input.value = "";
    } catch (error) {
      renderLines([
        {
          stream: "stderr",
          text: error instanceof Error ? error.message : "Failed to send terminal input."
        }
      ]);
    } finally {
      input.disabled = false;
      input.focus();
    }
  });

  void bootstrap();
}

async function bootstrap() {
  await loadRelayConfig();
  await loadSessions();
}

async function initializeTeamsContext() {
  const teams = window.microsoftTeams;
  if (!teams?.app) {
    updateBanner();
    return;
  }

  try {
    await teams.app.initialize();
    const context = await teams.app.getContext();
    state.inTeams = true;
    state.teamsHostName = context.app.host.name;
    updateBanner();
  } catch {
    state.inTeams = false;
    state.teamsHostName = "";
    updateBanner("Teams SDK was detected but initialization failed. Staying in browser preview mode.");
  }
}

async function loadRelayConfig() {
  setAuthStatus("Auth: loading relay configuration...");

  try {
    const response = await fetch(`${state.relayUrl}/api/config`);
    if (!response.ok) {
      throw new Error(`Relay config request failed with ${response.status}`);
    }

    const snapshot = await response.json();
    const relayConfig = snapshot?.payload;
    if (!relayConfig?.viewerAuth || !relayConfig?.agentAuth || !relayConfig?.authorization) {
      throw new Error("Relay config payload was incomplete.");
    }

    state.relayConfig = relayConfig;
  } catch {
    // Fallback keeps the shell compatible with older relay builds.
    state.relayConfig = defaultRelayConfig();
  }

  updateAuthUi();
}

async function loadSessions() {
  setStatus("Loading sessions...");

  try {
    const response = await fetch(`${state.relayUrl}/api/sessions`, {
      headers: viewerHeaders()
    });
    if (!response.ok) {
      throw new Error(`Session request failed with ${response.status}`);
    }

    const snapshot = await response.json();
    const sessions = snapshot?.payload?.sessions ?? [];

    sessionSelect.replaceChildren();
    for (const session of sessions) {
      const option = document.createElement("option");
      option.value = session.id;
      option.textContent = `${session.machineName} (${session.state})`;
      sessionSelect.append(option);
    }

    if (sessions.length > 0) {
      state.sessionId = sessions.some((session) => session.id === state.sessionId)
        ? state.sessionId
        : sessions[0].id;
      sessionSelect.value = state.sessionId;
      setStatus(`Session: ${state.sessionId}`);
      await loadTerminal();
      openStream();
      return;
    }

    renderLines([
      {
        stream: "system",
        text: "No sessions are currently available from the relay."
      }
    ]);
    setStatus("Session: unavailable");
  } catch (error) {
    renderLines([
      {
        stream: "stderr",
        text: error instanceof Error ? error.message : "Failed to load sessions."
      }
    ]);
    setStatus("Session: error");
  }
}

async function loadTerminal() {
  if (!state.sessionId) {
    return;
  }

  try {
    const response = await fetch(`${state.relayUrl}/api/sessions/${state.sessionId}/terminal`, {
      headers: viewerHeaders()
    });
    if (!response.ok) {
      throw new Error(`Terminal request failed with ${response.status}`);
    }

    const snapshot = await response.json();
    applySnapshot(snapshot);
  } catch (error) {
    renderLines([
      {
        stream: "stderr",
        text: error instanceof Error ? error.message : "Failed to load terminal snapshot."
      }
    ]);
    setStatus("Session: error");
  }
}

function openStream() {
  if (!state.sessionId || typeof EventSource === "undefined") {
    return;
  }

  closeStream();

  const stream = new EventSource(buildStreamUrl());
  state.stream = stream;

  stream.addEventListener("snapshot", (event) => {
    const message = JSON.parse(event.data);
    applySnapshot(message);
  });

  stream.onerror = () => {
    setStatus(`Session: ${state.sessionId} (stream reconnecting)`);
  };
}

function closeStream() {
  if (state.stream instanceof EventSource) {
    state.stream.close();
  }

  state.stream = null;
}

function applySnapshot(snapshot) {
  renderLines(snapshot?.payload?.lines ?? []);
  const session = snapshot?.payload?.session;
  if (session) {
    setStatus(`Session: ${session.id} (${session.state})`);
  }
}

function renderLines(lines) {
  terminalLines.replaceChildren();

  for (const line of lines) {
    const row = document.createElement("div");
    row.className = `terminal__line terminal__line--${line.stream ?? "stdout"}`;

    const prompt = document.createElement("span");
    prompt.className = "terminal__prompt";
    prompt.textContent = promptForStream(line.stream);

    const content = document.createElement("span");
    content.textContent = line.text ?? "";

    row.append(prompt, content);
    terminalLines.append(row);
  }

  terminalLines.scrollTop = terminalLines.scrollHeight;
}

function promptForStream(stream) {
  switch (stream) {
    case "stderr":
      return "error";
    case "system":
      return "relay";
    case "input":
      return "you";
    default:
      return "codex";
  }
}

function setStatus(text) {
  sessionStatus.textContent = text;
}

function setAuthStatus(text) {
  if (authStatus instanceof HTMLElement) {
    authStatus.textContent = text;
  }
}

function viewerHeaders() {
  if (state.relayConfig?.viewerAuth?.mode !== "shared-key") {
    return {};
  }

  return {
    "x-remote-console-viewer-key": state.viewerKey
  };
}

function buildStreamUrl() {
  const url = new URL(`${state.relayUrl}/api/sessions/${state.sessionId}/stream`);

  if (state.relayConfig?.viewerAuth?.mode === "shared-key") {
    url.searchParams.set("viewerKey", state.viewerKey);
  }

  return url.toString();
}

function loadStoredSettings() {
  try {
    const storedRelayUrl = window.localStorage.getItem("remote-console.relay-url");
    const storedViewerKey = window.localStorage.getItem("remote-console.viewer-key");

    if (storedRelayUrl && relayInput instanceof HTMLInputElement) {
      relayInput.value = storedRelayUrl;
      state.relayUrl = storedRelayUrl;
    }

    if (storedViewerKey && viewerKeyInput instanceof HTMLInputElement) {
      viewerKeyInput.value = storedViewerKey;
      state.viewerKey = storedViewerKey;
    }
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

function storeSettings() {
  try {
    window.localStorage.setItem("remote-console.relay-url", state.relayUrl);
    window.localStorage.setItem("remote-console.viewer-key", state.viewerKey);
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

function updateAuthUi() {
  const viewerAuth = state.relayConfig?.viewerAuth ?? defaultRelayConfig().viewerAuth;
  const authorization = state.relayConfig?.authorization ?? defaultRelayConfig().authorization;
  const usesViewerKey = viewerAuth.mode === "shared-key";

  if (viewerKeyField instanceof HTMLElement) {
    viewerKeyField.hidden = !usesViewerKey;
  }

  if (usesViewerKey) {
    setAuthStatus("Auth: shared-key development mode.");
    updateBanner();
    return;
  }

  setAuthStatus(`Auth: Entra ID planned mode with ${authorization.allowedViewerCount} configured viewer object id(s).`);
  updateBanner("Relay is configured for Entra-backed Teams identity. Viewer token acquisition is not implemented in this tab yet.");
}

function updateBanner(overrideText) {
  if (!(teamsBanner instanceof HTMLElement)) {
    return;
  }

  if (state.relayConfig?.viewerAuth?.mode === "entra-id") {
    teamsBanner.textContent = overrideText
      ?? "Relay is configured for Entra-backed Teams identity. Viewer token acquisition is not implemented in this tab yet.";
    teamsBanner.classList.remove("shell__banner--teams");
    return;
  }

  if (overrideText) {
    teamsBanner.textContent = overrideText;
    teamsBanner.classList.toggle("shell__banner--teams", state.inTeams);
    return;
  }

  if (state.inTeams) {
    const hostLabel = state.teamsHostName ? ` for ${state.teamsHostName}` : "";
    teamsBanner.textContent = `Running inside Teams${hostLabel}.`;
    teamsBanner.classList.add("shell__banner--teams");
    return;
  }

  teamsBanner.textContent = "Browser preview mode. Launch this page inside Microsoft Teams to validate the full personal-tab experience.";
  teamsBanner.classList.remove("shell__banner--teams");
}

function defaultRelayConfig() {
  return {
    viewerAuth: {
      mode: "shared-key",
      status: "ready",
      viewerKeyHeaderName: "x-remote-console-viewer-key",
      teamsSsoEnabled: false
    },
    agentAuth: {
      mode: "shared-key",
      status: "ready",
      agentKeyHeaderName: "x-remote-console-agent-key"
    },
    authorization: {
      mode: "development-shared-key",
      allowedViewerCount: 0,
      requiresUserMapping: false,
      machineBindingEnabled: false
    }
  };
}

window.addEventListener("beforeunload", () => {
  closeStream();
});
