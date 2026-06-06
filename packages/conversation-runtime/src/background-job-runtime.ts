import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ToolCapability, ToolRiskLevel } from "@hotflow/policy-runtime";

import { normalizeConversationRuntimeAngelRoleProfile } from "./angel-role-profile.js";
import type { ConversationRuntimePolicyBudget } from "./policy-envelope.js";
import type { ConversationRuntimeQueuedInput } from "./queue.js";
import type {
  ConversationRuntimeAngelRoleProfile,
  ConversationRuntimeInput,
  ConversationRuntimeResult,
  ConversationRuntimeSurface,
  ConversationRuntimeTrustedContext,
} from "./types.js";

export type ConversationRuntimeBackgroundJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "retry_scheduled"
  | "completed"
  | "cancelled"
  | "failed";

export type ConversationRuntimeBackgroundJobTrigger =
  | {
      readonly kind: "manual";
      readonly requestedBy: "user" | "operator" | "system" | (string & {});
    }
  | {
      readonly kind: "schedule";
      readonly scheduleRef: string;
    }
  | {
      readonly kind: "subagent";
      readonly parentJobId?: string;
      readonly parentTurnRunId?: string;
    }
  | {
      readonly kind: "runtime";
      readonly reason: string;
    };

export interface ConversationRuntimeBackgroundJobPermissions {
  readonly allowedTools: readonly string[];
  readonly allowedCapabilities: readonly ToolCapability[];
  readonly riskLevel: ToolRiskLevel;
  readonly requiresApproval: boolean;
}

export interface ConversationRuntimeBackgroundJobEvent {
  readonly id: string;
  readonly type:
    | "created"
    | "started"
    | "paused"
    | "resumed"
    | "delegated"
    | "retry_scheduled"
    | "completed"
    | "failed"
    | "subagent.failed"
    | "cancelled"
    | "recovered";
  readonly occurredAtMs: number;
  readonly summary?: string;
  readonly policyEnvelopeRefs: readonly string[];
  readonly evidenceRefIds: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeBackgroundJobRecord {
  readonly schemaVersion: "conversation-runtime.background-job.v1";
  readonly jobId: string;
  readonly sessionKey: string;
  readonly title: string;
  readonly objective: string;
  readonly status: ConversationRuntimeBackgroundJobStatus;
  readonly trigger: ConversationRuntimeBackgroundJobTrigger;
  readonly budget: ConversationRuntimePolicyBudget;
  readonly permissions: ConversationRuntimeBackgroundJobPermissions;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly startedAtMs?: number;
  readonly pausedAtMs?: number;
  readonly nextAttemptAtMs?: number;
  readonly completedAtMs?: number;
  readonly failedAtMs?: number;
  readonly cancelledAtMs?: number;
  readonly workerId?: string;
  readonly activeSubagentRunIds: readonly string[];
  readonly policyEnvelopeRefs: readonly string[];
  readonly evidenceRefIds: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly failureTaxonomy: readonly string[];
  readonly summary?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly events: readonly ConversationRuntimeBackgroundJobEvent[];
}

export interface CreateConversationRuntimeBackgroundJobTaskInput {
  readonly jobId: string;
  readonly sessionKey: string;
  readonly title: string;
  readonly objective: string;
  readonly trigger: ConversationRuntimeBackgroundJobTrigger;
  readonly budget?: ConversationRuntimePolicyBudget;
  readonly allowedTools?: readonly string[];
  readonly allowedCapabilities?: readonly ToolCapability[];
  readonly riskLevel?: ToolRiskLevel;
  readonly requiresApproval?: boolean;
  readonly maxAttempts?: number;
  readonly policyEnvelopeRefs?: readonly string[];
  readonly evidenceRefIds?: readonly string[];
  readonly sourceRefs?: readonly string[];
  readonly failureTaxonomy?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdAtMs?: number;
}

export interface ConversationRuntimeBackgroundJobTask {
  readonly record: ConversationRuntimeBackgroundJobRecord;
  readonly queueInput: ConversationRuntimeQueuedInput;
}

export type ConversationRuntimeBackgroundJobTransition =
  | {
      readonly type: "start";
      readonly occurredAtMs?: number;
      readonly workerId?: string;
      readonly policyEnvelopeRefs?: readonly string[];
    }
  | {
      readonly type: "pause";
      readonly occurredAtMs?: number;
      readonly requestedBy: "user" | "operator" | "system" | (string & {});
      readonly reason: string;
      readonly policyEnvelopeRefs?: readonly string[];
    }
  | {
      readonly type: "resume";
      readonly occurredAtMs?: number;
      readonly workerId?: string;
      readonly policyEnvelopeRefs?: readonly string[];
    }
  | {
      readonly type: "delegate";
      readonly occurredAtMs?: number;
      readonly subagentRunId: string;
      readonly summary?: string;
      readonly policyEnvelopeRefs?: readonly string[];
    }
  | {
      readonly type: "retry";
      readonly occurredAtMs?: number;
      readonly reason: string;
      readonly nextAttemptAtMs?: number;
      readonly policyEnvelopeRefs?: readonly string[];
      readonly failureTaxonomy?: readonly string[];
    }
  | {
      readonly type: "complete";
      readonly occurredAtMs?: number;
      readonly summary?: string;
      readonly evidenceRefIds?: readonly string[];
      readonly sourceRefs?: readonly string[];
      readonly policyEnvelopeRefs?: readonly string[];
    }
  | {
      readonly type: "fail";
      readonly occurredAtMs?: number;
      readonly reason: string;
      readonly failureTaxonomy?: readonly string[];
      readonly policyEnvelopeRefs?: readonly string[];
    }
  | {
      readonly type: "cancel";
      readonly occurredAtMs?: number;
      readonly requestedBy: "user" | "operator" | "system" | (string & {});
      readonly reason: string;
      readonly policyEnvelopeRefs?: readonly string[];
    };

export interface ConversationRuntimeBackgroundJobStore {
  readonly load: () => readonly ConversationRuntimeBackgroundJobRecord[];
  readonly upsert: (record: ConversationRuntimeBackgroundJobRecord) => void;
  readonly read: (jobId: string) => ConversationRuntimeBackgroundJobRecord | undefined;
}

export interface RecoverConversationRuntimeBackgroundJobsOptions {
  readonly nowMs?: () => number;
  readonly reason?: string;
}

export const CONVERSATION_RUNTIME_BACKGROUND_JOB_STORE_SCHEMA_VERSION =
  "conversation-runtime.background-job-store.v1" as const;

export interface ConversationRuntimeBackgroundJobStoreDocument {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_BACKGROUND_JOB_STORE_SCHEMA_VERSION;
  readonly jobs: readonly ConversationRuntimeBackgroundJobRecord[];
}

export interface FileConversationRuntimeBackgroundJobStoreOptions {
  readonly path: string;
}

export interface SQLiteConversationRuntimeBackgroundJobStoreOptions {
  readonly dbPath: string;
}

export type ConversationRuntimeBackgroundJobRecoveryActionKind = "resume" | "manual_review";

export interface ConversationRuntimeBackgroundJobRecoveryAction {
  readonly jobId: string;
  readonly sessionKey: string;
  readonly title: string;
  readonly action: ConversationRuntimeBackgroundJobRecoveryActionKind;
  readonly reason: string;
  readonly requiresOperatorApproval: boolean;
  readonly budget: ConversationRuntimePolicyBudget;
  readonly allowedTools: readonly string[];
  readonly policyEnvelopeRefs: readonly string[];
  readonly evidenceRefIds: readonly string[];
  readonly sourceRefs: readonly string[];
}

export interface ConversationRuntimeBackgroundJobRecoveryPlan {
  readonly schemaVersion: "conversation-runtime.background-job-recovery-plan.v1";
  readonly createdAtMs: number;
  readonly recoverableCount: number;
  readonly blockedCount: number;
  readonly actions: readonly ConversationRuntimeBackgroundJobRecoveryAction[];
}

export interface CreateConversationRuntimeBackgroundJobRecoveryPlanOptions {
  readonly nowMs?: () => number;
}

export type ConversationRuntimeBackgroundJobWorkerLoopStatus = "stopped" | "failed";

export type ConversationRuntimeBackgroundJobWorkerLoopStoppedReason =
  | "max-claims"
  | "no-ready-job"
  | "executor-error";

export type ConversationRuntimeBackgroundJobWorkerExecutorResult =
  | {
      readonly status: "completed";
      readonly summary?: string;
      readonly evidenceRefIds?: readonly string[];
      readonly sourceRefs?: readonly string[];
      readonly policyEnvelopeRefs?: readonly string[];
    }
  | {
      readonly status: "failed";
      readonly reason: string;
      readonly failureTaxonomy?: readonly string[];
      readonly policyEnvelopeRefs?: readonly string[];
    }
  | {
      readonly status: "retry";
      readonly reason: string;
      readonly nextAttemptAtMs?: number;
      readonly failureTaxonomy?: readonly string[];
      readonly policyEnvelopeRefs?: readonly string[];
    };

export interface ConversationRuntimeBackgroundJobWorkerExecutorContext {
  readonly workerId: string;
  readonly nowMs: number;
}

export type ConversationRuntimeBackgroundJobWorkerExecutor = (
  job: ConversationRuntimeBackgroundJobRecord,
  context: ConversationRuntimeBackgroundJobWorkerExecutorContext,
) => Promise<ConversationRuntimeBackgroundJobWorkerExecutorResult>;

export interface ConversationRuntimeBackgroundJobTurnExecutorContext
  extends ConversationRuntimeBackgroundJobWorkerExecutorContext {
  readonly job: ConversationRuntimeBackgroundJobRecord;
}

export type ConversationRuntimeBackgroundJobTurnRunner = (
  input: ConversationRuntimeInput,
  context: ConversationRuntimeBackgroundJobTurnExecutorContext,
) => Promise<ConversationRuntimeResult>;

export type ConversationRuntimeBackgroundJobErrorClassifier = (input: {
  readonly error: unknown;
  readonly job: ConversationRuntimeBackgroundJobRecord;
  readonly context: ConversationRuntimeBackgroundJobWorkerExecutorContext;
}) => ConversationRuntimeBackgroundJobWorkerExecutorResult;

export type ConversationRuntimeBackgroundJobResultMapper = (input: {
  readonly result: ConversationRuntimeResult;
  readonly job: ConversationRuntimeBackgroundJobRecord;
  readonly context: ConversationRuntimeBackgroundJobWorkerExecutorContext;
}) => ConversationRuntimeBackgroundJobWorkerExecutorResult;

export interface CreateConversationRuntimeBackgroundJobTurnExecutorOptions {
  readonly runTurn: ConversationRuntimeBackgroundJobTurnRunner;
  readonly surface?: ConversationRuntimeSurface;
  readonly channel?: string;
  readonly senderId?:
    | string
    | ((context: ConversationRuntimeBackgroundJobTurnExecutorContext) => string);
  readonly trustedContext?: ConversationRuntimeTrustedContext;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly mapResult?: ConversationRuntimeBackgroundJobResultMapper;
  readonly classifyError?: ConversationRuntimeBackgroundJobErrorClassifier;
}

export interface RunConversationRuntimeBackgroundJobWorkerLoopInput {
  readonly store: ConversationRuntimeBackgroundJobStore;
  readonly workerId?: string;
  readonly maxClaims?: number;
  readonly nowMs?: () => number;
  readonly executor: ConversationRuntimeBackgroundJobWorkerExecutor;
}

export interface ConversationRuntimeBackgroundJobWorkerLoopReport {
  readonly schemaVersion: "conversation-runtime.background-job-worker-loop.v1";
  readonly workerId: string;
  readonly status: ConversationRuntimeBackgroundJobWorkerLoopStatus;
  readonly stoppedReason: ConversationRuntimeBackgroundJobWorkerLoopStoppedReason;
  readonly claimedCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly retryScheduledCount: number;
  readonly jobIds: readonly string[];
  readonly errors: readonly string[];
}

export function createConversationRuntimeBackgroundJobTask(
  input: CreateConversationRuntimeBackgroundJobTaskInput,
): ConversationRuntimeBackgroundJobTask {
  const timestamp = input.createdAtMs ?? Date.now();
  const policyEnvelopeRefs = uniqueStrings(input.policyEnvelopeRefs ?? []);
  const evidenceRefIds = uniqueStrings(input.evidenceRefIds ?? []);
  const sourceRefs = uniqueStrings(input.sourceRefs ?? []);
  const record: ConversationRuntimeBackgroundJobRecord = {
    schemaVersion: "conversation-runtime.background-job.v1",
    jobId: input.jobId,
    sessionKey: input.sessionKey,
    title: input.title,
    objective: input.objective,
    status: "queued",
    trigger: input.trigger,
    budget: normalizeBackgroundJobBudget(input.budget),
    permissions: {
      allowedTools: uniqueStrings(input.allowedTools ?? []),
      allowedCapabilities: uniqueStrings(input.allowedCapabilities ?? []),
      riskLevel: input.riskLevel ?? "medium",
      requiresApproval: input.requiresApproval ?? true,
    },
    attempt: 1,
    maxAttempts: normalizeMaxAttempts(input.maxAttempts),
    createdAtMs: timestamp,
    updatedAtMs: timestamp,
    activeSubagentRunIds: [],
    policyEnvelopeRefs,
    evidenceRefIds,
    sourceRefs,
    failureTaxonomy: uniqueStrings(input.failureTaxonomy ?? []),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    events: [
      createBackgroundJobEvent({
        jobId: input.jobId,
        type: "created",
        occurredAtMs: timestamp,
        summary: "Background job created.",
        policyEnvelopeRefs,
        evidenceRefIds,
        sourceRefs,
      }),
    ],
  };

  return {
    record,
    queueInput: createBackgroundJobQueueInput(record),
  };
}

export function transitionConversationRuntimeBackgroundJob(
  record: ConversationRuntimeBackgroundJobRecord,
  transition: ConversationRuntimeBackgroundJobTransition,
): ConversationRuntimeBackgroundJobRecord {
  const timestamp = transition.occurredAtMs ?? Date.now();
  switch (transition.type) {
    case "start":
      return appendBackgroundJobEvent(
        {
          ...record,
          status: "running",
          updatedAtMs: timestamp,
          startedAtMs: record.startedAtMs ?? timestamp,
          ...(transition.workerId === undefined ? {} : { workerId: transition.workerId }),
        },
        {
          type: "started",
          occurredAtMs: timestamp,
          summary: "Background job started.",
          ...(transition.policyEnvelopeRefs === undefined
            ? {}
            : { policyEnvelopeRefs: transition.policyEnvelopeRefs }),
        },
      );
    case "pause":
      return appendBackgroundJobEvent(
        {
          ...record,
          status: "paused",
          updatedAtMs: timestamp,
          pausedAtMs: timestamp,
        },
        {
          type: "paused",
          occurredAtMs: timestamp,
          summary: transition.reason,
          ...(transition.policyEnvelopeRefs === undefined
            ? {}
            : { policyEnvelopeRefs: transition.policyEnvelopeRefs }),
          metadata: {
            requestedBy: transition.requestedBy,
          },
        },
      );
    case "resume":
      return appendBackgroundJobEvent(
        {
          ...record,
          status: "running",
          updatedAtMs: timestamp,
          ...(transition.workerId === undefined ? {} : { workerId: transition.workerId }),
        },
        {
          type: "resumed",
          occurredAtMs: timestamp,
          summary: "Background job resumed.",
          ...(transition.policyEnvelopeRefs === undefined
            ? {}
            : { policyEnvelopeRefs: transition.policyEnvelopeRefs }),
        },
      );
    case "delegate":
      return appendBackgroundJobEvent(
        {
          ...record,
          status: "running",
          updatedAtMs: timestamp,
          activeSubagentRunIds: uniqueStrings([
            ...record.activeSubagentRunIds,
            transition.subagentRunId,
          ]),
        },
        {
          type: "delegated",
          occurredAtMs: timestamp,
          summary: transition.summary ?? "Background job delegated subagent work.",
          ...(transition.policyEnvelopeRefs === undefined
            ? {}
            : { policyEnvelopeRefs: transition.policyEnvelopeRefs }),
          metadata: {
            subagentRunId: transition.subagentRunId,
          },
        },
      );
    case "retry":
      return appendBackgroundJobEvent(
        {
          ...record,
          status: "retry_scheduled",
          attempt: record.attempt + 1,
          updatedAtMs: timestamp,
          ...(transition.nextAttemptAtMs === undefined
            ? {}
            : { nextAttemptAtMs: transition.nextAttemptAtMs }),
          failureTaxonomy: uniqueStrings([
            ...record.failureTaxonomy,
            ...(transition.failureTaxonomy ?? []),
          ]),
        },
        {
          type: "retry_scheduled",
          occurredAtMs: timestamp,
          summary: transition.reason,
          ...(transition.policyEnvelopeRefs === undefined
            ? {}
            : { policyEnvelopeRefs: transition.policyEnvelopeRefs }),
          metadata: {
            attempt: record.attempt + 1,
            ...(transition.nextAttemptAtMs === undefined
              ? {}
              : { nextAttemptAtMs: transition.nextAttemptAtMs }),
          },
        },
      );
    case "complete":
      return appendBackgroundJobEvent(
        {
          ...record,
          status: "completed",
          updatedAtMs: timestamp,
          completedAtMs: timestamp,
          ...(transition.summary === undefined ? {} : { summary: transition.summary }),
          evidenceRefIds: uniqueStrings([
            ...record.evidenceRefIds,
            ...(transition.evidenceRefIds ?? []),
          ]),
          sourceRefs: uniqueStrings([...record.sourceRefs, ...(transition.sourceRefs ?? [])]),
        },
        {
          type: "completed",
          occurredAtMs: timestamp,
          summary: transition.summary ?? "Background job completed.",
          ...(transition.policyEnvelopeRefs === undefined
            ? {}
            : { policyEnvelopeRefs: transition.policyEnvelopeRefs }),
          ...(transition.evidenceRefIds === undefined
            ? {}
            : { evidenceRefIds: transition.evidenceRefIds }),
          ...(transition.sourceRefs === undefined ? {} : { sourceRefs: transition.sourceRefs }),
        },
      );
    case "fail":
      return appendBackgroundJobEvent(
        {
          ...record,
          status: "failed",
          updatedAtMs: timestamp,
          failedAtMs: timestamp,
          summary: transition.reason,
          failureTaxonomy: uniqueStrings([
            ...record.failureTaxonomy,
            ...(transition.failureTaxonomy ?? []),
          ]),
        },
        {
          type: "failed",
          occurredAtMs: timestamp,
          summary: transition.reason,
          ...(transition.policyEnvelopeRefs === undefined
            ? {}
            : { policyEnvelopeRefs: transition.policyEnvelopeRefs }),
        },
      );
    case "cancel":
      return appendBackgroundJobEvent(
        {
          ...record,
          status: "cancelled",
          updatedAtMs: timestamp,
          cancelledAtMs: timestamp,
          summary: transition.reason,
        },
        {
          type: "cancelled",
          occurredAtMs: timestamp,
          summary: transition.reason,
          ...(transition.policyEnvelopeRefs === undefined
            ? {}
            : { policyEnvelopeRefs: transition.policyEnvelopeRefs }),
          metadata: {
            requestedBy: transition.requestedBy,
          },
        },
      );
  }
}

export function recoverConversationRuntimeBackgroundJobs(
  records: readonly ConversationRuntimeBackgroundJobRecord[],
  options: RecoverConversationRuntimeBackgroundJobsOptions = {},
): readonly ConversationRuntimeBackgroundJobRecord[] {
  const timestamp = options.nowMs?.() ?? Date.now();
  return records.map((record) => {
    if (!isActiveConversationRuntimeBackgroundJobStatus(record.status)) {
      return record;
    }
    return appendBackgroundJobEvent(
      {
        ...record,
        status: "paused",
        updatedAtMs: timestamp,
        pausedAtMs: timestamp,
      },
      {
        type: "recovered",
        occurredAtMs: timestamp,
        summary: "Active background job was paused for safe recovery after runtime restart.",
        metadata: {
          reason: options.reason ?? "runtime restart",
          recoveredFromStatus: record.status,
        },
      },
    );
  });
}

export function isActiveConversationRuntimeBackgroundJobStatus(
  status: ConversationRuntimeBackgroundJobStatus,
): boolean {
  return status === "queued" || status === "running" || status === "retry_scheduled";
}

export function createConversationRuntimeBackgroundJobStore(
  initialRecords: readonly ConversationRuntimeBackgroundJobRecord[] = [],
): ConversationRuntimeBackgroundJobStore {
  const records = new Map<string, ConversationRuntimeBackgroundJobRecord>();
  for (const record of initialRecords) {
    records.set(record.jobId, cloneBackgroundJobRecord(record));
  }
  return {
    load: () => [...records.values()].map(cloneBackgroundJobRecord).sort(compareBackgroundJobs),
    upsert: (record) => {
      records.set(record.jobId, cloneBackgroundJobRecord(record));
    },
    read: (jobId) => {
      const record = records.get(jobId);
      return record === undefined ? undefined : cloneBackgroundJobRecord(record);
    },
  };
}

export function createFileConversationRuntimeBackgroundJobStore(
  options: FileConversationRuntimeBackgroundJobStoreOptions,
): ConversationRuntimeBackgroundJobStore {
  return new FileConversationRuntimeBackgroundJobStore(options.path);
}

export function createSQLiteConversationRuntimeBackgroundJobStore(
  options: SQLiteConversationRuntimeBackgroundJobStoreOptions,
): ConversationRuntimeBackgroundJobStore {
  return new SQLiteConversationRuntimeBackgroundJobStore(options.dbPath);
}

export function createConversationRuntimeBackgroundJobRecoveryPlan(
  records: readonly ConversationRuntimeBackgroundJobRecord[],
  options: CreateConversationRuntimeBackgroundJobRecoveryPlanOptions = {},
): ConversationRuntimeBackgroundJobRecoveryPlan {
  const actions = records
    .filter(isReviewableConversationRuntimeBackgroundJobStatus)
    .map(createBackgroundJobRecoveryAction);
  const recoverableCount = actions.filter((action) => action.action === "resume").length;
  return {
    schemaVersion: "conversation-runtime.background-job-recovery-plan.v1",
    createdAtMs: options.nowMs?.() ?? Date.now(),
    recoverableCount,
    blockedCount: actions.length - recoverableCount,
    actions,
  };
}

export async function runConversationRuntimeBackgroundJobWorkerLoop(
  input: RunConversationRuntimeBackgroundJobWorkerLoopInput,
): Promise<ConversationRuntimeBackgroundJobWorkerLoopReport> {
  const workerId = input.workerId ?? "conversation-runtime-background-worker";
  const maxClaims = normalizeMaxClaims(input.maxClaims);
  const jobIds: string[] = [];
  const errors: string[] = [];
  let completedCount = 0;
  let failedCount = 0;
  let retryScheduledCount = 0;

  for (let claimIndex = 0; claimIndex < maxClaims; claimIndex += 1) {
    const nowMs = input.nowMs?.() ?? Date.now();
    const ready = selectNextReadyBackgroundJob(input.store.load(), nowMs);
    if (ready === undefined) {
      return createBackgroundJobWorkerLoopReport({
        workerId,
        status: "stopped",
        stoppedReason: jobIds.length >= maxClaims ? "max-claims" : "no-ready-job",
        jobIds,
        completedCount,
        failedCount,
        retryScheduledCount,
        errors,
      });
    }

    const running = transitionConversationRuntimeBackgroundJob(ready, {
      type: "start",
      occurredAtMs: nowMs,
      workerId,
    });
    input.store.upsert(running);
    jobIds.push(running.jobId);

    try {
      const result = await input.executor(running, { workerId, nowMs });
      const transitioned = transitionBackgroundJobFromWorkerExecutorResult(running, result, nowMs);
      input.store.upsert(transitioned);
      if (transitioned.status === "completed") {
        completedCount += 1;
      } else if (transitioned.status === "failed") {
        failedCount += 1;
      } else if (transitioned.status === "retry_scheduled") {
        retryScheduledCount += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      const failed = transitionConversationRuntimeBackgroundJob(running, {
        type: "fail",
        occurredAtMs: nowMs,
        reason: `Background job worker executor failed: ${message}`,
        failureTaxonomy: ["executor-error"],
      });
      input.store.upsert(failed);
      failedCount += 1;
      return createBackgroundJobWorkerLoopReport({
        workerId,
        status: "failed",
        stoppedReason: "executor-error",
        jobIds,
        completedCount,
        failedCount,
        retryScheduledCount,
        errors,
      });
    }
  }

  return createBackgroundJobWorkerLoopReport({
    workerId,
    status: "stopped",
    stoppedReason: "max-claims",
    jobIds,
    completedCount,
    failedCount,
    retryScheduledCount,
    errors,
  });
}

export function createConversationRuntimeBackgroundJobTurnExecutor(
  options: CreateConversationRuntimeBackgroundJobTurnExecutorOptions,
): ConversationRuntimeBackgroundJobWorkerExecutor {
  return async (job, context) => {
    try {
      const turnContext: ConversationRuntimeBackgroundJobTurnExecutorContext = {
        ...context,
        job,
      };
      const result = await options.runTurn(
        createConversationRuntimeInputFromBackgroundJob(job, context, options),
        turnContext,
      );
      return (
        options.mapResult?.({ result, job, context }) ??
        mapBackgroundJobRuntimeTurnResult({
          result,
          job,
        })
      );
    } catch (error) {
      return (
        options.classifyError?.({ error, job, context }) ?? {
          status: "failed",
          reason: `Conversation runtime background turn failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          failureTaxonomy: ["runtime_exception"],
        }
      );
    }
  };
}

function isReviewableConversationRuntimeBackgroundJobStatus(
  record: ConversationRuntimeBackgroundJobRecord,
): boolean {
  return (
    record.status === "queued" || record.status === "paused" || record.status === "retry_scheduled"
  );
}

class FileConversationRuntimeBackgroundJobStore implements ConversationRuntimeBackgroundJobStore {
  public constructor(private readonly filePath: string) {}

  public load(): readonly ConversationRuntimeBackgroundJobRecord[] {
    return readBackgroundJobStoreDocument(this.filePath).jobs;
  }

  public upsert(record: ConversationRuntimeBackgroundJobRecord): void {
    const document = readBackgroundJobStoreDocument(this.filePath);
    const records = new Map<string, ConversationRuntimeBackgroundJobRecord>();
    for (const job of document.jobs) {
      records.set(job.jobId, job);
    }
    records.set(record.jobId, cloneBackgroundJobRecord(record));
    writeBackgroundJobStoreDocument(this.filePath, {
      schemaVersion: CONVERSATION_RUNTIME_BACKGROUND_JOB_STORE_SCHEMA_VERSION,
      jobs: [...records.values()].sort(compareBackgroundJobs),
    });
  }

  public read(jobId: string): ConversationRuntimeBackgroundJobRecord | undefined {
    return this.load().find((record) => record.jobId === jobId);
  }
}

class SQLiteConversationRuntimeBackgroundJobStore implements ConversationRuntimeBackgroundJobStore {
  private readonly db: DatabaseSync;

  public constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    configureBackgroundJobSQLiteStore(this.db);
  }

  public load(): readonly ConversationRuntimeBackgroundJobRecord[] {
    const rows = this.db
      .prepare(
        `SELECT record_json
         FROM conversation_runtime_background_jobs
         ORDER BY created_at_ms ASC, job_id ASC`,
      )
      .all() as Array<{ readonly record_json: string }>;
    return rows.flatMap((row) => {
      const record = parseJsonRecord(row.record_json, parseBackgroundJobRecord);
      return record === undefined ? [] : [record];
    });
  }

  public upsert(record: ConversationRuntimeBackgroundJobRecord): void {
    const cloned = cloneBackgroundJobRecord(record);
    this.db
      .prepare(
        `INSERT INTO conversation_runtime_background_jobs
         (job_id, created_at_ms, updated_at_ms, record_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET
           created_at_ms = excluded.created_at_ms,
           updated_at_ms = excluded.updated_at_ms,
           record_json = excluded.record_json`,
      )
      .run(cloned.jobId, cloned.createdAtMs, cloned.updatedAtMs, JSON.stringify(cloned));
  }

  public read(jobId: string): ConversationRuntimeBackgroundJobRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT record_json
         FROM conversation_runtime_background_jobs
         WHERE job_id = ?`,
      )
      .get(jobId) as { readonly record_json: string } | undefined;
    return row === undefined
      ? undefined
      : parseJsonRecord(row.record_json, parseBackgroundJobRecord);
  }
}

function createBackgroundJobRecoveryAction(
  record: ConversationRuntimeBackgroundJobRecord,
): ConversationRuntimeBackgroundJobRecoveryAction {
  const reason = resolveBackgroundJobRecoveryReason(record);
  return {
    jobId: record.jobId,
    sessionKey: record.sessionKey,
    title: record.title,
    action: reason === "paused_job_can_resume_after_operator_review" ? "resume" : "manual_review",
    reason,
    requiresOperatorApproval: true,
    budget: record.budget,
    allowedTools: [...record.permissions.allowedTools],
    policyEnvelopeRefs: [...record.policyEnvelopeRefs],
    evidenceRefIds: [...record.evidenceRefIds],
    sourceRefs: [...record.sourceRefs],
  };
}

function resolveBackgroundJobRecoveryReason(
  record: ConversationRuntimeBackgroundJobRecord,
): string {
  if (record.permissions.allowedTools.length === 0) {
    return "allowed_tools_missing";
  }
  if (record.attempt > record.maxAttempts) {
    return "retry_budget_exhausted";
  }
  return "paused_job_can_resume_after_operator_review";
}

function selectNextReadyBackgroundJob(
  records: readonly ConversationRuntimeBackgroundJobRecord[],
  nowMs: number,
): ConversationRuntimeBackgroundJobRecord | undefined {
  return records
    .filter((record) => isReadyBackgroundJob(record, nowMs))
    .sort(compareReadyBackgroundJobs)[0];
}

function isReadyBackgroundJob(
  record: ConversationRuntimeBackgroundJobRecord,
  nowMs: number,
): boolean {
  if (record.status === "queued") {
    return true;
  }
  return (
    record.status === "retry_scheduled" &&
    (record.nextAttemptAtMs === undefined || record.nextAttemptAtMs <= nowMs)
  );
}

function transitionBackgroundJobFromWorkerExecutorResult(
  record: ConversationRuntimeBackgroundJobRecord,
  result: ConversationRuntimeBackgroundJobWorkerExecutorResult,
  occurredAtMs: number,
): ConversationRuntimeBackgroundJobRecord {
  if (result.status === "completed") {
    return transitionConversationRuntimeBackgroundJob(record, {
      type: "complete",
      occurredAtMs,
      ...(result.summary === undefined ? {} : { summary: result.summary }),
      ...(result.evidenceRefIds === undefined ? {} : { evidenceRefIds: result.evidenceRefIds }),
      ...(result.sourceRefs === undefined ? {} : { sourceRefs: result.sourceRefs }),
      ...(result.policyEnvelopeRefs === undefined
        ? {}
        : { policyEnvelopeRefs: result.policyEnvelopeRefs }),
    });
  }
  if (result.status === "failed") {
    return transitionConversationRuntimeBackgroundJob(record, {
      type: "fail",
      occurredAtMs,
      reason: result.reason,
      ...(result.failureTaxonomy === undefined ? {} : { failureTaxonomy: result.failureTaxonomy }),
      ...(result.policyEnvelopeRefs === undefined
        ? {}
        : { policyEnvelopeRefs: result.policyEnvelopeRefs }),
    });
  }
  return transitionConversationRuntimeBackgroundJob(record, {
    type: "retry",
    occurredAtMs,
    reason: result.reason,
    ...(result.nextAttemptAtMs === undefined ? {} : { nextAttemptAtMs: result.nextAttemptAtMs }),
    ...(result.failureTaxonomy === undefined ? {} : { failureTaxonomy: result.failureTaxonomy }),
    ...(result.policyEnvelopeRefs === undefined
      ? {}
      : { policyEnvelopeRefs: result.policyEnvelopeRefs }),
  });
}

function createBackgroundJobWorkerLoopReport(input: {
  readonly workerId: string;
  readonly status: ConversationRuntimeBackgroundJobWorkerLoopStatus;
  readonly stoppedReason: ConversationRuntimeBackgroundJobWorkerLoopStoppedReason;
  readonly jobIds: readonly string[];
  readonly completedCount: number;
  readonly failedCount: number;
  readonly retryScheduledCount: number;
  readonly errors: readonly string[];
}): ConversationRuntimeBackgroundJobWorkerLoopReport {
  return {
    schemaVersion: "conversation-runtime.background-job-worker-loop.v1",
    workerId: input.workerId,
    status: input.status,
    stoppedReason: input.stoppedReason,
    claimedCount: input.jobIds.length,
    completedCount: input.completedCount,
    failedCount: input.failedCount,
    retryScheduledCount: input.retryScheduledCount,
    jobIds: [...input.jobIds],
    errors: [...input.errors],
  };
}

function createBackgroundJobQueueInput(
  record: ConversationRuntimeBackgroundJobRecord,
): ConversationRuntimeQueuedInput {
  return {
    id: `background-job:${record.jobId}`,
    sessionKey: record.sessionKey,
    value: record.objective,
    mode: "task-notification",
    priority: "later",
    origin: "task",
    isMeta: true,
    workload: "background",
    skipSlashCommands: true,
    createdAtMs: record.createdAtMs,
    metadata: {
      jobId: record.jobId,
      backgroundJob: true,
      title: record.title,
      allowedTools: [...record.permissions.allowedTools],
      allowedCapabilities: [...record.permissions.allowedCapabilities],
      policyEnvelopeRefs: [...record.policyEnvelopeRefs],
      budget: record.budget,
    },
  };
}

function createConversationRuntimeInputFromBackgroundJob(
  job: ConversationRuntimeBackgroundJobRecord,
  context: ConversationRuntimeBackgroundJobWorkerExecutorContext,
  options: CreateConversationRuntimeBackgroundJobTurnExecutorOptions,
): ConversationRuntimeInput {
  const metadata = createBackgroundJobRuntimeTurnMetadata(job, context, options.metadata);
  const angelRoleProfile = resolveBackgroundJobAngelRoleProfile(
    job,
    metadata,
    options.trustedContext,
  );
  return {
    surface: options.surface ?? "background",
    channel: options.channel ?? "background",
    messageId: `background-job:${job.jobId}`,
    sessionKey: job.sessionKey,
    text: job.objective,
    receivedAtMs: context.nowMs,
    queuePriority: "later",
    sender: {
      id: resolveBackgroundJobRuntimeTurnSenderId(job, context, options.senderId),
      role: "system",
    },
    trustedContext: {
      ...(options.trustedContext ?? {}),
      activeSessionKey: job.sessionKey,
      ...(angelRoleProfile === undefined ? {} : { angelRoleProfile }),
      metadata: {
        ...(options.trustedContext?.metadata ?? {}),
        ...metadata,
      },
    },
    metadata,
  };
}

function resolveBackgroundJobAngelRoleProfile(
  job: ConversationRuntimeBackgroundJobRecord,
  metadata: Readonly<Record<string, unknown>>,
  trustedContext: ConversationRuntimeTrustedContext | undefined,
): ConversationRuntimeAngelRoleProfile | undefined {
  if (trustedContext?.angelRoleProfile !== undefined) {
    return trustedContext.angelRoleProfile;
  }
  const explicitProfile = normalizeConversationRuntimeAngelRoleProfile(metadata.angelRoleProfile);
  if (explicitProfile !== undefined) {
    return explicitProfile;
  }
  if (metadata.scheduledLearning !== true) {
    return undefined;
  }
  const roleId = readNonEmptyBackgroundJobString(metadata.roleId);
  if (roleId === undefined) {
    return undefined;
  }
  return normalizeConversationRuntimeAngelRoleProfile({
    roleId,
    title: readNonEmptyBackgroundJobString(metadata.roleTitle),
    domain: readNonEmptyBackgroundJobString(metadata.roleDomain),
    learningScope: metadata.learningScope,
    controllableSystems: metadata.controllableSystems ?? [
      ...job.permissions.allowedCapabilities,
      ...job.permissions.allowedTools,
    ],
    metadata: {
      scheduledLearning: true,
      candidateOnly: metadata.candidateOnly,
      autoPublish: metadata.autoPublish,
      memorySync: metadata.memorySync,
      admissionMode: metadata.admissionMode,
    },
  });
}

function createBackgroundJobRuntimeTurnMetadata(
  job: ConversationRuntimeBackgroundJobRecord,
  context: ConversationRuntimeBackgroundJobWorkerExecutorContext,
  extraMetadata: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  return {
    ...(job.metadata ?? {}),
    ...(extraMetadata ?? {}),
    backgroundJob: true,
    jobId: job.jobId,
    workerId: context.workerId,
    title: job.title,
    trigger: job.trigger,
    allowedTools: [...job.permissions.allowedTools],
    allowedCapabilities: [...job.permissions.allowedCapabilities],
    riskLevel: job.permissions.riskLevel,
    requiresApproval: job.permissions.requiresApproval,
    budget: job.budget,
    policyEnvelopeRefs: [...job.policyEnvelopeRefs],
    evidenceRefIds: [...job.evidenceRefIds],
    sourceRefs: [...job.sourceRefs],
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
  };
}

function resolveBackgroundJobRuntimeTurnSenderId(
  job: ConversationRuntimeBackgroundJobRecord,
  context: ConversationRuntimeBackgroundJobWorkerExecutorContext,
  senderId: CreateConversationRuntimeBackgroundJobTurnExecutorOptions["senderId"],
): string {
  if (typeof senderId === "function") {
    return senderId({ ...context, job });
  }
  return senderId ?? `background-worker:${context.workerId}`;
}

function readNonEmptyBackgroundJobString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  return text.length === 0 ? undefined : text;
}

function mapBackgroundJobRuntimeTurnResult(input: {
  readonly result: ConversationRuntimeResult;
  readonly job: ConversationRuntimeBackgroundJobRecord;
}): ConversationRuntimeBackgroundJobWorkerExecutorResult {
  return {
    status: "completed",
    summary:
      input.result.userFacingProjection?.userText ??
      input.result.finalText ??
      "Conversation runtime background turn completed.",
    evidenceRefIds: uniqueStrings(
      input.result.memoryEvidenceRecords?.map((record) => record.id) ?? [],
    ),
    sourceRefs: uniqueStrings(
      input.result.memoryEvidenceRecords?.map((record) => record.sourceRef) ?? [],
    ),
    policyEnvelopeRefs: uniqueStrings(
      input.result.memoryEvidenceRecords?.flatMap((record) => record.policyEnvelopeRefs) ?? [],
    ),
  };
}

function readBackgroundJobStoreDocument(
  filePath: string,
): ConversationRuntimeBackgroundJobStoreDocument {
  if (!existsSync(filePath)) {
    return createEmptyBackgroundJobStoreDocument();
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return parseBackgroundJobStoreDocument(parsed);
  } catch {
    return createEmptyBackgroundJobStoreDocument();
  }
}

function writeBackgroundJobStoreDocument(
  filePath: string,
  document: ConversationRuntimeBackgroundJobStoreDocument,
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function configureBackgroundJobSQLiteStore(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_runtime_background_jobs (
    job_id TEXT PRIMARY KEY,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    record_json TEXT NOT NULL
  )`);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_conversation_runtime_background_jobs_created ON conversation_runtime_background_jobs(created_at_ms, job_id)",
  );
}

function parseJsonRecord<T>(raw: string, parser: (value: unknown) => T | undefined): T | undefined {
  try {
    return parser(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function parseBackgroundJobStoreDocument(
  value: unknown,
): ConversationRuntimeBackgroundJobStoreDocument {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CONVERSATION_RUNTIME_BACKGROUND_JOB_STORE_SCHEMA_VERSION
  ) {
    return createEmptyBackgroundJobStoreDocument();
  }
  if (!Array.isArray(value.jobs)) {
    return createEmptyBackgroundJobStoreDocument();
  }
  return {
    schemaVersion: CONVERSATION_RUNTIME_BACKGROUND_JOB_STORE_SCHEMA_VERSION,
    jobs: value.jobs.flatMap((job) => {
      const parsed = parseBackgroundJobRecord(job);
      return parsed === undefined ? [] : [parsed];
    }),
  };
}

function parseBackgroundJobRecord(
  value: unknown,
): ConversationRuntimeBackgroundJobRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    !isNonEmptyString(value.jobId) ||
    !isNonEmptyString(value.sessionKey) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.objective) ||
    !isBackgroundJobStatus(value.status) ||
    !isRecord(value.trigger) ||
    !isRecord(value.budget) ||
    !isRecord(value.permissions) ||
    !isFiniteNumber(value.attempt) ||
    !isFiniteNumber(value.maxAttempts) ||
    !isFiniteNumber(value.createdAtMs) ||
    !isFiniteNumber(value.updatedAtMs) ||
    !isStringArray(value.activeSubagentRunIds) ||
    !isStringArray(value.policyEnvelopeRefs) ||
    !isStringArray(value.evidenceRefIds) ||
    !isStringArray(value.sourceRefs) ||
    !isStringArray(value.failureTaxonomy) ||
    !Array.isArray(value.events)
  ) {
    return undefined;
  }
  const parsedEvents = value.events.flatMap((event) => {
    const parsed = parseBackgroundJobEvent(event);
    return parsed === undefined ? [] : [parsed];
  });
  return appendOptionalBackgroundJobRecordFields(
    {
      schemaVersion: "conversation-runtime.background-job.v1",
      jobId: value.jobId,
      sessionKey: value.sessionKey,
      title: value.title,
      objective: value.objective,
      status: value.status,
      trigger: value.trigger as ConversationRuntimeBackgroundJobTrigger,
      budget: normalizeBackgroundJobBudget(value.budget),
      permissions: parseBackgroundJobPermissions(value.permissions),
      attempt: value.attempt,
      maxAttempts: value.maxAttempts,
      createdAtMs: value.createdAtMs,
      updatedAtMs: value.updatedAtMs,
      activeSubagentRunIds: [...value.activeSubagentRunIds],
      policyEnvelopeRefs: [...value.policyEnvelopeRefs],
      evidenceRefIds: [...value.evidenceRefIds],
      sourceRefs: [...value.sourceRefs],
      failureTaxonomy: [...value.failureTaxonomy],
      events: parsedEvents,
    },
    value,
  );
}

function appendOptionalBackgroundJobRecordFields(
  record: ConversationRuntimeBackgroundJobRecord,
  value: Readonly<Record<string, unknown>>,
): ConversationRuntimeBackgroundJobRecord {
  return {
    ...record,
    ...(isFiniteNumber(value.startedAtMs) ? { startedAtMs: value.startedAtMs } : {}),
    ...(isFiniteNumber(value.pausedAtMs) ? { pausedAtMs: value.pausedAtMs } : {}),
    ...(isFiniteNumber(value.nextAttemptAtMs) ? { nextAttemptAtMs: value.nextAttemptAtMs } : {}),
    ...(isFiniteNumber(value.completedAtMs) ? { completedAtMs: value.completedAtMs } : {}),
    ...(isFiniteNumber(value.failedAtMs) ? { failedAtMs: value.failedAtMs } : {}),
    ...(isFiniteNumber(value.cancelledAtMs) ? { cancelledAtMs: value.cancelledAtMs } : {}),
    ...(isNonEmptyString(value.workerId) ? { workerId: value.workerId } : {}),
    ...(isNonEmptyString(value.summary) ? { summary: value.summary } : {}),
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function parseBackgroundJobPermissions(
  value: Readonly<Record<string, unknown>>,
): ConversationRuntimeBackgroundJobPermissions {
  return {
    allowedTools: isStringArray(value.allowedTools) ? [...value.allowedTools] : [],
    allowedCapabilities: isStringArray(value.allowedCapabilities)
      ? [...value.allowedCapabilities]
      : [],
    riskLevel: isToolRiskLevel(value.riskLevel) ? value.riskLevel : "medium",
    requiresApproval: typeof value.requiresApproval === "boolean" ? value.requiresApproval : true,
  };
}

function parseBackgroundJobEvent(
  value: unknown,
): ConversationRuntimeBackgroundJobEvent | undefined {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.type) ||
    !isFiniteNumber(value.occurredAtMs)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    type: value.type as ConversationRuntimeBackgroundJobEvent["type"],
    occurredAtMs: value.occurredAtMs,
    ...(isNonEmptyString(value.summary) ? { summary: value.summary } : {}),
    policyEnvelopeRefs: isStringArray(value.policyEnvelopeRefs)
      ? [...value.policyEnvelopeRefs]
      : [],
    evidenceRefIds: isStringArray(value.evidenceRefIds) ? [...value.evidenceRefIds] : [],
    sourceRefs: isStringArray(value.sourceRefs) ? [...value.sourceRefs] : [],
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function createEmptyBackgroundJobStoreDocument(): ConversationRuntimeBackgroundJobStoreDocument {
  return {
    schemaVersion: CONVERSATION_RUNTIME_BACKGROUND_JOB_STORE_SCHEMA_VERSION,
    jobs: [],
  };
}

function appendBackgroundJobEvent(
  record: ConversationRuntimeBackgroundJobRecord,
  event: Omit<
    ConversationRuntimeBackgroundJobEvent,
    "id" | "policyEnvelopeRefs" | "evidenceRefIds" | "sourceRefs"
  > & {
    readonly policyEnvelopeRefs?: readonly string[];
    readonly evidenceRefIds?: readonly string[];
    readonly sourceRefs?: readonly string[];
  },
): ConversationRuntimeBackgroundJobRecord {
  const policyEnvelopeRefs = uniqueStrings(event.policyEnvelopeRefs ?? []);
  const evidenceRefIds = uniqueStrings(event.evidenceRefIds ?? []);
  const sourceRefs = uniqueStrings(event.sourceRefs ?? []);
  const nextEvent = createBackgroundJobEvent({
    jobId: record.jobId,
    type: event.type,
    occurredAtMs: event.occurredAtMs,
    ...(event.summary === undefined ? {} : { summary: event.summary }),
    policyEnvelopeRefs,
    evidenceRefIds,
    sourceRefs,
    ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
  });
  return {
    ...record,
    policyEnvelopeRefs: uniqueStrings([...record.policyEnvelopeRefs, ...policyEnvelopeRefs]),
    evidenceRefIds: uniqueStrings([...record.evidenceRefIds, ...evidenceRefIds]),
    sourceRefs: uniqueStrings([...record.sourceRefs, ...sourceRefs]),
    events: [...record.events, nextEvent],
  };
}

function createBackgroundJobEvent(input: {
  readonly jobId: string;
  readonly type: ConversationRuntimeBackgroundJobEvent["type"];
  readonly occurredAtMs: number;
  readonly summary?: string;
  readonly policyEnvelopeRefs?: readonly string[];
  readonly evidenceRefIds?: readonly string[];
  readonly sourceRefs?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}): ConversationRuntimeBackgroundJobEvent {
  return {
    id: `${input.jobId}:${input.type}:${input.occurredAtMs}`,
    type: input.type,
    occurredAtMs: input.occurredAtMs,
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    policyEnvelopeRefs: uniqueStrings(input.policyEnvelopeRefs ?? []),
    evidenceRefIds: uniqueStrings(input.evidenceRefIds ?? []),
    sourceRefs: uniqueStrings(input.sourceRefs ?? []),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

function normalizeBackgroundJobBudget(
  budget: ConversationRuntimePolicyBudget | undefined,
): ConversationRuntimePolicyBudget {
  return {
    ...(budget?.tokenLimit === undefined ? {} : { tokenLimit: budget.tokenLimit }),
    ...(budget?.fileCountLimit === undefined ? {} : { fileCountLimit: budget.fileCountLimit }),
    ...(budget?.videoMinuteLimit === undefined
      ? {}
      : { videoMinuteLimit: budget.videoMinuteLimit }),
    ...(budget?.audioMinuteLimit === undefined
      ? {}
      : { audioMinuteLimit: budget.audioMinuteLimit }),
    ...(budget?.estimatedCostTier === undefined
      ? {}
      : { estimatedCostTier: budget.estimatedCostTier }),
    ...(budget?.estimatedCostUsd === undefined
      ? {}
      : { estimatedCostUsd: budget.estimatedCostUsd }),
  };
}

function isBackgroundJobStatus(value: unknown): value is ConversationRuntimeBackgroundJobStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "paused" ||
    value === "retry_scheduled" ||
    value === "completed" ||
    value === "cancelled" ||
    value === "failed"
  );
}

function isToolRiskLevel(value: unknown): value is ToolRiskLevel {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function normalizeMaxAttempts(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 3;
  }
  return Math.max(1, Math.trunc(value));
}

function normalizeMaxClaims(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.trunc(value));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function compareReadyBackgroundJobs(
  first: ConversationRuntimeBackgroundJobRecord,
  second: ConversationRuntimeBackgroundJobRecord,
): number {
  const firstReadyAtMs = first.status === "retry_scheduled" ? (first.nextAttemptAtMs ?? 0) : 0;
  const secondReadyAtMs = second.status === "retry_scheduled" ? (second.nextAttemptAtMs ?? 0) : 0;
  return (
    firstReadyAtMs - secondReadyAtMs ||
    first.createdAtMs - second.createdAtMs ||
    first.jobId.localeCompare(second.jobId)
  );
}

function compareBackgroundJobs(
  first: ConversationRuntimeBackgroundJobRecord,
  second: ConversationRuntimeBackgroundJobRecord,
): number {
  return first.createdAtMs - second.createdAtMs || first.jobId.localeCompare(second.jobId);
}

function cloneBackgroundJobRecord(
  record: ConversationRuntimeBackgroundJobRecord,
): ConversationRuntimeBackgroundJobRecord {
  return JSON.parse(JSON.stringify(record)) as ConversationRuntimeBackgroundJobRecord;
}
