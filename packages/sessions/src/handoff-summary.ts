import type {
  CreateHandoffSummaryInput,
  HandoffSummaryPayload,
  HandoffSummaryRecord,
  JournalEntry,
} from "./types.js";

export const HANDOFF_SUMMARY_EVENT_TYPE = "session.handoff_summary";
export const HANDOFF_SUMMARY_SCHEMA_VERSION = "sessions.handoff-summary/v1" as const;

export function buildHandoffSummaryPayload(input: {
  readonly sessionId: string;
  readonly nowMs: number;
  readonly latestTurnId: string | null;
  readonly summary: CreateHandoffSummaryInput;
}): HandoffSummaryPayload {
  const lastSummarizedSeq = normalizeSeq(input.summary.lastSummarizedSeq, "lastSummarizedSeq");
  const sourceFromSeq = normalizeSeq(input.summary.sourceFromSeq, "sourceFromSeq");
  const sourceToSeq = normalizeSeq(input.summary.sourceToSeq, "sourceToSeq");
  if (sourceFromSeq > sourceToSeq) {
    throw new RangeError("sourceFromSeq must be less than or equal to sourceToSeq");
  }
  if (lastSummarizedSeq < sourceToSeq) {
    throw new RangeError("lastSummarizedSeq must be greater than or equal to sourceToSeq");
  }

  return {
    schemaVersion: HANDOFF_SUMMARY_SCHEMA_VERSION,
    sessionId: input.sessionId,
    lastSummarizedSeq,
    sourceFromSeq,
    sourceToSeq,
    latestTurnId: input.summary.latestTurnId ?? input.latestTurnId,
    currentState: normalizeNonEmptyText(input.summary.currentState, "currentState"),
    task: normalizeNonEmptyText(input.summary.task, "task"),
    filesAndFunctions: normalizeTextList(input.summary.filesAndFunctions),
    workflow: normalizeTextList(input.summary.workflow),
    errorsAndCorrections: normalizeTextList(input.summary.errorsAndCorrections),
    keyResults: normalizeTextList(input.summary.keyResults),
    worklog: normalizeTextList(input.summary.worklog),
    nextActions: normalizeTextList(input.summary.nextActions),
    createdAtMs: input.summary.createdAtMs ?? input.nowMs,
  };
}

export function toHandoffSummaryRecord(entry: JournalEntry): HandoffSummaryRecord | null {
  if (entry.eventType !== HANDOFF_SUMMARY_EVENT_TYPE) {
    return null;
  }
  const summary = asHandoffSummaryPayload(entry.payload);
  if (!summary) {
    return null;
  }
  return {
    summary,
    entry: entry as JournalEntry<HandoffSummaryPayload>,
  };
}

function asHandoffSummaryPayload(value: unknown): HandoffSummaryPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<HandoffSummaryPayload>;
  if (
    candidate.schemaVersion !== HANDOFF_SUMMARY_SCHEMA_VERSION ||
    typeof candidate.sessionId !== "string" ||
    typeof candidate.currentState !== "string" ||
    typeof candidate.task !== "string" ||
    !Number.isInteger(candidate.lastSummarizedSeq) ||
    !Number.isInteger(candidate.sourceFromSeq) ||
    !Number.isInteger(candidate.sourceToSeq) ||
    !Number.isInteger(candidate.createdAtMs)
  ) {
    return null;
  }
  return candidate as HandoffSummaryPayload;
}

function normalizeSeq(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a non-negative integer; received ${value}`);
  }
  return value;
}

function normalizeNonEmptyText(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return trimmed;
}

function normalizeTextList(value: readonly string[] | undefined): string[] {
  return (value ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}
