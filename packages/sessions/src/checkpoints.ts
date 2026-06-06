import { SessionArchivedError } from "./errors.js";
import type { SessionStorage } from "./storage.js";
import type {
  CheckpointRecord,
  CreateCheckpointInput,
  CreateStepCheckpointInput,
  JsonObject,
  JsonValue,
  ListCheckpointsOptions,
  SessionRecord,
  StepCheckpointMetadata,
} from "./types.js";
import { assertSchemaVersionCompatible, resolveSchemaVersion } from "./version.js";

export class SessionCheckpoints {
  constructor(private readonly storage: SessionStorage) {}

  create<State extends JsonValue = JsonValue, Meta extends JsonObject = JsonObject>(
    session: SessionRecord,
    input: CreateCheckpointInput<State, Meta>,
  ): CheckpointRecord<State, Meta> {
    if (session.status === "archived") {
      throw new SessionArchivedError(session.sessionId);
    }
    const latestSeq = this.storage.getLatestJournalSeq(session.sessionId);
    const uptoSeq = input.uptoSeq ?? latestSeq;
    if (!Number.isInteger(uptoSeq) || uptoSeq < 0) {
      throw new RangeError(`uptoSeq must be a non-negative integer; received ${uptoSeq}`);
    }
    if (uptoSeq > latestSeq) {
      throw new RangeError(
        `uptoSeq (${uptoSeq}) cannot be greater than latest journal seq (${latestSeq})`,
      );
    }
    const schemaVersion = resolveSchemaVersion(input.schemaVersion ?? session.schemaVersion);
    assertSchemaVersionCompatible(
      schemaVersion,
      session.schemaVersion,
      `checkpoint for session ${session.sessionId}`,
    );
    return this.storage.insertCheckpoint({
      sessionId: session.sessionId,
      uptoSeq,
      state: input.state,
      metadata: input.metadata ?? {},
      schemaVersion,
      createdAtMs: input.createdAtMs ?? this.storage.now(),
    }) as CheckpointRecord<State, Meta>;
  }

  createStep<State extends JsonValue = JsonValue>(
    session: SessionRecord,
    input: CreateStepCheckpointInput<State>,
  ): CheckpointRecord<State, StepCheckpointMetadata> {
    const turnId = input.turnId.trim();
    if (turnId.length === 0) {
      throw new TypeError("turnId must be a non-empty string");
    }
    if (!Number.isInteger(input.stepIndex) || input.stepIndex < 0) {
      throw new RangeError(`stepIndex must be a non-negative integer; received ${input.stepIndex}`);
    }

    const checkpointInput: CreateCheckpointInput<State, StepCheckpointMetadata> = {
      state: input.state,
      metadata: {
        scope: "step",
        turnId,
        stepIndex: input.stepIndex,
        eventType: input.eventType,
      },
    };
    if (input.uptoSeq !== undefined) {
      checkpointInput.uptoSeq = input.uptoSeq;
    }
    if (input.schemaVersion !== undefined) {
      checkpointInput.schemaVersion = input.schemaVersion;
    }
    if (input.createdAtMs !== undefined) {
      checkpointInput.createdAtMs = input.createdAtMs;
    }

    return this.create<State, StepCheckpointMetadata>(session, checkpointInput);
  }

  latest(sessionId: string): CheckpointRecord | null {
    return this.storage.getLatestCheckpoint(sessionId);
  }

  get(sessionId: string, checkpointId: number): CheckpointRecord | null {
    return this.storage.getCheckpoint(sessionId, checkpointId);
  }

  list(sessionId: string, options: ListCheckpointsOptions = {}): CheckpointRecord[] {
    return this.storage.listCheckpoints(sessionId, options);
  }
}
