import { createExecutionPromptBundle } from "./execution-prompt.js";
import { reviewPlan } from "./reviewer.js";
import type {
  ActionGraph,
  ActionGraphEdge,
  ActionGraphNode,
  ActionNodeStatus,
  AlignmentConstraint,
  AlignmentLock,
  ApprovalMode,
  AssignmentInputContract,
  AssignmentOutputContract,
  BindingPolicy,
  BlueprintArtifactRef,
  ClarificationDecision,
  ClarificationQuestion,
  CrewAssignment,
  CrewHandoff,
  CrewRole,
  DirectorContext,
  DirectorControlResult,
  DirectorDecisionRecord,
  DirectorGenerationStyle,
  DirectorPlan,
  ExecutionBlueprint,
  ExecutionHandoffEnvelope,
  ExecutionHandoffItem,
  ExecutionPlan,
  ModeDecision,
  PlanStatus,
  PolicySafetyGateResult,
  ReviewReport,
  ReviewStatus,
  RuntimeCapabilityDescriptor,
  RuntimeCapabilitySnapshot,
} from "./types.js";

const DEFAULT_CONFIDENCE = 0.78;
const FALLBACK_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const INTERNAL_ADAPTER_ID = "director-core.internal";

interface PlanningFoundation {
  capabilitySnapshot: RuntimeCapabilitySnapshot;
  clarification: ClarificationDecision;
  alignmentLock: AlignmentLock;
}

function toIsoTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? FALLBACK_TIMESTAMP : parsed.toISOString();
}

function makeStableId(prefix: string, ...parts: readonly string[]): string {
  const normalized = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("-")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return normalized.length > 0 ? `${prefix}-${normalized}` : prefix;
}

function pickBinding(
  availableBindings: readonly string[],
  requiredBinding: string | undefined,
  preferredBinding: string | undefined,
  fallbackBindings: readonly string[] | undefined,
): string | null {
  if (requiredBinding) {
    return availableBindings.includes(requiredBinding) ? requiredBinding : null;
  }
  if (preferredBinding && availableBindings.includes(preferredBinding)) {
    return preferredBinding;
  }
  const fallback = fallbackBindings?.find((binding) => availableBindings.includes(binding));
  if (fallback) {
    return fallback;
  }
  return availableBindings[0] ?? null;
}

function resolveFieldValue(context: DirectorContext, field: string): string {
  switch (field) {
    case "project.title":
      return context.project.title ?? "unset";
    case "project.outline":
      return context.project.outline ?? "unset";
    case "group.generationStyle":
      return context.group.generationStyle ?? "unset";
    case "group.generationType":
      return context.group.generationType;
    case "group.anchorIds":
      return context.group.anchorIds.join(", ") || "unset";
    case "intent.bindingPolicy":
      return context.intent.bindingPolicy;
    default:
      return "locked";
  }
}

function buildGoal(context: DirectorContext): string {
  if (context.project.title && context.project.outline) {
    return `${context.project.title}: ${context.project.outline}`;
  }
  if (context.project.title) {
    return context.project.title;
  }
  if (context.project.outline) {
    return context.project.outline;
  }
  return `Clarify the intended outcome for project ${context.request.projectId}.`;
}

function buildDeliverable(context: DirectorContext): string {
  return `${context.group.generationType} output for ${context.group.sceneCount} scene(s) in group ${context.group.groupId}`;
}

function chooseGenerationStyle(
  context: DirectorContext,
  alignmentLock: AlignmentLock,
): {
  readonly style: DirectorGenerationStyle;
  readonly whySelected: string;
  readonly rejectedStyles: DirectorGenerationStyle[];
} {
  const hardStyleLock = alignmentLock.lockedConstraints.find(
    (constraint) =>
      constraint.field === "group.generationStyle" &&
      constraint.level === "hard_lock" &&
      (constraint.value === "standard" || constraint.value === "immersive"),
  );

  if (hardStyleLock && hardStyleLock.value === "standard") {
    return {
      style: "standard",
      whySelected: hardStyleLock.reason ?? "alignment lock forces standard mode.",
      rejectedStyles: ["immersive"],
    };
  }

  if (
    context.group.generationStyle === "immersive" &&
    context.runtime.supportsVideo &&
    context.runtime.status !== "offline"
  ) {
    return {
      style: "immersive",
      whySelected: "group requested immersive mode and runtime can support video generation.",
      rejectedStyles: ["standard"],
    };
  }

  if (context.runtime.deterministicMode === "safe") {
    return {
      style: "standard",
      whySelected: "runtime is in safe deterministic mode, so the standard path is preferred.",
      rejectedStyles: ["immersive"],
    };
  }

  if (context.runtime.supportsVideo && context.runtime.status === "ready") {
    return {
      style: "immersive",
      whySelected: "runtime is healthy and video-capable, so immersive mode is allowed.",
      rejectedStyles: ["standard"],
    };
  }

  return {
    style: "standard",
    whySelected: "runtime cannot guarantee immersive generation, so the standard path is safer.",
    rejectedStyles: ["immersive"],
  };
}

function determinePlanStatus(
  context: DirectorContext,
  alignmentLock: AlignmentLock,
  selectedImageBinding: string | null,
): PlanStatus {
  if (alignmentLock.status === "blocked" || context.runtime.status === "offline") {
    return "blocked";
  }
  if (context.intent.bindingPolicy === "require" && !selectedImageBinding) {
    return "blocked";
  }
  if (alignmentLock.status === "pending") {
    return "review_required";
  }
  if (context.runtime.status === "degraded") {
    return "review_required";
  }
  if (context.intent.bindingPolicy === "prefer" && !selectedImageBinding) {
    return "review_required";
  }
  return "ready";
}

function reviewStatusFromPlanStatus(status: PlanStatus): ReviewStatus {
  if (status === "blocked") {
    return "block";
  }
  if (status === "review_required") {
    return "warn";
  }
  return "pass";
}

function buildRiskFlags(
  context: DirectorContext,
  clarification: ClarificationDecision,
  alignmentLock: AlignmentLock,
  selectedImageBinding: string | null,
  selectedVideoBinding: string | null,
): string[] {
  const riskFlags: string[] = [];

  if (context.runtime.status === "degraded") {
    riskFlags.push("runtime-degraded");
  }
  if (context.runtime.status === "offline") {
    riskFlags.push("runtime-offline");
  }
  if (clarification.alignmentState === "clarification_required") {
    riskFlags.push("clarification-required");
  }
  if (clarification.alignmentState === "blocked") {
    riskFlags.push("alignment-blocked");
  }
  if (!selectedImageBinding) {
    riskFlags.push("image-binding-missing");
  }
  if (context.intent.bindingPolicy === "require" && !selectedImageBinding) {
    riskFlags.push("binding-missing-required");
  }
  if (context.runtime.supportsVideo && !selectedVideoBinding) {
    riskFlags.push("video-binding-missing");
  }
  if (context.group.anchorIds.length === 0) {
    riskFlags.push("anchor-missing");
  }
  if ((context.knowledgeSignals?.length ?? 0) === 0) {
    riskFlags.push("knowledge-signals-empty");
  }
  if (alignmentLock.lockedConstraints.length > 0) {
    riskFlags.push("locks-present");
  }
  if (context.runtime.deterministicMode === "safe") {
    riskFlags.push("deterministic-safe-mode");
  }

  return riskFlags;
}

function buildConstraint(
  context: DirectorContext,
  field: string,
  level: "soft_lock" | "hard_lock",
  source: AlignmentConstraint["source"],
  value: string,
  reason?: string,
): AlignmentConstraint {
  return {
    constraintId: makeStableId("constraint", context.request.requestId, field, source, value),
    field,
    level,
    source,
    value,
    ...(reason === undefined ? {} : { reason }),
  };
}

function buildArtifact(
  requestId: string,
  assignmentId: string,
  label: string,
  kind: BlueprintArtifactRef["kind"],
  contract: string,
): BlueprintArtifactRef {
  return {
    artifactId: makeStableId("artifact", requestId, assignmentId, label),
    label,
    kind,
    contract,
  };
}

function toPreviewLine(role: CrewRole, objective: string): string {
  return `${role}: ${objective}`;
}

function buildDecisionRecords(
  capabilitySnapshot: RuntimeCapabilitySnapshot,
  clarification: ClarificationDecision,
  alignmentLock: AlignmentLock,
  plan: DirectorPlan,
  review: ReviewReport,
): DirectorDecisionRecord[] {
  return [
    {
      decisionId: makeStableId("decision", capabilitySnapshot.snapshotId, "capability"),
      stage: "capability_snapshot",
      summary: `Runtime snapshot captured ${capabilitySnapshot.capabilities.length} capability candidate(s).`,
      rationale: capabilitySnapshot.notes.join(" ") || "Runtime inputs were normalized.",
    },
    {
      decisionId: makeStableId("decision", capabilitySnapshot.snapshotId, "alignment"),
      stage: "alignment",
      summary: clarification.summary,
      rationale:
        alignmentLock.notes.join(" ") || "Alignment lock recorded the current constraints.",
    },
    {
      decisionId: makeStableId("decision", plan.planId, "review"),
      stage: "review",
      summary: `Review result is ${review.overallDecision}.`,
      rationale:
        review.blockingReasons.join(" ") || "All review gates passed on the deterministic path.",
    },
    {
      decisionId: makeStableId("decision", plan.planId, "routing"),
      stage: "routing",
      summary: `Image binding ${plan.modelRoutingDecision.selectedImageBinding ?? "not selected"}, video binding ${plan.modelRoutingDecision.selectedVideoBinding ?? "not selected"}.`,
      rationale: plan.modelRoutingDecision.whySelected,
    },
  ];
}

function buildAssignment(
  requestId: string,
  role: CrewRole,
  objective: string,
  assignedCapability: string,
  inputs: AssignmentInputContract[],
  outputs: AssignmentOutputContract[],
  deliverable: string,
  acceptanceCriteria: string[],
  constraints: string[],
  dependsOn: string[],
  allowedAdapters: string[],
  actionClass: CrewAssignment["actionClass"],
  approvalMode: ApprovalMode,
  timeoutMs: number,
  fallbackStrategy: CrewAssignment["fallbackPolicy"]["strategy"],
): CrewAssignment {
  const assignmentId = makeStableId("assignment", requestId, role);
  return {
    assignmentId,
    role,
    objective,
    assignedCapability,
    inputs,
    outputs,
    deliverable,
    acceptanceCriteria,
    constraints,
    dependsOn,
    allowedAdapters,
    actionClass,
    approvalMode,
    budgetLimit: null,
    timeoutMs,
    maxDelegationDepth: 1,
    fallbackPolicy: {
      strategy: fallbackStrategy,
      reason:
        "Director keeps re-planning control instead of letting workers mutate locked constraints.",
    },
    escalationToDirector: {
      when: "locked constraint violation, missing dependency, or adapter mismatch",
      action: "replan",
      reason: "Director must keep the final authority over crew re-assignment.",
    },
  };
}

function buildBlockedBlueprint(
  context: DirectorContext,
  alignmentLock: AlignmentLock,
  decisions: DirectorDecisionRecord[],
): ExecutionBlueprint {
  return {
    blueprintId: makeStableId("blueprint", context.request.requestId),
    status: "blocked",
    goal: alignmentLock.goal,
    lockedConstraints: alignmentLock.lockedConstraints,
    directorDecisions: decisions,
    assignments: [],
    handoffs: [],
    globalFailurePolicy: {
      blockOnLockedConstraintViolation: true,
      blockOnMissingCapability: true,
      replanOnDependencyFailure: true,
    },
    replanTriggers: [
      "alignment still pending",
      "review gate returned block",
      "required adapter capability is missing",
    ],
    stopConditions: ["runtime offline", "required binding unresolved"],
  };
}

function buildCrewAssignments(
  context: DirectorContext,
  plan: DirectorPlan,
  alignmentLock: AlignmentLock,
): { assignments: CrewAssignment[]; handoffs: CrewHandoff[] } {
  const requestId = context.request.requestId;
  const lockedConstraintLabels = alignmentLock.lockedConstraints.map(
    (constraint) => `${constraint.field}=${constraint.value}`,
  );

  const researcherId = makeStableId("assignment", requestId, "researcher");
  const scriptPlannerId = makeStableId("assignment", requestId, "script-planner");
  const shotPlannerId = makeStableId("assignment", requestId, "shot-planner");
  const assetRouterId = makeStableId("assignment", requestId, "asset-router");
  const qcReviewerId = makeStableId("assignment", requestId, "qc-reviewer");

  const researchArtifact = buildArtifact(
    requestId,
    researcherId,
    "research-brief",
    "brief",
    "Summarize user goal, continuity anchors, and unresolved risks.",
  );
  const scriptArtifact = buildArtifact(
    requestId,
    scriptPlannerId,
    "script-outline",
    "outline",
    "Produce a deterministic story and pacing outline that respects locked constraints.",
  );
  const shotArtifact = buildArtifact(
    requestId,
    shotPlannerId,
    "shot-plan",
    "outline",
    "Translate the approved script outline into shot-level direction.",
  );
  const routeArtifact = buildArtifact(
    requestId,
    assetRouterId,
    "route-receipt",
    "routing",
    "Record the chosen adapter route and any degraded matches that need operator review.",
  );
  const qcArtifact = buildArtifact(
    requestId,
    qcReviewerId,
    "quality-gate",
    "review",
    "Confirm that the crew plan still respects locked constraints and adapter limits.",
  );

  const researcher = buildAssignment(
    requestId,
    "researcher",
    "Inspect the user goal, anchors, and continuity risks before the rest of the crew moves.",
    "research.synthesis",
    [
      {
        name: "director-goal",
        source: "host",
        description: "Normalized project goal and project outline.",
        required: true,
      },
    ],
    [
      {
        name: "research-brief",
        description: "A research brief that the director can hand to planners.",
        artifact: researchArtifact,
      },
    ],
    "Research brief",
    [
      "Surface the project goal in one paragraph.",
      "List any continuity anchors and missing context.",
      "Do not mutate locked constraints.",
    ],
    lockedConstraintLabels,
    [],
    [INTERNAL_ADAPTER_ID],
    "read",
    "auto-allow",
    5 * 60 * 1000,
    "stop",
  );

  const scriptPlanner = buildAssignment(
    requestId,
    "script-planner",
    "Turn the approved research brief into a deterministic story outline.",
    "planning.story-outline",
    [
      {
        name: "research-brief",
        source: "assignment",
        description: "The research brief from the researcher role.",
        required: true,
        artifactId: researchArtifact.artifactId,
      },
    ],
    [
      {
        name: "script-outline",
        description: "Story outline that downstream crew can execute.",
        artifact: scriptArtifact,
      },
    ],
    "Story outline",
    [
      "Respect every locked constraint.",
      "Define a clear narrative arc for the group.",
      "Keep the output deterministic and reviewable.",
    ],
    lockedConstraintLabels,
    [researcher.assignmentId],
    [INTERNAL_ADAPTER_ID],
    "generate",
    "operator-approve",
    10 * 60 * 1000,
    "reassign",
  );

  const shotPlanner = buildAssignment(
    requestId,
    "shot-planner",
    "Break the approved story outline into shot-level direction.",
    "planning.shot-outline",
    [
      {
        name: "script-outline",
        source: "assignment",
        description: "Approved story outline from the script planner.",
        required: true,
        artifactId: scriptArtifact.artifactId,
      },
    ],
    [
      {
        name: "shot-plan",
        description: "Shot-level outline for execution routing.",
        artifact: shotArtifact,
      },
    ],
    "Shot plan",
    [
      "Preserve the approved story outline.",
      "Expose enough detail for asset routing and QC.",
      "Keep camera language deterministic.",
    ],
    lockedConstraintLabels,
    [scriptPlanner.assignmentId],
    [INTERNAL_ADAPTER_ID],
    "generate",
    "operator-approve",
    10 * 60 * 1000,
    "reassign",
  );

  const allowedAdapters = [
    plan.modelRoutingDecision.selectedVideoBinding,
    plan.modelRoutingDecision.selectedImageBinding,
  ].filter((value): value is string => value !== null);

  const assetRouter = buildAssignment(
    requestId,
    "asset-router",
    "Choose the best available adapter route without violating locked constraints.",
    "routing.adapter-match",
    [
      {
        name: "script-outline",
        source: "assignment",
        description: "Approved script outline for route matching.",
        required: true,
        artifactId: scriptArtifact.artifactId,
      },
    ],
    [
      {
        name: "route-receipt",
        description: "Chosen adapter route and fallback notes.",
        artifact: routeArtifact,
      },
    ],
    "Adapter route receipt",
    [
      "Prefer the director-selected binding when possible.",
      "If no eligible adapter exists, escalate instead of improvising.",
      "Record any degraded route explicitly.",
    ],
    lockedConstraintLabels,
    [scriptPlanner.assignmentId],
    allowedAdapters,
    "route",
    "operator-approve",
    5 * 60 * 1000,
    "reassign",
  );

  const qcReviewer = buildAssignment(
    requestId,
    "qc-reviewer",
    "Check the crew plan before handoff leaves director control.",
    "quality.constraint-check",
    [
      {
        name: "shot-plan",
        source: "assignment",
        description: "Shot-level direction from the shot planner.",
        required: true,
        artifactId: shotArtifact.artifactId,
      },
      {
        name: "route-receipt",
        source: "assignment",
        description: "Adapter route receipt from the asset router.",
        required: true,
        artifactId: routeArtifact.artifactId,
      },
    ],
    [
      {
        name: "quality-gate",
        description: "Quality gate report before execution handoff.",
        artifact: qcArtifact,
      },
    ],
    "Quality gate review",
    [
      "Verify that every assignment respects locked constraints.",
      "Verify that a concrete adapter route exists before handoff.",
      "Escalate to the director on any mismatch.",
    ],
    lockedConstraintLabels,
    [shotPlanner.assignmentId, assetRouter.assignmentId],
    [INTERNAL_ADAPTER_ID],
    "review",
    "auto-allow",
    5 * 60 * 1000,
    "stop",
  );

  const handoffs: CrewHandoff[] = [
    {
      fromAssignmentId: researcher.assignmentId,
      toAssignmentId: scriptPlanner.assignmentId,
      artifact: researchArtifact,
      handoffContract: researchArtifact.contract,
      blocking: true,
    },
    {
      fromAssignmentId: scriptPlanner.assignmentId,
      toAssignmentId: shotPlanner.assignmentId,
      artifact: scriptArtifact,
      handoffContract: shotArtifact.contract,
      blocking: true,
    },
    {
      fromAssignmentId: scriptPlanner.assignmentId,
      toAssignmentId: assetRouter.assignmentId,
      artifact: scriptArtifact,
      handoffContract: routeArtifact.contract,
      blocking: true,
    },
    {
      fromAssignmentId: shotPlanner.assignmentId,
      toAssignmentId: qcReviewer.assignmentId,
      artifact: shotArtifact,
      handoffContract: qcArtifact.contract,
      blocking: true,
    },
    {
      fromAssignmentId: assetRouter.assignmentId,
      toAssignmentId: qcReviewer.assignmentId,
      artifact: routeArtifact,
      handoffContract: qcArtifact.contract,
      blocking: true,
    },
  ];

  return {
    assignments: [researcher, scriptPlanner, shotPlanner, assetRouter, qcReviewer],
    handoffs,
  };
}

function toActionNodeStatus(
  approvalMode: ApprovalMode,
  routeStatus: ActionGraph["routeDecisions"][number]["routeStatus"],
): ActionNodeStatus {
  if (
    approvalMode === "forbidden-in-beta1" ||
    routeStatus === "blocked" ||
    routeStatus === "no-match"
  ) {
    return "blocked";
  }
  if (approvalMode === "operator-approve" || routeStatus === "degraded") {
    return "awaiting_approval";
  }
  return "ready";
}

function buildRouteDecisions(blueprint: ExecutionBlueprint): ActionGraph["routeDecisions"] {
  return blueprint.assignments.map((assignment) => {
    if (assignment.allowedAdapters.length === 0) {
      return {
        assignmentId: assignment.assignmentId,
        adapterId: null,
        adapterKind: assignment.actionClass === "route" ? "media" : "internal",
        routeStatus: assignment.actionClass === "route" ? "no-match" : "selected",
        reason:
          assignment.actionClass === "route"
            ? "No eligible adapter was assigned to this crew node."
            : "Internal director node does not require an external adapter.",
        dryRunOnly: true,
      };
    }

    const adapterId = assignment.allowedAdapters[0] ?? null;
    if (adapterId === null) {
      return {
        assignmentId: assignment.assignmentId,
        adapterId: null,
        adapterKind: assignment.actionClass === "route" ? "media" : "internal",
        routeStatus: "blocked",
        reason: "Adapter selection failed even though a route was expected.",
        dryRunOnly: true,
      };
    }

    return {
      assignmentId: assignment.assignmentId,
      adapterId,
      adapterKind: adapterId === INTERNAL_ADAPTER_ID ? "internal" : "media",
      routeStatus:
        assignment.actionClass === "route" && adapterId === INTERNAL_ADAPTER_ID
          ? "no-match"
          : "selected",
      reason:
        adapterId === INTERNAL_ADAPTER_ID
          ? "Director-internal node does not leave the control kernel."
          : "Adapter route selected from the deterministic route set.",
      dryRunOnly: true,
    };
  });
}

export function captureRuntimeCapabilitySnapshot(
  context: DirectorContext,
): RuntimeCapabilitySnapshot {
  const capturedAt = toIsoTimestamp(context.request.timestamp);
  const capabilities: RuntimeCapabilityDescriptor[] = context.runtime.availableBindings.map(
    (binding) => ({
      capabilityId: makeStableId("capability", context.runtime.runtimeId, binding),
      adapterId: binding,
      bindingId: binding,
      scope: context.runtime.supportsVideo ? "hybrid" : "image",
      status:
        context.runtime.status === "offline"
          ? "blocked"
          : context.runtime.status === "degraded"
            ? "degraded"
            : "ready",
      supportsDeterministicMode: context.runtime.deterministicMode === "safe",
      supportedActionClasses: ["generate", "route", "review"],
      reason:
        context.runtime.status === "offline"
          ? "Runtime is offline, so this binding cannot be used."
          : context.runtime.status === "degraded"
            ? "Runtime is degraded, so this binding is only available on a reviewed path."
            : "Runtime is healthy and the binding is eligible for planning.",
    }),
  );

  const capabilityTags = [
    context.runtime.supportsVideo ? "video-capable" : "image-only",
    `runtime:${context.runtime.status}`,
    ...(context.runtime.deterministicMode
      ? [`deterministic:${context.runtime.deterministicMode}`]
      : []),
  ];
  const notes = [
    context.runtime.availableBindings.length > 0
      ? `${context.runtime.availableBindings.length} binding(s) are visible to the director.`
      : "No bindings are currently visible to the director.",
    context.runtime.supportsVideo
      ? "Video-capable routing is available in principle."
      : "Video-capable routing is unavailable, so standard mode may be locked.",
  ];

  return {
    snapshotId: makeStableId("capability-snapshot", context.request.requestId),
    runtimeId: context.runtime.runtimeId,
    capturedAt,
    runtimeStatus: context.runtime.status,
    maxPromptChars: context.runtime.maxPromptChars,
    supportsVideo: context.runtime.supportsVideo,
    ...(context.runtime.deterministicMode === undefined
      ? {}
      : { deterministicMode: context.runtime.deterministicMode }),
    availableBindings: [...context.runtime.availableBindings],
    capabilityTags,
    capabilities,
    notes,
  };
}

export function assessAlignment(
  context: DirectorContext,
  capabilitySnapshot: RuntimeCapabilitySnapshot,
): ClarificationDecision {
  const questions: ClarificationQuestion[] = [];
  const blockingReasons: string[] = [];
  const satisfiedSignals: string[] = [];
  const missingSignals: string[] = [];

  if (capabilitySnapshot.runtimeStatus === "offline") {
    blockingReasons.push("Runtime is offline and cannot accept a director handoff.");
  } else {
    satisfiedSignals.push("runtime-online");
  }

  if (capabilitySnapshot.maxPromptChars <= 0) {
    blockingReasons.push("Runtime prompt budget is invalid.");
  } else {
    satisfiedSignals.push("prompt-budget-known");
  }

  if (
    (context.project.title ?? "").trim().length === 0 &&
    (context.project.outline ?? "").trim().length === 0
  ) {
    questions.push({
      questionId: makeStableId("question", context.request.requestId, "goal"),
      field: "goal",
      prompt: "What exact outcome should the director optimize for in this run?",
      reason: "The project does not yet contain a title or outline.",
      required: true,
    });
    missingSignals.push("goal");
  } else {
    satisfiedSignals.push("goal-present");
  }

  if (context.group.sceneCount <= 0) {
    questions.push({
      questionId: makeStableId("question", context.request.requestId, "scope"),
      field: "scope",
      prompt: "How many scenes or units should this run plan for?",
      reason: "The scene count is missing or invalid.",
      required: true,
    });
    missingSignals.push("scope");
  } else {
    satisfiedSignals.push("scope-present");
  }

  if (context.project.continuityPriority === "high" && context.group.anchorIds.length === 0) {
    questions.push({
      questionId: makeStableId("question", context.request.requestId, "continuity"),
      field: "continuity",
      prompt: "Please provide at least one continuity anchor before the crew is assigned.",
      reason: "Continuity priority is high but no anchors were supplied.",
      required: true,
    });
    missingSignals.push("continuity");
  } else if (context.group.anchorIds.length > 0) {
    satisfiedSignals.push("continuity-anchor-present");
  }

  if (context.group.generationStyle === "immersive" && !context.runtime.supportsVideo) {
    questions.push({
      questionId: makeStableId("question", context.request.requestId, "generation-style"),
      field: "generation-style",
      prompt:
        "The runtime cannot do immersive video output right now. Should the director fall back to standard mode?",
      reason: "Immersive mode was requested, but runtime capability snapshot is image-only.",
      required: true,
    });
    missingSignals.push("generation-style");
  } else {
    satisfiedSignals.push("generation-style-compatible");
  }

  if (
    context.intent.bindingPolicy === "require" &&
    capabilitySnapshot.availableBindings.length === 0
  ) {
    blockingReasons.push("Binding policy is require, but the runtime does not expose any binding.");
  } else {
    satisfiedSignals.push("binding-policy-evaluable");
  }

  const alignmentState =
    blockingReasons.length > 0
      ? "blocked"
      : questions.length > 0
        ? "clarification_required"
        : "aligned";
  const summary =
    alignmentState === "blocked"
      ? "Director alignment is blocked until runtime or binding issues are fixed."
      : alignmentState === "clarification_required"
        ? `Director requires ${questions.length} clarification answer(s) before handoff can be trusted.`
        : "Director has enough information to lock alignment and proceed to crew planning.";

  return {
    decisionId: makeStableId("clarification", context.request.requestId),
    alignmentState,
    summary,
    questions,
    blockingReasons,
    satisfiedSignals,
    missingSignals,
  };
}

export function lockAlignment(
  context: DirectorContext,
  clarification: ClarificationDecision,
): AlignmentLock {
  const lockedConstraints: AlignmentConstraint[] = (context.locks?.lockedFields ?? []).map((lock) =>
    buildConstraint(
      context,
      lock.field,
      lock.level,
      "user_lock",
      resolveFieldValue(context, lock.field),
      lock.reason,
    ),
  );

  if (!context.runtime.supportsVideo) {
    lockedConstraints.push(
      buildConstraint(
        context,
        "group.generationStyle",
        "hard_lock",
        "runtime_guardrail",
        "standard",
        "Runtime capability snapshot does not expose video execution support.",
      ),
    );
  }

  if (context.runtime.deterministicMode === "safe") {
    lockedConstraints.push(
      buildConstraint(
        context,
        "runtime.deterministicMode",
        "hard_lock",
        "runtime_guardrail",
        "safe",
        "Safe deterministic mode forbids unbounded generation variance.",
      ),
    );
  }

  const status =
    clarification.alignmentState === "blocked"
      ? "blocked"
      : clarification.alignmentState === "clarification_required"
        ? "pending"
        : "locked";

  return {
    lockId: makeStableId("alignment-lock", context.request.requestId),
    status,
    goal: buildGoal(context),
    deliverable: buildDeliverable(context),
    alignmentState: clarification.alignmentState,
    lockedConstraints,
    unresolvedQuestionIds: clarification.questions.map((question) => question.questionId),
    lockedAt: toIsoTimestamp(context.request.timestamp),
    notes:
      clarification.alignmentState === "aligned"
        ? ["Alignment is locked and ready for deterministic crew planning."]
        : clarification.alignmentState === "clarification_required"
          ? ["Alignment is pending clarification; downstream action graphs should stay empty."]
          : ["Alignment is blocked; director cannot produce a valid handoff yet."],
  };
}

export function createPlan(
  context: DirectorContext,
  foundation?: PlanningFoundation,
): DirectorPlan {
  const capabilitySnapshot =
    foundation?.capabilitySnapshot ?? captureRuntimeCapabilitySnapshot(context);
  const clarification = foundation?.clarification ?? assessAlignment(context, capabilitySnapshot);
  const alignmentLock = foundation?.alignmentLock ?? lockAlignment(context, clarification);
  const modeDecision = chooseGenerationStyle(context, alignmentLock);
  const selectedImageBinding = pickBinding(
    capabilitySnapshot.availableBindings,
    context.intent.requiredImageBinding,
    context.intent.preferredImageBinding,
    context.intent.fallbackBindings,
  );
  const selectedVideoBinding =
    context.runtime.supportsVideo && modeDecision.style === "immersive"
      ? pickBinding(
          capabilitySnapshot.availableBindings,
          context.intent.requiredVideoBinding,
          context.intent.preferredVideoBinding,
          context.intent.fallbackBindings,
        )
      : null;
  const status = determinePlanStatus(context, alignmentLock, selectedImageBinding);
  const reviewStatus = reviewStatusFromPlanStatus(status);
  const riskFlags = buildRiskFlags(
    context,
    clarification,
    alignmentLock,
    selectedImageBinding,
    selectedVideoBinding,
  );
  const confidence =
    status === "ready" && context.runtime.status === "ready"
      ? 0.92
      : status === "blocked"
        ? 0.42
        : DEFAULT_CONFIDENCE;

  const planId = makeStableId("plan", context.request.requestId);

  return {
    planId,
    version: "v1",
    status,
    summary: `Director control chose ${modeDecision.style} mode after ${capabilitySnapshot.capabilities.length} capability check(s) and ${alignmentLock.status} alignment.`,
    confidence,
    riskFlags,
    modeDecision: {
      selectedGenerationStyle: modeDecision.style,
      whySelected: modeDecision.whySelected,
      fallbackGenerationStyle: modeDecision.style === "immersive" ? "standard" : "immersive",
      rejectedStyles: modeDecision.rejectedStyles,
    },
    modelRoutingDecision: {
      selectedImageBinding,
      selectedVideoBinding,
      bindingPolicy: context.intent.bindingPolicy,
      whySelected: `Binding policy ${context.intent.bindingPolicy} resolved against ${capabilitySnapshot.availableBindings.length} visible binding(s).`,
    },
    reviewStatus,
    createdAt: toIsoTimestamp(context.request.timestamp),
    capabilitySnapshotId: capabilitySnapshot.snapshotId,
    alignmentState: clarification.alignmentState,
    alignmentLockId: alignmentLock.lockId,
  };
}

export function buildCrewDelegationGraph(
  context: DirectorContext,
  plan: DirectorPlan,
  review: ReviewReport,
  capabilitySnapshot: RuntimeCapabilitySnapshot,
  clarification: ClarificationDecision,
  alignmentLock: AlignmentLock,
): ExecutionBlueprint {
  const decisions = buildDecisionRecords(
    capabilitySnapshot,
    clarification,
    alignmentLock,
    plan,
    review,
  );

  if (alignmentLock.status !== "locked" || review.overallDecision === "block") {
    return buildBlockedBlueprint(context, alignmentLock, decisions);
  }

  const { assignments, handoffs } = buildCrewAssignments(context, plan, alignmentLock);

  return {
    blueprintId: makeStableId("blueprint", context.request.requestId),
    status: "planned",
    goal: alignmentLock.goal,
    lockedConstraints: alignmentLock.lockedConstraints,
    directorDecisions: decisions,
    assignments,
    handoffs,
    globalFailurePolicy: {
      blockOnLockedConstraintViolation: true,
      blockOnMissingCapability: true,
      replanOnDependencyFailure: true,
    },
    replanTriggers: [
      "locked constraint violation",
      "dependency handoff failed",
      "adapter route degraded or unavailable",
    ],
    stopConditions: [
      "runtime offline",
      "required binding unresolved",
      "operator rejected the route",
    ],
  };
}

export function buildActionGraph(blueprint: ExecutionBlueprint): ActionGraph {
  const routeDecisions = buildRouteDecisions(blueprint);
  const routeDecisionByAssignment = new Map(
    routeDecisions.map((routeDecision) => [routeDecision.assignmentId, routeDecision]),
  );
  const nodeIdByAssignment = new Map<string, string>();

  const nodes: ActionGraphNode[] = blueprint.assignments.map((assignment) => {
    const nodeId = makeStableId("action-node", blueprint.blueprintId, assignment.assignmentId);
    nodeIdByAssignment.set(assignment.assignmentId, nodeId);

    const routeDecision = routeDecisionByAssignment.get(assignment.assignmentId);
    const routeStatus = routeDecision?.routeStatus ?? "blocked";

    return {
      nodeId,
      assignmentId: assignment.assignmentId,
      role: assignment.role,
      title: assignment.deliverable,
      actionClass: assignment.actionClass,
      approvalMode: assignment.approvalMode,
      selectedAdapterId: routeDecision?.adapterId ?? null,
      dependsOn: [...assignment.dependsOn],
      inputArtifactIds: assignment.inputs
        .map((input) => input.artifactId)
        .filter((artifactId): artifactId is string => artifactId !== undefined),
      outputArtifactIds: assignment.outputs.map((output) => output.artifact.artifactId),
      status: toActionNodeStatus(assignment.approvalMode, routeStatus),
    };
  });

  const edges: ActionGraphEdge[] = blueprint.handoffs.map((handoff) => ({
    fromNodeId:
      nodeIdByAssignment.get(handoff.fromAssignmentId) ??
      makeStableId("action-node", blueprint.blueprintId, handoff.fromAssignmentId),
    toNodeId:
      nodeIdByAssignment.get(handoff.toAssignmentId) ??
      makeStableId("action-node", blueprint.blueprintId, handoff.toAssignmentId),
    artifactId: handoff.artifact.artifactId,
    blocking: handoff.blocking,
  }));

  const blockedReasons = [
    ...routeDecisions
      .filter(
        (routeDecision) =>
          routeDecision.routeStatus === "blocked" || routeDecision.routeStatus === "no-match",
      )
      .map((routeDecision) => `${routeDecision.assignmentId}: ${routeDecision.reason}`),
    ...nodes
      .filter((node) => node.status === "blocked")
      .map((node) => `${node.assignmentId}: action node is blocked before handoff.`),
  ];

  return {
    graphId: makeStableId("action-graph", blueprint.blueprintId),
    blueprintId: blueprint.blueprintId,
    routeDecisions,
    nodes,
    edges,
    blockedReasons,
    previewSummary: blueprint.assignments.map((assignment) =>
      toPreviewLine(assignment.role, assignment.objective),
    ),
  };
}

export function evaluatePolicySafetyGate(actionGraph: ActionGraph): PolicySafetyGateResult {
  const requiredApprovals = actionGraph.nodes
    .filter((node) => node.status === "awaiting_approval")
    .map((node) => `${node.role}:${node.assignmentId}`);
  const reasons = [...actionGraph.blockedReasons];

  const decision =
    reasons.length > 0 ? "block" : requiredApprovals.length > 0 ? "review_required" : "allow";

  return {
    gateId: makeStableId("policy-gate", actionGraph.graphId),
    decision,
    reasons:
      reasons.length > 0
        ? reasons
        : decision === "review_required"
          ? ["Operator approval is required before the dry-run handoff can proceed."]
          : ["Action graph passed the Beta-1 safety gate."],
    requiredApprovals,
  };
}

export function buildExecutionHandoffEnvelope(
  context: DirectorContext,
  plan: DirectorPlan,
  blueprint: ExecutionBlueprint,
  actionGraph: ActionGraph,
  capabilitySnapshot: RuntimeCapabilitySnapshot,
  alignmentLock: AlignmentLock,
  safetyGate: PolicySafetyGateResult,
): ExecutionHandoffEnvelope {
  const assignmentById = new Map(
    blueprint.assignments.map((assignment) => [assignment.assignmentId, assignment]),
  );
  const handoffItems: ExecutionHandoffItem[] = actionGraph.nodes.map((node) => {
    const assignment = assignmentById.get(node.assignmentId);

    return {
      assignmentId: node.assignmentId,
      role: node.role,
      deliverable: assignment?.deliverable ?? node.title,
      actionClass: node.actionClass,
      selectedAdapterId: node.selectedAdapterId,
      approvalMode: node.approvalMode,
      dependsOn: [...node.dependsOn],
      constraints: assignment?.constraints ? [...assignment.constraints] : [],
    };
  });

  return {
    envelopeId: makeStableId("handoff", plan.planId),
    status:
      safetyGate.decision === "block"
        ? "blocked"
        : safetyGate.decision === "allow"
          ? "handoff_ready"
          : "preview_ready",
    planId: plan.planId,
    blueprintId: blueprint.blueprintId,
    actionGraphId: actionGraph.graphId,
    capabilitySnapshotId: capabilitySnapshot.snapshotId,
    alignmentLockId: alignmentLock.lockId,
    operatorPreview: {
      headline: `Director prepared ${blueprint.assignments.length} crew assignment(s) for ${context.group.groupId}.`,
      summaryLines: [
        ...actionGraph.previewSummary,
        `image binding: ${plan.modelRoutingDecision.selectedImageBinding ?? "none"}`,
        `video binding: ${plan.modelRoutingDecision.selectedVideoBinding ?? "none"}`,
      ],
      blockedReasons: [...actionGraph.blockedReasons],
      requiredApprovals: [...safetyGate.requiredApprovals],
    },
    safetyGate,
    handoffItems,
    blockedReasons: [...actionGraph.blockedReasons],
    createdAt: toIsoTimestamp(context.request.timestamp),
  };
}

export function buildDirectorControlResult(context: DirectorContext): DirectorControlResult {
  const capabilitySnapshot = captureRuntimeCapabilitySnapshot(context);
  const clarification = assessAlignment(context, capabilitySnapshot);
  const alignmentLock = lockAlignment(context, clarification);
  const plan = createPlan(context, {
    capabilitySnapshot,
    clarification,
    alignmentLock,
  });
  const review = reviewPlan(context, plan, {
    capabilitySnapshot,
    clarification,
    alignmentLock,
  });

  if (clarification.alignmentState === "blocked" || review.overallDecision === "block") {
    return {
      controlId: makeStableId("control", context.request.requestId),
      status: "blocked",
      capabilitySnapshot,
      clarification,
      alignmentLock,
      plan,
      review,
    };
  }

  if (clarification.alignmentState === "clarification_required") {
    return {
      controlId: makeStableId("control", context.request.requestId),
      status: "clarification_required",
      capabilitySnapshot,
      clarification,
      alignmentLock,
      plan,
      review,
    };
  }

  const blueprint = buildCrewDelegationGraph(
    context,
    plan,
    review,
    capabilitySnapshot,
    clarification,
    alignmentLock,
  );
  const actionGraph = buildActionGraph(blueprint);
  const safetyGate = evaluatePolicySafetyGate(actionGraph);
  const handoffEnvelope = buildExecutionHandoffEnvelope(
    context,
    plan,
    blueprint,
    actionGraph,
    capabilitySnapshot,
    alignmentLock,
    safetyGate,
  );

  return {
    controlId: makeStableId("control", context.request.requestId),
    status: safetyGate.decision === "allow" ? "ready_for_handoff" : "ready_for_preview",
    capabilitySnapshot,
    clarification,
    alignmentLock,
    plan: {
      ...plan,
      blueprintId: blueprint.blueprintId,
    },
    review,
    blueprint,
    actionGraph,
    safetyGate,
    handoffEnvelope,
  };
}

export function buildExecutionPlan(context: DirectorContext, plan: DirectorPlan): ExecutionPlan {
  const controlResult = buildDirectorControlResult(context);
  const prompt = createExecutionPromptBundle({
    context,
    plan,
    controlResult,
  });

  return {
    executionId: `${plan.planId}-execution`,
    planId: plan.planId,
    groupId: context.group.groupId,
    selectedGenerationStyle: plan.modeDecision.selectedGenerationStyle,
    selectedGenerationType: context.group.generationType,
    selectedImageBinding: plan.modelRoutingDecision.selectedImageBinding,
    selectedVideoBinding: plan.modelRoutingDecision.selectedVideoBinding,
    prompt,
    reviewStatus: plan.reviewStatus,
    intent: context.intent,
    ...(controlResult.blueprint === undefined
      ? {}
      : { blueprintId: controlResult.blueprint.blueprintId }),
    ...(controlResult.actionGraph === undefined
      ? {}
      : { actionGraphId: controlResult.actionGraph.graphId }),
    ...(controlResult.handoffEnvelope === undefined
      ? {}
      : { handoffEnvelopeId: controlResult.handoffEnvelope.envelopeId }),
  };
}
