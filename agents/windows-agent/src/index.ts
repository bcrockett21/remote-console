import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const relayUrl = process.env.RELAY_URL ?? "http://localhost:4040";
const sessionId = process.env.SESSION_ID ?? "local-machine";
const machineName = process.env.MACHINE_NAME ?? "Development Machine";
const agentSharedKey = process.env.AGENT_SHARED_KEY ?? "agent-dev-key";
const shellCommand = process.env.SHELL_COMMAND ?? "powershell.exe";
const shellArgs = process.env.SHELL_ARGS?.split(" ").filter(Boolean) ?? ["-NoLogo", "-NoProfile"];
const pollIntervalMs = Number.parseInt(process.env.POLL_INTERVAL_MS ?? "2000", 10);
const completionPrefix = "__REMOTE_CONSOLE_DONE__:";

let activeCommand: ActiveCommand | null = null;
let stdoutBuffer = "";
let stderrBuffer = "";

const shell = spawn(shellCommand, shellArgs, {
  cwd: process.cwd(),
  stdio: "pipe",
  windowsHide: true
});

shell.stdout.setEncoding("utf8");
shell.stderr.setEncoding("utf8");
shell.stdout.on("data", (chunk: string) => {
  stdoutBuffer = handleChunk(stdoutBuffer + chunk, "stdout");
});
shell.stderr.on("data", (chunk: string) => {
  stderrBuffer = handleChunk(stderrBuffer + chunk, "stderr");
});
shell.on("exit", (code) => {
  void sendOutput(undefined, [
    {
      stream: "stderr",
      text: `shell process exited with code ${code ?? -1}`
    }
  ]);
});

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
      "content-type": "application/json",
      "x-remote-console-agent-key": agentSharedKey
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
      text: "windows-agent shell bridge ready"
    },
    {
      stream: "system",
      text: `agent polling for relay commands via ${shellCommand}`
    }
  ]);
}

async function pollCommands(): Promise<void> {
  if (activeCommand) {
    return;
  }

  const response = await fetch(`${relayUrl}/api/agent/sessions/${sessionId}/commands`, {
    headers: {
      "x-remote-console-agent-key": agentSharedKey
    }
  });
  if (!response.ok) {
    console.error(`[windows-agent] command poll failed with ${response.status}`);
    return;
  }

  const snapshot = await response.json();
  const commands = snapshot?.payload?.pendingCommands ?? [];

  const nextCommand = commands[0];
  if (nextCommand) {
    await handleCommand(nextCommand.id, nextCommand.command);
  }
}

async function handleCommand(commandId: string, command: string): Promise<void> {
  console.log(`[windows-agent] ${commandId}: ${command}`);
  activeCommand = {
    id: commandId,
    lines: []
  };

  shell.stdin.write(`${command}\n`);
  shell.stdin.write(`Write-Output "${completionPrefix}${commandId}"\n`);
}

async function sendOutput(
  commandId: string | undefined,
  lines: Array<{ stream: "stdout" | "stderr" | "system"; text: string }>)
: Promise<void> {
  const response = await fetch(`${relayUrl}/api/agent/sessions/${sessionId}/output`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-remote-console-agent-key": agentSharedKey
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

function handleChunk(
  buffer: string,
  stream: "stdout" | "stderr")
: string {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  const remainder = parts.pop() ?? "";

  for (const line of parts) {
    processLine(line, stream);
  }

  return remainder;
}

function processLine(
  line: string,
  stream: "stdout" | "stderr")
: void {
  const trimmed = line.replace(/\r/g, "");
  if (trimmed.length === 0) {
    return;
  }

  if (trimmed.startsWith(completionPrefix)) {
    const commandId = trimmed.slice(completionPrefix.length);
    void completeActiveCommand(commandId);
    return;
  }

  if (activeCommand) {
    activeCommand.lines.push({
      stream,
      text: trimmed
    });
    return;
  }

  void sendOutput(undefined, [
    {
      stream,
      text: trimmed
    }
  ]);
}

async function completeActiveCommand(commandId: string): Promise<void> {
  if (!activeCommand || activeCommand.id !== commandId) {
    return;
  }

  const lines = activeCommand.lines.length > 0
    ? activeCommand.lines
    : [
        {
          stream: "system" as const,
          text: "command completed with no terminal output"
        }
      ];

  activeCommand = null;
  await sendOutput(commandId, lines);
}

type ActiveCommand = {
  id: string;
  lines: Array<{ stream: "stdout" | "stderr" | "system"; text: string }>;
};
