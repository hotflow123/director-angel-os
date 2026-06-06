import {
  type AlignmentLock,
  type AlignmentState,
  type ArtifactRef,
  type CapabilityMatchResult,
  DIRECTOR_HOST_API_VERSION,
  type DirectorActionClass,
  type DirectorActionEdge,
  type DirectorActionGraph,
  type DirectorActionNode,
  type DirectorAlignmentConstraint,
  type DirectorApprovalMode,
  type DirectorBlueprintRequest,
  type DirectorBlueprintResponse,
  type DirectorClarificationAssessment,
  type DirectorClarificationDecision,
  type DirectorClarificationQuestion,
  type DirectorClarifyRequest,
  type DirectorClarifyResponse,
  type DirectorEvaluateRequest,
  type DirectorEvaluateResponse,
  type DirectorHostSnapshotEnvelope,
  type DirectorIntakePayload,
  type DirectorIntakeRequest,
  type DirectorIntakeResponse,
  type DirectorOperatorPreview,
  type DirectorOutcomeRequest,
  type DirectorOutcomeResponse,
  type DirectorRuntimeCapabilitySnapshotResponse,
  type DirectorRuntimeResponse,
  type MediaExecutionRequest,
  type OperatorOutcome,
  type RuntimeCapabilitySnapshot,
} from "@hotflow/director-host-contracts";
import type { DirectorEvaluationResult } from "@hotflow/director-service";

import {
  type DirectorHostRuntime,
  materializeDirectorHostRuntimeCapabilitySnapshot,
} from "./bootstrap.js";

function nowIso(): string {
  return new Date().toISOString();
}

function toAlignmentState(
  decision: DirectorEvaluationResult["alignmentAssessment"]["decision"],
): AlignmentState {
  return decision === "aligned"
    ? "locked"
    : decision === "clarification_required"
      ? "pending"
      : "blocked";
}

function toClarificationDecision(
  decision: DirectorEvaluationResult["alignmentAssessment"]["decision"],
): DirectorClarificationDecision {
  return decision === "aligned"
    ? "ready"
    : decision === "clarification_required"
      ? "needs_clarification"
      : "blocked";
}

function toApprovalMode(
  mode: DirectorEvaluationResult["crewAssignments"][number]["approvalMode"],
): DirectorApprovalMode {
  return mode === "auto-allow"
    ? "auto_allow"
    : mode === "operator-approve"
      ? "operator_approve"
      : "forbidden_in_beta1";
}

function toActionClass(
  actionClass: DirectorEvaluationResult["crewAssignments"][number]["actionClass"],
): DirectorActionClass {
  if (actionClass === "read" || actionClass === "generate" || actionClass === "publish") {
    return actionClass;
  }

  return "write";
}

function toConstraintFromLock(
  lock: DirectorEvaluationResult["alignmentLock"]["lockedConstraints"][number],
): DirectorAlignmentConstraint {
  return {
    field: lock.field,
    requirement: lock.value,
    priority: lock.level === "hard_lock" ? "required" : "preferred",
    ...(lock.reason === undefined ? {} : { rationale: lock.reason }),
  };
}

function toConstraintFromString(value: string, index: number): DirectorAlignmentConstraint {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex > 0) {
    return {
      field: value.slice(0, separatorIndex),
      requirement: value.slice(separatorIndex + 1),
      priority: "required",
    };
  }

  return {
    field: `constraint-${index + 1}`,
    requirement: value,
    priority: "required",
  };
}

export function buildRuntimeCapabilitySnapshotFromResult(
  runtime: DirectorHostRuntime,
  snapshot: DirectorHostSnapshotEnvelope,
  result: DirectorEvaluationResult,
): RuntimeCapabilitySnapshot {
  const executionAdapterSelections =
    result.runtimeCapabilitySnapshot.executionAdapterSelections ?? [];
  const executionRouteSummary = executionAdapterSelections
    .filter((selection) => selection.selectedAdapter !== null)
    .map((selection) => `${selection.role}:${selection.selectedAdapter}`);

  return materializeDirectorHostRuntimeCapabilitySnapshot(runtime, {
    capturedAt: snapshot.createdAt,
    notes: dedupeStrings([
      `eligible image bindings: ${result.runtimeCapabilitySnapshot.eligibleImageBindings.join(", ") || "none"}`,
      `eligible video bindings: ${result.runtimeCapabilitySnapshot.eligibleVideoBindings.join(", ") || "none"}`,
      `selected image adapter: ${result.runtimeCapabilitySnapshot.selectedImageAdapter ?? "none"}`,
      `selected video adapter: ${result.runtimeCapabilitySnapshot.selectedVideoAdapter ?? "none"}`,
      `selected execution adapter: ${result.runtimeCapabilitySnapshot.selectedExecutionAdapter ?? "none"}`,
      `selected execution routes: ${executionRouteSummary.join(", ") || "none"}`,
      ...result.runtimeCapabilitySnapshot.issues.map(
        (issue) => `${issue.severity}: ${issue.message}`,
      ),
    ]),
    runtimeId: result.runtimeCapabilitySnapshot.runtimeId,
    status: result.runtimeCapabilitySnapshot.status,
  });
}

export function buildRuntimeCapabilitySnapshotFromRuntime(
  runtime: DirectorHostRuntime,
  runtimeId = "director-host-api",
): RuntimeCapabilitySnapshot {
  return materializeDirectorHostRuntimeCapabilitySnapshot(runtime, {
    runtimeId,
  });
}

function buildClarificationAssessment(
  result: DirectorEvaluationResult,
): DirectorClarificationAssessment {
  const questions: DirectorClarificationQuestion[] =
    result.alignmentAssessment.clarificationQuestions.map((question) => ({
      questionId: question.code,
      prompt: question.prompt,
      required: true,
      answerKind: "text",
      affectsFields: [question.code],
    }));

  return {
    decision: toClarificationDecision(result.alignmentAssessment.decision),
    summary: result.alignmentAssessment.summary,
    missingFields: questions.map((question) => question.questionId),
    conflictingFields: [],
    questions,
  };
}

function buildAlignmentLock(
  intake: DirectorIntakePayload,
  snapshot: DirectorHostSnapshotEnvelope,
  result: DirectorEvaluationResult,
): AlignmentLock | null {
  if (result.alignmentLock.status === "awaiting_clarification") {
    return null;
  }

  return {
    lockId: `alignment-lock-${intake.intakeId}`,
    sourceIntakeId: intake.intakeId,
    state: result.alignmentLock.status === "blocked" ? "blocked" : "locked",
    lockedAt: snapshot.createdAt,
    objective: intake.objective,
    ...(intake.desiredOutcome === undefined ? {} : { desiredOutcome: intake.desiredOutcome }),
    deliverables:
      intake.deliverables && intake.deliverables.length > 0
        ? [...intake.deliverables]
        : [result.executionHandoffEnvelope.goal],
    lockedConstraints: result.alignmentLock.lockedConstraints.map(toConstraintFromLock),
    lockedFields: [...(snapshot.locks?.lockedFields ?? [])],
    ...(intake.nonGoals === undefined ? {} : { nonGoals: [...intake.nonGoals] }),
    notes: [...result.executionHandoffEnvelope.auditTrail],
  };
}

function buildActionGraph(
  blueprintId: string,
  result: DirectorEvaluationResult,
): DirectorActionGraph {
  const runtimeNodeByAssignmentId = new Map(
    result.actionGraph.nodes.map((node) => [node.assignmentId, node]),
  );
  const nodeIdByAssignmentId = new Map(
    result.actionGraph.nodes.map((node) => [node.assignmentId, node.nodeId]),
  );
  const assignmentById = new Map(
    result.crewAssignments.map((assignment) => [assignment.assignmentId, assignment]),
  );

  const nodes: DirectorActionNode[] = result.crewAssignments.map((assignment) => {
    const runtimeNode = runtimeNodeByAssignmentId.get(assignment.assignmentId);

    return {
      ...(runtimeNode?.blockingReason === undefined
        ? {}
        : { blockingReason: runtimeNode.blockingReason }),
      nodeId:
        nodeIdByAssignmentId.get(assignment.assignmentId) ?? `node-${assignment.assignmentId}`,
      assignmentId: assignment.assignmentId,
      role: assignment.role,
      objective: assignment.objective,
      assignedCapability: assignment.assignedCapability,
      inputs: [...assignment.inputs],
      outputs: [...assignment.outputs],
      deliverable: assignment.deliverable,
      acceptanceCriteria: [...assignment.acceptanceCriteria],
      constraints: assignment.constraints.map((constraint, constraintIndex) =>
        toConstraintFromString(constraint, constraintIndex),
      ),
      dependsOn: [...assignment.dependsOn],
      allowedAdapters: [...assignment.allowedAdapters],
      actionClass: toActionClass(assignment.actionClass),
      approvalMode: toApprovalMode(assignment.approvalMode),
      ...(assignment.budgetLimit > 0 ? { budgetLimit: { maxCost: assignment.budgetLimit } } : {}),
      timeoutMs: assignment.timeoutMs,
      maxDelegationDepth: assignment.maxDelegationDepth,
      fallbackPolicy: assignment.fallbackPolicy,
      escalationToDirector:
        assignment.status !== "ready" || assignment.approvalMode !== "auto-allow",
      ...(runtimeNode?.selectedAdapter === undefined
        ? {}
        : { selectedAdapter: runtimeNode.selectedAdapter ?? null }),
      ...(runtimeNode?.status === undefined ? {} : { status: runtimeNode.status }),
    };
  });

  const edges: DirectorActionEdge[] = result.actionGraph.edges.map((edge) => ({
    fromNodeId: nodeIdByAssignmentId.get(edge.fromAssignmentId) ?? `node-${edge.fromAssignmentId}`,
    toNodeId: nodeIdByAssignmentId.get(edge.toAssignmentId) ?? `node-${edge.toAssignmentId}`,
    artifactId: edge.edgeId,
    handoffContract: edge.handoffContract,
    blocking: edge.blocking,
  }));

  return {
    graphId: result.actionGraph.graphId,
    blueprintId,
    goal: result.actionGraph.goal,
    nodes,
    edges,
    stopConditions: [
      ...result.actionGraph.blockedReasons,
      ...result.executionHandoffEnvelope.auditTrail,
    ],
  };
}

function buildPreview(result: DirectorEvaluationResult): DirectorOperatorPreview {
  const requiredApprovals = result.actionGraph.nodes
    .filter((node) => node.status === "awaiting_approval")
    .map((node) => `${node.role}:${node.assignmentId}`);

  return {
    previewId: `preview-${result.executionHandoffEnvelope.handoffId}`,
    summary: result.executionHandoffEnvelope.operatorPreview.summary,
    warnings: [...result.review.recommendations],
    blockedReasons: [...result.executionHandoffEnvelope.operatorPreview.blockedReasons],
    requiredApprovals,
  };
}

function buildCapabilityMatches(result: DirectorEvaluationResult): CapabilityMatchResult[] {
  return result.executionHandoffEnvelope.entries.map((entry) => ({
    matchId: `match-${entry.assignmentId}`,
    assignmentId: entry.assignmentId,
    status:
      entry.selectedAdapter !== null
        ? "matched"
        : entry.status === "blocked"
          ? "blocked"
          : "no_match",
    ...(entry.selectedAdapter === null ? {} : { chosenAdapterId: entry.selectedAdapter }),
    reasons:
      entry.selectedAdapter !== null
        ? [`Selected adapter ${entry.selectedAdapter}.`]
        : [`No adapter selected for ${entry.assignmentId}.`],
  }));
}

function buildExpectedArtifacts(result: DirectorEvaluationResult): ArtifactRef[] {
  return result.executionHandoffEnvelope.entries.map((entry) => ({
    artifactId: `artifact-${entry.assignmentId}`,
    kind: "document",
    source: "inline",
    title: entry.deliverable,
    inlineText: entry.deliverable,
  }));
}

function shouldAllowExecutionSideEffects(
  runtime: DirectorHostRuntime,
  result: DirectorEvaluationResult,
): boolean {
  if (result.review.decision === "block" || result.actionGraph.readiness === "blocked") {
    return false;
  }

  const selectedExecutionAdapter = result.runtimeCapabilitySnapshot.selectedExecutionAdapter;
  const hasExecutionBridge = selectedExecutionAdapter
    ? result.executionHandoffEnvelope.entries.some(
        (entry) =>
          entry.role === "script-planner" &&
          entry.actionClass === "generate" &&
          entry.status !== "blocked" &&
          entry.selectedAdapter === selectedExecutionAdapter &&
          isRealHttpJsonBridgeAdapter(runtime, selectedExecutionAdapter),
      )
    : false;

  if (hasExecutionBridge) {
    return true;
  }

  return result.executionHandoffEnvelope.entries.some(
    (entry) =>
      entry.role === "asset-router" &&
      entry.status !== "blocked" &&
      entry.selectedAdapter !== null &&
      isRealHttpJsonBridgeAdapter(runtime, entry.selectedAdapter),
  );
}

function isRealHttpJsonBridgeAdapter(runtime: DirectorHostRuntime, adapterId: string): boolean {
  const manifest = runtime.adapterRegistry
    .listAll()
    .find((candidate) => candidate.adapterId === adapterId);
  return (
    manifest !== undefined &&
    manifest.enabled !== false &&
    manifest.mockOnly === false &&
    manifest.bridge?.kind === "http-json"
  );
}

function buildHandoff(
  runtime: DirectorHostRuntime,
  blueprintId: string,
  alignmentLock: AlignmentLock | null,
  actionGraph: DirectorActionGraph,
  preview: DirectorOperatorPreview,
  result: DirectorEvaluationResult,
): import("@hotflow/director-host-contracts").ExecutionHandoffEnvelope {
  const sideEffectsAllowed = shouldAllowExecutionSideEffects(runtime, result);

  return {
    handoffId: result.executionHandoffEnvelope.handoffId,
    blueprintId,
    createdAt: nowIso(),
    alignmentLockId: alignmentLock?.lockId ?? `alignment-lock-${result.normalizedInput.snapshotId}`,
    actionGraphId: actionGraph.graphId,
    previewSummary: preview.summary,
    capabilityMatches: buildCapabilityMatches(result),
    mediaRequests: [] satisfies MediaExecutionRequest[],
    expectedArtifacts: buildExpectedArtifacts(result),
    chosenAdapters: dedupeStrings(
      result.executionHandoffEnvelope.entries
        .map((entry) => entry.selectedAdapter)
        .filter((adapter): adapter is string => adapter !== null),
    ),
    sideEffectsAllowed,
    notes: [
      sideEffectsAllowed
        ? "Worker-only external execution is allowed for the selected bridge adapter when execution.sideEffects.enabled is on."
        : "Beta-1 handoff is preview-only.",
      ...result.executionHandoffEnvelope.auditTrail,
    ],
  };
}

function createBlueprintEnvelope(
  runtime: DirectorHostRuntime,
  snapshot: DirectorHostSnapshotEnvelope,
  intake: DirectorIntakePayload,
  result: DirectorEvaluationResult,
): {
  readonly capabilitySnapshot: RuntimeCapabilitySnapshot;
  readonly alignmentLock: AlignmentLock | null;
  readonly actionGraph: DirectorActionGraph;
  readonly preview: DirectorOperatorPreview;
  readonly handoff: import("@hotflow/director-host-contracts").ExecutionHandoffEnvelope;
  readonly blueprintId: string;
} {
  const capabilitySnapshot = buildRuntimeCapabilitySnapshotFromResult(runtime, snapshot, result);
  const alignmentLock = buildAlignmentLock(intake, snapshot, result);
  const blueprintId = `blueprint-${result.response.plan.planId}`;
  const actionGraph = buildActionGraph(blueprintId, result);
  const preview = buildPreview(result);
  const handoff = buildHandoff(runtime, blueprintId, alignmentLock, actionGraph, preview, result);

  return {
    capabilitySnapshot,
    alignmentLock,
    actionGraph,
    preview,
    handoff,
    blueprintId,
  };
}

export function createIntakeResponse(
  runtime: DirectorHostRuntime,
  request: DirectorIntakeRequest,
  result: DirectorEvaluationResult,
): DirectorIntakeResponse {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    snapshotId: request.snapshot.snapshotId,
    runtimeId: request.snapshot.runtime.runtimeId,
    intakeId: request.intake.intakeId,
    capabilitySnapshot: buildRuntimeCapabilitySnapshotFromResult(runtime, request.snapshot, result),
    clarification: buildClarificationAssessment(result),
    alignmentState: toAlignmentState(result.alignmentAssessment.decision),
    alignmentLock: buildAlignmentLock(request.intake, request.snapshot, result),
  };
}

export function createClarifyResponse(
  _runtime: DirectorHostRuntime,
  request: DirectorClarifyRequest,
  result: DirectorEvaluationResult,
): DirectorClarifyResponse {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    snapshotId: request.snapshot.snapshotId,
    runtimeId: request.snapshot.runtime.runtimeId,
    intakeId: request.intake.intakeId,
    clarification: buildClarificationAssessment(result),
    alignmentState: toAlignmentState(result.alignmentAssessment.decision),
    alignmentLock: buildAlignmentLock(request.intake, request.snapshot, result),
  };
}

export function createBlueprintResponse(
  runtime: DirectorHostRuntime,
  request: DirectorBlueprintRequest,
  result: DirectorEvaluationResult,
): DirectorBlueprintResponse {
  const blueprint = createBlueprintEnvelope(runtime, request.snapshot, request.intake, result);

  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    snapshotId: request.snapshot.snapshotId,
    runtimeId: request.snapshot.runtime.runtimeId,
    blueprintId: blueprint.blueprintId,
    review: result.response.review,
    capabilitySnapshot: blueprint.capabilitySnapshot,
    actionGraph: blueprint.actionGraph,
    preview: blueprint.preview,
    handoff: blueprint.handoff,
  };
}

export function createEvaluateResponse(
  _runtime: DirectorHostRuntime,
  _request: DirectorEvaluateRequest,
  result: DirectorEvaluationResult,
): DirectorEvaluateResponse {
  return result.response;
}

export function createRuntimeSnapshotResponse(
  runtime: DirectorHostRuntime,
  summary: DirectorRuntimeResponse,
  options: {
    readonly agentOsProcessCapabilityLedger?: DirectorRuntimeCapabilitySnapshotResponse["agentOsProcessCapabilityLedger"];
    readonly agentOsExtensionMatrix?: DirectorRuntimeCapabilitySnapshotResponse["agentOsExtensionMatrix"];
    readonly agentOsSubagentRuns?: DirectorRuntimeCapabilitySnapshotResponse["agentOsSubagentRuns"];
  } = {},
): DirectorRuntimeCapabilitySnapshotResponse {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    runtimeId: summary.runtimeId,
    capabilitySnapshot: materializeDirectorHostRuntimeCapabilitySnapshot(runtime, {
      notes: summary.notes,
      runtimeId: summary.runtimeId,
    }),
    ...(options.agentOsProcessCapabilityLedger === undefined
      ? {}
      : { agentOsProcessCapabilityLedger: options.agentOsProcessCapabilityLedger }),
    ...(options.agentOsExtensionMatrix === undefined
      ? {}
      : { agentOsExtensionMatrix: options.agentOsExtensionMatrix }),
    ...(options.agentOsSubagentRuns === undefined
      ? {}
      : { agentOsSubagentRuns: options.agentOsSubagentRuns }),
  };
}

export function createOutcomeResponse(request: DirectorOutcomeRequest): DirectorOutcomeResponse {
  return {
    apiVersion: DIRECTOR_HOST_API_VERSION,
    snapshotId: request.snapshotId,
    blueprintId: request.blueprintId,
    handoffId: request.handoffId,
    stored: true,
    outcome: request.outcome satisfies OperatorOutcome,
  };
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
