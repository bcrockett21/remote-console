const relayInput = document.getElementById("relay-url");
const sessionStatus = document.getElementById("session-status");
const sessionSelect = document.getElementById("session-select");
const refreshButton = document.getElementById("refresh-button");
const terminalLines = document.getElementById("terminal-lines");
const input = document.getElementById("command-input");

const state = {
  relayUrl: relayInput instanceof HTMLInputElement ? relayInput.value.trim() : "http://localhost:4040",
  sessionId: "local-machine",
  stream: null
};

if (
  relayInput instanceof HTMLInputElement &&
  sessionStatus instanceof HTMLElement &&
  sessionSelect instanceof HTMLSelectElement &&
  refreshButton instanceof HTMLButtonElement &&
  terminalLines instanceof HTMLElement &&
  input instanceof HTMLInputElement
) {
  relayInput.addEventListener("change", async () => {
    state.relayUrl = relayInput.value.trim();
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
          "content-type": "application/json"
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

  void loadSessions();
}

async function loadSessions() {
  setStatus("Loading sessions...");

  try {
    const response = await fetch(`${state.relayUrl}/api/sessions`);
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
    const response = await fetch(`${state.relayUrl}/api/sessions/${state.sessionId}/terminal`);
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

  const stream = new EventSource(`${state.relayUrl}/api/sessions/${state.sessionId}/stream`);
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

window.addEventListener("beforeunload", () => {
  closeStream();
});
