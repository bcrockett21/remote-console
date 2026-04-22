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

export type TerminalInputEvent = TransportEnvelope<"terminal.input", TerminalInputPayload>;
export type TerminalOutputEvent = TransportEnvelope<"terminal.output", TerminalOutputPayload>;
export type SessionSnapshotEvent = TransportEnvelope<"session.snapshot", SessionSnapshotPayload>;

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
