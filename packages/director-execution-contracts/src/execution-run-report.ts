import { isExecutionBridgeReport } from "./bridge-report.js";
import type { ExecutionBridgeReport } from "./bridge-report.js";
import { isExecutionEvent } from "./execution-event.js";
import type { ExecutionEvent } from "./execution-event.js";
import { DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION } from "./execution-run.js";
import { isExecutionRun } from "./execution-run.js";
import type { ExecutionRun } from "./execution-run.js";
import { isArrayOfStrings, isBoolean, isObject, isOneOf, isOptional, isString } from "./guards.js";

const EXECUTION_RUN_REPORT_OPERATOR_BRIDGE_VERDICTS = ["accepted", "responded", "failed"] as const;

export interface ExecutionRunReportOperatorBridgeAttempts {
  readonly attempts: number;
  readonly successes: number;
  readonly failures: number;
}

export interface ExecutionRunReportOperatorSurface {
  readonly directorGoal: string;
  readonly operatorSummary?: string;
  readonly objective?: string;
  readonly deliverable?: string;
  readonly adapterRoute?: string;
  readonly lastBridgeRoute?: string;
  readonly bridgeVerdict?: (typeof EXECUTION_RUN_REPORT_OPERATOR_BRIDGE_VERDICTS)[number];
  readonly bridgeFailureReason?: string;
  readonly requestAccepted?: boolean;
  readonly retryable?: boolean;
  readonly retryAllowed?: boolean;
  readonly rerouteCandidates?: readonly string[];
  readonly bridgeStatus?: number;
  readonly requestId?: string;
  readonly nextAction?: string;
  readonly bridgeAttempts?: ExecutionRunReportOperatorBridgeAttempts;
}

export interface ExecutionRunReport {
  readonly schemaVersion: typeof DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION;
  readonly reportId: string;
  readonly runId: string;
  readonly run: ExecutionRun;
  readonly recordedAt: string;
  readonly summary: readonly string[];
  readonly flags: readonly string[];
  readonly operatorSurface?: ExecutionRunReportOperatorSurface;
  readonly bridgeMetrics?: ExecutionBridgeReport;
  readonly events: readonly ExecutionEvent[];
}

export function isExecutionRunReport(value: unknown): value is ExecutionRunReport {
  return (
    isObject(value) &&
    value.schemaVersion === DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION &&
    isString(value.reportId) &&
    isString(value.runId) &&
    isExecutionRun(value.run) &&
    isString(value.recordedAt) &&
    isArrayOfStrings(value.summary) &&
    isArrayOfStrings(value.flags) &&
    isOptional(value.operatorSurface, isExecutionRunReportOperatorSurface) &&
    isOptional(value.bridgeMetrics, isExecutionBridgeReport) &&
    Array.isArray(value.events) &&
    value.events.every(isExecutionEvent)
  );
}

function isExecutionRunReportOperatorSurface(
  value: unknown,
): value is ExecutionRunReportOperatorSurface {
  return (
    isObject(value) &&
    isString(value.directorGoal) &&
    isOptional(value.operatorSummary, isString) &&
    isOptional(value.objective, isString) &&
    isOptional(value.deliverable, isString) &&
    isOptional(value.adapterRoute, isString) &&
    isOptional(value.lastBridgeRoute, isString) &&
    isOptional(value.bridgeVerdict, (candidate) =>
      isOneOf(candidate, EXECUTION_RUN_REPORT_OPERATOR_BRIDGE_VERDICTS),
    ) &&
    isOptional(value.bridgeFailureReason, isString) &&
    isOptional(value.requestAccepted, isBoolean) &&
    isOptional(value.retryable, isBoolean) &&
    isOptional(value.retryAllowed, isBoolean) &&
    isOptional(value.rerouteCandidates, isArrayOfStrings) &&
    isOptional(value.bridgeStatus, isNumber) &&
    isOptional(value.requestId, isString) &&
    isOptional(value.nextAction, isString) &&
    isOptional(value.bridgeAttempts, isExecutionRunReportOperatorBridgeAttempts)
  );
}

function isExecutionRunReportOperatorBridgeAttempts(
  value: unknown,
): value is ExecutionRunReportOperatorBridgeAttempts {
  return (
    isObject(value) &&
    isNumber(value.attempts) &&
    isNumber(value.successes) &&
    isNumber(value.failures)
  );
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}
