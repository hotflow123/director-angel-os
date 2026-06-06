import {
  type LearningEvidence,
  type TrajectoryDigest,
  createLearningEvidence,
  createTrajectoryDigest,
} from "@hotflow/contracts";
import type { JournalEntry } from "@hotflow/sessions";
import type { CommittedSessionTaskSnapshot } from "@hotflow/tasks-core";

export interface ResolveTrajectoryDigestContextInput {
  readonly fallbackTurnId?: string;
}

export interface TrajectoryDigestContext {
  readonly sessionId: string;
  readonly sourceTurnId: string;
  readonly checkpointSeq: number;
  readonly checkpointCreatedAtMs: number;
  readonly journal: readonly JournalEntry[];
  readonly turnJournal: readonly JournalEntry[];
}

export function buildTrajectoryDigestFromCommittedSnapshot(
  snapshot: CommittedSessionTaskSnapshot,
  input: ResolveTrajectoryDigestContextInput = {},
): TrajectoryDigest {
  return buildTrajectoryDigest(resolveTrajectoryDigestContext(snapshot, input));
}

export function resolveTrajectoryDigestContext(
  snapshot: CommittedSessionTaskSnapshot,
  input: ResolveTrajectoryDigestContextInput = {},
): TrajectoryDigestContext {
  const sourceTurnId = snapshot.latestTurnId ?? input.fallbackTurnId;
  if (!sourceTurnId) {
    throw new Error(`Session ${snapshot.session.sessionId} has no committed turn id to analyze.`);
  }

  return {
    sessionId: snapshot.session.sessionId,
    sourceTurnId,
    checkpointSeq: snapshot.checkpoint?.uptoSeq ?? 0,
    checkpointCreatedAtMs: snapshot.checkpoint?.createdAtMs ?? 0,
    journal: snapshot.journal,
    turnJournal: snapshot.journal.filter((entry) => entry.turnId === sourceTurnId),
  };
}

export function buildTrajectoryDigest(input: TrajectoryDigestContext): TrajectoryDigest {
  let toolCallCount = 0;
  let toolResultCount = 0;
  let assistantOutputCount = 0;
  let latestUserText: string | null = null;
  const toolNames = new Set<string>();

  const evidence: LearningEvidence[] = input.turnJournal.map((entry) => {
    if (entry.eventType === "tool.call_planned") {
      toolCallCount += 1;
      const toolName = readStringField(entry.payload, "toolName");
      if (toolName) {
        toolNames.add(toolName);
      }
    } else if (entry.eventType === "tool.result") {
      toolResultCount += 1;
      const toolName = readStringField(entry.payload, "toolName");
      if (toolName) {
        toolNames.add(toolName);
      }
    } else if (entry.eventType === "assistant.output") {
      assistantOutputCount += 1;
    } else if (entry.eventType === "user.input") {
      const text = readStringField(entry.payload, "text");
      if (text) {
        latestUserText = text;
      }
    }

    return toLearningEvidence(entry);
  });

  const latestTurnEntry = input.turnJournal.at(-1);
  const fallbackCreatedAtMs = input.checkpointCreatedAtMs > 0 ? input.checkpointCreatedAtMs : 1;

  return createTrajectoryDigest({
    digestId: `digest_${sanitizeToken(input.sessionId)}_${sanitizeToken(input.sourceTurnId)}`,
    sourceSessionId: input.sessionId,
    sourceTurnId: input.sourceTurnId,
    trajectoryRef: `journal://${input.sessionId}/${input.sourceTurnId}`,
    createdAtMs: latestTurnEntry?.createdAtMs ?? fallbackCreatedAtMs,
    checkpointSeq: input.checkpointSeq,
    latestCommittedSeq: latestTurnEntry?.seq ?? input.checkpointSeq,
    latestUserText,
    toolNames: [...toolNames],
    counts: {
      journalEventsInTurn: input.turnJournal.length,
      toolCallCount,
      toolResultCount,
      assistantOutputCount,
    },
    evidence,
  });
}

function toLearningEvidence(entry: JournalEntry): LearningEvidence {
  const toolName = readStringField(entry.payload, "toolName");
  const text = readStringField(entry.payload, "text");
  const ok = readBooleanField(entry.payload, "ok");

  const attributes = buildEvidenceAttributes({
    text,
    toolName,
    ok,
  });

  return createLearningEvidence({
    evidenceId: `evidence_${entry.seq}`,
    eventType: entry.eventType,
    seq: entry.seq,
    turnId: entry.turnId ?? "unknown",
    createdAtMs: entry.createdAtMs,
    summary: summarizeEvidence(entry.eventType, {
      text,
      toolName,
      ok,
    }),
    ...(attributes === undefined ? {} : { attributes }),
  });
}

function summarizeEvidence(
  eventType: string,
  input: {
    readonly text: string | null;
    readonly toolName: string | null;
    readonly ok: boolean | null;
  },
): string {
  switch (eventType) {
    case "user.input":
      return input.text ?? "User input observed.";
    case "tool.call_planned":
      return input.toolName ? `Planned tool call: ${input.toolName}.` : "Tool call planned.";
    case "tool.result":
      if (input.toolName && input.ok !== null) {
        return `${input.toolName} completed with ok=${input.ok}.`;
      }
      if (input.toolName) {
        return `${input.toolName} returned a tool result.`;
      }
      return "Tool result observed.";
    case "assistant.output":
      return input.text ?? "Assistant output observed.";
    default:
      return `Observed ${eventType}.`;
  }
}

function buildEvidenceAttributes(input: {
  readonly text: string | null;
  readonly toolName: string | null;
  readonly ok: boolean | null;
}): { readonly [key: string]: string | boolean | null } | undefined {
  const attributes: Record<string, string | boolean | null> = {};
  if (input.text !== null) {
    attributes.text = input.text;
  }
  if (input.toolName !== null) {
    attributes.toolName = input.toolName;
  }
  if (input.ok !== null) {
    attributes.ok = input.ok;
  }
  return Object.keys(attributes).length === 0 ? undefined : attributes;
}

function sanitizeToken(value: string): string {
  return value.replace(/[^a-z0-9_]+/giu, "_");
}

function readStringField(payload: unknown, field: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readBooleanField(payload: unknown, field: string): boolean | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[field];
  return typeof value === "boolean" ? value : null;
}
