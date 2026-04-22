import http from "node:http";
import {
  createEnvelope,
  createTerminalLine,
  type SessionDescriptor,
  type TerminalLine
} from "@remote-console/protocol";

const port = Number.parseInt(process.env.PORT ?? "4040", 10);
const initialTimestamp = new Date().toISOString();
const sessions = new Map<string, SessionRecord>([
  ["local-machine", {
    session: {
      id: "local-machine",
      machineName: "Development Machine",
      state: "connected",
      updatedAt: initialTimestamp
    },
    lines: [
      createTerminalLine("line-1", "system", "relay-server connected to local-machine", new Date(initialTimestamp)),
      createTerminalLine("line-2", "stdout", "windows-agent stub ready", new Date(initialTimestamp)),
      createTerminalLine("line-3", "stdout", "type a command in the Teams terminal preview to append activity", new Date(initialTimestamp))
    ]
  }]
]);

const server = http.createServer((request, response) => {
  if (!request.url) {
    response.writeHead(400).end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  writeCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  if (url.pathname === "/health") {
    writeJson(response, 200, {
      ok: true,
      service: "relay-server"
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sessions") {
    const snapshot = createEnvelope("session.snapshot", "system", {
      sessions: Array.from(sessions.values(), value => value.session)
    });
    writeJson(response, 200, snapshot);
    return;
  }

  const terminalMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/terminal$/);
  if (request.method === "GET" && terminalMatch) {
    const sessionRecord = sessions.get(terminalMatch[1]);
    if (!sessionRecord) {
      writeJson(response, 404, {
        ok: false,
        message: "Session not found."
      });
      return;
    }

    const snapshot = createEnvelope("terminal.snapshot", sessionRecord.session.id, {
      session: sessionRecord.session,
      lines: sessionRecord.lines
    });

    writeJson(response, 200, snapshot);
    return;
  }

  if (request.method === "POST" && terminalMatch) {
    const sessionRecord = sessions.get(terminalMatch[1]);
    if (!sessionRecord) {
      writeJson(response, 404, {
        ok: false,
        message: "Session not found."
      });
      return;
    }

    collectBody(request)
      .then((body) => {
        const parsed = parseInputRequest(body);
        if (!parsed.ok) {
          writeJson(response, 400, {
            ok: false,
            message: parsed.message
          });
          return;
        }

        appendInput(sessionRecord, parsed.data);
        const snapshot = createEnvelope("terminal.snapshot", sessionRecord.session.id, {
          session: sessionRecord.session,
          lines: sessionRecord.lines
        });
        writeJson(response, 200, snapshot);
      })
      .catch((error: unknown) => {
        writeJson(response, 500, {
          ok: false,
          message: error instanceof Error ? error.message : "Unknown relay error."
        });
      });
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

function writeCorsHeaders(response: http.ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function collectBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function parseInputRequest(body: string): { ok: true; data: string } | { ok: false; message: string } {
  if (body.trim().length === 0) {
    return {
      ok: false,
      message: "Input payload was empty."
    };
  }

  try {
    const parsed = JSON.parse(body) as { data?: unknown };
    if (typeof parsed.data !== "string" || parsed.data.trim().length === 0) {
      return {
        ok: false,
        message: "Input payload must include a non-empty string field named 'data'."
      };
    }

    return {
      ok: true,
      data: parsed.data
    };
  } catch {
    return {
      ok: false,
      message: "Input payload must be valid JSON."
    };
  }
}

function appendInput(sessionRecord: SessionRecord, input: string): void {
  const now = new Date();
  const command = input.trim();
  const sequence = sessionRecord.lines.length + 1;

  sessionRecord.lines.push(
    createTerminalLine(`line-${sequence}`, "input", command, now),
    createTerminalLine(`line-${sequence + 1}`, "system", `relay accepted command: ${command}`, now),
    createTerminalLine(`line-${sequence + 2}`, "stdout", simulateCommandOutput(command), now)
  );

  sessionRecord.session = {
    ...sessionRecord.session,
    updatedAt: now.toISOString()
  };
}

function simulateCommandOutput(command: string): string {
  const normalized = command.toLowerCase();

  if (normalized === "help") {
    return "Available preview commands: help, status, clear, attach";
  }

  if (normalized === "status") {
    return "relay-server preview is online; PTY transport is the next implementation step.";
  }

  if (normalized === "attach") {
    return "Attach preview: the future Windows agent will bind this session to a live Codex terminal.";
  }

  if (normalized === "clear") {
    return "Clear preview acknowledged. Client-side clearing is not wired yet.";
  }

  return `preview executed: ${command}`;
}

type SessionRecord = {
  session: SessionDescriptor;
  lines: TerminalLine[];
};
