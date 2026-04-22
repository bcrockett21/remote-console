import assert from "node:assert/strict";
import { createEnvelope, isTransportEnvelope } from "./index.js";

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

console.log("2 protocol test(s) passed.");

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}
