export type TransportEnvelope<TType extends string, TPayload> = {
  type: TType;
  timestamp: string;
  sessionId: string;
  payload: TPayload;
};

export type SessionState = "connecting" | "connected" | "disconnected";

export type SessionDescriptor = {
  id: string;
  machineName: string;
  state: SessionState;
  updatedAt: string;
};

export type TerminalLine = {
  id: string;
  stream: "stdout" | "stderr" | "system" | "input";
  text: string;
  createdAt: string;
};

export type TerminalInputPayload = {
  data: string;
};

export type TerminalOutputPayload = {
  stream: "stdout" | "stderr";
  data: string;
};

export type SessionSnapshotPayload = {
  sessions: SessionDescriptor[];
};

export type TerminalSnapshotPayload = {
  session: SessionDescriptor;
  lines: TerminalLine[];
};

export type AgentRegistrationPayload = {
  machineName: string;
};

export type AgentCommand = {
  id: string;
  command: string;
  createdAt: string;
};

export type AgentCommandSnapshotPayload = {
  session: SessionDescriptor;
  pendingCommands: AgentCommand[];
};

export type AgentOutputPayload = {
  commandId?: string;
  lines: Array<{
    stream: "stdout" | "stderr" | "system";
    text: string;
  }>;
};

export type TerminalInputEvent = TransportEnvelope<"terminal.input", TerminalInputPayload>;
export type TerminalOutputEvent = TransportEnvelope<"terminal.output", TerminalOutputPayload>;
export type SessionSnapshotEvent = TransportEnvelope<"session.snapshot", SessionSnapshotPayload>;
export type TerminalSnapshotEvent = TransportEnvelope<"terminal.snapshot", TerminalSnapshotPayload>;
export type AgentCommandSnapshotEvent = TransportEnvelope<"agent.commands", AgentCommandSnapshotPayload>;

export function createEnvelope<TType extends string, TPayload>(
  type: TType,
  sessionId: string,
  payload: TPayload,
  now: Date = new Date())
: TransportEnvelope<TType, TPayload> {
  return {
    type,
    sessionId,
    payload,
    timestamp: now.toISOString()
  };
}

export function isTransportEnvelope(value: unknown): value is TransportEnvelope<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.type === "string"
    && typeof candidate.sessionId === "string"
    && typeof candidate.timestamp === "string"
    && "payload" in candidate;
}

export function createTerminalLine(
  id: string,
  stream: TerminalLine["stream"],
  text: string,
  now: Date = new Date())
: TerminalLine {
  return {
    id,
    stream,
    text,
    createdAt: now.toISOString()
  };
}

export function createAgentCommand(
  id: string,
  command: string,
  now: Date = new Date())
: AgentCommand {
  return {
    id,
    command,
    createdAt: now.toISOString()
  };
}
