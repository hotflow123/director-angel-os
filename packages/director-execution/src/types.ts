import type {
  AssignmentRun,
  ExecutionEvent,
  ExecutionRun,
  ExecutionRunReport,
} from "@hotflow/director-execution-contracts";
import type { DirectorBlueprintResponse } from "@hotflow/director-host-contracts";
import type { ExecutionRunBuilder } from "./builder.js";

export type ExecutionRunSource = DirectorBlueprintResponse;

export interface HttpJsonExecutionBridgeTarget {
  readonly kind: "http-json";
  readonly adapterId: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly submitPath: string;
  readonly timeoutMs: number;
  readonly authEnvVar?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export type ExecutionBridgeTarget = HttpJsonExecutionBridgeTarget;

export interface ClaimedAssignment {
  readonly run: ExecutionRun;
  readonly assignment: AssignmentRun;
}

export interface ExecutionSafetyPolicy {
  readonly executionEnabled?: boolean;
  readonly pauseAll?: boolean;
  readonly disabledRoles?: readonly AssignmentRun["role"][];
  readonly disabledAdapters?: readonly string[];
}

export interface RunStore {
  saveRun(run: ExecutionRun): Promise<void>;
  loadRun(runId: string): Promise<ExecutionRun | null>;
  appendEvent(event: ExecutionEvent): Promise<void>;
  listEvents(runId: string): Promise<readonly ExecutionEvent[]>;
  saveReport(report: ExecutionRunReport): Promise<void>;
  loadReport(runId: string): Promise<ExecutionRunReport | null>;
}

export interface ExecutionRunBuilderOptions {
  readonly idProvider?: () => string;
  readonly clock?: () => string;
}

export interface ExecutionRunServiceOptions {
  readonly store: RunStore;
  readonly builder?: ExecutionRunBuilder;
  readonly eventIdProvider?: () => string;
  readonly clock?: () => string;
}
