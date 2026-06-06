import {
  DIRECTOR_ACTION_CLASSES,
  DIRECTOR_APPROVAL_MODES,
  DIRECTOR_CREW_ROLES,
} from "@hotflow/director-host-contracts";
import { isAssignmentResult } from "./assignment-result.js";
import { isAssignmentRunStatus } from "./assignment-run-status.js";
import { isArrayOfStrings, isObject, isOneOf, isOptional, isString } from "./guards.js";
export function isAssignmentRun(value) {
  return (
    isObject(value) &&
    isString(value.runId) &&
    isString(value.assignmentId) &&
    isOneOf(value.role, DIRECTOR_CREW_ROLES) &&
    isString(value.objective) &&
    isString(value.deliverable) &&
    isOneOf(value.actionClass, DIRECTOR_ACTION_CLASSES) &&
    isOneOf(value.approvalMode, DIRECTOR_APPROVAL_MODES) &&
    isArrayOfStrings(value.dependsOn) &&
    isAssignmentRunStatus(value.status) &&
    isOptional(value.selectedAdapter, (candidate) => candidate === null || isString(candidate)) &&
    isOptional(value.allowedAdapters, isArrayOfStrings) &&
    isOptional(value.blockingReason, isString) &&
    isOptional(value.timeoutMs, (candidate) => typeof candidate === "number") &&
    isString(value.createdAt) &&
    isOptional(value.startedAt, isString) &&
    isOptional(value.completedAt, isString) &&
    isOptional(value.result, isAssignmentResult) &&
    isOptional(value.notes, isArrayOfStrings)
  );
}
//# sourceMappingURL=assignment-run.js.map
