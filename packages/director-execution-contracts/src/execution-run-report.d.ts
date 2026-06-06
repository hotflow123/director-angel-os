import type { ExecutionBridgeReport } from "./bridge-report.js";
import type { ExecutionEvent } from "./execution-event.js";
import type { DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION } from "./execution-run.js";
import type { ExecutionRun } from "./execution-run.js";
export interface ExecutionRunReport {
  readonly schemaVersion: typeof DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION;
  readonly reportId: string;
  readonly runId: string;
  readonly run: ExecutionRun;
  readonly recordedAt: string;
  readonly summary: readonly string[];
  readonly flags: readonly string[];
  readonly bridgeMetrics?: ExecutionBridgeReport;
  readonly events: readonly ExecutionEvent[];
}
export declare function isExecutionRunReport(value: unknown): value is ExecutionRunReport;
//# sourceMappingURL=execution-run-report.d.ts.map
