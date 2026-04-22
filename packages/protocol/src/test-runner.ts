import assert from "node:assert/strict";
import { createAgentCommand, createEnvelope, createTerminalLine, isRelayAuthMode, isTransportEnvelope } from "./index.js";

run("createEnvelope returns a stable transport envelope", () => {
  const now = new Date("2026-04-22T10:00:00.000Z");
  const envelope = createEnvelope("terminal.input", "session-1", { data: "ls" }, now);

  assert.deepEqual(envelope, {
    type: "terminal.input",
    sessionId: "session-1",
    timestamp: "2026-04-22T10:00:00.000Z",
    payload: {
      data: "ls"
    }
  });
});

run("isTransportEnvelope rejects malformed values", () => {
  assert.equal(isTransportEnvelope(null), false);
  assert.equal(isTransportEnvelope({ type: "x" }), false);
  assert.equal(isTransportEnvelope({
    type: "terminal.output",
    sessionId: "session-1",
    timestamp: "2026-04-22T10:00:00.000Z",
    payload: {
      data: "hello"
    }
  }), true);
});

run("createTerminalLine returns a stable terminal line", () => {
  const now = new Date("2026-04-22T10:05:00.000Z");
  const line = createTerminalLine("line-1", "stdout", "ready", now);

  assert.deepEqual(line, {
    id: "line-1",
    stream: "stdout",
    text: "ready",
    createdAt: "2026-04-22T10:05:00.000Z"
  });
});

run("createAgentCommand returns a stable queued command", () => {
  const now = new Date("2026-04-22T10:06:00.000Z");
  const command = createAgentCommand("cmd-1", "pwd", now);

  assert.deepEqual(command, {
    id: "cmd-1",
    command: "pwd",
    createdAt: "2026-04-22T10:06:00.000Z"
  });
});

run("isRelayAuthMode validates supported auth modes", () => {
  assert.equal(isRelayAuthMode("shared-key"), true);
  assert.equal(isRelayAuthMode("entra-id"), true);
  assert.equal(isRelayAuthMode("oauth"), false);
});

console.log("5 protocol test(s) passed.");

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}
