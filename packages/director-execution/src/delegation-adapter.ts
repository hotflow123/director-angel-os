import type { AssignmentRun, ExecutionRun } from "@hotflow/director-execution-contracts";

export type ExecutionRunDelegationSpecialization = "explore" | "plan" | "verify" | "general";

export interface ExecutionRunDelegationVerificationRequest {
  readonly verifierId: string;
  readonly requirement: string;
  readonly verificationId?: string;
}

export interface ExecutionRunDelegationInput {
  readonly id: string;
  readonly taskId?: string;
  readonly workerId: string;
  readonly instruction: string;
  readonly fromAgent?: string;
  readonly contextSnapshot?: string;
  readonly specialization?: ExecutionRunDelegationSpecialization;
  readonly targetAgent?: string;
  readonly verificationRequest?: ExecutionRunDelegationVerificationRequest;
  readonly resultSummary?: string;
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled";
  readonly error?: string;
}

const TERMINAL_ASSIGNMENT_STATUSES = new Set<AssignmentRun["status"]>([
  "completed",
  "failed",
  "aborted",
  "skipped",
]);

export interface ExecutionRunDelegationAdapterOptions {
  readonly sourceAgent?: string;
  readonly workerPrefix?: string;
  readonly verifierId?: string;
  readonly includePending?: boolean;
}

export function buildExecutionRunDelegations(
  run: ExecutionRun,
  options: ExecutionRunDelegationAdapterOptions = {},
): readonly ExecutionRunDelegationInput[] {
  const includePending = options.includePending ?? false;

  return run.assignments
    .filter((assignment) => includePending || assignment.status !== "pending")
    .map((assignment) => buildExecutionRunDelegation(run, assignment, options));
}

function buildExecutionRunDelegation(
  run: ExecutionRun,
  assignment: AssignmentRun,
  options: ExecutionRunDelegationAdapterOptions,
): ExecutionRunDelegationInput {
  const workerId = `${options.workerPrefix ?? "director"}-${assignment.role}`;
  const specialization = resolveDelegationSpecialization(assignment);
  const verificationRequest = resolveDelegationVerificationRequest(run, assignment, options);
  const status = mapAssignmentStatusToDelegationStatus(assignment);
  const error =
    assignment.status === "blocked"
      ? (assignment.blockingReason ?? `Assignment ${assignment.assignmentId} is blocked.`)
      : assignment.result?.status === "failed"
        ? assignment.result.summary
        : undefined;
  const resultSummary = TERMINAL_ASSIGNMENT_STATUSES.has(assignment.status)
    ? (assignment.result?.summary ??
      `Assignment ${assignment.assignmentId} ended with status ${assignment.status}.`)
    : undefined;

  return {
    id: `delegation_${sanitizeToken(run.runId)}_${sanitizeToken(assignment.assignmentId)}`,
    taskId: assignment.assignmentId,
    workerId,
    instruction: buildDelegationInstruction(assignment),
    fromAgent: options.sourceAgent ?? "director",
    contextSnapshot: buildDelegationContextSnapshot(run, assignment),
    specialization,
    targetAgent: `${assignment.role}-agent`,
    status,
    ...(verificationRequest === undefined ? {} : { verificationRequest }),
    ...(resultSummary === undefined ? {} : { resultSummary }),
    ...(error === undefined ? {} : { error }),
  };
}

function buildDelegationInstruction(assignment: AssignmentRun): string {
  const inputs = Array.isArray(assignment.inputs) ? assignment.inputs : [];
  const outputs = Array.isArray(assignment.outputs) ? assignment.outputs : [];
  const acceptanceCriteria = Array.isArray(assignment.acceptanceCriteria)
    ? assignment.acceptanceCriteria
    : [];
  return [
    `Role: ${assignment.role}`,
    `Objective: ${assignment.objective}`,
    `Deliverable: ${assignment.deliverable}`,
    `Inputs: ${inputs.join(", ") || "(none)"}`,
    `Outputs: ${outputs.join(", ") || "(none)"}`,
    `Acceptance: ${acceptanceCriteria.join("; ") || "(none)"}`,
  ].join("\n");
}

function buildDelegationContextSnapshot(run: ExecutionRun, assignment: AssignmentRun): string {
  const selectedAdapter = assignment.selectedAdapter ?? "(none)";
  const notes = assignment.notes?.join("; ") ?? "(none)";
  const dependsOn = Array.isArray(assignment.dependsOn) ? assignment.dependsOn : [];
  return [
    `run=${run.runId}`,
    `goal=${run.goal}`,
    `assignment=${assignment.assignmentId}`,
    `role=${assignment.role}`,
    `status=${assignment.status}`,
    `approvalMode=${assignment.approvalMode}`,
    `dependsOn=${dependsOn.join(",") || "(none)"}`,
    `selectedAdapter=${selectedAdapter}`,
    `sideEffectsAllowed=${String(run.sideEffectsAllowed)}`,
    `notes=${notes}`,
  ].join("\n");
}

function resolveDelegationSpecialization(
  assignment: AssignmentRun,
): ExecutionRunDelegationSpecialization {
  if (assignment.role === "researcher") {
    return "explore";
  }
  if (assignment.role === "qc-reviewer") {
    return "verify";
  }
  if (assignment.role === "script-planner" || assignment.role === "shot-planner") {
    return "plan";
  }
  return "general";
}

function resolveDelegationVerificationRequest(
  run: ExecutionRun,
  assignment: AssignmentRun,
  options: ExecutionRunDelegationAdapterOptions,
): ExecutionRunDelegationInput["verificationRequest"] | undefined {
  if (assignment.role === "qc-reviewer" || assignment.actionClass === "read") {
    return undefined;
  }
  const verifierId = options.verifierId ?? "director-qc-reviewer";
  return {
    verifierId,
    verificationId: `verification_${sanitizeToken(run.runId)}_${sanitizeToken(
      assignment.assignmentId,
    )}`,
    requirement: `Verify ${assignment.role} deliverable for ${assignment.assignmentId}: ${assignment.deliverable}`,
  };
}

function mapAssignmentStatusToDelegationStatus(
  assignment: AssignmentRun,
): ExecutionRunDelegationInput["status"] {
  if (assignment.status === "ready" || assignment.status === "pending") {
    return "queued";
  }
  if (assignment.status === "running") {
    return "running";
  }
  if (assignment.status === "completed") {
    return "completed";
  }
  if (assignment.status === "failed" || assignment.status === "blocked") {
    return "failed";
  }
  return "cancelled";
}

function sanitizeToken(value: string): string {
  return value.replace(/[^a-z0-9_]+/giu, "_");
}
