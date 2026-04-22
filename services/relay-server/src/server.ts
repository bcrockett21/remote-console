import http from "node:http";
import { createEnvelope, type SessionDescriptor } from "@remote-console/protocol";

const port = Number.parseInt(process.env.PORT ?? "4040", 10);

const sessions: SessionDescriptor[] = [
  {
    id: "local-machine",
    machineName: "Development Machine",
    state: "connecting",
    updatedAt: new Date().toISOString()
  }
];

const server = http.createServer((request, response) => {
  if (!request.url) {
    response.writeHead(400).end();
    return;
  }

  if (request.url === "/health") {
    writeJson(response, 200, {
      ok: true,
      service: "relay-server"
    });
    return;
  }

  if (request.url === "/api/sessions") {
    const snapshot = createEnvelope("session.snapshot", "system", { sessions });
    writeJson(response, 200, snapshot);
    return;
  }

  writeJson(response, 404, {
    ok: false,
    message: "Route not found."
  });
});

server.listen(port, () => {
  console.log(`relay-server listening on http://localhost:${port}`);
});

function writeJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}
