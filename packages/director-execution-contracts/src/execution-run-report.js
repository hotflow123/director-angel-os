import { isExecutionBridgeReport } from "./bridge-report.js";
import { isExecutionEvent } from "./execution-event.js";
import { DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION } from "./execution-run.js";
import { isExecutionRun } from "./execution-run.js";
import { isArrayOfStrings, isObject, isOptional, isString } from "./guards.js";
export function isExecutionRunReport(value) {
  return (
    isObject(value) &&
    value.schemaVersion === DIRECTOR_EXECUTION_RUN_SCHEMA_VERSION &&
    isString(value.reportId) &&
    isString(value.runId) &&
    isExecutionRun(value.run) &&
    isString(value.recordedAt) &&
    isArrayOfStrings(value.summary) &&
    isArrayOfStrings(value.flags) &&
    isOptional(value.bridgeMetrics, isExecutionBridgeReport) &&
    Array.isArray(value.events) &&
    value.events.every(isExecutionEvent)
  );
}
