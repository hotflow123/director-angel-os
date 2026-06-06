import { assessAlignment, captureRuntimeCapabilitySnapshot, lockAlignment } from "./planner.js";
import type {
  AlignmentLock,
  ClarificationDecision,
  DirectorContext,
  DirectorPlan,
  ReviewGateResult,
  ReviewReport,
  ReviewStatus,
  RuntimeCapabilitySnapshot,
} from "./types.js";

interface ReviewFoundation {
  capabilitySnapshot: RuntimeCapabilitySnapshot;
  clarification: ClarificationDecision;
  alignmentLock: AlignmentLock;
}

function buildRuntimeGate(snapshot: RuntimeCapabilitySnapshot): ReviewGateResult {
  if (snapshot.runtimeStatus === "offline") {
    return {
      gate: "runtime",
      status: "block",
      score: 0,
      reason: "runtime is offline and cannot support a safe handoff.",
      requiredFix: "Restore the runtime before continuing.",
    };
  }
  if (snapshot.runtimeStatus === "degraded") {
    return {
      gate: "runtime",
      status: "warn",
      score: 58,
      reason: "runtime is degraded, so the handoff must stay on a reviewed path.",
      requiredFix: "Inspect provider and storage health before execution handoff.",
    };
  }
  return {
    gate: "runtime",
    status: "pass",
    score: 92,
    reason: "runtime capability snapshot is healthy.",
  };
}

function buildAlignmentGate(
  clarification: ClarificationDecision,
  alignmentLock: AlignmentLock,
): ReviewGateResult {
  if (clarification.alignmentState === "blocked" || alignmentLock.status === "blocked") {
    return {
      gate: "alignment",
      status: "block",
      score: 0,
      reason: "alignment is blocked and the director cannot safely delegate work.",
      requiredFix: "Resolve the blocking runtime or policy issue before planning crew work.",
    };
  }
  if (
    clarification.alignmentState === "clarification_required" ||
    alignmentLock.status === "pending"
  ) {
    return {
      gate: "alignment",
      status: "warn",
      score: 55,
      reason: "alignment is still waiting on clarification answers.",
      requiredFix: "Answer the required clarification questions before handoff.",
    };
  }
  return {
    gate: "alignment",
    status: "pass",
    score: 94,
    reason: "alignment is locked and ready for crew delegation.",
  };
}

function buildContinuityGate(context: DirectorContext): ReviewGateResult {
  if (context.group.anchorIds.length === 0) {
    return {
      gate: "continuity",
      status: "warn",
      score: 52,
      reason: "no continuity anchors were provided in the snapshot.",
      requiredFix: "Add at least one anchor so the director can preserve continuity.",
    };
  }
  if (
    context.project.continuityPriority === "high" &&
    (context.knowledgeSignals?.length ?? 0) === 0
  ) {
    return {
      gate: "continuity",
      status: "warn",
      score: 64,
      reason:
        "continuity is marked high priority but no published knowledge signals were provided.",
      requiredFix: "Attach a published knowledge pack or continuity notes before generating.",
    };
  }
  return {
    gate: "continuity",
    status: "pass",
    score: 88,
    reason: "continuity anchors and knowledge signals are adequate for the current handoff.",
  };
}

function buildBindingGate(plan: DirectorPlan): ReviewGateResult {
  if (plan.status === "blocked") {
    return {
      gate: "binding",
      status: "block",
      score: 0,
      reason: "required bindings could not be resolved.",
      requiredFix: "Provide a valid binding or relax the binding policy.",
    };
  }
  if (plan.status === "review_required") {
    return {
      gate: "binding",
      status: "warn",
      score: 61,
      reason: "binding selection degraded to a review-required path.",
      requiredFix: "Review the suggested binding before generating.",
    };
  }
  return {
    gate: "binding",
    status: "pass",
    score: 90,
    reason: "binding selection completed on the deterministic path.",
  };
}

function buildLocksGate(alignmentLock: AlignmentLock): ReviewGateResult {
  const hardLocks = alignmentLock.lockedConstraints.filter(
    (constraint) => constraint.level === "hard_lock",
  );
  if (alignmentLock.status === "pending") {
    return {
      gate: "locks",
      status: "warn",
      score: 68,
      reason: "alignment lock exists but still has unresolved questions.",
      requiredFix: "Resolve the pending clarification questions before crew execution.",
    };
  }
  if (hardLocks.length > 0) {
    return {
      gate: "locks",
      status: "warn",
      score: 72,
      reason: `director recorded ${hardLocks.length} hard lock(s) that restrict automatic changes.`,
      requiredFix: "Confirm the locked fields still match the execution goal.",
    };
  }
  return {
    gate: "locks",
    status: "pass",
    score: 94,
    reason: "no hard locks block the deterministic crew plan.",
  };
}

export function reviewPlan(
  context: DirectorContext,
  plan: DirectorPlan,
  foundation?: ReviewFoundation,
): ReviewReport {
  const capabilitySnapshot =
    foundation?.capabilitySnapshot ?? captureRuntimeCapabilitySnapshot(context);
  const clarification = foundation?.clarification ?? assessAlignment(context, capabilitySnapshot);
  const alignmentLock = foundation?.alignmentLock ?? lockAlignment(context, clarification);

  const gates = [
    buildRuntimeGate(capabilitySnapshot),
    buildAlignmentGate(clarification, alignmentLock),
    buildContinuityGate(context),
    buildBindingGate(plan),
    buildLocksGate(alignmentLock),
  ];
  const overallDecision: ReviewStatus = gates.some((gate) => gate.status === "block")
    ? "block"
    : gates.some((gate) => gate.status === "warn")
      ? "warn"
      : "pass";

  return {
    overallDecision,
    gates,
    blockingReasons: gates
      .filter((gate) => gate.status !== "pass")
      .map((gate) => `${gate.gate}: ${gate.reason}`),
    requiredFixes: gates.flatMap((gate) => (gate.requiredFix ? [gate.requiredFix] : [])),
  };
}
