import { createEnvelope } from "@remote-console/protocol";

const sessionId = "local-machine";

const banner = createEnvelope("terminal.output", sessionId, {
  stream: "stdout",
  data: "windows-agent stub ready"
});

console.log(JSON.stringify(banner, null, 2));
