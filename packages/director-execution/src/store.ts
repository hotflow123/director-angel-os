import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  type AssignmentRun,
  type AssignmentRunConstraint,
  DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION,
  type ExecutionEvent,
  type ExecutionRun,
  type ExecutionRunReport,
  isAssignmentRun,
  isExecutionEvent,
  isExecutionRun,
  isExecutionRunReport,
} from "@hotflow/director-execution-contracts";

import { FileSystemEventLog } from "./events.js";
import type { RunStore } from "./types.js";

export interface FileSystemRunStoreOptions {
  readonly rootPath: string;
}

export class FileSystemRunStore implements RunStore {
  private readonly runRoot: string;
  private readonly eventLog: FileSystemEventLog;

  public constructor(private readonly options: FileSystemRunStoreOptions) {
    this.runRoot = join(options.rootPath, "runs");
    this.eventLog = new FileSystemEventLog({ rootPath: this.runRoot });
  }

  public async saveRun(run: ExecutionRun): Promise<void> {
    const materialized = materializeExecutionRunDocument(run);
    if (materialized === null) {
      throw new Error("Cannot persist an invalid execution run document.");
    }
    const path = this.runPath(materialized.runId);
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(materialized, null, 2)}\n`, "utf8");
    await rename(tempPath, path);
  }

  public async loadRun(runId: string): Promise<ExecutionRun | null> {
    try {
      const data = await readFile(this.runPath(runId), "utf8");
      const parsed = JSON.parse(data) as unknown;
      const run = materializeExecutionRunDocument(parsed);
      if (run === null) {
        throw new Error(`Invalid execution run document for "${runId}".`);
      }
      const loggedEvents = await this.listEvents(runId);
      const events = mergeEvents(run.events, loggedEvents);
      const updatedAt = events.at(-1)?.occurredAt ?? run.updatedAt;
      return {
        ...run,
        updatedAt,
        events,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  public async appendEvent(event: ExecutionEvent): Promise<void> {
    if (!isExecutionEvent(event)) {
      throw new Error("Cannot append an invalid execution event.");
    }
    await this.eventLog.append(event.runId, event);
  }

  public async listEvents(runId: string): Promise<readonly ExecutionEvent[]> {
    return this.eventLog.read(runId);
  }

  public async saveReport(report: ExecutionRunReport): Promise<void> {
    const materialized = materializeExecutionRunReportDocument(report);
    if (materialized === null) {
      throw new Error("Cannot persist an invalid execution run report.");
    }
    const path = this.reportPath(materialized.runId);
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(materialized, null, 2)}\n`, "utf8");
    await rename(tempPath, path);
  }

  public async loadReport(runId: string): Promise<ExecutionRunReport | null> {
    try {
      const data = await readFile(this.reportPath(runId), "utf8");
      const parsed = JSON.parse(data) as unknown;
      const report = materializeExecutionRunReportDocument(parsed);
      if (report === null) {
        throw new Error(`Invalid execution run report for "${runId}".`);
      }
      return report;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private runPath(runId: string): string {
    return join(this.runRoot, runId, "run.json");
  }

  private reportPath(runId: string): string {
    return join(this.runRoot, runId, "report.json");
  }
}

function materializeExecutionRunDocument(value: unknown): ExecutionRun | null {
  if (!isObject(value)) {
    return null;
  }

  const assignments = Array.isArray(value.assignments)
    ? value.assignments.map(materializeAssignmentRunDocument)
    : null;
  const events = Array.isArray(value.events) ? value.events : null;

  if (
    value.schemaVersion !== DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION ||
    typeof value.runId !== "string" ||
    typeof value.snapshotId !== "string" ||
    typeof value.runtimeId !== "string" ||
    typeof value.blueprintId !== "string" ||
    typeof value.handoffId !== "string" ||
    typeof value.actionGraphId !== "string" ||
    typeof value.goal !== "string" ||
    typeof value.previewSummary !== "string" ||
    typeof value.sideEffectsAllowed !== "boolean" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.status !== "string" ||
    assignments === null ||
    assignments.some((assignment) => assignment === null) ||
    events === null ||
    !events.every(isExecutionEvent)
  ) {
    return null;
  }

  const candidate = {
    ...value,
    assignments: assignments as AssignmentRun[],
    events: events as ExecutionEvent[],
  };

  return isExecutionRun(candidate) ? candidate : null;
}

function materializeAssignmentRunDocument(value: unknown): AssignmentRun | null {
  if (!isObject(value)) {
    return null;
  }

  const candidate = {
    ...value,
    inputs: normalizeStringArray(value.inputs),
    outputs: normalizeStringArray(value.outputs),
    acceptanceCriteria: normalizeStringArray(value.acceptanceCriteria),
    constraints: normalizeAssignmentConstraints(value.constraints),
  };

  return isAssignmentRun(candidate) ? candidate : null;
}

function materializeExecutionRunReportDocument(value: unknown): ExecutionRunReport | null {
  if (!isObject(value)) {
    return null;
  }

  const run = materializeExecutionRunDocument(value.run);
  if (run === null) {
    return null;
  }

  const candidate = {
    ...value,
    run,
  };

  return isExecutionRunReport(candidate) ? candidate : null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : [];
}

function normalizeAssignmentConstraints(value: unknown): AssignmentRunConstraint[] {
  return Array.isArray(value) ? (value as AssignmentRunConstraint[]) : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeEvents(
  persistedEvents: readonly ExecutionEvent[],
  loggedEvents: readonly ExecutionEvent[],
): ExecutionEvent[] {
  const merged = new Map<string, ExecutionEvent>();
  for (const event of persistedEvents) {
    merged.set(event.eventId, event);
  }
  for (const event of loggedEvents) {
    merged.set(event.eventId, event);
  }
  return [...merged.values()].sort((left, right) => {
    if (left.occurredAt === right.occurredAt) {
      return left.eventId.localeCompare(right.eventId);
    }
    return left.occurredAt.localeCompare(right.occurredAt);
  });
}
