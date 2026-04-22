import http from "node:http";
import {
  createAgentCommand,
  createEnvelope,
  createTerminalLine,
  type AgentOutputPayload,
  type SessionDescriptor,
  type TerminalLine
} from "@remote-console/protocol";

const port = Number.parseInt(process.env.PORT ?? "4040", 10);
const viewerSharedKey = process.env.VIEWER_SHARED_KEY ?? "viewer-dev-key";
const agentSharedKey = process.env.AGENT_SHARED_KEY ?? "agent-dev-key";
const sessions = new Map<string, SessionRecord>();

seedSession("local-machine", "Development Machine");

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

  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, {
      ok: true,
      service: "relay-server"
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sessions") {
    if (!isViewerAuthorized(request, url)) {
      writeJson(response, 401, {
        ok: false,
        message: "Viewer key was missing or invalid."
      });
      return;
    }

    const snapshot = createEnvelope("session.snapshot", "system", {
      sessions: Array.from(sessions.values(), value => value.session)
    });
    writeJson(response, 200, snapshot);
    return;
  }

  const streamMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
  if (request.method === "GET" && streamMatch) {
    if (!isViewerAuthorized(request, url)) {
      writeJson(response, 401, {
        ok: false,
        message: "Viewer key was missing or invalid."
      });
      return;
    }

    const sessionRecord = sessions.get(streamMatch[1]);
    if (!sessionRecord) {
      writeJson(response, 404, {
        ok: false,
        message: "Session not found."
      });
      return;
    }

    openStream(response, sessionRecord);
    return;
  }

  const terminalMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/terminal$/);
  if (request.method === "GET" && terminalMatch) {
    if (!isViewerAuthorized(request, url)) {
      writeJson(response, 401, {
        ok: false,
        message: "Viewer key was missing or invalid."
      });
      return;
    }

    const sessionRecord = sessions.get(terminalMatch[1]);
    if (!sessionRecord) {
      writeJson(response, 404, {
        ok: false,
        message: "Session not found."
      });
      return;
    }

    writeJson(response, 200, buildTerminalSnapshot(sessionRecord));
    return;
  }

  if (request.method === "POST" && terminalMatch) {
    if (!isViewerAuthorized(request, url)) {
      writeJson(response, 401, {
        ok: false,
        message: "Viewer key was missing or invalid."
      });
      return;
    }

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

        enqueueCommand(sessionRecord, parsed.data);
        broadcastSnapshot(sessionRecord);
        writeJson(response, 200, buildTerminalSnapshot(sessionRecord));
      })
      .catch((error: unknown) => {
        writeJson(response, 500, {
          ok: false,
          message: error instanceof Error ? error.message : "Unknown relay error."
        });
      });
    return;
  }

  const agentRegisterMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)$/);
  if ((request.method === "PUT" || request.method === "POST") && agentRegisterMatch) {
    if (!isAgentAuthorized(request)) {
      writeJson(response, 401, {
        ok: false,
        message: "Agent key was missing or invalid."
      });
      return;
    }

    collectBody(request)
      .then((body) => {
        const parsed = parseRegistrationRequest(body);
        if (!parsed.ok) {
          writeJson(response, 400, {
            ok: false,
            message: parsed.message
          });
          return;
        }

        const sessionRecord = ensureSession(agentRegisterMatch[1], parsed.machineName);
        appendSystemLine(sessionRecord, `agent registered from ${parsed.machineName}`);
        broadcastSnapshot(sessionRecord);
        writeJson(response, 200, buildTerminalSnapshot(sessionRecord));
      })
      .catch((error: unknown) => {
        writeJson(response, 500, {
          ok: false,
          message: error instanceof Error ? error.message : "Unknown relay error."
        });
      });
    return;
  }

  const agentCommandsMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/commands$/);
  if (request.method === "GET" && agentCommandsMatch) {
    if (!isAgentAuthorized(request)) {
      writeJson(response, 401, {
        ok: false,
        message: "Agent key was missing or invalid."
      });
      return;
    }

    const sessionRecord = sessions.get(agentCommandsMatch[1]);
    if (!sessionRecord) {
      writeJson(response, 404, {
        ok: false,
        message: "Session not found."
      });
      return;
    }

    const snapshot = createEnvelope("agent.commands", sessionRecord.session.id, {
      session: sessionRecord.session,
      pendingCommands: sessionRecord.pendingCommands
    });
    writeJson(response, 200, snapshot);
    return;
  }

  const agentOutputMatch = url.pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/output$/);
  if (request.method === "POST" && agentOutputMatch) {
    if (!isAgentAuthorized(request)) {
      writeJson(response, 401, {
        ok: false,
        message: "Agent key was missing or invalid."
      });
      return;
    }

    const sessionRecord = sessions.get(agentOutputMatch[1]);
    if (!sessionRecord) {
      writeJson(response, 404, {
        ok: false,
        message: "Session not found."
      });
      return;
    }

    collectBody(request)
      .then((body) => {
        const parsed = parseOutputRequest(body);
        if (!parsed.ok) {
          writeJson(response, 400, {
            ok: false,
            message: parsed.message
          });
          return;
        }

        appendOutput(sessionRecord, parsed.payload);
        broadcastSnapshot(sessionRecord);
        writeJson(response, 200, buildTerminalSnapshot(sessionRecord));
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

function seedSession(id: string, machineName: string): void {
  const sessionRecord = ensureSession(id, machineName);
  if (sessionRecord.lines.length === 0) {
    const now = new Date();
    sessionRecord.lines.push(
      createTerminalLine("line-1", "system", `relay-server connected to ${id}`, now),
      createTerminalLine("line-2", "stdout", "windows-agent can register and stream output here", now),
      createTerminalLine("line-3", "stdout", "type a command in the Teams terminal to queue work for the agent", now)
    );
  }
}

function ensureSession(id: string, machineName: string): SessionRecord {
  const existing = sessions.get(id);
  if (existing) {
    existing.session = {
      ...existing.session,
      machineName,
      state: "connected",
      updatedAt: new Date().toISOString()
    };
    return existing;
  }

  const now = new Date().toISOString();
  const sessionRecord: SessionRecord = {
    session: {
      id,
      machineName,
      state: "connected",
      updatedAt: now
    },
    lines: [],
    pendingCommands: [],
    streams: new Set()
  };

  sessions.set(id, sessionRecord);
  return sessionRecord;
}

function enqueueCommand(sessionRecord: SessionRecord, input: string): void {
  const now = new Date();
  const command = input.trim();
  const commandId = `cmd-${sessionRecord.pendingCommands.length + Date.now()}`;

  sessionRecord.pendingCommands.push(createAgentCommand(commandId, command, now));
  sessionRecord.lines.push(
    createTerminalLine(`line-${sessionRecord.lines.length + 1}`, "input", command, now),
    createTerminalLine(`line-${sessionRecord.lines.length + 2}`, "system", `queued for agent as ${commandId}`, now)
  );
  touchSession(sessionRecord, now);
}

function appendOutput(sessionRecord: SessionRecord, payload: AgentOutputPayload): void {
  const now = new Date();

  if (payload.commandId) {
    sessionRecord.pendingCommands = sessionRecord.pendingCommands.filter(command => command.id !== payload.commandId);
    sessionRecord.lines.push(
      createTerminalLine(
        `line-${sessionRecord.lines.length + 1}`,
        "system",
        `agent completed ${payload.commandId}`,
        now)
    );
  }

  for (const line of payload.lines) {
    sessionRecord.lines.push(
      createTerminalLine(`line-${sessionRecord.lines.length + 1}`, line.stream, line.text, now)
    );
  }

  touchSession(sessionRecord, now);
}

function appendSystemLine(sessionRecord: SessionRecord, text: string): void {
  const now = new Date();
  sessionRecord.lines.push(
    createTerminalLine(`line-${sessionRecord.lines.length + 1}`, "system", text, now)
  );
  touchSession(sessionRecord, now);
}

function touchSession(sessionRecord: SessionRecord, now: Date): void {
  sessionRecord.session = {
    ...sessionRecord.session,
    updatedAt: now.toISOString()
  };
}

function buildTerminalSnapshot(sessionRecord: SessionRecord) {
  return createEnvelope("terminal.snapshot", sessionRecord.session.id, {
    session: sessionRecord.session,
    lines: sessionRecord.lines
  });
}

function openStream(response: http.ServerResponse, sessionRecord: SessionRecord): void {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });

  sessionRecord.streams.add(response);
  response.write(`event: snapshot\n`);
  response.write(`data: ${JSON.stringify(buildTerminalSnapshot(sessionRecord))}\n\n`);

  const heartbeat = setInterval(() => {
    response.write(": heartbeat\n\n");
  }, 15000);

  response.on("close", () => {
    clearInterval(heartbeat);
    sessionRecord.streams.delete(response);
  });
}

function broadcastSnapshot(sessionRecord: SessionRecord): void {
  const payload = JSON.stringify(buildTerminalSnapshot(sessionRecord));
  for (const stream of sessionRecord.streams) {
    stream.write(`event: snapshot\n`);
    stream.write(`data: ${payload}\n\n`);
  }
}

function writeJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function writeCorsHeaders(response: http.ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,PUT,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,x-remote-console-agent-key,x-remote-console-viewer-key");
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

function parseRegistrationRequest(body: string): { ok: true; machineName: string } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(body) as { machineName?: unknown };
    if (typeof parsed.machineName !== "string" || parsed.machineName.trim().length === 0) {
      return {
        ok: false,
        message: "Registration payload must include a non-empty string field named 'machineName'."
      };
    }

    return {
      ok: true,
      machineName: parsed.machineName.trim()
    };
  } catch {
    return {
      ok: false,
      message: "Registration payload must be valid JSON."
    };
  }
}

function parseOutputRequest(body: string): { ok: true; payload: AgentOutputPayload } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(body) as Partial<AgentOutputPayload>;
    if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) {
      return {
        ok: false,
        message: "Output payload must include a non-empty array field named 'lines'."
      };
    }

    const lines = parsed.lines
      .filter((line): line is { stream: "stdout" | "stderr" | "system"; text: string } =>
        typeof line === "object"
        && line !== null
        && (line.stream === "stdout" || line.stream === "stderr" || line.stream === "system")
        && typeof line.text === "string"
        && line.text.trim().length > 0);

    if (lines.length === 0) {
      return {
        ok: false,
        message: "Output lines must contain at least one valid stream/text entry."
      };
    }

    return {
      ok: true,
      payload: {
        commandId: typeof parsed.commandId === "string" ? parsed.commandId : undefined,
        lines
      }
    };
  } catch {
    return {
      ok: false,
      message: "Output payload must be valid JSON."
    };
  }
}

type SessionRecord = {
  session: SessionDescriptor;
  lines: TerminalLine[];
  pendingCommands: ReturnType<typeof createAgentCommand>[];
  streams: Set<http.ServerResponse>;
};

function isViewerAuthorized(request: http.IncomingMessage, url: URL): boolean {
  const headerValue = request.headers["x-remote-console-viewer-key"];
  const keyFromHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const keyFromQuery = url.searchParams.get("viewerKey");
  return keyFromHeader === viewerSharedKey || keyFromQuery === viewerSharedKey;
}

function isAgentAuthorized(request: http.IncomingMessage): boolean {
  const headerValue = request.headers["x-remote-console-agent-key"];
  const keyFromHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return keyFromHeader === agentSharedKey;
}
