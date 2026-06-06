import { SessionRecoveryError } from "./errors.js";
import { isStepJournalEventType, toStepJournalEntry } from "./journal.js";
import type { SessionStorage } from "./storage.js";
import type {
  CheckpointRecord,
  JsonValue,
  RecoverSessionOptions,
  RecoverStepOptions,
  RecoveryResult,
  SessionReplayReducer,
  StepCheckpointMetadata,
  StepJournalEntry,
  StepRecoveryResult,
  StepReplayData,
  StepResumeAction,
} from "./types.js";
import { assertSchemaVersionCompatible } from "./version.js";

function applyEvents<State extends JsonValue | null>(
  initialState: State,
  events: ReturnType<SessionStorage["listJournalEntries"]>,
  reducer?: SessionReplayReducer<State>,
): State {
  if (!reducer) {
    return initialState;
  }

  let currentState = initialState;
  for (const event of events) {
    currentState = reducer(currentState, event);
  }
  return currentState;
}

export function recoverSessionState<State extends JsonValue | null = JsonValue | null>(
  storage: SessionStorage,
  sessionId: string,
  options: RecoverSessionOptions<State> = {},
): RecoveryResult<State> {
  const session = storage.getSession(sessionId);
  if (!session) {
    throw new SessionRecoveryError(`Cannot recover missing session "${sessionId}"`);
  }

  if (options.expectedSchemaVersion) {
    assertSchemaVersionCompatible(
      session.schemaVersion,
      options.expectedSchemaVersion,
      `session ${sessionId}`,
    );
  }

  const checkpoint = storage.getLatestCheckpoint(sessionId) as RecoveryResult<State>["checkpoint"];
  if (checkpoint && options.expectedSchemaVersion) {
    assertSchemaVersionCompatible(
      checkpoint.schemaVersion,
      options.expectedSchemaVersion,
      `checkpoint for session ${sessionId}`,
    );
  }

  const journal = storage.listJournalEntries(sessionId, {
    afterSeq: checkpoint?.uptoSeq ?? 0,
  });

  if (options.expectedSchemaVersion) {
    for (const entry of journal) {
      assertSchemaVersionCompatible(
        entry.schemaVersion,
        options.expectedSchemaVersion,
        `journal entry ${entry.rowId} for session ${sessionId}`,
      );
    }
  }

  const baseState = (checkpoint?.state ?? options.initialState ?? null) as State;
  const state = applyEvents(baseState, journal, options.reducer);

  return {
    session,
    checkpoint,
    journal,
    state,
    lastAppliedSeq: journal.at(-1)?.seq ?? checkpoint?.uptoSeq ?? 0,
  };
}

function isStepCheckpointMetadata(value: unknown): value is StepCheckpointMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.scope === "step" &&
    typeof candidate.turnId === "string" &&
    candidate.turnId.trim().length > 0 &&
    Number.isInteger(candidate.stepIndex) &&
    (candidate.stepIndex as number) >= 0 &&
    typeof candidate.eventType === "string" &&
    isStepJournalEventType(candidate.eventType)
  );
}

function nextStepIndexFromProgress(
  stepIndex: number,
  eventType: StepCheckpointMetadata["eventType"],
): number {
  if (
    eventType === "step.context_built" ||
    eventType === "step.model_output" ||
    eventType === "step.tools_planned"
  ) {
    return stepIndex;
  }
  return stepIndex + 1;
}

function resumeActionFromProgress(
  eventType: StepCheckpointMetadata["eventType"],
): StepResumeAction {
  switch (eventType) {
    case "step.context_built":
    case "step.model_output":
    case "step.tools_planned":
      return "continue-current-step";
    case "step.tool_result":
      return "start-next-step";
    case "step.final_output":
      return "turn-complete";
    default:
      return "no-progress";
  }
}

export function recoverStepState<
  State extends JsonValue | null = JsonValue | null,
  Payload extends JsonValue = JsonValue,
>(
  storage: SessionStorage,
  sessionId: string,
  options: RecoverStepOptions<State>,
): StepRecoveryResult<State, Payload> {
  const turnId = options.turnId.trim();
  if (turnId.length === 0) {
    throw new TypeError("turnId must be a non-empty string");
  }

  const { turnId: _turnId, ...recoverOptions } = options;
  const base = recoverSessionState<State>(storage, sessionId, recoverOptions);
  const stepCheckpoint =
    base.checkpoint &&
    isStepCheckpointMetadata(base.checkpoint.metadata) &&
    base.checkpoint.metadata.turnId === turnId
      ? (base.checkpoint as CheckpointRecord<State, StepCheckpointMetadata>)
      : null;

  const stepJournal: StepJournalEntry<Payload>[] = [];
  for (const entry of base.journal) {
    if (entry.turnId !== turnId) {
      continue;
    }
    const stepEntry = toStepJournalEntry(entry);
    if (stepEntry) {
      stepJournal.push(stepEntry as StepJournalEntry<Payload>);
    }
  }

  const replay: StepReplayData<Payload> = {
    contextBuilt: [],
    modelOutput: [],
    plannedTools: [],
    toolResults: [],
    finalOutput: [],
  };
  for (const stepEntry of stepJournal) {
    switch (stepEntry.eventType) {
      case "step.context_built":
        replay.contextBuilt.push(stepEntry);
        break;
      case "step.model_output":
        replay.modelOutput.push(stepEntry);
        break;
      case "step.tools_planned":
        replay.plannedTools.push(stepEntry);
        break;
      case "step.tool_result":
        replay.toolResults.push(stepEntry);
        break;
      case "step.final_output":
        replay.finalOutput.push(stepEntry);
        break;
      default:
        break;
    }
  }

  const lastStepEvent = stepJournal.at(-1) ?? null;
  const replayWindow = {
    fromSeqExclusive: base.checkpoint?.uptoSeq ?? 0,
    toSeqInclusive: base.lastAppliedSeq,
  };
  let nextStepIndex = 0;
  let resumeAction: StepResumeAction = "no-progress";
  if (stepCheckpoint) {
    nextStepIndex = nextStepIndexFromProgress(
      stepCheckpoint.metadata.stepIndex,
      stepCheckpoint.metadata.eventType,
    );
    resumeAction = resumeActionFromProgress(stepCheckpoint.metadata.eventType);
  }
  if (lastStepEvent) {
    nextStepIndex = nextStepIndexFromProgress(lastStepEvent.stepIndex, lastStepEvent.eventType);
    resumeAction = resumeActionFromProgress(lastStepEvent.eventType);
  }

  return {
    ...base,
    turnId,
    stepCheckpoint,
    stepJournal,
    replay,
    replayWindow,
    lastStepEvent,
    resumeAction,
    nextStepIndex,
  };
}
