import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Cron } from "croner";

import {
  type ConversationRuntimeBackgroundJobStore,
  type ConversationRuntimeBackgroundJobTask,
  createConversationRuntimeBackgroundJobTask,
} from "./background-job-runtime.js";
import type { ConversationRuntimePolicyBudget } from "./policy-envelope.js";
import type { ConversationRuntimeSessionQueue } from "./queue.js";

export type ConversationRuntimeBackgroundJobSchedule =
  | {
      readonly kind: "at";
      readonly at: string;
    }
  | {
      readonly kind: "every";
      readonly everyMs: number;
      readonly anchorMs?: number;
    }
  | {
      readonly kind: "cron";
      readonly expr: string;
      readonly tz?: string;
    };

export interface ConversationRuntimeBackgroundJobScheduleState {
  readonly nextRunAtMs?: number;
  readonly lastRunAtMs?: number;
  readonly lastJobId?: string;
  readonly paused?: boolean;
  readonly disabled?: boolean;
}

export interface ConversationRuntimeBackgroundJobScheduleDefinition {
  readonly scheduleId: string;
  readonly sessionKey: string;
  readonly title: string;
  readonly objective: string;
  readonly schedule: ConversationRuntimeBackgroundJobSchedule;
  readonly state?: ConversationRuntimeBackgroundJobScheduleState;
  readonly budget?: ConversationRuntimePolicyBudget;
  readonly allowedTools?: readonly string[];
  readonly allowedCapabilities?: readonly string[];
  readonly policyEnvelopeRefs?: readonly string[];
  readonly evidenceRefIds?: readonly string[];
  readonly sourceRefs?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeBackgroundJobScheduleStore {
  readonly load: () => readonly ConversationRuntimeBackgroundJobScheduleDefinition[];
  readonly upsert: (definition: ConversationRuntimeBackgroundJobScheduleDefinition) => void;
  readonly read: (
    scheduleId: string,
  ) => ConversationRuntimeBackgroundJobScheduleDefinition | undefined;
  readonly applyStatePatch: (patch: ConversationRuntimeBackgroundJobScheduleStatePatch) => void;
}

export const CONVERSATION_RUNTIME_BACKGROUND_JOB_SCHEDULE_STORE_SCHEMA_VERSION =
  "conversation-runtime.background-job-schedule-store.v1" as const;

export interface ConversationRuntimeBackgroundJobScheduleStoreDocument {
  readonly schemaVersion: typeof CONVERSATION_RUNTIME_BACKGROUND_JOB_SCHEDULE_STORE_SCHEMA_VERSION;
  readonly schedules: readonly ConversationRuntimeBackgroundJobScheduleDefinition[];
}

export interface FileConversationRuntimeBackgroundJobScheduleStoreOptions {
  readonly path: string;
}

export interface SQLiteConversationRuntimeBackgroundJobScheduleStoreOptions {
  readonly dbPath: string;
}

export type ConversationRuntimeBackgroundJobSchedulerBlockedReason =
  | "schedule_paused"
  | "schedule_disabled"
  | "not_due"
  | "allowed_tools_missing"
  | "invalid_schedule";

export interface ConversationRuntimeBackgroundJobSchedulerBlockedSchedule {
  readonly scheduleId: string;
  readonly reason: ConversationRuntimeBackgroundJobSchedulerBlockedReason;
  readonly nextRunAtMs?: number;
}

export interface ConversationRuntimeBackgroundJobSchedulerDispatchIntent {
  readonly intentId: string;
  readonly scheduleId: string;
  readonly command: "enqueue-background-job";
  readonly scheduledForMs: number;
  readonly nextRunAtMs?: number;
  readonly job: ConversationRuntimeBackgroundJobTask;
}

export interface ConversationRuntimeBackgroundJobSchedulerTick {
  readonly schemaVersion: "conversation-runtime.background-job-scheduler-tick.v1";
  readonly nowMs: number;
  readonly claimDryRun: true;
  readonly dueCount: number;
  readonly dispatchedCount: number;
  readonly maxDispatches: number;
  readonly nextRunAtMs?: number;
  readonly dispatchIntents: readonly ConversationRuntimeBackgroundJobSchedulerDispatchIntent[];
  readonly blockedSchedules: readonly ConversationRuntimeBackgroundJobSchedulerBlockedSchedule[];
  readonly skippedScheduleIds: readonly string[];
}

export interface CreateConversationRuntimeBackgroundJobSchedulerTickInput {
  readonly nowMs?: number;
  readonly schedules: readonly ConversationRuntimeBackgroundJobScheduleDefinition[];
  readonly maxDispatches?: number;
}

export interface ApplyConversationRuntimeBackgroundJobSchedulerTickInput {
  readonly tick: ConversationRuntimeBackgroundJobSchedulerTick;
  readonly store: ConversationRuntimeBackgroundJobStore;
  readonly queue: ConversationRuntimeSessionQueue;
}

export interface RunConversationRuntimeBackgroundJobSchedulerStepInput {
  readonly scheduleStore: ConversationRuntimeBackgroundJobScheduleStore;
  readonly backgroundJobStore: ConversationRuntimeBackgroundJobStore;
  readonly queue: ConversationRuntimeSessionQueue;
  readonly nowMs?: () => number;
  readonly maxDispatches?: number;
}

export interface ConversationRuntimeBackgroundJobSchedulerDaemonInput
  extends RunConversationRuntimeBackgroundJobSchedulerStepInput {
  readonly minDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly onReport?: (report: ConversationRuntimeBackgroundJobSchedulerStepReport) => void;
  readonly onError?: (error: unknown) => void;
}

export interface ConversationRuntimeBackgroundJobSchedulerDaemon {
  readonly start: () => void;
  readonly stop: () => void;
  readonly isRunning: () => boolean;
}

export type ConversationRuntimeBackgroundJobSchedulerStepStatus = "ok" | "idle";

export interface ConversationRuntimeBackgroundJobSchedulerStepReport {
  readonly schemaVersion: "conversation-runtime.background-job-scheduler-step.v1";
  readonly status: ConversationRuntimeBackgroundJobSchedulerStepStatus;
  readonly nowMs: number;
  readonly maxDispatches: number;
  readonly dueCount: number;
  readonly dispatchedCount: number;
  readonly blockedCount: number;
  readonly skippedCount: number;
  readonly appliedScheduleStatePatchCount: number;
  readonly nextRunAtMs?: number;
  readonly tick: ConversationRuntimeBackgroundJobSchedulerTick;
  readonly applyReport: ConversationRuntimeBackgroundJobSchedulerApplyReport;
}

export interface ConversationRuntimeBackgroundJobSchedulerApplyReport {
  readonly schemaVersion: "conversation-runtime.background-job-scheduler-apply-report.v1";
  readonly appliedCount: number;
  readonly enqueuedCount: number;
  readonly upsertedJobIds: readonly string[];
  readonly queueIds: readonly string[];
  readonly scheduleStatePatches: readonly ConversationRuntimeBackgroundJobScheduleStatePatch[];
}

export interface ConversationRuntimeBackgroundJobScheduleStatePatch {
  readonly scheduleId: string;
  readonly lastRunAtMs: number;
  readonly lastJobId: string;
  readonly nextRunAtMs?: number;
}

export type ConversationRuntimeBackgroundJobSchedulerDeliveryMode =
  | "queue"
  | "direct-execute"
  | (string & {});

export type ConversationRuntimeBackgroundJobSchedulerHardeningStatus = "ready" | "blocked";

export interface ConversationRuntimeBackgroundJobSchedulerTickLockEvidence {
  readonly lockId: string;
  readonly ownerId: string;
  readonly acquired: boolean;
  readonly expiresAtMs?: number;
}

export interface ConversationRuntimeBackgroundJobSchedulerHardeningInput {
  readonly tick: ConversationRuntimeBackgroundJobSchedulerTick;
  readonly tickLock?: ConversationRuntimeBackgroundJobSchedulerTickLockEvidence;
  readonly advanceScheduleStateBeforeDelivery?: boolean;
  readonly deliveryMode?: ConversationRuntimeBackgroundJobSchedulerDeliveryMode;
  readonly allowedScriptRoots?: readonly string[];
}

export interface ConversationRuntimeBackgroundJobSchedulerPromptInjectionRisk {
  readonly status: "passed" | "blocked";
  readonly reasons: readonly string[];
}

export interface ConversationRuntimeBackgroundJobSchedulerScriptContainment {
  readonly status: "not_applicable" | "passed" | "blocked";
  readonly scriptPath?: string;
  readonly allowedRoots: readonly string[];
}

export interface ConversationRuntimeBackgroundJobSchedulerIntentHardeningReview {
  readonly intentId: string;
  readonly scheduleId: string;
  readonly status: ConversationRuntimeBackgroundJobSchedulerHardeningStatus;
  readonly promptInjectionRisk: ConversationRuntimeBackgroundJobSchedulerPromptInjectionRisk;
  readonly scriptContainment: ConversationRuntimeBackgroundJobSchedulerScriptContainment;
  readonly reasonCodes: readonly string[];
}

export interface ConversationRuntimeBackgroundJobSchedulerHardeningPlan {
  readonly schemaVersion: "conversation-runtime.background-job-scheduler-hardening-plan.v1";
  readonly status: ConversationRuntimeBackgroundJobSchedulerHardeningStatus;
  readonly canApply: boolean;
  readonly tickId: string;
  readonly nowMs: number;
  readonly maxDispatches: number;
  readonly lock: {
    readonly required: true;
    readonly acquired: boolean;
    readonly lockId?: string;
    readonly ownerId?: string;
    readonly expiresAtMs?: number;
  };
  readonly advance: {
    readonly requiredBeforeDelivery: true;
    readonly ready: boolean;
    readonly patchCount: number;
  };
  readonly delivery: {
    readonly mode: ConversationRuntimeBackgroundJobSchedulerDeliveryMode;
    readonly ready: boolean;
    readonly fallback: "none" | "queue";
  };
  readonly intentReviews: readonly ConversationRuntimeBackgroundJobSchedulerIntentHardeningReview[];
  readonly blockedIntentIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly nextActions: readonly string[];
}

const CRON_EVAL_CACHE_MAX = 512;
const cronEvalCache = new Map<string, Cron>();

export function createConversationRuntimeBackgroundJobScheduleStore(
  initialSchedules: readonly ConversationRuntimeBackgroundJobScheduleDefinition[] = [],
): ConversationRuntimeBackgroundJobScheduleStore {
  const schedules = new Map<string, ConversationRuntimeBackgroundJobScheduleDefinition>();
  for (const schedule of initialSchedules) {
    schedules.set(schedule.scheduleId, cloneScheduleDefinition(schedule));
  }

  return {
    load: () => [...schedules.values()].map(cloneScheduleDefinition).sort(compareSchedules),
    upsert: (definition) => {
      schedules.set(definition.scheduleId, cloneScheduleDefinition(definition));
    },
    read: (scheduleId) => {
      const definition = schedules.get(scheduleId);
      return definition === undefined ? undefined : cloneScheduleDefinition(definition);
    },
    applyStatePatch: (patch) => {
      const definition = schedules.get(patch.scheduleId);
      if (definition === undefined) {
        return;
      }
      schedules.set(patch.scheduleId, {
        ...definition,
        state: {
          ...(definition.state ?? {}),
          lastRunAtMs: patch.lastRunAtMs,
          lastJobId: patch.lastJobId,
          ...(patch.nextRunAtMs === undefined ? {} : { nextRunAtMs: patch.nextRunAtMs }),
        },
      });
    },
  };
}

export function createFileConversationRuntimeBackgroundJobScheduleStore(
  options: FileConversationRuntimeBackgroundJobScheduleStoreOptions,
): ConversationRuntimeBackgroundJobScheduleStore {
  return new FileConversationRuntimeBackgroundJobScheduleStore(options.path);
}

export function createSQLiteConversationRuntimeBackgroundJobScheduleStore(
  options: SQLiteConversationRuntimeBackgroundJobScheduleStoreOptions,
): ConversationRuntimeBackgroundJobScheduleStore {
  return new SQLiteConversationRuntimeBackgroundJobScheduleStore(options.dbPath);
}

export function computeNextConversationRuntimeBackgroundJobRunAtMs(
  schedule: ConversationRuntimeBackgroundJobSchedule,
  nowMs: number,
): number | undefined {
  if (schedule.kind === "at") {
    const atMs = parseAbsoluteTimeMs(schedule.at);
    return atMs !== undefined && atMs > nowMs ? atMs : undefined;
  }

  if (schedule.kind === "every") {
    const everyMs = coercePositiveInteger(schedule.everyMs);
    if (everyMs === undefined) {
      return undefined;
    }
    const anchorMs = coerceNonNegativeInteger(schedule.anchorMs) ?? nowMs;
    if (nowMs < anchorMs) {
      return anchorMs;
    }
    const elapsedMs = nowMs - anchorMs;
    const steps = Math.floor(elapsedMs / everyMs) + 1;
    return anchorMs + steps * everyMs;
  }

  const cron = resolveCachedCron(schedule.expr, schedule.tz);
  const next = cron.nextRun(new Date(nowMs));
  if (next === null) {
    return undefined;
  }
  const nextMs = next.getTime();
  if (!Number.isFinite(nextMs)) {
    return undefined;
  }
  if (nextMs > nowMs) {
    return nextMs;
  }

  const nextSecondMs = Math.floor(nowMs / 1000) * 1000 + 1000;
  const retry = cron.nextRun(new Date(nextSecondMs));
  if (retry !== null) {
    const retryMs = retry.getTime();
    if (Number.isFinite(retryMs) && retryMs > nowMs) {
      return retryMs;
    }
  }

  const tomorrowMs = new Date(nowMs).setUTCHours(24, 0, 0, 0);
  const retryTomorrow = cron.nextRun(new Date(tomorrowMs));
  if (retryTomorrow === null) {
    return undefined;
  }
  const retryTomorrowMs = retryTomorrow.getTime();
  return Number.isFinite(retryTomorrowMs) && retryTomorrowMs > nowMs ? retryTomorrowMs : undefined;
}

export function createConversationRuntimeBackgroundJobSchedulerTick(
  input: CreateConversationRuntimeBackgroundJobSchedulerTickInput,
): ConversationRuntimeBackgroundJobSchedulerTick {
  const nowMs = input.nowMs ?? Date.now();
  const maxDispatches = normalizeMaxDispatches(input.maxDispatches);
  const blockedSchedules: ConversationRuntimeBackgroundJobSchedulerBlockedSchedule[] = [];
  const dueSchedules: Array<{
    readonly definition: ConversationRuntimeBackgroundJobScheduleDefinition;
    readonly scheduledForMs: number;
    readonly nextRunAtMs?: number;
  }> = [];
  const futureRunTimes: number[] = [];

  for (const definition of input.schedules) {
    if (definition.state?.disabled === true) {
      blockedSchedules.push({ scheduleId: definition.scheduleId, reason: "schedule_disabled" });
      continue;
    }
    if (definition.state?.paused === true) {
      blockedSchedules.push({ scheduleId: definition.scheduleId, reason: "schedule_paused" });
      continue;
    }

    const scheduledForMs = definition.state?.nextRunAtMs;
    const nextRunAtMs = safelyComputeNextRunAtMs(definition.schedule, nowMs);
    if (nextRunAtMs !== undefined) {
      futureRunTimes.push(nextRunAtMs);
    }
    if (scheduledForMs === undefined) {
      if (nextRunAtMs === undefined) {
        blockedSchedules.push({ scheduleId: definition.scheduleId, reason: "invalid_schedule" });
      }
      continue;
    }
    if (scheduledForMs > nowMs) {
      futureRunTimes.push(scheduledForMs);
      continue;
    }
    if ((definition.allowedTools ?? []).length === 0) {
      blockedSchedules.push({
        scheduleId: definition.scheduleId,
        reason: "allowed_tools_missing",
        ...(nextRunAtMs === undefined ? {} : { nextRunAtMs }),
      });
      continue;
    }
    dueSchedules.push({
      definition,
      scheduledForMs,
      ...(nextRunAtMs === undefined ? {} : { nextRunAtMs }),
    });
  }

  const selectedSchedules = dueSchedules.slice(0, maxDispatches);
  const skippedScheduleIds = dueSchedules
    .slice(maxDispatches)
    .map((entry) => entry.definition.scheduleId);
  const dispatchIntents = selectedSchedules.map((entry) => createDispatchIntent(entry, nowMs));
  const selectedNextRunTimes = selectedSchedules.flatMap((entry) =>
    entry.nextRunAtMs === undefined ? [] : [entry.nextRunAtMs],
  );

  return {
    schemaVersion: "conversation-runtime.background-job-scheduler-tick.v1",
    nowMs,
    claimDryRun: true,
    dueCount:
      dueSchedules.length +
      blockedSchedules.filter((entry) => entry.reason === "allowed_tools_missing").length,
    dispatchedCount: dispatchIntents.length,
    maxDispatches,
    ...resolveNextSchedulerWakeMs([...futureRunTimes, ...selectedNextRunTimes]),
    dispatchIntents,
    blockedSchedules,
    skippedScheduleIds,
  };
}

export function applyConversationRuntimeBackgroundJobSchedulerTick(
  input: ApplyConversationRuntimeBackgroundJobSchedulerTickInput,
): ConversationRuntimeBackgroundJobSchedulerApplyReport {
  const upsertedJobIds: string[] = [];
  const queueIds: string[] = [];
  const scheduleStatePatches: ConversationRuntimeBackgroundJobScheduleStatePatch[] = [];

  for (const intent of input.tick.dispatchIntents) {
    input.store.upsert(intent.job.record);
    input.queue.enqueue({
      ...intent.job.queueInput,
      metadata: {
        ...(intent.job.queueInput.metadata ?? {}),
        scheduleId: intent.scheduleId,
        schedulerIntentId: intent.intentId,
        scheduledForMs: intent.scheduledForMs,
        ...(intent.nextRunAtMs === undefined ? {} : { nextRunAtMs: intent.nextRunAtMs }),
      },
    });
    upsertedJobIds.push(intent.job.record.jobId);
    queueIds.push(intent.job.queueInput.id);
    scheduleStatePatches.push({
      scheduleId: intent.scheduleId,
      lastRunAtMs: intent.scheduledForMs,
      lastJobId: intent.job.record.jobId,
      ...(intent.nextRunAtMs === undefined ? {} : { nextRunAtMs: intent.nextRunAtMs }),
    });
  }

  return {
    schemaVersion: "conversation-runtime.background-job-scheduler-apply-report.v1",
    appliedCount: input.tick.dispatchIntents.length,
    enqueuedCount: queueIds.length,
    upsertedJobIds,
    queueIds,
    scheduleStatePatches,
  };
}

export function planConversationRuntimeBackgroundJobSchedulerHardening(
  input: ConversationRuntimeBackgroundJobSchedulerHardeningInput,
): ConversationRuntimeBackgroundJobSchedulerHardeningPlan {
  const deliveryMode = input.deliveryMode ?? "queue";
  const lock = createBackgroundJobSchedulerHardeningLock(input.tickLock);
  const advanceReady = input.advanceScheduleStateBeforeDelivery === true;
  const deliveryReady = deliveryMode === "queue";
  const intentReviews = input.tick.dispatchIntents.map((intent) =>
    createBackgroundJobSchedulerIntentHardeningReview({
      intent,
      allowedScriptRoots: input.allowedScriptRoots ?? [],
    }),
  );
  const blockedIntentIds = intentReviews
    .filter((review) => review.status === "blocked")
    .map((review) => review.intentId);
  const reasonCodes = createBackgroundJobSchedulerHardeningReasonCodes({
    lockAcquired: lock.acquired,
    advanceReady,
    deliveryReady,
    intentReviews,
  });
  const status =
    lock.acquired && advanceReady && deliveryReady && blockedIntentIds.length === 0
      ? "ready"
      : "blocked";
  return {
    schemaVersion: "conversation-runtime.background-job-scheduler-hardening-plan.v1",
    status,
    canApply: status === "ready",
    tickId: `background-scheduler-tick:${input.tick.nowMs}:${input.tick.dispatchIntents.length}`,
    nowMs: input.tick.nowMs,
    maxDispatches: input.tick.maxDispatches,
    lock,
    advance: {
      requiredBeforeDelivery: true,
      ready: advanceReady,
      patchCount: input.tick.dispatchIntents.length,
    },
    delivery: {
      mode: deliveryMode,
      ready: deliveryReady,
      fallback: deliveryReady ? "none" : "queue",
    },
    intentReviews,
    blockedIntentIds,
    reasonCodes,
    nextActions: createBackgroundJobSchedulerHardeningNextActions({
      lockAcquired: lock.acquired,
      advanceReady,
      deliveryReady,
      blockedIntentIds,
    }),
  };
}

export function runConversationRuntimeBackgroundJobSchedulerStep(
  input: RunConversationRuntimeBackgroundJobSchedulerStepInput,
): ConversationRuntimeBackgroundJobSchedulerStepReport {
  const nowMs = input.nowMs?.() ?? Date.now();
  const maxDispatches = normalizeMaxDispatches(input.maxDispatches);
  const tick = createConversationRuntimeBackgroundJobSchedulerTick({
    nowMs,
    maxDispatches,
    schedules: input.scheduleStore.load(),
  });
  const applyReport = applyConversationRuntimeBackgroundJobSchedulerTick({
    tick,
    store: input.backgroundJobStore,
    queue: input.queue,
  });
  for (const patch of applyReport.scheduleStatePatches) {
    input.scheduleStore.applyStatePatch(patch);
  }

  return {
    schemaVersion: "conversation-runtime.background-job-scheduler-step.v1",
    status: tick.dispatchedCount > 0 ? "ok" : "idle",
    nowMs,
    maxDispatches,
    dueCount: tick.dueCount,
    dispatchedCount: tick.dispatchedCount,
    blockedCount: tick.blockedSchedules.length,
    skippedCount: tick.skippedScheduleIds.length,
    appliedScheduleStatePatchCount: applyReport.scheduleStatePatches.length,
    ...(tick.nextRunAtMs === undefined ? {} : { nextRunAtMs: tick.nextRunAtMs }),
    tick,
    applyReport,
  };
}

export function createConversationRuntimeBackgroundJobSchedulerDaemon(
  input: ConversationRuntimeBackgroundJobSchedulerDaemonInput,
): ConversationRuntimeBackgroundJobSchedulerDaemon {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  const clear = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const scheduleNext = (report: ConversationRuntimeBackgroundJobSchedulerStepReport): void => {
    if (!running) {
      return;
    }
    const delayMs = resolveSchedulerDaemonDelayMs({
      nowMs: report.nowMs,
      ...(report.nextRunAtMs === undefined ? {} : { nextRunAtMs: report.nextRunAtMs }),
      ...(input.minDelayMs === undefined ? {} : { minDelayMs: input.minDelayMs }),
      ...(input.maxDelayMs === undefined ? {} : { maxDelayMs: input.maxDelayMs }),
    });
    timer = setTimeout(runStep, delayMs);
  };

  const runStep = (): void => {
    if (!running) {
      return;
    }
    clear();
    try {
      const report = runConversationRuntimeBackgroundJobSchedulerStep(input);
      input.onReport?.(report);
      scheduleNext(report);
    } catch (error) {
      input.onError?.(error);
      if (running) {
        timer = setTimeout(
          runStep,
          resolveSchedulerDaemonDelayMs({
            nowMs: input.nowMs?.() ?? Date.now(),
            ...(input.minDelayMs === undefined ? {} : { minDelayMs: input.minDelayMs }),
            ...(input.maxDelayMs === undefined ? {} : { maxDelayMs: input.maxDelayMs }),
          }),
        );
      }
    }
  };

  return {
    start() {
      if (running) {
        return;
      }
      running = true;
      timer = setTimeout(runStep, 0);
    },
    stop() {
      running = false;
      clear();
    },
    isRunning() {
      return running;
    },
  };
}

class FileConversationRuntimeBackgroundJobScheduleStore
  implements ConversationRuntimeBackgroundJobScheduleStore
{
  public constructor(private readonly filePath: string) {}

  public load(): readonly ConversationRuntimeBackgroundJobScheduleDefinition[] {
    return readScheduleStoreDocument(this.filePath).schedules;
  }

  public upsert(definition: ConversationRuntimeBackgroundJobScheduleDefinition): void {
    const document = readScheduleStoreDocument(this.filePath);
    const schedules = new Map<string, ConversationRuntimeBackgroundJobScheduleDefinition>();
    for (const schedule of document.schedules) {
      schedules.set(schedule.scheduleId, schedule);
    }
    schedules.set(definition.scheduleId, cloneScheduleDefinition(definition));
    writeScheduleStoreDocument(this.filePath, {
      schemaVersion: CONVERSATION_RUNTIME_BACKGROUND_JOB_SCHEDULE_STORE_SCHEMA_VERSION,
      schedules: [...schedules.values()].sort(compareSchedules),
    });
  }

  public read(scheduleId: string): ConversationRuntimeBackgroundJobScheduleDefinition | undefined {
    return this.load().find((definition) => definition.scheduleId === scheduleId);
  }

  public applyStatePatch(patch: ConversationRuntimeBackgroundJobScheduleStatePatch): void {
    const document = readScheduleStoreDocument(this.filePath);
    const schedules = document.schedules.map((definition) =>
      definition.scheduleId === patch.scheduleId
        ? applyScheduleStatePatchToDefinition(definition, patch)
        : definition,
    );
    writeScheduleStoreDocument(this.filePath, {
      schemaVersion: CONVERSATION_RUNTIME_BACKGROUND_JOB_SCHEDULE_STORE_SCHEMA_VERSION,
      schedules: schedules.sort(compareSchedules),
    });
  }
}

class SQLiteConversationRuntimeBackgroundJobScheduleStore
  implements ConversationRuntimeBackgroundJobScheduleStore
{
  private readonly db: DatabaseSync;

  public constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    configureScheduleSQLiteStore(this.db);
  }

  public load(): readonly ConversationRuntimeBackgroundJobScheduleDefinition[] {
    const rows = this.db
      .prepare(
        `SELECT definition_json
         FROM conversation_runtime_background_job_schedules
         ORDER BY next_run_at_ms IS NULL, next_run_at_ms ASC, schedule_id ASC`,
      )
      .all() as Array<{ readonly definition_json: string }>;
    return rows
      .flatMap((row) => {
        const definition = parseJsonRecord(row.definition_json, parseScheduleDefinition);
        return definition === undefined ? [] : [definition];
      })
      .sort(compareSchedules);
  }

  public upsert(definition: ConversationRuntimeBackgroundJobScheduleDefinition): void {
    const cloned = cloneScheduleDefinition(definition);
    this.db
      .prepare(
        `INSERT INTO conversation_runtime_background_job_schedules
         (schedule_id, next_run_at_ms, definition_json)
         VALUES (?, ?, ?)
         ON CONFLICT(schedule_id) DO UPDATE SET
           next_run_at_ms = excluded.next_run_at_ms,
           definition_json = excluded.definition_json`,
      )
      .run(cloned.scheduleId, cloned.state?.nextRunAtMs ?? null, JSON.stringify(cloned));
  }

  public read(scheduleId: string): ConversationRuntimeBackgroundJobScheduleDefinition | undefined {
    const row = this.db
      .prepare(
        `SELECT definition_json
         FROM conversation_runtime_background_job_schedules
         WHERE schedule_id = ?`,
      )
      .get(scheduleId) as { readonly definition_json: string } | undefined;
    return row === undefined
      ? undefined
      : parseJsonRecord(row.definition_json, parseScheduleDefinition);
  }

  public applyStatePatch(patch: ConversationRuntimeBackgroundJobScheduleStatePatch): void {
    const definition = this.read(patch.scheduleId);
    if (definition === undefined) {
      return;
    }
    this.upsert(applyScheduleStatePatchToDefinition(definition, patch));
  }
}

function readScheduleStoreDocument(
  filePath: string,
): ConversationRuntimeBackgroundJobScheduleStoreDocument {
  if (!existsSync(filePath)) {
    return createEmptyScheduleStoreDocument();
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return parseScheduleStoreDocument(parsed);
  } catch {
    return createEmptyScheduleStoreDocument();
  }
}

function writeScheduleStoreDocument(
  filePath: string,
  document: ConversationRuntimeBackgroundJobScheduleStoreDocument,
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function configureScheduleSQLiteStore(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_runtime_background_job_schedules (
    schedule_id TEXT PRIMARY KEY,
    next_run_at_ms INTEGER,
    definition_json TEXT NOT NULL
  )`);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_conversation_runtime_background_job_schedules_next_run ON conversation_runtime_background_job_schedules(next_run_at_ms, schedule_id)",
  );
}

function parseJsonRecord<T>(raw: string, parser: (value: unknown) => T | undefined): T | undefined {
  try {
    return parser(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function parseScheduleStoreDocument(
  value: unknown,
): ConversationRuntimeBackgroundJobScheduleStoreDocument {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CONVERSATION_RUNTIME_BACKGROUND_JOB_SCHEDULE_STORE_SCHEMA_VERSION ||
    !Array.isArray(value.schedules)
  ) {
    return createEmptyScheduleStoreDocument();
  }

  return {
    schemaVersion: CONVERSATION_RUNTIME_BACKGROUND_JOB_SCHEDULE_STORE_SCHEMA_VERSION,
    schedules: value.schedules
      .flatMap((schedule) => {
        const parsed = parseScheduleDefinition(schedule);
        return parsed === undefined ? [] : [parsed];
      })
      .sort(compareSchedules),
  };
}

function parseScheduleDefinition(
  value: unknown,
): ConversationRuntimeBackgroundJobScheduleDefinition | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const schedule = parseSchedule(value.schedule);
  if (
    !isNonEmptyString(value.scheduleId) ||
    !isNonEmptyString(value.sessionKey) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.objective) ||
    schedule === undefined
  ) {
    return undefined;
  }

  return {
    scheduleId: value.scheduleId,
    sessionKey: value.sessionKey,
    title: value.title,
    objective: value.objective,
    schedule,
    ...optionalScheduleDefinitionFields(value),
  };
}

function optionalScheduleDefinitionFields(
  value: Readonly<Record<string, unknown>>,
): Omit<
  ConversationRuntimeBackgroundJobScheduleDefinition,
  "scheduleId" | "sessionKey" | "title" | "objective" | "schedule"
> {
  const state = parseScheduleState(value.state);
  const budget = parsePolicyBudget(value.budget);
  return {
    ...(state === undefined ? {} : { state }),
    ...(budget === undefined ? {} : { budget }),
    ...optionalStringArrayField("allowedTools", value.allowedTools),
    ...optionalStringArrayField("allowedCapabilities", value.allowedCapabilities),
    ...optionalStringArrayField("policyEnvelopeRefs", value.policyEnvelopeRefs),
    ...optionalStringArrayField("evidenceRefIds", value.evidenceRefIds),
    ...optionalStringArrayField("sourceRefs", value.sourceRefs),
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function parseSchedule(value: unknown): ConversationRuntimeBackgroundJobSchedule | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.kind === "at" && isNonEmptyString(value.at)) {
    return { kind: "at", at: value.at };
  }
  if (value.kind === "every" && isFiniteNumber(value.everyMs)) {
    return {
      kind: "every",
      everyMs: value.everyMs,
      ...(isFiniteNumber(value.anchorMs) ? { anchorMs: value.anchorMs } : {}),
    };
  }
  if (value.kind === "cron" && isNonEmptyString(value.expr)) {
    return {
      kind: "cron",
      expr: value.expr,
      ...(isNonEmptyString(value.tz) ? { tz: value.tz } : {}),
    };
  }
  return undefined;
}

function parseScheduleState(
  value: unknown,
): ConversationRuntimeBackgroundJobScheduleState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const state: ConversationRuntimeBackgroundJobScheduleState = {
    ...(isFiniteNumber(value.nextRunAtMs) ? { nextRunAtMs: value.nextRunAtMs } : {}),
    ...(isFiniteNumber(value.lastRunAtMs) ? { lastRunAtMs: value.lastRunAtMs } : {}),
    ...(isNonEmptyString(value.lastJobId) ? { lastJobId: value.lastJobId } : {}),
    ...(typeof value.paused === "boolean" ? { paused: value.paused } : {}),
    ...(typeof value.disabled === "boolean" ? { disabled: value.disabled } : {}),
  };
  return Object.keys(state).length === 0 ? undefined : state;
}

function parsePolicyBudget(value: unknown): ConversationRuntimePolicyBudget | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const budget: ConversationRuntimePolicyBudget = {
    ...optionalFiniteNumberField("tokenLimit", value.tokenLimit),
    ...optionalFiniteNumberField("fileCountLimit", value.fileCountLimit),
    ...optionalFiniteNumberField("videoMinuteLimit", value.videoMinuteLimit),
    ...optionalFiniteNumberField("audioMinuteLimit", value.audioMinuteLimit),
    ...(isNonEmptyString(value.estimatedCostTier)
      ? { estimatedCostTier: value.estimatedCostTier }
      : {}),
    ...optionalFiniteNumberField("estimatedCostUsd", value.estimatedCostUsd),
  };
  return Object.keys(budget).length === 0 ? undefined : budget;
}

function applyScheduleStatePatchToDefinition(
  definition: ConversationRuntimeBackgroundJobScheduleDefinition,
  patch: ConversationRuntimeBackgroundJobScheduleStatePatch,
): ConversationRuntimeBackgroundJobScheduleDefinition {
  return {
    ...definition,
    state: {
      ...(definition.state ?? {}),
      lastRunAtMs: patch.lastRunAtMs,
      lastJobId: patch.lastJobId,
      ...(patch.nextRunAtMs === undefined ? {} : { nextRunAtMs: patch.nextRunAtMs }),
    },
  };
}

function createEmptyScheduleStoreDocument(): ConversationRuntimeBackgroundJobScheduleStoreDocument {
  return {
    schemaVersion: CONVERSATION_RUNTIME_BACKGROUND_JOB_SCHEDULE_STORE_SCHEMA_VERSION,
    schedules: [],
  };
}

export function clearConversationRuntimeBackgroundJobCronCacheForTest(): void {
  cronEvalCache.clear();
}

function createDispatchIntent(
  input: {
    readonly definition: ConversationRuntimeBackgroundJobScheduleDefinition;
    readonly scheduledForMs: number;
    readonly nextRunAtMs?: number;
  },
  nowMs: number,
): ConversationRuntimeBackgroundJobSchedulerDispatchIntent {
  const jobId = createScheduledBackgroundJobId(input.definition.scheduleId, input.scheduledForMs);
  const job = createConversationRuntimeBackgroundJobTask({
    jobId,
    sessionKey: input.definition.sessionKey,
    title: input.definition.title,
    objective: input.definition.objective,
    trigger: { kind: "schedule", scheduleRef: input.definition.scheduleId },
    ...(input.definition.budget === undefined ? {} : { budget: input.definition.budget }),
    allowedTools: uniqueStrings(input.definition.allowedTools ?? []),
    allowedCapabilities: uniqueStrings(input.definition.allowedCapabilities ?? []),
    policyEnvelopeRefs: uniqueStrings(input.definition.policyEnvelopeRefs ?? []),
    evidenceRefIds: uniqueStrings(input.definition.evidenceRefIds ?? []),
    sourceRefs: uniqueStrings(input.definition.sourceRefs ?? []),
    createdAtMs: nowMs,
    metadata: {
      ...(input.definition.metadata ?? {}),
      scheduleId: input.definition.scheduleId,
      scheduledForMs: input.scheduledForMs,
      ...(input.nextRunAtMs === undefined ? {} : { nextRunAtMs: input.nextRunAtMs }),
    },
  });

  return {
    intentId: `background-scheduler:${input.definition.scheduleId}:${input.scheduledForMs}`,
    scheduleId: input.definition.scheduleId,
    command: "enqueue-background-job",
    scheduledForMs: input.scheduledForMs,
    ...(input.nextRunAtMs === undefined ? {} : { nextRunAtMs: input.nextRunAtMs }),
    job,
  };
}

function resolveCachedCron(expr: string, timezone: string | undefined): Cron {
  const trimmedExpr = expr.trim();
  if (trimmedExpr.length === 0) {
    throw new Error("invalid cron schedule: expr is required");
  }
  const resolvedTimezone = resolveCronTimezone(timezone);
  const key = `${resolvedTimezone}\u0000${trimmedExpr}`;
  const cached = cronEvalCache.get(key);
  if (cached !== undefined) {
    cronEvalCache.delete(key);
    cronEvalCache.set(key, cached);
    return cached;
  }
  if (cronEvalCache.size >= CRON_EVAL_CACHE_MAX) {
    const oldest = cronEvalCache.keys().next().value;
    if (oldest !== undefined) {
      cronEvalCache.delete(oldest);
    }
  }
  const cron = new Cron(trimmedExpr, { timezone: resolvedTimezone, catch: false });
  cronEvalCache.set(key, cron);
  return cron;
}

function resolveCronTimezone(timezone: string | undefined): string {
  const trimmed = timezone?.trim();
  if (trimmed !== undefined && trimmed.length > 0) {
    return trimmed;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function safelyComputeNextRunAtMs(
  schedule: ConversationRuntimeBackgroundJobSchedule,
  nowMs: number,
): number | undefined {
  try {
    return computeNextConversationRuntimeBackgroundJobRunAtMs(schedule, nowMs);
  } catch {
    return undefined;
  }
}

function createBackgroundJobSchedulerHardeningLock(
  tickLock: ConversationRuntimeBackgroundJobSchedulerTickLockEvidence | undefined,
): ConversationRuntimeBackgroundJobSchedulerHardeningPlan["lock"] {
  return {
    required: true,
    acquired: tickLock?.acquired === true,
    ...(tickLock?.lockId === undefined ? {} : { lockId: tickLock.lockId }),
    ...(tickLock?.ownerId === undefined ? {} : { ownerId: tickLock.ownerId }),
    ...(tickLock?.expiresAtMs === undefined ? {} : { expiresAtMs: tickLock.expiresAtMs }),
  };
}

function createBackgroundJobSchedulerIntentHardeningReview(input: {
  readonly intent: ConversationRuntimeBackgroundJobSchedulerDispatchIntent;
  readonly allowedScriptRoots: readonly string[];
}): ConversationRuntimeBackgroundJobSchedulerIntentHardeningReview {
  const promptInjectionRisk = inspectBackgroundJobSchedulerPromptInjectionRisk(input.intent);
  const scriptContainment = inspectBackgroundJobSchedulerScriptContainment({
    scriptPath: readBackgroundJobSchedulerScriptPath(input.intent),
    allowedScriptRoots: input.allowedScriptRoots,
  });
  const reasonCodes = [
    ...(promptInjectionRisk.status === "blocked" ? ["prompt_injection_risk_detected"] : []),
    ...(scriptContainment.status === "blocked" ? ["script_path_outside_allowed_roots"] : []),
  ];
  return {
    intentId: input.intent.intentId,
    scheduleId: input.intent.scheduleId,
    status: reasonCodes.length === 0 ? "ready" : "blocked",
    promptInjectionRisk,
    scriptContainment,
    reasonCodes,
  };
}

function inspectBackgroundJobSchedulerPromptInjectionRisk(
  intent: ConversationRuntimeBackgroundJobSchedulerDispatchIntent,
): ConversationRuntimeBackgroundJobSchedulerPromptInjectionRisk {
  const text = `${intent.job.record.title}\n${intent.job.record.objective}`.toLowerCase();
  const reasons = [
    ...(/ignore (?:all |any |previous |prior )?(?:system |developer |previous |prior )?instructions/u.test(
      text,
    )
      ? ["ignore-previous-instructions"]
      : []),
    ...(/dump (?:all )?(?:secrets|credentials|tokens|keys)|exfiltrat|leak (?:secrets|credentials|tokens|keys)/u.test(
      text,
    )
      ? ["secret-exfiltration"]
      : []),
  ];
  return {
    status: reasons.length === 0 ? "passed" : "blocked",
    reasons,
  };
}

function inspectBackgroundJobSchedulerScriptContainment(input: {
  readonly scriptPath: string | undefined;
  readonly allowedScriptRoots: readonly string[];
}): ConversationRuntimeBackgroundJobSchedulerScriptContainment {
  const allowedRoots = input.allowedScriptRoots.map(normalizePathForContainment).filter(Boolean);
  if (input.scriptPath === undefined) {
    return {
      status: "not_applicable",
      allowedRoots,
    };
  }
  const normalizedScriptPath = normalizePathForContainment(input.scriptPath);
  const contained =
    allowedRoots.length > 0 &&
    allowedRoots.some(
      (root) => normalizedScriptPath === root || normalizedScriptPath.startsWith(`${root}/`),
    );
  return {
    status: contained ? "passed" : "blocked",
    scriptPath: input.scriptPath,
    allowedRoots,
  };
}

function readBackgroundJobSchedulerScriptPath(
  intent: ConversationRuntimeBackgroundJobSchedulerDispatchIntent,
): string | undefined {
  const scriptPath = intent.job.record.metadata?.scriptPath;
  return typeof scriptPath === "string" && scriptPath.trim().length > 0
    ? scriptPath.trim()
    : undefined;
}

function createBackgroundJobSchedulerHardeningReasonCodes(input: {
  readonly lockAcquired: boolean;
  readonly advanceReady: boolean;
  readonly deliveryReady: boolean;
  readonly intentReviews: readonly ConversationRuntimeBackgroundJobSchedulerIntentHardeningReview[];
}): readonly string[] {
  const codes = new Set<string>();
  codes.add(input.lockAcquired ? "tick_lock_acquired" : "tick_lock_not_acquired");
  codes.add(
    input.advanceReady ? "advance_before_delivery_ready" : "advance_before_delivery_missing",
  );
  codes.add(input.deliveryReady ? "delivery_queue_ready" : "delivery_direct_execute_blocked");
  for (const review of input.intentReviews) {
    for (const code of review.reasonCodes) {
      codes.add(code);
    }
  }
  return [...codes];
}

function createBackgroundJobSchedulerHardeningNextActions(input: {
  readonly lockAcquired: boolean;
  readonly advanceReady: boolean;
  readonly deliveryReady: boolean;
  readonly blockedIntentIds: readonly string[];
}): readonly string[] {
  const actions = new Set<string>();
  if (!input.lockAcquired) {
    actions.add("acquire a scheduler tick lock before applying due schedules");
  }
  if (!input.advanceReady) {
    actions.add("advance schedule state before queue delivery");
  }
  if (!input.deliveryReady) {
    actions.add("deliver due schedules through the background queue instead of direct execution");
  }
  if (input.blockedIntentIds.length > 0) {
    actions.add("review blocked scheduler intents before dispatch");
  }
  return [...actions];
}

function normalizePathForContainment(path: string): string {
  return path.trim().replace(/\/+$/u, "");
}

function parseAbsoluteTimeMs(input: string): number | undefined {
  const raw = input.trim();
  if (raw.length === 0) {
    return undefined;
  }
  if (/^\d+$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
  }
  const parsed = Date.parse(normalizeUtcIso(raw));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeUtcIso(raw: string): string {
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    return raw;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T00:00:00Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    return `${raw}Z`;
  }
  return raw;
}

function coercePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(1, Math.trunc(value));
}

function coerceNonNegativeInteger(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.trunc(value));
}

function normalizeMaxDispatches(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.trunc(value));
}

function resolveNextSchedulerWakeMs(runTimes: readonly number[]): {
  readonly nextRunAtMs?: number;
} {
  const futureRunTimes = runTimes.filter((value) => Number.isFinite(value));
  if (futureRunTimes.length === 0) {
    return {};
  }
  return { nextRunAtMs: Math.min(...futureRunTimes) };
}

function resolveSchedulerDaemonDelayMs(input: {
  readonly nowMs: number;
  readonly nextRunAtMs?: number;
  readonly minDelayMs?: number;
  readonly maxDelayMs?: number;
}): number {
  const minDelayMs = normalizeDaemonDelayMs(input.minDelayMs, 100);
  const maxDelayMs = Math.max(minDelayMs, normalizeDaemonDelayMs(input.maxDelayMs, 60_000));
  if (input.nextRunAtMs === undefined || !Number.isFinite(input.nextRunAtMs)) {
    return maxDelayMs;
  }
  return clamp(Math.ceil(input.nextRunAtMs - input.nowMs), minDelayMs, maxDelayMs);
}

function normalizeDaemonDelayMs(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createScheduledBackgroundJobId(scheduleId: string, scheduledForMs: number): string {
  return `scheduled:${sanitizeIdSegment(scheduleId)}:${scheduledForMs}`;
}

function sanitizeIdSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]+/g, "-");
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function optionalStringArrayField<
  K extends
    | "allowedTools"
    | "allowedCapabilities"
    | "policyEnvelopeRefs"
    | "evidenceRefIds"
    | "sourceRefs",
>(
  key: K,
  value: unknown,
): Pick<ConversationRuntimeBackgroundJobScheduleDefinition, K> | Record<string, never> {
  return isStringArray(value)
    ? ({ [key]: uniqueStrings(value) } as Pick<
        ConversationRuntimeBackgroundJobScheduleDefinition,
        K
      >)
    : {};
}

function optionalFiniteNumberField<K extends keyof ConversationRuntimePolicyBudget>(
  key: K,
  value: unknown,
): Pick<ConversationRuntimePolicyBudget, K> | Record<string, never> {
  return isFiniteNumber(value)
    ? ({ [key]: value } as Pick<ConversationRuntimePolicyBudget, K>)
    : {};
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

function compareSchedules(
  first: ConversationRuntimeBackgroundJobScheduleDefinition,
  second: ConversationRuntimeBackgroundJobScheduleDefinition,
): number {
  const firstNextRunAtMs = first.state?.nextRunAtMs ?? Number.POSITIVE_INFINITY;
  const secondNextRunAtMs = second.state?.nextRunAtMs ?? Number.POSITIVE_INFINITY;
  return firstNextRunAtMs - secondNextRunAtMs || first.scheduleId.localeCompare(second.scheduleId);
}

function cloneScheduleDefinition(
  definition: ConversationRuntimeBackgroundJobScheduleDefinition,
): ConversationRuntimeBackgroundJobScheduleDefinition {
  return JSON.parse(
    JSON.stringify(definition),
  ) as ConversationRuntimeBackgroundJobScheduleDefinition;
}
