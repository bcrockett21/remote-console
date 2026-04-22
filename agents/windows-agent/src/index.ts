const relayUrl = process.env.RELAY_URL ?? "http://localhost:4040";
const sessionId = process.env.SESSION_ID ?? "local-machine";
const machineName = process.env.MACHINE_NAME ?? "Development Machine";
const pollIntervalMs = Number.parseInt(process.env.POLL_INTERVAL_MS ?? "2000", 10);

console.log(`[windows-agent] registering ${sessionId} with ${relayUrl}`);

await registerAgent();
await flushStartupBanner();
setInterval(() => {
  void pollCommands();
}, pollIntervalMs);

async function registerAgent(): Promise<void> {
  const response = await fetch(`${relayUrl}/api/agent/sessions/${sessionId}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      machineName
    })
  });

  if (!response.ok) {
    throw new Error(`Agent registration failed with ${response.status}`);
  }
}

async function flushStartupBanner(): Promise<void> {
  await sendOutput(undefined, [
    {
      stream: "stdout",
      text: "windows-agent stub ready"
    },
    {
      stream: "system",
      text: "agent polling for relay commands"
    }
  ]);
}

async function pollCommands(): Promise<void> {
  const response = await fetch(`${relayUrl}/api/agent/sessions/${sessionId}/commands`);
  if (!response.ok) {
    console.error(`[windows-agent] command poll failed with ${response.status}`);
    return;
  }

  const snapshot = await response.json();
  const commands = snapshot?.payload?.pendingCommands ?? [];

  for (const command of commands) {
    await handleCommand(command.id, command.command);
  }
}

async function handleCommand(commandId: string, command: string): Promise<void> {
  console.log(`[windows-agent] ${commandId}: ${command}`);

  const normalized = command.trim().toLowerCase();
  const lines = buildPreviewOutput(normalized, command);
  await sendOutput(commandId, lines);
}

function buildPreviewOutput(
  normalized: string,
  original: string)
: Array<{ stream: "stdout" | "stderr" | "system"; text: string }> {
  if (normalized === "help") {
    return [
      {
        stream: "stdout",
        text: "Agent preview commands: help, status, whoami, pwd, codex"
      }
    ];
  }

  if (normalized === "status") {
    return [
      {
        stream: "stdout",
        text: `agent connected to ${relayUrl} as ${machineName}`
      }
    ];
  }

  if (normalized === "whoami") {
    return [
      {
        stream: "stdout",
        text: machineName
      }
    ];
  }

  if (normalized === "pwd") {
    return [
      {
        stream: "stdout",
        text: process.cwd()
      }
    ];
  }

  if (normalized === "codex") {
    return [
      {
        stream: "system",
        text: "Codex bridge not wired yet. PTY integration is the next step."
      }
    ];
  }

  return [
    {
      stream: "stdout",
      text: `agent preview executed: ${original}`
    }
  ];
}

async function sendOutput(
  commandId: string | undefined,
  lines: Array<{ stream: "stdout" | "stderr" | "system"; text: string }>)
: Promise<void> {
  const response = await fetch(`${relayUrl}/api/agent/sessions/${sessionId}/output`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      commandId,
      lines
    })
  });

  if (!response.ok) {
    throw new Error(`Agent output post failed with ${response.status}`);
  }
}
