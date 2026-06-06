import {
  ALIGNMENT_CONSTRAINT_PRIORITIES,
  type AlignmentConstraintPriority,
  DIRECTOR_ACTION_CLASSES,
  DIRECTOR_APPROVAL_MODES,
  DIRECTOR_CREW_ROLES,
  type DirectorActionClass,
  type DirectorApprovalMode,
  type DirectorCrewRole,
} from "@hotflow/director-host-contracts";

import { isAssignmentResult } from "./assignment-result.js";
import type { AssignmentResult } from "./assignment-result.js";
import { isAssignmentRunStatus } from "./assignment-run-status.js";
import type { AssignmentRunStatus } from "./assignment-run-status.js";
import { isArrayOfStrings, isObject, isOneOf, isOptional, isString } from "./guards.js";

export interface AssignmentRunConstraint {
  readonly field: string;
  readonly requirement: string;
  readonly priority: AlignmentConstraintPriority;
  readonly rationale?: string;
}

export interface AssignmentRun {
  readonly runId: string;
  readonly assignmentId: string;
  readonly role: DirectorCrewRole;
  readonly objective: string;
  readonly deliverable: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly AssignmentRunConstraint[];
  readonly actionClass: DirectorActionClass;
  readonly approvalMode: DirectorApprovalMode;
  readonly dependsOn: readonly string[];
  readonly status: AssignmentRunStatus;
  readonly selectedAdapter?: string | null;
  readonly allowedAdapters?: readonly string[];
  readonly blockingReason?: string;
  readonly timeoutMs?: number;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly result?: AssignmentResult;
  readonly notes?: readonly string[];
}

export function isAssignmentRun(value: unknown): value is AssignmentRun {
  return (
    isObject(value) &&
    isString(value.runId) &&
    isString(value.assignmentId) &&
    isOneOf(value.role, DIRECTOR_CREW_ROLES) &&
    isString(value.objective) &&
    isString(value.deliverable) &&
    isArrayOfStrings(value.inputs) &&
    isArrayOfStrings(value.outputs) &&
    isArrayOfStrings(value.acceptanceCriteria) &&
    Array.isArray(value.constraints) &&
    value.constraints.every(isAssignmentRunConstraint) &&
    isOneOf(value.actionClass, DIRECTOR_ACTION_CLASSES) &&
    isOneOf(value.approvalMode, DIRECTOR_APPROVAL_MODES) &&
    isArrayOfStrings(value.dependsOn) &&
    isAssignmentRunStatus(value.status) &&
    isOptional(
      value.selectedAdapter,
      (candidate): candidate is string | null => candidate === null || isString(candidate),
    ) &&
    isOptional(value.allowedAdapters, isArrayOfStrings) &&
    isOptional(value.blockingReason, isString) &&
    isOptional(
      value.timeoutMs,
      (candidate): candidate is number => typeof candidate === "number",
    ) &&
    isString(value.createdAt) &&
    isOptional(value.startedAt, isString) &&
    isOptional(value.completedAt, isString) &&
    isOptional(value.result, isAssignmentResult) &&
    isOptional(value.notes, isArrayOfStrings)
  );
}

function isAssignmentRunConstraint(value: unknown): value is AssignmentRunConstraint {
  return (
    isObject(value) &&
    isString(value.field) &&
    isString(value.requirement) &&
    isOneOf(value.priority, ALIGNMENT_CONSTRAINT_PRIORITIES) &&
    isOptional(value.rationale, isString)
  );
}
